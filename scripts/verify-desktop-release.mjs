import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import asar from "@electron/asar";

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const archiveArg = valueAfter(args, "--archive");
if (!archiveArg) throw new Error("Use --archive <Work Continuity.dmg|zip>.");
const archive = path.resolve(archiveArg);
const format = path.extname(archive).slice(1).toLowerCase();
if (format !== "zip" && format !== "dmg") throw new Error(`Unsupported desktop archive: ${archive}`);
const arch = valueAfter(args, "--arch") ?? archive.match(/macos-(arm64|x64)\.(?:zip|dmg)$/)?.[1];
if (arch !== "arm64" && arch !== "x64") throw new Error("Could not determine release architecture.");

const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
const version = packageJson.version;
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "work-continuity-desktop-release-"));
const mountPoint = path.join(temp, "mounted");
let mounted = false;

try {
  const root = await openArchive();
  const appBundle = await findAppBundle(root);
  const infoPlist = path.join(appBundle, "Contents", "Info.plist");
  const executable = path.join(appBundle, "Contents", "MacOS", "Work Continuity");
  const appAsar = path.join(appBundle, "Contents", "Resources", "app.asar");
  await Promise.all([assertFile(infoPlist), assertFile(executable), assertFile(appAsar)]);

  const [{ stdout: plistVersion }, { stdout: architectures }] = await Promise.all([
    execFileAsync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", infoPlist]),
    execFileAsync("/usr/bin/lipo", ["-archs", executable])
  ]);
  if (plistVersion.trim() !== version) throw new Error(`App version ${plistVersion.trim()} does not match package ${version}.`);
  const expectedArchitecture = arch === "x64" ? "x86_64" : "arm64";
  const actualArchitectures = architectures.trim().split(/\s+/);
  if (actualArchitectures.length !== 1 || actualArchitectures[0] !== expectedArchitecture) {
    throw new Error(`Wrong app architecture: ${architectures.trim()}`);
  }

  const files = new Set(asar.listPackage(appAsar));
  for (const required of ["/main.js", "/preload.cjs", "/renderer.js", "/renderer.css", "/index.html", "/app-icon.png"]) {
    if (!files.has(required)) throw new Error(`Packaged app is missing ${required}.`);
  }
  const main = asar.extractFile(appAsar, "main.js").toString("utf8");
  const preload = asar.extractFile(appAsar, "preload.cjs").toString("utf8");
  const renderer = asar.extractFile(appAsar, "renderer.js").toString("utf8");
  const rendererCss = asar.extractFile(appAsar, "renderer.css").toString("utf8");

  assertMarkers("main process", main, {
    "explicit daily-review preparation": ["desktop:prepare-daily-review"],
    "Traceink prompt profile": ["traceink-review-v1"],
    "frozen Traceink evidence": ["workline-evidence-manifest-v2", "transcriptCapture", "freezeCapturedPrefix"],
    "generation-preserving review store": ["packageGenerations", "activePackageGenerationId"],
    "generation-safe reflection and sealing": ["desktop:save-daily-draft", "desktop:seal-daily-page", "expectedActiveGenerationId"],
    "sealed evidence access": ["desktop:get-session-transcript", "sealed-package"]
  });
  assertStringLiterals("main process Today Board", main, ["raw", "compiled", "stale", "sealed"]);

  assertMarkers("preload bridge", preload, {
    "explicit daily-review preparation": ["prepareDailyReview", "desktop:prepare-daily-review"],
    "generation-safe reflection and sealing": ["saveDailyDraft", "desktop:save-daily-draft", "sealDailyPage", "desktop:seal-daily-page"]
  });

  assertMarkers("renderer", renderer, {
    "explicit daily-review preparation": ["prepareDailyReview"],
    "Today workline board": ["today-board", "today-worklines", "workline-participation"],
    "evidence reader": ["review-reader", "review-block-evidence"],
    "legacy mutable artifact disclosure": ["review-evidence-reference"],
    "generation-safe reflection and sealing": ["saveDailyDraft", "review-reflection", "review-seal", "expectedActiveGenerationId"]
  });
  assertStringLiterals("renderer Today Board", renderer, ["raw", "compiled", "stale", "sealed"]);
  assertMarkers("renderer stylesheet", rendererCss, {
    "Today workline board": [".today-board", ".today-worklines", ".workline-participation"],
    "evidence reader": [".review-reader", ".review-block-evidence"],
    "human reflection and sealing": [".review-reflection", ".review-seal"]
  });

  const checksumPath = `${archive}.sha256`;
  if (await exists(checksumPath)) {
    const expected = (await fs.readFile(checksumPath, "utf8")).trim().split(/\s+/)[0];
    if (expected !== await fileHash(archive)) throw new Error("Release checksum does not match archive.");
  }

  console.log(JSON.stringify({ ok: true, product: "Work Continuity", version, arch, format, archive, appBundle }, null, 2));
} finally {
  if (mounted) await execFileAsync("/usr/bin/hdiutil", ["detach", mountPoint], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  await fs.rm(temp, { recursive: true, force: true });
}

async function openArchive() {
  if (format === "zip") {
    const extracted = path.join(temp, "extracted");
    await fs.mkdir(extracted);
    await execFileAsync("/usr/bin/ditto", ["-x", "-k", archive, extracted], { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
    return extracted;
  }
  await fs.mkdir(mountPoint);
  await execFileAsync("/usr/bin/hdiutil", ["attach", archive, "-readonly", "-nobrowse", "-mountpoint", mountPoint], { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
  mounted = true;
  return mountPoint;
}

async function findAppBundle(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const bundle = entries.find((entry) => entry.isDirectory() && entry.name === "Work Continuity.app");
  if (!bundle) throw new Error(`Work Continuity.app was not found in ${root}.`);
  return path.join(root, bundle.name);
}

async function assertFile(file) {
  if (!(await fs.stat(file)).isFile()) throw new Error(`Expected file: ${file}`);
}

async function exists(file) {
  try { await fs.stat(file); return true; } catch (error) {
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

function assertMarkers(surface, source, groups) {
  for (const [contract, markers] of Object.entries(groups)) {
    const missing = markers.filter((marker) => !source.includes(marker));
    if (missing.length > 0) {
      throw new Error(`Packaged ${surface} is missing ${contract}: ${missing.join(", ")}.`);
    }
  }
}

function assertStringLiterals(surface, source, values) {
  const missing = values.filter((value) => !new RegExp(`(["'])${escapeRegExp(value)}\\1`).test(source));
  if (missing.length > 0) throw new Error(`Packaged ${surface} is missing states: ${missing.join(", ")}.`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
