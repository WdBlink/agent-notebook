import assert from "node:assert/strict";
import test from "node:test";
import { DailyReviewBackgroundCoordinator } from "../app/desktop/daily-review-background";

test("background coordinator returns immediately, exposes one active run, and deduplicates repeated starts", async () => {
  const coordinator = new DailyReviewBackgroundCoordinator();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  let stateChanges = 0;

  const first = coordinator.start({
    logicalDate: "2026-08-14",
    trigger: "manual",
    now: new Date("2026-08-14T10:00:00.000Z"),
    async run() {
      calls += 1;
      await gate;
    },
    onStateChange() { stateChanges += 1; }
  });
  const repeated = coordinator.start({
    logicalDate: "2026-08-14",
    trigger: "manual",
    async run() { calls += 1; }
  });

  assert.equal(first.started, true);
  assert.equal(repeated.started, false);
  assert.equal(calls, 0);
  assert.equal(coordinator.activeRun?.logicalDate, "2026-08-14");
  assert.equal(coordinator.activeRun?.status, "preparing");
  assert.equal(stateChanges, 1);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  await first.completion;
  assert.equal(coordinator.activeRun, undefined);
  assert.equal(stateChanges, 2);
});

test("scheduled attempts are remembered for the process lifetime even when the run fails", async () => {
  const coordinator = new DailyReviewBackgroundCoordinator();
  const started = coordinator.start({
    logicalDate: "2026-08-14",
    trigger: "scheduled",
    async run() { throw new Error("provider unavailable"); }
  });
  await started.completion;

  assert.equal(coordinator.hasScheduledAttempt("2026-08-14"), true);
  assert.equal(coordinator.activeRun, undefined);
});
