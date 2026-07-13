import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const pluginId = "daily-cockpit";
const defaultSessionScanRoots = [
  "~/.codex/sessions",
  "~/.codex/archived_sessions",
  "~/.claude/projects",
  "~/.minimax/plans"
];

const vault = parseVault(process.argv.slice(2));
const repo = process.cwd();
const pluginDir = path.join(vault, ".obsidian", "plugins", pluginId);
const pluginConfig = await readPluginConfig(vault);

await assertFile(path.join(repo, "main.js"));
await assertFile(path.join(repo, "styles.css"));
await assertFile(path.join(repo, "manifest.json"));

await fs.mkdir(pluginDir, { recursive: true });
await fs.copyFile(path.join(repo, "main.js"), path.join(pluginDir, "main.js"));
await fs.copyFile(path.join(repo, "styles.css"), path.join(pluginDir, "styles.css"));
await fs.copyFile(path.join(repo, "manifest.json"), path.join(pluginDir, "manifest.json"));

const dataPath = path.join(pluginDir, "data.json");
const seedData = () => ({
  schemaVersion: 2,
  settings: {
    dailyNoteFolder: "Daily Cockpit",
    llmEndpoint: "http://127.0.0.1:11434/v1/chat/completions",
    llmModel: "qwen2.5:7b",
    llmApiKey: "",
    sessionScanRoots: defaultSessionScanRoots,
    sessionSummaryMode: "native",
    codexCliPath: "codex",
    claudeCliPath: "claude"
  },
  workSessionSnapshot: emptyWorkSessionSnapshot(),
  activePlanId: "local-smoke-plan",
  plans: [
    {
      id: "local-smoke-plan",
      intent: "明天研究一个项目，先让模型拆出待办，再选几条适合热启动。",
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
          warmStart: "启动本地模型服务并跑一次待办拆解。",
          selectedForHotStart: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    }
  ]
});

try {
  const raw = await fs.readFile(dataPath, "utf8");
  const data = JSON.parse(raw);
  if (!data || data.schemaVersion !== 2 || !Array.isArray(data.plans)) {
    await fs.copyFile(dataPath, `${dataPath}.v1.bak`);
    await fs.writeFile(dataPath, JSON.stringify(seedData(), null, 2));
  } else {
    const migrated = migrateData(data);
    if (JSON.stringify(migrated) !== JSON.stringify(data)) {
      await backupOnce(dataPath, `${dataPath}.pre-agent-sessions.bak`);
      await writeJsonAtomic(dataPath, migrated);
    }
  }
} catch {
  await writeJsonAtomic(dataPath, seedData());
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
    ? Array.from(new Set([...settings.sessionScanRoots.filter((root) => typeof root === "string" && root.trim()), ...defaultSessionScanRoots]))
    : defaultSessionScanRoots;
  return {
    ...data,
    schemaVersion: 2,
    settings: {
      dailyNoteFolder: typeof settings.dailyNoteFolder === "string" && settings.dailyNoteFolder.trim() ? settings.dailyNoteFolder : "Daily Cockpit",
      llmEndpoint:
        typeof settings.llmEndpoint === "string" && settings.llmEndpoint.trim()
          ? settings.llmEndpoint
          : "http://127.0.0.1:11434/v1/chat/completions",
      llmModel: typeof settings.llmModel === "string" && settings.llmModel.trim() ? settings.llmModel : "qwen2.5:7b",
      llmApiKey: typeof settings.llmApiKey === "string" ? settings.llmApiKey : "",
      sessionScanRoots: roots,
      sessionSummaryMode: settings.sessionSummaryMode === "metadata" ? "metadata" : "native",
      codexCliPath: typeof settings.codexCliPath === "string" && settings.codexCliPath.trim() ? settings.codexCliPath : "codex",
      claudeCliPath: typeof settings.claudeCliPath === "string" && settings.claudeCliPath.trim() ? settings.claudeCliPath : "claude"
    },
    workSessionSnapshot: normalizeSnapshot(data.workSessionSnapshot)
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

async function writeJsonAtomic(file, value) {
  const tempPath = `${file}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tempPath, file);
}

async function backupOnce(source, target) {
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
      await fs.copyFile(configPath, `${configPath}.bak`);
    }
    const tempPath = `${configPath}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(plugins, null, 2)}\n`);
    await fs.rename(tempPath, configPath);
  }
}

function isNodeError(error) {
  return Boolean(error && typeof error === "object" && "code" in error);
}
