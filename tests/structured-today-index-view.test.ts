import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StructuredDossier, StructuredTodayIndexView, groupSessionFamilies } from "../app/desktop/structured-today-index-view";
import { TodayIndexProgress } from "../app/desktop/today-board";
import type { StructuredTodayReviewProjection } from "../src/structured-today-review-state";
import {
  canonicalContentHash,
  type TodayWorklineDossierV1,
  type TodayWorklineIndexV1
} from "../src/structured-today-contracts";
import type { AgentWorkSession } from "../src/types";

const HASH = "a".repeat(64);

test("structured Today renders worklines and exact stored Session membership without Markdown parsing", () => {
  const index = indexArtifact();
  const projection: StructuredTodayReviewProjection = {
    mode: "compiled",
    activeIndex: index,
    activeIndexReference: {
      artifactId: index.artifactId,
      revision: index.revision,
      contentHash: index.contentHash
    },
    worklines: [{ workline: index.worklines[0]!, proposalItems: [] }],
    dispositions: index.dispositions,
    uncompiledEvidence: []
  };
  const html = renderToStaticMarkup(createElement(StructuredTodayIndexView, {
    projection,
    progress: { dossierByWorklineId: {} },
    sessions: [session()],
    bookmarkCandidates: [],
    onEvidence() {}
  }));

  assert.match(html, /结构化 Today 后端/);
  assert.match(html, /Session One/);
  assert.match(html, /session-1/);
  assert.match(html, /深入分析这条工作线/);
  assert.match(html, /展开 Session 不会调用模型/);
  assert.match(html, /打开引用 E1：Codex · Session One/);
  assert.doesNotMatch(html, /rawMarkdown|TRACEINK \/ CANONICAL REVIEW/);
});

test("structured Today renders a completed selected dossier and explicit human question", () => {
  const index = indexArtifact();
  const dossier = dossierArtifact(index);
  const projection: StructuredTodayReviewProjection = {
    mode: "compiled",
    activeIndex: index,
    activeIndexReference: {
      artifactId: index.artifactId,
      revision: index.revision,
      contentHash: index.contentHash
    },
    worklines: [{ workline: index.worklines[0]!, dossier, proposalItems: [] }],
    dispositions: index.dispositions,
    uncompiledEvidence: []
  };
  const indexHtml = renderToStaticMarkup(createElement(StructuredTodayIndexView, {
    projection,
    progress: { dossierByWorklineId: {} },
    sessions: [session()],
    bookmarkCandidates: [],
    onEvidence() {}
  }));
  const html = `${indexHtml}${renderToStaticMarkup(createElement(StructuredDossier, { dossier, index, onEvidence() {} }))}`;

  assert.match(html, /打开深入分析/);
  assert.match(html, /EVIDENCE DOSSIER/);
  assert.match(html, /是否把结构化 producer 设为默认路径？/);
  assert.match(html, /尚未采纳/);
  assert.match(html, /打开引用 1：Codex · Session One/);
  assert.match(html, /当前证据精度是完整 Session/);
});

test("structured Today groups child Agent transcripts under their primary Session family", () => {
  const root = session();
  root.lineage = { origin: "primary" };
  const child: AgentWorkSession = {
    ...session(),
    id: "session-child",
    title: "Radar worker",
    path: "/tmp/session-child.jsonl",
    lineage: { origin: "subagent", parentSessionId: "session-1", agentPath: "/root/radar_pipeline" }
  };
  const families = groupSessionFamilies([
    { ref: { sessionId: root.id, provider: "codex", sourcePath: root.path, title: root.title, startedAt: root.updatedAt, evidenceIds: ["e1"], lineage: root.lineage }, current: root },
    { ref: { sessionId: child.id, provider: "codex", sourcePath: child.path, title: child.title, startedAt: child.updatedAt, evidenceIds: ["e2"], lineage: child.lineage }, current: child }
  ], [root, child]);
  assert.equal(families.length, 1);
  assert.equal(families[0]?.members.length, 2);
  assert.equal(families[0]?.subagentCount, 1);
  assert.equal(families[0]?.title, "Session One");
});

test("Today renders first-run index progress independently of an existing structured index", () => {
  const html = renderToStaticMarkup(createElement(TodayIndexProgress, {
    progress: {
      runId: "first-index",
      status: "running",
      stage: "digest",
      completed: 2,
      total: 7
    }
  }));
  assert.match(html, /role="status"/u);
  assert.match(html, /工作脉络整理进度/u);
  assert.match(html, /2\/7/u);
  assert.match(html, /<progress/u);
});

function indexArtifact(): TodayWorklineIndexV1 {
  const withoutHash = {
    schema: "today-workline-index/v1" as const,
    artifactId: "structured-today-index-2026-08-29",
    revision: 1,
    logicalDate: "2026-08-29",
    workflowRunId: "run-1",
    evidenceManifestId: "manifest-1",
    sessions: [{
      sessionId: "session-1",
      provider: "codex" as const,
      sourcePath: "/tmp/session-1.jsonl",
      title: "Session One",
      startedAt: "2026-08-29T01:00:00.000Z",
      endedAt: "2026-08-29T01:10:00.000Z",
      evidenceIds: ["evidence-1"]
    }],
    evidence: [{
      evidenceId: "evidence-1",
      sourceKind: "session" as const,
      provider: "codex" as const,
      sessionId: "session-1",
      sourcePath: "/tmp/session-1.jsonl",
      range: "bytes 0-120",
      contentHash: HASH
    }],
    dispositions: [{
      sessionId: "session-1",
      kind: "assigned" as const,
      worklineIds: ["workline-1"],
      nodeOutputId: "digest-1"
    }],
    worklines: [{
      worklineId: "workline-1",
      title: "结构化 Today 后端",
      summary: "[E1] 结构化数据直接驱动页面。",
      startedAt: "2026-08-29T01:00:00.000Z",
      endedAt: "2026-08-29T01:10:00.000Z",
      currentStop: "等待真实 Provider。",
      possibleChange: "核心导航不再依赖 Markdown。",
      possibleChangeAdopted: false as const,
      participation: { status: "described" as const, human: "确定方向", agent: "完成实现" },
      evidenceReadiness: "ready" as const,
      sessionIds: ["session-1"],
      evidenceIds: ["evidence-1"],
      extensions: []
    }],
    coverage: { admitted: 1, assigned: 1, excluded: 0, failed: 0, unresolved: 0, complete: true },
    provenance: {
      workflowVersion: "structured-today-workflow-spike-v1",
      editorialContract: { packageId: "traceink" as const, version: "fixture", editorialContractHash: HASH },
      modelFunctionVersions: { DigestSession: "fixture" },
      providerInvocations: [{
        invocationId: "digest-1",
        provider: "codex",
        model: "fixture",
        functionName: "DigestSession" as const,
        functionVersion: "fixture"
      }]
    }
  };
  return { ...withoutHash, contentHash: canonicalContentHash(withoutHash) };
}

function dossierArtifact(index: TodayWorklineIndexV1): TodayWorklineDossierV1 {
  const withoutHash = {
    schema: "today-workline-dossier/v1" as const,
    artifactId: "structured-today-dossier-workline-1",
    revision: 1,
    logicalDate: index.logicalDate,
    workflowRunId: "dossier-run",
    sourceIndex: { artifactId: index.artifactId, revision: index.revision, contentHash: index.contentHash },
    worklineId: "workline-1",
    admittedSessionIds: ["session-1"],
    evidence: index.evidence,
    content: {
      title: "结构化证据档案",
      priorContext: "旧路径依赖 Markdown。",
      whatHappened: "结构化 index 已持久化。",
      possibleChange: "导航可以稳定显示。",
      possibleChangeAdopted: false as const,
      supportingEvidence: [{ claim: "Session 已归组。", evidenceIds: ["evidence-1"] }],
      opposingEvidence: [],
      falsifiableObservation: "刷新后 membership 必须一致。",
      gaps: [],
      humanQuestion: "是否把结构化 producer 设为默认路径？",
      evidenceIds: ["evidence-1"],
      extensions: []
    },
    validation: { schema: "passed" as const, evidence: "passed" as const, semantic: "passed" as const, critiqueIssues: [] },
    provenance: index.provenance
  };
  return { ...withoutHash, contentHash: canonicalContentHash(withoutHash) };
}

function session(): AgentWorkSession {
  return {
    id: "session-1",
    platform: "codex",
    title: "Session One",
    summary: "summary",
    path: "/tmp/session-1.jsonl",
    updatedAt: "2026-08-29T01:10:00.000Z",
    artifacts: [],
    status: "active",
    transcriptCapture: {
      canonicalPath: "/tmp/session-1.jsonl",
      sha256: HASH,
      byteLength: 120,
      coverage: { startByte: 0, endByte: 120 }
    }
  };
}
