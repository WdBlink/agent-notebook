import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi, DesktopSettingsPatch, DesktopState, ProjectContextState, SessionTranscriptRequest, SessionTranscriptState } from "./api";

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
