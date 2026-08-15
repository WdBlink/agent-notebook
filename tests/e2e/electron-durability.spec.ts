import { expect, test, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeNotebookDocument } from "../../app/desktop/notebook-store";
import { createEmptyData } from "../../src/state";
import type { DailyReviewPackage } from "../../src/workline-review";

test("real Electron prepares, persists, and reloads the canonical Traceink index without creating a legacy page", async () => {
  test.slow();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "work-continuity-electron-schedule-"));
  const home = path.join(root, "home");
  const userData = path.join(root, "user-data");
  const scanRoot = path.join(home, ".codex", "sessions");
  const logicalDate = new Date().toISOString().slice(0, 10);
  const sessionPath = path.join(scanRoot, `rollout-${logicalDate}-scheduled.jsonl`);
  const fakeCodex = path.join(root, "fake-codex.mjs");
  const invocationLog = path.join(root, "fake-codex-invocations.jsonl");
  const rawMarkdown = [
    `取证范围：${logicalDate}（UTC）。完整读取 1/1 个会话；跳过 0，读取或解析失败 0。`,
    "",
    "1. **后台准备 · Traceink 原始工作脉络**",
    "",
    "   - 状态：定时整理已经完成；尚未产生人的判断或任何迁移动作",
    "   - 会话：Codex `scheduled-session`",
    "   - 参与：`共同推进`——你提出验证目标，Agent 完成本地调度与持久化验证",
    "   - **可能的变化 · AI 整理，尚未采纳：** 打开应用时可以直接阅读已经整理好的工作脉络",
    "   - 可展开证据档案：**是**",
    "",
    "你想展开这条工作线的证据档案吗？"
  ].join("\n");
  await Promise.all([
    fs.mkdir(userData, { recursive: true }),
    fs.mkdir(scanRoot, { recursive: true })
  ]);

  await fs.writeFile(sessionPath, [
    JSON.stringify({ timestamp: `${logicalDate}T09:00:00.000Z`, type: "session_meta", payload: { id: "scheduled-session", cwd: home } }),
    JSON.stringify({ timestamp: `${logicalDate}T09:01:00.000Z`, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "验证每天自动准备工作脉络" }] } }),
    JSON.stringify({ timestamp: `${logicalDate}T09:05:00.000Z`, type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "完成本地调度与原子写入验证。" }] } })
  ].join("\n"), "utf8");

  const transport = { rawMarkdown, transportComplete: true };
  await fs.writeFile(fakeCodex, [
    "#!/usr/bin/env node",
    "import fs from 'node:fs';",
    `fs.appendFileSync(${JSON.stringify(invocationLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
    "if (process.argv[2] === 'features' && process.argv[3] === 'list') {",
    "  process.stdout.write('shell_tool stable true\\nunified_exec stable true\\nview_image stable true\\nskill_search stable true\\n');",
    "  process.exit(0);",
    "}",
    "process.stdin.resume();",
    "process.stdin.on('end', () => {",
    `  const text = ${JSON.stringify(JSON.stringify(transport))};`,
    "  process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}}) + '\\n');",
    "});"
  ].join("\n"), { encoding: "utf8", mode: 0o700 });

  const cockpit = createEmptyData({
    sessionScanRoots: [scanRoot],
    enabledSessionProviders: ["codex"],
    sessionSummaryMode: "native",
    codexCliPath: fakeCodex,
    dailyReviewScheduleEnabled: true,
    dailyReviewScheduleTime: "00:00"
  });
  await fs.writeFile(path.join(userData, "cockpit-data.json"), `${JSON.stringify(cockpit, null, 2)}\n`, "utf8");

  const launchOptions = {
    args: [`--user-data-dir=${userData}`, path.resolve("dist/desktop")],
    env: { ...process.env, HOME: home, TZ: "UTC" }
  };
  let electronApp: ElectronApplication | undefined;
  try {
    electronApp = await electron.launch(launchOptions);
    const page = await readyWindow(electronApp);
    const canonicalDocument = page.getByRole("article", { name: "Traceink 工作脉络正文" });
    await expect(canonicalDocument).toContainText("后台准备 · Traceink 原始工作脉络", { timeout: 15_000 });
    await expect(canonicalDocument).toContainText("AI 整理，尚未采纳");
    await expect(page.locator(".today-workline")).toHaveCount(0);
    const state = await page.evaluate(() => window.agentWhiteboard.getState());
    expect(state.reviewPreparation.status).toBe("ready");
    expect(state.traceinkReview.mode).toBe("compiled");
    expect(state.traceinkReview.activeIndex?.rawMarkdown).toBe(rawMarkdown);
    expect(state.traceinkReview.activeIndex?.producer).toMatchObject({
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningConfiguration: "ultra"
    });
    expect(state.notebook.todayBoard.mode).toBe("raw");
    expect(state.notebook.page.status).toBe("unformed");
    expect(state.notebook.page.packageGenerations).toBeUndefined();
    expect(state.notebook.page.worklineReflections).toEqual([]);

    const assetPath = path.join(userData, "traceink-assets-v1.json");
    const storedBeforeRestart = JSON.parse(await fs.readFile(assetPath, "utf8"));
    expect(storedBeforeRestart.artifacts).toHaveLength(1);
    expect(storedBeforeRestart.artifacts[0].rawMarkdown).toBe(rawMarkdown);
    expect(storedBeforeRestart.reflections).toEqual([]);
    expect(storedBeforeRestart.activeIndexByDate[logicalDate]).toMatchObject({ stage: "index", revision: 1 });
    const invocationsBeforeRestart = (await fs.readFile(invocationLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(invocationsBeforeRestart.filter((args) => args[0] === "features" && args[1] === "list")).toHaveLength(1);
    expect(invocationsBeforeRestart.filter((args) => args.includes("gpt-5.6-sol"))).toHaveLength(1);

    await electronApp.close();
    electronApp = undefined;
    electronApp = await electron.launch(launchOptions);
    const reloadedPage = await readyWindow(electronApp);
    await expect(reloadedPage.getByRole("article", { name: "Traceink 工作脉络正文" })).toContainText("后台准备 · Traceink 原始工作脉络");
    const reloadedState = await reloadedPage.evaluate(() => window.agentWhiteboard.getState());
    expect(reloadedState.traceinkReview.activeIndex?.rawMarkdown).toBe(rawMarkdown);
    expect(reloadedState.notebook.page.status).toBe("unformed");
    expect(JSON.parse(await fs.readFile(assetPath, "utf8"))).toEqual(storedBeforeRestart);
    const invocationsAfterRestart = (await fs.readFile(invocationLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(invocationsAfterRestart.filter((args) => args[0] === "features" && args[1] === "list")).toHaveLength(1);
    expect(invocationsAfterRestart.filter((args) => args.includes("gpt-5.6-sol"))).toHaveLength(1);
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
