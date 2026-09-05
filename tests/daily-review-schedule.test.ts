import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveDailyReviewPreparationState,
  normalizeDailyReviewScheduleTime,
  shouldScheduleSessionSummaries,
  shouldStartAutomaticDailyReview
} from "../src/daily-review-schedule";

test("daily review schedule accepts one local HH:mm value and falls back safely", () => {
  assert.equal(normalizeDailyReviewScheduleTime("18:30"), "18:30");
  assert.equal(normalizeDailyReviewScheduleTime("07:05"), "07:05");
  assert.equal(normalizeDailyReviewScheduleTime("24:00"), "18:30");
  assert.equal(normalizeDailyReviewScheduleTime("18:30:00"), "18:30");
  assert.equal(normalizeDailyReviewScheduleTime("later"), "18:30");
});

test("automatic review starts once at the first eligible opportunity on or after the configured time", () => {
  const base = {
    enabled: true,
    time: "18:30",
    logicalDate: "2026-08-14",
    sessionCount: 12,
    boardMode: "raw" as const,
    hasFailure: false,
    inFlight: false,
    attempted: false
  };

  assert.equal(shouldStartAutomaticDailyReview({ ...base, now: new Date(2026, 7, 14, 18, 29) }), false);
  assert.equal(shouldStartAutomaticDailyReview({ ...base, now: new Date(2026, 7, 14, 18, 30) }), true);
  assert.equal(shouldStartAutomaticDailyReview({ ...base, now: new Date(2026, 7, 14, 21, 5) }), true);
  assert.equal(shouldStartAutomaticDailyReview({ ...base, now: new Date(2026, 7, 14, 21, 5), attempted: true }), false);
  assert.equal(shouldStartAutomaticDailyReview({ ...base, now: new Date(2026, 7, 14, 21, 5), hasFailure: true }), false);
  assert.equal(shouldStartAutomaticDailyReview({ ...base, now: new Date(2026, 7, 14, 21, 5), boardMode: "compiled" }), false);
  assert.equal(shouldStartAutomaticDailyReview({ ...base, now: new Date(2026, 7, 15, 18, 30) }), false);
});

test("session title summaries yield while workline material still needs preparation", () => {
  assert.equal(shouldScheduleSessionSummaries("raw"), false);
  assert.equal(shouldScheduleSessionSummaries("stale"), false);
  assert.equal(shouldScheduleSessionSummaries("compiled"), true);
  assert.equal(shouldScheduleSessionSummaries("sealed"), true);
});

test("review preparation projection keeps the board readable while background work runs", () => {
  const scheduled = deriveDailyReviewPreparationState({
    enabled: true,
    time: "18:30",
    logicalDate: "2026-08-14",
    today: "2026-08-14",
    boardMode: "raw",
    sessionCount: 8
  });
  assert.deepEqual(scheduled, {
    enabled: true,
    time: "18:30",
    logicalDate: "2026-08-14",
    status: "scheduled",
    scheduledFor: "2026-08-14T18:30"
  });

  const running = deriveDailyReviewPreparationState({
    enabled: true,
    time: "18:30",
    logicalDate: "2026-08-14",
    today: "2026-08-14",
    boardMode: "raw",
    sessionCount: 8,
    activeRun: {
      logicalDate: "2026-08-14",
      status: "preparing",
      trigger: "scheduled",
      startedAt: "2026-08-14T18:30:02.000Z"
    }
  });
  assert.equal(running.status, "preparing");
  assert.equal(running.trigger, "scheduled");

  const failed = deriveDailyReviewPreparationState({
    enabled: true,
    time: "18:30",
    logicalDate: "2026-08-14",
    today: "2026-08-14",
    boardMode: "raw",
    sessionCount: 8,
    compilationError: "模型整理没有完成"
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.message, "模型整理没有完成");

  const ready = deriveDailyReviewPreparationState({
    enabled: true,
    time: "18:30",
    logicalDate: "2026-08-14",
    today: "2026-08-14",
    boardMode: "compiled",
    sessionCount: 8
  });
  assert.equal(ready.status, "ready");
});
