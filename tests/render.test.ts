import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { renderCockpit } from "../src/render";
import { createEmptyData, createSeedData } from "../src/state";
import type { RendererActions, RendererState } from "../src/types";

test("renderer shows intent decomposition form", () => {
  const dom = new JSDOM("<main id=\"root\"></main>");
  globalThis.document = dom.window.document;
  const root = dom.window.document.querySelector("#root") as HTMLElement;
  const state: RendererState = {
    data: createEmptyData(),
    processing: false
  };

  renderCockpit(root, state, noopActions());
  assert.ok(root.textContent?.includes("把一句话拆成明天可启动的待办"));
  const textarea = root.querySelector("textarea");
  assert.equal(textarea?.getAttribute("aria-label"), "待拆解的自然语言意图");
  assert.ok(root.textContent?.includes("拆成待办"));
});

test("renderer shows selected hot starts and recoverable error state", () => {
  const dom = new JSDOM("<main id=\"root\"></main>");
  globalThis.document = dom.window.document;
  const root = dom.window.document.querySelector("#root") as HTMLElement;
  const state: RendererState = {
    data: createSeedData(),
    processing: false,
    error: {
      code: "LLM_FAILED",
      message: "本地模型没有响应。"
    }
  };

  renderCockpit(root, state, noopActions());
  assert.ok(root.querySelector('[role="alert"]'));
  assert.ok(root.textContent?.includes("昨日工作会话"));
  assert.ok(root.querySelector('[aria-label="续上会话：实现每日看板热启动原型"]'));
  assert.ok(root.textContent?.includes("热启动"));
  assert.ok(root.textContent?.includes("读取原始想法"));
});

test("renderer reports a rejected clipboard write without throwing", async () => {
  const { root } = installDom();
  const actions = noopActions();
  actions.copyResumeCommand = async () => false;
  renderCockpit(root, { data: createSeedData(), processing: false }, actions);

  const button = root.querySelector('[aria-label="续上会话：实现每日看板热启动原型"]');
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
  assert.equal(root.querySelector('[aria-label="续上会话：实现每日看板热启动原型"]'), null);
});

function installDom(): { dom: JSDOM; root: HTMLElement } {
  const dom = new JSDOM("<main id=\"root\"></main>");
  Object.assign(globalThis, {
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement
  });
  return { dom, root: dom.window.document.querySelector("#root") as HTMLElement };
}

function noopActions(): RendererActions {
  return {
    async decompose() {
      return { ok: true, data: createEmptyData() };
    },
    async toggleHotStart() {
      return { ok: true, data: createEmptyData() };
    },
    async refreshWorkSessions() {
      return { ok: true, data: createEmptyData() };
    },
    async copyResumeCommand() {
      return true;
    },
    async exportDailyNote() {
      return { ok: true, data: { path: "Daily Cockpit/2026-07-03.md" } };
    },
    clearError() {}
  };
}
