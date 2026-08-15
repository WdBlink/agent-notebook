import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { authorizeSessionTranscriptRequest } from "../app/desktop/session-transcript-access";
import { readBoundedTranscriptSource } from "../app/desktop/transcript-source-reader";
import { composeDailyPage, createEmptyNotebookDocument, sealDailyPage } from "../app/desktop/notebook-store";
import type { SessionTranscriptRequest } from "../app/desktop/api";
import type { AgentWorkSession } from "../src/types";
import type { DailyReviewPackage } from "../src/workline-review";
import {
  activeIndexReferenceForDate,
  appendTraceinkDossierRevision,
  appendTraceinkIndexRevision,
  appendTraceinkProposalsRevision,
  appendTraceinkReflectionRevision,
  createEmptyTraceinkAssetStore,
  type TraceinkAssetStoreDocumentV1
} from "../app/desktop/traceink-asset-store";
import {
  traceinkArtifactReference,
  userReflectionAssetReference,
  type TraceinkArtifactV1,
  type TraceinkDossierArtifactDraftV1,
  type TraceinkEvidenceRefV1,
  type TraceinkIndexArtifactDraftV1,
  type TraceinkProposalCategoryV1,
  type TraceinkProposalsArtifactV1
} from "../src/traceink-review-assets";

const logicalDate = "2026-08-09";
const historical: AgentWorkSession = {
  id: "historical-session",
  platform: "claude",
  title: "历史会话",
  summary: "封页后仍能由包内证据安全重开。",
  path: "/archive/historical-session.jsonl",
  updatedAt: "2026-08-09T10:00:00.000Z",
  artifacts: [],
  status: "completed"
};

test("current snapshot tuple is authorized without a package reference", () => {
  const request: SessionTranscriptRequest = { id: historical.id, platform: historical.platform, path: historical.path };

  const authorized = authorizeSessionTranscriptRequest(request, [historical], createEmptyNotebookDocument());

  assert.deepEqual(authorized, {
    id: historical.id,
    platform: historical.platform,
    path: historical.path,
    readPath: historical.path,
    title: historical.title,
    origin: "current-snapshot"
  });
});

test("current snapshot authorization carries the scanner capture into the bounded reader", () => {
  const transcriptCapture = {
    canonicalPath: historical.path,
    sha256: "a".repeat(64),
    byteLength: 42,
    coverage: { startByte: 0, endByte: 42 }
  };
  const captured = { ...historical, transcriptCapture };

  const authorized = authorizeSessionTranscriptRequest(
    { id: captured.id, platform: captured.platform, path: captured.path },
    [captured],
    createEmptyNotebookDocument()
  );

  assert.deepEqual(authorized.transcriptCapture, transcriptCapture);
  assert.equal(authorized.readPath, transcriptCapture.canonicalPath);
});

test("Today Traceink references reject old index, dossier, and proposals after active index rotation", () => {
  const evidence = traceinkSessionEvidence();
  const lineage = traceinkStoreWithFullLineage(evidence);
  const beforeRotation = lineage.store;
  const activeBefore = activeIndexReferenceForDate(beforeRotation, "2026-08-15");
  assert.ok(activeBefore);
  const index = beforeRotation.artifacts.find((artifact) => artifact.stage === "index");
  const dossier = beforeRotation.artifacts.find((artifact) => artifact.stage === "dossier");
  const proposals = beforeRotation.artifacts.find((artifact) => artifact.stage === "proposals");
  assert.ok(index && dossier && proposals);

  for (const artifact of [index, dossier, proposals]) {
    const authorized = authorizeSessionTranscriptRequest(
      traceinkEvidenceRequest(artifact, evidence),
      [],
      createEmptyNotebookDocument(),
      beforeRotation
    );
    assert.equal(authorized.origin, "traceink-asset");
  }

  const withNewerDossierRevision = appendTraceinkDossierRevision(
    beforeRotation,
    traceinkDossierDraft(evidence),
    activeBefore
  );
  for (const artifact of [dossier, proposals]) {
    assert.throws(
      () => authorizeSessionTranscriptRequest(
        traceinkEvidenceRequest(artifact, evidence),
        [],
        createEmptyNotebookDocument(),
        withNewerDossierRevision
      ),
      /当前|Traceink|工作脉络|旧|拒绝/
    );
  }

  const withNewerReflection = appendTraceinkReflectionRevision(
    beforeRotation,
    { ...traceinkArtifactReference(dossier), stage: "dossier" },
    "我的第二版回顾",
    "2026-08-15T10:20:00.000Z"
  );
  assert.throws(
    () => authorizeSessionTranscriptRequest(
      traceinkEvidenceRequest(proposals, evidence),
      [],
      createEmptyNotebookDocument(),
      withNewerReflection
    ),
    /当前|Traceink|工作脉络|旧|拒绝/
  );

  const reflection = beforeRotation.reflections[0]!;
  const proposalsV1 = proposals as TraceinkProposalsArtifactV1;
  const { id: _proposalId, revision: _proposalRevision, outputHash: _proposalHash, ...proposalsV2Draft } = proposalsV1;
  proposalsV2Draft.rawMarkdown += "\nproposal revision two";
  const withNewerProposals = appendTraceinkProposalsRevision(
    beforeRotation,
    proposalsV2Draft,
    userReflectionAssetReference(reflection),
    { ...traceinkArtifactReference(proposalsV1), stage: "proposals" }
  );
  const proposalsV2 = withNewerProposals.artifacts
    .filter((artifact) => artifact.id === proposalsV1.id && artifact.stage === "proposals")
    .sort((left, right) => right.revision - left.revision)[0]!;
  assert.throws(
    () => authorizeSessionTranscriptRequest(
      traceinkEvidenceRequest(proposalsV1, evidence),
      [],
      createEmptyNotebookDocument(),
      withNewerProposals
    ),
    /当前|Traceink|工作脉络|旧|拒绝/
  );
  assert.equal(authorizeSessionTranscriptRequest(
    traceinkEvidenceRequest(proposalsV2, evidence),
    [],
    createEmptyNotebookDocument(),
    withNewerProposals
  ).origin, "traceink-asset");

  const rotated = appendTraceinkIndexRevision(
    beforeRotation,
    traceinkIndexDraft(evidence, "# current index revision 2\n"),
    activeBefore
  );
  for (const artifact of [index, dossier, proposals]) {
    assert.throws(
      () => authorizeSessionTranscriptRequest(
        traceinkEvidenceRequest(artifact, evidence),
        [],
        createEmptyNotebookDocument(),
        rotated
      ),
      /当前|Traceink|工作脉络|旧|拒绝/
    );
  }
});

test("captured evidence authorizes sealed replay through its canonical read path and byte range", () => {
  const capturedPackage = reviewPackage();
  capturedPackage.evidence[0]!.transcriptCapture = {
    canonicalPath: historical.path,
    sha256: "7eb259ab4a8d18e582fe130bbe7c5eab409a7aad12f157fd63130c3c7d3b648d",
    byteLength: 20,
    coverage: { startByte: 0, endByte: 20 }
  };
  const document = composeDailyPage(
    createEmptyNotebookDocument(),
    logicalDate,
    [historical],
    new Date("2026-08-09T18:00:00.000Z"),
    capturedPackage
  );
  const generationId = document.pages[logicalDate]?.activePackageGenerationId ?? "";
  const sealed = sealDailyPage(
    document,
    logicalDate,
    { reflection: "历史判断", bookmarkIds: [], expectedActiveGenerationId: generationId },
    [],
    new Date("2026-08-09T18:05:00.000Z")
  );

  const authorized = authorizeSessionTranscriptRequest({
    id: historical.id,
    platform: historical.platform,
    path: historical.path,
    packageRef: { logicalDate, generationId, evidenceId: "session:claude:historical-session" }
  }, [], sealed) as ReturnType<typeof authorizeSessionTranscriptRequest> & {
    readPath?: string;
    transcriptCapture?: NonNullable<DailyReviewPackage["evidence"][number]["transcriptCapture"]>;
  };

  assert.equal(authorized.path, historical.path);
  assert.equal(authorized.readPath, historical.path);
  assert.deepEqual(authorized.transcriptCapture, capturedPackage.evidence[0]!.transcriptCapture);
  assert.equal(authorized.evidenceUpdatedAt, undefined);
});

test("a draft captured package reopens its admitted prefix instead of the appended current snapshot", () => {
  const capturedPackage = reviewPackage();
  capturedPackage.evidence[0]!.transcriptCapture = {
    canonicalPath: historical.path,
    sha256: "7eb259ab4a8d18e582fe130bbe7c5eab409a7aad12f157fd63130c3c7d3b648d",
    byteLength: 20,
    coverage: { startByte: 0, endByte: 20 }
  };
  const document = composeDailyPage(
    createEmptyNotebookDocument(),
    logicalDate,
    [historical],
    new Date("2026-08-09T18:00:00.000Z"),
    capturedPackage
  );
  const generationId = document.pages[logicalDate]?.activePackageGenerationId ?? "";

  const authorized = authorizeSessionTranscriptRequest({
    id: historical.id,
    platform: historical.platform,
    path: historical.path,
    packageRef: { logicalDate, generationId, evidenceId: "session:claude:historical-session" }
  }, [{ ...historical, updatedAt: "2026-08-09T11:00:00.000Z" }], document);

  assert.equal(authorized.origin, "sealed-package");
  assert.equal(authorized.readPath, historical.path);
  assert.deepEqual(authorized.transcriptCapture, capturedPackage.evidence[0]!.transcriptCapture);
  assert.equal(authorized.evidenceUpdatedAt, undefined);
});

test("draft package authorization and reader exclude bytes appended after compile", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "draft-package-prefix-"));
  try {
    const sourcePath = path.join(temp, "historical-session.jsonl");
    await fs.writeFile(sourcePath, "captured transcript\nAPPENDED_SECRET\n", "utf8");
    const canonicalPath = await fs.realpath(sourcePath);
    const currentSession: AgentWorkSession = { ...historical, path: canonicalPath };
    const capturedPackage = reviewPackage();
    capturedPackage.evidence[0] = {
      ...capturedPackage.evidence[0]!,
      path: canonicalPath,
      transcriptCapture: {
        canonicalPath,
        sha256: "7eb259ab4a8d18e582fe130bbe7c5eab409a7aad12f157fd63130c3c7d3b648d",
        byteLength: 20,
        coverage: { startByte: 0, endByte: 20 }
      }
    };
    const document = composeDailyPage(
      createEmptyNotebookDocument(),
      logicalDate,
      [currentSession],
      new Date("2026-08-09T18:00:00.000Z"),
      capturedPackage
    );
    const generationId = document.pages[logicalDate]?.activePackageGenerationId ?? "";
    const authorized = authorizeSessionTranscriptRequest({
      id: historical.id,
      platform: historical.platform,
      path: canonicalPath,
      packageRef: { logicalDate, generationId, evidenceId: "session:claude:historical-session" }
    }, [{ ...currentSession, updatedAt: "2026-08-09T11:00:00.000Z" }], document);
    assert.ok(authorized.transcriptCapture);

    const source = await readBoundedTranscriptSource(authorized.readPath, {
      origin: authorized.origin,
      transcriptCapture: authorized.transcriptCapture
    });

    assert.equal(source.content, "captured transcript\n");
    assert.equal(source.content.includes("APPENDED_SECRET"), false);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test("exact evidence in the active historical package authorizes transcript reopening", () => {
  const document = composeDailyPage(
    createEmptyNotebookDocument(),
    logicalDate,
    [historical],
    new Date("2026-08-09T18:00:00.000Z"),
    reviewPackage()
  );
  const generation = document.pages[logicalDate]?.packageGenerations?.[0];
  assert.ok(generation);
  const sealed = sealDailyPage(
    document,
    logicalDate,
    { reflection: "历史判断", bookmarkIds: [], expectedActiveGenerationId: generation.id },
    [],
    new Date("2026-08-09T18:05:00.000Z")
  );
  const request: SessionTranscriptRequest = {
    id: historical.id,
    platform: historical.platform,
    path: historical.path,
    packageRef: {
      logicalDate,
      generationId: generation.id,
      evidenceId: "session:claude:historical-session"
    }
  };

  const authorized = authorizeSessionTranscriptRequest(request, [], sealed);

  assert.deepEqual(authorized, {
    id: historical.id,
    platform: historical.platform,
    path: historical.path,
    readPath: historical.path,
    title: historical.title,
    origin: "sealed-package",
    evidenceUpdatedAt: historical.updatedAt
  });
});

test("package references force sealed-package authorization even when the Session is still in the current snapshot", () => {
  const document = composeDailyPage(
    createEmptyNotebookDocument(),
    logicalDate,
    [historical],
    new Date("2026-08-09T18:00:00.000Z"),
    reviewPackage()
  );
  const generationId = document.pages[logicalDate]?.activePackageGenerationId ?? "";
  const sealed = sealDailyPage(
    document,
    logicalDate,
    { reflection: "历史判断", bookmarkIds: [], expectedActiveGenerationId: generationId },
    [],
    new Date("2026-08-09T18:05:00.000Z")
  );

  const authorized = authorizeSessionTranscriptRequest({
    id: historical.id,
    platform: historical.platform,
    path: historical.path,
    packageRef: {
      logicalDate,
      generationId,
      evidenceId: "session:claude:historical-session"
    }
  }, [historical], sealed);

  assert.equal(authorized.origin, "sealed-package");
  assert.equal(authorized.evidenceUpdatedAt, historical.updatedAt);
});

test("an exact active draft package reference may reopen only the same current snapshot Session", () => {
  const document = composeDailyPage(
    createEmptyNotebookDocument(),
    logicalDate,
    [historical],
    new Date("2026-08-09T18:00:00.000Z"),
    reviewPackage()
  );
  const generationId = document.pages[logicalDate]?.activePackageGenerationId ?? "";
  const request: SessionTranscriptRequest = {
    id: historical.id,
    platform: historical.platform,
    path: historical.path,
    packageRef: { logicalDate, generationId, evidenceId: "session:claude:historical-session" }
  };

  const authorized = authorizeSessionTranscriptRequest(request, [historical], document);

  assert.equal(authorized.origin, "current-snapshot");
  assert.throws(
    () => authorizeSessionTranscriptRequest({
      ...request,
      packageRef: { ...request.packageRef!, evidenceId: "session:tampered" }
    }, [historical], document),
    /没有找到这条会话证据/
  );
});

test("a draft package cannot authorize historical transcript fallback", () => {
  const document = composeDailyPage(
    createEmptyNotebookDocument(),
    logicalDate,
    [historical],
    new Date("2026-08-09T18:00:00.000Z"),
    reviewPackage()
  );
  const generationId = document.pages[logicalDate]?.activePackageGenerationId ?? "";

  assert.throws(() => authorizeSessionTranscriptRequest({
    id: historical.id,
    platform: historical.platform,
    path: historical.path,
    packageRef: { logicalDate, generationId, evidenceId: "session:claude:historical-session" }
  }, [], document), /尚未封页/);
});

test("historical authorization rejects a tampered path, generation, or evidence id", () => {
  const document = composeDailyPage(
    createEmptyNotebookDocument(),
    logicalDate,
    [historical],
    new Date("2026-08-09T18:00:00.000Z"),
    reviewPackage()
  );
  const generationId = document.pages[logicalDate]?.activePackageGenerationId ?? "";
  const sealed = sealDailyPage(
    document,
    logicalDate,
    { reflection: "历史判断", bookmarkIds: [], expectedActiveGenerationId: generationId },
    [],
    new Date("2026-08-09T18:05:00.000Z")
  );
  const base: SessionTranscriptRequest = {
    id: historical.id,
    platform: historical.platform,
    path: historical.path,
    packageRef: { logicalDate, generationId, evidenceId: "session:claude:historical-session" }
  };

  assert.throws(
    () => authorizeSessionTranscriptRequest({ ...base, path: "/tmp/tampered.jsonl" }, [], sealed),
    /不匹配/
  );
  assert.throws(
    () => authorizeSessionTranscriptRequest({ ...base, packageRef: { ...base.packageRef!, generationId: "generation-tampered" } }, [], sealed),
    /不是当前封存证据包/
  );
  assert.throws(
    () => authorizeSessionTranscriptRequest({ ...base, packageRef: { ...base.packageRef!, evidenceId: "artifact:claude:historical-session:0" } }, [], sealed),
    /没有找到这条会话证据/
  );
});

function reviewPackage(): DailyReviewPackage {
  return {
    schemaVersion: 1,
    id: "historical-package",
    logicalDate,
    generatedAt: "2026-08-09T18:00:00.000Z",
    evidenceCutoff: "2026-08-09T18:00:00.000Z",
    promptProfile: "traceink-review-v1",
    compilerProvider: "codex",
    model: "review-model",
    evidence: [{
      id: "session:claude:historical-session",
      kind: "session",
      label: historical.title,
      path: historical.path,
      platform: historical.platform,
      sessionId: historical.id,
      updatedAt: historical.updatedAt
    }],
    worklines: [{
      id: "historical-workline",
      title: "历史工作线",
      summary: "证据仍可追溯。",
      status: "complete",
      sourceSessionIds: ["claude:historical-session"],
      participation: [{ id: "agent-1", kind: "agent", label: "Agent 处理" }],
      dossier: {
        title: "历史工作线",
        dek: "封存材料。",
        blocks: [{
          id: "evidence",
          kind: "evidence-change",
          title: "已形成证据",
          body: "历史会话已进入封存包。",
          evidenceIds: ["session:claude:historical-session"],
          payload: {}
        }, {
          id: "future",
          kind: "future-observation",
          title: "未来观察",
          body: "未来可以重新核对原文。",
          evidenceIds: ["session:claude:historical-session"],
          payload: {}
        }],
        question: { prompt: "这份历史证据是否仍支持当时的判断？" }
      },
      payload: {}
    }],
    warnings: [],
    rawOutput: { worklines: [{ id: "historical-workline" }] }
  };
}

const traceinkHash = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

function traceinkSessionEvidence(): TraceinkEvidenceRefV1 {
  const content = "frozen current Traceink evidence\n";
  return {
    id: "current-session-evidence",
    kind: "session",
    provider: "codex",
    sessionId: "traceink-session",
    path: "/tmp/traceink-current-session.jsonl",
    locator: `bytes 0-${Buffer.byteLength(content)}`,
    contentHash: traceinkHash(content)
  };
}

function traceinkIndexDraft(evidence: TraceinkEvidenceRefV1, rawMarkdown = "# index revision 1\n"): TraceinkIndexArtifactDraftV1 {
  return {
    schemaVersion: 1,
    logicalDate: "2026-08-15",
    stage: "index",
    producer: {
      provider: "codex",
      model: "gpt-5.6-sol",
      startedAt: "2026-08-15T10:00:00.000Z",
      completedAt: "2026-08-15T10:05:00.000Z",
      skill: {
        packageId: "traceink",
        version: "traceink-skill-bundle-v1",
        skillHash: traceinkHash("skill"),
        editorialContractHash: traceinkHash("contract")
      }
    },
    inputEvidenceHash: traceinkHash("input"),
    rawMarkdown,
    coverage: [{ sourceId: evidence.id, disposition: "read", detail: "frozen" }],
    evidence: [evidence],
    navigation: [{ id: "workline-one", markdownAnchor: "workline-one", evidenceIds: [evidence.id] }],
    warnings: []
  };
}

function traceinkStoreWithFullLineage(evidence: TraceinkEvidenceRefV1): { store: TraceinkAssetStoreDocumentV1 } {
  let store = appendTraceinkIndexRevision(createEmptyTraceinkAssetStore(), traceinkIndexDraft(evidence));
  const active = activeIndexReferenceForDate(store, "2026-08-15");
  assert.ok(active);
  store = appendTraceinkDossierRevision(store, traceinkDossierDraft(evidence), active);
  const dossier = store.artifacts.find((artifact) => artifact.stage === "dossier");
  assert.ok(dossier);
  store = appendTraceinkReflectionRevision(
    store,
    { ...traceinkArtifactReference(dossier), stage: "dossier" },
    "我的原始回顾",
    "2026-08-15T10:10:00.000Z"
  );
  const reflection = store.reflections[0];
  assert.ok(reflection);
  const proposalDefinitions: Array<{ id: string; category: TraceinkProposalCategoryV1; text: string }> = [
    { id: "J1", category: "judgment", text: "形成判断候选" },
    { id: "T1", category: "tomorrow", text: "明日候选" },
    { id: "C1", category: "ctx", text: "CTX 候选" },
    { id: "B1", category: "background", text: "后台候选" },
    { id: "D1", category: "today-only", text: "只留今天" }
  ];
  const proposalsMarkdown = ["# proposals", reflection.text, ...proposalDefinitions.map((item) => item.text)].join("\n");
  store = appendTraceinkProposalsRevision(store, {
    schemaVersion: 1,
    logicalDate: "2026-08-15",
    stage: "proposals",
    worklineId: "workline-one",
    sourceReflection: userReflectionAssetReference(reflection),
    producer: { ...traceinkIndexDraft(evidence).producer },
    inputEvidenceHash: traceinkHash("proposal-input"),
    rawMarkdown: proposalsMarkdown,
    coverage: [{ sourceId: evidence.id, disposition: "read", detail: "frozen" }],
    evidence: [evidence],
    navigation: proposalDefinitions.map((item) => ({
      id: item.id,
      markdownAnchor: item.id,
      evidenceIds: [evidence.id],
      category: item.category,
      proposalText: item.text,
      sourceQuote: reflection.text
    })),
    warnings: []
  }, userReflectionAssetReference(reflection), null);
  return { store };
}

function traceinkDossierDraft(evidence: TraceinkEvidenceRefV1): TraceinkDossierArtifactDraftV1 {
  return {
    schemaVersion: 1 as const,
    logicalDate: "2026-08-15",
    stage: "dossier" as const,
    worklineId: "workline-one",
    producer: { ...traceinkIndexDraft(evidence).producer },
    inputEvidenceHash: traceinkHash("dossier-input"),
    rawMarkdown: "# dossier\n",
    coverage: [{ sourceId: evidence.id, disposition: "read", detail: "frozen" }],
    evidence: [evidence],
    navigation: [{ id: "E1", markdownAnchor: "evidence", evidenceIds: [evidence.id] }],
    warnings: []
  };
}

function traceinkEvidenceRequest(artifact: TraceinkArtifactV1, evidence: TraceinkEvidenceRefV1): SessionTranscriptRequest {
  return {
    id: evidence.sessionId!,
    platform: evidence.provider!,
    path: evidence.path,
    traceinkRef: {
      logicalDate: artifact.logicalDate,
      ...traceinkArtifactReference(artifact),
      evidenceId: evidence.id
    }
  };
}
