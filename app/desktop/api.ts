import type { AgentPlatform, CockpitData, SessionProvider } from "../../src/types";
import type { DailySessionActivity } from "../../src/session-activity";
import type { DailyReviewPackage } from "../../src/workline-review";
import type { TodayBoardPackageGeneration, TodayBoardProjection } from "../../src/today-board";

export type DailyReviewPreparationMode = "compile" | "refresh";

export interface DesktopState {
  data: CockpitData;
  activeDate: string;
  activityDates: string[];
  appVersion: string;
  userDataPath: string;
  notebook: DesktopNotebookState;
  activity: DailySessionActivity;
  summaryJob?: DesktopSummaryJob;
}

export type NotebookNoteKind = "thought" | "web" | "note";
export type NotebookDeliveryKind = "card" | "wiki" | "project";

export interface NotebookNoteDelivery {
  kind: NotebookDeliveryKind;
  deliveredAt: string;
  target: string;
  status: "delivered" | "queued";
}

export interface NotebookNote {
  id: string;
  logicalDate: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  body: string;
  kind: NotebookNoteKind;
  sourceLabel: string;
  favorite: boolean;
  deliveries: NotebookNoteDelivery[];
}

export interface DailySessionReference {
  id: string;
  platform: AgentPlatform;
  path: string;
  title: string;
}

export interface DailyWorkRecord {
  id: string;
  projectKey: string;
  projectName: string;
  title: string;
  summary: string;
  changed: string;
  uncertainty: string;
  occurredAt: string;
  sessions: DailySessionReference[];
}

export interface DailyContinuationBookmark {
  id: string;
  title: string;
  projectName: string;
  provider: AgentPlatform;
  sessionId: string;
  sessionPath: string;
  cwd?: string;
  resumeCommand?: string;
}

export interface DailyNotebookPage {
  schemaVersion: 1 | 2 | 3;
  logicalDate: string;
  status: "unformed" | "draft" | "sealed";
  createdAt?: string;
  updatedAt?: string;
  evidenceCutoff?: string;
  sealedAt?: string;
  workRecords: DailyWorkRecord[];
  reflection: string;
  reviewPackage?: DailyReviewPackage;
  packageGenerations?: TodayBoardPackageGeneration[];
  activePackageGenerationId?: string;
  lastCompilationError?: string;
  worklineReflections: DailyWorklineReflection[];
  bookmarks: DailyContinuationBookmark[];
}

export interface DailyWorklineReflection {
  worklineId: string;
  text: string;
  updatedAt: string;
}

export interface DesktopNotebookState {
  notes: NotebookNote[];
  page: DailyNotebookPage;
  todayBoard: TodayBoardProjection;
  previewRecords: DailyWorkRecord[];
  continuationCandidates: DailyContinuationBookmark[];
  knowledgeRoot: string;
  knowledgeRawPath: string;
  pendingPreviousDates: string[];
  latestSealedDate?: string;
}

export interface NotebookNoteInput {
  title?: string;
  body: string;
}

export interface DailyDraftInput {
  reflection: string;
  worklineReflections?: Array<Pick<DailyWorklineReflection, "worklineId" | "text">>;
  bookmarkIds: string[];
}

export interface DesktopSummaryJob {
  status: "idle" | "running" | "complete" | "unavailable";
  total: number;
  completed: number;
  models: { codex: string; claude: string };
  message?: string;
}

export interface DesktopSettingsPatch {
  enabledSessionProviders?: SessionProvider[];
  sessionScanRoots?: string[];
  knowledgeRoot?: string;
}

export interface ProjectContextDocument {
  id: string;
  kind: "overview" | "progress" | "spec" | "decision";
  label: string;
  path: string;
  relativePath: string;
  content: string;
  updatedAt: string;
}

export interface ProjectContextState {
  projectPath: string;
  storePath?: string;
  documents: ProjectContextDocument[];
  warnings: string[];
}

export interface SessionTranscriptRequest {
  id: string;
  platform: AgentPlatform;
  path: string;
  packageRef?: {
    logicalDate: string;
    generationId: string;
    evidenceId: string;
  };
}

export interface SessionTranscriptMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

export interface SessionTranscriptState {
  sessionId: string;
  platform: AgentPlatform;
  title: string;
  path: string;
  messages: SessionTranscriptMessage[];
  omittedToolEvents: number;
  truncated: boolean;
  warning?: string;
}

export interface DesktopApi {
  getState(date?: string): Promise<DesktopState>;
  refreshSessions(date?: string): Promise<DesktopState>;
  updateSettings(patch: DesktopSettingsPatch): Promise<DesktopState>;
  createNotebookNote(date: string, input: NotebookNoteInput): Promise<DesktopNotebookState>;
  updateNotebookNote(noteId: string, patch: Partial<Pick<NotebookNote, "title" | "body" | "favorite">>): Promise<DesktopNotebookState>;
  deleteNotebookNote(noteId: string): Promise<DesktopNotebookState>;
  exportNotebookNoteCard(noteId: string): Promise<{ notebook: DesktopNotebookState; path: string }>;
  routeNotebookNoteToWiki(noteId: string): Promise<{ notebook: DesktopNotebookState; path: string }>;
  routeNotebookNoteToProject(noteId: string, projectPath: string): Promise<{ notebook: DesktopNotebookState; path: string }>;
  prepareDailyReview(date: string, mode: DailyReviewPreparationMode): Promise<DesktopNotebookState>;
  composeDailyPage(date: string): Promise<DesktopNotebookState>;
  saveDailyDraft(date: string, input: DailyDraftInput): Promise<DesktopNotebookState>;
  sealDailyPage(date: string, input: DailyDraftInput): Promise<DesktopNotebookState>;
  getProjectContext(projectPath: string): Promise<ProjectContextState>;
  getSessionTranscript(request: SessionTranscriptRequest): Promise<SessionTranscriptState>;
  chooseDirectory(): Promise<string | null>;
  copyText(text: string): Promise<boolean>;
  openPath(path: string, reveal?: boolean): Promise<boolean>;
  subscribeState(listener: (state: DesktopState) => void): () => void;
}

declare global {
  interface Window {
    agentWhiteboard: DesktopApi;
  }
}
