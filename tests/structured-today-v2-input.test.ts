import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildStructuredTodayIndexInput,
  buildStructuredTodayIndexInputV2
} from "../app/desktop/structured-today-input";
import { sha256Text } from "../src/structured-today-contracts";
import {
  StructuredTodayIndexWorkflowInputV2Schema,
  structuredTodayAdmittedCorpusHash
} from "../src/structured-today-v2-workflow";
import type { AgentWorkSnapshot } from "../src/types";

const logicalDate = "2026-08-30";

test("V2 input freezes admitted provenance while the V1 builder remains unchanged", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "structured-v2-input-"));
  try {
    const sourcePath = path.join(directory, "session.jsonl");
    const captured = Buffer.from([
      JSON.stringify(codexMessage("user", "确定 evidence span。", "u1")),
      JSON.stringify(codexMessage("assistant", "实现 host resolver。", "a1")),
      ""
    ].join("\n"), "utf8");
    await fs.writeFile(sourcePath, Buffer.concat([captured, Buffer.from(`${JSON.stringify(codexMessage("assistant", "scan 后追加", "a2"))}\n`)]));
    const snapshot = workSnapshot(sourcePath, captured);
    const contract = editorialContract();
    const v1 = await buildStructuredTodayIndexInput({
      logicalDate,
      snapshot,
      editorialContract: contract,
      artifactId: "structured-index-v1",
      revision: 1,
      workflowRunId: "workflow-v1"
    });
    const v2 = await buildStructuredTodayIndexInputV2({
      logicalDate,
      snapshot,
      editorialContract: contract,
      artifactId: "structured-index-v2",
      revision: 2,
      workflowRunId: "workflow-v2"
    });

    assert.equal("schema" in v1, false);
    assert.equal("provenanceSession" in v1.sessions[0]!, false);
    assert.equal(v2.schema, "structured-today-index-input/v2");
    assert.equal(v2.workflowVersion, "structured-today-workflow-v5-message-spans");
    assert.equal(v2.sessions[0]?.provenanceSession?.admittedMessages.length, 2);
    assert.equal(v2.sessions[0]?.provenanceSession?.admittedMessages.some((message) => message.content.includes("追加")), false);
    assert.match(v2.admittedCorpusHash, /^[a-f0-9]{64}$/u);
    assert.match(v2.evidenceManifestId, /^manifest-v2-/u);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("V2 input schema fails closed on contradictory disposition and capture identity states", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "structured-v2-input-integrity-"));
  try {
    const sourcePath = path.join(directory, "session.jsonl");
    const captured = Buffer.from(`${JSON.stringify(codexMessage("user", "source", "u1"))}\n`, "utf8");
    await fs.writeFile(sourcePath, captured);
    const valid = await buildStructuredTodayIndexInputV2({
      logicalDate,
      snapshot: workSnapshot(sourcePath, captured),
      editorialContract: editorialContract(),
      artifactId: "structured-index-v2-integrity",
      revision: 1,
      workflowRunId: "workflow-v2-integrity"
    });

    const contradictory = structuredClone(valid) as any;
    contradictory.sessions[0].preDisposition = { kind: "failed", reason: "forged failure" };
    assert.throws(() => StructuredTodayIndexWorkflowInputV2Schema.parse(contradictory), /cannot be pre-disposed/u);

    const empty = structuredClone(valid) as any;
    empty.sessions[0].provenanceSession.admittedMessages = [];
    empty.sessions[0].provenanceSession.admittedCorpusHash = sha256Text("[]");
    empty.admittedCorpusHash = structuredTodayAdmittedCorpusHash([empty.sessions[0].provenanceSession]);
    assert.throws(() => StructuredTodayIndexWorkflowInputV2Schema.parse(empty), /zero admitted messages must be failed/u);

    const wrongRange = structuredClone(valid) as any;
    wrongRange.sessions[0].evidence[0].range = "bytes 0-999";
    wrongRange.evidence[0].range = "bytes 0-999";
    assert.throws(() => StructuredTodayIndexWorkflowInputV2Schema.parse(wrongRange), /exact evidence locator/u);

    const duplicateEvidence = structuredClone(valid) as any;
    duplicateEvidence.sessions[0].evidence.push(structuredClone(duplicateEvidence.sessions[0].evidence[0]));
    duplicateEvidence.evidence.push(structuredClone(duplicateEvidence.evidence[0]));
    assert.throws(() => StructuredTodayIndexWorkflowInputV2Schema.parse(duplicateEvidence), /unique/u);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("V2 input keeps missing or unverifiable captures as explicit failed dispositions", async () => {
  const snapshot: AgentWorkSnapshot = {
    date: logicalDate,
    generatedAt: "2026-08-30T03:00:00.000Z",
    sessions: [{
      id: "metadata-only",
      platform: "codex",
      title: "Metadata only",
      summary: "No capture",
      path: "/tmp/missing.jsonl",
      updatedAt: "2026-08-30T02:00:00.000Z",
      artifacts: [],
      status: "unknown"
    }],
    sources: [],
    warnings: []
  };
  const result = await buildStructuredTodayIndexInputV2({
    logicalDate,
    snapshot,
    editorialContract: editorialContract(),
    artifactId: "structured-index-v2-failed",
    revision: 1,
    workflowRunId: "workflow-v2-failed"
  });

  assert.equal(result.sessions[0]?.preDisposition?.kind, "failed");
  assert.equal(result.sessions[0]?.provenanceSession, undefined);
  assert.match(result.sessions[0]?.preDisposition?.reason ?? "", /capture/u);
});

function workSnapshot(sourcePath: string, captured: Uint8Array): AgentWorkSnapshot {
  return {
    date: logicalDate,
    generatedAt: "2026-08-30T03:00:00.000Z",
    sessions: [{
      id: "session-1",
      platform: "codex",
      title: "Evidence spans",
      summary: "Build V2",
      path: sourcePath,
      startedAt: "2026-08-30T01:00:00.000Z",
      updatedAt: "2026-08-30T02:00:00.000Z",
      artifacts: [],
      status: "active",
      transcriptCapture: {
        canonicalPath: sourcePath,
        sha256: createHash("sha256").update(captured).digest("hex"),
        byteLength: captured.byteLength,
        coverage: { startByte: 0, endByte: captured.byteLength }
      }
    }],
    sources: [sourcePath],
    warnings: []
  };
}

function editorialContract() {
  const text = "Evidence-first editorial contract.";
  return {
    ref: { packageId: "traceink" as const, version: "v2-test", editorialContractHash: sha256Text(text) },
    text
  };
}

function codexMessage(role: "user" | "assistant", text: string, id: string) {
  return {
    type: "response_item",
    payload: {
      type: "message",
      id,
      role,
      content: [{ type: role === "user" ? "input_text" : "output_text", text }]
    }
  };
}
