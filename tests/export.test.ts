import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyMarkdown, dailyNotePath, isDailyCockpitMarkdown } from "../src/export";
import { addPlanFromModelTasks, createEmptyData } from "../src/state";
import { seededData } from "./fixtures";

test("daily note path uses the active plan target date", () => {
  const path = dailyNotePath(seededData(), new Date("2026-07-03T00:00:00.000Z"));
  assert.equal(path, "Daily Cockpit/2026-07-04.md");
});

test("daily markdown exports yesterday work, intent, and ordinary tasks", () => {
  const dataResult = addPlanFromModelTasks(
    createEmptyData(),
    "明天研究一个项目并先跑 demo。",
    [
      {
        title: "查核心概念",
        detail: "整理术语和论文背景。",
        category: "research",
        priority: "P0"
      },
      {
        title: "跑 demo",
        detail: "尝试安装依赖并启动。",
        category: "build",
        priority: "P1"
      }
    ],
    "local-model",
    undefined,
    "2026-07-03T08:00:00.000Z"
  );
  assert.equal(dataResult.ok, true);
  if (!dataResult.ok) return;
  const markdown = buildDailyMarkdown(dataResult.data, new Date("2026-07-03T00:00:00.000Z"));

  assert.ok(markdown.includes("## 昨日工作"));
  assert.ok(markdown.includes("## 明日意图"));
  assert.ok(markdown.includes("## 待办事项"));
  assert.ok(markdown.includes("查核心概念"));
  assert.ok(markdown.indexOf("## 明日意图") < markdown.indexOf("## 待办事项"));
});

test("daily markdown includes prior agent sessions before intent", () => {
  const markdown = buildDailyMarkdown(seededData(), new Date("2026-07-03T00:00:00.000Z"));
  assert.ok(markdown.indexOf("## 昨日工作") < markdown.indexOf("## 明日意图"));
  assert.ok(markdown.includes("实现每日看板连续性原型"));
  assert.ok(markdown.includes('resume: cd "$HOME/Documents/new day board" && codex resume seed-codex-session'));
});

test("empty export still writes structured note", () => {
  const markdown = buildDailyMarkdown(createEmptyData(), new Date("2026-07-03T00:00:00.000Z"));
  assert.ok(markdown.includes("# Daily Cockpit 2026-07-03"));
  assert.ok(markdown.includes("- 暂无昨日工作。"));
  assert.ok(markdown.includes("还没有拆解过明日意图"));
});

test("plugin-owned marker is required before overwriting an existing export", () => {
  assert.equal(isDailyCockpitMarkdown(buildDailyMarkdown(seededData())), true);
  assert.equal(isDailyCockpitMarkdown("---\nsource: handwritten\n---\n# My note\n"), false);
  assert.equal(isDailyCockpitMarkdown("# No frontmatter\n"), false);
});
