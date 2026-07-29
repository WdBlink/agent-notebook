import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const desktopUrl = pathToFileURL(path.resolve("dist/desktop/index.html")).toString();

const baseSessions = [
  {
    id: "019f-work-continuity",
    platform: "codex",
    title: "迁移第一版视觉骨架",
    summary: "第一版比例、留白和会话入口仍需完整迁入独立应用。",
    path: "/tmp/codex-session.jsonl",
    updatedAt: "2026-07-20T14:36:00+08:00",
    projectPath: "/workspace/work-continuity",
    resumable: true,
    summarySource: "codex",
    artifacts: ["app/desktop/renderer.tsx"],
    status: "active"
  },
  {
    id: "claude-map-review",
    platform: "claude",
    title: "复核 Map 居中钻取",
    summary: "节点需要保持空间身份，并可以阅读项目原文。",
    path: "/tmp/claude-session.jsonl",
    updatedAt: "2026-07-20T16:12:00+08:00",
    projectPath: "/workspace/work-continuity",
    resumable: true,
    summarySource: "claude",
    artifacts: [],
    status: "blocked"
  },
  {
    id: "019f-trading",
    platform: "codex",
    title: "确认回测凭证边界",
    summary: "生产与回测连接仍需明确隔离。",
    path: "/tmp/trading.jsonl",
    updatedAt: "2026-07-20T11:08:00+08:00",
    projectPath: "/workspace/vibe-trading",
    resumable: true,
    summarySource: "codex",
    artifacts: [],
    status: "blocked"
  },
  {
    id: "claude-finished",
    platform: "claude",
    title: "完成来源开关审阅",
    summary: "Codex 与 Claude Code 可以独立读取。",
    path: "/tmp/claude-finished.jsonl",
    updatedAt: "2026-07-20T18:22:00+08:00",
    projectPath: "/workspace/work-continuity",
    resumable: false,
    summarySource: "claude",
    artifacts: [],
    status: "completed"
  }
];

async function installDesktopApi(page: Page): Promise<void> {
  await page.addInitScript(({ sessions }) => {
    const createState = (enabledProviders: string[] = ["codex", "claude"], activeDate = "2026-07-20") => ({
      activeDate,
      activityDates: ["2026-07-20", "2026-07-19", "2026-07-18"],
      appVersion: "0.4.0-test",
      userDataPath: "/tmp/work-continuity-test",
      data: {
        schemaVersion: 4,
        settings: {
          dailyNoteFolder: "Daily Cockpit",
          llmEndpoint: "",
          llmModel: "",
          sessionScanRoots: ["~/.codex/sessions", "~/.claude/projects"],
          enabledSessionProviders: enabledProviders,
          sessionSummaryMode: "native",
          runtimeNodePath: "node",
          codexCliPath: "codex",
          claudeCliPath: "claude"
        },
        plans: [],
        workSessionSnapshot: {
          date: activeDate,
          generatedAt: "2026-07-20T19:00:00+08:00",
          sessions: sessions.filter((session: { platform: string }) => enabledProviders.includes(session.platform)),
          sources: ["~/.codex/sessions", "~/.claude/projects"],
          warnings: []
        },
        whiteboard: { schemaVersion: 3, projects: [], nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        whiteboardRevision: 0
      }
    });
    let state = createState();
    const stateListeners: Array<(next: ReturnType<typeof createState>) => void> = [];
    (window as unknown as { openedPaths: string[] }).openedPaths = [];
    (window as unknown as { emitSmartTitle: (title: string) => void }).emitSmartTitle = (title: string) => {
      state = createState(state.data.settings.enabledSessionProviders, state.activeDate);
      const first = state.data.workSessionSnapshot.sessions[0];
      if (first) {
        first.title = title;
        first.summary = "低成本模型生成的后台会话摘要。";
        first.summarySource = first.platform;
      }
      for (const listener of stateListeners) listener(state);
    };
    (window as unknown as { agentWhiteboard: unknown }).agentWhiteboard = {
      getState: async (date?: string) => { state = createState(state.data.settings.enabledSessionProviders, date ?? state.activeDate); return state; },
      refreshSessions: async (date?: string) => { state = createState(state.data.settings.enabledSessionProviders, date ?? state.activeDate); return state; },
      updateSettings: async (patch: { enabledSessionProviders?: string[]; sessionScanRoots?: string[] }) => {
        state = createState(patch.enabledSessionProviders ?? state.data.settings.enabledSessionProviders, state.activeDate);
        if (patch.sessionScanRoots) state.data.settings.sessionScanRoots = patch.sessionScanRoots;
        return state;
      },
      getProjectContext: async (projectPath: string) => ({
        projectPath,
        storePath: "/workspace/work-continuity-ctx",
        warnings: [],
        documents: [
          { id: "overview.md", kind: "overview", label: "产品总览", path: "/workspace/work-continuity-ctx/overview.md", relativePath: "overview.md", content: "# 产品总览\n\n这是 Agent-native work continuity 的当前事实源。", updatedAt: "2026-07-20T18:00:00+08:00" },
          { id: "spec/brief.md", kind: "spec", label: "每日工作简报", path: "/workspace/work-continuity-ctx/spec/brief.md", relativePath: "spec/brief.md", content: "# 每日工作简报\n\n最多显示三条智能接续建议。", updatedAt: "2026-07-20T18:00:00+08:00" }
        ]
      }),
      getSessionTranscript: async (request: { id: string; platform: string; path: string }) => ({
        sessionId: request.id,
        platform: request.platform,
        title: "迁移第一版视觉骨架",
        path: request.path,
        omittedToolEvents: 7,
        truncated: false,
        messages: [
          { id: "user-1", role: "user", timestamp: "2026-07-20T14:30:00+08:00", content: "把原始 Demo 的阅读体验迁入独立应用。" },
          { id: "assistant-1", role: "assistant", timestamp: "2026-07-20T14:36:00+08:00", content: "已保留第一版比例，并加入只读会话记录。" }
        ]
      }),
      chooseDirectory: async () => null,
      copyText: async () => true,
      openPath: async (targetPath: string) => {
        (window as unknown as { openedPaths: string[] }).openedPaths.push(targetPath);
        return true;
      },
      subscribeState: (listener: (next: ReturnType<typeof createState>) => void) => {
        stateListeners.push(listener);
        return () => {
          const index = stateListeners.indexOf(listener);
          if (index >= 0) stateListeners.splice(index, 1);
        };
      }
    };
  }, { sessions: baseSessions });
}

test.beforeEach(async ({ page }) => {
  await installDesktopApi(page);
  await page.goto(desktopUrl);
  await expect(page.locator(".hero-brief")).toBeVisible();
});

test("desktop brief preserves the recovered first-version hierarchy", async ({ page }) => {
  await page.setViewportSize({ width: 1380, height: 683 });
  await expect(page.locator(".brand-mark")).toHaveAttribute("src", "./app-icon.png");
  const logo = await page.locator(".brand-mark").boundingBox();
  const lastNavigationItem = await page.locator(".rail-nav button").last().boundingBox();
  expect(logo?.y).toBeGreaterThanOrEqual(48);
  expect((lastNavigationItem?.y ?? 0) + (lastNavigationItem?.height ?? 0)).toBeLessThan(590);
  await expect(page.locator(".hero-brief")).toBeVisible();
  await expect(page.locator(".continuity-row")).toHaveCount(3);
  await expect(page.locator(".pulse-chart i")).toHaveCount(24);
  await expect(page.locator(".project-strip button").first()).toContainText("02");
  await expect(page.locator(".brief-side")).toHaveCSS("position", "sticky");
  await expect(page.locator(".brief-side")).toHaveCSS("top", "94px");
  await expect(page.locator(".brief-view > .view-heading")).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 420));
  await expect.poll(async () => Math.round((await page.locator(".brief-side").boundingBox())?.y ?? -1)).toBe(94);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("complete session ledger, timeline, command search, and source scope stay connected", async ({ page }) => {
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await expect(page.locator(".sessions-view > .view-heading")).toHaveCount(0);
  await expect(page.locator(".session-ledger article")).toHaveCount(4);
  await page.getByPlaceholder("标题、项目、Session ID 或工作目录").fill("Map");
  await expect(page.locator(".session-ledger article")).toHaveCount(1);
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.locator(".timeline-view > .view-heading")).toHaveCount(0);
  await expect(page.locator(".timeline-event")).toHaveCount(4);
  await page.keyboard.press("Meta+k");
  await page.getByPlaceholder("搜索项目、会话或日期").fill("Vibe");
  await expect(page.locator(".command-results").getByRole("button", { name: /vibe-trading/ }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  await expect(page.getByText("Provider files")).toBeVisible();
});

test("map keeps node identity while focusing and exposes current project source", async ({ page }) => {
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.locator(".map-view > .view-heading")).toHaveCount(0);
  const node = page.locator(".map-node.visible").filter({ hasText: "项目总览" });
  await node.evaluate((element) => ((element as HTMLElement & { identity?: string }).identity = "preserved"));
  const before = await node.boundingBox();
  await node.click();
  await page.waitForTimeout(850);
  const after = await page.locator(".map-node.active").boundingBox();
  expect(await page.locator(".map-node.active").evaluate((element) => (element as HTMLElement & { identity?: string }).identity)).toBe("preserved");
  expect(Math.hypot((before?.x ?? 0) - (after?.x ?? 0), (before?.y ?? 0) - (after?.y ?? 0))).toBeGreaterThan(30);
  const openInDefaultApp = page.getByRole("button", { name: "在默认应用中打开" });
  await expect(openInDefaultApp).toBeVisible();
  await expect(openInDefaultApp).toHaveCSS("color", "rgb(251, 250, 246)");
  await expect(openInDefaultApp).toHaveCSS("background-color", "rgb(32, 33, 30)");
  await openInDefaultApp.click();
  expect(await page.evaluate(() => (window as unknown as { openedPaths: string[] }).openedPaths)).toContain("/workspace/work-continuity-ctx/overview.md");
  await page.getByRole("button", { name: "项目文档", exact: true }).click();
  await page.getByRole("button", { name: "阅读完整原文" }).click();
  await expect(page.locator(".document-drawer pre")).toContainText("Agent-native work continuity");
});

test("narrow window collapses to bottom navigation without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 736, height: 809 });
  const rail = await page.locator(".rail").boundingBox();
  expect(rail?.width).toBe(736);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByRole("button", { name: "Map", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await expect(page.locator(".map-node.active")).toBeVisible();
});

test("background smart titles replace metadata without a manual refresh", async ({ page }) => {
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.evaluate(() => (window as unknown as { emitSmartTitle(title: string): void }).emitSmartTitle("完成会话智能命名链路"));
  await expect(page.getByText("完成会话智能命名链路", { exact: true })).toBeVisible();
  await expect(page.getByText(/Codex AI 摘要/).first()).toBeVisible();
});

test("evidence opens a readable in-app transcript and keeps resume action legible", async ({ page }) => {
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  const session = page.locator(".session-ledger article").filter({ hasText: "迁移第一版视觉骨架" });
  await session.getByRole("button", { name: "详情" }).click();
  const resume = page.getByRole("button", { name: "Copy resume" });
  await expect(resume).toHaveCSS("color", "rgb(251, 250, 246)");
  await expect(resume).toHaveCSS("background-color", "rgb(32, 33, 30)");
  await page.getByRole("button", { name: "打开记录" }).click();
  const reader = page.getByRole("dialog", { name: /迁移第一版视觉骨架 会话记录/ });
  await expect(reader).toBeVisible();
  await expect(reader.getByText("把原始 Demo 的阅读体验迁入独立应用。")).toBeVisible();
  await expect(reader.getByText("已保留第一版比例，并加入只读会话记录。")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { openedPaths: string[] }).openedPaths)).not.toContain("/tmp/codex-session.jsonl");
  await reader.getByRole("button", { name: "回到证据" }).click();
  await expect(page.getByText("Canonical handles")).toBeVisible();
});
