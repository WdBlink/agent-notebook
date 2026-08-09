import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type OpenDialogOptions } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCliSessionSummarizer } from "../../src/agent-summary";
import { compileDailyWorklineReview } from "../../src/workline-review";
import { loadAgentWorkSnapshot, mergeSessionSummaries, type RuntimeFileStat, type RuntimeFileSystem } from "../../src/agent-sessions";
import { DEFAULT_SESSION_SCAN_ROOTS } from "../../src/constants";
import { createEmptyData, localDateString, normalizeData, setWorkSessionSnapshot } from "../../src/state";
import type { CockpitData, SessionProvider } from "../../src/types";
import type { DailyDraftInput, DesktopNotebookState, DesktopSettingsPatch, DesktopState, DesktopSummaryJob, NotebookNote, NotebookNoteInput, ProjectContextDocument, ProjectContextState, SessionTranscriptRequest, SessionTranscriptState } from "./api";
import { desktopCliRunner } from "./cli-runner";
import {
  composeDailyPage,
  createEmptyNotebookDocument,
  createNotebookNote,
  deleteNotebookNote,
  findNotebookNote,
  markNotebookDelivery,
  normalizeNotebookDocument,
  notebookStateForDate,
  saveDailyDraft,
  sealDailyPage,
  setKnowledgeRoot,
  updateNotebookNote,
  type NotebookDocument
} from "./notebook-store";
import {
  createEmptySessionSummaryCache,
  normalizeSessionSummaryCache,
  readCachedSessionSummaries,
  writeCachedSessionSummaries,
  type SessionSummaryCacheDocument,
  type SummaryModelMap
} from "./session-summary-cache";
import { parseSessionTranscript } from "./transcript-reader";
import { projectSessionActivityLane, summarizeDailySessionActivity, type SessionActivityLane } from "../../src/session-activity";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.AGENT_WHITEBOARD_DEV === "1";
const storeFileName = "cockpit-data.json";
const summaryCacheFileName = "session-summary-cache-v1.json";
const notebookFileName = "notebook-v1.json";
const summaryModels: SummaryModelMap = {
  codex: process.env.WORK_CONTINUITY_CODEX_SUMMARY_MODEL?.trim() || "gpt-5.3-codex-spark",
  claude: process.env.WORK_CONTINUITY_CLAUDE_SUMMARY_MODEL?.trim() || "fable"
};

let mainWindow: BrowserWindow | undefined;
let data: CockpitData | undefined;
let notebook = createEmptyNotebookDocument();
let activeDate = localDateString();
let summaryCache = createEmptySessionSummaryCache();
let summaryRunId = 0;
let summaryJob: DesktopSummaryJob = { status: "idle", total: 0, completed: 0, models: summaryModels };
const sessionActivityCache = new Map<string, SessionActivityLane>();

const runtimeFs: RuntimeFileSystem = {
  async stat(filePath: string): Promise<RuntimeFileStat> {
    return fs.stat(filePath);
  },
  async readdir(filePath: string): Promise<string[]> {
    return fs.readdir(filePath);
  },
  async readFile(filePath: string, encoding: "utf8"): Promise<string> {
    return fs.readFile(filePath, encoding);
  }
};

app.setName("Work Continuity");

void app.whenReady().then(async () => {
  [data, notebook] = await Promise.all([loadStore(), loadNotebook()]);
  summaryCache = await loadSummaryCache();
  await refreshSnapshot(activeDate);
  if (process.platform === "darwin") app.dock?.setIcon(path.join(__dirname, "app-icon.png"));
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
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
  data = normalizeData({
    ...current,
    settings: {
      ...current.settings,
      enabledSessionProviders,
      sessionScanRoots
    }
  });
  await persistStore(data);
  if (patch.knowledgeRoot !== undefined) {
    notebook = setKnowledgeRoot(notebook, patch.knowledgeRoot);
    await persistNotebook();
  }
  await refreshSnapshot(activeDate);
  return buildState();
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
  const outputDirectory = path.join(app.getPath("documents"), "Work Continuity Cards");
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
  const targetDirectory = path.join(rawRoot, "work-continuity", note.logicalDate);
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

ipcMain.handle("desktop:compose-daily-page", async (_event, date: string) => {
  const logicalDate = cleanDate(date, activeDate);
  const current = await ensureLoaded();
  const reviewPackage = await compileDailyWorklineReview(
    current.settings,
    logicalDate,
    current.workSessionSnapshot.sessions,
    { runner: desktopCliRunner, evidenceCutoff: current.workSessionSnapshot.generatedAt }
  );
  return mutateNotebook(logicalDate, (document) => composeDailyPage(
    document,
    logicalDate,
    current.workSessionSnapshot.sessions,
    new Date(reviewPackage.generatedAt),
    reviewPackage
  ));
});

ipcMain.handle("desktop:save-daily-draft", async (_event, date: string, input: DailyDraftInput) => {
  const logicalDate = cleanDate(date, activeDate);
  const current = await ensureLoaded();
  const candidates = notebookStateForDate(notebook, logicalDate, current.workSessionSnapshot.sessions).continuationCandidates;
  return mutateNotebook(logicalDate, (document) => saveDailyDraft(document, logicalDate, input, candidates));
});

ipcMain.handle("desktop:seal-daily-page", async (_event, date: string, input: DailyDraftInput) => {
  const logicalDate = cleanDate(date, activeDate);
  const current = await ensureLoaded();
  const candidates = notebookStateForDate(notebook, logicalDate, current.workSessionSnapshot.sessions).continuationCandidates;
  return mutateNotebook(logicalDate, (document) => sealDailyPage(document, logicalDate, input, candidates));
});

ipcMain.handle("desktop:get-project-context", async (_event, projectPath: string) => {
  return loadProjectContext(projectPath);
});

ipcMain.handle("desktop:get-session-transcript", async (_event, request: SessionTranscriptRequest) => {
  return loadSessionTranscript(request);
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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 720,
    minHeight: 620,
    title: "Work Continuity",
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
  try {
    return normalizeData(JSON.parse(await fs.readFile(storePath(), "utf8")) as unknown);
  } catch {
    return createEmptyData();
  }
}

async function persistStore(next: CockpitData): Promise<void> {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(storePath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
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
  try {
    return normalizeNotebookDocument(JSON.parse(await fs.readFile(notebookPath(), "utf8")) as unknown);
  } catch {
    return createEmptyNotebookDocument();
  }
}

async function persistNotebook(): Promise<void> {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  const temporary = `${notebookPath()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(notebook, null, 2)}\n`, "utf8");
  await fs.rename(temporary, notebookPath());
}

let notebookWriteQueue: Promise<void> = Promise.resolve();

async function mutateNotebook(logicalDate: string, operation: (current: NotebookDocument) => NotebookDocument): Promise<DesktopNotebookState> {
  let result: DesktopNotebookState | undefined;
  const write = notebookWriteQueue.then(async () => {
    notebook = normalizeNotebookDocument(operation(notebook));
    await persistNotebook();
    result = notebookView(logicalDate);
  });
  notebookWriteQueue = write.catch(() => undefined);
  await write;
  if (!result) throw new Error("手帐数据没有完成保存。");
  return result;
}

function notebookView(logicalDate: string): DesktopNotebookState {
  return notebookStateForDate(notebook, logicalDate, data?.workSessionSnapshot.sessions ?? []);
}

async function loadSummaryCache(): Promise<SessionSummaryCacheDocument> {
  try {
    return normalizeSessionSummaryCache(JSON.parse(await fs.readFile(summaryCachePath(), "utf8")) as unknown);
  } catch {
    return createEmptySessionSummaryCache();
  }
}

async function persistSummaryCache(): Promise<void> {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(summaryCachePath(), `${JSON.stringify(summaryCache, null, 2)}\n`, "utf8");
}

async function refreshSnapshot(date: string): Promise<void> {
  const runId = ++summaryRunId;
  const current = await ensureLoaded();
  const snapshot = await loadAgentWorkSnapshot(current.settings, {
    date,
    fs: runtimeFs,
    homeDir: os.homedir(),
    maxFiles: 180,
    maxSessions: 48,
    maxDepth: 5,
    maxEntries: 2400
  });
  const cached = readCachedSessionSummaries(summaryCache, date, snapshot.sessions, summaryModels);
  const cachedSnapshot = { ...snapshot, sessions: mergeSessionSummaries(snapshot.sessions, cached.summaries) };
  data = normalizeData(setWorkSessionSnapshot(current, cachedSnapshot));
  await persistStore(data);
  scheduleSessionSummaries(runId, date, snapshot.sessions, cached.misses, current.settings);
}

function scheduleSessionSummaries(
  runId: number,
  date: string,
  scannedSessions: CockpitData["workSessionSnapshot"]["sessions"],
  misses: CockpitData["workSessionSnapshot"]["sessions"],
  settings: CockpitData["settings"]
): void {
  const disabled = process.env.WORK_CONTINUITY_DISABLE_SUMMARIES === "1" || settings.sessionSummaryMode !== "native";
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
  const summarizer = createCliSessionSummarizer({
    runner: desktopCliRunner,
    homeDir: os.homedir(),
    modelByPlatform: summaryModels,
    batchSize: 1,
    concurrency: 2,
    onBatch: async (batch) => {
      if (runId !== summaryRunId || date !== activeDate) return;
      processed += 1;
      completed += batch.summaries.length;
      await applySummaryBatch(date, scannedSessions, batch);
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
  date: string,
  scannedSessions: CockpitData["workSessionSnapshot"]["sessions"],
  batch: Awaited<ReturnType<ReturnType<typeof createCliSessionSummarizer>>>
): Promise<void> {
  summaryCache = writeCachedSessionSummaries(summaryCache, date, scannedSessions, batch.summaries, summaryModels);
  const current = await ensureLoaded();
  if (current.workSessionSnapshot.date !== date) return;
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
  mainWindow.webContents.send("desktop:state-changed", await buildState());
}

async function buildState(): Promise<DesktopState> {
  const current = await ensureLoaded();
  const [providerActivityDates, activity] = await Promise.all([
    findActivityDates(current.settings.sessionScanRoots, current.settings.enabledSessionProviders),
    loadDailySessionActivity(current.workSessionSnapshot.sessions)
  ]);
  const activityDates = Array.from(new Set([
    ...providerActivityDates,
    ...notebook.notes.map((note) => note.logicalDate),
    ...Object.keys(notebook.pages)
  ])).sort((a, b) => b.localeCompare(a)).slice(0, 70);
  return {
    data: current,
    activeDate,
    activityDates,
    appVersion: app.getVersion(),
    userDataPath: app.getPath("userData"),
    notebook: notebookStateForDate(notebook, activeDate, current.workSessionSnapshot.sessions),
    activity,
    summaryJob
  };
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
  const lower = value.toLowerCase();
  if (lower.includes("codex")) return "codex";
  if (lower.includes("claude")) return "claude";
  return undefined;
}

function normalizeProviders(value: unknown, fallback: SessionProvider[]): SessionProvider[] {
  if (!Array.isArray(value)) return fallback;
  const supported = new Set<SessionProvider>(["codex", "claude"]);
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
    "source: work-continuity-note",
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
    "> 原始便签由 Work Continuity 写入；后续分类与吸收由目标协议管理。",
    ""
  ];
  return metadata.join("\n");
}

function renderNoteCard(note: NotebookNote): string {
  const lines = wrapCardText(note.body, 25, 12);
  const body = lines.map((line, index) => `<text x="124" y="${286 + index * 54}" class="body">${escapeXml(line)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500" viewBox="0 0 1200 1500"><defs><filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="28" stdDeviation="28" flood-color="#3b2619" flood-opacity=".18"/></filter><pattern id="paper" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M0 11.5h12" stroke="#e8ddca" stroke-width="1"/></pattern></defs><rect width="1200" height="1500" fill="#d9c4a4"/><rect x="70" y="62" width="1060" height="1376" rx="26" fill="#fffaf0" filter="url(#shadow)"/><rect x="70" y="62" width="1060" height="1376" rx="26" fill="url(#paper)"/><rect x="70" y="62" width="18" height="1376" rx="9" fill="#b84f32"/><text x="124" y="142" class="meta">WORK CONTINUITY · ${escapeXml(note.logicalDate)}</text><text x="124" y="226" class="title">${escapeXml(note.title)}</text>${body}<line x1="124" y1="1320" x2="1074" y2="1320" stroke="#d7c9b4"/><text x="124" y="1370" class="foot">${escapeXml(note.sourceLabel)} · ${escapeXml(formatCardTime(note.createdAt))}</text><style>.meta,.foot{font:600 22px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:3px;fill:#8d7965}.title{font:600 50px Georgia,'Songti SC',serif;fill:#2a2723}.body{font:400 34px Georgia,'Songti SC',serif;fill:#514a42}</style></svg>`;
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

const MAX_TRANSCRIPT_BYTES = 24 * 1024 * 1024;
const TRANSCRIPT_HEAD_BYTES = 8 * 1024 * 1024;

async function loadSessionTranscript(request: SessionTranscriptRequest): Promise<SessionTranscriptState> {
  const current = await ensureLoaded();
  const target = current.workSessionSnapshot.sessions.find((session) =>
    session.id === request?.id && session.platform === request?.platform && session.path === request?.path
  );
  if (!target) throw new Error("这条会话不在当前只读快照中，拒绝读取未经验证的路径。");
  const source = await readBoundedTranscript(target.path);
  return parseSessionTranscript({
    content: source.content,
    platform: target.platform,
    sessionId: target.id,
    title: target.title,
    path: target.path,
    truncated: source.truncated
  });
}

async function loadDailySessionActivity(sessions: CockpitData["workSessionSnapshot"]["sessions"]) {
  const activeKeys = new Set(sessions.map(sessionActivityCacheKey));
  const lanes = await Promise.all(sessions.map(async (session): Promise<SessionActivityLane> => {
    const key = sessionActivityCacheKey(session);
    const cached = sessionActivityCache.get(key);
    if (cached) return { ...cached, operationalState: session.status === "active" ? "running" : "not-running" };
    let transcript: SessionTranscriptState;
    try {
      const source = await readBoundedTranscript(session.path);
      transcript = parseSessionTranscript({
        content: source.content,
        platform: session.platform,
        sessionId: session.id,
        title: session.title,
        path: session.path,
        truncated: source.truncated
      });
    } catch (error) {
      transcript = {
        sessionId: session.id,
        platform: session.platform,
        title: session.title,
        path: session.path,
        messages: [],
        omittedToolEvents: 0,
        truncated: true,
        warning: `无法读取活动依据：${errorMessage(error)}`
      };
    }
    const value = projectSessionActivityLane({ logicalDate: activeDate, source: { session, transcript } });
    sessionActivityCache.set(key, value);
    return value;
  }));
  for (const key of sessionActivityCache.keys()) {
    if (!activeKeys.has(key)) sessionActivityCache.delete(key);
  }
  return summarizeDailySessionActivity({ logicalDate: activeDate, lanes });
}

function sessionActivityCacheKey(session: CockpitData["workSessionSnapshot"]["sessions"][number]): string {
  return [activeDate, session.platform, session.id, session.path, session.updatedAt].map(encodeURIComponent).join("|");
}

async function readBoundedTranscript(filePath: string): Promise<{ content: string; truncated: boolean }> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error("会话记录不是可读取的普通文件。");
  if (stat.size <= MAX_TRANSCRIPT_BYTES) return { content: await fs.readFile(filePath, "utf8"), truncated: false };

  const handle = await fs.open(filePath, "r");
  try {
    const tailBytes = MAX_TRANSCRIPT_BYTES - TRANSCRIPT_HEAD_BYTES;
    const head = Buffer.alloc(TRANSCRIPT_HEAD_BYTES);
    const tail = Buffer.alloc(tailBytes);
    const headRead = await handle.read(head, 0, head.length, 0);
    const tailRead = await handle.read(tail, 0, tail.length, Math.max(0, stat.size - tailBytes));
    const headText = head.subarray(0, headRead.bytesRead).toString("utf8");
    const tailText = tail.subarray(0, tailRead.bytesRead).toString("utf8");
    const safeHead = headText.slice(0, Math.max(0, headText.lastIndexOf("\n")));
    const firstTailLine = tailText.indexOf("\n");
    const safeTail = firstTailLine >= 0 ? tailText.slice(firstTailLine + 1) : tailText;
    return { content: `${safeHead}\n${safeTail}`, truncated: true };
  } finally {
    await handle.close();
  }
}

function markdownTitle(content: string): string | undefined {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim();
}
