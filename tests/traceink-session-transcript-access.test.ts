import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { SessionTranscriptRequest } from "../app/desktop/api";
import { createEmptyNotebookDocument } from "../app/desktop/notebook-store";
import { authorizeSessionTranscriptRequest } from "../app/desktop/session-transcript-access";
import {
  appendTraceinkIndexRevision,
  createEmptyTraceinkAssetStore,
  type TraceinkAssetStoreDocumentV1
} from "../app/desktop/traceink-asset-store";
import { readBoundedTranscriptSource } from "../app/desktop/transcript-source-reader";
import { traceinkArtifactReference, type TraceinkEvidenceRefV1, type TraceinkIndexArtifactDraftV1 } from "../src/traceink-review-assets";

const logicalDate = "2026-08-15";
const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

test("an exact Traceink artifact and evidence reference authorizes only its frozen Session prefix", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "traceink-transcript-"));
  try {
    const admitted = "captured traceink transcript\n";
    const sourcePath = path.join(directory, "session.jsonl");
    await fs.writeFile(sourcePath, `${admitted}APPENDED_AFTER_COMPILE\n`, "utf8");
    const canonicalPath = await fs.realpath(sourcePath);
    const store = storeWithEvidence(sessionEvidence(canonicalPath, admitted));
    const request = traceinkRequest(store, canonicalPath);

    const authorized = authorizeSessionTranscriptRequest(
      request,
      [],
      createEmptyNotebookDocument(),
      store
    );

    assert.deepEqual(authorized, {
      id: "session-one",
      platform: "codex",
      path: canonicalPath,
      readPath: canonicalPath,
      title: "session-one",
      origin: "traceink-asset",
      transcriptCapture: {
        canonicalPath,
        sha256: sha256(admitted),
        byteLength: Buffer.byteLength(admitted),
        coverage: { startByte: 0, endByte: Buffer.byteLength(admitted) }
      }
    });

    const source = await readBoundedTranscriptSource(authorized.readPath, {
      origin: authorized.origin,
      transcriptCapture: authorized.transcriptCapture
    });
    assert.equal(source.content, admitted);
    assert.equal(source.content.includes("APPENDED_AFTER_COMPILE"), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("Traceink transcript authorization rejects any artifact, date, evidence, or Session tuple mismatch", () => {
  const sourcePath = "/tmp/traceink-exact-session.jsonl";
  const admitted = "exact bytes\n";
  const store = storeWithEvidence(sessionEvidence(sourcePath, admitted));
  const request = traceinkRequest(store, sourcePath);

  const mismatches: SessionTranscriptRequest[] = [
    { ...request, id: "another-session" },
    { ...request, platform: "claude" },
    { ...request, path: "/tmp/tampered.jsonl" },
    { ...request, traceinkRef: { ...request.traceinkRef!, logicalDate: "2026-08-14" } },
    { ...request, traceinkRef: { ...request.traceinkRef!, artifactId: "another-artifact" } },
    { ...request, traceinkRef: { ...request.traceinkRef!, stage: "dossier" } },
    { ...request, traceinkRef: { ...request.traceinkRef!, revision: 2 } },
    { ...request, traceinkRef: { ...request.traceinkRef!, outputHash: "f".repeat(64) } },
    { ...request, traceinkRef: { ...request.traceinkRef!, evidenceId: "missing-evidence" } }
  ];

  for (const mismatch of mismatches) {
    assert.throws(
      () => authorizeSessionTranscriptRequest(mismatch, [], createEmptyNotebookDocument(), store),
      /Traceink|会话|证据|不匹配|找不到/
    );
  }
});

test("Traceink transcript authorization requires one strict bytes 0-N locator and SHA-256", () => {
  const sourcePath = "/tmp/traceink-range-session.jsonl";
  const admitted = "exact bytes\n";
  const withoutHash = sessionEvidence(sourcePath, admitted);
  delete withoutHash.contentHash;
  const malformed: TraceinkEvidenceRefV1[] = [
    { ...sessionEvidence(sourcePath, admitted), locator: "messages 1-3" },
    { ...sessionEvidence(sourcePath, admitted), locator: `bytes 1-${Buffer.byteLength(admitted)}` },
    { ...sessionEvidence(sourcePath, admitted), locator: "bytes 0-1.5" },
    withoutHash
  ];
  for (const evidence of malformed) {
    const store = storeWithEvidence(evidence);
    assert.throws(
      () => authorizeSessionTranscriptRequest(
        traceinkRequest(store, sourcePath),
        [],
        createEmptyNotebookDocument(),
        store
      ),
      /冻结范围|SHA-256|Traceink/
    );
  }
});

test("Traceink transcript authorization refuses non-Session evidence and ambiguous authority", () => {
  const evidence: TraceinkEvidenceRefV1 = {
    id: "document-one",
    kind: "document",
    path: "/tmp/report.md",
    locator: "bytes 0-10",
    contentHash: "a".repeat(64)
  };
  const store = storeWithEvidence(evidence);
  const artifact = store.artifacts[0]!;
  const traceinkRef = {
    logicalDate,
    ...traceinkArtifactReference(artifact),
    evidenceId: evidence.id
  };
  const request: SessionTranscriptRequest = {
    id: "document-one",
    platform: "codex",
    path: evidence.path,
    traceinkRef
  };

  assert.throws(
    () => authorizeSessionTranscriptRequest(request, [], createEmptyNotebookDocument(), store),
    /Session 证据/
  );
  assert.throws(
    () => authorizeSessionTranscriptRequest({
      ...request,
      packageRef: { logicalDate, generationId: "generation", evidenceId: "legacy" }
    }, [], createEmptyNotebookDocument(), store),
    /不能同时/
  );
});

test("Traceink evidence replay refuses a final-component symlink", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "traceink-transcript-link-"));
  try {
    const admitted = "captured traceink transcript\n";
    const target = path.join(directory, "target.jsonl");
    const link = path.join(directory, "session.jsonl");
    await fs.writeFile(target, admitted, "utf8");
    await fs.symlink(target, link);
    const store = storeWithEvidence(sessionEvidence(link, admitted));
    const authorized = authorizeSessionTranscriptRequest(
      traceinkRequest(store, link),
      [],
      createEmptyNotebookDocument(),
      store
    );
    assert.ok(authorized.transcriptCapture);

    await assert.rejects(
      readBoundedTranscriptSource(authorized.readPath, {
        origin: authorized.origin,
        transcriptCapture: authorized.transcriptCapture
      }),
      /符号链接/
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

function sessionEvidence(sourcePath: string, admitted: string): TraceinkEvidenceRefV1 {
  const byteLength = Buffer.byteLength(admitted);
  return {
    id: "session-evidence-one",
    kind: "session",
    provider: "codex",
    sessionId: "session-one",
    path: sourcePath,
    locator: `bytes 0-${byteLength}`,
    contentHash: sha256(admitted)
  };
}

function storeWithEvidence(evidence: TraceinkEvidenceRefV1): TraceinkAssetStoreDocumentV1 {
  return appendTraceinkIndexRevision(createEmptyTraceinkAssetStore(), indexDraft(evidence));
}

function traceinkRequest(store: TraceinkAssetStoreDocumentV1, sourcePath: string): SessionTranscriptRequest {
  const artifact = store.artifacts[0]!;
  return {
    id: "session-one",
    platform: "codex",
    path: sourcePath,
    traceinkRef: {
      logicalDate,
      ...traceinkArtifactReference(artifact),
      evidenceId: "session-evidence-one"
    }
  };
}

function indexDraft(evidence: TraceinkEvidenceRefV1): TraceinkIndexArtifactDraftV1 {
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
        skillHash: sha256("skill"),
        editorialContractHash: sha256("contract")
      }
    },
    inputEvidenceHash: sha256("input"),
    rawMarkdown: "# Traceink index\n",
    coverage: [{ sourceId: evidence.id, disposition: "read", detail: "read in full" }],
    evidence: [evidence],
    navigation: [],
    warnings: []
  };
}
