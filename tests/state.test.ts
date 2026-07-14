import assert from "node:assert/strict";
import test from "node:test";
import { dailyNotePath } from "../src/export";
import {
  addPlanFromModelTasks,
  createEmptyData,
  normalizeData,
  toggleTaskCompletion
} from "../src/state";

test("model tasks become an uncompleted plan for the next local day", () => {
  const result = addPlanFromModelTasks(
    createEmptyData(),
    "明天研究一个项目，先查概念和代码结构。",
    [{ title: "梳理项目核心概念", detail: "读 README、论文和 docs。", category: "research", priority: "P0" }],
    "local-model",
    "test",
    "2026-07-03T08:00:00.000Z"
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.schemaVersion, 3);
  assert.equal(result.data.plans[0]?.targetDate, "2026-07-04");
  assert.equal(result.data.plans[0]?.tasks[0]?.completed, false);
});

test("empty intent is rejected before model tasks are stored", () => {
  const result = addPlanFromModelTasks(createEmptyData(), "  ", [{ title: "x", detail: "x" }]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "EMPTY_INTENT");
});

test("ordinary task completion can be toggled without changing another plan", () => {
  const first = addPlanFromModelTasks(
    createEmptyData(),
    "第一个计划。",
    [{ title: "第一个任务", detail: "先做 A。" }],
    "local-model",
    undefined,
    "2026-07-03T08:00:00.000Z"
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = addPlanFromModelTasks(
    first.data,
    "第二个计划。",
    [{ title: "第二个任务", detail: "先做 B。" }],
    "local-model",
    undefined,
    "2026-07-03T08:01:00.000Z"
  );
  assert.equal(second.ok, true);
  if (!second.ok) return;

  const untouchedPlan = second.data.plans[1];
  const taskId = second.data.plans[0]?.tasks[0]?.id ?? "";
  const updated = toggleTaskCompletion(second.data, taskId, true, "2026-07-03T08:10:00.000Z");
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  assert.equal(updated.data.plans[0]?.tasks[0]?.completed, true);
  assert.equal(updated.data.plans[1]?.updatedAt, untouchedPlan?.updatedAt);
});

test("missing task id returns a recoverable error", () => {
  const result = toggleTaskCompletion(createEmptyData(), "missing-task", true);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "TASK_NOT_FOUND");
});

test("schema two data gains target dates and drops retired task semantics", () => {
  const normalized = normalizeData({
    schemaVersion: 2,
    settings: {
      dailyNoteFolder: 42,
      llmEndpoint: "",
      llmModel: "",
      sessionScanRoots: ["~/.claude/tasks", "~/.minimax/plans", "/custom/session-root"]
    },
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
            completed: false,
            createdAt: "2026-07-03T08:00:00.000Z",
            updatedAt: "2026-07-03T08:00:00.000Z"
          }
        ]
      }
    ]
  });

  assert.equal(normalized.schemaVersion, 3);
  assert.equal(normalized.settings.dailyNoteFolder, "Daily Cockpit");
  assert.equal(normalized.settings.llmEndpoint, "http://127.0.0.1:11434/v1/chat/completions");
  assert.ok(normalized.settings.sessionScanRoots.includes("~/.codex/sessions"));
  assert.ok(normalized.settings.sessionScanRoots.includes("~/.claude/projects"));
  assert.ok(normalized.settings.sessionScanRoots.includes("/custom/session-root"));
  assert.equal(normalized.settings.sessionScanRoots.includes("~/.claude/tasks"), false);
  assert.equal(normalized.settings.sessionScanRoots.includes("~/.minimax/plans"), false);
  assert.equal(normalized.plans[0]?.targetDate, "2026-07-04");
  assert.equal(normalized.plans[0]?.tasks[0]?.category, "other");
  assert.equal(normalized.plans[0]?.tasks[0]?.priority, "P1");
  assert.equal(dailyNotePath(normalized, new Date("2026-07-03T00:00:00.000Z")), "Daily Cockpit/2026-07-03.md");
});

test("a stale stored plan is not kept active after normalization", () => {
  const normalized = normalizeData({
    schemaVersion: 2,
    settings: {},
    activePlanId: "old-plan",
    plans: [
      {
        id: "old-plan",
        intent: "旧计划",
        createdAt: "2026-07-02T08:00:00.000Z",
        updatedAt: "2026-07-02T08:00:00.000Z",
        tasks: []
      }
    ]
  });
  assert.equal(normalized.activePlanId, undefined);
});

test("work session snapshots are capped and retired task paths cannot remain resumable", () => {
  const sessions = Array.from({ length: 35 }, (_, index) => ({
    id: `session-${index}`,
    platform: index === 0 ? "claude" : "unknown-platform",
    title: `昨日会话 ${index}`,
    summary: `summary ${index}`,
    path: index === 0 ? "~/.claude/tasks/session.jsonl" : `~/.codex/archived_sessions/session-${index}.jsonl`,
    updatedAt: "2026-07-02T08:00:00.000Z",
    resumable: true,
    artifacts: index === 0 ? ["src/main.ts", ".agents", "session-0"] : ["src/main.ts"],
    status: index === 0 ? "completed" : "bad"
  }));
  const data = normalizeData({
    schemaVersion: 2,
    settings: {},
    plans: [],
    workSessionSnapshot: {
      date: "2026-07-02",
      generatedAt: "2026-07-03T08:00:00.000Z",
      sources: ["~/.claude/tasks"],
      sessions
    }
  });
  assert.equal(data.workSessionSnapshot.sessions.length, 30);
  assert.equal(data.workSessionSnapshot.sessions[0]?.resumable, false);
  assert.deepEqual(data.workSessionSnapshot.sessions[0]?.artifacts, ["src/main.ts"]);
  assert.equal(data.workSessionSnapshot.sessions[1]?.platform, "other");
  assert.equal(data.workSessionSnapshot.sessions[1]?.status, "unknown");
});
