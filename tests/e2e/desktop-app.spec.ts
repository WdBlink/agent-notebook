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
    const createReviewPackage = (activeDate: string): any => ({
      schemaVersion: 1,
      id: `review-${activeDate}`,
      logicalDate: activeDate,
      generatedAt: `${activeDate}T20:00:00+08:00`,
      evidenceCutoff: `${activeDate}T20:00:00+08:00`,
      promptProfile: "traceink-review-v1",
      compilerProvider: "codex",
      model: "review-model",
      evidence: sessions.map((session: any) => ({
        id: `session:${session.platform}:${session.id}`,
        kind: "session",
        label: session.title,
        path: session.path,
        platform: session.platform,
        sessionId: session.id
      })),
      worklines: [
        {
          id: "daily-review-direction",
          title: "Daily Review · 产品方向",
          summary: "真实使用否定了 Session 看板，产品重新聚焦人的日终理解。",
          status: "needs-judgment",
          sourceSessionIds: ["codex:019f-work-continuity", "claude:claude-map-review", "claude:claude-finished"],
          startedAt: `${activeDate}T09:18:00+08:00`,
          endedAt: `${activeDate}T18:22:00+08:00`,
          participation: [
            { id: "user-1", kind: "user", startAt: `${activeDate}T09:18:00+08:00`, endAt: `${activeDate}T09:42:00+08:00`, label: "你参与" },
            { id: "agent-1", kind: "agent", startAt: `${activeDate}T09:42:00+08:00`, endAt: `${activeDate}T16:12:00+08:00`, label: "Agent 独立推进" }
          ],
          dossier: {
            title: "从 Agent 看板转向人的日终回看工作簿",
            dek: "由 3 条跨平台会话按发生顺序重建；这里只呈现材料，不替用户下结论。",
            blocks: [
              { id: "prior", kind: "prior-assumption", label: "原来的判断", title: "首页需要展示 Agent 的运行状态", body: "最初把 Session、运行状态和项目摘要放在同一主界面。", evidenceIds: ["session:codex:019f-work-continuity"], payload: {} },
              { id: "change", kind: "evidence-change", label: "发生了什么", title: "真实使用仍需要重新翻 Session", body: "薄摘要没有减少理解成本，用户无法形成自己的判断。", evidenceIds: ["session:codex:019f-work-continuity", "session:claude:claude-map-review"], payload: {} },
              { id: "scope", kind: "scope-tension", label: "未来观察", title: "十五分钟内能否完成一条工作线的回看", body: "如果材料包有效，用户应能少翻原始 Session，同时仍亲自完成思考。", evidenceIds: ["session:claude:claude-finished"], payload: { futureField: "preserved" } }
            ],
            question: { prompt: "这套材料是否已经足以让你亲自想明白？", context: "AI 不能替用户决定产品方向。" }
          },
          payload: {}
        },
        {
          id: "trading-credentials",
          title: "Vibe Trading · 凭证隔离",
          summary: "生产与回测连接仍需明确隔离。",
          status: "running",
          sourceSessionIds: ["codex:019f-trading"],
          participation: [{ id: "agent-2", kind: "running", label: "Agent 仍在运行" }],
          dossier: {
            title: "凭证隔离仍在只读核查",
            dek: "当前不需要人的新判断。",
            blocks: [{ id: "status", kind: "current-state", label: "当前状态", title: "检查尚未完成", body: "新的运行结果会在下次回看时另行呈现。", evidenceIds: ["session:codex:019f-trading"], payload: {} }]
          },
          payload: {}
        }
      ],
      warnings: [],
      rawOutput: { worklines: [{ id: "daily-review-direction" }, { id: "trading-credentials" }] }
    });
    const createNotebook = (activeDate: string, scopedSessions: typeof sessions): any => {
      const groups = new Map<string, typeof scopedSessions>();
      for (const session of scopedSessions) {
        const key = session.projectPath ?? `unresolved:${session.platform}`;
        groups.set(key, [...(groups.get(key) ?? []), session]);
      }
      const previewRecords = [...groups.entries()].map(([projectKey, records], index) => ({
        id: `record-${index}`,
        projectKey,
        projectName: projectKey.split("/").pop() ?? projectKey,
        title: records.length > 1 ? `${records[0]?.title}，并推进 ${records.length - 1} 条相关工作` : records[0]?.title ?? "工作记录",
        summary: records.map((session) => session.summary).join(" "),
        changed: `${records.length} 条会话被归并为一条项目脉络。`,
        uncertainty: records.some((session) => session.status === "blocked") ? "仍有工作受边界阻塞。" : "当前没有额外的未确认边界。",
        occurredAt: records.at(-1)?.updatedAt ?? "2026-07-20T18:00:00+08:00",
        sessions: records.map((session) => ({ id: session.id, platform: session.platform, path: session.path, title: session.title }))
      }));
      const continuationCandidates = scopedSessions.filter((session) => session.status !== "completed").slice(0, 3).map((session) => ({
        id: `${session.platform}:${session.id}:${session.path}`,
        title: session.title,
        projectName: session.projectPath?.split("/").pop() ?? session.platform,
        provider: session.platform,
        sessionId: session.id,
        sessionPath: session.path,
        cwd: session.projectPath,
        resumeCommand: `${session.platform} resume ${session.id}`
      }));
      return {
        notes: [{ id: "note-1", logicalDate: activeDate, createdAt: "2026-07-20T09:18:00+08:00", updatedAt: "2026-07-20T09:18:00+08:00", title: "手帐不是 Agent 平台", body: "真正需要承载的是每天收工时的思维停点，而不是另一套运行监控。", kind: "thought", sourceLabel: "个人记录", favorite: true, deliveries: [] }],
        page: { schemaVersion: 1, logicalDate: activeDate, status: "unformed", workRecords: [], reflection: "", worklineReflections: [], bookmarks: [] },
        previewRecords,
        continuationCandidates,
        knowledgeRoot: "/workspace/LLM-Wiki",
        knowledgeRawPath: "/workspace/LLM-Wiki/raw",
        pendingPreviousDates: []
      };
    };
    const createState = (enabledProviders: string[] = ["codex", "claude"], activeDate = "2026-07-20") => {
      const scopedSessions = sessions.filter((session: { platform: string }) => enabledProviders.includes(session.platform));
      return ({
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
          sessions: scopedSessions,
          sources: ["~/.codex/sessions", "~/.claude/projects"],
          warnings: []
        },
        whiteboard: { schemaVersion: 3, projects: [], nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        whiteboardRevision: 0
      },
      notebook: createNotebook(activeDate, scopedSessions)
    });
    };
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
      updateSettings: async (patch: { enabledSessionProviders?: string[]; sessionScanRoots?: string[]; knowledgeRoot?: string }) => {
        state = createState(patch.enabledSessionProviders ?? state.data.settings.enabledSessionProviders, state.activeDate);
        if (patch.sessionScanRoots) state.data.settings.sessionScanRoots = patch.sessionScanRoots;
        if (patch.knowledgeRoot) {
          state.notebook.knowledgeRoot = patch.knowledgeRoot;
          state.notebook.knowledgeRawPath = `${patch.knowledgeRoot}/raw`;
        }
        return state;
      },
      createNotebookNote: async (date: string, input: { title?: string; body: string }) => {
        state.notebook.notes.push({ id: `note-${state.notebook.notes.length + 1}`, logicalDate: date, createdAt: "2026-07-20T20:10:00+08:00", updatedAt: "2026-07-20T20:10:00+08:00", title: input.title || input.body.slice(0, 18), body: input.body, kind: "thought", sourceLabel: "个人记录", favorite: false, deliveries: [] });
        return state.notebook;
      },
      updateNotebookNote: async (noteId: string, patch: Record<string, unknown>) => {
        const note = state.notebook.notes.find((item: any) => item.id === noteId);
        if (note) Object.assign(note, patch);
        return state.notebook;
      },
      deleteNotebookNote: async (noteId: string) => {
        state.notebook.notes = state.notebook.notes.filter((item: any) => item.id !== noteId);
        return state.notebook;
      },
      exportNotebookNoteCard: async (noteId: string) => ({ notebook: state.notebook, path: `/tmp/${noteId}.svg` }),
      routeNotebookNoteToWiki: async (noteId: string) => {
        const note = state.notebook.notes.find((item: any) => item.id === noteId);
        note?.deliveries.push({ kind: "wiki", deliveredAt: "2026-07-20T20:12:00+08:00", target: `/workspace/LLM-Wiki/raw/${noteId}.md`, status: "queued" });
        return { notebook: state.notebook, path: `/workspace/LLM-Wiki/raw/${noteId}.md` };
      },
      routeNotebookNoteToProject: async (noteId: string) => ({ notebook: state.notebook, path: `/workspace/work-continuity/ctx/scratch/inbox/${noteId}.md` }),
      prepareDailyReview: async (_date: string, _mode: "compile" | "refresh") => {
        state.notebook.page = { ...state.notebook.page, schemaVersion: 3, status: "draft", createdAt: "2026-07-20T20:00:00+08:00", updatedAt: "2026-07-20T20:00:00+08:00", evidenceCutoff: "2026-07-20T20:00:00+08:00", workRecords: state.notebook.previewRecords, reviewPackage: createReviewPackage(state.activeDate), worklineReflections: [] };
        return state.notebook;
      },
      composeDailyPage: async () => {
        state.notebook.page = { ...state.notebook.page, schemaVersion: 2, status: "draft", createdAt: "2026-07-20T20:00:00+08:00", updatedAt: "2026-07-20T20:00:00+08:00", evidenceCutoff: "2026-07-20T20:00:00+08:00", workRecords: state.notebook.previewRecords, reviewPackage: createReviewPackage(state.activeDate), worklineReflections: [] };
        return state.notebook;
      },
      saveDailyDraft: async (_date: string, input: { reflection: string; worklineReflections?: Array<{ worklineId: string; text: string }>; bookmarkIds: string[] }) => {
        state.notebook.page.reflection = input.reflection;
        if (input.worklineReflections) state.notebook.page.worklineReflections = input.worklineReflections.map((item) => ({ ...item, updatedAt: "2026-07-20T21:00:00+08:00" }));
        state.notebook.page.bookmarks = state.notebook.continuationCandidates.filter((item: any) => input.bookmarkIds.includes(item.id));
        return state.notebook;
      },
      sealDailyPage: async (_date: string, input: { reflection: string; worklineReflections?: Array<{ worklineId: string; text: string }>; bookmarkIds: string[] }) => {
        state.notebook.page.reflection = input.reflection;
        if (input.worklineReflections) state.notebook.page.worklineReflections = input.worklineReflections.map((item) => ({ ...item, updatedAt: "2026-07-20T22:16:00+08:00" }));
        state.notebook.page.bookmarks = state.notebook.continuationCandidates.filter((item: any) => input.bookmarkIds.includes(item.id));
        state.notebook.page.status = "sealed";
        state.notebook.page.sealedAt = "2026-07-20T22:16:00+08:00";
        return state.notebook;
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
  await expect(page.locator(".today-ledger")).toBeVisible();
});

test("today notebook keeps the native shell and two independently scrolling panes", async ({ page }) => {
  await page.setViewportSize({ width: 1380, height: 683 });
  await expect(page.locator(".brand-mark")).toHaveAttribute("src", "./app-icon.png");
  const logo = await page.locator(".brand-mark").boundingBox();
  const lastNavigationItem = await page.locator(".rail-nav button").last().boundingBox();
  expect(logo?.y).toBeGreaterThanOrEqual(48);
  expect((lastNavigationItem?.y ?? 0) + (lastNavigationItem?.height ?? 0)).toBeLessThan(590);
  await expect(page.locator(".capture-card")).toHaveCount(1);
  await expect(page.locator(".daily-record")).toHaveCount(2);
  await expect(page.locator(".project-strip button").first()).toContainText("02");
  await expect(page.locator(".capture-tray")).toHaveCSS("overflow-y", "auto");
  await expect(page.locator(".daily-canvas")).toHaveCSS("overflow-y", "auto");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("a note stays local until the paper-plane route is explicitly chosen", async ({ page }) => {
  await page.getByRole("button", { name: "新建便签" }).click();
  await page.getByRole("textbox", { name: "便签正文" }).fill("记录一个新的产品判断");
  await page.getByRole("button", { name: "收下" }).click();
  await expect(page.locator(".capture-card").last()).toContainText("记录一个新的产品判断");
  await page.getByRole("button", { name: "分享便签" }).click();
  await page.getByRole("button", { name: /归入 LLM-Wiki/ }).click();
  await expect(page.getByText("WIKI", { exact: true })).toBeVisible();
});

test("end-of-day flow stores personal ink and seals an immutable page", async ({ page }) => {
  await page.getByRole("button", { name: "开始整理今天" }).click();
  const ritual = page.getByRole("dialog", { name: "日终回看" });
  await ritual.locator(".review-workline").first().click();
  await ritual.getByRole("button", { name: "看完了，开始思考" }).click();
  await ritual.getByRole("textbox", { name: "你的原始墨迹" }).fill("今天到这里，明天继续验证闭环。");
  await ritual.getByRole("button", { name: "收下这段思考" }).click();
  await ritual.getByRole("button", { name: "今日收口" }).click();
  await ritual.locator(".bookmark-choices button").first().click();
  await ritual.getByRole("button", { name: "收笔并封存" }).click();
  await expect(page.getByText("今天到这里", { exact: true })).toBeVisible();
  await expect(page.getByText("今天到这里，明天继续验证闭环。")).toBeVisible();
  await expect(page.getByRole("button", { name: "开始整理今天" })).toHaveCount(0);
});

test("daily review reconstructs worklines before the user writes their own reflection", async ({ page }) => {
  await page.getByRole("button", { name: "开始整理今天" }).click();
  const review = page.getByRole("dialog", { name: "日终回看" });
  await expect(review).toBeVisible();
  await expect(review.locator(".review-workline")).toHaveCount(2);
  await expect(review.getByText("你参与", { exact: true })).toBeVisible();
  await expect(review.getByText("Agent 独立推进", { exact: true })).toBeVisible();

  await review.locator(".review-workline").first().click();
  await expect(review.getByText("从 Agent 看板转向人的日终回看工作簿", { exact: true })).toBeVisible();
  await expect(review.getByText("AI 整理", { exact: true })).toBeVisible();
  await expect(review.getByText("这套材料是否已经足以让你亲自想明白？", { exact: true })).toBeVisible();

  await review.getByRole("button", { name: "看完了，开始思考" }).click();
  const ink = review.getByRole("textbox", { name: "你的原始墨迹" });
  await expect(ink).toHaveValue("");
  await ink.fill("我认为先让材料真正减少 Session 翻找，才值得继续增加能力。");
  await review.getByRole("button", { name: "收下这段思考" }).click();
  await expect(review.locator(".review-workline").first()).toContainText("已写下思考");
  await review.locator(".review-workline").first().click();
  await review.getByRole("button", { name: "查看我的思考" }).click();
  await expect(ink).toHaveValue("我认为先让材料真正减少 Session 翻找，才值得继续增加能力。");
});

test("daily review remains usable without horizontal overflow in a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 620 });
  await page.getByRole("button", { name: "开始整理今天" }).click();
  const review = page.getByRole("dialog", { name: "日终回看" });
  await expect(review.locator(".review-workline")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await review.locator(".review-workline").first().click();
  await expect(review.getByRole("button", { name: "看完了，开始思考" })).toBeVisible();
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
  const ledger = await page.locator(".today-ledger").boundingBox();
  expect(rail?.width).toBe(736);
  expect((ledger?.y ?? 0) + (ledger?.height ?? 0)).toBeLessThanOrEqual(rail?.y ?? 809);
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
