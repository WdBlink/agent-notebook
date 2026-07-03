import assert from "node:assert/strict";
import test from "node:test";
import { dailyNotePath } from "../src/export";
import {
  addPlanFromModelTasks,
  createEmptyData,
  normalizeData,
  selectedHotStartTasks,
  toggleHotStartTask
} from "../src/state";

test("model tasks become a new active plan", () => {
  const result = addPlanFromModelTasks(
    createEmptyData(),
    "明天研究一个项目，先查概念和代码结构。",
    [
      {
        title: "梳理项目核心概念",
        detail: "读 README、论文和 docs，列出关键术语。",
        category: "research",
        priority: "P0",
        warmStart: "提前读取项目文档并生成概念表。",
        selectedForHotStart: true
      }
    ],
    "local-model",
    "test",
    "2026-07-03T08:00:00.000Z"
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.plans.length, 1);
  assert.equal(result.data.plans[0]?.tasks[0]?.selectedForHotStart, true);
  assert.equal(selectedHotStartTasks(result.data).length, 1);
});

test("empty intent is rejected before model tasks are stored", () => {
  const result = addPlanFromModelTasks(createEmptyData(), "  ", [{ title: "x", detail: "x" }]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "EMPTY_INTENT");
});

test("hot start selection can be toggled by task id", () => {
  const created = addPlanFromModelTasks(
    createEmptyData(),
    "明天分析实验。",
    [{ title: "跑 baseline", detail: "先跑现有实验。", selectedForHotStart: false }],
    "local-model",
    undefined,
    "2026-07-03T08:00:00.000Z"
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const taskId = created.data.plans[0]?.tasks[0]?.id ?? "";

  const updated = toggleHotStartTask(created.data, taskId, true, "2026-07-03T08:10:00.000Z");
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  assert.equal(selectedHotStartTasks(updated.data).length, 1);
});

test("hot start toggle only updates the plan containing the task", () => {
  const first = addPlanFromModelTasks(
    createEmptyData(),
    "第一个计划。",
    [{ title: "第一个任务", detail: "先做 A。", selectedForHotStart: false }],
    "local-model",
    undefined,
    "2026-07-03T08:00:00.000Z"
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = addPlanFromModelTasks(
    first.data,
    "第二个计划。",
    [{ title: "第二个任务", detail: "先做 B。", selectedForHotStart: false }],
    "local-model",
    undefined,
    "2026-07-03T08:01:00.000Z"
  );
  assert.equal(second.ok, true);
  if (!second.ok) return;

  const untouchedPlan = second.data.plans[1];
  const taskId = second.data.plans[0]?.tasks[0]?.id ?? "";
  const updated = toggleHotStartTask(second.data, taskId, true, "2026-07-03T08:10:00.000Z");
  assert.equal(updated.ok, true);
  if (!updated.ok) return;

  assert.equal(updated.data.plans[1]?.updatedAt, untouchedPlan?.updatedAt);
});

test("missing task id returns recoverable error", () => {
  const result = toggleHotStartTask(createEmptyData(), "missing-task", true);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "TASK_NOT_FOUND");
});

test("normalizeData repairs corrupted settings and task fields", () => {
  const normalized = normalizeData({
    schemaVersion: 2,
    settings: { dailyNoteFolder: 42, llmEndpoint: "", llmModel: "" },
    plans: [
      {
        id: "plan-a",
        intent: "研究项目",
        createdAt: "2026-07-03T08:00:00.000Z",
        updatedAt: "2026-07-03T08:00:00.000Z",
        tasks: [
          {
            id: "task-a",
            title: "任务",
            detail: "细节",
            category: "bad",
            priority: "urgent",
            warmStart: "准备资料",
            selectedForHotStart: true,
            createdAt: "2026-07-03T08:00:00.000Z",
            updatedAt: "2026-07-03T08:00:00.000Z"
          }
        ]
      }
    ]
  });

  assert.equal(normalized.settings.dailyNoteFolder, "Daily Cockpit");
  assert.equal(normalized.settings.llmEndpoint, "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(normalized.settings.llmModel, "qwen2.5:7b");
  assert.ok(normalized.settings.sessionScanRoots.includes("~/.codex/archived_sessions"));
  assert.equal(normalized.plans[0]?.tasks[0]?.category, "other");
  assert.equal(normalized.plans[0]?.tasks[0]?.priority, "P1");
  assert.equal(dailyNotePath(normalized, new Date("2026-07-03T00:00:00.000Z")), "Daily Cockpit/2026-07-03.md");
});

test("work session snapshots are normalized and capped", () => {
  const sessions = Array.from({ length: 35 }, (_, index) => ({
    id: `session-${index}`,
    platform: index === 0 ? "codex" : "unknown-platform",
    title: `昨日会话 ${index}`,
    summary: `summary ${index}`,
    path: `~/.codex/archived_sessions/session-${index}.jsonl`,
    updatedAt: "2026-07-02T08:00:00.000Z",
    artifacts: ["src/main.ts"],
    status: index === 0 ? "completed" : "bad"
  }));

  const data = normalizeData({
    schemaVersion: 2,
    settings: {},
    plans: [],
    workSessionSnapshot: {
      date: "2026-07-02",
      generatedAt: "2026-07-03T08:00:00.000Z",
      sources: ["~/.codex/archived_sessions"],
      sessions
    }
  });

  assert.equal(data.workSessionSnapshot.sessions.length, 30);
  assert.equal(data.workSessionSnapshot.sessions[0]?.platform, "codex");
  assert.equal(data.workSessionSnapshot.sessions[1]?.platform, "other");
  assert.equal(data.workSessionSnapshot.sessions[1]?.status, "unknown");
});
