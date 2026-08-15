import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  appendTraceinkDossierRevision,
  appendTraceinkIndexRevision,
  appendTraceinkReflectionRevision,
  createEmptyTraceinkAssetStore,
  activeIndexReferenceForDate,
  latestTraceinkDossier,
  latestTraceinkReflection
} from "../app/desktop/traceink-asset-store";
import { traceinkWorklineSelections } from "../src/traceink-index-navigation";
import { sha256TraceinkText, type TraceinkDossierArtifactDraftV1, type TraceinkIndexArtifactDraftV1 } from "../src/traceink-review-assets";

test("golden index exposes stable workline navigation without rewriting Markdown", async () => {
  const rawMarkdown = await readFile("tests/skill-fixtures/traceink-golden/full-day-index.md", "utf8");
  const store = appendTraceinkIndexRevision(createEmptyTraceinkAssetStore(), indexDraft(rawMarkdown));
  const index = store.artifacts[0]!;
  assert.equal(index.rawMarkdown, rawMarkdown);
  assert.deepEqual(traceinkWorklineSelections(index as never).map(({ ordinal, title }) => ({ ordinal, title })), [
    { ordinal: 1, title: "从 scheduler 吞吐实验转向 Research IR 表示假设" },
    { ordinal: 2, title: "0.6.0 双架构安装包的发布前边界检查" }
  ]);
});

test("dossier cache is pinned to one exact index and reflection reloads user bytes exactly", () => {
  const first = appendTraceinkIndexRevision(createEmptyTraceinkAssetStore(), indexDraft("1. **第一条工作线**\n"));
  const firstRef = activeIndexReferenceForDate(first, "2026-08-15")!;
  const selection = traceinkWorklineSelections(first.artifacts[0] as never)[0]!;
  const withDossier = appendTraceinkDossierRevision(first, dossierDraft(selection.worklineId), firstRef);
  const dossier = latestTraceinkDossier(withDossier, firstRef, selection.worklineId)!;
  const userText = "  我认为方向值得继续，但还不能宣布已经采用。\r\n保留这个换行。  ";
  const withReflection = appendTraceinkReflectionRevision(
    withDossier,
    { artifactId: dossier.id, stage: "dossier", revision: dossier.revision, outputHash: dossier.outputHash },
    userText,
    "2026-08-15T12:00:00.000Z"
  );
  assert.equal(latestTraceinkReflection(withReflection, dossier)?.text, userText);

  const refreshed = appendTraceinkIndexRevision(withReflection, indexDraft("1. **第一条工作线（新证据）**\n"), firstRef);
  const secondRef = activeIndexReferenceForDate(refreshed, "2026-08-15")!;
  const nextSelection = traceinkWorklineSelections(refreshed.artifacts.at(-1) as never)[0]!;
  assert.equal(latestTraceinkDossier(refreshed, secondRef, nextSelection.worklineId), undefined);
  assert.equal(refreshed.reflections[0]?.text, userText);
});

function indexDraft(rawMarkdown: string): TraceinkIndexArtifactDraftV1 {
  return {
    schemaVersion: 1,
    logicalDate: "2026-08-15",
    stage: "index",
    producer: producer(),
    inputEvidenceHash: "1".repeat(64),
    rawMarkdown,
    coverage: [], evidence: [], navigation: [], warnings: []
  };
}

function dossierDraft(worklineId: string): TraceinkDossierArtifactDraftV1 {
  const rawMarkdown = "## 证据档案\n\n仍需你判断：是否继续？\n";
  return {
    schemaVersion: 1,
    logicalDate: "2026-08-15",
    stage: "dossier",
    worklineId,
    producer: producer(),
    inputEvidenceHash: sha256TraceinkText(worklineId),
    rawMarkdown,
    coverage: [], evidence: [], navigation: [], warnings: []
  };
}

function producer() {
  return {
    provider: "codex" as const,
    model: "gpt-5.6-sol",
    reasoningConfiguration: "ultra",
    startedAt: "2026-08-15T10:00:00.000Z",
    completedAt: "2026-08-15T10:01:00.000Z",
    skill: { packageId: "traceink" as const, version: "traceink-skill-bundle-v1", skillHash: "3".repeat(64), editorialContractHash: "4".repeat(64) }
  };
}
