import { expect, test, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createEmptyData } from "../../src/state";

test("Electron V2 candidate generates exact index and dossier spans without rotating V1", async () => {
  test.slow();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "work-continuity-message-span-"));
  const home = path.join(root, "home");
  const userData = path.join(root, "user-data");
  const logicalDate = localDateInTimeZone(new Date(), "Asia/Shanghai");
  const [year, month, day] = logicalDate.split("-");
  const scanRoot = path.join(home, ".codex", "sessions", year!, month!, day!);
  const sessionId = "message-span-session";
  const sessionPath = path.join(scanRoot, `rollout-${logicalDate}-${sessionId}.jsonl`);
  const fakeCodex = path.join(root, "fake-message-span-codex.mjs");
  const invocationLog = path.join(root, "message-span-invocations.jsonl");
  const startedAt = new Date(Date.now() - 120_000).toISOString();
  const endedAt = new Date(Date.now() - 60_000).toISOString();
  const transcript = [
    JSON.stringify({ timestamp: startedAt, type: "session_meta", payload: { id: sessionId, cwd: path.join(home, "project"), source: "cli" } }),
    JSON.stringify({ timestamp: startedAt, type: "response_item", payload: { type: "message", id: "user-message-span", role: "user", content: [{ type: "input_text", text: "实现消息级证据，验证第二处引用，并保留第三处依据。" }] } })
  ].join("\n") + "\n";

  await Promise.all([fs.mkdir(userData, { recursive: true }), fs.mkdir(scanRoot, { recursive: true })]);
  await fs.writeFile(sessionPath, transcript, "utf8");
  await fs.writeFile(fakeCodex, fakeProviderScript(invocationLog, sessionId, startedAt, endedAt), { encoding: "utf8", mode: 0o700 });
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
    env: { ...process.env, HOME: home, TZ: "Asia/Shanghai", WORK_CONTINUITY_MESSAGE_SPANS: "1" }
  };
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch(launchOptions);
    let page = await readyWindow(application);
    await expect.poll(async () => (await page.evaluate(() => window.agentWhiteboard.getState())).data.workSessionSnapshot.sessions.length).toBe(1);
    const preview = page.getByRole("region", { name: "消息级 evidence span 候选预览" });
    await expect(preview).toBeVisible();
    await preview.getByRole("button", { name: "生成消息级证据候选" }).click();
    await expect(preview.getByText("消息级证据候选工作线", { exact: true })).toBeVisible({ timeout: 20_000 });
    const firstCitation = preview.getByRole("button", { name: "打开原文证据引用 1/3" }).first();
    await firstCitation.click();
    let dialog = page.getByRole("dialog", { name: /消息级证据/ });
    await expect(dialog.getByText("消息级证据 · 1/3", { exact: true })).toBeVisible();
    await expect(dialog.locator("mark[data-evidence-highlight]")).toHaveText("实现消息级证据");
    await dialog.getByRole("button", { name: /下一条引用/ }).click();
    await expect(dialog.getByText("消息级证据 · 2/3", { exact: true })).toBeVisible();
    await expect(dialog.locator("mark[data-evidence-highlight]")).toHaveText("验证第二处引用");
    await dialog.getByRole("button", { name: /下一条引用/ }).click();
    await expect(dialog.getByText("消息级证据 · 3/3", { exact: true })).toBeVisible();
    await expect(dialog.locator("mark[data-evidence-highlight]")).toHaveText("第三处依据");
    const headerClose = dialog.locator(".structured-span-reader > header button");
    await headerClose.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "回到结论" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(headerClose).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(firstCitation).toBeFocused();

    const secondCitation = preview.getByRole("button", { name: "打开原文证据引用 2/3" }).first();
    await secondCitation.click();
    dialog = page.getByRole("dialog", { name: /消息级证据/ });
    await expect(dialog.getByText("消息级证据 · 2/3", { exact: true })).toBeVisible();
    await expect(dialog.locator("mark[data-evidence-highlight]")).toHaveText("验证第二处引用");
    await page.keyboard.press("Escape");
    await expect(secondCitation).toBeFocused();

    const inferenceCitation = preview.getByRole("button", { name: "打开事实依据引用 1/3" }).first();
    await inferenceCitation.click();
    dialog = page.getByRole("dialog", { name: /消息级证据/ });
    await expect(dialog.getByText(/不直接证明推断结论/u)).toBeVisible();
    await dialog.getByRole("button", { name: "回到结论" }).click();

    await page.setViewportSize({ width: 600, height: 800 });
    await secondCitation.click();
    dialog = page.getByRole("dialog", { name: /消息级证据/ });
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await dialog.getByRole("button", { name: "回到结论" }).click();

    await preview.getByRole("button", { name: "生成深入分析候选" }).click();
    await expect(preview.getByText("消息级证据候选档案", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(preview.getByText("参与归因", { exact: true })).toBeVisible();
    await expect(preview.locator(".structured-v2-dossier").getByText("可能变化", { exact: true })).toBeVisible();
    await expect(preview.getByText("信息缺口 1", { exact: true })).toBeVisible();
    await preview.locator(".structured-v2-dossier").getByRole("button", { name: "打开原文证据引用 2/3" }).first().click();
    dialog = page.getByRole("dialog", { name: /消息级证据/ });
    await expect(dialog.locator("mark[data-evidence-highlight]")).toHaveText("验证第二处引用");
    await dialog.getByRole("button", { name: "回到结论" }).click();

    const state = await page.evaluate(() => window.agentWhiteboard.getState());
    expect(state.structuredTodayV2Candidate.index?.schema).toBe("today-workline-index/v2");
    expect(state.structuredTodayV2Candidate.dossiers).toHaveLength(1);
    expect(state.structuredTodayReview.activeIndex).toBeUndefined();
    const callsBeforeRestart = await invocationStages(invocationLog);
    expect(callsBeforeRestart).toEqual(["digest", "synthesis", "analysis", "critique", "compose"]);

    await application.close();
    application = undefined;
    application = await electron.launch(launchOptions);
    page = await readyWindow(application);
    await expect(page.getByText("消息级证据候选档案", { exact: true })).toBeVisible();
    expect(await invocationStages(invocationLog)).toEqual(callsBeforeRestart);

    const disabledRequest = await page.evaluate(() => {
      const index = window.agentWhiteboard.getState().then((state) => state.structuredTodayV2Candidate.index);
      return index.then((artifact) => artifact ? ({
        owner: {
          kind: "index-v2-candidate" as const,
          logicalDate: artifact.logicalDate,
          artifactId: artifact.artifactId,
          revision: artifact.revision,
          contentHash: artifact.contentHash
        },
        statementId: artifact.worklines[0]!.summary.statementId,
        spanId: artifact.worklines[0]!.summary.spanIds[0]!
      }) : undefined);
    });
    expect(disabledRequest).toBeTruthy();

    await fs.writeFile(sessionPath, transcript.replace("实现消息级证据", "伪造消息级证据"), "utf8");
    const reopenedPreview = page.getByRole("region", { name: "消息级 evidence span 候选预览" });
    await reopenedPreview.getByRole("button", { name: "打开原文证据引用 1/3" }).first().click();
    dialog = page.getByRole("dialog", { name: /消息级证据/ });
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.locator("mark[data-evidence-highlight]")).toHaveCount(0);
    await dialog.getByRole("button", { name: "回到结论" }).click();

    await application.close();
    application = undefined;
    application = await electron.launch({
      ...launchOptions,
      env: { ...launchOptions.env, WORK_CONTINUITY_MESSAGE_SPANS: "0" }
    });
    page = await readyWindow(application);
    const disabledState = await page.evaluate(() => window.agentWhiteboard.getState());
    expect(disabledState.structuredTodayV2Candidate.enabled).toBe(false);
    expect(disabledState.structuredTodayV2Candidate.index).toBeUndefined();
    expect(disabledState.structuredTodayV2Candidate.dossiers).toEqual([]);
    await expect(page.getByRole("region", { name: "消息级 evidence span 候选预览" })).toHaveCount(0);
    const disabledRead = await page.evaluate(async (request) => {
      try {
        await window.agentWhiteboard.getStructuredTodaySpan(request!);
        return "allowed";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }, disabledRequest);
    expect(disabledRead).toMatch(/尚未启用/u);
  } finally {
    if (application) await application.close().catch(() => undefined);
    await fs.rm(root, { recursive: true, force: true });
  }
});

function fakeProviderScript(logPath: string, sessionId: string, startedAt: string, endedAt: string): string {
  return [
    "#!/usr/bin/env node",
    "import fs from 'node:fs';",
    `const logPath = ${JSON.stringify(logPath)};`,
    "const stdin = fs.readFileSync(0, 'utf8');",
    "const key = stdin.match(/msg-v2-[a-f0-9]{64}/)?.[0];",
    "const findings = [...new Set(stdin.match(/finding-v1-[a-f0-9]{64}/g) ?? [])].slice(0, 3);",
    "const statement = (text, relation = 'source-span') => ({text,relation,findingIds:findings});",
    "let stage; let output;",
    `if (stdin.includes('Extract atomic')) { stage='digest'; output={sessionId:${JSON.stringify(sessionId)},findings:[{text:'用户要求实现消息级证据。',claimKind:'fact',messageKey:key,exactQuote:'实现消息级证据'},{text:'用户要求验证第二处引用。',claimKind:'fact',messageKey:key,exactQuote:'验证第二处引用'},{text:'用户要求保留第三处依据。',claimKind:'fact',messageKey:key,exactQuote:'第三处依据'}],uncertainties:[]}; }`,
    `else if (stdin.includes('Reconstruct cross-Session')) { stage='synthesis'; output={worklines:[{worklineId:'workline-message-span',title:'消息级证据候选工作线',summary:statement('用户要求实现消息级证据。'),startedAt:${JSON.stringify(startedAt)},endedAt:${JSON.stringify(endedAt)},currentStop:statement('开始实现消息级证据。'),possibleChange:statement('引用可能可审计。','inference-basis'),participation:{account:{agent:'Agent开始实现。'},statement:statement('用户要求实现消息级证据。')},evidenceReadiness:'ready',sessionIds:[${JSON.stringify(sessionId)}],extensions:[]}],assignments:[{sessionId:${JSON.stringify(sessionId)},worklineIds:['workline-message-span']}],unresolvedSessionIds:[]}; }`,
    "else if (stdin.includes('Analyze only the selected V2')) { stage='analysis'; output={priorContext:statement('用户要求消息级证据。'),whatHappened:statement('开始实现消息级证据。'),possibleChange:statement('引用可能可审计。','inference-basis'),supportingEvidence:[statement('用户要求实现消息级证据。')],opposingEvidence:[],falsifiableObservation:statement('真实Gate可以验证。','inference-basis'),gaps:[statement('仍需验证范围。','inference-basis')]}; }",
    "else if (stdin.includes('Critique the V2 dossier')) { stage='critique'; output={issues:[],missingFindingIds:[]}; }",
    "else if (stdin.includes('Compose the final V2 dossier')) { stage='compose'; output={title:'消息级证据候选档案',priorContext:statement('用户要求消息级证据。'),whatHappened:statement('开始实现消息级证据。'),possibleChange:statement('引用可能可审计。','inference-basis'),supportingEvidence:[statement('用户要求实现消息级证据。')],opposingEvidence:[],falsifiableObservation:statement('真实Gate可以验证。','inference-basis'),gaps:[statement('仍需验证范围。','inference-basis')],humanQuestion:statement('是否继续验证消息级证据？','inference-basis'),extensions:[]}; }",
    "else { console.error('unexpected prompt'); process.exit(2); }",
    "fs.appendFileSync(logPath, JSON.stringify({stage}) + '\\n');",
    "process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(output)}}) + '\\n');"
  ].join("\n");
}

async function readyWindow(application: ElectronApplication): Promise<Page> {
  const page = await application.firstWindow();
  await expect(page.locator(".today-board")).toBeVisible();
  return page;
}

async function invocationStages(filePath: string): Promise<string[]> {
  return (await fs.readFile(filePath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line).stage as string);
}

function localDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}-${parts.find((part) => part.type === "day")!.value}`;
}
