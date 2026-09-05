import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTraceinkAssetRepository } from "../app/desktop/traceink-asset-repository";
import {
  appendStructuredTodayIndexRevision,
  appendStructuredTodayIndexV2Candidate,
  latestStructuredTodayIndexV2Candidate,
  nextStructuredTodayIndexV2CandidateRevision
} from "../app/desktop/traceink-asset-store";
import { canonicalContentHash } from "../src/structured-today-contracts";
import type { TodayWorklineIndexV2 } from "../src/structured-today-v2-contracts";

test("V2 candidates persist durably without entering the active V1 lineage", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "structured-v2-store-"));
  try {
    const repository = createTraceinkAssetRepository({ filePath: path.join(directory, "assets.json") });
    await repository.load();
    const artifact = failedV2Index();
    await repository.mutate((document) => appendStructuredTodayIndexV2Candidate(document, artifact));

    const stored = repository.snapshot();
    assert.equal(latestStructuredTodayIndexV2Candidate(stored, artifact.logicalDate)?.contentHash, artifact.contentHash);
    assert.deepEqual(stored.structuredIndexes, []);
    assert.deepEqual(stored.activeStructuredIndexByDate, {});

    const reopened = createTraceinkAssetRepository({ filePath: path.join(directory, "assets.json") });
    await reopened.load();
    assert.equal(latestStructuredTodayIndexV2Candidate(reopened.snapshot(), artifact.logicalDate)?.revision, 1);
    await assert.rejects(
      reopened.mutate((document) => appendStructuredTodayIndexV2Candidate(document, artifact)),
      /identity or revision/u
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("V1 and V2 candidates share one index revision sequence", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "structured-v2-revisions-"));
  try {
    const repository = createTraceinkAssetRepository({ filePath: path.join(directory, "assets.json") });
    await repository.load();
    const candidateOne = failedV2Index();
    await repository.mutate((document) => appendStructuredTodayIndexV2Candidate(document, candidateOne));

    const v1 = failedV1Index(2);
    const withV1 = await repository.mutate((document) => appendStructuredTodayIndexRevision(document, v1, null));
    assert.equal(withV1.activeStructuredIndexByDate?.[v1.logicalDate]?.revision, 2);
    assert.equal(nextStructuredTodayIndexV2CandidateRevision(withV1, v1.logicalDate), 3);

    const { contentHash: _oldHash, ...candidateBase } = candidateOne;
    const candidateThree = {
      ...candidateBase,
      revision: 3,
      workflowRunId: "structured-v2-candidate-run-3"
    };
    const candidateThreeHashed = {
      ...candidateThree,
      contentHash: canonicalContentHash(candidateThree)
    };
    const final = await repository.mutate((document) =>
      appendStructuredTodayIndexV2Candidate(document, candidateThreeHashed)
    );
    assert.deepEqual(
      [
        ...(final.structuredIndexV2Candidates ?? []).map((item) => item.revision),
        ...(final.structuredIndexes ?? []).map((item) => item.revision)
      ].sort((left, right) => left - right),
      [1, 2, 3]
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

function failedV2Index(): TodayWorklineIndexV2 {
  const withoutHash = {
    schema: "today-workline-index/v2" as const,
    artifactId: "structured-today-index-2026-08-30",
    revision: 1,
    logicalDate: "2026-08-30",
    workflowRunId: "structured-v2-candidate-run",
    evidenceManifestId: "manifest-v2-candidate",
    sessions: [{
      sessionId: "session-1",
      provider: "codex" as const,
      sourcePath: "/tmp/session-1.jsonl",
      title: "Candidate Session",
      startedAt: "2026-08-30T01:00:00.000Z",
      endedAt: "2026-08-30T02:00:00.000Z",
      evidenceIds: ["evidence-1"]
    }],
    evidence: [{
      evidenceId: "evidence-1",
      sourceKind: "session" as const,
      provider: "codex" as const,
      sessionId: "session-1",
      sourcePath: "/tmp/session-1.jsonl",
      range: "bytes 0-20",
      contentHash: "a".repeat(64)
    }],
    messageLocators: [],
    spans: [],
    findings: [],
    dispositions: [{
      sessionId: "session-1",
      kind: "failed" as const,
      worklineIds: [] as [],
      reason: "Candidate deliberately remains unmerged."
    }],
    worklines: [],
    coverage: { admitted: 1, assigned: 0, excluded: 0, failed: 1, unresolved: 0, complete: false },
    provenance: {
      workflowVersion: "structured-today-workflow-v5-message-spans",
      editorialContract: { packageId: "traceink" as const, version: "v2", editorialContractHash: "b".repeat(64) },
      modelFunctionVersions: {},
      providerInvocations: []
    }
  };
  return { ...withoutHash, contentHash: canonicalContentHash(withoutHash) };
}

function failedV1Index(revision: number) {
  const withoutHash = {
    schema: "today-workline-index/v1" as const,
    artifactId: "structured-today-index-2026-08-30",
    revision,
    logicalDate: "2026-08-30",
    workflowRunId: `structured-v1-run-${revision}`,
    evidenceManifestId: "manifest-v1",
    sessions: [{
      sessionId: "session-1",
      provider: "codex" as const,
      sourcePath: "/tmp/session-1.jsonl",
      title: "V1 Session",
      startedAt: "2026-08-30T01:00:00.000Z",
      evidenceIds: ["evidence-1"]
    }],
    evidence: [{
      evidenceId: "evidence-1",
      sourceKind: "session" as const,
      provider: "codex" as const,
      sessionId: "session-1",
      sourcePath: "/tmp/session-1.jsonl",
      range: "bytes 0-20",
      contentHash: "a".repeat(64)
    }],
    dispositions: [{
      sessionId: "session-1",
      kind: "failed" as const,
      worklineIds: [] as [],
      reason: "V1 remains explicit."
    }],
    worklines: [],
    coverage: { admitted: 1, assigned: 0, excluded: 0, failed: 1, unresolved: 0, complete: false },
    provenance: {
      workflowVersion: "structured-today-workflow-v4",
      editorialContract: { packageId: "traceink" as const, version: "v1", editorialContractHash: "b".repeat(64) },
      modelFunctionVersions: {},
      providerInvocations: []
    }
  };
  return { ...withoutHash, contentHash: canonicalContentHash(withoutHash) };
}
