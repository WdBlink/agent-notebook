import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSessionEvidenceManifest,
  createTodayBoardGeneration,
  projectTodayBoard
} from "../src/today-board";
import type { AgentWorkSession } from "../src/types";
import type { DailyReviewPackage } from "../src/workline-review";

const session: AgentWorkSession = {
  id: "codex-1",
  platform: "codex",
  title: "整理今天的工作线",
  summary: "把会话证据编排成可回看的工作线。",
  path: "/tmp/codex-1.jsonl",
  startedAt: "2026-08-01T08:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
  projectPath: "/workspace/today-board",
  artifacts: ["notes.md"],
  status: "active"
};

test("projection is raw when the page has no successful package", () => {
  const projection = projectTodayBoard({ status: "unformed" }, [session]);

  assert.equal(projection.mode, "raw");
  assert.equal(projection.activeGeneration, undefined);
  assert.deepEqual(projection.uncompiledEvidence.map((entry) => entry.identity), ["codex:codex-1:/tmp/codex-1.jsonl"]);
});

test("projection stays compiled when the admitted manifest exactly matches the snapshot despite a later wall clock", () => {
  const generation = createTodayBoardGeneration(reviewPackage(), [session]);
  const projection = projectTodayBoard({ status: "draft", packageGenerations: [generation], activePackageGenerationId: generation.id }, [session]);

  assert.equal(projection.mode, "compiled");
  assert.equal(projection.activeGeneration?.id, generation.id);
  assert.deepEqual(projection.uncompiledEvidence, []);
});

test("projection is stale only when snapshot evidence differs from the admitted package manifest", () => {
  const generation = createTodayBoardGeneration(reviewPackage(), [session]);
  const updatedSession = { ...session, updatedAt: "2026-08-01T11:00:00.000Z" };
  const newSession = { ...session, id: "codex-2", path: "/tmp/codex-2.jsonl", updatedAt: "2026-08-01T09:00:00.000Z" };
  const projection = projectTodayBoard(
    { status: "draft", packageGenerations: [generation], activePackageGenerationId: generation.id },
    [updatedSession, newSession]
  );

  assert.equal(projection.mode, "stale");
  assert.deepEqual(projection.uncompiledEvidence.map((entry) => entry.identity), [
    "codex:codex-1:/tmp/codex-1.jsonl",
    "codex:codex-2:/tmp/codex-2.jsonl"
  ]);
});

test("sealed projection stays read-only even when newer evidence arrives", () => {
  const generation = createTodayBoardGeneration(reviewPackage(), [session]);
  const projection = projectTodayBoard(
    { status: "sealed", packageGenerations: [generation], activePackageGenerationId: generation.id },
    [{ ...session, updatedAt: "2026-08-01T11:00:00.000Z" }]
  );

  assert.equal(projection.mode, "sealed");
  assert.equal(projection.activeGeneration?.package.id, "package-1");
  assert.equal(projection.uncompiledEvidence.length, 1);
});

test("sealed projection never falls back when an explicit active generation id is corrupt", () => {
  const generation = createTodayBoardGeneration(reviewPackage(), [session]);
  const projection = projectTodayBoard(
    { status: "sealed", packageGenerations: [generation], activePackageGenerationId: "generation-does-not-exist" },
    [session]
  );

  assert.equal(projection.mode, "sealed");
  assert.equal(projection.activeGeneration, undefined);
});

test("session evidence manifest changes when stable session revision metadata changes", () => {
  const original = buildSessionEvidenceManifest([session]);
  const changed = buildSessionEvidenceManifest([{ ...session, artifacts: ["notes.md", "result.md"] }]);

  assert.equal(original[0]?.identity, changed[0]?.identity);
  assert.notEqual(original[0]?.revision, changed[0]?.revision);
});

function reviewPackage(): DailyReviewPackage {
  return {
    schemaVersion: 1,
    id: "package-1",
    logicalDate: "2026-08-01",
    generatedAt: "2026-08-01T10:00:00.000Z",
    evidenceCutoff: "2026-08-01T10:00:00.000Z",
    promptProfile: "ksi-workline-review-v1",
    compilerProvider: "codex",
    model: "review-model",
    evidence: [{ id: "session:codex:codex-1", kind: "session", label: "整理今天的工作线", path: "/tmp/codex-1.jsonl", platform: "codex", sessionId: "codex-1" }],
    worklines: [{
      id: "workline-1",
      title: "建立工作线",
      summary: "把会话转换为工作线。",
      status: "ready",
      sourceSessionIds: ["codex:codex-1"],
      participation: [],
      dossier: { title: "证据", dek: "证据", blocks: [] },
      payload: {}
    }],
    warnings: [],
    rawOutput: { worklines: [] }
  };
}
