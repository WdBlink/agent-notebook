import { DEFAULT_SESSION_SCAN_ROOTS, DEFAULT_SETTINGS, ERROR_MESSAGES, TASK_CATEGORIES, TASK_PRIORITIES } from "./constants";
import type {
  AgentPlatform,
  AgentSessionStatus,
  AgentWorkSession,
  AgentWorkSnapshot,
  CockpitData,
  CockpitError,
  CockpitResult,
  CockpitSettings,
  DecomposedTask,
  IntentPlan,
  ModelTask,
  TaskCategory,
  TaskPriority
} from "./types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(prefix = "item"): string {
  const random = Math.random().toString(36).slice(2, 9);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function createEmptyData(settings: Partial<CockpitSettings> = {}): CockpitData {
  return {
    schemaVersion: 2,
    settings: normalizeSettings(settings),
    workSessionSnapshot: createEmptyWorkSessionSnapshot(),
    plans: []
  };
}

export function normalizeData(input: unknown): CockpitData {
  if (!input || typeof input !== "object") {
    return createEmptyData();
  }

  const source = input as Partial<CockpitData>;
  const settings = normalizeSettings(source.settings);
  const plans = Array.isArray(source.plans)
    ? source.plans.filter(isPartialPlan).map(normalizePlan)
    : [];
  const activePlanId =
    typeof source.activePlanId === "string" && plans.some((plan) => plan.id === source.activePlanId)
      ? source.activePlanId
      : plans[0]?.id;

  return {
    schemaVersion: 2,
    settings,
    plans,
    workSessionSnapshot: normalizeWorkSessionSnapshot(source.workSessionSnapshot),
    ...(activePlanId ? { activePlanId } : {}),
    ...(typeof source.lastOpenedAt === "string" ? { lastOpenedAt: source.lastOpenedAt } : {}),
    ...(typeof source.lastExportPath === "string" ? { lastExportPath: source.lastExportPath } : {})
  };
}

export function createSeedData(): CockpitData {
  const timestamp = "2026-07-03T08:00:00.000Z";
  const plan: IntentPlan = {
    id: "seed-plan",
    intent: "明天想把每日看板做成一个工具：我说一段想法，它调用本地模型拆成待办，我再选择哪些任务热启动。",
    createdAt: timestamp,
    updatedAt: timestamp,
    model: DEFAULT_SETTINGS.llmModel,
    source: "LLM-Wiki/raw/notes/2026-07-02 每日看板的idea.md",
    tasks: [
      {
        id: "seed-task-a",
        title: "确认一句话输入的真实语义",
        detail: "从原始 note 中提炼产品主线，避免再次做成通用任务管理器。",
        category: "analysis",
        priority: "P0",
        warmStart: "读取原始想法，列出输入、模型拆解、热启动选择三段流程。",
        selectedForHotStart: true,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      {
        id: "seed-task-b",
        title: "设计本地模型拆解 prompt",
        detail: "让模型返回 JSON 待办，每条包含标题、细节、分类、优先级和热启动建议。",
        category: "build",
        priority: "P0",
        warmStart: "准备一个 OpenAI-compatible 本地模型请求和 JSON 解析器。",
        selectedForHotStart: true,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      {
        id: "seed-task-c",
        title: "保留热启动选择而不是自动开工",
        detail: "用户必须显式勾选哪些待办进入热启动，工具不替用户默认推进。",
        category: "build",
        priority: "P1",
        warmStart: "给每条候选待办加 checkbox，并导出被选中的热启动清单。",
        selectedForHotStart: false,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ]
  };

  return {
    ...createEmptyData(),
    workSessionSnapshot: createSeedWorkSessionSnapshot(),
    plans: [plan],
    activePlanId: plan.id
  };
}

export function activePlan(data: CockpitData): IntentPlan | undefined {
  return data.plans.find((plan) => plan.id === data.activePlanId) ?? data.plans[0];
}

export function selectedHotStartTasks(data: CockpitData): DecomposedTask[] {
  const plan = activePlan(data);
  return plan ? plan.tasks.filter((task) => task.selectedForHotStart) : [];
}

export function addPlanFromModelTasks(
  data: CockpitData,
  intent: string,
  tasks: ModelTask[],
  model?: string,
  source?: string,
  timestamp = nowIso()
): CockpitResult<CockpitData> {
  const text = intent.trim();
  if (!text) {
    return failure("EMPTY_INTENT", ERROR_MESSAGES.emptyIntent);
  }

  const normalizedTasks = tasks
    .map((task, index) => normalizeModelTask(task, index, timestamp))
    .filter((task): task is DecomposedTask => task !== null);

  if (normalizedTasks.length === 0) {
    return failure("NO_TASKS", ERROR_MESSAGES.noTasks);
  }

  const plan: IntentPlan = {
    id: createId("plan"),
    intent: text,
    createdAt: timestamp,
    updatedAt: timestamp,
    tasks: normalizedTasks,
    ...(model ? { model } : {}),
    ...(source?.trim() ? { source: source.trim() } : {})
  };

  return success({
    ...data,
    plans: [plan, ...data.plans].slice(0, 20),
    activePlanId: plan.id
  });
}

export function toggleHotStartTask(
  data: CockpitData,
  taskId: string,
  selected: boolean,
  timestamp = nowIso()
): CockpitResult<CockpitData> {
  let found = false;
  const plans = data.plans.map((plan) => {
    let planChanged = false;
    const tasks = plan.tasks.map((task) => {
      if (task.id !== taskId) return task;
      found = true;
      planChanged = true;
      return {
        ...task,
        selectedForHotStart: selected,
        updatedAt: timestamp
      };
    });
    return planChanged ? { ...plan, tasks, updatedAt: timestamp } : plan;
  });

  if (!found) {
    return failure("TASK_NOT_FOUND", ERROR_MESSAGES.taskNotFound);
  }

  return success({
    ...data,
    plans
  });
}

export function touchOpened(data: CockpitData, timestamp = nowIso()): CockpitData {
  return {
    ...data,
    lastOpenedAt: timestamp
  };
}

export function setLastExportPath(data: CockpitData, path: string): CockpitData {
  return {
    ...data,
    lastExportPath: path
  };
}

export function setWorkSessionSnapshot(data: CockpitData, snapshot: AgentWorkSnapshot): CockpitData {
  return {
    ...data,
    workSessionSnapshot: normalizeWorkSessionSnapshot(snapshot)
  };
}

export function normalizeSettings(input: unknown): CockpitSettings {
  if (!input || typeof input !== "object") {
    return { ...DEFAULT_SETTINGS, sessionScanRoots: [...DEFAULT_SETTINGS.sessionScanRoots] };
  }

  const settings = input as Partial<CockpitSettings>;
  const storedRoots = cleanSessionScanRoots(settings.sessionScanRoots);
  const hasCurrentSessionSettings =
    settings.sessionSummaryMode === "native" ||
    settings.sessionSummaryMode === "metadata" ||
    typeof settings.codexCliPath === "string" ||
    typeof settings.claudeCliPath === "string";
  return {
    dailyNoteFolder: cleanFolder(settings.dailyNoteFolder),
    llmEndpoint: cleanEndpoint(settings.llmEndpoint),
    llmModel: cleanModel(settings.llmModel),
    llmApiKey: typeof settings.llmApiKey === "string" ? settings.llmApiKey.trim() : "",
    sessionScanRoots: hasCurrentSessionSettings
      ? storedRoots
      : Array.from(new Set([...storedRoots, ...DEFAULT_SESSION_SCAN_ROOTS])).slice(0, 12),
    sessionSummaryMode: settings.sessionSummaryMode === "metadata" ? "metadata" : "native",
    codexCliPath: cleanCommand(settings.codexCliPath, DEFAULT_SETTINGS.codexCliPath),
    claudeCliPath: cleanCommand(settings.claudeCliPath, DEFAULT_SETTINGS.claudeCliPath)
  };
}

export function createEmptyWorkSessionSnapshot(date = previousLocalDateString(), timestamp = nowIso()): AgentWorkSnapshot {
  return {
    date,
    generatedAt: timestamp,
    sessions: [],
    sources: [],
    warnings: []
  };
}

function normalizePlan(plan: IntentPlan): IntentPlan {
  return {
    id: plan.id,
    intent: plan.intent.trim(),
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    tasks: plan.tasks.map((task) => normalizeTask(task)).filter((task): task is DecomposedTask => task !== null),
    ...(plan.model ? { model: plan.model } : {}),
    ...(plan.source ? { source: plan.source } : {})
  };
}

function normalizeTask(task: DecomposedTask): DecomposedTask | null {
  if (!task.title.trim()) return null;
  return {
    id: task.id,
    title: task.title.trim(),
    detail: task.detail.trim(),
    category: normalizeCategory(task.category),
    priority: normalizePriority(task.priority),
    warmStart: task.warmStart.trim(),
    selectedForHotStart: Boolean(task.selectedForHotStart),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

function normalizeModelTask(task: ModelTask, index: number, timestamp: string): DecomposedTask | null {
  const title = typeof task.title === "string" ? task.title.trim() : "";
  const detail = typeof task.detail === "string" ? task.detail.trim() : "";
  if (!title && !detail) return null;

  return {
    id: createId(`task-${index + 1}`),
    title: title || detail.slice(0, 48) || "未命名待办",
    detail: detail || title,
    category: normalizeCategory(task.category),
    priority: normalizePriority(task.priority),
    warmStart: typeof task.warmStart === "string" && task.warmStart.trim() ? task.warmStart.trim() : detail || title,
    selectedForHotStart: Boolean(task.selectedForHotStart),
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function createSeedWorkSessionSnapshot(): AgentWorkSnapshot {
  return {
    date: "2026-07-02",
    generatedAt: "2026-07-03T08:00:00.000Z",
    sources: ["~/.codex/archived_sessions", "~/.claude/tasks"],
    warnings: [],
    sessions: [
      {
        id: "seed-codex-session",
        platform: "codex",
        title: "实现每日看板热启动原型",
        summary: "Codex 已经把一句话拆待办、热启动勾选、Markdown 导出和滚动容器串起来。",
        path: "~/.codex/archived_sessions/rollout-2026-07-02-seed.jsonl",
        updatedAt: "2026-07-02T22:20:00.000Z",
        projectPath: "~/Documents/new day board",
        resumeHint: "codex resume seed-codex-session",
        resumable: true,
        summarySource: "codex",
        artifacts: ["src/render.ts", "src/state.ts", "styles.css"],
        status: "completed"
      },
      {
        id: "seed-claude-task",
        platform: "claude",
        title: "补齐原始 idea 的产品语义",
        summary: "Claude task 记录了原始想法：先看昨日各平台 agent 做了什么，再决定今天哪些待办适合热启动。",
        path: "~/.claude/tasks/seed/1.json",
        updatedAt: "2026-07-02T19:10:00.000Z",
        resumeHint: "claude --resume seed-claude-task",
        resumable: true,
        summarySource: "claude",
        artifacts: ["LLM-Wiki/raw/notes/2026-07-02 每日看板的idea.md"],
        status: "completed"
      }
    ]
  };
}

function normalizeWorkSessionSnapshot(input: unknown): AgentWorkSnapshot {
  if (!input || typeof input !== "object") {
    return createEmptyWorkSessionSnapshot();
  }

  const source = input as Partial<AgentWorkSnapshot>;
  const sessions = Array.isArray(source.sessions)
    ? source.sessions.map((session) => normalizeWorkSession(session)).filter((session): session is AgentWorkSession => session !== null)
    : [];

  return {
    date: cleanText(source.date, previousLocalDateString()),
    generatedAt: cleanText(source.generatedAt, nowIso()),
    sessions: sessions.slice(0, 30),
    sources: cleanSessionScanRoots(source.sources),
    warnings: Array.isArray(source.warnings)
      ? source.warnings.map((warning) => cleanText(warning, "")).filter(Boolean).slice(0, 8)
      : []
  };
}

function normalizeWorkSession(session: unknown): AgentWorkSession | null {
  if (!session || typeof session !== "object") return null;
  const source = session as Partial<AgentWorkSession>;
  const title = cleanText(source.title, "");
  const summary = cleanText(source.summary, "");
  const path = cleanText(source.path, "");
  if (!title || !path) return null;

  const normalized: AgentWorkSession = {
    id: cleanText(source.id, fallbackSessionId(path)),
    platform: normalizePlatform(source.platform),
    title,
    summary: summary || title,
    path,
    updatedAt: cleanText(source.updatedAt, nowIso()),
    artifacts: Array.isArray(source.artifacts)
      ? source.artifacts.map((artifact) => cleanText(artifact, "")).filter(Boolean).slice(0, 12)
      : [],
    status: normalizeSessionStatus(source.status),
    resumable: source.resumable === true,
    summarySource: normalizeSummarySource(source.summarySource)
  };

  const startedAt = cleanText(source.startedAt, "");
  const projectPath = cleanText(source.projectPath, "");
  const repositoryPath = cleanText(source.repositoryPath, "");
  const worktreePath = cleanText(source.worktreePath, "");
  const branch = cleanText(source.branch, "");
  const resumeHint = cleanText(source.resumeHint, "");
  if (startedAt) normalized.startedAt = startedAt;
  if (projectPath) normalized.projectPath = projectPath;
  if (repositoryPath) normalized.repositoryPath = repositoryPath;
  if (worktreePath) normalized.worktreePath = worktreePath;
  if (branch) normalized.branch = branch;
  if (resumeHint) normalized.resumeHint = resumeHint;
  return normalized;
}

function isPartialPlan(plan: unknown): plan is IntentPlan {
  if (!plan || typeof plan !== "object") return false;
  const candidate = plan as Partial<IntentPlan>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.intent === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    Array.isArray(candidate.tasks)
  );
}

function normalizeCategory(value: unknown): TaskCategory {
  return typeof value === "string" && TASK_CATEGORIES.includes(value as TaskCategory) ? (value as TaskCategory) : "other";
}

function normalizePriority(value: unknown): TaskPriority {
  return typeof value === "string" && TASK_PRIORITIES.includes(value as TaskPriority) ? (value as TaskPriority) : "P1";
}

function cleanFolder(value: unknown): string {
  return typeof value === "string" && value.trim()
    ? value.trim().replace(/^\/+|\/+$/g, "")
    : DEFAULT_SETTINGS.dailyNoteFolder;
}

function cleanEndpoint(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_SETTINGS.llmEndpoint;
}

function cleanModel(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_SETTINGS.llmModel;
}

function cleanCommand(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() && !value.includes("\0") ? value.trim() : fallback;
}

function cleanSessionScanRoots(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n/)
      : DEFAULT_SESSION_SCAN_ROOTS;
  const roots = values.map((root) => cleanText(root, "")).filter(Boolean);
  return roots.length > 0 ? Array.from(new Set(roots)).slice(0, 12) : [...DEFAULT_SESSION_SCAN_ROOTS];
}

function cleanText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizePlatform(value: unknown): AgentPlatform {
  return value === "codex" || value === "claude" || value === "minimax" || value === "other" ? value : "other";
}

function normalizeSessionStatus(value: unknown): AgentSessionStatus {
  return value === "active" || value === "blocked" || value === "completed" || value === "unknown" ? value : "unknown";
}

function normalizeSummarySource(value: unknown): "codex" | "claude" | "metadata" {
  return value === "codex" || value === "claude" || value === "metadata" ? value : "metadata";
}

function fallbackSessionId(path: string): string {
  const tail = path.split(/[\\/]/).filter(Boolean).pop() ?? "session";
  return tail.replace(/\.[^.]+$/, "") || "session";
}

function previousLocalDateString(now = new Date()): string {
  const date = new Date(now);
  date.setDate(date.getDate() - 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function success<T>(data: T): CockpitResult<T> {
  return { ok: true, data };
}

function failure(code: CockpitError["code"], message: string): CockpitResult<never> {
  return { ok: false, error: { code, message } };
}
