import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  appendTraceinkIndexRevision,
  createEmptyTraceinkAssetStore,
  type TraceinkAssetStoreDocumentV1
} from "../app/desktop/traceink-asset-store";
import type { TraceinkIndexArtifactDraftV1 } from "../src/traceink-review-assets";
import { projectTraceinkReview } from "../src/traceink-review-state";
import type { AgentWorkSession } from "../src/types";

const logicalDate = "2026-08-15";
const hash = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

test("a day without a canonical index stays raw and exposes only exact captured revisions", () => {
  const captured = session();
  const uncaptured = session({
    id: "claude-two",
    platform: "claude",
    path: "/tmp/claude-two.jsonl"
  });
  delete uncaptured.transcriptCapture;

  const projection = projectTraceinkReview(
    createEmptyTraceinkAssetStore(),
    logicalDate,
    [uncaptured, captured]
  );

  assert.equal(projection.mode, "raw");
  assert.equal(projection.activeIndex, undefined);
  assert.equal(projection.activeIndexReference, undefined);
  assert.deepEqual(projection.uncompiledEvidence, [
    {
      identity: "claude:claude-two:/tmp/claude-two.jsonl",
      revision: "capture-unavailable"
    },
    {
      identity: "codex:codex-one:/tmp/codex-one.jsonl",
      revision: `sha256:${"a".repeat(64)}:123`
    }
  ]);
});

test("an exact active index is compiled and preserves raw Markdown bytes", () => {
  const captured = session();
  const rawMarkdown = "\n# 原样索引\r\n\r\n  尾部空格  \r\n";
  const store = storeWithIndex([captured], rawMarkdown);

  const projection = projectTraceinkReview(store, logicalDate, [
    session({
      title: "changed display title",
      summary: "changed display summary",
      updatedAt: "2099-01-01T00:00:00.000Z",
      artifacts: ["metadata-only-change"]
    })
  ]);

  assert.equal(projection.mode, "compiled");
  assert.equal(projection.activeIndex?.rawMarkdown, rawMarkdown);
  assert.equal(projection.activeIndex?.rawMarkdown.length, rawMarkdown.length);
  assert.deepEqual(projection.activeIndexReference, store.activeIndexByDate[logicalDate]);
  assert.deepEqual(projection.uncompiledEvidence, []);
  assert.equal(projection.diagnostic, undefined);
});

test("new and changed captured Sessions make the active index stale", () => {
  const original = session();
  const changed = session({
    transcriptCapture: {
      canonicalPath: "/tmp/codex-one.jsonl",
      sha256: "b".repeat(64),
      byteLength: 124,
      coverage: { startByte: 0, endByte: 124 }
    }
  });
  const added = session({
    id: "claude-two",
    platform: "claude",
    path: "/tmp/claude-two.jsonl",
    transcriptCapture: {
      canonicalPath: "/tmp/claude-two.jsonl",
      sha256: "c".repeat(64),
      byteLength: 77,
      coverage: { startByte: 0, endByte: 77 }
    }
  });

  const projection = projectTraceinkReview(storeWithIndex([original]), logicalDate, [changed, added]);

  assert.equal(projection.mode, "stale");
  assert.ok(projection.activeIndex);
  assert.deepEqual(projection.uncompiledEvidence, [
    {
      identity: "claude:claude-two:/tmp/claude-two.jsonl",
      revision: `sha256:${"c".repeat(64)}:77`
    },
    {
      identity: "codex:codex-one:/tmp/codex-one.jsonl",
      revision: `sha256:${"b".repeat(64)}:124`
    }
  ]);
});

test("provider, Session ID, canonical path, hash, and byte length are all freshness boundaries", () => {
  const original = session();
  const variants: AgentWorkSession[] = [
    session({ platform: "claude" }),
    session({ id: "codex-renamed" }),
    session({
      path: "/tmp/moved.jsonl",
      transcriptCapture: {
        canonicalPath: "/tmp/moved.jsonl",
        sha256: "a".repeat(64),
        byteLength: 123,
        coverage: { startByte: 0, endByte: 123 }
      }
    }),
    session({
      transcriptCapture: {
        canonicalPath: "/tmp/codex-one.jsonl",
        sha256: "b".repeat(64),
        byteLength: 123,
        coverage: { startByte: 0, endByte: 123 }
      }
    }),
    session({
      transcriptCapture: {
        canonicalPath: "/tmp/codex-one.jsonl",
        sha256: "a".repeat(64),
        byteLength: 124,
        coverage: { startByte: 0, endByte: 124 }
      }
    })
  ];

  for (const current of variants) {
    const projection = projectTraceinkReview(storeWithIndex([original]), logicalDate, [current]);
    assert.equal(projection.mode, "stale", JSON.stringify(current));
    assert.equal(projection.uncompiledEvidence.length, 1);
  }
});

test("a Session missing from the current evidence snapshot still makes the index stale", () => {
  const projection = projectTraceinkReview(storeWithIndex([session()]), logicalDate, []);

  assert.equal(projection.mode, "stale");
  assert.deepEqual(projection.uncompiledEvidence, []);
  assert.match(projection.diagnostic ?? "", /1 indexed Session is absent/);
  assert.ok((projection.diagnostic?.length ?? Infinity) <= 240);
});

test("an uncaptured current Session can never be treated as compiled", () => {
  const original = session();
  const current = session();
  delete current.transcriptCapture;
  const projection = projectTraceinkReview(storeWithIndex([original]), logicalDate, [current]);

  assert.equal(projection.mode, "stale");
  assert.deepEqual(projection.uncompiledEvidence, [{
    identity: "codex:codex-one:/tmp/codex-one.jsonl",
    revision: "capture-unavailable"
  }]);
});

test("a dangling or corrupt active reference fails closed to raw with a bounded diagnostic", () => {
  const valid = storeWithIndex([session()]);
  const dangling: TraceinkAssetStoreDocumentV1 = {
    ...valid,
    artifacts: []
  };
  const corrupt: TraceinkAssetStoreDocumentV1 = {
    ...valid,
    activeIndexByDate: {
      ...valid.activeIndexByDate,
      [logicalDate]: {
        ...valid.activeIndexByDate[logicalDate]!,
        outputHash: "f".repeat(64)
      }
    }
  };

  for (const store of [dangling, corrupt]) {
    const projection = projectTraceinkReview(store, logicalDate, [session()]);
    assert.equal(projection.mode, "raw");
    assert.equal(projection.activeIndex, undefined);
    assert.equal(projection.activeIndexReference, undefined);
    assert.match(projection.diagnostic ?? "", /active index reference failed integrity validation/);
    assert.ok((projection.diagnostic?.length ?? Infinity) <= 240);
    assert.equal(projection.uncompiledEvidence.length, 1);
  }
});

test("missing exact byte-length evidence never passes freshness by guessing from prose", () => {
  const valid = storeWithIndex([session()]);
  const artifact = valid.artifacts[0]!;
  const rawMarkdown = artifact.rawMarkdown;
  const malformedArtifact = {
    ...artifact,
    evidence: artifact.evidence.map((evidence) => ({ ...evidence, locator: "the whole transcript" }))
  };
  const store: TraceinkAssetStoreDocumentV1 = {
    ...valid,
    artifacts: [malformedArtifact]
  };

  const projection = projectTraceinkReview(store, logicalDate, [session()]);

  assert.equal(projection.mode, "stale");
  assert.equal(projection.activeIndex?.rawMarkdown, rawMarkdown);
  assert.equal(projection.uncompiledEvidence.length, 1);
  assert.match(projection.diagnostic ?? "", /exact Session evidence is incomplete/);
});

function storeWithIndex(sessions: AgentWorkSession[], rawMarkdown = "# index\n"): TraceinkAssetStoreDocumentV1 {
  return appendTraceinkIndexRevision(createEmptyTraceinkAssetStore(), indexDraft(sessions, rawMarkdown));
}

function indexDraft(sessions: AgentWorkSession[], rawMarkdown: string): TraceinkIndexArtifactDraftV1 {
  return {
    schemaVersion: 1,
    logicalDate,
    stage: "index",
    producer: {
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningConfiguration: "ultra",
      startedAt: "2026-08-15T10:00:00.000Z",
      completedAt: "2026-08-15T10:03:00.000Z",
      skill: {
        packageId: "traceink",
        version: "traceink-skill-bundle-v1",
        skillHash: hash("skill"),
        editorialContractHash: hash("contract")
      }
    },
    inputEvidenceHash: hash("input"),
    rawMarkdown,
    coverage: [],
    evidence: sessions.map((item, index) => {
      const capture = item.transcriptCapture;
      assert.ok(capture);
      return {
        id: `session-${index}`,
        kind: "session" as const,
        provider: item.platform === "claude" ? "claude" as const : "codex" as const,
        sessionId: item.id,
        path: capture.canonicalPath,
        locator: `bytes ${capture.coverage.startByte}-${capture.coverage.endByte}`,
        contentHash: capture.sha256
      };
    }),
    navigation: [],
    warnings: []
  };
}

function session(overrides: Partial<AgentWorkSession> = {}): AgentWorkSession {
  return {
    id: "codex-one",
    platform: "codex",
    title: "weak metadata title",
    summary: "weak metadata summary",
    path: "/tmp/codex-one.jsonl",
    startedAt: "2026-08-15T01:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
    artifacts: [],
    status: "completed",
    transcriptCapture: {
      canonicalPath: "/tmp/codex-one.jsonl",
      sha256: "a".repeat(64),
      byteLength: 123,
      coverage: { startByte: 0, endByte: 123 }
    },
    ...overrides
  };
}
