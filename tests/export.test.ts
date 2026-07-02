import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyMarkdown, dailyNotePath, isDailyCockpitMarkdown } from "../src/export";
import { createEmptyData } from "../src/state";
import { seededData } from "./fixtures";

test("daily note path uses configured folder and date", () => {
  const path = dailyNotePath(seededData(), new Date("2026-07-02T00:00:00.000Z"));
  assert.equal(path, "Daily Cockpit/2026-07-02.md");
});

test("daily markdown contains required sections", () => {
  const markdown = buildDailyMarkdown(seededData(), new Date("2026-07-02T00:00:00.000Z"));

  for (const heading of ["## 正在做", "## 今天", "## 灵感收纳箱", "## 先替我记着", "## 已完成"]) {
    assert.ok(markdown.includes(heading), `missing heading ${heading}`);
  }
  assert.ok(markdown.includes("早上 3 分钟接上昨天的自己"));
});

test("empty export still writes structured note", () => {
  const markdown = buildDailyMarkdown(createEmptyData(), new Date("2026-07-02T00:00:00.000Z"));
  assert.ok(markdown.includes("# 每日启动台 2026-07-02"));
  assert.ok(markdown.includes("- 今天可以少一点，先守住注意力。"));
});

test("plugin-owned marker is required before overwriting an existing export", () => {
  assert.equal(isDailyCockpitMarkdown(buildDailyMarkdown(seededData())), true);
  assert.equal(isDailyCockpitMarkdown("---\nsource: handwritten\n---\n# My note\n"), false);
  assert.equal(isDailyCockpitMarkdown("# No frontmatter\n"), false);
});
