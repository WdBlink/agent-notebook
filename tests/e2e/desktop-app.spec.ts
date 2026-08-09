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
    startedAt: "2026-07-20T09:18:00+08:00",
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
    startedAt: "2026-07-20T10:02:00+08:00",
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
    startedAt: "2026-07-20T10:48:00+08:00",
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
    startedAt: "2026-07-20T17:46:00+08:00",
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
    const storedPackageSessions = sessions.map((session: any) => ({ ...session }));
    let reviewPromptProfile = "traceink-review-v1";
    const createReviewPackage = (activeDate: string, includeDuplicate = false): any => ({
      schemaVersion: 1,
      id: `review-${activeDate}`,
      logicalDate: activeDate,
      generatedAt: `${activeDate}T20:00:00+08:00`,
      evidenceCutoff: `${activeDate}T20:00:00+08:00`,
      promptProfile: reviewPromptProfile,
      compilerProvider: "codex",
      model: "review-model",
      evidence: [...storedPackageSessions.map((session: any) => ({
        id: `session:${session.platform}:${session.id}`,
        kind: "session",
        label: session.title,
        path: session.path,
        platform: session.platform,
        sessionId: session.id,
        startedAt: session.startedAt,
        updatedAt: session.updatedAt
      })), ...(includeDuplicate ? [{
        id: "session:codex:019f-work-continuity:alternate",
        kind: "session",
        label: "同 ID 的另一条路径",
        path: "/tmp/codex-session-alternate.jsonl",
        platform: "codex",
        sessionId: "019f-work-continuity",
        startedAt: `${activeDate}T08:00:00+08:00`,
        updatedAt: `${activeDate}T08:30:00+08:00`
      }] : [])],
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
    type TodayScenario = "raw" | "compiled" | "stale" | "sealed" | "duplicate";
    const sessionIdentity = (session: any): string => `${session.platform}:${session.id}:${session.path}`;
    const createActivity = (activeDate: string, scopedSessions: typeof sessions): any => ({
      logicalDate: activeDate,
      lanes: scopedSessions.map((session: any, index: number) => ({
        identity: sessionIdentity(session),
        sessionId: session.id,
        platform: session.platform,
        path: session.path,
        operationalState: session.status === "active" ? "running" : "not-running",
        confidence: index === 2 ? "uncertain" : "observed",
        timeRange: { start: session.startedAt, end: session.updatedAt },
        userInterventions: index === 0
          ? [{ id: "user-1", timestamp: `${activeDate}T09:18:00+08:00` }, { id: "user-2", timestamp: `${activeDate}T14:30:00+08:00` }]
          : index === 1
            ? [{ id: "user-3", timestamp: `${activeDate}T10:02:00+08:00` }]
            : [],
        agentActivityWindows: index === 0
          ? [{ start: `${activeDate}T14:30:00+08:00`, end: `${activeDate}T14:36:00+08:00`, durationMs: 360000, basis: "timestamped-user-to-assistant", coverage: "observed" }]
          : index === 1
            ? [{ start: `${activeDate}T10:02:00+08:00`, end: `${activeDate}T10:18:00+08:00`, durationMs: 960000, basis: "timestamped-user-to-assistant", coverage: "observed" }]
            : [],
        warnings: index === 2 ? ["部分消息缺少时间戳，无法推断持续时间。"] : []
      })),
      facts: {
        userInterventionCount: 3,
        observedAgentActivityMs: 1320000,
        observedConcurrentAgentActivityMs: 0,
        peakObservedAgentConcurrency: 1,
        contextSwitchCount: 2,
        confidence: "uncertain",
        basis: {
          userInterventions: "timestamped-user-messages",
          agentActivity: "union-of-timestamped-user-to-assistant-response-windows",
          concurrency: "overlap-of-observed-agent-response-windows",
          contextSwitches: "chronological-timestamped-user-session-transitions"
        }
      }
    });
    const createNotebook = (activeDate: string, scopedSessions: typeof sessions, scenario: TodayScenario): any => {
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
      const reviewPackage = createReviewPackage(activeDate, scenario === "duplicate");
      const generation = {
        schemaVersion: 1,
        id: `generation-${activeDate}-1`,
        generatedAt: reviewPackage.generatedAt,
        evidenceCutoff: reviewPackage.evidenceCutoff,
        admittedEvidence: scopedSessions.map((session: any) => ({ identity: sessionIdentity(session), revision: `revision:${session.updatedAt}` })),
        package: reviewPackage
      };
      const previousGeneration = {
        ...generation,
        id: `generation-${activeDate}-0`,
        generatedAt: `${activeDate}T19:00:00+08:00`,
        evidenceCutoff: `${activeDate}T19:00:00+08:00`,
        package: {
          ...reviewPackage,
          id: `review-${activeDate}-previous`,
          generatedAt: `${activeDate}T19:00:00+08:00`,
          evidenceCutoff: `${activeDate}T19:00:00+08:00`
        }
      };
      const hasPackage = scenario !== "raw";
      const boardMode = scenario === "duplicate" ? "compiled" : scenario;
      const pageStatus = scenario === "sealed" ? "sealed" : hasPackage ? "draft" : "unformed";
      const uncompiledEvidence = scenario === "raw"
        ? scopedSessions.map((session: any) => ({ identity: sessionIdentity(session), revision: `revision:${session.updatedAt}` }))
        : scenario === "stale"
          ? scopedSessions.filter((session: any) => session.id === "claude-finished").map((session: any) => ({ identity: sessionIdentity(session), revision: "revision:new-evidence" }))
          : [];
      return {
        notes: [{ id: "note-1", logicalDate: activeDate, createdAt: "2026-07-20T09:18:00+08:00", updatedAt: "2026-07-20T09:18:00+08:00", title: "手帐不是 Agent 平台", body: "真正需要承载的是每天收工时的思维停点，而不是另一套运行监控。", kind: "thought", sourceLabel: "个人记录", favorite: true, deliveries: [] }],
        page: {
          schemaVersion: 3,
          logicalDate: activeDate,
          status: pageStatus,
          workRecords: hasPackage ? previewRecords : [],
          reflection: scenario === "sealed" ? "封页以后仍保留人的原始判断。" : "",
          worklineReflections: scenario === "sealed" ? [
            { packageGenerationId: previousGeneration.id, worklineId: "daily-review-direction", text: "旧代墨迹不应展示。", updatedAt: `${activeDate}T19:30:00+08:00` },
            { packageGenerationId: generation.id, worklineId: "daily-review-direction", text: "封页以后仍保留人的原始判断。", updatedAt: `${activeDate}T22:16:00+08:00` }
          ] : [],
          bookmarks: scenario === "sealed" ? continuationCandidates.slice(0, 1) : [],
          ...(hasPackage ? {
            createdAt: `${activeDate}T20:00:00+08:00`,
            updatedAt: `${activeDate}T20:00:00+08:00`,
            evidenceCutoff: generation.evidenceCutoff,
            reviewPackage,
            packageGenerations: scenario === "sealed" ? [previousGeneration, generation] : [generation],
            activePackageGenerationId: generation.id
          } : {}),
          ...(scenario === "sealed" ? { sealedAt: `${activeDate}T22:16:00+08:00` } : {})
        },
        todayBoard: {
          mode: boardMode,
          ...(hasPackage ? { activeGeneration: generation } : {}),
          uncompiledEvidence
        },
        previewRecords,
        continuationCandidates,
        knowledgeRoot: "/workspace/LLM-Wiki",
        knowledgeRawPath: "/workspace/LLM-Wiki/raw",
        pendingPreviousDates: []
      };
    };
    const createState = (enabledProviders: string[] = ["codex", "claude"], activeDate = "2026-07-20", scenario: TodayScenario = "raw") => {
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
      notebook: createNotebook(activeDate, scopedSessions, scenario),
      activity: createActivity(activeDate, scopedSessions)
    });
    };
    const readPersistedSnapshot = (): any | null => {
      try {
        const value = JSON.parse(window.name || "null");
        return value?.marker === "traceink-e2e-sealed-v1" ? value : null;
      } catch {
        return null;
      }
    };
    const restorePersistedState = (snapshot: any): ReturnType<typeof createState> => {
      const restored = createState(undefined, snapshot.activeDate, "sealed");
      restored.notebook.page = structuredClone(snapshot.page);
      const activeGeneration = restored.notebook.page.packageGenerations?.find((generation: any) => generation.id === restored.notebook.page.activePackageGenerationId);
      restored.notebook.todayBoard = {
        mode: "sealed",
        ...(activeGeneration ? { activeGeneration } : {}),
        uncompiledEvidence: []
      };
      return restored;
    };
    let persistedSnapshot = readPersistedSnapshot();
    let scenario: TodayScenario = persistedSnapshot ? "sealed" : "raw";
    let prepareShouldFail = false;
    let prepareCalls = persistedSnapshot?.prepareCalls ?? 0;
    const sideEffectCounts = persistedSnapshot?.sideEffectCounts ?? { wiki: 0, ctx: 0, background: 0 };
    let state = persistedSnapshot ? restorePersistedState(persistedSnapshot) : createState(undefined, undefined, scenario);
    const stateListeners: Array<(next: ReturnType<typeof createState>) => void> = [];
    const notifyState = (): void => { for (const listener of stateListeners) listener(state); };
    const persistSealedState = (): void => {
      persistedSnapshot = {
        marker: "traceink-e2e-sealed-v1",
        activeDate: state.activeDate,
        page: structuredClone(state.notebook.page),
        prepareCalls,
        sideEffectCounts: structuredClone(sideEffectCounts)
      };
      window.name = JSON.stringify(persistedSnapshot);
    };
    const loadState = (date?: string): ReturnType<typeof createState> => {
      if (!date || date === state.activeDate) return state;
      if (persistedSnapshot && date === persistedSnapshot.activeDate) {
        scenario = "sealed";
        state = restorePersistedState(persistedSnapshot);
      } else {
        scenario = "raw";
        state = createState(state.data.settings.enabledSessionProviders, date, scenario);
      }
      return state;
    };
    (window as unknown as { openedPaths: string[] }).openedPaths = [];
    (window as unknown as { transcriptRequests: unknown[] }).transcriptRequests = [];
    (window as unknown as { copiedTexts: string[] }).copiedTexts = [];
    (window as unknown as { setTodayScenario: (next: TodayScenario) => void }).setTodayScenario = (next: TodayScenario) => {
      persistedSnapshot = null;
      window.name = "";
      scenario = next;
      state = createState(state.data.settings.enabledSessionProviders, state.activeDate, scenario);
      notifyState();
    };
    (window as unknown as { setPrepareFailure: (fail: boolean) => void }).setPrepareFailure = (fail: boolean) => { prepareShouldFail = fail; };
    (window as unknown as { prepareCallCount: () => number }).prepareCallCount = () => prepareCalls;
    (window as unknown as { advanceTodayGeneration: () => void }).advanceTodayGeneration = () => {
      const current = state.notebook.todayBoard.activeGeneration;
      if (!current) throw new Error("No active generation");
      const nextIndex = (state.notebook.page.packageGenerations?.length ?? 0) + 1;
      const nextPackage = structuredClone(current.package);
      nextPackage.id = `review-${state.activeDate}-${nextIndex}`;
      nextPackage.generatedAt = `${state.activeDate}T21:00:00+08:00`;
      nextPackage.evidenceCutoff = `${state.activeDate}T21:00:00+08:00`;
      nextPackage.promptProfile = reviewPromptProfile;
      const nextGeneration = {
        ...structuredClone(current),
        id: `generation-${state.activeDate}-${nextIndex}`,
        generatedAt: nextPackage.generatedAt,
        evidenceCutoff: nextPackage.evidenceCutoff,
        package: nextPackage
      };
      state.notebook.page.packageGenerations = [...(state.notebook.page.packageGenerations ?? []), nextGeneration];
      state.notebook.page.activePackageGenerationId = nextGeneration.id;
      state.notebook.page.reviewPackage = nextPackage;
      state.notebook.todayBoard = { mode: "compiled", activeGeneration: nextGeneration, uncompiledEvidence: [] };
      state = structuredClone(state);
      notifyState();
    };
    (window as unknown as { setLegacyPageReflection: (text: string) => void }).setLegacyPageReflection = (text: string) => {
      state.notebook.page.reflection = text;
      state = structuredClone(state);
      notifyState();
    };
    (window as unknown as { setLegacySealedPage: (text: string) => void }).setLegacySealedPage = (text: string) => {
      state.notebook.page = {
        schemaVersion: 3,
        logicalDate: state.activeDate,
        status: "sealed",
        sealedAt: `${state.activeDate}T22:16:00+08:00`,
        workRecords: [],
        reflection: text,
        worklineReflections: [],
        bookmarks: state.notebook.continuationCandidates.slice(0, 1)
      };
      state.notebook.todayBoard = { mode: "sealed", uncompiledEvidence: [] };
      state = structuredClone(state);
      notifyState();
    };
    (window as unknown as { sealedPageJson: () => string }).sealedPageJson = () => JSON.stringify(state.notebook.page);
    (window as unknown as { mutateLiveInputs: () => void }).mutateLiveInputs = () => {
      const first = state.data.workSessionSnapshot.sessions[0];
      if (first) first.title = "封页后的 Session 新标题";
      reviewPromptProfile = "traceink-review-v2-after-seal";
      state = structuredClone(state);
      notifyState();
    };
    (window as unknown as { liveInputSnapshot: () => unknown }).liveInputSnapshot = () => ({
      sessionTitle: state.data.workSessionSnapshot.sessions[0]?.title,
      promptProfile: reviewPromptProfile
    });
    (window as unknown as { e2eSideEffectCounts: () => unknown }).e2eSideEffectCounts = () => structuredClone(sideEffectCounts);
    (window as unknown as { emitSmartTitle: (title: string) => void }).emitSmartTitle = (title: string) => {
      state = createState(state.data.settings.enabledSessionProviders, state.activeDate, scenario);
      const first = state.data.workSessionSnapshot.sessions[0];
      if (first) {
        first.title = title;
        first.summary = "低成本模型生成的后台会话摘要。";
        first.summarySource = first.platform;
      }
      for (const listener of stateListeners) listener(state);
    };
    (window as unknown as { agentWhiteboard: unknown }).agentWhiteboard = {
      getState: async (date?: string) => loadState(date),
      refreshSessions: async (date?: string) => loadState(date),
      updateSettings: async (patch: { enabledSessionProviders?: string[]; sessionScanRoots?: string[]; knowledgeRoot?: string }) => {
        state = createState(patch.enabledSessionProviders ?? state.data.settings.enabledSessionProviders, state.activeDate, scenario);
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
        sideEffectCounts.wiki += 1;
        const note = state.notebook.notes.find((item: any) => item.id === noteId);
        note?.deliveries.push({ kind: "wiki", deliveredAt: "2026-07-20T20:12:00+08:00", target: `/workspace/LLM-Wiki/raw/${noteId}.md`, status: "queued" });
        return { notebook: state.notebook, path: `/workspace/LLM-Wiki/raw/${noteId}.md` };
      },
      routeNotebookNoteToProject: async (noteId: string) => {
        sideEffectCounts.ctx += 1;
        return { notebook: state.notebook, path: `/workspace/work-continuity/ctx/scratch/inbox/${noteId}.md` };
      },
      prepareDailyReview: async (_date: string, _mode: "compile" | "refresh") => {
        prepareCalls += 1;
        if (prepareShouldFail) {
          state.notebook.todayBoard.compilationError = "整理模型暂时不可用；上一版仍然可读。";
          notifyState();
          throw new Error("整理模型暂时不可用；上一版仍然可读。");
        }
        scenario = "compiled";
        state = createState(state.data.settings.enabledSessionProviders, state.activeDate, scenario);
        notifyState();
        return state.notebook;
      },
      composeDailyPage: async () => {
        scenario = "compiled";
        state = createState(state.data.settings.enabledSessionProviders, state.activeDate, scenario);
        return state.notebook;
      },
      saveDailyDraft: async (_date: string, input: { reflection: string; worklineReflections?: Array<{ worklineId: string; text: string }>; bookmarkIds: string[] }) => {
        state.notebook.page.reflection = input.reflection;
        if (input.worklineReflections) {
          const activeGenerationId = state.notebook.page.activePackageGenerationId;
          state.notebook.page.worklineReflections = [
            ...state.notebook.page.worklineReflections.filter((item: any) => item.packageGenerationId !== activeGenerationId),
            ...input.worklineReflections.map((item) => ({ ...item, packageGenerationId: activeGenerationId, updatedAt: "2026-07-20T21:00:00+08:00" }))
          ];
        }
        state.notebook.page.bookmarks = state.notebook.continuationCandidates.filter((item: any) => input.bookmarkIds.includes(item.id));
        return state.notebook;
      },
      sealDailyPage: async (_date: string, input: { reflection: string; worklineReflections?: Array<{ worklineId: string; text: string }>; bookmarkIds: string[]; expectedActiveGenerationId: string | null }) => {
        if (!state.notebook.page.activePackageGenerationId || input.expectedActiveGenerationId !== state.notebook.page.activePackageGenerationId) throw new Error("active generation mismatch");
        state.notebook.page.reflection = input.reflection;
        if (input.worklineReflections) {
          const activeGenerationId = state.notebook.page.activePackageGenerationId;
          state.notebook.page.worklineReflections = [
            ...state.notebook.page.worklineReflections.filter((item: any) => item.packageGenerationId !== activeGenerationId),
            ...input.worklineReflections.map((item) => ({ ...item, packageGenerationId: activeGenerationId, updatedAt: "2026-07-20T22:16:00+08:00" }))
          ];
        }
        state.notebook.page.bookmarks = state.notebook.continuationCandidates.filter((item: any) => input.bookmarkIds.includes(item.id));
        state.notebook.page.status = "sealed";
        state.notebook.page.sealedAt = "2026-07-20T22:16:00+08:00";
        state.notebook.todayBoard.mode = "sealed";
        state.notebook.todayBoard.uncompiledEvidence = [];
        persistSealedState();
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
      getSessionTranscript: async (request: { id: string; platform: string; path: string; packageRef?: { logicalDate: string; generationId: string; evidenceId: string } }) => {
        (window as unknown as { transcriptRequests: unknown[] }).transcriptRequests.push(structuredClone(request));
        return ({
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
      });
      },
      chooseDirectory: async () => null,
      copyText: async (text: string) => {
        (window as unknown as { copiedTexts: string[] }).copiedTexts.push(text);
        return true;
      },
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
  await expect(page.locator(".today-board")).toBeVisible();
});

test("today board keeps raw Sessions as independent evidence lanes", async ({ page }) => {
  const board = page.locator(".today-board");
  await expect(board.getByRole("list", { name: "今日会话" }).locator(".today-session-lane")).toHaveCount(4);
  for (const sessionId of ["019f-work-continuity", "claude-map-review", "019f-trading", "claude-finished"]) {
    await expect(board.getByText(sessionId, { exact: true })).toBeVisible();
  }
  await expect(board.locator(".session-activity-track")).toHaveCount(4);
  await expect(board.getByText("你参与", { exact: true }).first()).toBeVisible();
  await expect(board.getByText("Agent 独立推进", { exact: true }).first()).toBeVisible();
  await expect(board.getByText("无法确定", { exact: true }).first()).toBeVisible();
  await expect(board.getByText("仍在运行", { exact: true }).first()).toBeVisible();
  await expect(board.getByText("22 分钟", { exact: true })).toBeVisible();
  await expect(board.getByText("3 次", { exact: true })).toBeVisible();
  await expect(board.getByText("注意力负荷线索", { exact: true })).toBeVisible();
  await expect(board.getByText(/依据：带时间戳的用户消息与 Agent 响应窗口/)).toBeVisible();
  await expect(board.getByText(/置信度：证据不足/)).toBeVisible();
  await expect(page.getByLabel("今日便签")).toHaveCount(0);

  const rawTranscriptAction = board.getByRole("button", { name: "打开 迁移第一版视觉骨架 的会话记录" });
  await rawTranscriptAction.click();
  const transcript = page.getByRole("dialog", { name: /迁移第一版视觉骨架 会话记录/ });
  await expect(transcript).toBeVisible();
  await expect(transcript.locator(".transcript-reader > header button")).toBeFocused();
  await transcript.getByRole("button", { name: "回到证据" }).focus();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { transcriptRequests: Array<{ packageRef?: unknown }> }).transcriptRequests.at(-1)?.packageRef)).toBeUndefined();
  await page.getByRole("button", { name: "回到证据" }).click();
  await expect(rawTranscriptAction).toBeFocused();

  await board.getByRole("button", { name: "整理工作脉络" }).click();
  await expect(board.locator(".today-workline")).toHaveCount(2);
  expect(await page.evaluate(() => (window as unknown as { prepareCallCount(): number }).prepareCallCount())).toBe(1);
});

test("compiled board discloses exact source topology and opens the selected dossier", async ({ page }) => {
  await page.evaluate(() => (window as unknown as { setTodayScenario(next: "compiled"): void }).setTodayScenario("compiled"));
  const board = page.locator(".today-board");
  await expect(board.locator(".today-workline")).toHaveCount(2);
  const direction = board.locator(".today-workline").filter({ hasText: "Daily Review · 产品方向" });
  const trading = board.locator(".today-workline").filter({ hasText: "Vibe Trading · 凭证隔离" });
  await expect(direction.getByText("AI 整理 / 可能变化", { exact: true })).toBeVisible();
  await expect(trading.locator(".workline-change-signal")).toHaveCount(0);
  const disclosure = direction.locator(".workline-disclosure");
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await disclosure.click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  const sourcePanelId = await disclosure.getAttribute("aria-controls");
  expect(sourcePanelId).toBeTruthy();
  await expect(direction.locator(`#${sourcePanelId}`)).toBeVisible();
  for (const sessionId of ["019f-work-continuity", "claude-map-review", "claude-finished"]) {
    await expect(direction.getByText(sessionId, { exact: true })).toBeVisible();
  }
  await expect(direction.getByText("Codex", { exact: true }).first()).toBeVisible();
  await expect(direction.getByText("Claude Code", { exact: true }).first()).toBeVisible();
  await expect(direction.locator(".workline-sessions .session-activity-track")).toHaveCount(3);
  await direction.getByRole("button", { name: "打开 迁移第一版视觉骨架 的会话记录" }).click();
  await expect(page.getByRole("dialog", { name: /迁移第一版视觉骨架 会话记录/ })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { transcriptRequests: Array<{ packageRef?: unknown }> }).transcriptRequests.at(-1)?.packageRef)).toEqual({
    logicalDate: "2026-07-20",
    generationId: "generation-2026-07-20-1",
    evidenceId: "session:codex:019f-work-continuity"
  });
  await page.getByRole("button", { name: "回到证据" }).click();

  const filters = board.locator(".today-board-filters");
  await filters.getByRole("button", { name: "Claude Code", exact: true }).click();
  await expect(board.locator(".today-workline")).toHaveCount(1);
  await filters.getByRole("button", { name: "全部来源", exact: true }).click();
  await board.locator(".project-strip").getByRole("button", { name: /vibe-trading/ }).click();
  await expect(board.locator(".today-workline")).toHaveCount(1);
  await expect(board.getByText("Vibe Trading · 凭证隔离", { exact: true })).toBeVisible();
  await board.locator(".project-strip").getByRole("button", { name: /全部项目/ }).click();

  const openMaterial = direction.getByRole("button", { name: "打开材料" });
  await openMaterial.click();
  const dossier = page.getByRole("dialog", { name: "日终回看" });
  await expect(dossier.getByText("从 Agent 看板转向人的日终回看工作簿", { exact: true })).toBeVisible();
  await expect(dossier.locator(".review-workline")).toHaveCount(0);
  await expect(dossier.getByRole("button", { name: /返回工作线/ })).toBeFocused();
  await dossier.getByRole("button", { name: "看完了，开始思考" }).focus();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  await dossier.getByRole("button", { name: /返回工作线/ }).click();
  await expect(openMaterial).toBeFocused();

  await page.evaluate(() => (window as unknown as { setTodayScenario(next: "duplicate"): void }).setTodayScenario("duplicate"));
  const duplicateDirection = board.locator(".today-workline").filter({ hasText: "Daily Review · 产品方向" });
  if (await duplicateDirection.locator(".workline-disclosure").getAttribute("aria-expanded") === "false") {
    await duplicateDirection.locator(".workline-disclosure").click();
  }
  await expect(duplicateDirection.getByRole("button", { name: "打开 迁移第一版视觉骨架 的会话记录" })).toHaveCount(1);
  await expect(duplicateDirection.getByText("同 ID 的另一条路径", { exact: true })).toHaveCount(0);
});

test("stale board preserves the last good package across a failed refresh", async ({ page }) => {
  await page.evaluate(() => (window as unknown as { setTodayScenario(next: "stale"): void }).setTodayScenario("stale"));
  const board = page.locator(".today-board");
  await expect(board.getByText("尚未整理", { exact: true }).first()).toBeVisible();
  await expect(board.locator(".today-uncompiled-lane")).toHaveCount(1);
  await expect(board.locator(".today-uncompiled-lane").getByText("claude-finished", { exact: true })).toBeVisible();
  await expect(board.locator(".today-workline")).toHaveCount(2);

  await page.evaluate(() => (window as unknown as { setPrepareFailure(fail: boolean): void }).setPrepareFailure(true));
  await board.getByRole("button", { name: "更新工作脉络" }).click();
  await expect(board.getByRole("alert")).toContainText("上一版仍然可读");
  await expect(board.locator(".today-workline")).toHaveCount(2);

  await page.evaluate(() => (window as unknown as { setPrepareFailure(fail: boolean): void }).setPrepareFailure(false));
  await board.getByRole("button", { name: "更新工作脉络" }).click();
  await expect(board.getByText("尚未整理", { exact: true })).toHaveCount(0);
  await expect(board.locator(".today-workline")).toHaveCount(2);
});

test("sealed board is read-only and transcript actions send the exact stored package reference", async ({ page }) => {
  await page.evaluate(() => (window as unknown as { setTodayScenario(next: "compiled"): void }).setTodayScenario("compiled"));
  const board = page.locator(".today-board");
  await board.locator(".project-strip").getByRole("button", { name: /vibe-trading/ }).click();
  await expect(board.locator(".today-workline")).toHaveCount(1);
  await page.evaluate(() => (window as unknown as { setTodayScenario(next: "sealed"): void }).setTodayScenario("sealed"));
  await page.evaluate(() => (window as unknown as { emitSmartTitle(title: string): void }).emitSmartTitle("后来快照的新标题"));
  await expect(board.getByText("已封存", { exact: true }).first()).toBeVisible();
  await expect(board.locator(".today-seal-mark")).toBeVisible();
  await expect(board.locator(".today-workline")).toHaveCount(2);
  await expect(board.locator(".today-board-toolbar .project-strip")).toHaveCount(0);
  await expect(board.locator(".today-activity-summary")).toHaveCount(0);
  await expect(board.getByRole("button", { name: /整理工作脉络|更新工作脉络/ })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { prepareCallCount(): number }).prepareCallCount())).toBe(0);
  await expect(board.getByText("旧代墨迹不应展示。", { exact: true })).toHaveCount(0);
  await expect(board.locator(".today-workline").getByText("封页以后仍保留人的原始判断。", { exact: true })).toBeVisible();
  const continuation = board.getByRole("region", { name: "封存续上" });
  await expect(continuation).toContainText("迁移第一版视觉骨架");
  await expect(continuation).toContainText("codex resume 019f-work-continuity");
  await continuation.getByRole("button", { name: /复制续上命令/ }).click();
  expect(await page.evaluate(() => (window as unknown as { copiedTexts: string[] }).copiedTexts)).toEqual(["codex resume 019f-work-continuity"]);
  await expect(board.getByRole("region", { name: "整页墨迹" })).toContainText("封页以后仍保留人的原始判断。");

  const direction = board.locator(".today-workline").filter({ hasText: "Daily Review · 产品方向" });
  await direction.getByRole("button", { name: /展开来源会话/ }).click();
  await expect(direction.getByText("迁移第一版视觉骨架", { exact: true })).toBeVisible();
  await expect(direction.getByText("后来快照的新标题", { exact: true })).toHaveCount(0);
  await direction.getByRole("button", { name: "打开 迁移第一版视觉骨架 的会话记录" }).click();
  await expect(page.getByRole("dialog", { name: /迁移第一版视觉骨架 会话记录/ })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { transcriptRequests: Array<{ packageRef?: unknown }> }).transcriptRequests.at(-1)?.packageRef)).toEqual({
    logicalDate: "2026-07-20",
    generationId: "generation-2026-07-20-1",
    evidenceId: "session:codex:019f-work-continuity"
  });
});

test("legacy sealed board shows whole-page ink without requiring a package generation", async ({ page }) => {
  await page.evaluate(() => (window as unknown as { setLegacySealedPage(text: string): void }).setLegacySealedPage("只有旧版整页墨迹。"));

  const board = page.locator(".today-board");
  await expect(board.getByText("已封存", { exact: true }).first()).toBeVisible();
  await expect(board.getByRole("region", { name: "整页墨迹" })).toContainText("只有旧版整页墨迹。");
  await expect(board.getByRole("region", { name: "封存续上" })).toContainText("codex resume 019f-work-continuity");
});

test("today board keeps the native shell and independently scrolling evidence regions", async ({ page }) => {
  await page.setViewportSize({ width: 1380, height: 683 });
  await page.evaluate(() => (window as unknown as { setTodayScenario(next: "compiled"): void }).setTodayScenario("compiled"));
  await expect(page.locator(".brand-mark")).toHaveAttribute("src", "./app-icon.png");
  const logo = await page.locator(".brand-mark").boundingBox();
  const lastNavigationItem = await page.locator(".rail-nav button").last().boundingBox();
  expect(logo?.y).toBeGreaterThanOrEqual(48);
  expect((lastNavigationItem?.y ?? 0) + (lastNavigationItem?.height ?? 0)).toBeLessThan(590);
  await expect(page.locator(".today-workline")).toHaveCount(2);
  const selectedProject = page.locator('.today-board-toolbar .project-strip button[aria-pressed="true"]');
  await expect(selectedProject).toContainText("02");
  const selectedProjectStyle = await selectedProject.evaluate((element) => {
    const parseColor = (value: string): [number, number, number, number] => {
      const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0, channels[3] ?? 1];
    };
    const luminance = (channels: number[]): number => {
      const linear = [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0].map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return (0.2126 * linear[0]!) + (0.7152 * linear[1]!) + (0.0722 * linear[2]!);
    };
    const style = getComputedStyle(element);
    const toolbar = element.closest(".today-board-toolbar");
    const toolbarBackground = parseColor(getComputedStyle(toolbar!).backgroundColor);
    const background = parseColor(style.backgroundColor);
    const paintedBackground = background.slice(0, 3).map((channel, index) =>
      (channel * background[3]) + (toolbarBackground[index]! * (1 - background[3]))
    );
    const foregroundLuminance = luminance(parseColor(style.color));
    const backgroundLuminance = luminance(paintedBackground);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      color: style.color,
      contrast: (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    };
  });
  expect(selectedProjectStyle).toMatchObject({
    backgroundColor: "rgb(32, 33, 30)",
    borderColor: "rgb(32, 33, 30)",
    color: "rgb(255, 255, 255)"
  });
  expect(selectedProjectStyle.contrast).toBeGreaterThanOrEqual(4.5);
  await expect(page.locator(".today-board-scroll")).toHaveCSS("overflow-y", "auto");
  await page.locator(".today-workline").first().locator(".workline-disclosure").click();
  await expect(page.locator(".workline-sessions")).toHaveCSS("overflow-y", "auto");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("legacy note persistence remains available without a capture entry on Today", async ({ page }) => {
  await expect(page.getByRole("button", { name: "新建便签" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "便签正文" })).toHaveCount(0);
  expect(await page.evaluate(() => typeof window.agentWhiteboard.createNotebookNote)).toBe("function");
});

test("end-of-day flow stores personal ink and seals an immutable page", async ({ page }) => {
  await page.getByRole("button", { name: "整理工作脉络" }).click();
  await page.locator(".today-workline").first().getByRole("button", { name: "打开材料" }).click();
  const ritual = page.getByRole("dialog", { name: "日终回看" });
  await ritual.getByRole("button", { name: "看完了，开始思考" }).click();
  await ritual.getByRole("textbox", { name: "你的原始墨迹" }).fill("今天到这里，明天继续验证闭环。");
  await ritual.getByRole("button", { name: "收下这段思考" }).click();
  await page.getByRole("button", { name: "今日收口" }).click();
  await expect(ritual.locator(".seal-spine > button")).toBeFocused();
  await ritual.getByRole("button", { name: "收笔并封存" }).focus();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  await ritual.locator(".bookmark-choices button").first().click();
  await ritual.getByRole("button", { name: "收笔并封存" }).click();
  await expect(page.getByText("已封存", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("今天到这里，明天继续验证闭环。")).toBeVisible();
  await expect(page.getByRole("button", { name: /整理工作脉络|更新工作脉络|今日收口/ })).toHaveCount(0);
  await expect(page.locator(".today-board")).toBeFocused();
});

test("generation-aware save, seal, reload, and history reopen preserve the exact sealed review", async ({ page }) => {
  const board = page.locator(".today-board");
  await board.getByRole("button", { name: "整理工作脉络" }).click();

  await board.locator(".today-workline").first().getByRole("button", { name: "打开材料" }).click();
  let review = page.getByRole("dialog", { name: "日终回看" });
  await review.getByRole("button", { name: "看完了，开始思考" }).click();
  await review.getByRole("textbox", { name: "你的原始墨迹" }).fill("A · 第一代判断");
  await review.getByRole("button", { name: "收下这段思考" }).click();
  await expect(board.locator(".today-workline").first()).toContainText("A · 第一代判断");

  await page.evaluate(() => (window as unknown as { advanceTodayGeneration(): void }).advanceTodayGeneration());
  await expect(board.locator(".today-workline").first()).not.toContainText("A · 第一代判断");
  await board.locator(".today-workline").first().getByRole("button", { name: "打开材料" }).click();
  review = page.getByRole("dialog", { name: "日终回看" });
  await review.getByRole("button", { name: "看完了，开始思考" }).click();
  const activeInk = review.getByRole("textbox", { name: "你的原始墨迹" });
  await expect(activeInk).toHaveValue("");
  await activeInk.fill("B · 第二代判断");
  await review.getByRole("button", { name: "收下这段思考" }).click();
  await expect(board.locator(".today-workline").first()).toContainText("B · 第二代判断");
  await expect(board.locator(".today-workline").first()).not.toContainText("A · 第一代判断");

  await page.evaluate(() => (window as unknown as { setLegacyPageReflection(text: string): void }).setLegacyPageReflection("旧版整页反思仍可阅读。"));
  const prepareCountBeforeSeal = await page.evaluate(() => (window as unknown as { prepareCallCount(): number }).prepareCallCount());
  await board.getByRole("button", { name: "今日收口" }).click();
  review = page.getByRole("dialog", { name: "日终回看" });
  await review.locator(".bookmark-choices button").first().click();
  await review.getByRole("button", { name: "收笔并封存" }).click();

  await expect(board.getByText("已封存", { exact: true }).first()).toBeVisible();
  await expect(board.locator(".today-workline").first()).toContainText("B · 第二代判断");
  await expect(board.locator(".today-workline").first()).not.toContainText("A · 第一代判断");
  await expect(board.getByRole("region", { name: "整页墨迹" })).toContainText("旧版整页反思仍可阅读。");
  const continuation = board.getByRole("region", { name: "封存续上" });
  await expect(continuation).toContainText("迁移第一版视觉骨架");
  await expect(continuation).toContainText("codex resume 019f-work-continuity");

  const sealedJson = await page.evaluate(() => (window as unknown as { sealedPageJson(): string }).sealedPageJson());
  const sealedPage = JSON.parse(sealedJson);
  expect(sealedPage.packageGenerations).toHaveLength(2);
  expect(sealedPage.activePackageGenerationId).toBe("generation-2026-07-20-2");
  expect(sealedPage.worklineReflections.map((item: any) => [item.packageGenerationId, item.text])).toEqual([
    ["generation-2026-07-20-1", "A · 第一代判断"],
    ["generation-2026-07-20-2", "B · 第二代判断"]
  ]);
  expect(sealedPage.bookmarks).toHaveLength(1);
  expect(sealedPage.sealedAt).toBe("2026-07-20T22:16:00+08:00");

  await board.locator(".today-workline").first().getByRole("button", { name: "打开封存材料" }).click();
  review = page.getByRole("dialog", { name: "日终回看" });
  await expect(review.getByText("从 Agent 看板转向人的日终回看工作簿", { exact: true })).toBeVisible();
  await expect(review.getByText("原来的判断", { exact: true })).toBeVisible();
  await expect(review.getByText("发生了什么", { exact: true })).toBeVisible();
  await expect(review.getByText("未来观察", { exact: true })).toBeVisible();
  await review.getByRole("button", { name: /返回工作线/ }).click();

  await page.evaluate(() => (window as unknown as { mutateLiveInputs(): void }).mutateLiveInputs());
  expect(await page.evaluate(() => (window as unknown as { liveInputSnapshot(): unknown }).liveInputSnapshot())).toEqual({
    sessionTitle: "封页后的 Session 新标题",
    promptProfile: "traceink-review-v2-after-seal"
  });
  expect(await page.evaluate(() => (window as unknown as { sealedPageJson(): string }).sealedPageJson())).toBe(sealedJson);
  expect(await page.evaluate(() => (window as unknown as { prepareCallCount(): number }).prepareCallCount())).toBe(prepareCountBeforeSeal);

  await page.reload();
  await expect(page.locator(".today-board").getByText("已封存", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { sealedPageJson(): string }).sealedPageJson())).toBe(sealedJson);
  expect(await page.evaluate(() => (window as unknown as { prepareCallCount(): number }).prepareCallCount())).toBe(prepareCountBeforeSeal);
  await expect(page.locator(".today-workline").first()).toContainText("B · 第二代判断");
  await expect(page.locator(".today-workline").first()).not.toContainText("A · 第一代判断");

  await page.getByRole("button", { name: "查看前一天" }).click();
  await expect(page.locator(".today-board").getByRole("button", { name: "整理工作脉络" })).toBeVisible();
  await page.getByRole("button", { name: "查看后一天" }).click();
  await expect(page.locator(".today-board").getByText("已封存", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".today-workline").first()).toContainText("B · 第二代判断");
  expect(await page.evaluate(() => (window as unknown as { prepareCallCount(): number }).prepareCallCount())).toBe(prepareCountBeforeSeal);
  expect(await page.evaluate(() => (window as unknown as { e2eSideEffectCounts(): unknown }).e2eSideEffectCounts())).toEqual({ wiki: 0, ctx: 0, background: 0 });
});

test("daily review reconstructs worklines before the user writes their own reflection", async ({ page }) => {
  await page.getByRole("button", { name: "整理工作脉络" }).click();
  const board = page.locator(".today-board");
  await expect(board.locator(".today-workline")).toHaveCount(2);
  await expect(board.getByText("你参与", { exact: true }).first()).toBeVisible();
  await expect(board.getByText("Agent 独立推进", { exact: true }).first()).toBeVisible();
  await board.locator(".today-workline").first().getByRole("button", { name: "打开材料" }).click();
  const review = page.getByRole("dialog", { name: "日终回看" });
  await expect(review).toBeVisible();
  await expect(review.getByText("从 Agent 看板转向人的日终回看工作簿", { exact: true })).toBeVisible();
  await expect(review.getByText("AI 整理", { exact: true })).toBeVisible();
  await expect(review.getByText("这套材料是否已经足以让你亲自想明白？", { exact: true })).toBeVisible();

  await review.getByRole("button", { name: "看完了，开始思考" }).click();
  const ink = review.getByRole("textbox", { name: "你的原始墨迹" });
  await expect(ink).toHaveValue("");
  await ink.fill("我认为先让材料真正减少 Session 翻找，才值得继续增加能力。");
  await review.getByRole("button", { name: "收下这段思考" }).click();
  await expect(board.locator(".today-workline").first()).toContainText("我认为先让材料真正减少 Session 翻找");
  await board.locator(".today-workline").first().getByRole("button", { name: "打开材料" }).click();
  await review.getByRole("button", { name: "查看我的思考" }).click();
  await expect(ink).toHaveValue("我认为先让材料真正减少 Session 翻找，才值得继续增加能力。");
});

test("daily review remains usable without horizontal overflow in a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 620 });
  await page.getByRole("button", { name: "整理工作脉络" }).click();
  await expect(page.locator(".today-workline")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.locator(".today-workline").first().getByRole("button", { name: "打开材料" }).click();
  const review = page.getByRole("dialog", { name: "日终回看" });
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
  const ledger = await page.locator(".today-board").boundingBox();
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
