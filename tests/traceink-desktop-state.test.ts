import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  automaticTraceinkEligibilityMode,
  boundedTraceinkError,
  effectiveTraceinkReviewState,
  exposeTraceinkFailure,
  traceinkActivityDates,
  traceinkScopeFromSnapshot
} from "../app/desktop/traceink-desktop-state";
import {
  appendTraceinkIndexRevision,
  createEmptyTraceinkAssetStore
} from "../app/desktop/traceink-asset-store";
import type { TraceinkIndexArtifactDraftV1 } from "../src/traceink-review-assets";
import type { AgentWorkSession } from "../src/types";

const hash = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

test("a valid canonical index owns effective mode even when a legacy page was sealed", () => {
  const sessions = [session()];
  const store = appendTraceinkIndexRevision(createEmptyTraceinkAssetStore(), indexDraft("2026-08-15", sessions));

  const compiled = effectiveTraceinkReviewState(store, "2026-08-15", sessions, "raw");
  assert.equal(compiled.projection.mode, "compiled");
  assert.equal(compiled.boardMode, "compiled");
  assert.equal(compiled.projection.activeIndex?.rawMarkdown, "# canonical\n");

  const sealed = effectiveTraceinkReviewState(store, "2026-08-15", sessions, "sealed");
  assert.equal(sealed.projection.mode, "compiled");
  assert.equal(sealed.boardMode, "compiled");
});

test("legacy seal remains a fallback only when no canonical index exists", () => {
  const state = effectiveTraceinkReviewState(createEmptyTraceinkAssetStore(), "2026-08-15", [session()], "sealed");
  assert.equal(state.projection.activeIndex, undefined);
  assert.equal(state.boardMode, "sealed");
});

test("canonical activity dates include active, historical artifact, and reflection dates", () => {
  const base = appendTraceinkIndexRevision(createEmptyTraceinkAssetStore(), indexDraft("2026-08-15", [session()]));
  const dates = traceinkActivityDates({
    ...base,
    artifacts: [
      ...base.artifacts,
      { ...base.artifacts[0]!, id: "historical", logicalDate: "2026-08-13" }
    ],
    reflections: [{
      schemaVersion: 1,
      id: "reflection-1",
      revision: 1,
      logicalDate: "2026-08-14",
      worklineId: "workline-1",
      dossier: {
        artifactId: "dossier-1",
        stage: "dossier",
        revision: 1,
        outputHash: hash("dossier")
      },
      text: "human ink",
      contentHash: hash("human ink"),
      createdAt: "2026-08-14T12:00:00.000Z",
      savedAt: "2026-08-14T12:00:00.000Z"
    }]
  });

  assert.deepEqual(dates, ["2026-08-15", "2026-08-14", "2026-08-13"]);
});

test("canonical errors are one line and bounded", () => {
  const message = boundedTraceinkError(new Error(`failed\n${"x".repeat(400)}`));
  assert.equal(message.includes("\n"), false);
  assert.equal(message.length, 240);
  assert.equal(message.endsWith("…"), true);
});

test("scanner-owned scope is passed through exactly and inconsistent scope fails closed", () => {
  const snapshot = {
    date: "2026-08-15",
    generatedAt: "2026-08-15T12:30:00.000Z",
    sessions: [session()],
    sources: ["/tmp"],
    warnings: [],
    evidenceCoverage: [],
    evidenceScope: {
      timeZone: "UTC",
      startInclusive: "2026-08-15T00:00:00.000Z",
      endExclusive: "2026-08-16T00:00:00.000Z",
      evidenceCutoff: "2026-08-15T12:30:00.000Z"
    }
  };

  const scope = traceinkScopeFromSnapshot(snapshot, "2026-08-15");
  assert.deepEqual(scope, snapshot.evidenceScope);
  assert.notEqual(scope, snapshot.evidenceScope);
  const missingScope = structuredClone(snapshot);
  delete (missingScope as Partial<typeof snapshot>).evidenceScope;
  assert.throws(() => traceinkScopeFromSnapshot(missingScope, "2026-08-15"), /没有提供/);
  assert.throws(() => traceinkScopeFromSnapshot({
    ...snapshot,
    evidenceScope: { ...snapshot.evidenceScope, evidenceCutoff: "2026-08-15T12:31:00.000Z" }
  }, "2026-08-15"), /截止点不一致/);
  assert.throws(() => traceinkScopeFromSnapshot({
    ...snapshot,
    evidenceScope: {
      ...snapshot.evidenceScope,
      startInclusive: "2026-08-14T00:00:00.000Z",
      endExclusive: "2026-08-15T00:00:00.000Z"
    }
  }, "2026-08-15"), /本地日界不一致/);
});

test("scheduled Traceink preparation treats stale as refresh-eligible without reopening compiled or sealed days", () => {
  assert.equal(automaticTraceinkEligibilityMode("raw"), "raw");
  assert.equal(automaticTraceinkEligibilityMode("stale"), "raw");
  assert.equal(automaticTraceinkEligibilityMode("compiled"), "compiled");
  assert.equal(automaticTraceinkEligibilityMode("sealed"), "sealed");
});

test("a failed refresh is explicit while last-good remains readable, but sealed and in-flight surfaces keep priority", () => {
  const ready = {
    enabled: true,
    time: "18:30",
    logicalDate: "2026-08-15",
    status: "ready" as const
  };
  assert.deepEqual(exposeTraceinkFailure(ready, "refresh failed", "stale"), {
    ...ready,
    status: "failed",
    message: "refresh failed"
  });
  assert.deepEqual(exposeTraceinkFailure(ready, "refresh failed", "sealed"), ready);
  const preparing = { ...ready, status: "preparing" as const, trigger: "manual" as const, startedAt: "2026-08-15T10:00:00.000Z" };
  assert.deepEqual(exposeTraceinkFailure(preparing, "old failure", "stale"), preparing);
});

function session(): AgentWorkSession {
  return {
    id: "session-1",
    platform: "codex",
    title: "metadata",
    summary: "metadata",
    path: "/tmp/session-1.jsonl",
    updatedAt: "2026-08-15T10:00:00.000Z",
    artifacts: [],
    status: "active",
    transcriptCapture: {
      canonicalPath: "/tmp/session-1.jsonl",
      sha256: "a".repeat(64),
      byteLength: 10,
      coverage: { startByte: 0, endByte: 10 }
    }
  };
}

function indexDraft(logicalDate: string, sessions: AgentWorkSession[]): TraceinkIndexArtifactDraftV1 {
  return {
    schemaVersion: 1,
    logicalDate,
    stage: "index",
    producer: {
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningConfiguration: "ultra",
      startedAt: `${logicalDate}T10:00:00.000Z`,
      completedAt: `${logicalDate}T10:01:00.000Z`,
      skill: {
        packageId: "traceink",
        version: "traceink-skill-bundle-v1",
        skillHash: hash("skill"),
        editorialContractHash: hash("contract")
      }
    },
    inputEvidenceHash: hash("input"),
    rawMarkdown: "# canonical\n",
    coverage: [],
    evidence: sessions.map((item, index) => ({
      id: `session-${index}`,
      kind: "session" as const,
      provider: "codex" as const,
      sessionId: item.id,
      path: item.transcriptCapture!.canonicalPath,
      locator: `bytes 0-${item.transcriptCapture!.byteLength}`,
      contentHash: item.transcriptCapture!.sha256
    })),
    navigation: [],
    warnings: []
  };
}
