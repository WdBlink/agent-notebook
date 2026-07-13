import { CATEGORY_LABELS } from "./constants";
import { buildResumeCommand } from "./resume";
import { activePlan, selectedHotStartTasks } from "./state";
import type { AgentWorkSession, CockpitData, DecomposedTask } from "./types";

const DAILY_COCKPIT_SOURCE = "source: daily-cockpit";

export function dailyNotePath(data: CockpitData, date = new Date()): string {
  const day = formatDate(date);
  const folder = data.settings.dailyNoteFolder.replace(/^\/+|\/+$/g, "") || "Daily Cockpit";
  return `${folder}/${day}.md`;
}

export function buildDailyMarkdown(data: CockpitData, date = new Date()): string {
  const day = formatDate(date);
  const plan = activePlan(data);
  const selected = selectedHotStartTasks(data);
  const lines: string[] = [
    "---",
    DAILY_COCKPIT_SOURCE,
    `date: ${day}`,
    "---",
    "",
    `# 每日热启动 ${day}`,
    "",
    "## 昨日工作会话",
    ""
  ];

  if (data.workSessionSnapshot.sessions.length === 0) {
    lines.push("- 暂无昨日工作会话。", "");
  } else {
    for (const session of data.workSessionSnapshot.sessions) {
      lines.push(formatWorkSession(session), "");
    }
  }

  lines.push(
    "## 原始意图",
    "",
    plan ? blockquote(plan.intent) : "> 还没有拆解过今天的意图。",
    "",
    "## 选定热启动",
    "",
    selected.length > 0 ? "" : "- 还没有选定热启动待办。"
  );

  for (const task of selected) {
    lines.push(formatTask(task), "");
  }

  lines.push("## 全部待办候选", "");
  if (!plan || plan.tasks.length === 0) {
    lines.push("- 暂无。", "");
  } else {
    for (const task of plan.tasks) {
      lines.push(formatTask(task), "");
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

function formatWorkSession(session: AgentWorkSession): string {
  const lines = [
    `- **${escapeMarkdown(session.title)}**`,
    `  - platform: ${session.platform}`,
    `  - updated: ${session.updatedAt}`,
    `  - summary: ${escapeMarkdown(session.summary)}`,
    `  - path: ${escapeMarkdown(session.path)}`,
    `  - id: ${escapeMarkdown(session.id)}`
  ];
  if (session.worktreePath) lines.push(`  - worktree: ${escapeMarkdown(session.worktreePath)}`);
  if (session.projectPath && !session.worktreePath) lines.push(`  - cwd: ${escapeMarkdown(session.projectPath)}`);
  if (session.repositoryPath && session.repositoryPath !== session.projectPath) {
    lines.push(`  - repository: ${escapeMarkdown(session.repositoryPath)}`);
  }
  if (session.branch) lines.push(`  - branch: ${escapeMarkdown(session.branch)}`);
  const resumeCommand = buildResumeCommand(session);
  if (resumeCommand) lines.push(`  - resume: ${escapeMarkdown(resumeCommand)}`);
  return lines.join("\n");
}

function formatTask(task: DecomposedTask): string {
  const marker = task.selectedForHotStart ? "x" : " ";
  const lines = [
    `- [${marker}] **${escapeMarkdown(task.title)}**`,
    `  - priority: ${task.priority}`,
    `  - category: ${CATEGORY_LABELS[task.category]}`,
    `  - detail: ${escapeMarkdown(task.detail)}`,
    `  - warm-start: ${escapeMarkdown(task.warmStart)}`
  ];
  return lines.join("\n");
}

function blockquote(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}
