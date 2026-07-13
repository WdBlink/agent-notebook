import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const pluginId = "daily-cockpit";

const args = process.argv.slice(2);
const vault = await resolveVault(args);
const port = Number(readArg(args, "--port") ?? "9222");
const obsidianBin = "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
const screenshotPath = path.join(process.cwd(), "test-results", "obsidian-daily-cockpit.png");

await assertFile(obsidianBin);
await restartObsidian(port, vault);
await waitForCdp(port);

const { chromium } = await importPlaywright();
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = await waitForObsidianPage(browser);

await page.waitForFunction((id) => Boolean(globalThis.app?.plugins?.plugins?.[id]), pluginId, { timeout: 60000 });

const pluginState = await page.evaluate(async (id) => {
  const plugin = globalThis.app.plugins.plugins[id];
  if (!plugin) throw new Error(`${id} plugin not loaded`);
  if (typeof plugin.activateView !== "function") throw new Error("loaded plugin is stale: activateView missing");
  await plugin.activateView();
  await new Promise((resolve) => setTimeout(resolve, 750));
  return {
    hasRefreshWorkSessions: typeof plugin.refreshWorkSessions === "function",
    hasSnapshot: Boolean(plugin.data?.workSessionSnapshot),
    scanRoots: plugin.data?.settings?.sessionScanRoots ?? [],
    sessionCount: plugin.data?.workSessionSnapshot?.sessions?.length ?? 0,
    commands: Object.keys(globalThis.app.commands.commands).filter((command) => command.includes(id)),
    leaves: globalThis.app.workspace.getLeavesOfType("daily-cockpit-view").length
  };
}, pluginId);

if (!pluginState.hasRefreshWorkSessions) {
  throw new Error("loaded Daily Cockpit plugin is stale: refreshWorkSessions is missing");
}
if (!pluginState.scanRoots.includes("~/.codex/sessions") || !pluginState.scanRoots.includes("~/.claude/projects")) {
  throw new Error("loaded Daily Cockpit settings are stale: active Codex/Claude session roots missing");
}
if (pluginState.leaves < 1) {
  throw new Error("Daily Cockpit view did not open in Obsidian");
}

await page.waitForFunction(
  () =>
    document.body.innerText.includes("昨日工作会话") &&
    document.body.innerText.includes("刷新") &&
    document.body.innerText.includes("热启动"),
  null,
  { timeout: 20000 }
);

const originalSummaryMode = await page.evaluate(async (id) => {
  const plugin = globalThis.app.plugins.plugins[id];
  const mode = plugin.data.settings.sessionSummaryMode;
  await plugin.updateSettings({ sessionSummaryMode: "metadata" });
  return mode;
}, pluginId);

const snapshotGeneratedAt = await page.evaluate(
  (id) => globalThis.app.plugins.plugins[id].data.workSessionSnapshot.generatedAt,
  pluginId
);

const clickedRefresh = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll("button"));
  const button = buttons.find(
    (candidate) => candidate.getAttribute("aria-label") === "刷新昨日工作会话" || candidate.textContent?.trim() === "刷新"
  );
  if (!(button instanceof HTMLButtonElement)) return false;
  button.click();
  return true;
});
if (!clickedRefresh) {
  throw new Error("Could not click the real Obsidian refresh button");
}
await page.waitForFunction(
  ({ id, before }) => globalThis.app.plugins.plugins[id].data.workSessionSnapshot.generatedAt !== before,
  { id: pluginId, before: snapshotGeneratedAt },
  { timeout: 60000 }
);

const resumeSession = await page.evaluate((id) => {
  const sessions = globalThis.app.plugins.plugins[id].data.workSessionSnapshot.sessions;
  return sessions.find(
    (session) =>
      session.resumable === true &&
      (session.platform === "codex" || session.platform === "claude") &&
      typeof session.id === "string" &&
      session.id.length > 0
  );
}, pluginId);

if (!resumeSession) {
  throw new Error("Real local refresh returned no resumable Codex or Claude Code session for yesterday");
}
await fs.access(expandHome(resumeSession.path));
const expectedResumeCommand = buildExpectedResumeCommand(resumeSession);

await execFileAsync("osascript", ["-e", 'set the clipboard to "daily-cockpit-e2e-sentinel"']);
let copiedResumeCommand = "";
let clickedResume = false;
try {
  const sessionCard = page.locator(".daily-cockpit-session").filter({ hasText: `id: ${resumeSession.id}` }).first();
  const resumeButton = sessionCard.locator(".daily-cockpit-resume");
  await resumeButton.click();
  clickedResume = true;
  await resumeButton.filter({ hasText: "已复制" }).waitFor({ state: "visible", timeout: 5000 });
  const clipboardResult = await execFileAsync("pbpaste");
  copiedResumeCommand = clipboardResult.stdout.trim();
} finally {
  await page.evaluate(async ({ id, mode }) => {
    await globalThis.app.plugins.plugins[id].updateSettings({ sessionSummaryMode: mode });
  }, { id: pluginId, mode: originalSummaryMode });
}

if (!clickedResume || copiedResumeCommand !== expectedResumeCommand) {
  throw new Error(
    `Resume command clipboard mismatch: expected ${JSON.stringify(expectedResumeCommand)}, got ${JSON.stringify(copiedResumeCommand)}`
  );
}

await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
await page.screenshot({ path: screenshotPath, fullPage: true });

const exportResult = await page.evaluate(async (id) => {
  const plugin = globalThis.app.plugins.plugins[id];
  return await plugin.exportDailyNote();
}, pluginId);

if (!exportResult?.ok || !exportResult.data?.path) {
  throw new Error(`Daily Cockpit export failed in Obsidian: ${JSON.stringify(exportResult)}`);
}

const exportPath = path.join(vault, exportResult.data.path);
const markdown = await fs.readFile(exportPath, "utf8");
const requiredHeadings = ["## 昨日工作会话", "## 原始意图", "## 选定热启动", "## 全部待办候选"];
for (const heading of requiredHeadings) {
  if (!markdown.includes(heading)) {
    throw new Error(`Exported Markdown missing latest heading: ${heading}`);
  }
}

const result = {
  ok: true,
  vault,
  port,
  pageUrl: page.url(),
  pluginState,
  clickedRefresh,
  clickedResume,
  copiedResumeCommand,
  resumeSession: {
    id: resumeSession.id,
    platform: resumeSession.platform,
    projectPath: resumeSession.projectPath,
    worktreePath: resumeSession.worktreePath,
    path: resumeSession.path
  },
  exportPath,
  screenshotPath,
  observedText: ["昨日工作会话", "刷新", "热启动"],
  requiredHeadings
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, () => process.exit(0));

function buildExpectedResumeCommand(session) {
  const workspace = session.worktreePath ?? session.projectPath;
  const resume = session.platform === "codex" ? `codex resume ${shellArgument(session.id)}` : `claude --resume ${shellArgument(session.id)}`;
  return workspace ? `cd ${shellPath(workspace)} && ${resume}` : resume;
}

function shellPath(value) {
  if (value === "~") return '"$HOME"';
  if (value.startsWith("~/")) return '"$HOME/' + value.slice(2).replace(/([\\"$`])/g, "\\$1") + '"';
  return shellArgument(value);
}

function shellArgument(value) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'"'"'`)}'`;
}

function expandHome(value) {
  return value === "~" || value.startsWith("~/") ? `${process.env.HOME}${value.slice(1)}` : value;
}

async function resolveVault(cliArgs) {
  const explicit = readArg(cliArgs, "--vault") ?? process.env.OBSIDIAN_VAULT;
  if (explicit) return path.resolve(explicit);

  const configPath = path.join(process.env.HOME ?? "", "Library/Application Support/obsidian/obsidian.json");
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  const openVault = Object.values(config.vaults ?? {}).find((vaultConfig) => vaultConfig?.open && vaultConfig?.path);
  const fallbackVault = Object.values(config.vaults ?? {}).find((vaultConfig) => vaultConfig?.path);
  const vaultPath = openVault?.path ?? fallbackVault?.path;
  if (!vaultPath) throw new Error("Could not resolve an Obsidian vault. Pass --vault /path/to/vault.");
  return path.resolve(vaultPath);
}

async function restartObsidian(debugPort, vaultPath) {
  await execFileAsync("osascript", ["-e", 'tell application "Obsidian" to quit']).catch(() => undefined);
  await waitForProcessExit("Obsidian", 12000);

  const child = spawn(obsidianBin, [`--remote-debugging-port=${debugPort}`], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();

  await sleep(2500);
  await execFileAsync("open", [`obsidian://open?vault=${encodeURIComponent(path.basename(vaultPath))}`]).catch(() => undefined);
}

async function waitForCdp(debugPort) {
  const endpoint = `http://127.0.0.1:${debugPort}/json/version`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) return;
    } catch {
      // Retry until Obsidian finishes booting.
    }
    await sleep(500);
  }
  throw new Error(`Obsidian remote debugging endpoint did not open: ${endpoint}`);
}

async function waitForObsidianPage(browser) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const page = pages.find((candidate) => candidate.url().startsWith("app://") || candidate.url().includes("obsidian"));
    if (page) return page;
    await sleep(500);
  }
  throw new Error("Could not find Obsidian page over CDP");
}

async function waitForProcessExit(processName, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await execFileAsync("pgrep", ["-x", processName]);
    } catch {
      return;
    }
    await sleep(500);
  }
  await execFileAsync("pkill", ["-x", processName]).catch(() => undefined);
  await sleep(1000);
}

async function importPlaywright() {
  try {
    return await import("playwright");
  } catch {
    return await import("@playwright/test");
  }
}

function readArg(cliArgs, name) {
  const index = cliArgs.indexOf(name);
  return index >= 0 ? cliArgs[index + 1] : undefined;
}

async function assertFile(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error(`Expected file: ${file}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
