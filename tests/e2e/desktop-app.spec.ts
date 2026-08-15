import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { traceinkIndexPresentation } from "../../src/traceink-index-presentation";
import type { TraceinkEvidenceRefV1, TraceinkIndexArtifactV1 } from "../../src/traceink-review-assets";

const desktopUrl = pathToFileURL(path.resolve("dist/desktop/index.html")).toString();
const TRACEINK_HASH = "a".repeat(64);

const goldenTodaySessions = [
  {
    id: "019fe682-2ae8-75c0-970c-a3438bd51db1",
    platform: "codex",
    title: "Traceink 核心界面",
    summary: "把 Traceink 的真实产物变成 Work Continuity 的核心界面。",
    path: "/tmp/traceink-golden-work-continuity.jsonl",
    startedAt: "2026-08-15T09:22:00+08:00",
    updatedAt: "2026-08-15T14:28:00+08:00",
    projectPath: "/workspace/work-continuity",
    resumable: true,
    summarySource: "codex",
    artifacts: [],
    status: "active"
  },
  {
    id: "019ff55d-2782-77a0-abb8-f2b11dcd01f2",
    platform: "codex",
    title: "中金式 AI Loop 审计",
    summary: "补齐自动因子发现引擎的垂直证据链。",
    path: "/tmp/traceink-golden-ai-loop.jsonl",
    startedAt: "2026-08-15T09:16:00+08:00",
    updatedAt: "2026-08-15T14:25:00+08:00",
    projectPath: "/workspace/vibe-trading",
    resumable: true,
    summarySource: "codex",
    artifacts: [],
    status: "active"
  },
  {
    id: "01a003a2-f248-7000-9000-000000000003",
    platform: "codex",
    title: "首个因子 Campaign 封存",
    summary: "Campaign 已封存，没有可推广 Alpha。",
    path: "/tmp/traceink-golden-campaign.jsonl",
    startedAt: "2026-08-15T12:16:00+08:00",
    updatedAt: "2026-08-15T14:28:00+08:00",
    projectPath: "/workspace/vibe-trading",
    resumable: false,
    summarySource: "codex",
    artifacts: [],
    status: "completed"
  },
  {
    id: "019fd9f8-48e6-77a2-9775-6f392b570065",
    platform: "codex",
    title: "Autoresearch 权限边界",
    summary: "Adapter 与 Evaluator 已停在外部证据边界。",
    path: "/tmp/traceink-golden-autoresearch.jsonl",
    startedAt: "2026-08-15T09:19:00+08:00",
    updatedAt: "2026-08-15T13:08:00+08:00",
    projectPath: "/workspace/optimatchlocator",
    resumable: true,
    summarySource: "codex",
    artifacts: [],
    status: "blocked"
  },
  {
    id: "019fd2c1-b372-7000-9000-000000000005",
    platform: "codex",
    title: "FOLO RSS 证据质量门",
    summary: "从静态相关性评分转向有界原始来源核验。",
    path: "/tmp/traceink-golden-folo-rss.jsonl",
    startedAt: "2026-08-15T08:38:00+08:00",
    updatedAt: "2026-08-15T14:23:00+08:00",
    projectPath: "/workspace/llm-wiki",
    resumable: true,
    summarySource: "codex",
    artifacts: [],
    status: "completed"
  },
  {
    id: "01a00303-child-not-explicitly-indexed",
    platform: "codex",
    title: "未在索引中逐项列出的 Traceink 子会话",
    summary: "这条冻结 Session 没有足够的显式引用，不能被 UI 猜进任一工作线。",
    path: "/tmp/traceink-golden-unresolved-child.jsonl",
    startedAt: "2026-08-15T11:42:00+08:00",
    updatedAt: "2026-08-15T12:03:00+08:00",
    projectPath: "/workspace/work-continuity",
    resumable: false,
    summarySource: "codex",
    artifacts: [],
    status: "completed"
  }
];

const goldenTodayEvidence: TraceinkEvidenceRefV1[] = goldenTodaySessions.map((session, index) => ({
  id: `golden-session-${index + 1}`,
  kind: "session",
  provider: "codex",
  sessionId: session.id,
  path: session.path,
  locator: `bytes 0-${400 + index}`,
  contentHash: TRACEINK_HASH
}));

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
  const traceinkMarkdown = await readFile(path.resolve("tests/skill-fixtures/traceink-golden/full-day-index.md"), "utf8");
  const goldenTodayMarkdown = await readFile(path.resolve("tests/skill-fixtures/traceink-golden/today-2026-08-15-index.md"), "utf8");
  const goldenTodayIndex: TraceinkIndexArtifactV1 = {
    schemaVersion: 1,
    id: "traceink-index-2026-08-15",
    logicalDate: "2026-08-15",
    stage: "index",
    revision: 1,
    producer: {
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningConfiguration: "ultra",
      startedAt: "2026-08-15T14:28:00+08:00",
      completedAt: "2026-08-15T14:36:00+08:00",
      skill: {
        packageId: "traceink",
        version: "traceink-skill-bundle-v1",
        skillHash: TRACEINK_HASH,
        editorialContractHash: TRACEINK_HASH
      },
      scope: {
        timeZone: "Asia/Shanghai",
        startInclusive: "2026-08-15T00:00:00+08:00",
        endExclusive: "2026-08-16T00:00:00+08:00",
        evidenceCutoff: "2026-08-15T14:28:00+08:00"
      }
    },
    inputEvidenceHash: TRACEINK_HASH,
    rawMarkdown: goldenTodayMarkdown,
    outputHash: TRACEINK_HASH,
    coverage: goldenTodayEvidence.map((item) => ({ sourceId: item.id, disposition: "read", detail: "frozen provider session" })),
    evidence: goldenTodayEvidence,
    navigation: [],
    warnings: []
  };
  const goldenTodayPresentation = traceinkIndexPresentation(goldenTodayIndex);
  await page.addInitScript(({ sessions, canonicalTraceinkMarkdown, todaySessions, todayIndex, todayPresentation }) => {
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
      })), {
        id: "artifact:legacy:daily-review-notes",
        kind: "artifact",
        label: "旧项目文档.md",
        path: "/workspace/work-continuity/旧项目文档.md",
        platform: "codex",
        sessionId: "019f-work-continuity"
      }, ...(includeDuplicate ? [{
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
              { id: "prior", kind: "prior-assumption", label: "原来的判断", title: "首页需要展示 Agent 的运行状态", body: "最初把 Session、运行状态和项目摘要放在同一主界面。", evidenceIds: ["session:codex:019f-work-continuity", "artifact:legacy:daily-review-notes"], payload: {} },
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
    type TodayScenario = "raw" | "compiled" | "stale" | "sealed" | "duplicate" | "traceink" | "traceink-stale" | "traceink-golden";
    const sessionIdentity = (session: any): string => `${session.platform}:${session.id}:${session.path}`;
    const createActivity = (activeDate: string, scopedSessions: typeof sessions): any => ({
      logicalDate: activeDate,
      lanes: scopedSessions.map((session: any, index: number) => ({
        identity: sessionIdentity(session),
        sessionId: session.id,
        platform: session.platform,
        path: session.path,
        operationalState: session.status === "active" ? "running" : "not-running",
        confidence: activeDate === "2026-08-15" ? (index < 5 ? "observed" : "uncertain") : index === 2 ? "uncertain" : "observed",
        timeRange: { start: session.startedAt, end: session.updatedAt },
        userInterventions: activeDate === "2026-08-15"
          ? ([0, 1, 4].includes(index) ? [{ id: `golden-user-${index}`, timestamp: session.startedAt }] : [])
          : index === 0
          ? [{ id: "user-1", timestamp: `${activeDate}T09:18:00+08:00` }, { id: "user-2", timestamp: `${activeDate}T14:30:00+08:00` }]
          : index === 1
            ? [{ id: "user-3", timestamp: `${activeDate}T10:02:00+08:00` }]
            : [],
        agentActivityWindows: activeDate === "2026-08-15"
          ? (index < 5 ? [{ start: session.startedAt, end: session.updatedAt, durationMs: 900000, basis: "timestamped-user-to-assistant", coverage: "observed" }] : [])
          : index === 0
          ? [{ start: `${activeDate}T14:30:00+08:00`, end: `${activeDate}T14:36:00+08:00`, durationMs: 360000, basis: "timestamped-user-to-assistant", coverage: "observed" }]
          : index === 1
            ? [{ start: `${activeDate}T10:02:00+08:00`, end: `${activeDate}T10:18:00+08:00`, durationMs: 960000, basis: "timestamped-user-to-assistant", coverage: "observed" }]
            : [],
        warnings: activeDate === "2026-08-15" ? (index === 5 ? ["索引没有提供足以归入工作线的显式引用。"] : []) : index === 2 ? ["部分消息缺少时间戳，无法推断持续时间。"] : []
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
    const createTraceinkProjection = (activeDate: string, scopedSessions: typeof sessions, scenario: TodayScenario): any => {
      if (scenario === "traceink-golden") {
        const artifact = structuredClone(todayIndex);
        return {
          mode: "compiled",
          activeIndex: artifact,
          activeIndexReference: {
            artifactId: artifact.id,
            stage: "index",
            revision: artifact.revision,
            outputHash: artifact.outputHash
          },
          uncompiledEvidence: [],
          worklines: todayPresentation.map((presentation: any) => ({
            selection: structuredClone(presentation.selection),
            presentation: structuredClone(presentation),
            proposalItems: []
          }))
        };
      }
      if (scenario !== "traceink" && scenario !== "traceink-stale") {
        return {
          mode: "raw",
          uncompiledEvidence: scopedSessions.map((session: any) => ({
            identity: sessionIdentity(session),
            revision: `revision:${session.updatedAt}`
          }))
        };
      }
      const hash = "a".repeat(64);
      const artifact = {
        schemaVersion: 1,
        id: `traceink-index-${activeDate}`,
        logicalDate: activeDate,
        stage: "index",
        revision: 1,
        producer: {
          provider: "codex",
          model: "gpt-5.6-sol",
          reasoningConfiguration: "ultra",
          startedAt: `${activeDate}T19:00:00+08:00`,
          completedAt: `${activeDate}T19:08:00+08:00`,
          skill: {
            packageId: "traceink",
            version: "traceink-skill-bundle-v1",
            skillHash: hash,
            editorialContractHash: hash
          },
          scope: {
            timeZone: "Asia/Shanghai",
            startInclusive: `${activeDate}T00:00:00+08:00`,
            endExclusive: "2026-08-10T00:00:00+08:00",
            evidenceCutoff: `${activeDate}T19:00:00+08:00`
          }
        },
        inputEvidenceHash: hash,
        rawMarkdown: canonicalTraceinkMarkdown,
        outputHash: hash,
        coverage: scopedSessions.map((session: any) => ({
          sourceId: sessionIdentity(session),
          disposition: "read",
          detail: "frozen provider session"
        })),
        evidence: scopedSessions.map((session: any, index: number) => ({
          id: `session:${session.platform}:${session.id}`,
          kind: "session",
          provider: session.platform,
          sessionId: session.id,
          path: session.path,
          locator: `bytes 0-${100 + index}`,
          contentHash: hash
        })),
        navigation: [],
        warnings: []
      };
      return {
        mode: scenario === "traceink-stale" ? "stale" : "compiled",
        activeIndex: artifact,
        activeIndexReference: {
          artifactId: artifact.id,
          stage: "index",
          revision: artifact.revision,
          outputHash: artifact.outputHash
        },
        uncompiledEvidence: scenario === "traceink-stale" && scopedSessions.length > 0
          ? [{ identity: sessionIdentity(scopedSessions[scopedSessions.length - 1]), revision: "revision:new-evidence" }]
          : []
      };
    };
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
      const hasPackage = scenario !== "raw" && scenario !== "traceink" && scenario !== "traceink-stale" && scenario !== "traceink-golden";
      const boardMode = scenario === "duplicate" ? "compiled" : scenario === "traceink" || scenario === "traceink-stale" || scenario === "traceink-golden" ? "raw" : scenario;
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
      const sourceSessions = scenario === "traceink-golden" ? todaySessions : sessions;
      const scopedSessions = sourceSessions.filter((session: { platform: string }) => enabledProviders.includes(session.platform));
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
          claudeCliPath: "claude",
          dailyReviewScheduleEnabled: false,
          dailyReviewScheduleTime: "18:30"
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
      activity: createActivity(activeDate, scopedSessions),
      traceinkReview: createTraceinkProjection(activeDate, scopedSessions, scenario),
      traceinkReviewError: undefined as string | undefined,
      reviewPreparation: {
        enabled: false,
        time: "18:30",
        logicalDate: activeDate,
        status: scenario === "raw" ? "off" : "ready",
        scheduledFor: undefined as string | undefined,
        trigger: undefined as "manual" | "scheduled" | undefined,
        startedAt: undefined as string | undefined,
        finishedAt: undefined as string | undefined,
        message: undefined as string | undefined
      }
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
    let lastDraftGenerationCheck: { expected: string | null; active: string | null } | null = null;
    let lastSealGenerationCheck: { expected: string | null; active: string | null } | null = null;
    const sideEffectCounts = persistedSnapshot?.sideEffectCounts ?? { wiki: 0, ctx: 0, background: 0 };
    let state = persistedSnapshot ? restorePersistedState(persistedSnapshot) : createState(undefined, undefined, scenario);
    const stateListeners: Array<(next: ReturnType<typeof createState>) => void> = [];
    const notifyState = (): void => { for (const listener of stateListeners) listener(state); };
    const goldenWorkline = (worklineId: string): any => state.traceinkReview.worklines?.find((item: any) => item.selection.worklineId === worklineId);
    const goldenDossier = (workline: any): any => {
      const evidence = state.traceinkReview.activeIndex.evidence.filter((item: any) => workline.presentation?.evidenceIds.includes(item.id));
      const selectedEvidence = evidence[0] ?? state.traceinkReview.activeIndex.evidence[0];
      return {
        ...structuredClone(state.traceinkReview.activeIndex),
        id: `traceink-dossier-${workline.selection.worklineId}`,
        stage: "dossier",
        worklineId: workline.selection.worklineId,
        rawMarkdown: [
          `# ${workline.selection.title} · 证据档案`,
          "",
          "## 原来的判断或背景",
          "这条工作线从当天冻结的 Session 证据重建，不把 AI 的候选解释冒充成你的判断。",
          "",
          "## 发生了什么",
          workline.presentation.currentStopMarkdown,
          "",
          "## 支持、反对与适用边界",
          `- [E1] Codex Session \`${selectedEvidence.sessionId}\` · ${selectedEvidence.path}`,
          "- 当前证据完整度沿用索引，不扩大到未读取材料。",
          "",
          "## 仍需你判断",
          "这条证据是否足以改变你下一步的投入？"
        ].join("\n"),
        outputHash: "b".repeat(64),
        evidence: [structuredClone(selectedEvidence)],
        navigation: [{ id: "dossier-evidence", markdownAnchor: "支持、反对与适用边界", evidenceIds: [selectedEvidence.id] }],
        warnings: []
      };
    };
    const goldenProposalItems = (reflectionText: string): any[] => [
      { proposalId: "J1", category: "judgment", proposalText: "确认 Traceink 原文应继续作为产品语义权威。", sourceQuote: reflectionText, evidenceIds: ["golden-session-1"] },
      { proposalId: "T1", category: "tomorrow", proposalText: "明天在重新构建的客户端中实测五条工作线。", sourceQuote: reflectionText, evidenceIds: ["golden-session-1"] },
      { proposalId: "C1", category: "ctx", proposalText: "把已确认的产品方向保留为 CTX 候选。", sourceQuote: reflectionText, evidenceIds: ["golden-session-1"] },
      { proposalId: "B1", category: "background", proposalText: "可在明确授权后准备只读回归材料。", sourceQuote: reflectionText, evidenceIds: ["golden-session-1"] },
      { proposalId: "D1", category: "today-only", proposalText: "保留今天对客户端真实性的质疑。", sourceQuote: reflectionText, evidenceIds: ["golden-session-1"] }
    ];
    const goldenProposals = (workline: any): any => {
      const items = goldenProposalItems(workline.reflection.text);
      return {
        ...structuredClone(workline.dossier),
        id: `traceink-proposals-${workline.selection.worklineId}`,
        stage: "proposals",
        sourceReflection: {
          reflectionId: workline.reflection.id,
          revision: workline.reflection.revision,
          contentHash: workline.reflection.contentHash
        },
        rawMarkdown: [
          "### 你的原文 · 保持原样",
          "",
          `> ${workline.reflection.text}`,
          "",
          "### 待确认的整理提案",
          "",
          ...items.map((item) => `- **[${item.proposalId}]** ${item.proposalText}\n  原文依据：“${item.sourceQuote}”`),
          "",
          "接受只记录选择，不触发写入、后台授权或封页。"
        ].join("\n"),
        outputHash: "d".repeat(64),
        navigation: items.map((item) => ({
          id: item.proposalId,
          markdownAnchor: item.proposalId,
          evidenceIds: item.evidenceIds,
          category: item.category,
          proposalText: item.proposalText,
          sourceQuote: item.sourceQuote
        }))
      };
    };
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
    (window as unknown as { settingsPatches: unknown[] }).settingsPatches = [];
    (window as unknown as { traceinkDossierRequests: unknown[] }).traceinkDossierRequests = [];
    (window as unknown as { traceinkReflectionInputs: string[] }).traceinkReflectionInputs = [];
    (window as unknown as { traceinkProposalRequests: unknown[] }).traceinkProposalRequests = [];
    (window as unknown as { traceinkProposalDispositions: unknown[] }).traceinkProposalDispositions = [];
    (window as unknown as { setTodayScenario: (next: TodayScenario) => void }).setTodayScenario = (next: TodayScenario) => {
      persistedSnapshot = null;
      window.name = "";
      scenario = next;
      state = createState(
        state.data.settings.enabledSessionProviders,
        next === "traceink-golden" ? "2026-08-15" : next === "traceink" || next === "traceink-stale" ? "2026-08-09" : state.activeDate,
        scenario
      );
      notifyState();
    };
    (window as unknown as { setPrepareFailure: (fail: boolean) => void }).setPrepareFailure = (fail: boolean) => { prepareShouldFail = fail; };
    (window as unknown as { setReviewPreparation: (status: "off" | "scheduled" | "preparing" | "failed", message?: string) => void }).setReviewPreparation = (status, message) => {
      state.reviewPreparation = {
        ...state.reviewPreparation,
        enabled: status !== "off",
        time: state.data.settings.dailyReviewScheduleTime,
        logicalDate: state.activeDate,
        status,
        ...(status === "preparing" ? { trigger: "scheduled", startedAt: `${state.activeDate}T18:30:00+08:00` } : {}),
        ...(status === "scheduled" ? { scheduledFor: `${state.activeDate}T${state.data.settings.dailyReviewScheduleTime}` } : {}),
        ...(message ? { message } : {})
      };
      state = structuredClone(state);
      notifyState();
    };
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
    (window as unknown as { coexistLegacySealWithCanonicalIndex: () => void }).coexistLegacySealWithCanonicalIndex = () => {
      if (!state.traceinkReview.activeIndex) throw new Error("canonical Traceink index missing");
      state.notebook.page.status = "sealed";
      state.notebook.page.sealedAt = `${state.activeDate}T22:16:00+08:00`;
      state.notebook.todayBoard.mode = "sealed";
      state = structuredClone(state);
      notifyState();
    };
    (window as unknown as { sealedPageJson: () => string }).sealedPageJson = () => JSON.stringify(state.notebook.page);
    (window as unknown as { generationCheckSnapshot: () => unknown }).generationCheckSnapshot = () => structuredClone({
      draft: lastDraftGenerationCheck,
      seal: lastSealGenerationCheck
    });
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
      updateSettings: async (patch: { enabledSessionProviders?: string[]; sessionScanRoots?: string[]; knowledgeRoot?: string; dailyReviewScheduleEnabled?: boolean; dailyReviewScheduleTime?: string }) => {
        (window as unknown as { settingsPatches: unknown[] }).settingsPatches.push(structuredClone(patch));
        const previousSettings = structuredClone(state.data.settings);
        state = createState(patch.enabledSessionProviders ?? state.data.settings.enabledSessionProviders, state.activeDate, scenario);
        state.data.settings = { ...state.data.settings, ...previousSettings, ...patch };
        state.reviewPreparation.enabled = state.data.settings.dailyReviewScheduleEnabled;
        state.reviewPreparation.time = state.data.settings.dailyReviewScheduleTime;
        if (state.notebook.todayBoard.mode === "raw") {
          state.reviewPreparation.status = state.data.settings.dailyReviewScheduleEnabled ? "scheduled" : "off";
        }
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
          state.traceinkReviewError = "整理模型暂时不可用；上一版仍然可读。";
          state.reviewPreparation = { ...state.reviewPreparation, enabled: state.data.settings.dailyReviewScheduleEnabled, time: state.data.settings.dailyReviewScheduleTime, logicalDate: state.activeDate, status: "failed", message: "整理模型暂时不可用；上一版仍然可读。" };
          notifyState();
          throw new Error("整理模型暂时不可用；上一版仍然可读。");
        }
        scenario = scenario === "traceink" || scenario === "traceink-stale" ? "traceink" : "compiled";
        state = createState(state.data.settings.enabledSessionProviders, state.activeDate, scenario);
        notifyState();
        return state.notebook;
      },
      prepareTraceinkDossier: async (date: string, selection: { worklineId: string }) => {
        (window as unknown as { traceinkDossierRequests: unknown[] }).traceinkDossierRequests.push({ date, selection: structuredClone(selection) });
        const workline = goldenWorkline(selection.worklineId);
        if (!workline) throw new Error("golden workline missing");
        workline.dossier = goldenDossier(workline);
        state = structuredClone(state);
        return state;
      },
      saveTraceinkReflection: async (date: string, dossier: { artifactId: string; stage: string; revision: number; outputHash: string }, text: string) => {
        (window as unknown as { traceinkReflectionInputs: string[] }).traceinkReflectionInputs.push(text);
        const workline = state.traceinkReview.worklines?.find((item: any) => item.dossier?.id === dossier.artifactId);
        if (!workline || date !== state.activeDate) throw new Error("golden dossier missing");
        workline.reflection = {
          schemaVersion: 1,
          id: `traceink-reflection-${workline.selection.worklineId}`,
          logicalDate: date,
          worklineId: workline.selection.worklineId,
          dossier: structuredClone(dossier),
          revision: (workline.reflection?.revision ?? 0) + 1,
          text,
          createdAt: `${date}T14:40:00+08:00`,
          savedAt: `${date}T14:40:00+08:00`,
          contentHash: "c".repeat(64)
        };
        state = structuredClone(state);
        return state;
      },
      prepareTraceinkProposals: async (date: string, reflection: { reflectionId: string; revision: number; contentHash: string }) => {
        (window as unknown as { traceinkProposalRequests: unknown[] }).traceinkProposalRequests.push({ date, reflection: structuredClone(reflection) });
        const workline = state.traceinkReview.worklines?.find((item: any) => item.reflection?.id === reflection.reflectionId);
        if (!workline || date !== state.activeDate) throw new Error("golden reflection missing");
        workline.proposals = goldenProposals(workline);
        workline.proposalItems = goldenProposalItems(workline.reflection.text);
        state = structuredClone(state);
        return state;
      },
      disposeTraceinkProposal: async (
        date: string,
        proposals: { artifactId: string; stage: string; revision: number; outputHash: string },
        proposalId: string,
        input: { action: "accept" | "dismiss" | "defer" | "rewrite"; rewriteText?: string }
      ) => {
        (window as unknown as { traceinkProposalDispositions: unknown[] }).traceinkProposalDispositions.push({ date, proposals: structuredClone(proposals), proposalId, input: structuredClone(input) });
        const workline = state.traceinkReview.worklines?.find((item: any) => item.proposals?.id === proposals.artifactId);
        const proposal = workline?.proposalItems.find((item: any) => item.proposalId === proposalId);
        if (!workline || !proposal || date !== state.activeDate) throw new Error("golden proposal missing");
        proposal.latestDisposition = {
          schemaVersion: 1,
          id: `traceink-disposition-${proposalId}-${input.action}`,
          logicalDate: date,
          worklineId: workline.selection.worklineId,
          proposalArtifact: structuredClone(proposals),
          proposalId,
          category: proposal.category,
          revision: (proposal.latestDisposition?.revision ?? 0) + 1,
          action: input.action,
          ...(input.rewriteText ? { rewriteText: input.rewriteText } : {}),
          decidedAt: `${date}T14:45:00+08:00`
        };
        state = structuredClone(state);
        return state;
      },
      composeDailyPage: async () => {
        scenario = "compiled";
        state = createState(state.data.settings.enabledSessionProviders, state.activeDate, scenario);
        return state.notebook;
      },
      saveDailyDraft: async (_date: string, input: { reflection: string; worklineReflections?: Array<{ worklineId: string; text: string }>; bookmarkIds: string[]; expectedActiveGenerationId: string | null }) => {
        const activeGenerationId = state.notebook.page.activePackageGenerationId ?? null;
        lastDraftGenerationCheck = { expected: input.expectedActiveGenerationId, active: activeGenerationId };
        if (!activeGenerationId || input.expectedActiveGenerationId !== activeGenerationId) throw new Error("active generation mismatch");
        state.notebook.page.reflection = input.reflection;
        if (input.worklineReflections) {
          state.notebook.page.worklineReflections = [
            ...state.notebook.page.worklineReflections.filter((item: any) => item.packageGenerationId !== activeGenerationId),
            ...input.worklineReflections.map((item) => ({ ...item, packageGenerationId: activeGenerationId, updatedAt: "2026-07-20T21:00:00+08:00" }))
          ];
        }
        state.notebook.page.bookmarks = state.notebook.continuationCandidates.filter((item: any) => input.bookmarkIds.includes(item.id));
        return state.notebook;
      },
      sealDailyPage: async (_date: string, input: { reflection: string; worklineReflections?: Array<{ worklineId: string; text: string }>; bookmarkIds: string[]; expectedActiveGenerationId: string | null }) => {
        const activeGenerationId = state.notebook.page.activePackageGenerationId ?? null;
        lastSealGenerationCheck = { expected: input.expectedActiveGenerationId, active: activeGenerationId };
        if (!activeGenerationId || input.expectedActiveGenerationId !== activeGenerationId) throw new Error("active generation mismatch");
        state.notebook.page.reflection = input.reflection;
        if (input.worklineReflections) {
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
  }, {
    sessions: baseSessions,
    canonicalTraceinkMarkdown: traceinkMarkdown,
    todaySessions: goldenTodaySessions,
    todayIndex: goldenTodayIndex,
    todayPresentation: goldenTodayPresentation
  });
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

  await board.getByRole("button", { name: "现在整理" }).click();
  await expect(board.locator(".today-workline")).toHaveCount(0);
  await expect(board.getByRole("list", { name: "今日会话" }).locator(".today-session-lane")).toHaveCount(4);
  expect(await page.evaluate(() => (window as unknown as { prepareCallCount(): number }).prepareCallCount())).toBe(1);
});

test("canonical Traceink index is presented whole without legacy card interpretation", async ({ page }) => {
  await page.evaluate(() => (window as unknown as { setTodayScenario(next: "traceink"): void }).setTodayScenario("traceink"));

  const board = page.locator(".today-board");
  const document = board.getByRole("article", { name: "Traceink 工作脉络正文" });
  await expect(document).toBeVisible();
  await expect(document).toContainText("从 scheduler 吞吐实验转向 Research IR 表示假设");
  await expect(document).toContainText("0.6.0 双架构安装包的发布前边界检查");
  await expect(document).toContainText("AI 整理，尚未采纳");
  await expect(document).toContainText("你想先展开哪条工作线的证据档案：1 还是 2？");
  await expect(board.getByText("gpt-5.6-sol", { exact: true })).toBeVisible();
  await expect(board.getByText("ultra", { exact: true })).toBeVisible();
  await expect(board.getByRole("heading", { name: "工作活动与参与" })).toBeVisible();
  await expect(board.getByText("注意力负荷线索", { exact: true })).toBeVisible();
  await board.getByText("Traceink 未明确归属", { exact: true }).click();
  await expect(board.locator(".traceink-activity-map .today-session-lane")).toHaveCount(4);
  await expect(board.locator(".traceink-activity-map").getByText("你参与", { exact: true }).first()).toBeVisible();
  await expect(board.locator(".traceink-activity-map").getByText("Agent 独立推进", { exact: true }).first()).toBeVisible();
  await expect(board.locator(".today-workline")).toHaveCount(0);
  await expect(board.locator(".today-board-toolbar")).toHaveCount(0);
  await expect(board.getByRole("button", { name: /今日收口|打开材料|开始思考/ })).toHaveCount(0);
  expect(await document.locator("h1, h2, h3, p, li").allTextContents()).toEqual(expect.arrayContaining([
    expect.stringContaining("从 scheduler 吞吐实验转向 Research IR 表示假设"),
    expect.stringContaining("0.6.0 双架构安装包的发布前边界检查")
  ]));
});

test("today's proven Traceink result stays complete through activity, evidence, reflection, and proposal choices", async ({ page }) => {
  await page.evaluate(() => (window as unknown as { setTodayScenario(next: "traceink-golden"): void }).setTodayScenario("traceink-golden"));
  await page.evaluate(() => (window as unknown as { coexistLegacySealWithCanonicalIndex(): void }).coexistLegacySealWithCanonicalIndex());

  const board = page.locator(".today-board");
  const canonicalDocument = board.getByRole("article", { name: "Traceink 工作脉络正文" });
  const titles = [
    "把 Traceink 的真实产物变成 Work Continuity 的核心界面",
    "让自动因子发现引擎真正达到“中金式 AI Loop”标准",
    "有界因子发现实跑：首个 campaign 已封存但没有 Alpha",
    "Autoresearch Adapter ↔ Evaluator 自动往返与权限边界",
    "FOLO RSS → LLM-Wiki：从相关性筛选升级为证据质量门"
  ];
  await expect(canonicalDocument).toBeVisible();
  await expect(board.locator(".today-seal-mark")).toHaveCount(0);
  await expect(board.getByText("注意力负荷线索", { exact: true })).toBeVisible();
  for (const title of titles) await expect(canonicalDocument.getByRole("heading", { name: new RegExp(title) })).toBeVisible();
  await expect(board.locator(".traceink-workline-actions button")).toHaveCount(5);

  const activity = board.getByRole("region", { name: "工作活动与参与" });
  const groups = activity.locator(".traceink-activity-groups > details");
  await expect(groups).toHaveCount(6);
  await expect(groups.first()).not.toHaveAttribute("open", "");
  const ungrouped = groups.filter({ has: page.getByText("Traceink 未明确归属", { exact: true }) });
  await expect(ungrouped).toContainText("1 个 Session");
  await ungrouped.getByText("Traceink 未明确归属", { exact: true }).click();
  await expect(ungrouped.getByText("未在索引中逐项列出的 Traceink 子会话", { exact: true })).toBeVisible();
  await expect(ungrouped.getByText("无法确定", { exact: true })).toBeVisible();
  const expectedSignals = [
    { title: titles[0]!, time: "09:22–14:28", status: "正在推进", participation: "共同推进", stop: "code-mode host is disabled", change: "数据库只负责保存原文", evidence: "部分" },
    { title: titles[1]!, time: "09:16–14:25", status: "正在审计并补齐垂直证据链", participation: "共同推进", stop: "父本/参数动量", change: "历史经验必须真实改变下一轮候选分布", evidence: "长期真实 campaign 证据仍不足" },
    { title: titles[2]!, time: "12:16–14:28", status: "COMPLETED", participation: "Agent 独立推进", stop: "Campaign 已关闭", change: "49 个 seal candidate", evidence: "高" },
    { title: titles[3]!, time: "09:19–13:08", status: "AWAITING_HUMAN", participation: "Agent 独立推进", stop: "SSH 可达性与认证证据", change: "等待外部前置证据", evidence: "高" },
    { title: titles[4]!, time: "08:38–14:23", status: "今日运行完成", participation: "共同推进", stop: "本地先按", change: "有界原始来源核验", evidence: "高" }
  ];
  for (const signal of expectedSignals) {
    const group = groups.filter({ has: page.getByText(signal.title, { exact: true }) });
    await expect(group).toHaveCount(1);
    await expect(group.locator("summary")).toContainText(signal.time);
    await expect(group.locator("summary")).toContainText(signal.status);
    await expect(group.locator("summary")).toContainText(signal.participation);
    await group.locator("summary").click();
    const activityTrack = group.locator(".session-activity-track");
    await expect(activityTrack).toHaveCount(1);
    await expect(activityTrack.getByText("Agent 独立推进", { exact: true })).toBeVisible();
    if (signal.participation === "共同推进") await expect(activityTrack.getByText("你参与", { exact: true })).toBeVisible();
    await expect(group.getByText("当前停点", { exact: true })).toBeVisible();
    await expect(group).toContainText(signal.stop);
    await expect(group.locator(".traceink-activity-context span").filter({ hasText: /可能变化|结果/ })).toBeVisible();
    await expect(group).toContainText(signal.change);
    await expect(group.getByText("证据", { exact: true })).toBeVisible();
    await expect(group).toContainText(signal.evidence);
  }

  await board.getByRole("button", { name: new RegExp(titles[0]!) }).click();
  const dossier = page.getByRole("dialog", { name: titles[0]! });
  await expect(dossier).toBeVisible();
  await expect(dossier).toContainText("不把 AI 的候选解释冒充成你的判断");
  await expect(dossier.getByRole("region", { name: "可重开证据" })).toBeVisible();

  await dossier.locator(".traceink-evidence-register button").first().click();
  await expect(page.getByRole("dialog", { name: /会话记录/ })).toBeVisible();
  const selectedWorklineId = await page.evaluate(() => (window as unknown as {
    traceinkDossierRequests: Array<{ selection: { worklineId: string } }>;
  }).traceinkDossierRequests.at(-1)?.selection.worklineId);
  expect(await page.evaluate(() => (window as unknown as { transcriptRequests: Array<{ traceinkRef?: unknown }> }).transcriptRequests.at(-1)?.traceinkRef)).toEqual({
    logicalDate: "2026-08-15",
    artifactId: `traceink-dossier-${selectedWorklineId}`,
    stage: "dossier",
    revision: 1,
    outputHash: "b".repeat(64),
    evidenceId: "golden-session-1"
  });
  await page.getByRole("button", { name: "回到证据" }).click();

  const originalReflection = "我确认 Traceink 原文应该继续作为语义权威，但明天必须在重新构建的客户端里验证五条线和原始证据都能重开。";
  await dossier.getByPlaceholder("写下你的理解、保留意见或下一步判断…").fill(originalReflection);
  await dossier.getByRole("button", { name: "保存我的回顾" }).click();
  await expect(dossier.getByText("已保存版本 1", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { traceinkReflectionInputs: string[] }).traceinkReflectionInputs)).toEqual([originalReflection]);

  await dossier.getByRole("button", { name: "整理我的文字" }).click();
  const categories = ["形成的判断", "明日候选", "CTX 候选", "后台候选", "只留在今天"];
  for (const category of categories) await expect(dossier.getByRole("region", { name: category })).toBeVisible();
  await expect(dossier.getByText(originalReflection, { exact: true }).first()).toBeVisible();

  const judgment = dossier.getByRole("region", { name: "形成的判断" });
  await judgment.getByRole("button", { name: "接受" }).click();
  await expect(judgment.getByText("当前选择：接受", { exact: true })).toBeVisible();

  const tomorrow = dossier.getByRole("region", { name: "明日候选" });
  await tomorrow.getByRole("button", { name: "改写" }).click();
  const rewrittenTomorrow = "明天先用这五条黄金样本做一次真实客户端回归。";
  await tomorrow.getByRole("textbox", { name: "改写 T1" }).fill(rewrittenTomorrow);
  await tomorrow.getByRole("button", { name: "保存改写" }).click();
  await expect(tomorrow.getByText(`当前选择：改写 · ${rewrittenTomorrow}`, { exact: true })).toBeVisible();

  expect(await page.evaluate(() => (window as unknown as { traceinkProposalDispositions: unknown[] }).traceinkProposalDispositions)).toMatchObject([
    { proposalId: "J1", input: { action: "accept" } },
    { proposalId: "T1", input: { action: "rewrite", rewriteText: rewrittenTomorrow } }
  ]);
  expect(await page.evaluate(() => (window as unknown as { e2eSideEffectCounts(): unknown }).e2eSideEffectCounts())).toEqual({ wiki: 0, ctx: 0, background: 0 });
});

test("background preparation never replaces the raw work surface", async ({ page }) => {
  const board = page.locator(".today-board");
  await page.evaluate(() => (window as unknown as { setReviewPreparation(status: "preparing"): void }).setReviewPreparation("preparing"));

  await expect(board.getByRole("list", { name: "今日会话" }).locator(".today-session-lane")).toHaveCount(4);
  await expect(board.getByRole("button", { name: "正在准备工作脉络…" })).toBeDisabled();
  await expect(board.getByText(/工作现场仍可阅读；工作脉络会在后台准备好后自动出现/)).toBeVisible();

  await page.evaluate(() => (window as unknown as { setReviewPreparation(status: "failed", message: string): void }).setReviewPreparation("failed", "本次整理没有完成；原始工作现场仍然可读。"));
  await expect(board.getByRole("list", { name: "今日会话" }).locator(".today-session-lane")).toHaveCount(4);
  await expect(board.getByRole("button", { name: "重新整理" })).toBeVisible();
  await expect(board.getByRole("alert")).toContainText("原始工作现场仍然可读");
});

test("Sources exposes one restrained daily preparation setting without implementation language", async ({ page }) => {
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  const sources = page.locator(".sources-view");
  await expect(sources.getByText("每日自动准备工作脉络", { exact: true })).toBeVisible();
  await expect(sources.getByText("未开启", { exact: true })).toBeVisible();
  expect(await sources.innerText()).not.toMatch(/Skill|Traceink|KSI/i);

  await sources.getByRole("checkbox").check();
  const time = sources.getByLabel("每日自动整理时间");
  await expect(time).toBeEnabled();
  await time.fill("19:45");

  expect(await page.evaluate(() => (window as unknown as { settingsPatches: unknown[] }).settingsPatches)).toEqual([
    { dailyReviewScheduleEnabled: true, dailyReviewScheduleTime: "18:30" },
    { dailyReviewScheduleEnabled: true, dailyReviewScheduleTime: "19:45" }
  ]);
  await expect(sources.getByText("每天 19:45", { exact: true })).toBeVisible();
});

test("unsealed legacy packages never replace the canonical raw or Traceink surfaces", async ({ page }) => {
  await page.evaluate(() => (window as unknown as { setTodayScenario(next: "compiled"): void }).setTodayScenario("compiled"));
  const board = page.locator(".today-board");
  await expect(board.locator(".today-workline")).toHaveCount(0);
  await expect(board.getByRole("list", { name: "今日会话" }).locator(".today-session-lane")).toHaveCount(4);
  await expect(board.getByRole("button", { name: "今日收口" })).toHaveCount(0);

  await page.evaluate(() => (window as unknown as { setTodayScenario(next: "stale"): void }).setTodayScenario("stale"));
  await expect(board.locator(".today-workline")).toHaveCount(0);
  await expect(board.getByRole("list", { name: "今日会话" }).locator(".today-session-lane")).toHaveCount(4);

  await page.evaluate(() => (window as unknown as { setTodayScenario(next: "traceink"): void }).setTodayScenario("traceink"));
  await expect(board.getByRole("article", { name: "Traceink 工作脉络正文" })).toContainText("从 scheduler 吞吐实验转向 Research IR 表示假设");
  await expect(board.locator(".today-workline")).toHaveCount(0);
});

test("stale canonical index preserves the last good Markdown across a failed refresh", async ({ page }) => {
  await page.evaluate(() => (window as unknown as { setTodayScenario(next: "traceink-stale"): void }).setTodayScenario("traceink-stale"));
  const board = page.locator(".today-board");
  const document = board.getByRole("article", { name: "Traceink 工作脉络正文" });
  await expect(board.getByText("有新证据", { exact: true }).first()).toBeVisible();
  await expect(document).toContainText("0.6.0 双架构安装包的发布前边界检查");

  await page.evaluate(() => (window as unknown as { setPrepareFailure(fail: boolean): void }).setPrepareFailure(true));
  await board.getByRole("button", { name: "更新工作脉络" }).click();
  await expect(board.getByRole("alert")).toContainText("上一版仍然可读");
  await expect(document).toContainText("0.6.0 双架构安装包的发布前边界检查");
  await expect(board.locator(".today-workline")).toHaveCount(0);

  await page.evaluate(() => (window as unknown as { setPrepareFailure(fail: boolean): void }).setPrepareFailure(false));
  await board.getByRole("button", { name: "更新工作脉络" }).click();
  await expect(board.getByText("有新证据", { exact: true })).toHaveCount(0);
  await expect(document).toContainText("0.6.0 双架构安装包的发布前边界检查");
});

test("sealed board is read-only and transcript actions send the exact stored package reference", async ({ page }) => {
  const board = page.locator(".today-board");
  await page.evaluate(() => (window as unknown as { setTodayScenario(next: "sealed"): void }).setTodayScenario("sealed"));
  await page.evaluate(() => (window as unknown as { emitSmartTitle(title: string): void }).emitSmartTitle("后来快照的新标题"));
  await expect(board.getByText("已封存", { exact: true }).first()).toBeVisible();
  await expect(board.locator(".today-seal-mark")).toBeVisible();
  await expect(board.locator(".today-workline")).toHaveCount(2);
  await expect(board.locator(".today-board-toolbar .project-strip")).toHaveCount(0);
  await expect(board.locator(".today-activity-summary")).toHaveCount(0);
  await expect(board.getByRole("button", { name: /现在整理|更新工作脉络/ })).toHaveCount(0);
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
  await expect(page.locator(".brand-mark")).toHaveAttribute("src", "./app-icon.png");
  const logo = await page.locator(".brand-mark").boundingBox();
  const lastNavigationItem = await page.locator(".rail-nav button").last().boundingBox();
  expect(logo?.y).toBeGreaterThanOrEqual(48);
  expect((lastNavigationItem?.y ?? 0) + (lastNavigationItem?.height ?? 0)).toBeLessThan(590);
  const selectedProject = page.locator('.today-board-toolbar .project-strip button[aria-pressed="true"]');
  await expect(selectedProject).toBeVisible();
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
  await page.evaluate(() => (window as unknown as { setTodayScenario(next: "traceink"): void }).setTodayScenario("traceink"));
  await expect(page.locator(".today-board-scroll")).toHaveCSS("overflow-y", "auto");
  await expect(page.getByRole("article", { name: "Traceink 工作脉络正文" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("legacy note persistence remains available without a capture entry on Today", async ({ page }) => {
  await expect(page.getByRole("button", { name: "新建便签" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "便签正文" })).toHaveCount(0);
  expect(await page.evaluate(() => typeof window.agentWhiteboard.createNotebookNote)).toBe("function");
});

test("canonical index keeps reflection controls hidden until a workline is selected", async ({ page }) => {
  await page.evaluate(() => (window as unknown as { setTodayScenario(next: "traceink"): void }).setTodayScenario("traceink"));
  const board = page.locator(".today-board");
  const document = board.getByRole("article", { name: "Traceink 工作脉络正文" });
  await expect(document).toContainText("共同推进");
  await expect(document).toContainText("Agent 独立推进");
  await expect(document).toContainText("尚未采纳");
  await expect(document).toContainText("你想先展开哪条工作线的证据档案：1 还是 2？");
  await expect(board.getByRole("textbox", { name: "你的原始墨迹" })).toHaveCount(0);
  await expect(board.getByRole("button", { name: /今日收口|看完了，开始思考|打开材料/ })).toHaveCount(0);
});

test("daily review remains usable without horizontal overflow in a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 620 });
  await page.evaluate(() => (window as unknown as { setTodayScenario(next: "traceink"): void }).setTodayScenario("traceink"));
  await expect(page.getByRole("article", { name: "Traceink 工作脉络正文" })).toBeVisible();
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
