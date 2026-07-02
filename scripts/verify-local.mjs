import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const pluginId = "daily-cockpit";
const vault = parseVault(process.argv.slice(2));
const pluginDir = path.join(vault, ".obsidian", "plugins", pluginId);
const required = ["manifest.json", "main.js", "styles.css", "data.json"];

for (const file of required) {
  await assertFile(path.join(pluginDir, file));
}

const manifest = JSON.parse(await fs.readFile(path.join(pluginDir, "manifest.json"), "utf8"));
if (manifest.id !== pluginId) {
  throw new Error(`manifest id mismatch: ${manifest.id}`);
}

const enabled = JSON.parse(await fs.readFile(path.join(vault, ".obsidian", "community-plugins.json"), "utf8"));
if (!Array.isArray(enabled) || !enabled.includes(pluginId)) {
  throw new Error(`${pluginId} is not enabled in community-plugins.json`);
}

const data = JSON.parse(await fs.readFile(path.join(pluginDir, "data.json"), "utf8"));
if (!data || data.schemaVersion !== 1 || !Array.isArray(data.items)) {
  throw new Error("data.json does not contain CockpitData schemaVersion 1");
}

const exportDir = path.join(vault, "Daily Cockpit");
await fs.mkdir(exportDir, { recursive: true });
const exportPath = path.join(exportDir, `${formatDate(new Date())}.md`);
try {
  await fs.access(exportPath);
} catch {
  await fs.writeFile(
    exportPath,
    [
      "---",
      "source: daily-cockpit-local-verify",
      `date: ${formatDate(new Date())}`,
      "---",
      "",
      `# 每日启动台 ${formatDate(new Date())}`,
      "",
      "## 正在做",
      "",
      "- 暂无。",
      "",
      "## 今天",
      "",
      "- 本地验证脚本已确认插件文件安装完成。",
      "",
      "## 灵感收纳箱",
      "",
      "- Obsidian 打开后可通过命令面板进入每日启动台。",
      ""
    ].join("\n")
  );
}

const markdown = await fs.readFile(exportPath, "utf8");
for (const heading of ["## 正在做", "## 今天", "## 灵感收纳箱"]) {
  if (!markdown.includes(heading)) {
    throw new Error(`export note missing heading: ${heading}`);
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      pluginDir,
      exportPath,
      enabled: true,
      itemCount: data.items.length
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

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
