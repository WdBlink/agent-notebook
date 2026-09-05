import { expect, test, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TraceinkAssetStoreDocumentV1 } from "../../app/desktop/traceink-asset-store";
import { createEmptyData } from "../../src/state";

const GOLDEN_TITLES = [
  "把 Traceink 的真实产物变成 Work Continuity 的核心界面",
  "让自动因子发现引擎真正达到“中金式 AI Loop”标准",
  "有界因子发现实跑：首个 campaign 已封存但没有 Alpha",
  "Autoresearch Adapter ↔ Evaluator 自动往返与权限边界",
  "FOLO RSS → LLM-Wiki：从相关性筛选升级为证据质量门"
] as const;

const GOLDEN_SESSIONS = [
  ["019fe682-2ae8-75c0-970c-a3438bd51db1", "2026-08-15T01:22:00.000Z", "2026-08-15T06:28:00.000Z", "把 Traceink 的真实产物完整展示在客户端，并保留活动信息和证据边界。", "已把自然语言工作线作为语义权威，并恢复活动可视化。"],
  ["019ff55d-2782-77a0-abb8-f2b11dcd01f2", "2026-08-15T01:16:00.000Z", "2026-08-15T06:25:00.000Z", "按中金式 AI Loop 标准检查父本、参数动量和失败记忆。", "断点已经定位，长期真实 campaign 证据仍不足。"],
  ["01a003a2-f248-7aa1-8c01-000000000003", "2026-08-15T04:16:00.000Z", "2026-08-15T06:28:00.000Z", "有界运行首个 factor discovery campaign，不要擅自扩大范围。", "Campaign 已封存：49 个候选证据不足，没有可推广 Alpha。"],
  ["019fd9f8-48e6-77a2-9775-6f392b570065", "2026-08-15T01:19:00.000Z", "2026-08-15T05:08:00.000Z", "验证 Adapter 和 Evaluator 的自动往返以及权限边界。", "状态机停在 AWAITING_HUMAN，需要独立 SSH 前置证据。"],
  ["019fd2c1-b372-7aa1-8c01-000000000005", "2026-08-15T00:38:00.000Z", "2026-08-15T06:23:00.000Z", "把 FOLO RSS 从相关性评分升级为有界的原始来源核验。", "今日运行完成；A 档质量门方案已确认但尚未实现。"]
] as const;

const ORIGINAL_REFLECTION = "我确认 Traceink 原文应该继续作为语义权威，但明天必须在重新构建的客户端里验证五条线和原始证据都能重开。";

test("real Electron rollback mode preserves the complete Traceink golden review chain", async () => {
  test.slow();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-notebook-electron-golden-"));
  const home = path.join(root, "home");
  const userData = path.join(root, "user-data");
  const logicalDate = localDateInTimeZone(new Date(), "Asia/Shanghai");
  const [year, month, day] = logicalDate.split("-");
  const scanRoot = path.join(home, ".codex", "sessions", year!, month!, day!);
  const fakeCodex = path.join(root, "fake-codex.mjs");
  const invocationLog = path.join(root, "fake-codex-invocations.jsonl");
  const rawMarkdown = await fs.readFile(path.resolve("tests/skill-fixtures/traceink-golden/today-2026-08-15-index.md"), "utf8");
  const sessionPaths = GOLDEN_SESSIONS.map(([id]) => path.join(scanRoot, `rollout-${logicalDate}-${id}.jsonl`));
  const dossierMarkdown = [
    `# ${GOLDEN_TITLES[0]} · 证据档案`, "",
    "> 不把 AI 的候选解释冒充成你的判断。以下材料只重建证据、边界和待判断问题。", "",
    "## 原来的判断", "完整 Traceink 原文应当是产品语义权威，App 只负责阅读和交互。", "",
    "## 发生了什么", "五条工作线、活动信息和证据入口已经进入真实桌面链路。", "",
    "## 当前停点", "需要在重新构建的客户端中确认 exact Session 可以按冻结版本重开。", "",
    "## 支持、反对与适用边界", `- [E1] Codex Session \`${GOLDEN_SESSIONS[0][0]}\` · ${sessionPaths[0]}`, "- 外部文档仍只是路径登记，不冒充冻结正文。", "",
    "## 仍需你判断", "这份客户端展示是否已经与 Traceink 原始产物同等完整？"
  ].join("\n");
  const proposalTexts = {
    judgment: "确认 Traceink 原文继续作为产品语义权威。",
    tomorrow: "明天在重新构建的客户端中回归五条黄金工作线。",
    ctx: "把已确认的产品方向保留为 CTX 候选，等待明确采纳。",
    background: "把只读回归材料列为后台候选，等待单独授权。",
    todayOnly: "只在今天保留对客户端真实性的质疑。"
  };
  const proposalsMarkdown = [
    "# 五类回顾提案", "", "## 你的原始回顾", ORIGINAL_REFLECTION, "",
    "## 形成的判断", `- **[J1]** ${proposalTexts.judgment}`, "",
    "## 明日候选", `- **[T1]** ${proposalTexts.tomorrow}`, "",
    "## CTX 候选", `- **[C1]** ${proposalTexts.ctx}`, "",
    "## 后台候选", `- **[B1]** ${proposalTexts.background}`, "",
    "## 只留在今天", `- **[D1]** ${proposalTexts.todayOnly}`, "",
    "以上全部只是提案，尚未采纳、迁移、执行或封页。"
  ].join("\n");
  const proposalTransport = {
    rawMarkdown: proposalsMarkdown,
    proposals: [
      { category: "judgment", proposalText: proposalTexts.judgment, sourceQuote: ORIGINAL_REFLECTION, evidenceIds: [] },
      { category: "tomorrow", proposalText: proposalTexts.tomorrow, sourceQuote: ORIGINAL_REFLECTION, evidenceIds: [] },
      { category: "ctx", proposalText: proposalTexts.ctx, sourceQuote: ORIGINAL_REFLECTION, evidenceIds: [] },
      { category: "background", proposalText: proposalTexts.background, sourceQuote: ORIGINAL_REFLECTION, evidenceIds: [] },
      { category: "today-only", proposalText: proposalTexts.todayOnly, sourceQuote: ORIGINAL_REFLECTION, evidenceIds: [] }
    ],
    transportComplete: true
  };

  await Promise.all([fs.mkdir(userData, { recursive: true }), fs.mkdir(scanRoot, { recursive: true })]);
  await Promise.all(GOLDEN_SESSIONS.map(([id, startedAt, answeredAt, userText, assistantText], index) => fs.writeFile(
    sessionPaths[index]!,
    [
      JSON.stringify({ timestamp: timestampOnDate(logicalDate, startedAt), type: "session_meta", payload: { id, cwd: path.join(home, `project-${index + 1}`), source: "cli" } }),
      JSON.stringify({ timestamp: timestampOnDate(logicalDate, startedAt), type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: userText }] } }),
      JSON.stringify({ timestamp: timestampOnDate(logicalDate, answeredAt), type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: assistantText }] } }),
      JSON.stringify({ timestamp: timestampOnDate(logicalDate, answeredAt), type: "event_msg", payload: { type: "task_complete", started_at: timestampOnDate(logicalDate, startedAt), completed_at: timestampOnDate(logicalDate, answeredAt) } })
    ].join("\n"), "utf8"
  )));
  const canonicalSessionPaths = await Promise.all(sessionPaths.map((sessionPath) => fs.realpath(sessionPath)));

  await fs.writeFile(fakeCodex, [
    "#!/usr/bin/env node", "import fs from 'node:fs';",
    `const logPath = ${JSON.stringify(invocationLog)};`, "const args = process.argv.slice(2);",
    "const append = value => fs.appendFileSync(logPath, JSON.stringify(value) + '\\n');",
    "if (args[0] === 'features' && args[1] === 'list') { append({kind:'features',args}); process.stdout.write('shell_tool stable true\\nunified_exec stable true\\nview_image stable true\\nskill_search stable true\\n'); process.exit(0); }",
    "const stdin = fs.readFileSync(0, 'utf8');",
    "const stage = stdin.includes('Execute only Traceink workflow step 5') ? 'proposals' : stdin.includes('Execute only Traceink workflow step 4 for this selected workline') ? 'dossier' : 'index';",
    "append({kind:'model',stage,args});",
    `const transports = ${JSON.stringify({ index: { rawMarkdown, transportComplete: true }, dossier: { rawMarkdown: dossierMarkdown, transportComplete: true }, proposals: proposalTransport })};`,
    "const text = JSON.stringify(transports[stage]);",
    "process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}}) + '\\n');"
  ].join("\n"), { encoding: "utf8", mode: 0o700 });

  const cockpit = createEmptyData({
    sessionScanRoots: [path.join(home, ".codex", "sessions")], enabledSessionProviders: ["codex"], sessionSummaryMode: "metadata",
    codexCliPath: fakeCodex, dailyReviewScheduleEnabled: false, dailyReviewScheduleTime: "00:00"
  });
  await fs.writeFile(path.join(userData, "cockpit-data.json"), `${JSON.stringify(cockpit, null, 2)}\n`, "utf8");

  const launchOptions = {
    args: [`--user-data-dir=${userData}`, path.resolve("dist/desktop")],
    env: { ...process.env, HOME: home, TZ: "Asia/Shanghai", AGENT_NOTEBOOK_STRUCTURED_TODAY: "0" }
  };
  let electronApp: ElectronApplication | undefined;
  try {
    electronApp = await electron.launch(launchOptions);
    const page = await readyWindow(electronApp);
    await expect.poll(async () => (await page.evaluate(() => window.agentWhiteboard.getState())).data.workSessionSnapshot.sessions.length, { timeout: 15_000 }).toBe(5);
    await expect(page.getByRole("button", { name: "现在整理" })).toBeEnabled();
    await page.getByRole("button", { name: "现在整理" }).click();

    const board = page.locator(".today-board");
    const canonicalDocument = board.getByRole("article", { name: "Traceink 工作脉络正文" });
    await expect(canonicalDocument).toBeVisible({ timeout: 20_000 });
    for (const title of GOLDEN_TITLES) await expect(canonicalDocument.getByRole("heading", { name: new RegExp(escapeRegex(title)) })).toBeVisible();
    await expect(board.locator(".traceink-workline-actions button")).toHaveCount(5);
    const activitySummary = board.getByRole("region", { name: "可观察活动摘要" });
    await expect(activitySummary).toContainText("观测到的 Agent 活动");
    await expect(activitySummary).toContainText("5 次");
    await expect(board.getByText("注意力负荷线索", { exact: true })).toBeVisible();

    const activity = board.getByRole("region", { name: "工作活动与参与" });
    const groups = activity.locator(".traceink-activity-groups > details");
    await expect(groups).toHaveCount(5);
    const expectedSignals = [
      [GOLDEN_TITLES[0], "09:22–14:28", "正在推进", "共同推进", "code-mode host is disabled", "部分"],
      [GOLDEN_TITLES[1], "09:16–14:25", "正在审计并补齐垂直证据链", "共同推进", "父本/参数动量", "长期真实 campaign 证据仍不足"],
      [GOLDEN_TITLES[2], "12:16–14:28", "COMPLETED", "Agent 独立推进", "Campaign 已关闭", "高"],
      [GOLDEN_TITLES[3], "09:19–13:08", "AWAITING_HUMAN", "Agent 独立推进", "SSH 可达性与认证证据", "高"],
      [GOLDEN_TITLES[4], "08:38–14:23", "今日运行完成", "共同推进", "本地先按", "高"]
    ] as const;
    for (const [title, time, status, participation, stop, evidence] of expectedSignals) {
      const group = groups.filter({ has: page.getByText(title, { exact: true }) });
      await expect(group).toHaveCount(1);
      await expect(group.locator("summary")).toContainText(time);
      await expect(group.locator("summary")).toContainText(status);
      await expect(group.locator("summary")).toContainText(participation);
      await group.locator("summary").click();
      await expect(group.locator(".session-activity-track")).toHaveCount(1);
      await expect(group.getByText("当前停点", { exact: true })).toBeVisible();
      await expect(group).toContainText(stop);
      await expect(group).toContainText(evidence);
    }
    await expect(canonicalDocument.locator("[data-traceink-inert-link=true]")).toHaveCount(3);
    await expect(canonicalDocument.getByText("Watchdog 最新报告", { exact: true })).toBeVisible();

    const stateAfterIndex = await page.evaluate(() => window.agentWhiteboard.getState());
    expect(stateAfterIndex.reviewPreparation.status).toBe("ready");
    expect(stateAfterIndex.traceinkReview.mode).toBe("compiled");
    expect(stateAfterIndex.traceinkReview.activeIndex?.rawMarkdown).toBe(rawMarkdown);
    expect(stateAfterIndex.traceinkReview.activeIndex?.evidence).toHaveLength(5);
    expect(stateAfterIndex.traceinkReview.worklines).toHaveLength(5);
    for (const [index, [sessionId]] of GOLDEN_SESSIONS.entries()) {
      const evidence = stateAfterIndex.traceinkReview.activeIndex?.evidence.find((item) => item.sessionId === sessionId);
      expect(evidence, `golden workline ${index + 1} exact/unique-prefix evidence`).toBeDefined();
      expect(stateAfterIndex.traceinkReview.worklines?.[index]?.presentation?.evidenceIds).toContain(evidence!.id);
    }
    expect(stateAfterIndex.traceinkReview.activeIndex?.producer).toMatchObject({ provider: "codex", model: "gpt-5.6-sol", reasoningConfiguration: "ultra" });
    expect(stateAfterIndex.notebook.todayBoard.mode).toBe("raw");
    expect(stateAfterIndex.notebook.page.status).toBe("unformed");
    expect(stateAfterIndex.notebook.page.packageGenerations).toBeUndefined();
    expect(stateAfterIndex.notebook.page.worklineReflections).toEqual([]);

    await board.getByRole("button", { name: new RegExp(escapeRegex(GOLDEN_TITLES[0])) }).click();
    const dossier = page.getByRole("dialog", { name: GOLDEN_TITLES[0] });
    await expect(dossier).toBeVisible();
    await expect(dossier).toContainText("不把 AI 的候选解释冒充成你的判断", { timeout: 20_000 });
    const evidenceRegister = dossier.getByRole("region", { name: "证据登记" });
    const evidenceButton = evidenceRegister.getByRole("button", { name: new RegExp(GOLDEN_SESSIONS[0][0]) });
    await expect(evidenceButton).toBeVisible();
    await evidenceButton.click();
    const transcript = page.getByRole("dialog", { name: new RegExp(`${escapeRegex(GOLDEN_SESSIONS[0][0])} 会话记录`) });
    await expect(transcript).toBeVisible();
    await expect(transcript).toContainText(GOLDEN_SESSIONS[0][3]);
    await expect(transcript).toContainText(GOLDEN_SESSIONS[0][4]);
    await transcript.getByRole("button", { name: "回到证据" }).click();

    await dossier.getByPlaceholder("写下你的理解、保留意见或下一步判断…").fill(ORIGINAL_REFLECTION);
    await dossier.getByRole("button", { name: "保存我的回顾" }).click();
    await expect(dossier.getByText("已保存版本 1", { exact: true })).toBeVisible();
    await dossier.getByRole("button", { name: "整理我的文字" }).click();
    const categories = ["形成的判断", "明日候选", "CTX 候选", "后台候选", "只留在今天"];
    for (const category of categories) await expect(dossier.getByRole("region", { name: category })).toBeVisible({ timeout: 20_000 });
    await expect(dossier.getByText(ORIGINAL_REFLECTION, { exact: true }).first()).toBeVisible();
    for (const proposalText of Object.values(proposalTexts)) await expect(dossier.getByText(proposalText, { exact: true })).toBeVisible();

    const assetPath = path.join(userData, "traceink-assets-v1.json");
    const storedBeforeRestart = JSON.parse(await fs.readFile(assetPath, "utf8")) as TraceinkAssetStoreDocumentV1;
    expect(storedBeforeRestart.artifacts).toHaveLength(3);
    const storedIndex = storedBeforeRestart.artifacts.find((artifact) => artifact.stage === "index")!;
    const storedDossier = storedBeforeRestart.artifacts.find((artifact) => artifact.stage === "dossier")!;
    const storedProposals = storedBeforeRestart.artifacts.find((artifact) => artifact.stage === "proposals")!;
    expect(storedIndex.rawMarkdown).toBe(rawMarkdown);
    expect(storedIndex.evidence).toHaveLength(5);
    for (const evidence of storedIndex.evidence) {
      expect(evidence).toMatchObject({ kind: "session", provider: "codex" });
      expect(canonicalSessionPaths).toContain(evidence.path);
      expect(evidence.locator).toMatch(/^bytes 0-\d+$/);
      expect(evidence.contentHash).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(storedBeforeRestart.activeIndexByDate[logicalDate]).toMatchObject({ artifactId: storedIndex.id, stage: "index", revision: storedIndex.revision, outputHash: storedIndex.outputHash });
    expect(storedDossier).toMatchObject({ stage: "dossier", revision: 1 });
    expect(storedDossier.evidence).toHaveLength(5);
    expect(storedProposals).toMatchObject({ stage: "proposals", revision: 1, sourceReflection: { reflectionId: storedBeforeRestart.reflections[0]!.id, revision: 1, contentHash: storedBeforeRestart.reflections[0]!.contentHash } });
    expect(storedProposals.navigation).toHaveLength(5);
    expect(storedDossier.worklineId).toBe(storedProposals.worklineId);
    expect(storedBeforeRestart.reflections).toHaveLength(1);
    expect(storedBeforeRestart.reflections[0]).toMatchObject({ text: ORIGINAL_REFLECTION, revision: 1, worklineId: storedDossier.worklineId, dossier: { artifactId: storedDossier.id, stage: "dossier", revision: storedDossier.revision, outputHash: storedDossier.outputHash } });
    expect(storedBeforeRestart.proposalDispositions).toEqual([]);
    await expect(fs.stat(path.join(userData, "notebook-v1.json"))).rejects.toMatchObject({ code: "ENOENT" });
    const invocationsBeforeRestart = await readInvocations(invocationLog);
    const modelInvocationsBeforeRestart = invocationsBeforeRestart.filter((entry) => entry.kind === "model");
    expect(invocationsBeforeRestart.filter((entry) => entry.kind === "features")).toHaveLength(3);
    expect(modelInvocationsBeforeRestart.map((entry) => entry.stage)).toEqual(["index", "dossier", "proposals"]);
    for (const invocation of modelInvocationsBeforeRestart) expect(invocation.args).toContain("gpt-5.6-sol");

    await closeElectronApplication(electronApp);
    electronApp = undefined;
    electronApp = await electron.launch(launchOptions);
    const reloadedPage = await readyWindow(electronApp);
    const reloadedBoard = reloadedPage.locator(".today-board");
    const reloadedDocument = reloadedBoard.getByRole("article", { name: "Traceink 工作脉络正文" });
    for (const title of GOLDEN_TITLES) await expect(reloadedDocument.getByRole("heading", { name: new RegExp(escapeRegex(title)) })).toBeVisible();
    await reloadedBoard.getByRole("button", { name: new RegExp(escapeRegex(GOLDEN_TITLES[0])) }).click();
    const reloadedDossier = reloadedPage.getByRole("dialog", { name: GOLDEN_TITLES[0] });
    await expect(reloadedDossier).toContainText("不把 AI 的候选解释冒充成你的判断");
    await expect(reloadedDossier.getByPlaceholder("写下你的理解、保留意见或下一步判断…")).toHaveValue(ORIGINAL_REFLECTION);
    await expect(reloadedDossier.getByText("已保存版本 1", { exact: true })).toBeVisible();
    for (const category of categories) await expect(reloadedDossier.getByRole("region", { name: category })).toBeVisible();
    const reloadedState = await reloadedPage.evaluate(() => window.agentWhiteboard.getState());
    expect(reloadedState.traceinkReview.activeIndex?.rawMarkdown).toBe(rawMarkdown);
    expect(reloadedState.traceinkReview.worklines?.[0]?.dossier?.rawMarkdown).toBe(dossierMarkdown);
    expect(reloadedState.traceinkReview.worklines?.[0]?.reflection?.text).toBe(ORIGINAL_REFLECTION);
    expect(reloadedState.traceinkReview.worklines?.[0]?.proposalItems).toHaveLength(5);
    expect(reloadedState.notebook.page.status).toBe("unformed");
    expect(JSON.parse(await fs.readFile(assetPath, "utf8"))).toEqual(storedBeforeRestart);
    expect(await readInvocations(invocationLog)).toEqual(invocationsBeforeRestart);
  } finally {
    if (electronApp) await closeElectronApplication(electronApp);
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function readyWindow(electronApp: ElectronApplication): Promise<Page> {
  const page = await electronApp.firstWindow();
  await expect(page.locator(".today-board")).toBeVisible();
  return page;
}

async function closeElectronApplication(application: ElectronApplication): Promise<void> {
  const child = application.process();
  await application.close().catch(() => undefined);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function readInvocations(invocationLog: string): Promise<Array<{ kind: string; stage?: string; args: string[] }>> {
  return (await fs.readFile(invocationLog, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { kind: string; stage?: string; args: string[] });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function localDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = new Map(parts.map((part) => [part.type, part.value]));
  return `${value.get("year")}-${value.get("month")}-${value.get("day")}`;
}

function timestampOnDate(logicalDate: string, timestamp: string): string {
  return `${logicalDate}${timestamp.slice("2026-08-15".length)}`;
}
