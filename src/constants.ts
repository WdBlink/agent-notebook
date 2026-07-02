import type { CockpitItemState, CockpitSettings } from "./types";

export const PLUGIN_ID = "daily-cockpit";
export const VIEW_TYPE_DAILY_COCKPIT = "daily-cockpit-view";

export const COMMAND_OPEN_COCKPIT = "open-daily-cockpit";
export const COMMAND_QUICK_CAPTURE = "quick-capture";
export const COMMAND_EXPORT_DAILY_NOTE = "export-daily-note";

export const DEFAULT_SETTINGS: CockpitSettings = {
  dailyNoteFolder: "Daily Cockpit",
  todayLimit: 5
};

export const STATE_LABELS: Record<CockpitItemState, string> = {
  inbox: "灵感收纳箱",
  hold: "先替我记着",
  soon: "近期看看",
  today: "今天",
  now: "正在做",
  done: "已完成",
  archive: "归档"
};

export const STATE_ORDER: CockpitItemState[] = ["now", "today", "inbox", "soon", "hold", "done", "archive"];

export const NAV_ITEMS: Array<{ state: CockpitItemState | "export"; label: string; description: string }> = [
  { state: "today", label: "今天", description: "最多五件" },
  { state: "now", label: "正在做", description: "只选一件" },
  { state: "inbox", label: "灵感", description: "先接住" },
  { state: "soon", label: "近期", description: "稍后看" },
  { state: "hold", label: "保留", description: "不用管" },
  { state: "done", label: "已完成", description: "完成记录" },
  { state: "archive", label: "归档", description: "有记录" },
  { state: "export", label: "导出", description: "写入笔记" }
];

export const EMPTY_COPY: Record<CockpitItemState, { title: string; body: string }> = {
  now: {
    title: "现在不用同时做很多事",
    body: "选一件正在推进的事就够了。空着也可以。"
  },
  today: {
    title: "今天先少一点",
    body: "这里最好只有三到五件真正要守住的事。"
  },
  inbox: {
    title: "现在没有新的灵感需要你看",
    body: "想到什么再丢进来。收纳箱不是债务。"
  },
  soon: {
    title: "近期列表是缓冲区",
    body: "值得看，但不必现在打断自己。"
  },
  hold: {
    title: "我先帮你记着",
    body: "这些想法安全地放在这里，今天不用管。"
  },
  done: {
    title: "还没有完成记录",
    body: "做完一件小事也可以放进来，给明天的自己留线索。"
  },
  archive: {
    title: "归档是安静的记录",
    body: "不再推进的想法可以留痕，但不占用注意力。"
  }
};

export const ERROR_MESSAGES = {
  emptyCapture: "先写下一点内容，我再帮你收起来。",
  itemNotFound: "没有找到这条记录，它可能已经被移动或删除。",
  todayLimitReached: "今天已经够满了。先完成或移走一件，再把新的想法放进今天。",
  invalidState: "这个状态不能用于每日启动台。",
  exportFailed: "导出失败，请检查目标文件夹权限后重试。",
  saveFailed: "保存失败，请稍后重试，当前界面内容仍保留。"
} as const;
