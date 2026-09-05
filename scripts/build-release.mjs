import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repo = process.cwd();
const args = process.argv.slice(2);
const arch = valueAfter(args, "--arch") ?? process.arch;
if (process.platform !== "darwin") throw new Error("macOS release packages must be built on macOS.");
if (!new Set(["arm64", "x64"]).has(arch)) throw new Error(`Unsupported macOS architecture: ${arch}`);
if (process.env.CI && process.arch !== arch) {
  throw new Error(`Release runner architecture mismatch: expected ${arch}, got ${process.arch}`);
}

const packageJson = JSON.parse(await fs.readFile(path.join(repo, "package.json"), "utf8"));
const manifest = JSON.parse(await fs.readFile(path.join(repo, "manifest.json"), "utf8"));
const version = packageJson.version;
if (manifest.version !== version) throw new Error("package.json and manifest.json versions must match.");
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid release version: ${version}`);

for (const file of ["main.js", "styles.css", "manifest.json", "runtime/pty-host.mjs", "runtime/process-membership.c"]) {
  await assertFile(path.join(repo, file));
}

const dist = path.join(repo, "dist", "release");
const releaseName = `agent-whiteboard-v${version}-macos-${arch}`;
const releaseRoot = path.join(dist, releaseName);
const pluginDir = path.join(releaseRoot, "agent-notebook");
const pendingRuntime = path.join(pluginDir, "runtime", "versions", "pending");
const nodePtySource = path.join(repo, "node_modules", "node-pty");
const nativeSource = path.join(nodePtySource, "prebuilds", `darwin-${arch}`);
const nativeRelease = path.join(pendingRuntime, "node_modules", "node-pty", "build", "Release");

await fs.rm(releaseRoot, { recursive: true, force: true });
await fs.mkdir(nativeRelease, { recursive: true });

await Promise.all([
  copy("main.js", path.join(pluginDir, "main.js"), 0o644),
  copy("styles.css", path.join(pluginDir, "styles.css"), 0o644),
  copy("manifest.json", path.join(pluginDir, "manifest.json"), 0o644),
  copy("runtime/pty-host.mjs", path.join(pendingRuntime, "pty-host.mjs"), 0o644),
  copyFrom(path.join(nodePtySource, "package.json"), path.join(pendingRuntime, "node_modules", "node-pty", "package.json"), 0o644),
  copyFrom(path.join(nodePtySource, "LICENSE"), path.join(pendingRuntime, "node_modules", "node-pty", "LICENSE"), 0o644),
  copyFrom(path.join(nativeSource, "pty.node"), path.join(nativeRelease, "pty.node"), 0o755),
  copyFrom(path.join(nativeSource, "spawn-helper"), path.join(nativeRelease, "spawn-helper"), 0o755)
]);
await fs.cp(path.join(nodePtySource, "lib"), path.join(pendingRuntime, "node_modules", "node-pty", "lib"), {
  recursive: true,
  force: false,
  dereference: true
});
await normalizeTreeModes(path.join(pendingRuntime, "node_modules", "node-pty", "lib"), 0o644);

const membershipTarget = path.join(pendingRuntime, "process-membership");
await execFileAsync(process.env.CC || "/usr/bin/cc", [
  "-arch", arch === "x64" ? "x86_64" : "arm64",
  "-O2", "-Wall", "-Wextra", "-o", membershipTarget,
  path.join(repo, "runtime", "process-membership.c")
], { timeout: 30_000, maxBuffer: 1024 * 1024 });
await fs.chmod(membershipTarget, 0o755);

await writeRuntimeManifest(pendingRuntime);
await validateRuntimeManifest(pendingRuntime);
const runtimeDigest = await fileHash(path.join(pendingRuntime, "runtime-manifest.json"));
const runtimeVersion = `runtime-${runtimeDigest.slice(0, 24)}`;
const runtimeDir = path.join(pluginDir, "runtime", "versions", runtimeVersion);
await fs.rename(pendingRuntime, runtimeDir);
await fs.writeFile(path.join(pluginDir, "runtime", "active.json"), `${JSON.stringify({ version: runtimeVersion })}\n`, { mode: 0o644 });

const installerTemplate = await fs.readFile(path.join(repo, "release", "install-macos.command"), "utf8");
const installer = installerTemplate.replaceAll("__ARCH__", arch).replaceAll("__VERSION__", version);
await fs.writeFile(path.join(releaseRoot, "Install Agent Whiteboard.command"), installer, { mode: 0o755 });
const readmeTemplate = await fs.readFile(path.join(repo, "release", "README.txt"), "utf8");
await fs.writeFile(path.join(releaseRoot, "README.txt"), readmeTemplate.replaceAll("__ARCH__", arch).replaceAll("__VERSION__", version), { mode: 0o644 });

await rejectSymlinks(releaseRoot);
const zip = path.join(dist, `${releaseName}.zip`);
await fs.rm(zip, { force: true });
await execFileAsync("/usr/bin/ditto", ["-c", "-k", "--norsrc", "--keepParent", releaseRoot, zip], {
  timeout: 60_000,
  maxBuffer: 4 * 1024 * 1024
});
const dmg = path.join(dist, `${releaseName}.dmg`);
await fs.rm(dmg, { force: true });
await execFileAsync("/usr/bin/hdiutil", [
  "create",
  "-volname", `Agent Whiteboard ${version} ${arch}`,
  "-srcfolder", releaseRoot,
  "-format", "UDZO",
  "-ov",
  dmg
], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });

const archives = [];
for (const archive of [dmg, zip]) {
  const digest = await fileHash(archive);
  const checksumPath = `${archive}.sha256`;
  await fs.writeFile(checksumPath, `${digest}  ${path.basename(archive)}\n`, { mode: 0o644 });
  archives.push({ archive, checksumPath });
}

console.log(JSON.stringify({ ok: true, version, arch, archives, runtimeVersion }, null, 2));

async function copy(relative, destination, mode) {
  return copyFrom(path.join(repo, relative), destination, mode);
}

async function copyFrom(source, destination, mode) {
  await assertFile(source);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
  await fs.chmod(destination, mode);
}

async function writeRuntimeManifest(root) {
  const files = await collectFiles(root);
  const manifestValue = { version: 1, files: [] };
  for (const relative of files) {
    const absolute = path.join(root, relative);
    const stat = await fs.lstat(absolute);
    manifestValue.files.push({ path: relative, sha256: await fileHash(absolute), mode: stat.mode & 0o777 });
  }
  await fs.writeFile(path.join(root, "runtime-manifest.json"), `${JSON.stringify(manifestValue, null, 2)}\n`, { mode: 0o644, flag: "wx" });
}

async function validateRuntimeManifest(root) {
  const manifestValue = JSON.parse(await fs.readFile(path.join(root, "runtime-manifest.json"), "utf8"));
  const actual = (await collectFiles(root)).filter((file) => file !== "runtime-manifest.json");
  const expected = manifestValue.files.map((entry) => entry.path).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Runtime release manifest is incomplete.");
  for (const entry of manifestValue.files) {
    const absolute = path.join(root, entry.path);
    const stat = await fs.lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || await fileHash(absolute) !== entry.sha256 || (stat.mode & 0o777) !== entry.mode) {
      throw new Error(`Runtime release manifest mismatch: ${entry.path}`);
    }
  }
}

async function normalizeTreeModes(root, mode) {
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) await normalizeTreeModes(absolute, mode);
    else if (entry.isFile()) await fs.chmod(absolute, mode);
    else throw new Error(`Unsupported node-pty lib entry: ${absolute}`);
  }
}

async function collectFiles(root) {
  const result = [];
  const visit = async (directory, prefix = "") => {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Release tree contains symlink: ${relative}`);
      if (stat.isDirectory()) await visit(absolute, relative);
      else if (stat.isFile()) result.push(relative);
      else throw new Error(`Release tree contains unsupported entry: ${relative}`);
    }
  };
  await visit(root);
  return result.sort();
}

async function rejectSymlinks(root) {
  await collectFiles(root);
}

async function assertFile(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error(`Expected file: ${file}`);
}

async function fileHash(file) {
  return crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

function valueAfter(tokens, flag) {
  const index = tokens.indexOf(flag);
  return index >= 0 ? tokens[index + 1] : undefined;
}
