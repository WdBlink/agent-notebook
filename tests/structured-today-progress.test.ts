import assert from "node:assert/strict";
import test from "node:test";
import { projectStructuredTodayProgress } from "../app/desktop/structured-today-progress";
import type { StructuredTodayRunRecordV1 } from "../app/desktop/traceink-asset-store";

test("durable running records reopen as interrupted and retain checkpoint retry guidance", () => {
  const result = projectStructuredTodayProgress("2026-08-29", [run({
    runId: "index-run",
    kind: "index",
    status: "running",
    stage: "index-synthesis",
    completed: 3,
    total: 5
  }), run({
    runId: "dossier-run",
    kind: "dossier",
    worklineId: "workline-1",
    status: "running",
    stage: "dossier-critique",
    completed: 1,
    total: 4
  })]);

  assert.equal(result.index?.status, "failed");
  assert.equal(result.index?.stage, "interrupted");
  assert.equal(result.index?.completed, 3);
  assert.match(result.index?.message ?? "", /恢复记录有效时继续，否则重新整理/);
  assert.equal(result.dossierByWorklineId["workline-1"]?.status, "failed");
});

test("live memory progress overrides the matching durable run while completed history remains projected", () => {
  const result = projectStructuredTodayProgress("2026-08-29", [run({
    runId: "index-ready",
    kind: "index",
    status: "ready",
    stage: "ready",
    completed: 5,
    total: 5
  })], {
    index: {
      runId: "index-live",
      status: "running",
      stage: "digest",
      completed: 2,
      total: 6
    },
    dossierByWorklineId: {}
  });

  assert.equal(result.index?.runId, "index-live");
  assert.equal(result.index?.status, "running");
});

function run(overrides: Partial<StructuredTodayRunRecordV1> & Pick<StructuredTodayRunRecordV1, "runId" | "kind" | "status" | "stage" | "completed" | "total">): StructuredTodayRunRecordV1 {
  return {
    logicalDate: "2026-08-29",
    startedAt: "2026-08-29T01:00:00.000Z",
    updatedAt: "2026-08-29T01:05:00.000Z",
    ...overrides
  };
}
