import { CATEGORY_LABELS } from "./constants";
import { buildResumeCommand } from "./resume";
import { activePlan } from "./state";
import type {
  AgentSessionStatus,
  AgentWorkSession,
  DecomposedTask,
  IntentInput,
  RenderController,
  RendererActions,
  RendererState
} from "./types";

interface InteractionSnapshot {
  focusKey?: string;
  selectionEnd?: number | null;
  selectionStart?: number | null;
  scroll: Map<string, { left: number; top: number }>;
  values: Map<string, string>;
}

export interface SessionProjectGroup {
  key: string;
  name: string;
  path?: string;
  sessions: AgentWorkSession[];
}

const STATUS_ORDER: AgentSessionStatus[] = ["blocked", "active", "completed", "unknown"];

export function renderCockpit(root: HTMLElement, initialState: RendererState, actions: RendererActions): RenderController {
  let state = initialState;
  let destroyed = false;

  function draw(snapshot?: InteractionSnapshot): void {
    if (destroyed) return;
    root.replaceChildren();
    root.classList.add("daily-cockpit-root");

    const shell = createEl("section", "daily-cockpit-shell");
    shell.setAttribute("aria-label", "Daily Cockpit");
    shell.append(createMain(state, actions));
    root.append(shell);
    if (snapshot) restoreInteraction(root, snapshot);
  }

  draw();

  return {
    update(nextState: RendererState): void {
      const snapshot = captureInteraction(root);
      state = nextState;
      draw(snapshot);
    },
    destroy(): void {
      destroyed = true;
      root.replaceChildren();
    }
  };
}

export function groupSessionsByProject(sessions: AgentWorkSession[]): SessionProjectGroup[] {
  const groups = new Map<string, SessionProjectGroup>();
  for (const session of sessions) {
    const projectPath = session.worktreePath ?? session.projectPath ?? session.repositoryPath;
    const key = projectPath || `unresolved:${session.platform}`;
    const existing = groups.get(key);
    if (existing) {
      existing.sessions.push(session);
      continue;
    }
    groups.set(key, {
      key,
      name: projectPath ? basename(projectPath) : "未识别项目",
      ...(projectPath ? { path: projectPath } : {}),
      sessions: [session]
    });
  }
  return [...groups.values()].sort((a, b) => newestSessionTime(b) - newestSessionTime(a));
}

function createMain(state: RendererState, actions: RendererActions): HTMLElement {
  const main = createEl("main", "daily-cockpit-main");
  main.append(createHeader(state));
  if (state.error) main.append(createError(state.error.message, actions.clearError));
  main.append(createWorkSessions(state, actions));
  main.append(createIntentForm(state, actions));
  main.append(createTasks(state, actions));
  main.append(createExportPanel(state, actions));
  return main;
}

function createHeader(state: RendererState): HTMLElement {
  const plan = activePlan(state.data);
  const sessions = state.data.workSessionSnapshot.sessions;
  const projects = groupSessionsByProject(sessions);
  const header = createEl("header", "daily-cockpit-header");
  const intro = createEl("div", "daily-cockpit-intro");
  intro.append(textEl("p", state.data.workSessionSnapshot.date), textEl("h1", "昨日工作"));
  intro.append(textEl("span", "从正确的项目、工作目录和 Agent 会话继续。"));

  const metrics = createEl("dl", "daily-cockpit-metrics");
  const pairs: Array<[string, string]> = [
    ["项目", String(projects.length)],
    ["活动", String(sessions.length)],
    ["可续上", String(sessions.filter((session) => buildResumeCommand(session)).length)],
    ["计划日期", plan?.targetDate ?? "未拆解"]
  ];
  for (const [label, value] of pairs) {
    const item = createEl("div", "daily-cockpit-metric");
    item.append(textEl("dt", label), textEl("dd", value));
    metrics.append(item);
  }
  header.append(intro, metrics);
  return header;
}

function createWorkSessions(state: RendererState, actions: RendererActions): HTMLElement {
  const snapshot = state.data.workSessionSnapshot;
  const projects = groupSessionsByProject(snapshot.sessions);
  const section = createEl("section", "daily-cockpit-sessions");
  const header = createEl("div", "daily-cockpit-section-toolbar");
  const title = createSectionTitle("昨日项目", `${projects.length} 个项目 · ${snapshot.sessions.length} 条活动`, true);
  const button = createEl("button", "daily-cockpit-action daily-cockpit-action-small");
  button.type = "button";
  button.textContent = state.refreshingSessions ? "刷新中" : "刷新";
  button.disabled = Boolean(state.refreshingSessions);
  button.setAttribute("aria-label", "刷新昨日工作会话");
  button.addEventListener("click", () => void actions.refreshWorkSessions());
  header.append(title, button);
  section.append(header);

  if (snapshot.warnings.length > 0) {
    const warning = createEl("div", "daily-cockpit-session-warning");
    warning.setAttribute("role", "status");
    warning.textContent = snapshot.warnings.join(" ");
    section.append(warning);
  }

  if (projects.length === 0) {
    section.append(createEmpty("还没有读到昨天的 Agent 工作。检查扫描目录，或点击刷新。"));
    return section;
  }

  const board = createEl("div", "daily-cockpit-project-board");
  board.dataset.scrollKey = "project-board";
  for (const project of projects) board.append(createProject(project, actions));
  section.append(board);
  return section;
}

function createProject(project: SessionProjectGroup, actions: RendererActions): HTMLElement {
  const article = createEl("article", "daily-cockpit-project");
  const head = createEl("header", "daily-cockpit-project-head");
  const identity = createEl("div", "daily-cockpit-project-identity");
  const artifacts = Array.from(new Set(project.sessions.flatMap((session) => session.artifacts)));
  identity.append(textEl("h2", project.name));
  identity.append(textEl("p", project.path ?? "工作目录尚未从平台元数据中确认"));
  const stats = textEl("span", `${project.sessions.length} 个会话 · ${artifacts.length} 个产物`);
  head.append(identity, stats);
  if (project.path) {
    const open = createEl("button", "daily-cockpit-action daily-cockpit-action-small");
    open.type = "button";
    open.textContent = "打开目录";
    open.setAttribute("aria-label", `打开项目目录：${project.name}`);
    open.addEventListener("click", () => void runPathAction(open, actions, project.path ?? "", false));
    head.append(open);
  }
  article.append(head);

  const lanes = createEl("div", "daily-cockpit-status-lanes");
  for (const status of STATUS_ORDER) {
    const sessions = project.sessions.filter((session) => session.status === status);
    if (sessions.length === 0) continue;
    const lane = createEl("section", "daily-cockpit-status-lane");
    lane.dataset.status = status;
    lane.append(textEl("h3", `${statusLabel(status)} · ${sessions.length}`));
    const list = createEl("div", "daily-cockpit-session-list");
    for (const session of sessions) list.append(createWorkSession(session, actions));
    lane.append(list);
    lanes.append(lane);
  }
  article.append(lanes);
  return article;
}

function createWorkSession(session: AgentWorkSession, actions: RendererActions): HTMLElement {
  const article = createEl("article", "daily-cockpit-session");
  article.dataset.platform = session.platform;
  const head = createEl("div", "daily-cockpit-session-head");
  head.append(textEl("span", platformLabel(session.platform)), textEl("h4", session.title));
  article.append(head, textEl("p", session.summary));

  const details = createEl("div", "daily-cockpit-session-details");
  if (session.branch) details.append(textEl("code", session.branch));
  details.append(textEl("time", formatSessionTime(session.updatedAt)));
  article.append(details);

  const footer = createEl("div", "daily-cockpit-session-actions");
  for (const artifact of session.artifacts.slice(0, 2)) {
    const path = resolveArtifactPath(session, artifact);
    if (!path) continue;
    const button = createEl("button", "daily-cockpit-action daily-cockpit-action-small");
    button.type = "button";
    button.textContent = session.artifacts.length > 1 ? basename(artifact) : "查看产物";
    button.title = artifact;
    button.setAttribute("aria-label", `查看产物：${artifact}`);
    button.addEventListener("click", () => void runPathAction(button, actions, path, false));
    footer.append(button);
  }

  const process = createEl("button", "daily-cockpit-action daily-cockpit-action-small");
  process.type = "button";
  process.textContent = "查看过程";
  process.setAttribute("aria-label", `查看会话过程：${session.title}`);
  process.addEventListener("click", () => void runPathAction(process, actions, session.path, false));
  footer.append(process);

  const resumeCommand = buildResumeCommand(session);
  if (resumeCommand) {
    const button = createEl("button", "daily-cockpit-action daily-cockpit-action-small daily-cockpit-resume");
    button.type = "button";
    button.textContent = "续上会话";
    button.setAttribute("aria-label", `续上会话：${session.title}`);
    button.setAttribute("aria-live", "polite");
    button.addEventListener("click", () => void copyResume(button, session, resumeCommand, actions));
    footer.append(button);
  }
  article.append(footer);
  return article;
}

function createIntentForm(state: RendererState, actions: RendererActions): HTMLElement {
  const form = createEl("form", "daily-cockpit-intent");
  const field = createEl("label", "daily-cockpit-field");
  field.append(textEl("span", "说明天想推进什么"));
  const textarea = document.createElement("textarea");
  textarea.name = "intent";
  textarea.rows = 2;
  textarea.placeholder = "例如：继续论文与代码交叉验证，先确认实验差异，再补齐结果记录。";
  textarea.setAttribute("aria-label", "待拆解的自然语言意图");
  textarea.dataset.fieldKey = "intent-draft";
  textarea.dataset.focusKey = "intent-draft";
  field.append(textarea);

  const footer = createEl("div", "daily-cockpit-intent-footer");
  const model = textEl("span", `${state.data.settings.llmModel} · ${state.data.settings.llmEndpoint}`);
  const submit = createEl("button", "daily-cockpit-primary");
  submit.type = "submit";
  submit.textContent = state.processing ? "正在拆解" : "拆成待办";
  submit.disabled = state.processing;
  footer.append(model, submit);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input: IntentInput = { text: textarea.value };
    const result = await actions.decompose(input);
    if (result.ok) {
      const current = document.querySelector<HTMLTextAreaElement>('[data-field-key="intent-draft"]');
      if (current) current.value = "";
    }
  });
  form.append(field, footer);
  return form;
}

function createTasks(state: RendererState, actions: RendererActions): HTMLElement {
  const plan = activePlan(state.data);
  const section = createEl("section", "daily-cockpit-tasks");
  section.append(createSectionTitle("待办事项", plan ? `${plan.targetDate} · ${plan.tasks.length} 条` : "未拆解"));
  if (state.processing) {
    section.append(createLoading());
  } else if (!plan) {
    section.append(createEmpty("说一段目标，本地模型会把它拆成普通待办。"));
  } else {
    const intent = createEl("div", "daily-cockpit-intent-source");
    intent.append(textEl("strong", "原始意图"), textEl("p", plan.intent));
    section.append(intent);
    const list = createEl("div", "daily-cockpit-task-list");
    list.dataset.scrollKey = "task-list";
    for (const task of plan.tasks) list.append(createTask(task, actions));
    section.append(list);
  }
  return section;
}

function createTask(task: DecomposedTask, actions: RendererActions): HTMLElement {
  const article = createEl("article", "daily-cockpit-task");
  article.dataset.taskId = task.id;
  if (task.completed) article.dataset.completed = "true";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = task.completed;
  checkbox.setAttribute("aria-label", `完成待办：${task.title}`);
  checkbox.dataset.focusKey = `task-${task.id}`;
  checkbox.addEventListener("change", () => void actions.toggleTaskCompletion(task.id, checkbox.checked));

  const body = createEl("div", "daily-cockpit-task-body");
  const meta = createEl("div", "daily-cockpit-task-meta");
  meta.append(textEl("span", task.priority), textEl("span", CATEGORY_LABELS[task.category]));
  body.append(meta, textEl("h3", task.title), textEl("p", task.detail));
  article.append(checkbox, body);
  return article;
}

function createExportPanel(state: RendererState, actions: RendererActions): HTMLElement {
  const panel = createEl("section", "daily-cockpit-export");
  const body = createEl("div", "daily-cockpit-export-copy");
  body.append(textEl("h2", "每日简报"));
  body.append(textEl("p", state.exportPath ?? state.data.lastExportPath ?? `目标文件夹：${state.data.settings.dailyNoteFolder}`));
  const button = createEl("button", "daily-cockpit-action");
  button.type = "button";
  button.textContent = "写入 Markdown";
  button.addEventListener("click", () => void actions.exportDailyNote());
  panel.append(body, button);
  return panel;
}

function captureInteraction(root: HTMLElement): InteractionSnapshot {
  const snapshot: InteractionSnapshot = { scroll: new Map(), values: new Map() };
  for (const element of root.querySelectorAll<HTMLElement>("[data-scroll-key]")) {
    const key = element.dataset.scrollKey;
    if (key) snapshot.scroll.set(key, { left: element.scrollLeft, top: element.scrollTop });
  }
  for (const field of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-field-key]")) {
    const key = field.dataset.fieldKey;
    if (key) snapshot.values.set(key, field.value);
  }
  const active = document.activeElement;
  if (active instanceof HTMLElement && root.contains(active)) {
    if (active.dataset.focusKey) snapshot.focusKey = active.dataset.focusKey;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      snapshot.selectionStart = active.selectionStart;
      snapshot.selectionEnd = active.selectionEnd;
    }
  }
  return snapshot;
}

function restoreInteraction(root: HTMLElement, snapshot: InteractionSnapshot): void {
  for (const [key, position] of snapshot.scroll) {
    const element = root.querySelector<HTMLElement>(`[data-scroll-key="${cssEscape(key)}"]`);
    if (element) {
      element.scrollLeft = position.left;
      element.scrollTop = position.top;
    }
  }
  for (const [key, value] of snapshot.values) {
    const field = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field-key="${cssEscape(key)}"]`);
    if (field) field.value = value;
  }
  if (!snapshot.focusKey) return;
  const focus = root.querySelector<HTMLElement>(`[data-focus-key="${cssEscape(snapshot.focusKey)}"]`);
  focus?.focus();
  if (
    (focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement) &&
    snapshot.selectionStart !== undefined &&
    snapshot.selectionEnd !== undefined
  ) {
    focus.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  }
}

async function copyResume(
  button: HTMLButtonElement,
  session: AgentWorkSession,
  command: string,
  actions: RendererActions
): Promise<void> {
  button.disabled = true;
  button.textContent = "复制中";
  let copied = false;
  try {
    copied = await actions.copyResumeCommand(command);
  } catch {
    copied = false;
  }
  button.textContent = copied ? "已复制" : "复制失败";
  button.setAttribute("aria-label", copied ? `已复制续上会话命令：${session.title}` : `复制续上会话命令失败：${session.title}`);
  button.disabled = false;
  setTimeout(() => {
    if (!button.isConnected) return;
    button.textContent = "续上会话";
    button.setAttribute("aria-label", `续上会话：${session.title}`);
  }, 1400);
}

async function runPathAction(
  button: HTMLButtonElement,
  actions: RendererActions,
  path: string,
  reveal: boolean
): Promise<void> {
  const original = button.textContent ?? "打开";
  const opened = await actions.openLocalPath(path, reveal).catch(() => false);
  button.textContent = opened ? "已打开" : "打开失败";
  setTimeout(() => {
    if (button.isConnected) button.textContent = original;
  }, 1400);
}

function createSectionTitle(title: string, meta: string, compact = false): HTMLElement {
  const wrapper = createEl("div", `daily-cockpit-section-title${compact ? " daily-cockpit-section-title-compact" : ""}`);
  wrapper.append(textEl("h2", title), textEl("span", meta));
  return wrapper;
}

function createLoading(): HTMLElement {
  const wrapper = createEl("div", "daily-cockpit-loading");
  wrapper.setAttribute("aria-live", "polite");
  wrapper.append(textEl("h3", "正在让本地模型拆解"));
  for (let index = 0; index < 3; index += 1) wrapper.append(createEl("div", "daily-cockpit-skeleton"));
  return wrapper;
}

function createError(message: string, clearError: () => void): HTMLElement {
  const alert = createEl("section", "daily-cockpit-error");
  alert.setAttribute("role", "alert");
  alert.append(textEl("strong", "这次没有完成"), textEl("span", message));
  const button = createEl("button", "daily-cockpit-action");
  button.type = "button";
  button.textContent = "知道了";
  button.addEventListener("click", clearError);
  alert.append(button);
  return alert;
}

function createEmpty(copy: string): HTMLElement {
  const empty = createEl("div", "daily-cockpit-empty");
  empty.append(textEl("p", copy));
  return empty;
}

function resolveArtifactPath(session: AgentWorkSession, artifact: string): string | undefined {
  const value = artifact.trim();
  if (!value || /[\r\n\0]/.test(value)) return undefined;
  if (value.startsWith("/") || value === "~" || value.startsWith("~/")) return value;
  const base = session.worktreePath ?? session.projectPath ?? session.repositoryPath;
  return base ? `${base.replace(/\/$/, "")}/${value.replace(/^\.\//, "")}` : undefined;
}

function platformLabel(platform: AgentWorkSession["platform"]): string {
  if (platform === "codex") return "Codex";
  if (platform === "claude") return "Claude";
  if (platform === "minimax") return "Minimax";
  return "Agent";
}

function statusLabel(status: AgentSessionStatus): string {
  if (status === "blocked") return "需接管";
  if (status === "active") return "进行中";
  if (status === "completed") return "已完成";
  return "未分类";
}

function newestSessionTime(group: SessionProjectGroup): number {
  return Math.max(...group.sessions.map((session) => Date.parse(session.updatedAt) || 0));
}

function formatSessionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function basename(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

function cssEscape(value: string): string {
  const css = globalThis.CSS as { escape?: (input: string) => string } | undefined;
  return css?.escape ? css.escape(value) : value.replace(/["\\]/g, "\\$&");
}

function createEl<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}

function textEl<K extends keyof HTMLElementTagNameMap>(tag: K, text: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}
