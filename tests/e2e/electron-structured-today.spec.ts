import { expect, test, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createEmptyData } from "../../src/state";

test("real Electron default persists and reloads the complete structured Today closeout chain", async () => {
  test.slow();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-notebook-electron-structured-"));
  const home = path.join(root, "home");
  const userData = path.join(root, "user-data");
  const logicalDate = localDateInTimeZone(new Date(), "Asia/Shanghai");
  const [year, month, day] = logicalDate.split("-");
  const scanRoot = path.join(home, ".codex", "sessions", year!, month!, day!);
  const sessionId = "structured-electron-session";
  const sessionPath = path.join(scanRoot, `rollout-${logicalDate}-${sessionId}.jsonl`);
  const fakeCodex = path.join(root, "fake-structured-codex.mjs");
  const invocationLog = path.join(root, "structured-invocations.jsonl");
  const evidenceId = `session:codex:${sessionId}`;
  const sessionStartedAt = new Date(Date.now() - 120_000).toISOString();
  const sessionEndedAt = new Date(Date.now() - 60_000).toISOString();
  const originalReflection = "我确认结构化工作线能够稳定重开，但默认切换前还要验证封页与恢复。";
  const revisedReflection = `${originalReflection} 第二轮补充：还要验证重复整理。`;
  const transcript = [
    JSON.stringify({ timestamp: sessionStartedAt, type: "session_meta", payload: { id: sessionId, cwd: path.join(home, "project"), source: "cli" } }),
    JSON.stringify({ timestamp: sessionStartedAt, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "把 Today 切到结构化 workflow。" }] } }),
    JSON.stringify({ timestamp: sessionEndedAt, type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "已实现结构化 index 与按需 dossier。" }] } })
  ].join("\n");
  const outputs = {
    digest: {
      sessionId,
      summary: "完成结构化 Today 接缝。",
      currentStop: "等待真实 Electron 回归。",
      participation: { human: "确定方向。", agent: "完成实现。" },
      evidenceIds: [evidenceId],
      uncertainties: []
    },
    synthesis: {
      worklines: [{
        worklineId: "workline-electron-structured",
        title: "结构化 Today 真实链路",
        summary: "[E1] 结构化 artifact 直接驱动客户端。",
        startedAt: sessionStartedAt,
        endedAt: sessionEndedAt,
        currentStop: "等待用户判断。",
        possibleChange: "核心导航不再依赖 Markdown。",
        participation: { human: "确定方向。", agent: "完成实现。" },
        evidenceReadiness: "ready",
        sessionIds: [sessionId],
        evidenceIds: [evidenceId],
        extensions: []
      }],
      assignments: [{ sessionId, worklineIds: ["workline-electron-structured"] }],
      unresolvedSessionIds: []
    },
    analysis: {
      priorContext: "旧路径依赖 Markdown。",
      whatHappened: "结构化 index 已持久化。",
      possibleChange: "工作线与 Session membership 可以稳定重开。",
      supportingEvidence: [{ claim: "真实 Electron 已显示结构化工作线。", evidenceIds: [evidenceId] }],
      opposingEvidence: [],
      falsifiableObservation: "重启后不得再次调用模型。",
      gaps: []
    },
    critique: { acceptable: true, issues: [], missingEvidenceIds: [] },
    dossier: {
      title: "结构化 Today 证据档案",
      priorContext: "旧路径依赖 Markdown。",
      whatHappened: "结构化 index 已持久化。",
      possibleChange: "工作线与 Session membership 可以稳定重开。",
      supportingEvidence: [{ claim: "真实 Electron 已显示结构化工作线。", evidenceIds: [evidenceId] }],
      opposingEvidence: [],
      falsifiableObservation: "重启后不得再次调用模型。",
      gaps: [],
      humanQuestion: "是否继续完成结构化反思与封页迁移？",
      evidenceIds: [evidenceId],
      extensions: []
    },
    proposals: {
      proposals: [
        { category: "judgment", proposalText: "确认结构化工作线可稳定重开。", sourceQuote: originalReflection, evidenceIds: [evidenceId] },
        { category: "tomorrow", proposalText: "明天继续验证未提交运行恢复。", sourceQuote: originalReflection, evidenceIds: [] },
        { category: "ctx", proposalText: "将默认切换条件记录为 CTX 候选。", sourceQuote: originalReflection, evidenceIds: [] },
        { category: "background", proposalText: "后台候选仍需单独授权。", sourceQuote: originalReflection, evidenceIds: [] },
        { category: "today-only", proposalText: "只在今天保留对默认切换的谨慎。", sourceQuote: originalReflection, evidenceIds: [] }
      ]
    }
  };

  await Promise.all([fs.mkdir(userData, { recursive: true }), fs.mkdir(scanRoot, { recursive: true })]);
  await fs.writeFile(sessionPath, transcript, "utf8");
  await fs.writeFile(fakeCodex, [
    "#!/usr/bin/env node",
    "import fs from 'node:fs';",
    `const logPath = ${JSON.stringify(invocationLog)};`,
    `const outputs = ${JSON.stringify(outputs)};`,
    "const stdin = fs.readFileSync(0, 'utf8');",
    "let stage = '';",
    "if (stdin.includes('Digest exactly one')) stage = 'digest';",
    "else if (stdin.includes('Reconstruct cross-Session')) stage = 'synthesis';",
    "else if (stdin.includes('Analyze only the selected')) stage = 'analysis';",
    "else if (stdin.includes('Critique unsupported')) stage = 'critique';",
    "else if (stdin.includes('Compose the final')) stage = 'dossier';",
    "else if (stdin.includes('Arrange the user')) stage = 'proposals';",
    "else { console.error('unexpected structured prompt'); process.exit(2); }",
    "fs.appendFileSync(logPath, JSON.stringify({stage,args:process.argv.slice(2)}) + '\\n');",
    "process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(outputs[stage])}}) + '\\n');"
  ].join("\n"), { encoding: "utf8", mode: 0o700 });

  const cockpit = createEmptyData({
    sessionScanRoots: [path.join(home, ".codex", "sessions")],
    enabledSessionProviders: ["codex"],
    sessionSummaryMode: "metadata",
    codexCliPath: fakeCodex,
    dailyReviewScheduleEnabled: false,
    dailyReviewScheduleTime: "18:30"
  });
  await fs.writeFile(path.join(userData, "cockpit-data.json"), `${JSON.stringify(cockpit, null, 2)}\n`, "utf8");
  const launchOptions = {
    args: [`--user-data-dir=${userData}`, path.resolve("dist/desktop")],
    env: {
      ...process.env,
      HOME: home,
      TZ: "Asia/Shanghai"
    }
  };
  let electronApp: ElectronApplication | undefined;
  try {
    electronApp = await electron.launch(launchOptions);
    const page = await readyWindow(electronApp);
    await expect.poll(async () => (await page.evaluate(() => window.agentWhiteboard.getState())).data.workSessionSnapshot.sessions.length, { timeout: 15_000 }).toBe(1);
    await page.getByRole("button", { name: "现在整理" }).click();
    const board = page.locator(".today-board");
    await expect(board.getByText("结构化 Today 真实链路", { exact: true })).toBeVisible({ timeout: 20_000 });
    const workline = board.locator(".structured-today-workline");
    await workline.locator("summary").click();
    await expect(workline.getByText(sessionId, { exact: false })).toBeVisible();
    await workline.getByRole("button", { name: /打开引用 E1/ }).first().click();
    const citationDialog = page.getByRole("dialog");
    await expect(citationDialog.getByText("引用 [E1] · Session 级证据", { exact: true })).toBeVisible();
    await citationDialog.getByRole("button", { name: "回到证据" }).click();
    await workline.getByRole("button", { name: "深入分析这条工作线" }).click();
    await expect(board.getByText("是否继续完成结构化反思与封页迁移？", { exact: true })).toBeVisible({ timeout: 20_000 });
    const dossierReadingStyle = await workline.locator(".structured-today-dossier section p").first().evaluate((element) => {
      const style = getComputedStyle(element);
      return { fontSize: Number.parseFloat(style.fontSize), lineHeight: Number.parseFloat(style.lineHeight) };
    });
    expect(dossierReadingStyle.fontSize).toBeGreaterThanOrEqual(15);
    expect(dossierReadingStyle.lineHeight).toBeGreaterThanOrEqual(25);
    await workline.getByRole("button", { name: /打开引用 1/ }).first().click();
    await expect(page.getByRole("dialog").getByText("引用 [1] · Session 级证据", { exact: true })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "回到证据" }).click();
    await expect(workline.getByText("保存在本地，绑定当前工作线", { exact: true })).toBeVisible();
    await expect(workline.getByText("原文会成为 Agent Notebook 的独立用户资产；不会自动写入 Wiki、CTX、项目文件或 Codex 报告。", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1600, height: 900 });
    const stickyReflectionLayout = await page.evaluate(async () => {
      const scroller = document.querySelector<HTMLElement>(".today-board-scroll")!;
      const dossier = document.querySelector<HTMLElement>(".structured-today-dossier")!;
      const closeout = document.querySelector<HTMLElement>(".structured-today-closeout")!;
      const input = closeout.querySelector<HTMLTextAreaElement>("textarea")!;
      const scrollerBefore = scroller.getBoundingClientRect();
      const dossierBefore = dossier.getBoundingClientRect();
      scroller.scrollTop += dossierBefore.bottom - scrollerBefore.bottom + 24;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const scrollerAfter = scroller.getBoundingClientRect();
      const closeoutAfter = closeout.getBoundingClientRect();
      const inputAfter = input.getBoundingClientRect();
      return {
        position: getComputedStyle(closeout).position,
        scrollTop: scroller.scrollTop,
        closeoutTop: closeoutAfter.top,
        inputTop: inputAfter.top,
        inputBottom: inputAfter.bottom,
        viewportTop: scrollerAfter.top,
        viewportBottom: scrollerAfter.bottom
      };
    });
    expect(stickyReflectionLayout.position).toBe("sticky");
    expect(stickyReflectionLayout.scrollTop).toBeGreaterThan(0);
    expect(stickyReflectionLayout.closeoutTop).toBeGreaterThanOrEqual(stickyReflectionLayout.viewportTop - 1);
    expect(stickyReflectionLayout.inputTop).toBeGreaterThanOrEqual(stickyReflectionLayout.viewportTop - 1);
    expect(stickyReflectionLayout.inputBottom).toBeLessThanOrEqual(stickyReflectionLayout.viewportBottom + 1);
    await page.locator(".today-board-scroll").evaluate((element) => { element.scrollTop = 0; });
    await workline.getByPlaceholder("写下你的理解、保留意见或下一步判断…").fill(originalReflection);
    await workline.getByRole("button", { name: "保存我的回顾" }).click();
    await expect(workline.getByText("已保存版本 1", { exact: true })).toBeVisible();
    await expect(workline.getByRole("button", { name: "回顾已保存" })).toBeDisabled();
    await workline.getByRole("button", { name: "整理我的文字" }).click();
    await expect(workline.getByText("这些按钮现在只记录你的选择", { exact: true })).toBeVisible({ timeout: 20_000 });
    await workline.locator("summary").click();
    await expect(workline.locator(".structured-today-review-workspace")).toBeHidden();
    await workline.locator("summary").click();
    await expect(workline.locator(".structured-today-review-workspace")).toBeVisible();
    await workline.getByPlaceholder("写下你的理解、保留意见或下一步判断…").fill(revisedReflection);
    await workline.getByRole("button", { name: "保存我的回顾" }).click();
    await expect(workline.getByText("已保存版本 2", { exact: true })).toBeVisible();
    await expect(workline.getByRole("button", { name: "回顾已保存" })).toBeDisabled();
    await workline.getByRole("button", { name: "整理我的文字" }).click();
    await expect(workline.getByText("这些按钮现在只记录你的选择", { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.setViewportSize({ width: 1600, height: 1000 });
    const wideLayout = await page.evaluate(() => {
      const dossier = document.querySelector<HTMLElement>(".structured-today-dossier")!.getBoundingClientRect();
      const closeout = document.querySelector<HTMLElement>(".structured-today-closeout")!.getBoundingClientRect();
      return {
        dossier: { x: dossier.x, y: dossier.y, width: dossier.width, height: dossier.height },
        closeout: { x: closeout.x, y: closeout.y, width: closeout.width, height: closeout.height },
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    expect(wideLayout.closeout.x).toBeGreaterThanOrEqual(wideLayout.dossier.x + wideLayout.dossier.width - 1);
    expect(Math.abs(wideLayout.closeout.y - wideLayout.dossier.y)).toBeLessThanOrEqual(1);
    expect(wideLayout.overflow).toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 1000, height: 900 });
    const narrowLayout = await page.evaluate(() => {
      const dossier = document.querySelector<HTMLElement>(".structured-today-dossier")!.getBoundingClientRect();
      const closeout = document.querySelector<HTMLElement>(".structured-today-closeout")!.getBoundingClientRect();
      return {
        dossier: { x: dossier.x, y: dossier.y, width: dossier.width, height: dossier.height },
        closeout: { x: closeout.x, y: closeout.y, width: closeout.width, height: closeout.height },
        closeoutPosition: getComputedStyle(document.querySelector<HTMLElement>(".structured-today-closeout")!).position,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    expect(narrowLayout.closeout.y).toBeGreaterThanOrEqual(narrowLayout.dossier.y + narrowLayout.dossier.height - 1);
    expect(Math.abs(narrowLayout.closeout.x - narrowLayout.dossier.x)).toBeLessThanOrEqual(1);
    expect(narrowLayout.closeoutPosition).toBe("static");
    expect(narrowLayout.overflow).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1600, height: 1000 });
    const proposalActionStyle = await workline.locator(".structured-today-proposal-actions button").first().evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        fontSize: Number.parseFloat(style.fontSize),
        height: element.getBoundingClientRect().height,
        radius: Number.parseFloat(style.borderRadius)
      };
    });
    expect(proposalActionStyle.fontSize).toBeGreaterThanOrEqual(11);
    expect(proposalActionStyle.height).toBeLessThanOrEqual(42);
    expect(proposalActionStyle.radius).toBeGreaterThanOrEqual(16);
    for (const category of ["形成的判断", "明日候选", "CTX 候选", "后台候选", "只留在今天"]) {
      const region = workline.getByRole("region", { name: category });
      await expect(region).toBeVisible({ timeout: 20_000 });
      await region.getByRole("button", { name: "接受" }).click();
      await expect(region.getByText("已记录：接受，仅保存在今日页", { exact: true })).toBeVisible();
    }
    await expect(workline.getByText("已记录为接受。它只成为当前 Today 页的选择记录，没有生成报告或改动项目。", { exact: true })).toBeVisible();
    await board.getByRole("button", { name: "收笔并封存" }).click();
    await expect(board.getByText("封", { exact: true })).toBeVisible();

    const state = await page.evaluate(() => window.agentWhiteboard.getState());
    expect(state.structuredTodayReview.activeIndex?.worklines).toHaveLength(1);
    expect(state.structuredTodayReview.worklines[0]?.dossier?.content.humanQuestion).toBe("是否继续完成结构化反思与封页迁移？");
    expect(state.structuredTodayProgress.index?.status).toBe("ready");
    expect(state.structuredTodayProgress.dossierByWorklineId["workline-electron-structured"]?.status).toBe("ready");
    expect(state.notebook.page.status).toBe("sealed");
    expect(state.notebook.page.structuredCloseout?.proposals).toHaveLength(1);
    expect(state.notebook.page.structuredCloseout?.dispositions).toHaveLength(5);
    expect(state.traceinkReview.activeIndex).toBeUndefined();
    const assetPath = path.join(userData, "traceink-assets-v1.json");
    const stored = JSON.parse(await fs.readFile(assetPath, "utf8"));
    expect(stored.structuredIndexes).toHaveLength(1);
    expect(stored.structuredDossiers).toHaveLength(1);
    expect(stored.structuredReflections).toHaveLength(2);
    expect(stored.structuredProposals).toHaveLength(2);
    expect(stored.structuredProposalDispositions).toHaveLength(5);
    expect(stored.artifacts).toEqual([]);
    const invocations = await readInvocationRecords(invocationLog);
    expect(invocations.map((item) => item.stage)).toEqual(["digest", "synthesis", "analysis", "critique", "dossier", "proposals", "proposals"]);
    for (const invocation of invocations) expect(invocation.args).toContain("--output-schema");

    await closeElectronApplication(electronApp);
    electronApp = undefined;
    electronApp = await electron.launch(launchOptions);
    const reloaded = await readyWindow(electronApp);
    await expect(reloaded.getByText("封", { exact: true })).toBeVisible();
    await expect(reloaded.getByText(revisedReflection, { exact: true })).toBeVisible();
    const reloadedState = await reloaded.evaluate(() => window.agentWhiteboard.getState());
    expect(reloadedState.notebook.page.structuredCloseout?.index).toEqual(state.notebook.page.structuredCloseout?.index);
    expect((await readInvocationRecords(invocationLog)).map((item) => item.stage)).toEqual(["digest", "synthesis", "analysis", "critique", "dossier", "proposals", "proposals"]);
  } finally {
    if (electronApp) await closeElectronApplication(electronApp);
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function readyWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await expect(page.locator(".today-board")).toBeVisible();
  return page;
}

async function closeElectronApplication(application: ElectronApplication): Promise<void> {
  const child = application.process();
  await application.close().catch(() => undefined);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function readInvocationRecords(filePath: string): Promise<Array<{ stage: string; args: string[] }>> {
  return (await fs.readFile(filePath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { stage: string; args: string[] });
}

function localDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}-${parts.find((part) => part.type === "day")!.value}`;
}
