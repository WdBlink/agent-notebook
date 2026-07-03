import type { CockpitSettings, TaskCategory, TaskPriority } from "./types";

export const PLUGIN_ID = "daily-cockpit";
export const VIEW_TYPE_DAILY_COCKPIT = "daily-cockpit-view";

export const COMMAND_OPEN_COCKPIT = "open-daily-cockpit";
export const COMMAND_QUICK_CAPTURE = "quick-capture";
export const COMMAND_EXPORT_DAILY_NOTE = "export-daily-note";

export const DEFAULT_SETTINGS: CockpitSettings = {
  dailyNoteFolder: "Daily Cockpit",
  llmEndpoint: "http://127.0.0.1:11434/v1/chat/completions",
  llmModel: "qwen2.5:7b",
  llmApiKey: ""
};

export const TASK_CATEGORIES: TaskCategory[] = ["research", "build", "write", "analysis", "admin", "other"];
export const TASK_PRIORITIES: TaskPriority[] = ["P0", "P1", "P2"];

export const CATEGORY_LABELS: Record<TaskCategory, string> = {
  research: "调研",
  build: "实现",
  write: "写作",
  analysis: "分析",
  admin: "事务",
  other: "其他"
};

export const ERROR_MESSAGES = {
  emptyIntent: "先说一下你想推进什么，我再拆成待办。",
  noTasks: "模型没有拆出可用待办。可以把目标说得更具体一点再试。",
  taskNotFound: "没有找到这条待办，它可能已经被重新拆解替换了。",
  llmFailed: "本地模型没有响应。请检查模型服务、endpoint 和 model 设置。",
  llmParseFailed: "模型返回的内容不是可解析的 JSON 待办列表。",
  exportFailed: "导出失败，请检查目标文件夹权限后重试。",
  saveFailed: "保存失败，请稍后重试，当前界面内容仍保留。"
} as const;
