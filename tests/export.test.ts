import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyMarkdown, dailyNotePath, isDailyCockpitMarkdown } from "../src/export";
import { addPlanFromModelTasks, createEmptyData } from "../src/state";
import { seededData } from "./fixtures";

test("daily note path uses configured folder and date", () => {
  const path = dailyNotePath(seededData(), new Date("2026-07-03T00:00:00.000Z"));
  assert.equal(path, "Daily Cockpit/2026-07-03.md");
});

test("daily markdown exports intent, selected hot starts, and candidates", () => {
  const dataResult = addPlanFromModelTasks(
    createEmptyData(),
    "明天研究一个项目并先跑 demo。",
    [
      {
        title: "查核心概念",
        detail: "整理术语和论文背景。",
        category: "research",
        priority: "P0",
        warmStart: "提前读 README 和论文。",
        selectedForHotStart: true
      },
      {
        title: "跑 demo",
        detail: "尝试安装依赖并启动。",
        category: "build",
        priority: "P1",
        warmStart: "创建运行记录。",
        selectedForHotStart: false
      }
    ],
    "local-model",
    undefined,
    "2026-07-03T08:00:00.000Z"
  );
  assert.equal(dataResult.ok, true);
  if (!dataResult.ok) return;
  const markdown = buildDailyMarkdown(dataResult.data, new Date("2026-07-03T00:00:00.000Z"));

  assert.ok(markdown.includes("## 昨日工作会话"));
  assert.ok(markdown.includes("## 原始意图"));
  assert.ok(markdown.includes("## 选定热启动"));
  assert.ok(markdown.includes("## 全部待办候选"));
  assert.ok(markdown.includes("查核心概念"));
  assert.ok(markdown.includes("warm-start: 提前读 README 和论文。"));
});

test("daily markdown includes prior agent sessions before intent", () => {
  const markdown = buildDailyMarkdown(seededData(), new Date("2026-07-03T00:00:00.000Z"));
  assert.ok(markdown.indexOf("## 昨日工作会话") < markdown.indexOf("## 原始意图"));
  assert.ok(markdown.includes("实现每日看板热启动原型"));
  assert.ok(markdown.includes('resume: cd "$HOME/Documents/new day board" && codex resume seed-codex-session'));
});

test("empty export still writes structured note", () => {
  const markdown = buildDailyMarkdown(createEmptyData(), new Date("2026-07-03T00:00:00.000Z"));
  assert.ok(markdown.includes("# 每日热启动 2026-07-03"));
  assert.ok(markdown.includes("- 暂无昨日工作会话。"));
  assert.ok(markdown.includes("还没有拆解过今天的意图"));
});

test("plugin-owned marker is required before overwriting an existing export", () => {
  assert.equal(isDailyCockpitMarkdown(buildDailyMarkdown(seededData())), true);
  assert.equal(isDailyCockpitMarkdown("---\nsource: handwritten\n---\n# My note\n"), false);
  assert.equal(isDailyCockpitMarkdown("# No frontmatter\n"), false);
});
