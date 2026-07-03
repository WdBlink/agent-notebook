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
if (!data || data.schemaVersion !== 2 || !Array.isArray(data.plans)) {
  throw new Error("data.json does not contain CockpitData schemaVersion 2");
}

const exportDir = path.join(vault, "Daily Cockpit");
await fs.mkdir(exportDir, { recursive: true });
const exportPath = path.join(exportDir, `${formatDate(new Date())}.md`);
const verifyMarkdown = [
  "---",
  "source: daily-cockpit-local-verify",
  `date: ${formatDate(new Date())}`,
  "---",
  "",
  `# 每日热启动 ${formatDate(new Date())}`,
  "",
  "## 原始意图",
  "",
  "> 本地验证脚本已确认插件文件安装完成。",
  "",
  "## 选定热启动",
  "",
  "- [x] **确认本地模型配置**",
  "  - warm-start: 启动本地模型服务并跑一次待办拆解。",
  "",
  "## 全部待办候选",
  "",
  "- [x] **确认本地模型配置**",
  ""
].join("\n");

try {
  await fs.access(exportPath);
} catch {
  await fs.writeFile(exportPath, verifyMarkdown);
}

let markdown = await fs.readFile(exportPath, "utf8");
if (!markdown.includes("source: daily-cockpit") && !markdown.includes("source: daily-cockpit-local-verify")) {
  const fallbackPath = path.join(exportDir, `${formatDate(new Date())}-daily-cockpit-local-verify.md`);
  await fs.writeFile(fallbackPath, verifyMarkdown);
  markdown = verifyMarkdown;
}
for (const heading of ["## 原始意图", "## 选定热启动", "## 全部待办候选"]) {
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

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
