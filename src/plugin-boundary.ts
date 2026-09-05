import {
  COMMAND_EXPORT_DAILY_NOTE,
  COMMAND_OPEN_AGENT_WHITEBOARD,
  COMMAND_OPEN_COCKPIT,
  COMMAND_QUICK_CAPTURE,
  COMMAND_REFRESH_WORK_SESSIONS,
  VIEW_TYPE_AGENT_WHITEBOARD,
  VIEW_TYPE_AGENT_NOTEBOOK
} from "./constants";

export interface PluginSurfaceHost<TLeaf, TView, TSettingTab> {
  registerView(type: string, creator: (leaf: TLeaf) => TView): void;
  addSettingTab(tab: TSettingTab): void;
  addRibbonIcon(icon: string, title: string, callback: () => void): void;
  addCommand(command: { id: string; name: string; callback: () => void }): void;
}

export interface PluginSurfaceActions<TLeaf, TView, TSettingTab> {
  createDailyView(leaf: TLeaf): TView;
  createWhiteboardView(leaf: TLeaf): TView;
  settingTab: TSettingTab;
  openDaily(): void;
  openWhiteboard(): void;
  quickCapture(): void;
  exportDaily(): void;
  refreshSessions(): void;
}

export function registerPluginSurface<TLeaf, TView, TSettingTab>(
  host: PluginSurfaceHost<TLeaf, TView, TSettingTab>,
  actions: PluginSurfaceActions<TLeaf, TView, TSettingTab>
): void {
  host.registerView(VIEW_TYPE_AGENT_NOTEBOOK, actions.createDailyView);
  host.registerView(VIEW_TYPE_AGENT_WHITEBOARD, actions.createWhiteboardView);
  host.addSettingTab(actions.settingTab);
  host.addRibbonIcon("list-checks", "打开 Agent Notebook", actions.openDaily);
  host.addRibbonIcon("layout-dashboard", "打开 Agent Whiteboard", actions.openWhiteboard);
  for (const command of [
    { id: COMMAND_OPEN_COCKPIT, name: "打开 Agent Notebook", callback: actions.openDaily },
    { id: COMMAND_OPEN_AGENT_WHITEBOARD, name: "打开 Agent Whiteboard", callback: actions.openWhiteboard },
    { id: COMMAND_QUICK_CAPTURE, name: "快速拆解待办", callback: actions.quickCapture },
    { id: COMMAND_EXPORT_DAILY_NOTE, name: "导出每日简报", callback: actions.exportDaily },
    { id: COMMAND_REFRESH_WORK_SESSIONS, name: "刷新昨日工作会话", callback: actions.refreshSessions }
  ]) {
    host.addCommand(command);
  }
}
