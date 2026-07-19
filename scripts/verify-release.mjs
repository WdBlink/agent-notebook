import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const archiveArg = valueAfter(args, "--archive");
if (!archiveArg) throw new Error("Use --archive <release.zip|release.dmg>.");
const archive = path.resolve(archiveArg);
const format = path.extname(archive).slice(1);
if (!new Set(["zip", "dmg"]).has(format)) throw new Error(`Unsupported release archive: ${archive}`);
const arch = valueAfter(args, "--arch") ?? archive.match(/macos-(arm64|x64)\.(?:zip|dmg)$/)?.[1];
if (!arch || !new Set(["arm64", "x64"]).has(arch)) throw new Error("Could not determine release architecture.");

const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
const version = packageJson.version;
const expectedRootName = `agent-whiteboard-v${version}-macos-${arch}`;
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-whiteboard-release-"));
const mountPoint = path.join(temp, "mounted");
let mounted = false;

try {
  const root = await openArchive();
  const plugin = path.join(root, "daily-cockpit");
  await rejectSymlinks(root);
  for (const relative of ["main.js", "styles.css", "manifest.json", "runtime/active.json"]) await assertFile(path.join(plugin, relative));
  if (await exists(path.join(plugin, "data.json"))) throw new Error("Release must not contain user data.json.");

  const manifest = JSON.parse(await fs.readFile(path.join(plugin, "manifest.json"), "utf8"));
  if (manifest.version !== version || manifest.id !== "daily-cockpit" || manifest.isDesktopOnly !== true) {
    throw new Error("Release manifest metadata is inconsistent.");
  }
  const pointer = JSON.parse(await fs.readFile(path.join(plugin, "runtime", "active.json"), "utf8"));
  if (typeof pointer.version !== "string" || !/^runtime-[a-f0-9]{24}$/.test(pointer.version)) throw new Error("Release runtime pointer is invalid.");
  const runtime = path.join(plugin, "runtime", "versions", pointer.version);
  await verifyRuntimeManifest(runtime);

  const expectedMachArch = arch === "x64" ? "x86_64" : "arm64";
  const nativeFiles = [
    "process-membership",
    "node_modules/node-pty/build/Release/pty.node",
    "node_modules/node-pty/build/Release/spawn-helper"
  ];
  for (const relative of nativeFiles) {
    const file = path.join(runtime, relative);
    const { stdout } = await execFileAsync("/usr/bin/lipo", ["-archs", file]);
    const architectures = stdout.trim().split(/\s+/);
    if (architectures.length !== 1 || architectures[0] !== expectedMachArch) {
      throw new Error(`Wrong architecture for ${relative}: ${stdout.trim()}`);
    }
  }

  const installer = path.join(root, "Install Agent Whiteboard.command");
  const installerStat = await fs.stat(installer);
  if ((installerStat.mode & 0o111) === 0) throw new Error("Release installer is not executable.");
  const installerText = await fs.readFile(installer, "utf8");
  if (installerText.includes("__ARCH__") || installerText.includes("__VERSION__") || !installerText.includes(`EXPECTED_ARCH="${arch}"`)) {
    throw new Error("Release installer template was not resolved.");
  }

  const main = await fs.readFile(path.join(plugin, "main.js"), "utf8");
  for (const snippet of ["agent-whiteboard-view", "refresh-work-sessions", ".codex/sessions", ".claude/projects"]) {
    if (!main.includes(snippet)) throw new Error(`Release main.js is missing ${snippet}.`);
  }

  let runtimeSmoke = "static-only";
  if (process.arch === arch) {
    const { stdout } = await execFileAsync(process.execPath, ["scripts/test-runtime-host.mjs", "--host", path.join(runtime, "pty-host.mjs")], {
      cwd: process.cwd(), timeout: 30_000, maxBuffer: 1024 * 1024
    });
    if (JSON.parse(stdout)?.ok !== true) throw new Error("Packaged runtime smoke failed.");
    runtimeSmoke = "passed";
  }

  const checksumPath = `${archive}.sha256`;
  if (await exists(checksumPath)) {
    const checksum = (await fs.readFile(checksumPath, "utf8")).trim().split(/\s+/)[0];
    if (checksum !== await fileHash(archive)) throw new Error("Release checksum does not match archive.");
  }

  console.log(JSON.stringify({ ok: true, version, arch, format, archive, runtime: pointer.version, runtimeSmoke }, null, 2));
} finally {
  if (mounted) {
    await execFileAsync("/usr/bin/hdiutil", ["detach", mountPoint], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  }
  await fs.rm(temp, { recursive: true, force: true });
}

async function openArchive() {
  if (format === "zip") {
    await execFileAsync("/usr/bin/ditto", ["-x", "-k", archive, temp], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const rootEntries = (await fs.readdir(temp)).filter((entry) => entry !== "__MACOSX");
    if (JSON.stringify(rootEntries) !== JSON.stringify([expectedRootName])) {
      throw new Error(`Unexpected archive roots: ${rootEntries.join(", ")}`);
    }
    return path.join(temp, expectedRootName);
  }

  await fs.mkdir(mountPoint);
  await execFileAsync("/usr/bin/hdiutil", ["attach", archive, "-readonly", "-nobrowse", "-mountpoint", mountPoint], {
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024
  });
  mounted = true;
  return mountPoint;
}

async function verifyRuntimeManifest(root) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, "runtime-manifest.json"), "utf8"));
  if (manifest?.version !== 1 || !Array.isArray(manifest.files)) throw new Error("Runtime manifest is invalid.");
  const actual = (await collectFiles(root)).filter((file) => file !== "runtime-manifest.json");
  const expected = manifest.files.map((entry) => entry.path).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Runtime manifest entries do not match archive.");
  for (const entry of manifest.files) {
    const file = path.join(root, entry.path);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || await fileHash(file) !== entry.sha256 || (stat.mode & 0o777) !== entry.mode) {
      throw new Error(`Runtime manifest mismatch: ${entry.path}`);
    }
  }
}

async function rejectSymlinks(root) {
  await collectFiles(root);
}

async function collectFiles(root) {
  const result = [];
  const visit = async (directory, prefix = "") => {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Archive contains symlink: ${relative}`);
      if (stat.isDirectory()) await visit(absolute, relative);
      else if (stat.isFile()) result.push(relative);
      else throw new Error(`Archive contains unsupported entry: ${relative}`);
    }
  };
  await visit(root);
  return result.sort();
}

async function assertFile(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error(`Expected file: ${file}`);
}

async function exists(file) {
  try { await fs.lstat(file); return true; } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

async function fileHash(file) {
  return crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

function valueAfter(tokens, flag) {
  const index = tokens.indexOf(flag);
  return index >= 0 ? tokens[index + 1] : undefined;
}
