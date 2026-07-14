import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";

const pluginId = "daily-cockpit";
const vault = parseVault(process.argv.slice(2));
const repo = process.cwd();
const pluginDir = path.join(vault, ".obsidian", "plugins", pluginId);
const required = ["manifest.json", "main.js", "styles.css", "data.json"];

for (const file of required) {
  await assertFile(path.join(pluginDir, file));
}
for (const file of ["manifest.json", "main.js", "styles.css"]) {
  await assertSameHash(path.join(repo, file), path.join(pluginDir, file));
}

const manifest = JSON.parse(await fs.readFile(path.join(pluginDir, "manifest.json"), "utf8"));
if (manifest.id !== pluginId) {
  throw new Error(`manifest id mismatch: ${manifest.id}`);
}
if (manifest.isDesktopOnly !== true) {
  throw new Error("manifest must be desktop-only because local session scanning needs the desktop filesystem");
}

const installedMain = await fs.readFile(path.join(pluginDir, "main.js"), "utf8");
for (const snippet of ["refresh-work-sessions", ".codex/sessions", ".claude/projects", "workSessionSnapshot", "targetDate"]) {
  if (!installedMain.includes(snippet)) {
    throw new Error(`installed main.js missing latest feature snippet: ${snippet}`);
  }
}

const enabled = JSON.parse(await fs.readFile(path.join(vault, ".obsidian", "community-plugins.json"), "utf8"));
if (!Array.isArray(enabled) || !enabled.includes(pluginId)) {
  throw new Error(`${pluginId} is not enabled in community-plugins.json`);
}

const data = JSON.parse(await fs.readFile(path.join(pluginDir, "data.json"), "utf8"));
if (!data || data.schemaVersion !== 3 || !Array.isArray(data.plans)) {
  throw new Error("data.json does not contain CockpitData schemaVersion 3");
}
if (
  !Array.isArray(data.settings?.sessionScanRoots) ||
  !data.settings.sessionScanRoots.includes("~/.codex/sessions") ||
  !data.settings.sessionScanRoots.includes("~/.claude/projects")
) {
  throw new Error("data.json has not been migrated with latest sessionScanRoots");
}
if (!data.workSessionSnapshot || !Array.isArray(data.workSessionSnapshot.sessions)) {
  throw new Error("data.json has not been migrated with workSessionSnapshot");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      pluginDir,
      enabled: true,
      installedMatchesRepo: true,
      hasLatestSessionFields: true,
      planCount: data.plans.length,
      taskCount: data.plans.reduce((count, plan) => count + (Array.isArray(plan.tasks) ? plan.tasks.length : 0), 0)
    },
    null,
    2
  )
);

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
