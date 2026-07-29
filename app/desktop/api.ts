import type { AgentPlatform, CockpitData, SessionProvider } from "../../src/types";

export interface DesktopState {
  data: CockpitData;
  activeDate: string;
  activityDates: string[];
  appVersion: string;
  userDataPath: string;
  summaryJob?: DesktopSummaryJob;
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
