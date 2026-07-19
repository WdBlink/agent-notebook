import fs from "node:fs/promises";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { tsImport } from "tsx/esm/api";

const { normalizeGlobalBoardDocument, validateSchemaTwoDocument } = await tsImport(
  "../src/whiteboard-model.ts",
  import.meta.url
);

const pluginId = "daily-cockpit";
const args = process.argv.slice(2);
const vault = parseVault(args);
const allowSchemaOne = args.includes("--allow-schema-one");
const repo = process.cwd();
const pluginDir = path.join(vault, ".obsidian", "plugins", pluginId);
const dataPath = path.join(pluginDir, "data.json");
const execFileAsync = promisify(execFile);
const activeRuntimeDir = await resolveActiveRuntime(path.join(pluginDir, "runtime"));
const required = ["manifest.json", "main.js", "styles.css", "data.json"];
const runtimeRequired = ["runtime-manifest.json", "pty-host.mjs", "process-membership", "node_modules/node-pty/package.json", "node_modules/node-pty/LICENSE", "node_modules/node-pty/build/Release/pty.node", "node_modules/node-pty/build/Release/spawn-helper"];

for (const file of required) {
  await assertFile(path.join(pluginDir, file));
}
for (const file of runtimeRequired) await assertFile(path.join(activeRuntimeDir, file));
for (const file of ["manifest.json", "main.js", "styles.css"]) {
  await assertSameHash(path.join(repo, file), path.join(pluginDir, file));
}
await assertSameHash(path.join(repo, "runtime", "pty-host.mjs"), path.join(activeRuntimeDir, "pty-host.mjs"));
await assertSameHash(path.join(repo, "runtime", "process-membership"), path.join(activeRuntimeDir, "process-membership"));
await assertSameHash(path.join(repo, "node_modules", "node-pty", "package.json"), path.join(activeRuntimeDir, "node_modules", "node-pty", "package.json"));
const nativeSource = path.join(repo, "node_modules", "node-pty", "prebuilds", `${process.platform}-${process.arch}`);
await assertSameHash(path.join(nativeSource, "pty.node"), path.join(activeRuntimeDir, "node_modules", "node-pty", "build", "Release", "pty.node"));
await assertSameHash(path.join(nativeSource, "spawn-helper"), path.join(activeRuntimeDir, "node_modules", "node-pty", "build", "Release", "spawn-helper"));
const helperMode = (await fs.stat(path.join(activeRuntimeDir, "node_modules", "node-pty", "build", "Release", "spawn-helper"))).mode;
if ((helperMode & 0o111) === 0) throw new Error("installed node-pty spawn-helper is not executable");
await assertPrunedRuntime(path.join(activeRuntimeDir, "node_modules", "node-pty"));
await verifyRuntimeManifest(activeRuntimeDir);

const manifest = JSON.parse(await fs.readFile(path.join(pluginDir, "manifest.json"), "utf8"));
if (manifest.id !== pluginId) {
  throw new Error(`manifest id mismatch: ${manifest.id}`);
}
if (manifest.isDesktopOnly !== true) {
  throw new Error("manifest must be desktop-only because local session scanning needs the desktop filesystem");
}

const installedMain = await fs.readFile(path.join(pluginDir, "main.js"), "utf8");
for (const snippet of ["refresh-work-sessions", "agent-whiteboard-view", ".codex/sessions", ".claude/projects", "workSessionSnapshot", "whiteboard", "targetDate"]) {
  if (!installedMain.includes(snippet)) {
    throw new Error(`installed main.js missing latest feature snippet: ${snippet}`);
  }
}

const enabled = JSON.parse(await fs.readFile(path.join(vault, ".obsidian", "community-plugins.json"), "utf8"));
if (!Array.isArray(enabled) || !enabled.includes(pluginId)) {
  throw new Error(`${pluginId} is not enabled in community-plugins.json`);
}

const dataBytesBefore = await fs.readFile(dataPath);
const data = JSON.parse(dataBytesBefore.toString("utf8"));
if (!data || data.schemaVersion !== 4 || !Array.isArray(data.plans)) {
  throw new Error("data.json does not contain CockpitData schemaVersion 4");
}
if (
  !Array.isArray(data.settings?.sessionScanRoots) ||
  !data.settings.sessionScanRoots.includes("~/.codex/sessions") ||
  !data.settings.sessionScanRoots.includes("~/.claude/projects")
) {
  throw new Error("data.json has not been migrated with latest sessionScanRoots");
}
if (
  !Array.isArray(data.settings.enabledSessionProviders) ||
  data.settings.enabledSessionProviders.some((provider) => !["codex", "claude"].includes(provider))
) {
  throw new Error("data.json has no valid enabledSessionProviders selection");
}
if (!data.workSessionSnapshot || !Array.isArray(data.workSessionSnapshot.sessions)) {
  throw new Error("data.json has not been migrated with workSessionSnapshot");
}
if (!Number.isSafeInteger(data.whiteboardRevision) || data.whiteboardRevision < 0) {
  throw new Error("data.json has no valid whiteboardRevision");
}
assertNoPersistedRuntimeTruth(data.whiteboard);
const whiteboard = verifyWhiteboard(data.whiteboard, allowSchemaOne);
const runtimeSmoke = await smokeInstalledRuntime(data.settings.runtimeNodePath, path.join(activeRuntimeDir, "pty-host.mjs"));
const dataBytesAfter = await fs.readFile(dataPath);
if (!dataBytesBefore.equals(dataBytesAfter)) throw new Error("verify-local must not modify data.json");

console.log(
  JSON.stringify(
    {
      ok: true,
      pluginDir,
      enabled: true,
      installedMatchesRepo: true,
      nativeRuntime: `${process.platform}-${process.arch}`,
      runtimeSmoke,
      hasLatestSessionFields: true,
      whiteboardSchemaVersion: whiteboard.schemaVersion,
      frameCount: whiteboard.frameCount,
      nodeCount: whiteboard.nodeCount,
      planCount: data.plans.length,
      taskCount: data.plans.reduce((count, plan) => count + (Array.isArray(plan.tasks) ? plan.tasks.length : 0), 0)
    },
    null,
    2
  )
);

function verifyWhiteboard(whiteboard, schemaOneAllowed) {
  if (!whiteboard || typeof whiteboard !== "object") {
    throw new Error("data.json has no valid whiteboard state");
  }
  if (whiteboard.schemaVersion === 2) {
    const validated = validateSchemaTwoDocument(whiteboard);
    return { schemaVersion: 2, frameCount: validated.projects.length, nodeCount: validated.nodes.length };
  }
  if (schemaOneAllowed && Array.isArray(whiteboard.projects) && whiteboard.boards && typeof whiteboard.boards === "object") {
    normalizeGlobalBoardDocument(whiteboard);
    const nodeCount = Object.values(whiteboard.boards).reduce(
      (count, board) => count + (Array.isArray(board?.nodes) ? board.nodes.length : 0),
      0
    );
    return { schemaVersion: 1, frameCount: whiteboard.projects.length, nodeCount };
  }
  throw new Error("data.json whiteboard must be schema two after plugin restart");
}

async function resolveActiveRuntime(runtimeRoot) {
  const pointerPath = path.join(runtimeRoot, "active.json");
  const pointerStat = await fs.lstat(pointerPath);
  if (!pointerStat.isFile() || pointerStat.isSymbolicLink()) throw new Error("installed runtime pointer is unsafe");
  const pointer = JSON.parse(await fs.readFile(pointerPath, "utf8"));
  if (typeof pointer?.version !== "string" || !/^runtime-[a-f0-9]{24}$/.test(pointer.version)) {
    throw new Error("installed runtime pointer is invalid");
  }
  const active = path.join(runtimeRoot, "versions", pointer.version);
  const relative = path.relative(path.join(runtimeRoot, "versions"), active);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("installed runtime pointer escapes versions directory");
  return active;
}

function assertNoPersistedRuntimeTruth(whiteboard) {
  if (containsKey(whiteboard, "scrollback")) throw new Error("data.json must not persist terminal scrollback");
  if (!Array.isArray(whiteboard?.nodes)) return;
  for (const node of whiteboard.nodes) {
    if (node?.kind === "terminal" && node.runtimeId !== null) throw new Error("persisted terminal runtimeId must be null");
    if (node?.kind === "agent" && node.runtimeState !== "exited") throw new Error("persisted agent runtimeState must be exited");
  }
}

function containsKey(value, key) {
  if (!value || typeof value !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  return Object.values(value).some((entry) => containsKey(entry, key));
}

async function assertPrunedRuntime(packageDir) {
  const rootEntries = (await fs.readdir(packageDir)).sort();
  if (JSON.stringify(rootEntries) !== JSON.stringify(["LICENSE", "build", "lib", "package.json"])) {
    throw new Error(`installed node-pty runtime is not pruned: ${rootEntries.join(", ")}`);
  }
  const releaseEntries = (await fs.readdir(path.join(packageDir, "build", "Release"))).sort();
  if (JSON.stringify(releaseEntries) !== JSON.stringify(["pty.node", "spawn-helper"])) {
    throw new Error(`installed node-pty native runtime is not pruned: ${releaseEntries.join(", ")}`);
  }
}

async function verifyRuntimeManifest(runtimeDir) {
  const manifest = JSON.parse(await fs.readFile(path.join(runtimeDir, "runtime-manifest.json"), "utf8"));
  if (manifest?.version !== 1 || !Array.isArray(manifest.files)) throw new Error("installed runtime manifest is invalid");
  const actual = await collectRuntimeFiles(runtimeDir);
  const expected = manifest.files.map((entry) => entry.path).sort();
  if (JSON.stringify(actual.filter((entry) => entry !== "runtime-manifest.json")) !== JSON.stringify(expected)) {
    throw new Error("installed runtime has missing or unexpected entries");
  }
  for (const entry of manifest.files) {
    const file = path.join(runtimeDir, entry.path);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`installed runtime entry is not a regular file: ${entry.path}`);
    const digest = await fileHash(file);
    if (digest !== entry.sha256 || (stat.mode & 0o777) !== entry.mode) throw new Error(`installed runtime manifest mismatch: ${entry.path}`);
  }
}

async function collectRuntimeFiles(root) {
  const result = [];
  const visit = async (directory, prefix = "") => {
    const directoryStat = await fs.lstat(directory);
    if (directoryStat.isSymbolicLink()) throw new Error(`installed runtime contains symlink: ${directory}`);
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error(`installed runtime contains symlink: ${relative}`);
      if (stat.isDirectory()) await visit(absolute, relative);
      else if (stat.isFile()) result.push(relative);
      else throw new Error(`installed runtime contains non-regular entry: ${relative}`);
    }
  };
  await visit(root);
  return result.sort();
}

async function smokeInstalledRuntime(nodePath, hostPath) {
  const command = path.isAbsolute(nodePath) ? nodePath : "/usr/bin/env";
  const args = path.isAbsolute(nodePath)
    ? [path.join(repo, "scripts", "test-runtime-host.mjs"), "--host", hostPath]
    : [nodePath, path.join(repo, "scripts", "test-runtime-host.mjs"), "--host", hostPath];
  const environment = allowedSmokeEnvironment(process.env);
  const { stdout } = await execFileAsync(command, args, {
    cwd: repo,
    env: environment,
    timeout: 30_000,
    maxBuffer: 1024 * 1024
  });
  const result = JSON.parse(stdout);
  if (result?.ok !== true) throw new Error("installed runtime smoke did not report success");
  return { ok: true, hostPid: result.hostPid, runtimes: result.runtimes.length };
}

function allowedSmokeEnvironment(source) {
  const result = {};
  for (const key of ["HOME", "USER", "LOGNAME", "SHELL", "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TMP", "TEMP"]) {
    if (typeof source[key] === "string") result[key] = source[key];
  }
  result.PATH = Array.from(new Set([
    ...(result.PATH ?? "").split(":").filter(Boolean),
    result.HOME ? `${result.HOME.replace(/\/$/, "")}/.local/bin` : "",
    "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"
  ].filter(Boolean))).join(":");
  return result;
}

function parseVault(args) {
  const index = args.indexOf("--vault");
  const value = index >= 0 ? args[index + 1] : process.env.OBSIDIAN_VAULT;
  if (!value) {
    throw new Error('Missing vault path. Use: npm run verify:local -- --vault "$HOME/Knowledge/Obsidian"');
  }
  return path.resolve(value);
}

async function assertFile(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error(`Expected file: ${file}`);
}

async function assertSameHash(source, target) {
  const [sourceHash, targetHash] = await Promise.all([fileHash(source), fileHash(target)]);
  if (sourceHash !== targetHash) {
    throw new Error(`installed file is stale: ${target} does not match ${source}`);
  }
}

async function fileHash(file) {
  const bytes = await fs.readFile(file);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
