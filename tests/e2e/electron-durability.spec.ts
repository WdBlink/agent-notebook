import { expect, test, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createEmptyNotebookDocument, normalizeNotebookDocument } from "../../app/desktop/notebook-store";
import { createEmptyData } from "../../src/state";
import type { TodayBoardPackageGeneration } from "../../src/today-board";
import type { DailyReviewPackage } from "../../src/workline-review";

test("real Electron save, seal, and relaunch preserve the exact reviewed generation", async () => {
  test.slow();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "work-continuity-electron-durability-"));
  const home = path.join(root, "home");
  const userData = path.join(root, "user-data");
  const emptyScanRoot = path.join(home, "empty-session-root");
  const logicalDate = new Date().toISOString().slice(0, 10);
  await Promise.all([
    fs.mkdir(userData, { recursive: true }),
    fs.mkdir(emptyScanRoot, { recursive: true })
  ]);

  const cockpit = createEmptyData({
    sessionScanRoots: [emptyScanRoot],
    enabledSessionProviders: [],
    sessionSummaryMode: "metadata"
  });
  cockpit.workSessionSnapshot = {
    date: logicalDate,
    generatedAt: `${logicalDate}T18:00:00.000Z`,
    sessions: [],
    sources: [],
    warnings: []
  };

  const evidencePath = path.join(home, "seed-session.jsonl");
  const reviewPackage = seededReviewPackage(logicalDate, evidencePath);
  const generation: TodayBoardPackageGeneration = {
    schemaVersion: 1,
    id: `generation-electron-durability-${logicalDate}`,
    generatedAt: reviewPackage.generatedAt,
    evidenceCutoff: reviewPackage.evidenceCutoff,
    admittedEvidence: [{
      identity: `codex:seed-session:${evidencePath}`,
      revision: "seed-revision-1"
    }],
    package: reviewPackage
  };
  const bookmark = {
    id: "codex:seed-session",
    title: "明天继续真实持久化验证",
    projectName: "electron-durability",
    provider: "codex" as const,
    sessionId: "seed-session",
    sessionPath: evidencePath,
    cwd: home,
    resumeCommand: "codex resume seed-session"
  };
  const notebook = createEmptyNotebookDocument(path.join(home, "LLM-Wiki"));
  notebook.pages[logicalDate] = {
    schemaVersion: 3,
    logicalDate,
    status: "draft",
    createdAt: `${logicalDate}T18:00:00.000Z`,
    updatedAt: `${logicalDate}T18:00:00.000Z`,
    evidenceCutoff: reviewPackage.evidenceCutoff,
    workRecords: [],
    reflection: "真实 Electron 中保留的旧版整页墨迹。",
    reviewPackage,
    packageGenerations: [generation],
    activePackageGenerationId: generation.id,
    worklineReflections: [],
    bookmarks: [bookmark]
  };
  const canonicalSeed = normalizeNotebookDocument(notebook);
  await Promise.all([
    fs.writeFile(path.join(userData, "cockpit-data.json"), `${JSON.stringify(cockpit, null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(userData, "notebook-v1.json"), `${JSON.stringify(canonicalSeed, null, 2)}\n`, "utf8")
  ]);

  const launchOptions = {
    args: [`--user-data-dir=${userData}`, path.resolve("dist/desktop")],
    env: {
      ...process.env,
      HOME: home,
      TZ: "UTC",
      WORK_CONTINUITY_DISABLE_SUMMARIES: "1"
    }
  };
  let electronApp: ElectronApplication | undefined;
  try {
    electronApp = await electron.launch(launchOptions);
    const page = await readyWindow(electronApp);
    const firstState = await page.evaluate(() => window.agentWhiteboard.getState());
    expect(firstState.userDataPath).toBe(await fs.realpath(userData));
    expect(firstState.data.settings.enabledSessionProviders).toEqual([]);
    expect(firstState.data.workSessionSnapshot.sessions).toEqual([]);
    expect(firstState.summaryJob?.status).toBe("idle");

    const board = page.locator(".today-board");
    await expect(board.getByText("真实 Electron 持久化工作线", { exact: true })).toBeVisible();
    await board.locator(".today-workline").first().getByRole("button", { name: "打开材料" }).click();
    const review = page.getByRole("dialog", { name: "日终回看" });
    await expect(review.getByText("真实 IPC 前的完整证据卷宗", { exact: true })).toBeVisible();
    await expect(review.getByText("如果重启后墨迹消失，持久化验证就失败", { exact: true })).toBeVisible();
    await review.getByRole("button", { name: "看完了，开始思考" }).click();
    await review.getByRole("textbox", { name: "你的原始墨迹" }).fill("真实 Electron 写下并持久化的代际墨迹。");
    await review.getByRole("button", { name: "收下这段思考" }).click();
    await expect(review).toHaveCount(0);

    const drafted = await readNotebook(userData);
    expect(drafted.pages[logicalDate]?.status).toBe("draft");
    expect(drafted.pages[logicalDate]?.activePackageGenerationId).toBe(generation.id);
    expect(drafted.pages[logicalDate]?.worklineReflections.map((item) => ({
      packageGenerationId: item.packageGenerationId,
      worklineId: item.worklineId,
      text: item.text
    }))).toEqual([{
      packageGenerationId: generation.id,
      worklineId: "electron-durability-workline",
      text: "真实 Electron 写下并持久化的代际墨迹。"
    }]);

    await board.getByRole("button", { name: "今日收口" }).click();
    await page.getByRole("dialog", { name: "日终回看" }).getByRole("button", { name: "收笔并封存" }).click();
    await expect(board.getByText("已封存", { exact: true }).first()).toBeVisible();
    await expect(board.getByRole("region", { name: "整页墨迹" })).toContainText("真实 Electron 中保留的旧版整页墨迹。");
    await expect(board.getByRole("region", { name: "封存续上" })).toContainText("codex resume seed-session");

    const sealed = await readNotebook(userData);
    const sealedPage = sealed.pages[logicalDate]!;
    expect(sealedPage.status).toBe("sealed");
    expect(sealedPage.activePackageGenerationId).toBe(generation.id);
    expect(sealedPage.packageGenerations).toEqual(canonicalSeed.pages[logicalDate]?.packageGenerations);
    expect(sealedPage.reviewPackage?.provenance).toEqual(reviewPackage.provenance);
    expect(sealedPage.worklineReflections.map((item) => ({
      packageGenerationId: item.packageGenerationId,
      worklineId: item.worklineId,
      text: item.text
    }))).toEqual([{
      packageGenerationId: generation.id,
      worklineId: "electron-durability-workline",
      text: "真实 Electron 写下并持久化的代际墨迹。"
    }]);
    expect(sealedPage.bookmarks).toEqual([bookmark]);
    expect(sealedPage.reflection).toBe("真实 Electron 中保留的旧版整页墨迹。");
    expect(sealedPage.sealedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    await electronApp.close();
    electronApp = undefined;
    electronApp = await electron.launch(launchOptions);
    const reloadedPage = await readyWindow(electronApp);
    const reloadedState = await reloadedPage.evaluate(() => window.agentWhiteboard.getState());
    await expect(reloadedPage.locator(".today-board").getByText("已封存", { exact: true }).first()).toBeVisible();
    await expect(reloadedPage.locator(".today-workline").first()).toContainText("真实 Electron 写下并持久化的代际墨迹。");
    expect(reloadedState.notebook.page).toEqual(sealedPage);
    expect(await readNotebook(userData)).toEqual(sealed);
  } finally {
    await electronApp?.close().catch(() => undefined);
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function readyWindow(electronApp: ElectronApplication): Promise<Page> {
  const page = await electronApp.firstWindow();
  await expect(page.locator(".today-board")).toBeVisible();
  return page;
}

async function readNotebook(userData: string) {
  return JSON.parse(await fs.readFile(path.join(userData, "notebook-v1.json"), "utf8")) as ReturnType<typeof normalizeNotebookDocument>;
}

function seededReviewPackage(logicalDate: string, evidencePath: string): DailyReviewPackage {
  const evidence = [{
    id: "session:codex:seed-session",
    kind: "session" as const,
    label: "真实 Electron 持久化种子",
    path: evidencePath,
    platform: "codex" as const,
    sessionId: "seed-session",
    startedAt: `${logicalDate}T17:00:00.000Z`,
    updatedAt: `${logicalDate}T18:00:00.000Z`
  }];
  return {
    schemaVersion: 1,
    id: `electron-durability-review-${logicalDate}`,
    logicalDate,
    generatedAt: `${logicalDate}T18:00:00.000Z`,
    evidenceCutoff: `${logicalDate}T18:00:00.000Z`,
    promptProfile: "traceink-electron-durability-v1",
    compilerProvider: "codex",
    model: "seeded-review-model",
    evidence,
    worklines: [{
      id: "electron-durability-workline",
      title: "真实 Electron 持久化工作线",
      summary: "用真实 UI、preload、IPC 和原子文件写入验证封存。",
      status: "needs-judgment",
      sourceSessionIds: ["codex:seed-session"],
      participation: [{
        id: "agent-seed",
        kind: "agent",
        startAt: `${logicalDate}T17:00:00.000Z`,
        endAt: `${logicalDate}T18:00:00.000Z`,
        label: "Agent 准备种子材料"
      }],
      dossier: {
        title: "真实 IPC 前的完整证据卷宗",
        dek: "这份材料来自预置草稿，不调用任何 provider CLI。",
        blocks: [{
          id: "prior-state",
          kind: "prior-belief",
          label: "原来的判断",
          title: "持久化必须经过真实桌面边界",
          body: "浏览器内存 mock 不能证明 Electron 主进程写盘。",
          evidenceIds: [evidence[0]!.id],
          payload: {}
        }, {
          id: "observed-change",
          kind: "what-changed",
          label: "发生了什么",
          title: "草稿已预置完整生成来源",
          body: "页面包含模型、提示词、证据与代际 ID。",
          evidenceIds: [evidence[0]!.id],
          payload: {}
        }, {
          id: "future-check",
          kind: "future-watch",
          label: "未来观察",
          title: "如果重启后墨迹消失，持久化验证就失败",
          body: "下次启动若内容改变或消失，就推翻写盘闭环成立的判断。",
          evidenceIds: [evidence[0]!.id],
          payload: {}
        }],
        question: { prompt: "真实重启后，这一页是否仍是同一份封存事实？" }
      },
      payload: {}
    }],
    warnings: [],
    rawOutput: { source: "electron-durability-seed" },
    provenance: {
      compiler: { id: "workline-review", version: "2" },
      promptProfile: "traceink-electron-durability-v1",
      model: { provider: "codex", name: "seeded-review-model" },
      evidence: {
        manifestVersion: "workline-evidence-manifest-v1",
        cutoff: `${logicalDate}T18:00:00.000Z`,
        sourceRefs: evidence,
        completenessWarnings: []
      }
    }
  };
}
