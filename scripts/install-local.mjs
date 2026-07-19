import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import { tsImport } from "tsx/esm/api";

const { normalizeGlobalBoardDocument, validateSchemaTwoDocument } = await tsImport(
  "../src/whiteboard-model.ts",
  import.meta.url
);

const pluginId = "daily-cockpit";
const defaultSessionScanRoots = [
  "~/.codex/sessions",
  "~/.codex/archived_sessions",
  "~/.claude/projects"
];
const retiredSessionScanRoots = ["~/.codex/memories/rollout_summaries", "~/.claude/tasks", "~/.minimax/plans"];
const supportedSessionProviders = ["codex", "claude"];

const vault = parseVault(process.argv.slice(2));
const repo = process.cwd();
const pluginDir = path.join(vault, ".obsidian", "plugins", pluginId);
const dataPath = path.join(pluginDir, "data.json");
const runtimeSource = path.join(repo, "runtime", "pty-host.mjs");
const membershipHelperSource = path.join(repo, "runtime", "process-membership");
const nodePtySource = path.join(repo, "node_modules", "node-pty");
const nativeSource = path.join(nodePtySource, "prebuilds", `${process.platform}-${process.arch}`);

await prepareSafeDestination();
await assertFile(path.join(repo, "main.js"));
await assertFile(path.join(repo, "styles.css"));
await assertFile(path.join(repo, "manifest.json"));
await assertFile(runtimeSource);
await assertFile(membershipHelperSource);
await assertFile(path.join(nodePtySource, "package.json"));
await assertFile(path.join(nativeSource, "pty.node"));
await assertFile(path.join(nativeSource, "spawn-helper"));
const preparedData = await prepareData(dataPath);
const pluginConfig = await readPluginConfig(vault);

await installNativeRuntime();
await copyDestinationFile(path.join(repo, "main.js"), path.join(pluginDir, "main.js"));
await copyDestinationFile(path.join(repo, "styles.css"), path.join(pluginDir, "styles.css"));
await copyDestinationFile(path.join(repo, "manifest.json"), path.join(pluginDir, "manifest.json"));

const seedData = () => ({
  schemaVersion: 4,
  settings: {
    dailyNoteFolder: "Daily Cockpit",
    llmEndpoint: "http://127.0.0.1:11434/v1/chat/completions",
    llmModel: "qwen2.5:7b",
    llmApiKey: "",
    sessionScanRoots: defaultSessionScanRoots,
    enabledSessionProviders: supportedSessionProviders,
    sessionSummaryMode: "native",
    runtimeNodePath: "node",
    codexCliPath: "codex",
    claudeCliPath: "claude"
  },
  workSessionSnapshot: emptyWorkSessionSnapshot(),
  whiteboard: {
    schemaVersion: 2,
    viewport: { x: 80, y: 72, zoom: 1 },
    projects: [],
    nodes: [],
    edges: [],
    console: { provider: "codex" }
  },
  whiteboardRevision: 0,
  activePlanId: "local-smoke-plan",
  plans: [
    {
      id: "local-smoke-plan",
      intent: "明天研究一个项目，先让模型拆出可执行待办。",
      targetDate: nextDate(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: "install-local",
      source: "install-local",
      tasks: [
        {
          id: "local-smoke-task-a",
          title: "确认本地模型配置",
          detail: "检查 endpoint 和 model 是否指向本机大模型服务。",
          category: "admin",
          priority: "P0",
          completed: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    }
  ]
});

if (preparedData.kind === "missing") {
  await writeJsonAtomic(dataPath, seedData());
} else if (preparedData.kind === "migrate") {
  await backupOnce(dataPath, `${dataPath}.pre-agent-sessions.bak`);
  await writeJsonAtomic(dataPath, preparedData.data);
}

await enablePlugin(pluginConfig, pluginId);

console.log(`Installed ${pluginId} to ${pluginDir}`);

function parseVault(args) {
  const index = args.indexOf("--vault");
  const value = index >= 0 ? args[index + 1] : process.env.OBSIDIAN_VAULT;
  if (!value) {
    throw new Error('Missing vault path. Use: npm run install:local -- --vault "$HOME/Knowledge/Obsidian"');
  }
  return path.resolve(value);
}

function migrateData(data) {
  const settings = data.settings && typeof data.settings === "object" ? data.settings : {};
  const roots = Array.isArray(settings.sessionScanRoots)
    ? Array.from(
        new Set([
          ...settings.sessionScanRoots.filter(
            (root) => typeof root === "string" && root.trim() && !retiredSessionScanRoots.includes(root)
          ),
          ...defaultSessionScanRoots
        ])
      )
    : defaultSessionScanRoots;
  const enabledSessionProviders = Array.isArray(settings.enabledSessionProviders)
    ? Array.from(new Set(settings.enabledSessionProviders.filter((provider) => supportedSessionProviders.includes(provider))))
    : supportedSessionProviders;
  return {
    ...data,
    schemaVersion: 4,
    settings: {
      dailyNoteFolder: typeof settings.dailyNoteFolder === "string" && settings.dailyNoteFolder.trim() ? settings.dailyNoteFolder : "Daily Cockpit",
      llmEndpoint:
        typeof settings.llmEndpoint === "string" && settings.llmEndpoint.trim()
          ? settings.llmEndpoint
          : "http://127.0.0.1:11434/v1/chat/completions",
      llmModel: typeof settings.llmModel === "string" && settings.llmModel.trim() ? settings.llmModel : "qwen2.5:7b",
      llmApiKey: typeof settings.llmApiKey === "string" ? settings.llmApiKey : "",
      sessionScanRoots: roots,
      enabledSessionProviders,
      sessionSummaryMode: settings.sessionSummaryMode === "metadata" ? "metadata" : "native",
      runtimeNodePath: typeof settings.runtimeNodePath === "string" && settings.runtimeNodePath.trim() ? settings.runtimeNodePath : "node",
      codexCliPath: typeof settings.codexCliPath === "string" && settings.codexCliPath.trim() ? settings.codexCliPath : "codex",
      claudeCliPath: typeof settings.claudeCliPath === "string" && settings.claudeCliPath.trim() ? settings.claudeCliPath : "claude"
    },
    workSessionSnapshot: normalizeSnapshot(data.workSessionSnapshot),
    whiteboard: normalizeWhiteboard(data.whiteboard),
    whiteboardRevision: normalizeWhiteboardRevision(data.whiteboardRevision),
    plans: data.plans.map(normalizePlan).filter(Boolean)
  };
}

function normalizeWhiteboardRevision(value) {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Refusing to rewrite data.json with invalid whiteboardRevision");
  }
  return value;
}

async function prepareData(file) {
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { kind: "missing" };
    throw error;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Refusing to rewrite malformed data.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!data || typeof data !== "object" || ![2, 3, 4].includes(data.schemaVersion) || !Array.isArray(data.plans)) {
    throw new Error("Refusing to repair malformed outer data.json; existing whiteboard must remain untouched");
  }
  validatePreservedWhiteboard(data.whiteboard);
  const migrated = migrateData(data);
  return JSON.stringify(migrated) === JSON.stringify(data)
    ? { kind: "unchanged" }
    : { kind: "migrate", data: migrated };
}

function normalizeWhiteboard(whiteboard) {
  if (whiteboard === undefined) {
    return {
      schemaVersion: 2,
      viewport: { x: 80, y: 72, zoom: 1 },
      projects: [],
      nodes: [],
      edges: [],
      console: { provider: "codex" }
    };
  }
  validatePreservedWhiteboard(whiteboard);
  return whiteboard && typeof whiteboard === "object" && whiteboard.schemaVersion === 2
    ? validateSchemaTwoDocument(whiteboard)
    : whiteboard;
}

async function installNativeRuntime() {
  const runtimeDir = path.join(pluginDir, "runtime");
  await assertTreeHasNoSymlinks(runtimeDir, true);
  const suffix = `${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
  const stageDir = path.join(pluginDir, `.runtime-stage-${suffix}`);
  const packageDir = path.join(stageDir, "node_modules", "node-pty");
  const releaseDir = path.join(packageDir, "build", "Release");
  try {
    await fs.mkdir(releaseDir, { recursive: true });
    await fs.copyFile(runtimeSource, path.join(stageDir, "pty-host.mjs"));
    await fs.copyFile(membershipHelperSource, path.join(stageDir, "process-membership"));
    await fs.chmod(path.join(stageDir, "process-membership"), 0o755);
    await fs.copyFile(path.join(nodePtySource, "package.json"), path.join(packageDir, "package.json"));
    await fs.copyFile(path.join(nodePtySource, "LICENSE"), path.join(packageDir, "LICENSE"));
    await fs.cp(path.join(nodePtySource, "lib"), path.join(packageDir, "lib"), { recursive: true, force: false, dereference: true });
    await fs.copyFile(path.join(nativeSource, "pty.node"), path.join(releaseDir, "pty.node"));
    await fs.copyFile(path.join(nativeSource, "spawn-helper"), path.join(releaseDir, "spawn-helper"));
    await fs.chmod(path.join(releaseDir, "spawn-helper"), 0o755);
    await writeRuntimeManifest(stageDir);
    await validateRuntimeStage(stageDir);
    const manifestHash = crypto.createHash("sha256")
      .update(await fs.readFile(path.join(stageDir, "runtime-manifest.json")))
      .digest("hex")
      .slice(0, 24);
    const version = `runtime-${manifestHash}`;
    const versionsDir = path.join(runtimeDir, "versions");
    const versionDir = path.join(versionsDir, version);
    await fs.mkdir(versionsDir, { recursive: true });
    await assertNotSymlink(versionsDir);
    if (await pathExists(versionDir)) await removeOwnedTree(stageDir);
    else await fs.rename(stageDir, versionDir);
    const pointerTemp = path.join(runtimeDir, `.active-${suffix}.json`);
    await fs.writeFile(pointerTemp, `${JSON.stringify({ version })}\n`, { flag: "wx" });
    await fs.rename(pointerTemp, path.join(runtimeDir, "active.json"));
  } finally {
    await removeOwnedTree(stageDir);
  }
}

async function prepareSafeDestination() {
  await fs.mkdir(vault, { recursive: true });
  await assertNotSymlink(vault);
  const canonicalVault = await fs.realpath(vault);
  const directories = [
    path.join(vault, ".obsidian"),
    path.join(vault, ".obsidian", "plugins"),
    pluginDir
  ];
  for (const directory of directories) {
    await assertNotSymlink(directory, true);
    if (!await pathExists(directory)) await fs.mkdir(directory);
    await assertNotSymlink(directory);
    const canonical = await fs.realpath(directory);
    assertContained(canonicalVault, canonical);
  }
  for (const destination of [
    dataPath,
    `${dataPath}.tmp`,
    `${dataPath}.pre-agent-sessions.bak`,
    path.join(pluginDir, "main.js"),
    path.join(pluginDir, "styles.css"),
    path.join(pluginDir, "manifest.json"),
    path.join(vault, ".obsidian", "community-plugins.json"),
    path.join(vault, ".obsidian", "community-plugins.json.tmp"),
    path.join(vault, ".obsidian", "community-plugins.json.bak")
  ]) await assertNotSymlink(destination, true);
}

async function copyDestinationFile(source, destination) {
  assertContained(pluginDir, destination);
  await assertNotSymlink(destination, true);
  await fs.copyFile(source, destination);
  await assertNotSymlink(destination);
}

async function writeRuntimeManifest(runtimeDir) {
  const entries = await collectRegularFiles(runtimeDir);
  const manifest = { version: 1, files: [] };
  for (const relativePath of entries) {
    const absolutePath = path.join(runtimeDir, relativePath);
    const stat = await fs.lstat(absolutePath);
    manifest.files.push({
      path: relativePath,
      sha256: crypto.createHash("sha256").update(await fs.readFile(absolutePath)).digest("hex"),
      mode: stat.mode & 0o777
    });
  }
  await fs.writeFile(path.join(runtimeDir, "runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
}

async function validateRuntimeStage(runtimeDir) {
  await assertTreeHasNoSymlinks(runtimeDir, false);
  const manifestPath = path.join(runtimeDir, "runtime-manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const actual = await collectRegularFiles(runtimeDir);
  const expected = manifest.files.map((entry) => entry.path).sort();
  const withoutManifest = actual.filter((entry) => entry !== "runtime-manifest.json");
  if (JSON.stringify(withoutManifest) !== JSON.stringify(expected)) throw new Error("Runtime staging manifest is incomplete.");
  for (const entry of manifest.files) {
    const file = path.join(runtimeDir, entry.path);
    const stat = await fs.lstat(file);
    const digest = crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
    if (!stat.isFile() || digest !== entry.sha256 || (stat.mode & 0o777) !== entry.mode) {
      throw new Error(`Runtime staging manifest mismatch: ${entry.path}`);
    }
  }
}

async function collectRegularFiles(root) {
  const result = [];
  const visit = async (directory, prefix = "") => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      const stat = await fs.lstat(absolutePath);
      if (stat.isSymbolicLink()) throw new Error(`Refusing symlink in runtime tree: ${absolutePath}`);
      if (stat.isDirectory()) await visit(absolutePath, relativePath);
      else if (stat.isFile()) result.push(relativePath);
      else throw new Error(`Refusing non-regular runtime entry: ${absolutePath}`);
    }
  };
  await visit(root);
  return result.sort();
}

async function assertTreeHasNoSymlinks(root, allowMissing) {
  if (!await pathExists(root)) {
    if (allowMissing) return;
    throw new Error(`Missing runtime tree: ${root}`);
  }
  const stat = await fs.lstat(root);
  if (stat.isSymbolicLink()) throw new Error(`Refusing symlink destination: ${root}`);
  if (!stat.isDirectory()) throw new Error(`Runtime destination is not a directory: ${root}`);
  await collectRegularFiles(root);
}

async function removeOwnedTree(target) {
  if (!await pathExists(target)) return;
  await assertTreeHasNoSymlinks(target, false);
  await fs.rm(target, { recursive: true, force: true });
}

async function assertNotSymlink(target, allowMissing = false) {
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink destination: ${target}`);
  } catch (error) {
    if (allowMissing && isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
}

function assertContained(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Destination escapes vault/plugin containment: ${target}`);
}

async function pathExists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function validatePreservedWhiteboard(whiteboard) {
  if (whiteboard === undefined) return;
  try {
    if (whiteboard && typeof whiteboard === "object" && whiteboard.schemaVersion === 2) {
      validateSchemaTwoDocument(whiteboard);
    } else {
      normalizeGlobalBoardDocument(whiteboard);
    }
  } catch (error) {
    throw new Error(`Refusing to rewrite data.json with malformed whiteboard input: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizePlan(plan) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.tasks)) return null;
  const createdAt = typeof plan.createdAt === "string" ? plan.createdAt : new Date().toISOString();
  return {
    id: typeof plan.id === "string" ? plan.id : `plan-${Date.now()}`,
    intent: typeof plan.intent === "string" ? plan.intent : "",
    targetDate: /^\d{4}-\d{2}-\d{2}$/.test(plan.targetDate ?? "") ? plan.targetDate : nextDate(new Date(createdAt)),
    createdAt,
    updatedAt: typeof plan.updatedAt === "string" ? plan.updatedAt : createdAt,
    tasks: plan.tasks.map(normalizeTask).filter(Boolean),
    ...(typeof plan.model === "string" ? { model: plan.model } : {}),
    ...(typeof plan.source === "string" ? { source: plan.source } : {})
  };
}

function normalizeTask(task) {
  if (!task || typeof task !== "object" || typeof task.title !== "string") return null;
  const createdAt = typeof task.createdAt === "string" ? task.createdAt : new Date().toISOString();
  return {
    id: typeof task.id === "string" ? task.id : `task-${Date.now()}`,
    title: task.title,
    detail: typeof task.detail === "string" ? task.detail : task.title,
    category: typeof task.category === "string" ? task.category : "other",
    priority: typeof task.priority === "string" ? task.priority : "P1",
    completed: task.completed === true,
    createdAt,
    updatedAt: typeof task.updatedAt === "string" ? task.updatedAt : createdAt
  };
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.sessions)) {
    return emptyWorkSessionSnapshot();
  }
  return {
    date: typeof snapshot.date === "string" && snapshot.date.trim() ? snapshot.date : previousDate(),
    generatedAt: typeof snapshot.generatedAt === "string" && snapshot.generatedAt.trim() ? snapshot.generatedAt : new Date().toISOString(),
    sessions: snapshot.sessions,
    sources: Array.isArray(snapshot.sources) ? snapshot.sources.filter((source) => typeof source === "string") : [],
    warnings: Array.isArray(snapshot.warnings) ? snapshot.warnings.filter((warning) => typeof warning === "string").slice(0, 8) : []
  };
}

function emptyWorkSessionSnapshot() {
  return {
    date: previousDate(),
    generatedAt: new Date().toISOString(),
    sessions: [],
    sources: [],
    warnings: []
  };
}

function previousDate() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function nextDate(now = new Date()) {
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function writeJsonAtomic(file, value) {
  const tempPath = `${file}.tmp`;
  await assertNotSymlink(file, true);
  await assertNotSymlink(tempPath, true);
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tempPath, file);
}

async function backupOnce(source, target) {
  await assertNotSymlink(source);
  await assertNotSymlink(target, true);
  try {
    await fs.access(target);
  } catch {
    await fs.copyFile(source, target);
  }
}

async function assertFile(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error(`Expected file: ${file}`);
}

async function readPluginConfig(vaultPath) {
  const configDir = path.join(vaultPath, ".obsidian");
  await fs.mkdir(configDir, { recursive: true });
  const configPath = path.join(configDir, "community-plugins.json");
  await assertNotSymlink(configPath, true);
  let plugins = [];
  let configExists = false;
  try {
    const raw = await fs.readFile(configPath, "utf8");
    configExists = true;
    plugins = JSON.parse(raw);
    if (!Array.isArray(plugins)) {
      throw new Error(`${configPath} must contain a JSON array`);
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      plugins = [];
    } else {
      throw new Error(`Refusing to rewrite malformed community-plugins.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!plugins.every((plugin) => typeof plugin === "string")) {
    throw new Error(`${configPath} must contain only plugin id strings`);
  }

  return { configPath, configExists, plugins };
}

async function enablePlugin(config, id) {
  const { configPath, configExists, plugins } = config;
  if (!plugins.includes(id)) {
    plugins.push(id);
    if (configExists) {
      await assertNotSymlink(`${configPath}.bak`, true);
      await fs.copyFile(configPath, `${configPath}.bak`);
    }
    const tempPath = `${configPath}.tmp`;
    await assertNotSymlink(tempPath, true);
    await fs.writeFile(tempPath, `${JSON.stringify(plugins, null, 2)}\n`);
    await fs.rename(tempPath, configPath);
  }
}

function isNodeError(error) {
  return Boolean(error && typeof error === "object" && "code" in error);
}
