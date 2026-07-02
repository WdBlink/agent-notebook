import assert from "node:assert/strict";
import test from "node:test";
import { dailyNotePath } from "../src/export";
import { captureItem, countByState, createEmptyData, moveItem, normalizeData } from "../src/state";
import { fullTodayData, seededData } from "./fixtures";

test("new captures default to inbox and preserve Chinese text", () => {
  const result = captureItem(createEmptyData(), {
    body: "突然想到一个快速捕捉入口，先不要打断今天。",
    context: "灵感"
  }, "2026-07-02T12:00:00.000Z");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.items[0]?.state, "inbox");
  assert.match(result.data.items[0]?.title ?? "", /突然想到/);
  assert.equal(result.data.items[0]?.context, "灵感");
});

test("today lane is capped at five items", () => {
  const data = fullTodayData();
  assert.equal(countByState(data, "today"), 5);

  const result = moveItem(data, "seed-d", "today", "2026-07-02T12:00:00.000Z");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "TODAY_LIMIT_REACHED");
});

test("now lane keeps exactly one item and demotes previous now to today", () => {
  const data = seededData();
  const result = moveItem(data, "seed-d", "now", "2026-07-02T12:00:00.000Z");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(countByState(result.data, "now"), 1);
  assert.equal(result.data.items.find((item) => item.id === "seed-d")?.state, "now");
  assert.equal(result.data.items.find((item) => item.id === "seed-b")?.state, "today");
});

test("invalid item id returns a recoverable error", () => {
  const result = moveItem(seededData(), "missing-item-id-404", "today");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "ITEM_NOT_FOUND");
  assert.equal(result.error.message, "没有找到这条记录，它可能已经被移动或删除。");
});

test("normalizeData survives invalid persisted input", () => {
  const normalized = normalizeData({
    schemaVersion: 1,
    settings: { dailyNoteFolder: "Daily Cockpit", todayLimit: 5 },
    items: [
      {
        id: "bad-state",
        title: "未知状态",
        body: "应该回到 inbox。",
        state: "unknown",
        createdAt: "2026-07-02T12:00:00.000Z",
        updatedAt: "2026-07-02T12:00:00.000Z"
      }
    ]
  });

  assert.equal(normalized.items[0]?.state, "inbox");
});

test("normalizeData repairs corrupted settings before export path generation", () => {
  const normalized = normalizeData({
    schemaVersion: 1,
    settings: { dailyNoteFolder: 42, todayLimit: "many" },
    items: []
  });

  assert.equal(normalized.settings.dailyNoteFolder, "Daily Cockpit");
  assert.equal(normalized.settings.todayLimit, 5);
  assert.equal(dailyNotePath(normalized, new Date("2026-07-02T00:00:00.000Z")), "Daily Cockpit/2026-07-02.md");
});

test("moving a today item to now is allowed when today is full and another now item is demoted", () => {
  const data = fullTodayData();
  const result = moveItem(data, "seed-a", "now", "2026-07-02T12:00:00.000Z");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(countByState(result.data, "today"), 5);
  assert.equal(result.data.items.find((item) => item.id === "seed-a")?.state, "now");
  assert.equal(result.data.items.find((item) => item.id === "seed-b")?.state, "today");
});
