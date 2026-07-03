import { CATEGORY_LABELS } from "./constants";
import { activePlan, selectedHotStartTasks } from "./state";
import type { AgentWorkSession, DecomposedTask, IntentInput, RenderController, RendererActions, RendererState } from "./types";

export function renderCockpit(root: HTMLElement, initialState: RendererState, actions: RendererActions): RenderController {
  let state = initialState;
  let destroyed = false;

  function draw(): void {
    if (destroyed) return;
    root.replaceChildren();
    root.classList.add("daily-cockpit-root");

    const shell = createEl("section", "daily-cockpit-shell");
    shell.setAttribute("aria-label", "每日热启动");
    shell.append(createMain(state, actions));
    root.append(shell);
  }

  draw();

  return {
    update(nextState: RendererState): void {
      state = nextState;
      draw();
    },
    destroy(): void {
      destroyed = true;
      root.replaceChildren();
    }
  };
}

function createMain(state: RendererState, actions: RendererActions): HTMLElement {
  const main = createEl("main", "daily-cockpit-main");
  main.append(createHeader(state));

  if (state.error) {
    main.append(createError(state.error.message, actions.clearError));
  }

  main.append(createIntentForm(state, actions));
  main.append(createWorkspace(state, actions));
  main.append(createExportPanel(state, actions));
  return main;
}

function createHeader(state: RendererState): HTMLElement {
  const plan = activePlan(state.data);
  const selected = selectedHotStartTasks(state.data);
  const header = createEl("header", "daily-cockpit-header");
  const intro = createEl("div", "daily-cockpit-intro");
  intro.append(textEl("p", "Daily Cockpit"));
  intro.append(textEl("h1", "把一句话拆成明天可启动的待办"));
  intro.append(textEl("span", "输入你的想法，本地模型拆解成候选待办；你只勾选要热启动的部分。"));

  const metrics = createEl("dl", "daily-cockpit-metrics");
  const pairs: Array<[string, string]> = [
    ["Sessions", String(state.data.workSessionSnapshot.sessions.length)],
    ["Tasks", String(plan?.tasks.length ?? 0)],
    ["Hot start", String(selected.length)],
    ["Model", state.data.settings.llmModel]
  ];
  for (const [label, value] of pairs) {
    const item = createEl("div", "daily-cockpit-metric");
    item.append(textEl("dt", label), textEl("dd", value));
    metrics.append(item);
  }

  header.append(intro, metrics);
  return header;
}

function createIntentForm(state: RendererState, actions: RendererActions): HTMLElement {
  const form = createEl("form", "daily-cockpit-intent");
  const field = createEl("label", "daily-cockpit-field");
  field.append(textEl("span", "说一下你想推进什么"));
  const textarea = document.createElement("textarea");
  textarea.name = "intent";
  textarea.rows = 6;
  textarea.placeholder = "例如：明天我想研究某个项目，先弄清楚它的核心概念、论文和代码结构，如果能先跑一个 demo 更好。";
  textarea.setAttribute("aria-label", "待拆解的自然语言意图");
  field.append(textarea);

  const footer = createEl("div", "daily-cockpit-intent-footer");
  const model = textEl("span", `本地模型：${state.data.settings.llmModel} · ${state.data.settings.llmEndpoint}`);
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
      textarea.value = "";
    }
  });

  form.append(field, footer);
  return form;
}

function createWorkspace(state: RendererState, actions: RendererActions): HTMLElement {
  const plan = activePlan(state.data);
  const workspace = createEl("section", "daily-cockpit-workspace");
  const left = createEl("div", "daily-cockpit-panel");
  const right = createEl("aside", "daily-cockpit-panel daily-cockpit-panel-subtle");

  left.append(createWorkSessions(state, actions));

  left.append(createSectionTitle("待办候选", plan ? `${plan.tasks.length} 条` : "未拆解"));
  if (state.processing) {
    left.append(createLoading());
  } else if (!plan) {
    left.append(createEmpty("说一段目标，工具会调用本地模型拆成待办候选。"));
  } else {
    const intent = createEl("div", "daily-cockpit-intent-source");
    intent.append(textEl("strong", "原始意图"), textEl("p", plan.intent));
    left.append(intent);
    const list = createEl("div", "daily-cockpit-task-list");
    for (const task of plan.tasks) {
      list.append(createTask(task, actions));
    }
    left.append(list);
  }

  const selected = selectedHotStartTasks(state.data);
  right.append(createSectionTitle("热启动", `${selected.length} 条`));
  if (selected.length === 0) {
    right.append(createEmpty("勾选适合让 AI 先预研、读资料、跑实验的待办。"));
  } else {
    const list = createEl("div", "daily-cockpit-hot-list");
    for (const task of selected) {
      const item = createEl("article", "daily-cockpit-hot-item");
      item.append(textEl("h3", task.title), textEl("p", task.warmStart));
      list.append(item);
    }
    right.append(list);
  }

  workspace.append(left, right);
  return workspace;
}

function createWorkSessions(state: RendererState, actions: RendererActions): HTMLElement {
  const snapshot = state.data.workSessionSnapshot;
  const section = createEl("section", "daily-cockpit-sessions");
  const header = createEl("div", "daily-cockpit-section-toolbar");
  const title = createEl("div", "daily-cockpit-section-title daily-cockpit-section-title-compact");
  title.append(textEl("h2", "昨日工作会话"), textEl("span", `${snapshot.date} · ${snapshot.sessions.length} 条`));
  const button = createEl("button", "daily-cockpit-action daily-cockpit-action-small");
  button.type = "button";
  button.textContent = state.refreshingSessions ? "刷新中" : "刷新";
  button.disabled = Boolean(state.refreshingSessions);
  button.setAttribute("aria-label", "刷新昨日工作会话");
  button.addEventListener("click", () => void actions.refreshWorkSessions());
  header.append(title, button);
  section.append(header);

  if (snapshot.sessions.length === 0) {
    section.append(createEmpty("还没有读到昨天的 agent 工作会话。检查扫描目录，或先点击刷新。"));
    return section;
  }

  const list = createEl("div", "daily-cockpit-session-list");
  for (const session of snapshot.sessions) {
    list.append(createWorkSession(session));
  }
  section.append(list);
  return section;
}

function createWorkSession(session: AgentWorkSession): HTMLElement {
  const article = createEl("article", "daily-cockpit-session");
  article.dataset.platform = session.platform;

  const head = createEl("div", "daily-cockpit-session-head");
  head.append(textEl("span", platformLabel(session.platform)), textEl("h3", session.title));
  article.append(head, textEl("p", session.summary));

  const meta = createEl("div", "daily-cockpit-session-meta");
  meta.append(textEl("code", `path: ${session.path}`));
  if (session.id) meta.append(textEl("code", `id: ${session.id}`));
  if (session.projectPath) meta.append(textEl("code", `project: ${session.projectPath}`));
  if (session.resumeHint) meta.append(textEl("code", `resume: ${session.resumeHint}`));
  article.append(meta);
  return article;
}

function createTask(task: DecomposedTask, actions: RendererActions): HTMLElement {
  const article = createEl("article", "daily-cockpit-task");
  article.dataset.taskId = task.id;
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = task.selectedForHotStart;
  checkbox.setAttribute("aria-label", `选择热启动：${task.title}`);
  checkbox.addEventListener("change", () => {
    void actions.toggleHotStart(task.id, checkbox.checked);
  });

  const body = createEl("div", "daily-cockpit-task-body");
  const meta = createEl("div", "daily-cockpit-task-meta");
  meta.append(textEl("span", task.priority), textEl("span", CATEGORY_LABELS[task.category]));
  body.append(meta, textEl("h3", task.title), textEl("p", task.detail));
  const warm = createEl("div", "daily-cockpit-warm");
  warm.append(textEl("strong", "热启动建议"), textEl("span", task.warmStart));
  body.append(warm);
  article.append(checkbox, body);
  return article;
}

function createExportPanel(state: RendererState, actions: RendererActions): HTMLElement {
  const panel = createEl("section", "daily-cockpit-export");
  const body = createEl("div", "daily-cockpit-export-copy");
  body.append(textEl("h2", "导出热启动清单"));
  body.append(textEl("p", state.exportPath ?? state.data.lastExportPath ?? `目标文件夹：${state.data.settings.dailyNoteFolder}`));
  const button = createEl("button", "daily-cockpit-action");
  button.type = "button";
  button.textContent = "写入今日 Markdown";
  button.addEventListener("click", () => void actions.exportDailyNote());
  panel.append(body, button);
  return panel;
}

function createSectionTitle(title: string, meta: string): HTMLElement {
  const wrapper = createEl("div", "daily-cockpit-section-title");
  wrapper.append(textEl("h2", title), textEl("span", meta));
  return wrapper;
}

function createLoading(): HTMLElement {
  const wrapper = createEl("div", "daily-cockpit-loading");
  wrapper.setAttribute("aria-live", "polite");
  wrapper.append(textEl("h3", "正在让本地模型拆解"));
  for (let index = 0; index < 3; index += 1) {
    wrapper.append(createEl("div", "daily-cockpit-skeleton"));
  }
  return wrapper;
}

function createError(message: string, clearError: () => void): HTMLElement {
  const alert = createEl("section", "daily-cockpit-error");
  alert.setAttribute("role", "alert");
  alert.append(textEl("strong", "这次没有拆好"), textEl("span", message));
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

function platformLabel(platform: AgentWorkSession["platform"]): string {
  if (platform === "codex") return "Codex";
  if (platform === "claude") return "Claude";
  if (platform === "minimax") return "Minimax";
  return "Agent";
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
