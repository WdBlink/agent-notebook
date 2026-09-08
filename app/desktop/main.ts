import { app, BrowserWindow, clipboard, dialog, ipcMain, powerMonitor, shell, type OpenDialogOptions } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StructuredTodayRuntimeStore } from "./structured-today-runtime-store";
import { readJsonFile, writeJsonFile } from "./json-file-store";
import { createCliSessionSummarizer } from "../../src/agent-summary";
import { NodeSqliteSaver } from "../../src/langgraph-node-sqlite-checkpointer";
import { projectStructuredTodayReview } from "../../src/structured-today-review-state";
import type { StructuredTodayReviewProjection } from "../../src/structured-today-review-state";
import type { TodayBoardMode } from "../../src/today-board";
import { compileTraceinkDossier, compileTraceinkIndex, compileTraceinkProposals } from "../../src/traceink-review";
import { traceinkArtifactReference, userReflectionAssetReference, type TraceinkArtifactReferenceV1, type TraceinkIndexArtifactV1, type TraceinkWorklineSelectionV1, type UserReflectionAssetReferenceV1 } from "../../src/traceink-review-assets";
import { loadAgentWorkSnapshot, mergeSessionSummaries, type RuntimeFileStat, type RuntimeFileSystem } from "../../src/agent-sessions";
import { DEFAULT_SESSION_SCAN_ROOTS, MAX_WORK_SESSION_SNAPSHOT_SESSIONS } from "../../src/constants";
import { createEmptyData, createEmptyWorkSessionSnapshot, localDateString, normalizeData, setWorkSessionSnapshot } from "../../src/state";
import { deriveDailyReviewPreparationState, normalizeDailyReviewScheduleTime, shouldScheduleSessionSummaries, shouldStartAutomaticDailyReview, type DailyReviewPreparationTrigger } from "../../src/daily-review-schedule";
import type { AgentWorkSession, AgentWorkSnapshot, CockpitData, SessionProvider } from "../../src/types";
import type { DailyDraftInput, DailyReviewPreparationMode, DailySealInput, DesktopNotebookState, DesktopSettingsPatch, DesktopState, DesktopSummaryJob, NotebookNote, NotebookNoteInput, ProjectContextDocument, ProjectContextState, SessionTranscriptRequest, SessionTranscriptState, StructuredTodayProgressState, StructuredTodayRunProgress, StructuredTodaySpanRequest, StructuredTodaySpanState, TraceinkProposalDispositionInput } from "./api";
import { DailyReviewBackgroundCoordinator } from "./daily-review-background";
import { desktopCliRunner } from "./cli-runner";
import {
  createEmptyNotebookDocument,
  createNotebookNote,
  deleteNotebookNote,
  findNotebookNote,
  markNotebookDelivery,
  normalizeNotebookDocument,
  notebookStateForDate,
  saveDailyDraft,
  sealDailyPage,
  sealStructuredTodayPage,
  setKnowledgeRoot,
  updateNotebookNote,
  type NotebookDocument
} from "./notebook-store";
import { commitNotebookMutation } from "./notebook-mutation";
import { authorizeSessionTranscriptRequest } from "./session-transcript-access";
import { readBoundedTranscriptSource } from "./transcript-source-reader";
import {
  createEmptySessionSummaryCache,
  normalizeSessionSummaryCache,
  readCachedSessionSummaries,
  writeCachedSessionSummaries,
  type SessionSummaryCacheDocument,
  type SummaryModelMap
} from "./session-summary-cache";
import { parseSessionTranscript } from "./transcript-reader";
import { createSessionActivityCache } from "./session-activity-cache";
import { sessionUserAuthorKind } from "./session-authority";
import {
  createTraceinkAssetRepository,
  traceinkAssetStorePath,
  type TraceinkAssetRepository
} from "./traceink-asset-repository";
import {
  activeIndexReferenceForDate,
  appendTraceinkDossierRevision,
  appendTraceinkProposalDisposition,
  appendTraceinkProposalsRevision,
  appendTraceinkReflectionRevision,
  appendStructuredTodayProposalDisposition,
  appendStructuredTodayReflectionRevision,
  currentTraceinkWorklineLineage,
  findTraceinkArtifact,
  findTraceinkReflection,
  latestTraceinkDossier,
  activeStructuredTodayIndexReferenceForDate,
  findStructuredTodayIndex,
  findStructuredTodayIndexV2Candidate,
  findStructuredTodayDossierV2Candidate,
  latestStructuredTodayDossier,
  latestStructuredTodayProposalDispositions,
  latestStructuredTodayProposals,
  latestStructuredTodayReflection,
  latestStructuredTodayIndexV2Candidate,
  sameTraceinkArtifactReference,
  sameTraceinkReflectionReference,
  structuredTodayDossierReference,
  structuredTodayReflectionReference,
  type StructuredTodayIndexReferenceV1
} from "./traceink-asset-store";
import { readStructuredTodaySpanTarget } from "./structured-today-span-access";
import { runTraceinkReviewPreparation } from "./traceink-review-preparation";
import {
  automaticTraceinkEligibilityMode,
  boundedTraceinkError,
  effectiveTraceinkReviewState,
  exposeTraceinkFailure,
  traceinkActivityDates,
  traceinkScopeFromSnapshot
} from "./traceink-desktop-state";
import {
  runStructuredTodayDossierPreparation,
  runStructuredTodayIndexPreparation,
  runStructuredTodayProposalPreparation
} from "./structured-today-runtime";
import { runStructuredTodayIndexV2CandidatePreparation } from "./structured-today-v2-runtime";
import { runStructuredTodayDossierV2CandidatePreparation } from "./structured-today-v2-dossier-runtime";
import { projectStructuredTodayProgress } from "./structured-today-progress";
import { structuredTodaySessionFamilies } from "./structured-today-input";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.AGENT_WHITEBOARD_DEV === "1";
const structuredTodayProducerEnabled = process.env.AGENT_NOTEBOOK_STRUCTURED_TODAY !== "0";
const messageSpanCandidateEnabled = !app.isPackaged && process.env.AGENT_NOTEBOOK_MESSAGE_SPANS === "1";
const storeFileName = "cockpit-data.json";
const summaryCacheFileName = "session-summary-cache-v1.json";
const notebookFileName = "notebook-v1.json";
const structuredTodayCheckpointFileName = "structured-today-workflows-v1.sqlite";
const summaryModels: SummaryModelMap = {
  codex: process.env.AGENT_NOTEBOOK_CODEX_SUMMARY_MODEL?.trim() || "gpt-5.3-codex-spark",
  claude: process.env.AGENT_NOTEBOOK_CLAUDE_SUMMARY_MODEL?.trim() || "fable"
};

let mainWindow: BrowserWindow | undefined;
let data: CockpitData | undefined;
let notebook = createEmptyNotebookDocument();
let activeDate = localDateString();
let summaryCache = createEmptySessionSummaryCache();
let summaryRunId = 0;
let summaryAbort: AbortController | undefined;
let snapshotRunId = 0;
let stateRevision = 0;
let structuredRuntimeStore: StructuredTodayRuntimeStore | undefined;
let activityDateCache: { key: string; dates: Promise<string[]> } | undefined;
let pendingBroadcast: Promise<void> | undefined;
let broadcastAgain = false;
let summaryJob: DesktopSummaryJob = { status: "idle", total: 0, completed: 0, models: summaryModels };
let traceinkAssetRepository: TraceinkAssetRepository | undefined;
let structuredTodayCheckpointer: NodeSqliteSaver | undefined;
const traceinkReviewErrors = new Map<string, string>();
const structuredTodayProgressByDate = new Map<string, StructuredTodayProgressState>();
const structuredTodayDossierRuns = new Map<string, Promise<void>>();
const structuredTodayProposalRuns = new Map<string, Promise<void>>();
const sessionActivityCache = createSessionActivityCache({
  async readTranscript(session) {
    const source = await readBoundedTranscriptSource(session.path, {
      origin: "current-snapshot",
      ...(session.transcriptCapture ? { transcriptCapture: session.transcriptCapture } : {})
    });
    return parseSessionTranscript({
      content: source.content,
      platform: session.platform,
      sessionId: session.id,
      title: session.title,
      path: session.path,
      truncated: source.truncated,
      userAuthorKind: sessionUserAuthorKind(session)
    });
  }
});
const dailyReviewCoordinator = new DailyReviewBackgroundCoordinator();
let dailyReviewScheduleTimer: NodeJS.Timeout | undefined;
let dailyReviewScheduleEvaluationRunning = false;

const runtimeFs: RuntimeFileSystem = {
  async stat(filePath: string): Promise<RuntimeFileStat> {
    return fs.stat(filePath);
  },
  async readdir(filePath: string): Promise<string[]> {
    return fs.readdir(filePath);
  },
  async readFile(filePath: string, encoding: "utf8"): Promise<string> {
    return fs.readFile(filePath, encoding);
  },
  async readBytes(filePath: string): Promise<Uint8Array> {
    return fs.readFile(filePath);
  },
  async realpath(filePath: string): Promise<string> {
    return fs.realpath(filePath);
  }
};

app.setName("Agent Notebook");
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => { mainWindow?.show(); mainWindow?.focus(); });

void app.whenReady().then(async () => {
  traceinkAssetRepository = createTraceinkAssetRepository({
    filePath: traceinkAssetStorePath(app.getPath("userData")),
    onPublish() { void broadcastState(); }
  });
  [data, notebook] = await Promise.all([loadStore(), loadNotebook()]);
  [summaryCache] = await Promise.all([
    loadSummaryCache(),
    traceinkAssetRepository.load()
  ]);
  try {
    const assets = await traceinkAssetRepository.load();
    await requireStructuredTodayCheckpointer().prune((assets.structuredRuns ?? []).filter((run) => run.status === "ready").map((run) => run.runId));
  } catch {
    console.warn("Checkpoint startup maintenance deferred.");
  }
  if (data.workSessionSnapshot.date !== activeDate) data = setWorkSessionSnapshot(data, createEmptyWorkSessionSnapshot(activeDate));
  if (process.platform === "darwin") app.dock?.setIcon(path.join(__dirname, "app-icon.png"));
  createWindow();
  await refreshSnapshot(activeDate);
  await broadcastState();
  startDailyReviewSchedule();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    void evaluateAutomaticDailyReview();
  });
  powerMonitor.on("resume", () => { void evaluateAutomaticDailyReview(); });
}).catch((error: unknown) => {
  dialog.showErrorBox("Agent Notebook 无法加载本地数据", errorMessage(error));
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (dailyReviewScheduleTimer) clearInterval(dailyReviewScheduleTimer);
  try {
    structuredTodayCheckpointer?.close();
    structuredRuntimeStore?.close();
  } catch {
    // Shutdown must not be held open by an already-closed checkpoint handle.
  } finally {
    structuredTodayCheckpointer = undefined;
  }
});

ipcMain.handle("desktop:get-state", async (_event, date?: string) => {
  const nextDate = date ? cleanDate(date, activeDate) : activeDate;
  if (nextDate !== activeDate) {
    activeDate = nextDate;
    await refreshSnapshot(activeDate);
  }
  await ensureLoaded();
  return buildState();
});

ipcMain.handle("desktop:refresh-sessions", async (_event, date?: string) => {
  if (date) activeDate = cleanDate(date, activeDate);
  await refreshSnapshot(activeDate);
  return buildState();
});

ipcMain.handle("desktop:update-settings", async (_event, patch: DesktopSettingsPatch) => {
  const current = await ensureLoaded();
  const enabledSessionProviders = normalizeProviders(patch.enabledSessionProviders, current.settings.enabledSessionProviders);
  const sessionScanRoots = normalizeRoots(patch.sessionScanRoots, current.settings.sessionScanRoots);
  const sourcesChanged = patch.enabledSessionProviders !== undefined || patch.sessionScanRoots !== undefined;
  data = normalizeData({
    ...current,
    settings: {
      ...current.settings,
      enabledSessionProviders,
      sessionScanRoots,
      dailyReviewScheduleEnabled: patch.dailyReviewScheduleEnabled ?? current.settings.dailyReviewScheduleEnabled,
      dailyReviewScheduleTime: patch.dailyReviewScheduleTime === undefined
        ? current.settings.dailyReviewScheduleTime
        : normalizeDailyReviewScheduleTime(patch.dailyReviewScheduleTime)
    }
  });
  await persistStore(data);
  if (patch.knowledgeRoot !== undefined) {
    await mutateNotebook(activeDate, (currentNotebook) => setKnowledgeRoot(currentNotebook, patch.knowledgeRoot!));
  }
  if (sourcesChanged) await refreshSnapshot(activeDate);
  const state = await buildState();
  void evaluateAutomaticDailyReview();
  return state;
});

ipcMain.handle("desktop:create-notebook-note", async (_event, date: string, input: NotebookNoteInput) => {
  const logicalDate = cleanDate(date, activeDate);
  return mutateNotebook(logicalDate, (current) => createNotebookNote(current, logicalDate, input));
});

ipcMain.handle("desktop:update-notebook-note", async (_event, noteId: string, patch: Partial<Pick<NotebookNote, "title" | "body" | "favorite">>) => {
  return mutateNotebook(activeDate, (current) => updateNotebookNote(current, cleanIdentifier(noteId), patch));
});

ipcMain.handle("desktop:delete-notebook-note", async (_event, noteId: string) => {
  return mutateNotebook(activeDate, (current) => deleteNotebookNote(current, cleanIdentifier(noteId)));
});

ipcMain.handle("desktop:export-notebook-note-card", async (_event, noteId: string) => {
  const note = findNotebookNote(notebook, cleanIdentifier(noteId));
  const outputDirectory = path.join(app.getPath("documents"), "Agent Notebook Cards");
  await fs.mkdir(outputDirectory, { recursive: true });
  const target = path.join(outputDirectory, `${note.logicalDate}-${safeFileName(note.title)}-${note.id.slice(-8)}.svg`);
  await fs.writeFile(target, renderNoteCard(note), "utf8");
  await mutateNotebook(activeDate, (current) => markNotebookDelivery(current, note.id, {
    kind: "card",
    deliveredAt: new Date().toISOString(),
    target,
    status: "delivered"
  }));
  await shell.openPath(target);
  return { notebook: notebookView(activeDate), path: target };
});

ipcMain.handle("desktop:route-notebook-note-to-wiki", async (_event, noteId: string) => {
  const note = findNotebookNote(notebook, cleanIdentifier(noteId));
  const root = await fs.realpath(expandHome(notebook.knowledgeRoot)).catch(() => "");
  if (!root) throw new Error("LLM-Wiki 根目录不存在，请先在 Sources 中设置。");
  const rawRoot = path.join(root, "raw");
  const targetDirectory = path.join(rawRoot, "agent-notebook", note.logicalDate);
  await fs.mkdir(targetDirectory, { recursive: true });
  const target = path.join(targetDirectory, `${timestampSlug()}-${safeFileName(note.title)}.md`);
  await fs.writeFile(target, renderProtocolCapture(note, "llm-wiki"), { encoding: "utf8", flag: "wx" });
  await mutateNotebook(activeDate, (current) => markNotebookDelivery(current, note.id, {
    kind: "wiki",
    deliveredAt: new Date().toISOString(),
    target,
    status: "queued"
  }));
  return { notebook: notebookView(activeDate), path: target };
});

ipcMain.handle("desktop:route-notebook-note-to-project", async (_event, noteId: string, requestedProjectPath: string) => {
  const note = findNotebookNote(notebook, cleanIdentifier(noteId));
  const projectPath = await verifiedSnapshotProjectPath(requestedProjectPath);
  const ctxStore = await fs.realpath(path.join(projectPath, "ctx")).catch(() => "");
  if (!ctxStore) throw new Error("这个项目还没有可读取的 CTX；应用不会替用户自动采用 CTX。");
  const targetDirectory = path.join(ctxStore, "scratch", "inbox");
  await fs.mkdir(targetDirectory, { recursive: true });
  const target = path.join(targetDirectory, `${note.logicalDate}-${timestampSlug()}-${safeFileName(note.title)}.md`);
  await fs.writeFile(target, renderProtocolCapture(note, "ctx", projectPath), { encoding: "utf8", flag: "wx" });
  await mutateNotebook(activeDate, (current) => markNotebookDelivery(current, note.id, {
    kind: "project",
    deliveredAt: new Date().toISOString(),
    target,
    status: "queued"
  }));
  return { notebook: notebookView(activeDate), path: target };
});

ipcMain.handle("desktop:prepare-daily-review", async (_event, date: string, mode: DailyReviewPreparationMode) => {
  return startDailyReviewForDate(date, mode, "manual");
});

ipcMain.handle("desktop:prepare-traceink-dossier", async (_event, date: string, selection: TraceinkWorklineSelectionV1) => {
  const logicalDate = cleanDate(date, activeDate);
  const repository = requireTraceinkAssetRepository();
  const store = repository.snapshot();
  const active = activeIndexReferenceForDate(store, logicalDate);
  if (!active || JSON.stringify(active) !== JSON.stringify(selection?.sourceIndex)) throw new Error("工作脉络已经更新，请从当前版本重新选择。");
  const index = store.artifacts.find((artifact): artifact is TraceinkIndexArtifactV1 =>
    artifact.stage === "index" && artifact.id === active.artifactId && artifact.revision === active.revision && artifact.outputHash === active.outputHash
  );
  if (!index) throw new Error("当前工作脉络无法读取。");
  if (latestTraceinkDossier(store, active, selection.worklineId)) return buildState();
  const current = await ensureLoaded();
  const sessions = sessionsForTraceinkArtifact(index, current.workSessionSnapshot.sessions);
  const scope = index.producer.scope;
  if (!scope) throw new Error("当前工作脉络缺少冻结材料范围，无法展开档案。");
  const draft = await compileTraceinkDossier(current.settings, index, selection, sessions, {
    runner: desktopCliRunner,
    scope,
    coverage: index.coverage,
    timeoutMs: 30 * 60 * 1_000
  });
  await repository.mutate((document) => appendTraceinkDossierRevision(document, draft, active));
  return buildState();
});

ipcMain.handle("desktop:prepare-structured-today-dossier", async (
  _event,
  date: string,
  indexReference: StructuredTodayIndexReferenceV1,
  worklineId: string
) => {
  const logicalDate = cleanDate(date, activeDate);
  const repository = requireTraceinkAssetRepository();
  const store = repository.snapshot();
  const active = activeStructuredTodayIndexReferenceForDate(store, logicalDate);
  const cleanWorklineId = cleanIdentifier(worklineId);
  if (!active || !sameStructuredTodayReference(active, indexReference)) {
    throw new Error("工作脉络已经更新，请从当前版本重新选择。");
  }
  if (!findStructuredTodayIndex(store, active)?.worklines.some((item) => item.worklineId === cleanWorklineId)) {
    throw new Error("选择的工作线不属于当前结构化索引。");
  }
  if (latestStructuredTodayDossier(store, active, cleanWorklineId)) return buildState();
  const runKey = `${logicalDate}:${active.artifactId}:${active.revision}:${cleanWorklineId}`;
  if (!structuredTodayDossierRuns.has(runKey)) {
    const current = await ensureLoaded();
    setStructuredDossierProgress(logicalDate, cleanWorklineId, {
      runId: runKey,
      status: "queued",
      stage: "gather-evidence",
      completed: 0,
      total: 4,
      message: "正在准备所选工作线的证据档案。"
    });
    const completion = Promise.resolve().then(async () => {
      setStructuredDossierProgress(logicalDate, cleanWorklineId, {
        runId: runKey,
        status: "running",
        stage: "gather-evidence",
        completed: 0,
        total: 4
      });
      await broadcastState();
      try {
        await runStructuredTodayDossierPreparation({
          logicalDate,
          indexReference: active,
          worklineId: cleanWorklineId,
          settings: current.settings,
          repository,
          checkpointer: requireStructuredTodayCheckpointer(),
          runtimeStore: requireStructuredRuntimeStore(),
          runner: desktopCliRunner,
          onProgress(progress) {
            const currentProgress = structuredTodayProgressByDate.get(logicalDate)?.dossierByWorklineId[cleanWorklineId];
            const ready = progress.status === "ready";
            setStructuredDossierProgress(logicalDate, cleanWorklineId, {
              runId: runKey,
              status: progress.status === "failed" ? "failed" : "running",
              stage: progress.stage,
              completed: Math.min(4, (currentProgress?.completed ?? 0) + (ready ? 1 : 0)),
              total: 4
            });
            broadcastStructuredProgress(logicalDate);
          }
        });
        setStructuredDossierProgress(logicalDate, cleanWorklineId, {
          runId: runKey,
          status: "ready",
          stage: "ready",
          completed: 4,
          total: 4
        });
      } catch (error) {
        setStructuredDossierProgress(logicalDate, cleanWorklineId, {
          runId: runKey,
          status: "failed",
          stage: "failed",
          completed: 0,
          total: 4,
          message: boundedTraceinkError(error)
        });
      } finally {
        structuredTodayDossierRuns.delete(runKey);
        await broadcastState();
      }
    });
    structuredTodayDossierRuns.set(runKey, completion);
  }
  return buildState();
});

ipcMain.handle("desktop:prepare-structured-today-v2-candidate", async (_event, date: string) => {
  if (!messageSpanCandidateEnabled) throw new Error("消息级 evidence span 候选功能尚未启用。");
  const logicalDate = cleanDate(date, activeDate);
  const current = await ensureLoaded();
  const snapshot = current.workSessionSnapshot.date === logicalDate
    ? structuredClone(current.workSessionSnapshot)
    : await refreshSnapshot(logicalDate, { scheduleSummaries: false, publish: logicalDate === activeDate });
  await runStructuredTodayIndexV2CandidatePreparation({
    logicalDate,
    snapshot,
    settings: current.settings,
    repository: requireTraceinkAssetRepository(),
    checkpointer: requireStructuredTodayCheckpointer(),
    runner: desktopCliRunner
  });
  return buildState();
});

ipcMain.handle("desktop:prepare-structured-today-v2-dossier-candidate", async (
  _event,
  date: string,
  indexReference: StructuredTodayIndexReferenceV1,
  worklineId: string
) => {
  if (!messageSpanCandidateEnabled) throw new Error("消息级 evidence span 候选功能尚未启用。");
  const logicalDate = cleanDate(date, activeDate);
  const store = requireTraceinkAssetRepository().snapshot();
  const index = findStructuredTodayIndexV2Candidate(store, indexReference);
  if (!index || index.logicalDate !== logicalDate) throw new Error("指定 V2 index candidate 无法精确解析。");
  await runStructuredTodayDossierV2CandidatePreparation({
    sourceIndex: indexReference,
    worklineId: cleanIdentifier(worklineId),
    settings: (await ensureLoaded()).settings,
    repository: requireTraceinkAssetRepository(),
    checkpointer: requireStructuredTodayCheckpointer(),
    runner: desktopCliRunner
  });
  return buildState();
});

ipcMain.handle("desktop:save-structured-today-reflection", async (
  _event,
  date: string,
  indexReference: StructuredTodayIndexReferenceV1,
  worklineId: string,
  text: string
) => {
  const logicalDate = cleanDate(date, activeDate);
  const cleanWorklineId = cleanIdentifier(worklineId);
  const repository = requireTraceinkAssetRepository();
  await repository.mutate((document) => {
    const active = activeStructuredTodayIndexReferenceForDate(document, logicalDate);
    const dossier = active && sameStructuredTodayReference(active, indexReference)
      ? latestStructuredTodayDossier(document, active, cleanWorklineId)
      : undefined;
    if (!dossier) throw new Error("结构化证据档案已经变化，请重新打开后再保存。");
    return appendStructuredTodayReflectionRevision(
      document,
      dossier,
      String(text ?? ""),
      new Date().toISOString()
    );
  });
  return buildState();
});

ipcMain.handle("desktop:prepare-structured-today-proposals", async (
  _event,
  date: string,
  indexReference: StructuredTodayIndexReferenceV1,
  worklineId: string
) => {
  const logicalDate = cleanDate(date, activeDate);
  const cleanWorklineId = cleanIdentifier(worklineId);
  const repository = requireTraceinkAssetRepository();
  const starting = repository.snapshot();
  const active = activeStructuredTodayIndexReferenceForDate(starting, logicalDate);
  const dossier = active && sameStructuredTodayReference(active, indexReference)
    ? latestStructuredTodayDossier(starting, active, cleanWorklineId)
    : undefined;
  const reflection = dossier ? latestStructuredTodayReflection(starting, dossier) : undefined;
  if (!active || !dossier || !reflection) throw new Error("请先保存这条工作线的个人回顾。");
  if (latestStructuredTodayProposals(starting, reflection)) return buildState();
  const runKey = `${logicalDate}:${reflection.reflectionId}:${reflection.revision}`;
  if (!structuredTodayProposalRuns.has(runKey)) {
    const current = await ensureLoaded();
    setStructuredProposalProgress(logicalDate, cleanWorklineId, {
      runId: runKey,
      status: "queued",
      stage: "proposal-arrange",
      completed: 0,
      total: 1,
      message: "正在把你的原始回顾整理为五类待选提案。"
    });
    const completion = Promise.resolve().then(async () => {
      try {
        await runStructuredTodayProposalPreparation({
          logicalDate,
          indexReference: active,
          worklineId: cleanWorklineId,
          reflection,
          settings: current.settings,
          repository,
          checkpointer: requireStructuredTodayCheckpointer(),
          runtimeStore: requireStructuredRuntimeStore(),
          runner: desktopCliRunner,
          onProgress(progress) {
            setStructuredProposalProgress(logicalDate, cleanWorklineId, {
              runId: runKey,
              status: progress.status === "failed" ? "failed" : "running",
              stage: progress.stage,
              completed: progress.status === "ready" ? 1 : 0,
              total: 1
            });
            broadcastStructuredProgress(logicalDate);
          }
        });
        setStructuredProposalProgress(logicalDate, cleanWorklineId, {
          runId: runKey,
          status: "ready",
          stage: "ready",
          completed: 1,
          total: 1
        });
      } catch (error) {
        setStructuredProposalProgress(logicalDate, cleanWorklineId, {
          runId: runKey,
          status: "failed",
          stage: "failed",
          completed: 0,
          total: 1,
          message: boundedTraceinkError(error)
        });
      } finally {
        structuredTodayProposalRuns.delete(runKey);
        await broadcastState();
      }
    });
    structuredTodayProposalRuns.set(runKey, completion);
  }
  return buildState();
});

ipcMain.handle("desktop:dispose-structured-today-proposal", async (
  _event,
  date: string,
  proposalReference: { artifactId: string; revision: number; contentHash: string },
  proposalId: string,
  input: { action: "accept" | "dismiss" | "defer" | "rewrite"; rewriteText?: string }
) => {
  const logicalDate = cleanDate(date, activeDate);
  const repository = requireTraceinkAssetRepository();
  await repository.mutate((document) => {
    const proposalArtifact = (document.structuredProposals ?? []).find((artifact) =>
      artifact.artifactId === proposalReference?.artifactId &&
      artifact.revision === proposalReference?.revision &&
      artifact.contentHash === proposalReference?.contentHash &&
      artifact.logicalDate === logicalDate
    );
    if (!proposalArtifact) throw new Error("结构化回顾提案已经变化，请重新打开后再处理。");
    return appendStructuredTodayProposalDisposition(
      document,
      proposalArtifact,
      cleanIdentifier(proposalId),
      {
        action: input?.action,
        ...(input?.rewriteText !== undefined ? { rewriteText: input.rewriteText } : {}),
        decidedAt: new Date().toISOString()
      }
    );
  });
  return buildState();
});

ipcMain.handle("desktop:seal-structured-today-page", async (
  _event,
  date: string,
  input: { index: StructuredTodayIndexReferenceV1; bookmarkIds: string[] }
) => {
  const logicalDate = cleanDate(date, activeDate);
  const repository = requireTraceinkAssetRepository();
  const store = repository.snapshot();
  const active = activeStructuredTodayIndexReferenceForDate(store, logicalDate);
  if (!active || !sameStructuredTodayReference(active, input?.index)) {
    throw new Error("结构化工作脉络已经变化，请重新查看后再封页。");
  }
  const index = findStructuredTodayIndex(store, active);
  if (!index) throw new Error("当前结构化工作脉络无法读取。");
  const dossiers = index.worklines.flatMap((workline) => {
    const dossier = latestStructuredTodayDossier(store, active, workline.worklineId);
    return dossier ? [dossier] : [];
  });
  const reflections = dossiers.flatMap((dossier) => {
    const reflection = latestStructuredTodayReflection(store, dossier);
    return reflection ? [reflection] : [];
  });
  const proposals = reflections.flatMap((reflection) => {
    const proposal = latestStructuredTodayProposals(store, reflection);
    if (!proposal) throw new Error("已保存的个人回顾还没有完成五类提案整理。");
    return [proposal];
  });
  const dispositions = proposals.flatMap((proposal) => {
    const latest = latestStructuredTodayProposalDispositions(store, proposal);
    if (latest.length !== proposal.proposals.length) {
      throw new Error("仍有结构化回顾提案尚未明确处理，不能封页。");
    }
    return latest;
  });
  const current = await ensureLoaded();
  const sessions = current.workSessionSnapshot.date === logicalDate
    ? structuredClone(current.workSessionSnapshot.sessions)
    : [];
  const candidates = notebookStateForDate(notebook, logicalDate, sessions).continuationCandidates;
  await mutateNotebook(logicalDate, (document) => sealStructuredTodayPage(
    document,
    logicalDate,
    index,
    reflections,
    {
      index: active,
      dossiers: dossiers.map((dossier) => ({ ...structuredTodayDossierReference(dossier), worklineId: dossier.worklineId })),
      reflections: reflections.map((reflection) => ({ ...structuredTodayReflectionReference(reflection), worklineId: reflection.worklineId })),
      proposals: proposals.map((proposal) => ({
        artifactId: proposal.artifactId,
        revision: proposal.revision,
        contentHash: proposal.contentHash,
        worklineId: proposal.worklineId
      })),
      dispositions: dispositions.map((disposition) => ({
        dispositionId: disposition.dispositionId,
        revision: disposition.revision,
        proposalId: disposition.proposalId
      }))
    },
    candidates,
    input.bookmarkIds
  ), sessions);
  await broadcastState();
  return buildState();
});

ipcMain.handle("desktop:save-traceink-reflection", async (_event, date: string, dossier: TraceinkArtifactReferenceV1 & { stage: "dossier" }, text: string) => {
  const logicalDate = cleanDate(date, activeDate);
  const repository = requireTraceinkAssetRepository();
  await repository.mutate((document) => {
    const artifact = document.artifacts.find((item) => item.id === dossier?.artifactId && item.stage === "dossier" && item.revision === dossier?.revision && item.outputHash === dossier?.outputHash);
    const lineage = artifact?.stage === "dossier" && artifact.worklineId
      ? currentTraceinkWorklineLineage(document, logicalDate, artifact.worklineId)
      : undefined;
    if (!artifact || artifact.logicalDate !== logicalDate || !lineage?.dossier || !sameTraceinkArtifactReference(
      traceinkArtifactReference(lineage.dossier),
      dossier
    )) {
      throw new Error("证据档案已经变化，请重新打开后再保存。");
    }
    return appendTraceinkReflectionRevision(document, dossier, String(text ?? ""), new Date().toISOString());
  });
  return buildState();
});

ipcMain.handle("desktop:prepare-traceink-proposals", async (_event, date: string, reflectionReference: UserReflectionAssetReferenceV1) => {
  const logicalDate = cleanDate(date, activeDate);
  const repository = requireTraceinkAssetRepository();
  const startingDocument = repository.snapshot();
  const reflection = findTraceinkReflection(startingDocument, reflectionReference);
  if (!reflection || reflection.logicalDate !== logicalDate) {
    throw new Error("保存的回顾已经变化，请重新打开后再整理提案。");
  }
  const lineage = currentTraceinkWorklineLineage(startingDocument, logicalDate, reflection.worklineId);
  if (!lineage?.dossier || !lineage.reflection || !sameTraceinkReflectionReference(
    userReflectionAssetReference(lineage.reflection),
    reflectionReference
  )) {
    throw new Error("回顾引用的证据档案已经不可用。");
  }
  if (lineage.proposals) return buildState();
  const dossier = lineage.dossier;
  const current = await ensureLoaded();
  const { sourceReflection: _sourceReflection, ...dossierFields } = dossier;
  const draft = await compileTraceinkProposals(current.settings, {
    ...dossierFields,
    stage: "dossier",
    worklineId: dossier.worklineId
  }, reflection, {
    runner: desktopCliRunner,
    timeoutMs: 30 * 60 * 1_000
  });
  await repository.mutate((document) => {
    const currentReflection = findTraceinkReflection(document, reflectionReference);
    const currentLineage = currentReflection
      ? currentTraceinkWorklineLineage(document, logicalDate, currentReflection.worklineId)
      : undefined;
    if (!currentLineage?.dossier || !currentLineage.reflection || !sameTraceinkReflectionReference(
      userReflectionAssetReference(currentLineage.reflection),
      reflectionReference
    )) {
      throw new Error("工作脉络已经更新，请从当前版本重新整理提案。");
    }
    return appendTraceinkProposalsRevision(
      document,
      draft,
      reflectionReference,
      null
    );
  });
  return buildState();
});

ipcMain.handle("desktop:dispose-traceink-proposal", async (
  _event,
  date: string,
  proposals: TraceinkArtifactReferenceV1 & { stage: "proposals" },
  proposalId: string,
  input: TraceinkProposalDispositionInput
) => {
  const logicalDate = cleanDate(date, activeDate);
  const repository = requireTraceinkAssetRepository();
  await repository.mutate((document) => {
    const artifact = findTraceinkArtifact(document, proposals);
    if (!artifact || artifact.stage !== "proposals" || artifact.logicalDate !== logicalDate) {
      throw new Error("回顾提案已经变化，请重新打开后再处理。");
    }
    const lineage = artifact.worklineId
      ? currentTraceinkWorklineLineage(document, logicalDate, artifact.worklineId)
      : undefined;
    if (!lineage?.proposals || !sameTraceinkArtifactReference(
      traceinkArtifactReference(lineage.proposals),
      proposals
    )) {
      throw new Error("工作脉络已经更新，请从当前版本重新处理提案。");
    }
    return appendTraceinkProposalDisposition(document, proposals, String(proposalId ?? ""), {
      action: input?.action,
      ...(input?.rewriteText !== undefined ? { rewriteText: input.rewriteText } : {}),
      decidedAt: new Date().toISOString()
    });
  });
  return buildState();
});

ipcMain.handle("desktop:compose-daily-page", async (_event, date: string) => {
  return startDailyReviewForDate(date, undefined, "manual");
});

ipcMain.handle("desktop:save-daily-draft", async (_event, date: string, input: DailyDraftInput) => {
  const logicalDate = cleanDate(date, activeDate);
  const current = await ensureLoaded();
  const capturedSessions = current.workSessionSnapshot.date === logicalDate ? structuredClone(current.workSessionSnapshot.sessions) : [];
  const candidates = notebookStateForDate(notebook, logicalDate, capturedSessions).continuationCandidates;
  return mutateNotebook(logicalDate, (document) => saveDailyDraft(document, logicalDate, input, candidates), capturedSessions);
});

ipcMain.handle("desktop:seal-daily-page", async (_event, date: string, input: DailySealInput) => {
  const logicalDate = cleanDate(date, activeDate);
  const current = await ensureLoaded();
  const capturedSessions = current.workSessionSnapshot.date === logicalDate ? structuredClone(current.workSessionSnapshot.sessions) : [];
  const candidates = notebookStateForDate(notebook, logicalDate, capturedSessions).continuationCandidates;
  return mutateNotebook(logicalDate, (document) => sealDailyPage(document, logicalDate, input, candidates), capturedSessions);
});

ipcMain.handle("desktop:get-project-context", async (_event, projectPath: string) => {
  return loadProjectContext(projectPath);
});

ipcMain.handle("desktop:get-session-transcript", async (_event, request: SessionTranscriptRequest) => {
  return loadSessionTranscript(request);
});

ipcMain.handle("desktop:get-structured-today-span", async (
  _event,
  request: StructuredTodaySpanRequest
): Promise<StructuredTodaySpanState> => {
  if (!messageSpanCandidateEnabled) throw new Error("消息级 evidence span 候选功能尚未启用。");
  const ownerInput = request?.owner;
  if (!ownerInput || !/^\d{4}-\d{2}-\d{2}$/u.test(ownerInput.logicalDate)) {
    throw new Error("消息级引用的 owner date 无效。");
  }
  const logicalDate = ownerInput.logicalDate;
  const reference = {
    artifactId: cleanIdentifier(ownerInput?.artifactId),
    revision: Number(ownerInput?.revision),
    contentHash: String(ownerInput?.contentHash ?? "")
  };
  if (!Number.isSafeInteger(reference.revision) || reference.revision < 1 || !/^[a-f0-9]{64}$/u.test(reference.contentHash)) {
    throw new Error("消息级引用的 owner reference 无效。");
  }
  const store = requireTraceinkAssetRepository().snapshot();
  const owner = ownerInput?.kind === "index-v2-candidate"
    ? findStructuredTodayIndexV2Candidate(store, reference)
    : ownerInput?.kind === "dossier-v2-candidate"
      ? findStructuredTodayDossierV2Candidate(store, reference)
      : undefined;
  if (!owner || owner.logicalDate !== logicalDate) throw new Error("消息级引用的 owner artifact 无法精确解析。");
  const target = await readStructuredTodaySpanTarget({
    owner,
    statementId: cleanIdentifier(request?.statementId),
    spanId: cleanIdentifier(request?.spanId)
  });
  return {
    status: "exact",
    owner: {
      kind: ownerInput.kind,
      logicalDate,
      artifactId: owner.artifactId,
      revision: owner.revision,
      contentHash: owner.contentHash
    },
    statementId: target.statementId,
    spanId: target.spanId,
    evidenceId: target.evidenceId,
    provider: target.provider,
    sessionId: target.sessionId,
    role: target.role,
    authorKind: target.authorKind,
    messageKey: target.messageKey,
    messageLocatorId: target.messageLocatorId,
    content: target.content,
    utf16Start: target.utf16Start,
    utf16End: target.utf16End,
    messages: target.messages,
    omittedBefore: target.omittedBefore,
    omittedAfter: target.omittedAfter
  };
});

ipcMain.handle("desktop:choose-directory", async () => {
  const options: OpenDialogOptions = {
    properties: ["openDirectory", "createDirectory"]
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.handle("desktop:copy-text", async (_event, text: string) => {
  clipboard.writeText(String(text));
  return true;
});

ipcMain.handle("desktop:open-path", async (_event, target: string, reveal?: boolean) => {
  const clean = cleanPath(target);
  if (!clean) return false;
  const expanded = expandHome(clean);
  try {
    if (reveal) {
      shell.showItemInFolder(expanded);
      return true;
    }
    const error = await shell.openPath(expanded);
    return !error;
  } catch {
    return false;
  }
});

async function startDailyReviewForDate(
  requestedDate: string,
  _requestedMode: DailyReviewPreparationMode | undefined,
  trigger: DailyReviewPreparationTrigger,
  prefetchedSnapshot?: AgentWorkSnapshot
): Promise<DesktopNotebookState> {
  const logicalDate = String(requestedDate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(logicalDate)) throw new Error("回看日期无效。");
  const activeRun = dailyReviewCoordinator.activeRun;
  if (activeRun && activeRun.logicalDate !== logicalDate) throw new Error("另一天的工作脉络正在准备，请稍后再试。");
  const existingBoard = notebookView(logicalDate).todayBoard;
  const current = await ensureLoaded();
  const assetStore = requireTraceinkAssetRepository().snapshot();
  const structured = projectStructuredTodayReview(
    assetStore,
    logicalDate,
    current.workSessionSnapshot.sessions
  );
  const legacy = effectiveTraceinkReviewState(
    assetStore,
    logicalDate,
    current.workSessionSnapshot.sessions,
    existingBoard.mode
  );
  const boardMode = effectiveStructuredBoardMode(logicalDate, structured, legacy.boardMode);
  if (boardMode === "sealed") throw new Error("这一天已经封页，不能重新整理。");
  if (!activeRun) traceinkReviewErrors.delete(logicalDate);
  dailyReviewCoordinator.start({
    logicalDate,
    trigger,
    run: () => performDailyReviewForDate(logicalDate, prefetchedSnapshot),
    onStateChange: broadcastState
  });
  return notebookView(logicalDate);
}

async function performDailyReviewForDate(
  logicalDate: string,
  prefetchedSnapshot?: AgentWorkSnapshot
): Promise<void> {
  try {
    const snapshot = prefetchedSnapshot?.date === logicalDate
      ? prefetchedSnapshot
      : await refreshSnapshot(logicalDate, {
          scheduleSummaries: false,
          publish: logicalDate === activeDate
        });
    if (snapshot.date !== logicalDate) throw new Error("工作脉络的 Session 快照日期不匹配。");
    const current = await ensureLoaded();
    const capturedSessions = structuredClone(snapshot.sessions);
    const legacyBoard = notebookStateForDate(notebook, logicalDate, capturedSessions).todayBoard;
    const repository = requireTraceinkAssetRepository();
    const assetStore = repository.snapshot();
    const structured = projectStructuredTodayReview(
      assetStore,
      logicalDate,
      capturedSessions
    );
    const legacy = effectiveTraceinkReviewState(assetStore, logicalDate, capturedSessions, legacyBoard.mode);
    const boardMode = effectiveStructuredBoardMode(logicalDate, structured, legacy.boardMode);
    if (boardMode === "sealed") throw new Error("这一天已经封页，不能重新整理。");
    if (!structuredTodayProducerEnabled && !structured.activeIndex) {
      const scope = traceinkScopeFromSnapshot(snapshot, logicalDate);
      await runTraceinkReviewPreparation({
        logicalDate,
        mode: legacy.projection.mode,
        snapshotDate: snapshot.date,
        evidenceCutoff: scope.evidenceCutoff,
        sessions: capturedSessions
      }, {
        repository,
        compile({ logicalDate: date, capturedSessions: sessions }) {
          return compileTraceinkIndex(current.settings, date, sessions, {
            runner: desktopCliRunner,
            scope,
            coverage: structuredClone(snapshot.evidenceCoverage ?? []),
            timeoutMs: 30 * 60 * 1_000
          });
        }
      });
      traceinkReviewErrors.delete(logicalDate);
      return;
    }
    const runId = `structured-today-index:${logicalDate}:${snapshot.generatedAt}`;
    const digestFamilyCount = structuredTodaySessionFamilies(capturedSessions.flatMap((session) =>
      session.platform === "codex" || session.platform === "claude" ? [session] : []
    )).length;
    const progressTotal = digestFamilyCount + 2;
    setStructuredIndexProgress(logicalDate, {
      runId,
      status: "running",
      stage: "capture-evidence",
      completed: 0,
      total: progressTotal,
      message: `正在冻结 ${digestFamilyCount} 个主会话家族并生成结构化工作脉络。`
    });
    await runStructuredTodayIndexPreparation({
      logicalDate,
      snapshot,
      settings: current.settings,
      repository,
      checkpointer: requireStructuredTodayCheckpointer(),
      runtimeStore: requireStructuredRuntimeStore(),
      runner: desktopCliRunner,
      onProgress(progress) {
        const existing = structuredTodayProgressByDate.get(logicalDate)?.index;
        const terminalDigest = progress.stage === "digest" &&
          (progress.status === "ready" || progress.status === "failed" || progress.status === "excluded");
        const synthesisReady = progress.stage === "index-synthesis" && progress.status === "ready";
        setStructuredIndexProgress(logicalDate, {
          runId,
          status: progress.status === "failed" ? "failed" : "running",
          stage: progress.stage,
          completed: Math.min(
            progressTotal,
            (existing?.completed ?? 0) + (terminalDigest || synthesisReady ? 1 : 0)
          ),
          total: progressTotal
        });
        broadcastStructuredProgress(logicalDate);
      }
    });
    setStructuredIndexProgress(logicalDate, {
      runId,
      status: "ready",
      stage: "ready",
      completed: progressTotal,
      total: progressTotal
    });
    traceinkReviewErrors.delete(logicalDate);
  } catch (error) {
    traceinkReviewErrors.set(logicalDate, boundedTraceinkError(error));
    const existing = structuredTodayProgressByDate.get(logicalDate)?.index;
    setStructuredIndexProgress(logicalDate, {
      runId: existing?.runId ?? `structured-today-index:${logicalDate}:failed`,
      status: "failed",
      stage: "failed",
      completed: existing?.completed ?? 0,
      total: existing?.total ?? 0,
      message: boundedTraceinkError(error)
    });
    throw error;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 720,
    minHeight: 620,
    title: "Agent Notebook",
    backgroundColor: "#f4f2eb",
    titleBarStyle: "hiddenInset",
    icon: path.join(__dirname, "app-icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  void mainWindow.loadFile(path.join(__dirname, "index.html"));
  if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
}

async function ensureLoaded(): Promise<CockpitData> {
  if (!data) data = await loadStore();
  return data;
}

async function loadStore(): Promise<CockpitData> {
  return normalizeData(await readJsonFile(storePath(), createEmptyData));
}

async function persistStore(next: CockpitData): Promise<void> {
  await writeJsonFile(storePath(), next);
}

function storePath(): string {
  return path.join(app.getPath("userData"), storeFileName);
}

function summaryCachePath(): string {
  return path.join(app.getPath("userData"), summaryCacheFileName);
}

function notebookPath(): string {
  return path.join(app.getPath("userData"), notebookFileName);
}

async function loadNotebook(): Promise<NotebookDocument> {
  return normalizeNotebookDocument(await readJsonFile(notebookPath(), createEmptyNotebookDocument));
}

async function persistNotebook(next: NotebookDocument): Promise<void> {
  await writeJsonFile(notebookPath(), next);
}

let notebookWriteQueue: Promise<void> = Promise.resolve();

async function mutateNotebook(
  logicalDate: string,
  operation: (current: NotebookDocument) => NotebookDocument,
  viewSessions = snapshotSessionsForDate(logicalDate)
): Promise<DesktopNotebookState> {
  let result: DesktopNotebookState | undefined;
  const write = notebookWriteQueue.then(async () => {
    result = await commitNotebookMutation({
      current: notebook,
      logicalDate,
      viewSessions,
      operation,
      persist: persistNotebook,
      publish(next) { notebook = next; }
    });
  });
  notebookWriteQueue = write.catch(() => undefined);
  await write;
  if (!result) throw new Error("手帐数据没有完成保存。");
  return result;
}

function notebookView(logicalDate: string): DesktopNotebookState {
  return notebookStateForDate(notebook, logicalDate, snapshotSessionsForDate(logicalDate));
}

function snapshotSessionsForDate(logicalDate: string): CockpitData["workSessionSnapshot"]["sessions"] {
  return data?.workSessionSnapshot.date === logicalDate ? structuredClone(data.workSessionSnapshot.sessions) : [];
}

async function loadSummaryCache(): Promise<SessionSummaryCacheDocument> {
  try {
    return normalizeSessionSummaryCache(JSON.parse(await fs.readFile(summaryCachePath(), "utf8")) as unknown);
  } catch {
    return createEmptySessionSummaryCache();
  }
}

async function persistSummaryCache(): Promise<void> {
  await writeJsonFile(summaryCachePath(), summaryCache);
}

async function refreshSnapshot(
  date: string,
  options: { scheduleSummaries?: boolean; publish?: boolean } = {}
): Promise<AgentWorkSnapshot> {
  if (options.publish !== false) summaryAbort?.abort();
  const requestId = options.publish !== false ? ++snapshotRunId : snapshotRunId;
  const runId = options.publish !== false ? ++summaryRunId : summaryRunId;
  const current = await ensureLoaded();
  const snapshot = await loadAgentWorkSnapshot(current.settings, {
    date,
    fs: runtimeFs,
    homeDir: os.homedir(),
    maxFiles: 180,
    maxSessions: MAX_WORK_SESSION_SNAPSHOT_SESSIONS,
    maxDepth: 5,
    maxEntries: 2400
  });
  activityDateCache = undefined;
  const cached = readCachedSessionSummaries(summaryCache, date, snapshot.sessions, summaryModels);
  const cachedSnapshot = { ...snapshot, sessions: mergeSessionSummaries(snapshot.sessions, cached.summaries) };
  const legacyBoardMode = notebookStateForDate(notebook, date, cachedSnapshot.sessions).todayBoard.mode;
  const assetStore = requireTraceinkAssetRepository().snapshot();
  const structuredReview = projectStructuredTodayReview(assetStore, date, cachedSnapshot.sessions);
  const legacyReviewMode = effectiveTraceinkReviewState(
    assetStore,
    date,
    cachedSnapshot.sessions,
    legacyBoardMode
  ).boardMode;
  const reviewMode = effectiveStructuredBoardMode(date, structuredReview, legacyReviewMode);
  const latest = await ensureLoaded();
  const canPublish = () => options.publish !== false && requestId === snapshotRunId && date === activeDate &&
    JSON.stringify([current.settings.sessionScanRoots, current.settings.enabledSessionProviders]) ===
    JSON.stringify([data?.settings.sessionScanRoots, data?.settings.enabledSessionProviders]);
  if (!canPublish()) return cachedSnapshot;
  data = normalizeData(setWorkSessionSnapshot(latest, cachedSnapshot));
  await persistStore(data);
  if (!canPublish()) return cachedSnapshot;
  if (
    options.scheduleSummaries !== false &&
    options.publish !== false &&
    !dailyReviewCoordinator.activeRun &&
    shouldScheduleSessionSummaries(reviewMode)
  ) {
    scheduleSessionSummaries(runId, date, snapshot.sessions, cached.misses, current.settings);
  } else if (options.publish !== false && !shouldScheduleSessionSummaries(reviewMode)) {
    summaryJob = {
      status: "idle",
      total: 0,
      completed: 0,
      models: summaryModels,
      message: "工作脉络优先；Session 标题整理暂不占用模型。"
    };
  }
  return cachedSnapshot;
}

function scheduleSessionSummaries(
  runId: number,
  date: string,
  scannedSessions: CockpitData["workSessionSnapshot"]["sessions"],
  misses: CockpitData["workSessionSnapshot"]["sessions"],
  settings: CockpitData["settings"]
): void {
  const disabled = process.env.AGENT_NOTEBOOK_DISABLE_SUMMARIES === "1" || settings.sessionSummaryMode !== "native";
  if (disabled || misses.length === 0) {
    summaryJob = {
      status: disabled ? "idle" : "complete",
      total: misses.length,
      completed: 0,
      models: summaryModels,
      ...(disabled ? { message: "智能标题已关闭，当前显示会话元数据。" } : {})
    };
    return;
  }

  summaryJob = {
    status: "running",
    total: misses.length,
    completed: 0,
    models: summaryModels,
    message: "正在后台生成会话标题；不会阻塞本地简报。"
  };
  void broadcastState();
  let processed = 0;
  let completed = 0;
  summaryAbort?.abort();
  summaryAbort = new AbortController();
  const summarizer = createCliSessionSummarizer({
    signal: summaryAbort.signal,
    runner: desktopCliRunner,
    homeDir: os.homedir(),
    modelByPlatform: summaryModels,
    batchSize: 1,
    concurrency: 2,
    onBatch: async (batch) => {
      if (runId !== summaryRunId || date !== activeDate) return;
      processed += 1;
      completed += batch.summaries.length;
      await applySummaryBatch(runId, date, scannedSessions, batch);
      if (runId !== summaryRunId || date !== activeDate) return;
      summaryJob = {
        status: "running",
        total: misses.length,
        completed,
        models: summaryModels,
        message: `已处理 ${processed}/${misses.length} 条会话；完成的智能标题已立即显示。`
      };
      await broadcastState();
    }
  });
  void summarizer({ date, sessions: misses, settings }).then(async (batch) => {
    if (runId !== summaryRunId || date !== activeDate) return;
    summaryJob = {
      status: batch.summaries.length > 0 ? "complete" : "unavailable",
      total: misses.length,
      completed: batch.summaries.length,
      models: summaryModels,
      ...(batch.warnings.length ? { message: batch.warnings.join("；") } : {})
    };
    await broadcastState();
  }).catch(async (error: unknown) => {
    if (runId !== summaryRunId || date !== activeDate) return;
    summaryJob = {
      status: "unavailable",
      total: misses.length,
      completed: 0,
      models: summaryModels,
      message: `智能标题生成失败，已保留元数据标题：${errorMessage(error)}`
    };
    await broadcastState();
  });
}

async function applySummaryBatch(
  runId: number,
  date: string,
  scannedSessions: CockpitData["workSessionSnapshot"]["sessions"],
  batch: Awaited<ReturnType<ReturnType<typeof createCliSessionSummarizer>>>
): Promise<void> {
  const current = await ensureLoaded();
  if (runId !== summaryRunId || date !== activeDate || current.workSessionSnapshot.date !== date) return;
  summaryCache = writeCachedSessionSummaries(summaryCache, date, scannedSessions, batch.summaries, summaryModels);
  const mergedSnapshot = {
    ...current.workSessionSnapshot,
    sessions: mergeSessionSummaries(current.workSessionSnapshot.sessions, batch.summaries),
    warnings: Array.from(new Set([...current.workSessionSnapshot.warnings, ...batch.warnings])).slice(0, 8)
  };
  data = normalizeData(setWorkSessionSnapshot(current, mergedSnapshot));
  await Promise.all([persistStore(data), persistSummaryCache()]);
}

async function broadcastState(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (pendingBroadcast) {
    broadcastAgain = true;
    return pendingBroadcast;
  }
  pendingBroadcast = (async () => {
    do {
      broadcastAgain = false;
      const state = await buildState();
      if (mainWindow && !mainWindow.isDestroyed() && state.activeDate === activeDate) {
        mainWindow.webContents.send("desktop:state-changed", state);
      }
    } while (broadcastAgain);
  })();
  try { await pendingBroadcast; } finally { pendingBroadcast = undefined; }
}

async function buildState(): Promise<DesktopState> {
  const revision = ++stateRevision;
  const requestDate = activeDate;
  const current = await ensureLoaded();
  const [providerActivityDates, activity] = await Promise.all([
    cachedActivityDates(current.settings.sessionScanRoots, current.settings.enabledSessionProviders),
    loadDailySessionActivity(requestDate, current.workSessionSnapshot.sessions)
  ]);
  const assetStore = requireTraceinkAssetRepository().snapshot();
  const activityDates = Array.from(new Set([
    ...providerActivityDates,
    ...notebook.notes.map((note) => note.logicalDate),
    ...Object.keys(notebook.pages),
    ...traceinkActivityDates(assetStore)
  ])).sort((a, b) => b.localeCompare(a)).slice(0, 70);
  const notebookState = notebookStateForDate(notebook, requestDate, current.workSessionSnapshot.sessions);
  const traceinkState = effectiveTraceinkReviewState(
    assetStore,
    requestDate,
    current.workSessionSnapshot.sessions,
    notebookState.todayBoard.mode
  );
  const structuredTodayReview = projectStructuredTodayReview(
    assetStore,
    requestDate,
    current.workSessionSnapshot.sessions
  );
  const structuredTodayV2Index = messageSpanCandidateEnabled
    ? latestStructuredTodayIndexV2Candidate(assetStore, requestDate)
    : undefined;
  const structuredTodayV2Dossiers = structuredTodayV2Index
    ? (assetStore.structuredDossierV2Candidates ?? []).filter((dossier) =>
        dossier.sourceIndex.artifactId === structuredTodayV2Index.artifactId &&
        dossier.sourceIndex.revision === structuredTodayV2Index.revision &&
        dossier.sourceIndex.contentHash === structuredTodayV2Index.contentHash
      )
    : [];
  const structuredTodayV2Issues = structuredTodayV2Index
    ? [
        structuredTodayV2Index.worklines.length > 0 ? "" : "候选没有生成可读取的工作线。",
        structuredTodayV2Index.coverage.failed ? `${structuredTodayV2Index.coverage.failed} 个 Session 处理失败。` : "",
        structuredTodayV2Index.coverage.unresolved ? `${structuredTodayV2Index.coverage.unresolved} 个 Session 尚未归入工作线。` : ""
      ].filter(Boolean)
    : [];
  const structuredTodayV2Status = !structuredTodayV2Index
    ? "empty" as const
    : structuredTodayV2Index.coverage.failed > 0 || structuredTodayV2Index.worklines.length === 0
      ? "failed" as const
      : structuredTodayV2Index.coverage.unresolved > 0 || !structuredTodayV2Index.coverage.complete
        ? "partial" as const
        : "complete" as const;
  const effectiveBoardMode = effectiveStructuredBoardMode(
    requestDate,
    structuredTodayReview,
    traceinkState.boardMode
  );
  const traceinkReviewError = traceinkReviewErrors.get(requestDate);
  const reviewPreparation = exposeTraceinkFailure(deriveDailyReviewPreparationState({
    enabled: current.settings.dailyReviewScheduleEnabled,
    time: current.settings.dailyReviewScheduleTime,
    logicalDate: requestDate,
    today: localDateString(),
    boardMode: effectiveBoardMode,
    sessionCount: current.workSessionSnapshot.sessions.length,
    ...(traceinkReviewError ? { compilationError: traceinkReviewError } : {}),
    ...(dailyReviewCoordinator.activeRun ? { activeRun: dailyReviewCoordinator.activeRun } : {})
  }), traceinkReviewError, effectiveBoardMode);
  return {
    stateRevision: revision,
    data: current,
    activeDate: requestDate,
    activityDates,
    appVersion: app.getVersion(),
    userDataPath: app.getPath("userData"),
    notebook: notebookState,
    activity,
    summaryJob,
    traceinkReview: traceinkState.projection,
    structuredTodayReview,
    structuredTodayV2Candidate: {
      enabled: messageSpanCandidateEnabled,
      ...(structuredTodayV2Index ? { index: structuredTodayV2Index } : {}),
      dossiers: structuredTodayV2Dossiers,
      status: structuredTodayV2Status,
      issues: structuredTodayV2Issues
    },
    structuredTodayProgress: projectStructuredTodayProgress(
      requestDate,
      [...(assetStore.structuredRuns ?? []), ...requireStructuredRuntimeStore().listRuns()],
      structuredTodayProgressByDate.get(requestDate) ?? { dossierByWorklineId: {} }
    ),
    ...(traceinkReviewError ? { traceinkReviewError } : {}),
    reviewPreparation
  };
}

function startDailyReviewSchedule(): void {
  if (dailyReviewScheduleTimer) clearInterval(dailyReviewScheduleTimer);
  dailyReviewScheduleTimer = setInterval(() => { void evaluateAutomaticDailyReview(); }, 30_000);
  dailyReviewScheduleTimer.unref?.();
  void evaluateAutomaticDailyReview();
}

async function evaluateAutomaticDailyReview(now = new Date()): Promise<void> {
  if (dailyReviewScheduleEvaluationRunning || dailyReviewCoordinator.activeRun) return;
  const current = await ensureLoaded();
  if (!current.settings.dailyReviewScheduleEnabled) return;
  const logicalDate = localDateString(now);
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  if (clock < current.settings.dailyReviewScheduleTime) return;
  if (dailyReviewCoordinator.hasScheduledAttempt(logicalDate)) return;

  dailyReviewScheduleEvaluationRunning = true;
  try {
    const snapshot = await refreshSnapshot(logicalDate, {
      scheduleSummaries: false,
      publish: activeDate === logicalDate
    });
    const legacyBoard = notebookStateForDate(notebook, logicalDate, snapshot.sessions).todayBoard;
    const assetStore = requireTraceinkAssetRepository().snapshot();
    const structuredReview = projectStructuredTodayReview(assetStore, logicalDate, snapshot.sessions);
    const legacyReview = effectiveTraceinkReviewState(
      assetStore,
      logicalDate,
      snapshot.sessions,
      legacyBoard.mode
    );
    const boardMode = effectiveStructuredBoardMode(logicalDate, structuredReview, legacyReview.boardMode);
    if (!shouldStartAutomaticDailyReview({
      enabled: current.settings.dailyReviewScheduleEnabled,
      time: current.settings.dailyReviewScheduleTime,
      logicalDate,
      now,
      sessionCount: snapshot.sessions.length,
      boardMode: automaticTraceinkEligibilityMode(boardMode),
      hasFailure: Boolean(traceinkReviewErrors.get(logicalDate)),
      inFlight: Boolean(dailyReviewCoordinator.activeRun),
      attempted: dailyReviewCoordinator.hasScheduledAttempt(logicalDate)
    })) return;
    await startDailyReviewForDate(logicalDate, boardMode === "raw" ? "compile" : "refresh", "scheduled", snapshot);
  } catch {
    // A local scan failure leaves Today usable and will be retried at the next scheduler tick.
  } finally {
    dailyReviewScheduleEvaluationRunning = false;
  }
}

function requireTraceinkAssetRepository(): TraceinkAssetRepository {
  if (!traceinkAssetRepository) throw new Error("Traceink 资产仓库尚未加载。");
  return traceinkAssetRepository;
}

function requireStructuredTodayCheckpointer(): NodeSqliteSaver {
  structuredTodayCheckpointer ??= NodeSqliteSaver.fromConnectionString(
    path.join(app.getPath("userData"), structuredTodayCheckpointFileName)
  );
  return structuredTodayCheckpointer;
}

function requireStructuredRuntimeStore(): StructuredTodayRuntimeStore {
  structuredRuntimeStore ??= new StructuredTodayRuntimeStore(path.join(app.getPath("userData"), "structured-today-state-v1.sqlite"));
  return structuredRuntimeStore;
}

function broadcastStructuredProgress(logicalDate: string): void {
  if (!mainWindow || mainWindow.isDestroyed() || logicalDate !== activeDate) return;
  mainWindow.webContents.send("desktop:structured-progress", {
    logicalDate, stateRevision: ++stateRevision,
    progress: structuredTodayProgressByDate.get(logicalDate) ?? { dossierByWorklineId: {} }
  });
}

function cachedActivityDates(roots: string[], providers: SessionProvider[]): Promise<string[]> {
  const key = JSON.stringify([roots, providers]);
  if (!activityDateCache || activityDateCache.key !== key) {
    activityDateCache = { key, dates: findActivityDates(roots, providers) };
  }
  return activityDateCache.dates;
}

function setStructuredIndexProgress(logicalDate: string, progress: StructuredTodayRunProgress): void {
  const current = structuredTodayProgressByDate.get(logicalDate) ?? { dossierByWorklineId: {} };
  structuredTodayProgressByDate.set(logicalDate, {
    ...current,
    index: progress,
    dossierByWorklineId: current.dossierByWorklineId
  });
}

function setStructuredDossierProgress(
  logicalDate: string,
  worklineId: string,
  progress: StructuredTodayRunProgress
): void {
  const current = structuredTodayProgressByDate.get(logicalDate) ?? { dossierByWorklineId: {} };
  structuredTodayProgressByDate.set(logicalDate, {
    ...current,
    dossierByWorklineId: {
      ...current.dossierByWorklineId,
      [worklineId]: progress
    }
  });
}

function setStructuredProposalProgress(
  logicalDate: string,
  worklineId: string,
  progress: StructuredTodayRunProgress
): void {
  const current = structuredTodayProgressByDate.get(logicalDate) ?? { dossierByWorklineId: {} };
  structuredTodayProgressByDate.set(logicalDate, {
    ...current,
    dossierByWorklineId: current.dossierByWorklineId,
    proposalByWorklineId: {
      ...(current.proposalByWorklineId ?? {}),
      [worklineId]: progress
    }
  });
}

function sameStructuredTodayReference(
  left: StructuredTodayIndexReferenceV1,
  right: StructuredTodayIndexReferenceV1
): boolean {
  return left.artifactId === right?.artifactId &&
    left.revision === right?.revision &&
    left.contentHash === right?.contentHash;
}

function effectiveStructuredBoardMode(
  logicalDate: string,
  structured: StructuredTodayReviewProjection,
  fallback: TodayBoardMode
): TodayBoardMode {
  if (fallback === "sealed" && notebook.pages[logicalDate]?.structuredCloseout) return "sealed";
  return structured.activeIndex ? structured.mode : fallback;
}

function sessionsForTraceinkArtifact(index: TraceinkIndexArtifactV1, current: AgentWorkSession[]): AgentWorkSession[] {
  return index.evidence.filter((evidence) => evidence.kind === "session").map((evidence) => {
    const end = /^bytes 0-(\d+)$/.exec(evidence.locator)?.[1];
    const session = current.find((candidate) => candidate.platform === evidence.provider && candidate.id === evidence.sessionId && candidate.path === evidence.path);
    if (!session || !end || !evidence.contentHash) throw new Error(`索引证据 ${evidence.id} 当前无法按原冻结范围重开。`);
    const byteLength = Number(end);
    return {
      ...structuredClone(session),
      path: evidence.path,
      transcriptCapture: {
        canonicalPath: evidence.path,
        sha256: evidence.contentHash,
        byteLength,
        coverage: { startByte: 0, endByte: byteLength }
      }
    };
  });
}

async function findActivityDates(roots: string[], providers: SessionProvider[]): Promise<string[]> {
  const enabled = new Set(providers);
  const dates = new Set<string>();
  const cutoff = Date.now() - 70 * 24 * 60 * 60 * 1000;
  let inspected = 0;

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > 5 || inspected > 3600) return;
    let entries: string[];
    try {
      entries = await fs.readdir(directory);
    } catch {
      return;
    }
    for (const entry of entries.sort().reverse()) {
      if (inspected > 3600) return;
      inspected += 1;
      const absolute = path.join(directory, entry);
      let stat;
      try {
        stat = await fs.stat(absolute);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        await walk(absolute, depth + 1);
        continue;
      }
      if (!stat.isFile() || !/\.(jsonl|json|md|txt)$/i.test(entry)) continue;
      const platform = inferProvider(absolute);
      if (platform && !enabled.has(platform)) continue;
      for (const time of [stat.mtime.getTime(), stat.ctime.getTime()]) {
        if (time >= cutoff) dates.add(localDateString(new Date(time)));
      }
    }
  }

  for (const root of normalizeRoots(roots, DEFAULT_SESSION_SCAN_ROOTS)) await walk(expandHome(root), 0);
  return [...dates].sort((a, b) => b.localeCompare(a)).slice(0, 70);
}

function inferProvider(value: string): SessionProvider | undefined {
  if (value.toLowerCase().includes("copilot")) return "copilot";
  const lower = value.toLowerCase();
  if (lower.includes("codex")) return "codex";
  if (lower.includes("claude")) return "claude";
  if (lower.includes("cursor")) return "cursor";
  return undefined;
}

function normalizeProviders(value: unknown, fallback: SessionProvider[]): SessionProvider[] {
  if (!Array.isArray(value)) return fallback;
  const supported = new Set<SessionProvider>(["codex", "claude", "copilot", "cursor"]);
  const next = value.filter((provider): provider is SessionProvider => supported.has(provider as SessionProvider));
  return Array.from(new Set(next));
}

function normalizeRoots(value: unknown, fallback: string[]): string[] {
  const raw = Array.isArray(value) ? value : [];
  const next = raw.map((item) => (typeof item === "string" ? item.trim() : "")).filter((item) => item && !item.includes("\0"));
  return next.length > 0 ? Array.from(new Set(next)).slice(0, 12) : fallback;
}

function cleanDate(value: string, fallback: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function cleanPath(value: string): string | undefined {
  const clean = String(value).trim();
  return clean && !/[\r\n\0]/.test(clean) ? clean : undefined;
}

function cleanIdentifier(value: unknown): string {
  const clean = typeof value === "string" ? value.trim() : "";
  if (!clean || clean.length > 2_000 || /[\r\n\0]/.test(clean)) throw new Error("无效的本地记录标识。");
  return clean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message.replace(/\s+/g, " ").trim().slice(-220) : "未知错误";
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

async function verifiedSnapshotProjectPath(input: string): Promise<string> {
  const clean = cleanPath(input);
  if (!clean) throw new Error("项目路径无效。");
  const requested = await fs.realpath(expandHome(clean)).catch(() => "");
  if (!requested) throw new Error("项目目录不存在。");
  const current = await ensureLoaded();
  const candidates = current.workSessionSnapshot.sessions
    .map((session) => session.worktreePath ?? session.projectPath ?? session.repositoryPath)
    .filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const canonical = await fs.realpath(expandHome(candidate)).catch(() => "");
    if (canonical === requested) return requested;
  }
  throw new Error("项目不在当前只读会话快照中，拒绝写入。");
}

function renderProtocolCapture(note: NotebookNote, protocol: "ctx" | "llm-wiki", projectPath?: string): string {
  const metadata = [
    "---",
    `title: ${yamlString(note.title)}`,
    `created: ${note.createdAt}`,
    `logical_date: ${note.logicalDate}`,
    "source: agent-notebook-note",
    `source_id: ${yamlString(note.id)}`,
    `protocol: ${protocol}`,
    "status: pending-absorption",
    ...(projectPath ? [`project_path: ${yamlString(projectPath)}`] : []),
    "---",
    "",
    `# ${note.title}`,
    "",
    note.body,
    "",
    "> 原始便签由 Agent Notebook 写入；后续分类与吸收由目标协议管理。",
    ""
  ];
  return metadata.join("\n");
}

function renderNoteCard(note: NotebookNote): string {
  const lines = wrapCardText(note.body, 25, 12);
  const body = lines.map((line, index) => `<text x="124" y="${286 + index * 54}" class="body">${escapeXml(line)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500" viewBox="0 0 1200 1500"><defs><filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="28" stdDeviation="28" flood-color="#3b2619" flood-opacity=".18"/></filter><pattern id="paper" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M0 11.5h12" stroke="#e8ddca" stroke-width="1"/></pattern></defs><rect width="1200" height="1500" fill="#d9c4a4"/><rect x="70" y="62" width="1060" height="1376" rx="26" fill="#fffaf0" filter="url(#shadow)"/><rect x="70" y="62" width="1060" height="1376" rx="26" fill="url(#paper)"/><rect x="70" y="62" width="18" height="1376" rx="9" fill="#b84f32"/><text x="124" y="142" class="meta">AGENT NOTEBOOK · ${escapeXml(note.logicalDate)}</text><text x="124" y="226" class="title">${escapeXml(note.title)}</text>${body}<line x1="124" y1="1320" x2="1074" y2="1320" stroke="#d7c9b4"/><text x="124" y="1370" class="foot">${escapeXml(note.sourceLabel)} · ${escapeXml(formatCardTime(note.createdAt))}</text><style>.meta,.foot{font:600 22px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:3px;fill:#8d7965}.title{font:600 50px Georgia,'Songti SC',serif;fill:#2a2723}.body{font:400 34px Georgia,'Songti SC',serif;fill:#514a42}</style></svg>`;
}

function wrapCardText(value: string, width: number, maxLines: number): string[] {
  const characters = Array.from(value.replace(/\s+/g, " ").trim());
  const lines: string[] = [];
  for (let index = 0; index < characters.length && lines.length < maxLines; index += width) lines.push(characters.slice(index, index + width).join(""));
  if (characters.length > width * maxLines && lines.length) lines[lines.length - 1] = `${lines.at(-1)?.slice(0, -1)}…`;
  return lines;
}

function escapeXml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function yamlString(value: string): string { return JSON.stringify(value.replace(/\r?\n/g, " ")); }
function safeFileName(value: string): string { return value.replace(/[\\/:*?"<>|\0]/g, "-").replace(/\s+/g, "-").slice(0, 64) || "note"; }
function timestampSlug(date = new Date()): string { return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
function formatCardTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date); }

async function loadProjectContext(input: string): Promise<ProjectContextState> {
  const cleaned = cleanPath(input);
  const fallback: ProjectContextState = {
    projectPath: cleaned ?? String(input),
    documents: [],
    warnings: []
  };
  if (!cleaned) return { ...fallback, warnings: ["项目路径无效，无法读取项目文档。"] };

  let projectPath: string;
  let storePath: string;
  try {
    projectPath = await fs.realpath(expandHome(cleaned));
    storePath = await fs.realpath(path.join(projectPath, "ctx"));
  } catch {
    return { ...fallback, warnings: ["没有发现可读取的 ctx 项目文档；会话节点仍然保留。"] };
  }

  const candidates = ["overview.md", "progress/progress.md"];
  for (const directory of ["spec", "decisions"] as const) {
    try {
      const names = (await fs.readdir(path.join(storePath, directory)))
        .filter((name) => name.endsWith(".md") && name !== "README.md" && name !== "rejected.md")
        .sort()
        .slice(0, 32);
      candidates.push(...names.map((name) => `${directory}/${name}`));
    } catch {
      // A missing optional ctx collection is not an error.
    }
  }

  const documents: ProjectContextDocument[] = [];
  const warnings: string[] = [];
  let totalBytes = 0;
  for (const relativePath of candidates.slice(0, 64)) {
    try {
      const candidate = path.join(storePath, relativePath);
      const realPath = await fs.realpath(candidate);
      if (realPath !== storePath && !realPath.startsWith(`${storePath}${path.sep}`)) {
        warnings.push(`${relativePath} 指向项目文档目录之外，已忽略。`);
        continue;
      }
      const stat = await fs.stat(realPath);
      if (!stat.isFile()) continue;
      const raw = await fs.readFile(realPath, "utf8");
      const content = raw.slice(0, 96_000);
      totalBytes += Buffer.byteLength(content);
      if (totalBytes > 640_000) {
        warnings.push("项目文档超过本次只读预览上限，其余文件未载入。 ");
        break;
      }
      documents.push({
        id: relativePath,
        kind: relativePath === "overview.md" ? "overview" : relativePath.startsWith("progress/") ? "progress" : relativePath.startsWith("spec/") ? "spec" : "decision",
        label: markdownTitle(content) || path.basename(relativePath, ".md").replace(/^\d+[-_]?/, "").replace(/[-_]+/g, " "),
        path: realPath,
        relativePath,
        content,
        updatedAt: stat.mtime.toISOString()
      });
    } catch {
      // Current ctx pointers are optional and may be absent during migration.
    }
  }

  if (documents.length === 0) warnings.push("ctx 目录存在，但没有发现当前 overview、progress、spec 或 decisions 文档。 ");
  return { projectPath, storePath, documents, warnings };
}

async function loadSessionTranscript(request: SessionTranscriptRequest): Promise<SessionTranscriptState> {
  const current = await ensureLoaded();
  const target = authorizeSessionTranscriptRequest(
    request,
    current.workSessionSnapshot.sessions,
    notebook,
    requireTraceinkAssetRepository().snapshot()
  );
  let source: { content: string; truncated: boolean };
  try {
    source = await readBoundedTranscriptSource(target.readPath, {
      origin: target.origin,
      ...(target.transcriptCapture
        ? { transcriptCapture: target.transcriptCapture }
        : target.evidenceUpdatedAt ? { expectedModifiedAt: target.evidenceUpdatedAt } : {})
    });
  } catch (error) {
    if (isMissingFileError(error)) {
      if (target.origin === "traceink-asset") {
        throw new Error("Traceink 证据所引用的会话原文已不存在；资产引用仍保留，但当前无法重开原文。");
      }
      if (target.origin === "sealed-package") {
        throw new Error("会话原文文件已不存在；封存证据仍保留引用，但当前无法读取原文。");
      }
      throw new Error("当前只读快照中的会话原文文件已不存在，请刷新会话。");
    }
    throw new Error(`会话原文当前无法读取：${errorMessage(error)}`);
  }
  return parseSessionTranscript({
    content: source.content,
    platform: target.platform,
    sessionId: target.id,
    title: target.title,
    path: target.path,
    truncated: source.truncated,
    userAuthorKind: sessionUserAuthorKind(
      current.workSessionSnapshot.sessions.find((session) =>
        session.id === target.id && session.platform === target.platform && session.path === target.path
      ) ?? {}
    )
  });
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}

async function loadDailySessionActivity(logicalDate: string, sessions: CockpitData["workSessionSnapshot"]["sessions"]) {
  return sessionActivityCache.load(logicalDate, sessions);
}

function markdownTitle(content: string): string | undefined {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim();
}
