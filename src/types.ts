export type CockpitItemState = "inbox" | "hold" | "soon" | "today" | "now" | "done" | "archive";

export interface CockpitSettings {
  dailyNoteFolder: string;
  todayLimit: number;
}

export interface CockpitItem {
  id: string;
  title: string;
  body: string;
  state: CockpitItemState;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  source?: string;
  context?: string;
  tags?: string[];
}

export interface CockpitData {
  schemaVersion: 1;
  settings: CockpitSettings;
  items: CockpitItem[];
  lastOpenedAt?: string;
  lastExportPath?: string;
}

export interface CockpitError {
  code:
    | "EMPTY_CAPTURE"
    | "ITEM_NOT_FOUND"
    | "TODAY_LIMIT_REACHED"
    | "INVALID_STATE"
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

export interface CaptureInput {
  title?: string;
  body: string;
  context?: string;
  source?: string;
  tags?: string[];
}

export interface RendererActions {
  capture(input: CaptureInput): Promise<CockpitResult<CockpitData>>;
  move(id: string, state: CockpitItemState): Promise<CockpitResult<CockpitData>>;
  complete(id: string): Promise<CockpitResult<CockpitData>>;
  archive(id: string): Promise<CockpitResult<CockpitData>>;
  exportDailyNote(): Promise<CockpitResult<{ path: string }>>;
  clearError(): void;
}

export interface RendererState {
  data: CockpitData;
  activeSection: CockpitItemState | "export";
  loading: boolean;
  error?: CockpitError;
  exportPath?: string;
}

export interface RenderController {
  update(nextState: RendererState): void;
  destroy(): void;
}
