export type TaskPriority = "P0" | "P1" | "P2";

export type TaskCategory = "research" | "build" | "write" | "analysis" | "admin" | "other";

export interface CockpitSettings {
  dailyNoteFolder: string;
  llmEndpoint: string;
  llmModel: string;
  llmApiKey?: string;
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
  warmStart: string;
  selectedForHotStart: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IntentPlan {
  id: string;
  intent: string;
  createdAt: string;
  updatedAt: string;
  tasks: DecomposedTask[];
  model?: string;
  source?: string;
}

export interface CockpitData {
  schemaVersion: 2;
  settings: CockpitSettings;
  plans: IntentPlan[];
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
  warmStart?: string;
  selectedForHotStart?: boolean;
}

export interface ModelDecomposition {
  tasks: ModelTask[];
  model?: string;
}

export interface RendererActions {
  decompose(input: IntentInput): Promise<CockpitResult<CockpitData>>;
  toggleHotStart(taskId: string, selected: boolean): Promise<CockpitResult<CockpitData>>;
  exportDailyNote(): Promise<CockpitResult<{ path: string }>>;
  clearError(): void;
}

export interface RendererState {
  data: CockpitData;
  processing: boolean;
  error?: CockpitError;
  exportPath?: string;
}

export interface RenderController {
  update(nextState: RendererState): void;
  destroy(): void;
}
