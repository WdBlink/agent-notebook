export type TaskPriority = "P0" | "P1" | "P2";

export type TaskCategory = "research" | "build" | "write" | "analysis" | "admin" | "other";

export type SessionSummaryMode = "native" | "metadata";

export interface CockpitSettings {
  dailyNoteFolder: string;
  llmEndpoint: string;
  llmModel: string;
  llmApiKey?: string;
  sessionScanRoots: string[];
  sessionSummaryMode: SessionSummaryMode;
  codexCliPath: string;
  claudeCliPath: string;
}

export interface IntentInput {
  text: string;
  source?: string;
}

export interface DecomposedTask {
  id: string;
  title: string;
  detail: string;
  category: TaskCategory;
  priority: TaskPriority;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IntentPlan {
  id: string;
  intent: string;
  targetDate: string;
  createdAt: string;
  updatedAt: string;
  tasks: DecomposedTask[];
  model?: string;
  source?: string;
}

export type AgentPlatform = "codex" | "claude" | "minimax" | "other";

export type AgentSessionStatus = "active" | "blocked" | "completed" | "unknown";

export interface AgentWorkSession {
  id: string;
  platform: AgentPlatform;
  title: string;
  summary: string;
  path: string;
  updatedAt: string;
  startedAt?: string;
  projectPath?: string;
  repositoryPath?: string;
  worktreePath?: string;
  branch?: string;
  resumeHint?: string;
  resumable?: boolean;
  summarySource?: "codex" | "claude" | "metadata";
  artifacts: string[];
  status: AgentSessionStatus;
}

export interface AgentWorkSnapshot {
  date: string;
  generatedAt: string;
  sessions: AgentWorkSession[];
  sources: string[];
  warnings: string[];
}

export interface CockpitData {
  schemaVersion: 3;
  settings: CockpitSettings;
  plans: IntentPlan[];
  workSessionSnapshot: AgentWorkSnapshot;
  activePlanId?: string;
  lastOpenedAt?: string;
  lastExportPath?: string;
}

export interface CockpitError {
  code:
    | "EMPTY_INTENT"
    | "NO_TASKS"
    | "TASK_NOT_FOUND"
    | "LLM_FAILED"
    | "LLM_PARSE_FAILED"
    | "EXPORT_FAILED"
    | "SESSION_SCAN_FAILED"
    | "SAVE_FAILED";
  message: string;
}

export type CockpitResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: CockpitError;
    };

export interface ModelTask {
  title: string;
  detail: string;
  category?: string;
  priority?: string;
}

export interface ModelDecomposition {
  tasks: ModelTask[];
  model?: string;
}

export interface RendererActions {
  decompose(input: IntentInput): Promise<CockpitResult<CockpitData>>;
  toggleTaskCompletion(taskId: string, completed: boolean): Promise<CockpitResult<CockpitData>>;
  refreshWorkSessions(): Promise<CockpitResult<CockpitData>>;
  copyResumeCommand(command: string): Promise<boolean>;
  openLocalPath(path: string, reveal?: boolean): Promise<boolean>;
  exportDailyNote(): Promise<CockpitResult<{ path: string }>>;
  clearError(): void;
}

export interface RendererState {
  data: CockpitData;
  processing: boolean;
  refreshingSessions?: boolean;
  error?: CockpitError;
  exportPath?: string;
}

export interface RenderController {
  update(nextState: RendererState): void;
  destroy(): void;
}
