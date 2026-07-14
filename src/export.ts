import { CATEGORY_LABELS } from "./constants";
import { buildResumeCommand } from "./resume";
import { activePlan } from "./state";
import type { AgentWorkSession, CockpitData, DecomposedTask } from "./types";

const DAILY_COCKPIT_SOURCE = "source: daily-cockpit";

export function dailyNotePath(data: CockpitData, date = new Date()): string {
  const day = activePlan(data)?.targetDate ?? formatDate(date);
  const folder = data.settings.dailyNoteFolder.replace(/^\/+|\/+$/g, "") || "Daily Cockpit";
  return `${folder}/${day}.md`;
}

export function buildDailyMarkdown(data: CockpitData, date = new Date()): string {
  const plan = activePlan(data);
  const day = plan?.targetDate ?? formatDate(date);
  const lines: string[] = [
    "---",
    DAILY_COCKPIT_SOURCE,
    `date: ${day}`,
    "---",
    "",
    `# Daily Cockpit ${day}`,
    "",
    "## 昨日工作",
    ""
  ];

  if (data.workSessionSnapshot.sessions.length === 0) {
    lines.push("- 暂无昨日工作。", "");
  } else {
    for (const session of data.workSessionSnapshot.sessions) {
      lines.push(formatWorkSession(session), "");
    }
  }

  lines.push(
    "## 明日意图",
    "",
    plan ? blockquote(plan.intent) : "> 还没有拆解过明日意图。",
    ""
  );

  lines.push("## 待办事项", "");
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
  if (session.artifacts.length > 0) {
    lines.push(`  - artifacts: ${session.artifacts.map(escapeMarkdown).join(", ")}`);
  }
  const resumeCommand = buildResumeCommand(session);
  if (resumeCommand) lines.push(`  - resume: ${escapeMarkdown(resumeCommand)}`);
  return lines.join("\n");
}

function formatTask(task: DecomposedTask): string {
  const marker = task.completed ? "x" : " ";
  const lines = [
    `- [${marker}] **${escapeMarkdown(task.title)}**`,
    `  - priority: ${task.priority}`,
    `  - category: ${CATEGORY_LABELS[task.category]}`,
    `  - detail: ${escapeMarkdown(task.detail)}`
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
