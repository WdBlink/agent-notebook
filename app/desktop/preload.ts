import { contextBridge, ipcRenderer } from "electron";
import type { DailyDraftInput, DesktopApi, DesktopNotebookState, DesktopSettingsPatch, DesktopState, NotebookNote, NotebookNoteInput, ProjectContextState, SessionTranscriptRequest, SessionTranscriptState } from "./api";

const api: DesktopApi = {
  getState(date?: string): Promise<DesktopState> {
    return ipcRenderer.invoke("desktop:get-state", date) as Promise<DesktopState>;
  },
  refreshSessions(date?: string): Promise<DesktopState> {
    return ipcRenderer.invoke("desktop:refresh-sessions", date) as Promise<DesktopState>;
  },
  updateSettings(patch: DesktopSettingsPatch): Promise<DesktopState> {
    return ipcRenderer.invoke("desktop:update-settings", patch) as Promise<DesktopState>;
  },
  createNotebookNote(date: string, input: NotebookNoteInput): Promise<DesktopNotebookState> {
    return ipcRenderer.invoke("desktop:create-notebook-note", date, input) as Promise<DesktopNotebookState>;
  },
  updateNotebookNote(noteId: string, patch: Partial<Pick<NotebookNote, "title" | "body" | "favorite">>): Promise<DesktopNotebookState> {
    return ipcRenderer.invoke("desktop:update-notebook-note", noteId, patch) as Promise<DesktopNotebookState>;
  },
  deleteNotebookNote(noteId: string): Promise<DesktopNotebookState> {
    return ipcRenderer.invoke("desktop:delete-notebook-note", noteId) as Promise<DesktopNotebookState>;
  },
  exportNotebookNoteCard(noteId: string): Promise<{ notebook: DesktopNotebookState; path: string }> {
    return ipcRenderer.invoke("desktop:export-notebook-note-card", noteId) as Promise<{ notebook: DesktopNotebookState; path: string }>;
  },
  routeNotebookNoteToWiki(noteId: string): Promise<{ notebook: DesktopNotebookState; path: string }> {
    return ipcRenderer.invoke("desktop:route-notebook-note-to-wiki", noteId) as Promise<{ notebook: DesktopNotebookState; path: string }>;
  },
  routeNotebookNoteToProject(noteId: string, projectPath: string): Promise<{ notebook: DesktopNotebookState; path: string }> {
    return ipcRenderer.invoke("desktop:route-notebook-note-to-project", noteId, projectPath) as Promise<{ notebook: DesktopNotebookState; path: string }>;
  },
  composeDailyPage(date: string): Promise<DesktopNotebookState> {
    return ipcRenderer.invoke("desktop:compose-daily-page", date) as Promise<DesktopNotebookState>;
  },
  saveDailyDraft(date: string, input: DailyDraftInput): Promise<DesktopNotebookState> {
    return ipcRenderer.invoke("desktop:save-daily-draft", date, input) as Promise<DesktopNotebookState>;
  },
  sealDailyPage(date: string, input: DailyDraftInput): Promise<DesktopNotebookState> {
    return ipcRenderer.invoke("desktop:seal-daily-page", date, input) as Promise<DesktopNotebookState>;
  },
  getProjectContext(projectPath: string): Promise<ProjectContextState> {
    return ipcRenderer.invoke("desktop:get-project-context", projectPath) as Promise<ProjectContextState>;
  },
  getSessionTranscript(request: SessionTranscriptRequest): Promise<SessionTranscriptState> {
    return ipcRenderer.invoke("desktop:get-session-transcript", request) as Promise<SessionTranscriptState>;
  },
  chooseDirectory(): Promise<string | null> {
    return ipcRenderer.invoke("desktop:choose-directory") as Promise<string | null>;
  },
  copyText(text: string): Promise<boolean> {
    return ipcRenderer.invoke("desktop:copy-text", text) as Promise<boolean>;
  },
  openPath(path: string, reveal = false): Promise<boolean> {
    return ipcRenderer.invoke("desktop:open-path", path, reveal) as Promise<boolean>;
  },
  subscribeState(listener: (state: DesktopState) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopState): void => listener(state);
    ipcRenderer.on("desktop:state-changed", handler);
    return () => ipcRenderer.removeListener("desktop:state-changed", handler);
  }
};

contextBridge.exposeInMainWorld("agentWhiteboard", api);
