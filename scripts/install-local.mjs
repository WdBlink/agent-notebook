import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const pluginId = "daily-cockpit";

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
try {
  await fs.access(dataPath);
} catch {
  await fs.writeFile(
    dataPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        settings: { dailyNoteFolder: "Daily Cockpit", todayLimit: 5 },
        items: [
          {
            id: "local-smoke-a",
            title: "本地 Obsidian 冒烟测试",
            body: "这条记录用于确认插件安装目录、data.json 和每日导出都在本地 vault 内。",
            state: "inbox",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            context: "install-local"
          }
        ]
      },
      null,
      2
    )
  );
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
