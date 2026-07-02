import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { renderCockpit } from "../src/render";
import { createEmptyData, createSeedData } from "../src/state";
import type { RendererActions, RendererState } from "../src/types";

test("renderer shows Chinese empty and pressure-control copy", () => {
  const dom = new JSDOM("<main id=\"root\"></main>");
  globalThis.document = dom.window.document;
  const root = dom.window.document.querySelector("#root") as HTMLElement;
  const state: RendererState = {
    data: createEmptyData(),
    activeSection: "inbox",
    loading: false
  };

  renderCockpit(root, state, noopActions());
  assert.ok(root.textContent?.includes("收纳箱不是债务"));
  const textarea = root.querySelector("textarea");
  assert.equal(textarea?.getAttribute("placeholder"), "把闪过的想法先放这里，今天不一定要处理。");
});

test("renderer exposes recoverable error state", () => {
  const dom = new JSDOM("<main id=\"root\"></main>");
  globalThis.document = dom.window.document;
  const root = dom.window.document.querySelector("#root") as HTMLElement;
  const state: RendererState = {
    data: createSeedData(),
    activeSection: "today",
    loading: false,
    error: {
      code: "ITEM_NOT_FOUND",
      message: "没有找到这条记录，它可能已经被移动或删除。"
    }
  };

  renderCockpit(root, state, noopActions());
  assert.ok(root.querySelector('[role="alert"]'));
  assert.ok(root.textContent?.includes("知道了"));
});

function noopActions(): RendererActions {
  return {
    async capture() {
      return { ok: true, data: createEmptyData() };
    },
    async move() {
      return { ok: true, data: createEmptyData() };
    },
    async complete() {
      return { ok: true, data: createEmptyData() };
    },
    async archive() {
      return { ok: true, data: createEmptyData() };
    },
    async exportDailyNote() {
      return { ok: true, data: { path: "Daily Cockpit/2026-07-02.md" } };
    },
    clearError() {}
  };
}
