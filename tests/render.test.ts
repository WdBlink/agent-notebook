import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { groupSessionsByProject, renderCockpit } from "../src/render";
import { createEmptyData, createSeedData } from "../src/state";
import type { RendererActions, RendererState } from "../src/types";

test("renderer puts the previous-work board before the compact intent form", () => {
  const { root } = installDom();
  renderCockpit(root, { data: createEmptyData(), processing: false }, noopActions());
  const sessions = root.querySelector(".agent-notebook-sessions");
  const form = root.querySelector(".agent-notebook-intent");
  assert.ok(sessions && form);
  assert.equal(Boolean(sessions.compareDocumentPosition(form) & 4), true);
  const textarea = root.querySelector("textarea");
  assert.equal(textarea?.rows, 2);
  assert.equal(textarea?.getAttribute("aria-label"), "待拆解的自然语言意图");
});

test("renderer groups sessions by project and exposes practical recovery actions", () => {
  const { root } = installDom();
  renderCockpit(root, { data: createSeedData(), processing: false }, noopActions());
  assert.ok(root.textContent?.includes("昨日项目"));
  assert.ok(root.textContent?.includes("agent-notebook"));
  assert.ok(root.querySelector('[aria-label="打开项目目录：agent-notebook"]'));
  assert.ok(root.querySelector('[aria-label="查看产物：src/render.ts"]'));
  assert.ok(root.querySelector('[aria-label="查看会话过程：实现每日看板连续性原型"]'));
  assert.ok(root.querySelector('[aria-label="续上会话：实现每日看板连续性原型"]'));
});

test("project grouping uses worktree as the primary identity instead of provider", () => {
  const data = createSeedData();
  const first = data.workSessionSnapshot.sessions[0];
  const second = data.workSessionSnapshot.sessions[1];
  assert.ok(first && second);
  first.projectPath = "/tmp/shared";
  second.projectPath = "/tmp/shared";
  const groups = groupSessionsByProject([first, second]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.sessions.length, 2);
});

test("renderer reports a rejected clipboard write without throwing", async () => {
  const { root } = installDom();
  const actions = noopActions();
  actions.copyResumeCommand = async () => false;
  renderCockpit(root, { data: createSeedData(), processing: false }, actions);
  const button = root.querySelector('[aria-label="续上会话：实现每日看板连续性原型"]');
  assert.ok(button instanceof HTMLButtonElement);
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(button.textContent, "复制失败");
  assert.equal(button.disabled, false);
});

test("renderer omits resume controls for unverified metadata", () => {
  const { root } = installDom();
  const data = createSeedData();
  const target = data.workSessionSnapshot.sessions[0];
  if (target) target.resumable = false;
  renderCockpit(root, { data, processing: false }, noopActions());
  assert.equal(root.querySelector('[aria-label="续上会话：实现每日看板连续性原型"]'), null);
});

test("renderer update preserves scroll, draft, focus, and selection", () => {
  const { root } = installDom();
  const state: RendererState = { data: createSeedData(), processing: false };
  const controller = renderCockpit(root, state, noopActions());
  const board = root.querySelector<HTMLElement>('[data-scroll-key="project-board"]');
  const textarea = root.querySelector<HTMLTextAreaElement>('[data-field-key="intent-draft"]');
  assert.ok(board && textarea);
  board.scrollTop = 91;
  textarea.value = "未提交草稿";
  textarea.focus();
  textarea.setSelectionRange(2, 5);
  controller.update({ ...state, refreshingSessions: true });

  const nextBoard = root.querySelector<HTMLElement>('[data-scroll-key="project-board"]');
  const nextTextarea = root.querySelector<HTMLTextAreaElement>('[data-field-key="intent-draft"]');
  assert.equal(nextBoard?.scrollTop, 91);
  assert.equal(nextTextarea?.value, "未提交草稿");
  assert.equal(document.activeElement, nextTextarea);
  assert.equal(nextTextarea?.selectionStart, 2);
  assert.equal(nextTextarea?.selectionEnd, 5);
});

function installDom(): { dom: JSDOM; root: HTMLElement } {
  const dom = new JSDOM("<main id=\"root\"></main>");
  Object.assign(globalThis, {
    document: dom.window.document,
    CSS: dom.window.CSS,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement
  });
  return { dom, root: dom.window.document.querySelector("#root") as HTMLElement };
}

function noopActions(): RendererActions {
  return {
    async decompose() {
      return { ok: true, data: createEmptyData() };
    },
    async toggleTaskCompletion() {
      return { ok: true, data: createEmptyData() };
    },
    async refreshWorkSessions() {
      return { ok: true, data: createEmptyData() };
    },
    async copyResumeCommand() {
      return true;
    },
    async openLocalPath() {
      return true;
    },
    async exportDailyNote() {
      return { ok: true, data: { path: "Agent Notebook/2026-07-04.md" } };
    },
    clearError() {}
  };
}
