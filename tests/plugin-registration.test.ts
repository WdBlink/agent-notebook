import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  COMMAND_EXPORT_DAILY_NOTE,
  COMMAND_OPEN_COCKPIT,
  COMMAND_QUICK_CAPTURE,
  VIEW_TYPE_DAILY_COCKPIT
} from "../src/constants";

const source = fs.readFileSync("src/main.ts", "utf8");

test("plugin registers full-window view, ribbon action, and three commands", () => {
  assert.equal(VIEW_TYPE_DAILY_COCKPIT, "daily-cockpit-view");
  assert.ok(source.includes("registerView(VIEW_TYPE_DAILY_COCKPIT"));
  assert.ok(source.includes("addRibbonIcon"));
  assert.equal(COMMAND_OPEN_COCKPIT, "open-daily-cockpit");
  assert.equal(COMMAND_QUICK_CAPTURE, "quick-capture");
  assert.equal(COMMAND_EXPORT_DAILY_NOTE, "export-daily-note");
  assert.ok(source.includes("id: COMMAND_OPEN_COCKPIT"));
  assert.ok(source.includes("id: COMMAND_QUICK_CAPTURE"));
  assert.ok(source.includes("id: COMMAND_EXPORT_DAILY_NOTE"));
});

test("plugin runtime stays local-first", () => {
  assert.equal(/fetch\s*\(/.test(source), false);
  assert.equal(/XMLHttpRequest/.test(source), false);
  assert.equal(/WebSocket/.test(source), false);
});
