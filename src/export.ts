import { STATE_LABELS } from "./constants";
import { itemsForState } from "./state";
import type { CockpitData, CockpitItem, CockpitItemState } from "./types";

const EXPORT_SECTIONS: CockpitItemState[] = ["now", "today", "inbox", "soon", "hold", "done", "archive"];
const DAILY_COCKPIT_SOURCE = "source: daily-cockpit";

export function dailyNotePath(data: CockpitData, date = new Date()): string {
  const day = formatDate(date);
  const folder = data.settings.dailyNoteFolder.replace(/^\/+|\/+$/g, "") || "Daily Cockpit";
  return `${folder}/${day}.md`;
}

export function buildDailyMarkdown(data: CockpitData, date = new Date()): string {
  const day = formatDate(date);
  const lines: string[] = [
    "---",
    DAILY_COCKPIT_SOURCE,
    `date: ${day}`,
    "---",
    "",
    `# 每日启动台 ${day}`,
    "",
    "> 接住灵感，不丢。守住今天，不乱。到了合适的时候，再提醒你。",
    "",
    "## 今日边界",
    "",
    `- Today: ${itemsForState(data, "today").length}/${data.settings.todayLimit}`,
    `- Now: ${itemsForState(data, "now").length}/1`,
    `- Inbox: ${itemsForState(data, "inbox").length}`,
    ""
  ];

  for (const state of EXPORT_SECTIONS) {
    lines.push(`## ${STATE_LABELS[state]}`, "");
    const items = itemsForState(data, state);
    if (items.length === 0) {
      lines.push(emptyExportLine(state), "");
      continue;
    }

    for (const item of items) {
      lines.push(formatItem(item), "");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function isDailyCockpitMarkdown(markdown: string): boolean {
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/);
  const body = frontmatter?.[1];
  return Boolean(body?.split(/\r?\n/).some((line) => line.trim() === DAILY_COCKPIT_SOURCE));
}

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatItem(item: CockpitItem): string {
  const lines = [`- [${item.state === "done" ? "x" : " "}] **${escapeMarkdown(item.title)}**`];
  if (item.body.trim()) {
    lines.push(`  - ${escapeMarkdown(item.body.trim()).replace(/\n/g, "\n  - ")}`);
  }
  if (item.context) {
    lines.push(`  - context: ${escapeMarkdown(item.context)}`);
  }
  if (item.source) {
    lines.push(`  - source: ${escapeMarkdown(item.source)}`);
  }
  return lines.join("\n");
}

function emptyExportLine(state: CockpitItemState): string {
  if (state === "hold") return "- 这里暂时空着。没有需要惦记的事。";
  if (state === "today") return "- 今天可以少一点，先守住注意力。";
  if (state === "inbox") return "- 没有新的灵感需要处理。";
  return "- 暂无。";
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}
