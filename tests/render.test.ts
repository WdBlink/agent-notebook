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
  assert.ok(root.textContent?.includes("codex resume seed-codex-session"));
  assert.ok(root.textContent?.includes("热启动"));
  assert.ok(root.textContent?.includes("读取原始想法"));
});

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
    async exportDailyNote() {
      return { ok: true, data: { path: "Daily Cockpit/2026-07-03.md" } };
    },
    clearError() {}
  };
}
