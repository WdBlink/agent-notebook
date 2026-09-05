import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const pluginId = "agent-notebook";
const args = process.argv.slice(2);
const vault = await resolveVault(args);
const port = Number(readArg(args, "--port") ?? "9222");
const model = readArg(args, "--model") ?? "qwen2.5:7b";
const endpoint = readArg(args, "--endpoint") ?? "http://127.0.0.1:11434/v1/chat/completions";
const obsidianBin = "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
const screenshotPath = path.join(process.cwd(), "test-results", "obsidian-agent-notebook.png");
const e2eRoot = "Agent Notebook E2E";
const e2eFolder = `${e2eRoot}/run-${process.pid}-${Date.now()}`;

await assertFile(obsidianBin);
await assertLocalModel(endpoint, model);
await restartObsidian(port, vault);
await waitForCdp(port);

const { chromium } = await importPlaywright();
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = await waitForObsidianPage(browser);
await page.waitForFunction((id) => Boolean(globalThis.app?.plugins?.plugins?.[id]), pluginId, { timeout: 60000 });

const originalData = await page.evaluate((id) => JSON.parse(JSON.stringify(globalThis.app.plugins.plugins[id].data)), pluginId);
let exportPath;
let result;

try {
  const pluginState = await page.evaluate(async ({ id, modelName, modelEndpoint, folder }) => {
    const plugin = globalThis.app.plugins.plugins[id];
    if (!plugin || typeof plugin.activateView !== "function") throw new Error(`${id} plugin is stale or unavailable`);
    await plugin.updateSettings({
      sessionSummaryMode: "metadata",
      llmModel: modelName,
      llmEndpoint: modelEndpoint,
      dailyNoteFolder: folder
    });
    await plugin.activateView();
    await new Promise((resolve) => setTimeout(resolve, 750));
    return {
      hasRefreshWorkSessions: typeof plugin.refreshWorkSessions === "function",
      scanRoots: plugin.data?.settings?.sessionScanRoots ?? [],
      sessionCount: plugin.data?.workSessionSnapshot?.sessions?.length ?? 0,
      commands: Object.keys(globalThis.app.commands.commands).filter((command) => command.includes(id)),
      leaves: globalThis.app.workspace.getLeavesOfType("agent-notebook-view").length
    };
  }, { id: pluginId, modelName: model, modelEndpoint: endpoint, folder: e2eFolder });

  if (!pluginState.hasRefreshWorkSessions || pluginState.leaves < 1) {
    throw new Error(`Agent Notebook view did not initialize: ${JSON.stringify(pluginState)}`);
  }
  if (!pluginState.scanRoots.includes("~/.codex/sessions") || !pluginState.scanRoots.includes("~/.claude/projects")) {
    throw new Error("Agent Notebook settings are missing canonical Codex or Claude roots");
  }

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("昨日工作") &&
      document.body.innerText.includes("昨日项目") &&
      document.body.innerText.includes("说明天想推进什么"),
    null,
    { timeout: 20000 }
  );

  const snapshotGeneratedAt = await page.evaluate(
    (id) => globalThis.app.plugins.plugins[id].data.workSessionSnapshot.generatedAt,
    pluginId
  );
  await page.getByRole("button", { name: "刷新昨日工作会话" }).click();
  await page.waitForFunction(
    ({ id, before }) => globalThis.app.plugins.plugins[id].data.workSessionSnapshot.generatedAt !== before,
    { id: pluginId, before: snapshotGeneratedAt },
    { timeout: 60000 }
  );

  const resumeSession = await page.evaluate((id) => {
    const sessions = globalThis.app.plugins.plugins[id].data.workSessionSnapshot.sessions;
    return sessions.find(
      (session) =>
        session.platform === "codex" &&
        session.resumable === true &&
        typeof session.id === "string" &&
        session.id.length > 0
    );
  }, pluginId);
  if (!resumeSession) throw new Error("Real local refresh returned no resumable Codex session for the previous day");
  await fs.access(expandHome(resumeSession.path));

  const expectedResumeCommand = buildExpectedResumeCommand(resumeSession);
  await execFileAsync("osascript", ["-e", 'set the clipboard to "agent-notebook-e2e-sentinel"']);
  const sessionCard = page.locator(".agent-notebook-session").filter({ hasText: resumeSession.title }).first();
  const resumeButton = sessionCard.locator(".agent-notebook-resume");
  await resumeButton.click();
  await resumeButton.filter({ hasText: "已复制" }).waitFor({ state: "visible", timeout: 5000 });
  const copiedResumeCommand = (await execFileAsync("pbpaste")).stdout.trim();
  if (copiedResumeCommand !== expectedResumeCommand) {
    throw new Error(`Resume clipboard mismatch: expected ${expectedResumeCommand}, got ${copiedResumeCommand}`);
  }

  const resumeVerification = await verifyCodexResume(resumeSession);

  const previousPlanId = await page.evaluate((id) => globalThis.app.plugins.plugins[id].data.activePlanId, pluginId);
  await page.getByLabel("待拆解的自然语言意图").fill("明天继续验证 Agent Notebook：检查昨日工作聚合，并确认恢复命令和导出结果。拆成两条简洁待办。");
  await page.getByRole("button", { name: "拆成待办" }).click();
  await page.waitForFunction(
    ({ id, before }) => {
      const plugin = globalThis.app.plugins.plugins[id];
      const plan = plugin.data.plans.find((candidate) => candidate.id === plugin.data.activePlanId);
      return plugin.data.activePlanId !== before && Array.isArray(plan?.tasks) && plan.tasks.length > 0;
    },
    { id: pluginId, before: previousPlanId },
    { timeout: 120000 }
  );

  const decomposition = await page.evaluate((id) => {
    const plugin = globalThis.app.plugins.plugins[id];
    const plan = plugin.data.plans.find((candidate) => candidate.id === plugin.data.activePlanId);
    return { planId: plan?.id, targetDate: plan?.targetDate, taskCount: plan?.tasks?.length ?? 0 };
  }, pluginId);
  if (!decomposition.planId || decomposition.taskCount < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(decomposition.targetDate ?? "")) {
    throw new Error(`Real model decomposition did not produce a dated task plan: ${JSON.stringify(decomposition)}`);
  }

  await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });

  await page.getByRole("button", { name: "写入 Markdown" }).click();
  await page.waitForFunction(
    ({ id, folder }) => globalThis.app.plugins.plugins[id].data.lastExportPath?.startsWith(`${folder}/`),
    { id: pluginId, folder: e2eFolder },
    { timeout: 30000 }
  );
  const relativeExportPath = await page.evaluate((id) => globalThis.app.plugins.plugins[id].data.lastExportPath, pluginId);
  exportPath = path.join(vault, relativeExportPath);
  const markdown = await fs.readFile(exportPath, "utf8");
  const requiredHeadings = ["## 昨日工作", "## 明日意图", "## 待办事项"];
  for (const heading of requiredHeadings) {
    if (!markdown.includes(heading)) throw new Error(`Exported Markdown missing heading: ${heading}`);
  }

  result = {
    ok: true,
    vault,
    port,
    model,
    pluginState,
    copiedResumeCommand,
    resumeSession: {
      id: resumeSession.id,
      platform: resumeSession.platform,
      projectPath: resumeSession.projectPath,
      worktreePath: resumeSession.worktreePath,
      path: resumeSession.path
    },
    resumeVerification,
    decomposition,
    exportPath,
    screenshotPath,
    requiredHeadings
  };
} finally {
  await page.evaluate(async ({ id, data }) => {
    const plugin = globalThis.app.plugins.plugins[id];
    plugin.data = data;
    await plugin.saveData(data);
    if (typeof plugin.refreshViews === "function") plugin.refreshViews();
  }, { id: pluginId, data: originalData }).catch(() => undefined);
  if (exportPath) await fs.rm(exportPath, { force: true });
  await fs.rmdir(path.join(vault, e2eFolder)).catch(() => undefined);
  await fs.rmdir(path.join(vault, e2eRoot)).catch(() => undefined);
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, () => process.exit(0));

async function verifyCodexResume(session) {
  const cwd = expandHome(session.worktreePath ?? session.projectPath ?? process.cwd());
  await fs.access(cwd);
  const marker = `AGENT_NOTEBOOK_RESUME_OK_${Date.now()}`;
  const { stdout } = await execFileAsync(
    "codex",
    ["exec", "resume", session.id, `Reply exactly ${marker}. Do not run tools or modify files.`, "--json", "--skip-git-repo-check"],
    { cwd, timeout: 180000, maxBuffer: 8 * 1024 * 1024 }
  );
  const events = stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
  const started = events.find((event) => event.type === "thread.started");
  const resumedId = started?.thread_id ?? started?.threadId;
  const text = events.map((event) => event.item?.text ?? event.message ?? "").join("\n");
  if (resumedId !== session.id || !text.includes(marker)) {
    throw new Error(`Codex resume verification failed for ${session.id}`);
  }
  return { resumedId, markerObserved: true };
}

async function assertLocalModel(modelEndpoint, modelName) {
  const origin = new URL(modelEndpoint).origin;
  const response = await fetch(`${origin}/api/tags`).catch(() => undefined);
  if (!response?.ok) throw new Error(`Local model service is unavailable at ${origin}`);
  const payload = await response.json();
  const names = (payload.models ?? []).flatMap((item) => [item.name, item.model]).filter(Boolean);
  if (!names.includes(modelName)) throw new Error(`Local model ${modelName} is not installed. Available: ${names.join(", ")}`);
}

function buildExpectedResumeCommand(session) {
  const workspace = session.worktreePath ?? session.projectPath;
  const resume = `codex resume ${shellArgument(session.id)}`;
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
  const values = Object.values(config.vaults ?? {});
  const vaultPath = values.find((item) => item?.open && item?.path)?.path ?? values.find((item) => item?.path)?.path;
  if (!vaultPath) throw new Error("Could not resolve an Obsidian vault. Pass --vault /path/to/vault.");
  return path.resolve(vaultPath);
}

async function restartObsidian(debugPort, vaultPath) {
  await execFileAsync("osascript", ["-e", 'tell application "Obsidian" to quit']).catch(() => undefined);
  await waitForProcessExit("Obsidian", 12000);
  const child = spawn(obsidianBin, [`--remote-debugging-port=${debugPort}`], { detached: true, stdio: "ignore" });
  child.unref();
  await sleep(2500);
  await execFileAsync("open", [`obsidian://open?vault=${encodeURIComponent(path.basename(vaultPath))}`]).catch(() => undefined);
}

async function waitForCdp(debugPort) {
  const url = `http://127.0.0.1:${debugPort}/json/version`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await sleep(500);
  }
  throw new Error(`Obsidian remote debugging endpoint did not open: ${url}`);
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
    try { await execFileAsync("pgrep", ["-x", processName]); } catch { return; }
    await sleep(500);
  }
  await execFileAsync("pkill", ["-x", processName]).catch(() => undefined);
  await sleep(1000);
}

async function importPlaywright() {
  try { return await import("playwright"); } catch { return import("@playwright/test"); }
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
