import { EMPTY_COPY, NAV_ITEMS, STATE_LABELS, STATE_ORDER } from "./constants";
import { itemsForState } from "./state";
import type {
  CaptureInput,
  CockpitItem,
  CockpitItemState,
  RenderController,
  RendererActions,
  RendererState
} from "./types";

export function renderCockpit(root: HTMLElement, initialState: RendererState, actions: RendererActions): RenderController {
  let state = initialState;
  let destroyed = false;

  function draw(): void {
    if (destroyed) return;
    root.replaceChildren();
    if (!root.classList.contains("daily-cockpit-root")) {
      root.classList.add("daily-cockpit-root");
    }

    const shell = createEl("section", "daily-cockpit-shell");
    shell.setAttribute("aria-label", "每日启动台");
    shell.append(createNav(state, setActiveSection));
    shell.append(createMain(state, actions));
    root.append(shell);
  }

  function setActiveSection(section: RendererState["activeSection"]): void {
    state = { ...state, activeSection: section };
    draw();
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

function createNav(state: RendererState, setActive: (section: RendererState["activeSection"]) => void): HTMLElement {
  const nav = createEl("nav", "daily-cockpit-nav");
  nav.setAttribute("aria-label", "每日启动台导航");

  const brand = createEl("div", "daily-cockpit-brand");
  const brandMark = createEl("span", "daily-cockpit-brand-mark");
  brandMark.textContent = "DC";
  const brandText = createEl("div", "daily-cockpit-brand-text");
  brandText.append(textEl("strong", "每日启动台"));
  brandText.append(textEl("span", "外部工作记忆"));
  brand.append(brandMark, brandText);
  nav.append(brand);

  const list = createEl("div", "daily-cockpit-nav-list");
  for (const item of NAV_ITEMS) {
    const button = createEl("button", "daily-cockpit-nav-item");
    button.type = "button";
    button.dataset.section = item.state;
    if (state.activeSection === item.state) {
      button.classList.add("is-active");
      button.setAttribute("aria-current", "page");
    }
    button.append(textEl("span", item.label), textEl("small", item.description));
    button.addEventListener("click", () => setActive(item.state));
    list.append(button);
  }
  nav.append(list);
  return nav;
}

function createMain(state: RendererState, actions: RendererActions): HTMLElement {
  const main = createEl("main", "daily-cockpit-main");
  main.append(createHeader(state));

  if (state.loading) {
    main.append(createLoading());
    return main;
  }

  if (state.error) {
    main.append(createError(state.error.message, actions.clearError));
  }

  main.append(createCapture(actions));

  if (state.activeSection === "export") {
    main.append(createExportPanel(state, actions));
    return main;
  }

  main.append(createLane(state.activeSection, itemsForState(state.data, state.activeSection), actions));
  main.append(createOverview(state, actions));
  return main;
}

function createHeader(state: RendererState): HTMLElement {
  const header = createEl("header", "daily-cockpit-header");
  const intro = createEl("div", "daily-cockpit-intro");
  intro.append(textEl("p", "接住灵感，不丢。守住今天，不乱。"));
  intro.append(textEl("h1", "早上 3 分钟，接上昨天的自己"));
  intro.append(textEl("span", "新的想法先进收纳箱，只有确认过的事才进入今天。"));

  const metrics = createEl("dl", "daily-cockpit-metrics");
  const pairs: Array<[string, string]> = [
    ["Today", `${itemsForState(state.data, "today").length}/${state.data.settings.todayLimit}`],
    ["Now", `${itemsForState(state.data, "now").length}/1`],
    ["Inbox", `${itemsForState(state.data, "inbox").length}`],
    ["Done", `${itemsForState(state.data, "done").length}`]
  ];
  for (const [label, value] of pairs) {
    const item = createEl("div", "daily-cockpit-metric");
    item.append(textEl("dt", label), textEl("dd", value));
    metrics.append(item);
  }

  header.append(intro, metrics);
  return header;
}

function createCapture(actions: RendererActions): HTMLElement {
  const form = createEl("form", "daily-cockpit-capture");
  const field = createEl("label", "daily-cockpit-field");
  const label = textEl("span", "随手捕捉");
  const textarea = document.createElement("textarea");
  textarea.name = "body";
  textarea.rows = 3;
  textarea.placeholder = "把闪过的想法先放这里，今天不一定要处理。";
  textarea.setAttribute("aria-label", "随手捕捉内容");
  field.append(label, textarea);

  const contextField = createEl("label", "daily-cockpit-context");
  contextField.append(textEl("span", "上下文"));
  const context = document.createElement("input");
  context.name = "context";
  context.placeholder = "项目、文件或会话线索";
  context.setAttribute("aria-label", "上下文");
  contextField.append(context);

  const submit = createEl("button", "daily-cockpit-primary");
  submit.type = "submit";
  submit.textContent = "先替我记着";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input: CaptureInput = {
      body: textarea.value,
      context: context.value
    };
    const result = await actions.capture(input);
    if (result.ok) {
      textarea.value = "";
      context.value = "";
    }
  });

  form.append(field, contextField, submit);
  return form;
}

function createLane(stateName: CockpitItemState, items: CockpitItem[], actions: RendererActions): HTMLElement {
  const section = createEl("section", "daily-cockpit-lane");
  section.dataset.state = stateName;
  const title = createEl("div", "daily-cockpit-section-title");
  title.append(textEl("h2", STATE_LABELS[stateName]), textEl("span", `${items.length} 条`));
  section.append(title);

  if (items.length === 0) {
    section.append(createEmpty(stateName));
    return section;
  }

  const list = createEl("div", "daily-cockpit-card-list");
  for (const item of items) {
    list.append(createCard(item, actions));
  }
  section.append(list);
  return section;
}

function createOverview(state: RendererState, actions: RendererActions): HTMLElement {
  const overview = createEl("section", "daily-cockpit-overview");
  for (const stateName of STATE_ORDER) {
    if (stateName === state.activeSection) continue;
    const items = itemsForState(state.data, stateName).slice(0, 3);
    const group = createEl("div", "daily-cockpit-overview-group");
    group.append(textEl("h3", STATE_LABELS[stateName]));
    if (items.length === 0) {
      group.append(textEl("p", EMPTY_COPY[stateName].body));
    } else {
      for (const item of items) {
        group.append(createCompactCard(item, actions));
      }
    }
    overview.append(group);
  }
  return overview;
}

function createCard(item: CockpitItem, actions: RendererActions): HTMLElement {
  const card = createEl("article", "daily-cockpit-card");
  card.dataset.itemId = item.id;
  card.append(createCardBody(item), createActions(item, actions));
  return card;
}

function createCompactCard(item: CockpitItem, actions: RendererActions): HTMLElement {
  const card = createEl("article", "daily-cockpit-compact-card");
  card.dataset.itemId = item.id;
  card.append(createCardBody(item), createActions(item, actions, true));
  return card;
}

function createCardBody(item: CockpitItem): HTMLElement {
  const body = createEl("div", "daily-cockpit-card-body");
  const meta = createEl("div", "daily-cockpit-card-meta");
  meta.append(textEl("span", STATE_LABELS[item.state]));
  if (item.context) meta.append(textEl("span", item.context));
  body.append(meta, textEl("h3", item.title));
  if (item.body.trim()) {
    body.append(textEl("p", item.body));
  }
  return body;
}

function createActions(item: CockpitItem, actions: RendererActions, compact = false): HTMLElement {
  const group = createEl("div", compact ? "daily-cockpit-card-actions compact" : "daily-cockpit-card-actions");
  const actionItems: Array<[string, string, () => Promise<unknown>]> = [
    ["现在做", "now", () => actions.move(item.id, "now")],
    ["进今天", "today", () => actions.move(item.id, "today")],
    ["稍后", "soon", () => actions.move(item.id, "soon")],
    ["保留", "hold", () => actions.move(item.id, "hold")],
    ["完成", "done", () => actions.complete(item.id)],
    ["归档", "archive", () => actions.archive(item.id)]
  ];

  for (const [label, targetState, handler] of actionItems) {
    if (item.state === targetState) continue;
    const button = createEl("button", "daily-cockpit-action");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-label", `${label}: ${item.title}`);
    button.addEventListener("click", () => void handler());
    group.append(button);
  }
  return group;
}

function createExportPanel(state: RendererState, actions: RendererActions): HTMLElement {
  const panel = createEl("section", "daily-cockpit-export");
  panel.append(textEl("h2", "导出给明天的自己"));
  panel.append(textEl("p", `目标文件夹：${state.data.settings.dailyNoteFolder}`));
  if (state.exportPath || state.data.lastExportPath) {
    panel.append(textEl("p", `最近导出：${state.exportPath ?? state.data.lastExportPath ?? ""}`));
  }
  const button = createEl("button", "daily-cockpit-primary");
  button.type = "button";
  button.textContent = "写入今日 Markdown";
  button.addEventListener("click", () => void actions.exportDailyNote());
  panel.append(button);
  return panel;
}

function createLoading(): HTMLElement {
  const wrapper = createEl("section", "daily-cockpit-loading");
  wrapper.setAttribute("aria-live", "polite");
  wrapper.append(textEl("h2", "正在接续上下文"));
  for (let index = 0; index < 4; index += 1) {
    wrapper.append(createEl("div", "daily-cockpit-skeleton"));
  }
  return wrapper;
}

function createError(message: string, clearError: () => void): HTMLElement {
  const alert = createEl("section", "daily-cockpit-error");
  alert.setAttribute("role", "alert");
  alert.append(textEl("strong", "有一处没有保存好"), textEl("span", message));
  const button = createEl("button", "daily-cockpit-action");
  button.type = "button";
  button.textContent = "知道了";
  button.addEventListener("click", clearError);
  alert.append(button);
  return alert;
}

function createEmpty(stateName: CockpitItemState): HTMLElement {
  const copy = EMPTY_COPY[stateName];
  const empty = createEl("div", "daily-cockpit-empty");
  empty.append(textEl("h3", copy.title), textEl("p", copy.body));
  return empty;
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
