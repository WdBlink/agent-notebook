import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  normalizeTraceinkArtifactV1,
  type TraceinkArtifactV1,
  type TraceinkIndexArtifactDraftV1
} from "../src/traceink-review-assets";
import {
  activeIndexReferenceForDate,
  appendTraceinkIndexRevision,
  createEmptyTraceinkAssetStore,
  findTraceinkArtifact,
  loadTraceinkAssetStore,
  normalizeTraceinkAssetStore
} from "../app/desktop/traceink-asset-store";

const logicalDate = "2026-08-15";
const hash = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

test("index appends preserve exact Markdown while retaining immutable revisions behind one active pointer", () => {
  const rawMarkdown = "\n# 原样保留\r\n\r\n  尾部空格  \r\n";
  const empty = createEmptyTraceinkAssetStore();
  const first = appendTraceinkIndexRevision(empty, indexDraft(rawMarkdown));
  const firstArtifact = first.artifacts[0];

  assert.deepEqual(empty, { schemaVersion: 1, artifacts: [], reflections: [], activeIndexByDate: {} });
  assert.ok(firstArtifact);
  assert.equal(firstArtifact.rawMarkdown, rawMarkdown);
  assert.equal(firstArtifact.outputHash, hash(rawMarkdown));
  assert.equal(firstArtifact.id, `traceink-index-${logicalDate}`);
  assert.equal(firstArtifact.revision, 1);
  assert.deepEqual(activeIndexReferenceForDate(first, logicalDate), {
    artifactId: `traceink-index-${logicalDate}`,
    stage: "index",
    revision: 1,
    outputHash: hash(rawMarkdown)
  });

  const frozenFirst = structuredClone(firstArtifact);
  const secondMarkdown = `${rawMarkdown}\n新增但不覆盖第一版。\n`;
  const second = appendTraceinkIndexRevision(first, indexDraft(secondMarkdown));

  assert.equal(second.artifacts.length, 2);
  assert.deepEqual(second.artifacts[0], frozenFirst);
  assert.equal(second.artifacts[1]?.id, firstArtifact.id);
  assert.equal(second.artifacts[1]?.revision, 2);
  assert.equal(second.artifacts[1]?.outputHash, hash(secondMarkdown));
  assert.equal(activeIndexReferenceForDate(second, logicalDate)?.revision, 2);
  assert.equal(activeIndexReferenceForDate(first, logicalDate)?.revision, 1);

  const deterministicReplay = appendTraceinkIndexRevision(createEmptyTraceinkAssetStore(), indexDraft(rawMarkdown));
  assert.deepEqual(deterministicReplay, first);
});

test("a rejected append leaves every prior asset and date pointer untouched", () => {
  const firstDate = appendTraceinkIndexRevision(
    createEmptyTraceinkAssetStore(),
    indexDraft("# first date\n")
  );
  const secondDateDraft = {
    ...indexDraft("# second date\n"),
    logicalDate: "2026-08-16"
  } satisfies TraceinkIndexArtifactDraftV1;
  const twoDates = appendTraceinkIndexRevision(firstDate, secondDateDraft);
  const beforeRejectedAppend = JSON.stringify(twoDates);
  const invalidDraft = {
    ...indexDraft("# invalid provenance\n"),
    producer: {
      ...producer(),
      completedAt: "before-the-run-started"
    }
  } satisfies TraceinkIndexArtifactDraftV1;

  assert.throws(
    () => appendTraceinkIndexRevision(twoDates, invalidDraft),
    /integrity validation/
  );
  assert.equal(JSON.stringify(twoDates), beforeRejectedAppend);
  assert.equal(activeIndexReferenceForDate(twoDates, logicalDate)?.revision, 1);
  assert.equal(activeIndexReferenceForDate(twoDates, "2026-08-16")?.revision, 1);
  assert.notEqual(
    activeIndexReferenceForDate(twoDates, logicalDate)?.artifactId,
    activeIndexReferenceForDate(twoDates, "2026-08-16")?.artifactId
  );

  const firstReference = activeIndexReferenceForDate(firstDate, logicalDate)!;
  const refreshedFirstDate = appendTraceinkIndexRevision(
    twoDates,
    indexDraft("# current revision\n"),
    firstReference
  );
  const beforeStaleAppend = JSON.stringify(refreshedFirstDate);
  assert.throws(
    () => appendTraceinkIndexRevision(
      refreshedFirstDate,
      indexDraft("# stale completion\n"),
      firstReference
    ),
    /active index changed/
  );
  assert.equal(JSON.stringify(refreshedFirstDate), beforeStaleAppend);
  assert.equal(activeIndexReferenceForDate(refreshedFirstDate, logicalDate)?.revision, 2);

  const corruptedCurrent = structuredClone(firstDate);
  corruptedCurrent.artifacts[0]!.rawMarkdown += "tampered after load";
  const beforeCorruptAppend = JSON.stringify(corruptedCurrent);
  assert.throws(
    () => appendTraceinkIndexRevision(corruptedCurrent, indexDraft("# must not replace history\n")),
    /store document failed integrity validation/
  );
  assert.equal(JSON.stringify(corruptedCurrent), beforeCorruptAppend);
  assert.equal(activeIndexReferenceForDate(corruptedCurrent, logicalDate), undefined);
  assert.equal(findTraceinkArtifact(corruptedCurrent, firstReference), undefined);
});

test("normalization preserves rawMarkdown when navigation or coverage sidecars are missing or unfamiliar", () => {
  const rawMarkdown = "  unfamiliar heading bytes\r\n\r\n- extension\t\r\n";
  const stored = appendTraceinkIndexRevision(createEmptyTraceinkAssetStore(), indexDraft(rawMarkdown));
  const artifact = stored.artifacts[0]!;
  const serialized = JSON.stringify({
    ...stored,
    artifacts: [{
      ...artifact,
      coverage: undefined,
      navigation: [
        {
          id: "line-a",
          markdownAnchor: "line-a",
          evidenceIds: ["session-a", "invented-evidence"],
          futureObservation: { deliberately: "open" }
        },
        { extensionKind: "future-contract", value: { still: "not semantics" } }
      ]
    }]
  });

  const loaded = loadTraceinkAssetStore(serialized);
  assert.equal(loaded.artifacts[0]?.rawMarkdown, rawMarkdown);
  assert.equal(loaded.artifacts[0]?.outputHash, hash(rawMarkdown));
  assert.deepEqual(loaded.artifacts[0]?.coverage, []);
  assert.deepEqual(loaded.artifacts[0]?.navigation, [{
    id: "line-a",
    markdownAnchor: "line-a",
    evidenceIds: ["session-a"]
  }]);
  assert.match(loaded.artifacts[0]?.warnings.join("\n") ?? "", /coverage sidecar is unavailable/);
  assert.match(loaded.artifacts[0]?.warnings.join("\n") ?? "", /blocked 1 malformed or duplicate navigation/);
  assert.match(loaded.artifacts[0]?.warnings.join("\n") ?? "", /blocked 1 unresolved navigation evidence/);
  assert.deepEqual(activeIndexReferenceForDate(loaded, logicalDate), stored.activeIndexByDate[logicalDate]);
  assert.deepEqual(loadTraceinkAssetStore("not JSON"), createEmptyTraceinkAssetStore());
});

test("malformed producer provenance and active references fail closed without admitting legacy packages", () => {
  const stored = appendTraceinkIndexRevision(createEmptyTraceinkAssetStore(), indexDraft("# index\n"));
  const artifact = stored.artifacts[0]!;
  const malformedProvenance = {
    ...artifact,
    producer: {
      ...artifact.producer,
      skill: { ...artifact.producer.skill, skillHash: "NOT-A-SHA256" }
    }
  };
  const withoutMalformedArtifact = normalizeTraceinkAssetStore({
    ...stored,
    artifacts: [malformedProvenance]
  });
  assert.deepEqual(withoutMalformedArtifact.artifacts, []);
  assert.deepEqual(withoutMalformedArtifact.activeIndexByDate, {});

  for (const scope of [{
    timeZone: "Not/A-Timezone",
    startInclusive: "2026-08-14T16:00:00.000Z",
    endExclusive: "2026-08-15T16:00:00.000Z",
    evidenceCutoff: "2026-08-15T10:00:00.000Z"
  }, {
    timeZone: "Asia/Shanghai",
    startInclusive: "2026-08-13T16:00:00.000Z",
    endExclusive: "2026-08-14T16:00:00.000Z",
    evidenceCutoff: "2026-08-15T10:00:00.000Z"
  }]) {
    assert.deepEqual(normalizeTraceinkAssetStore({
      ...stored,
      artifacts: [{ ...artifact, producer: { ...artifact.producer, scope } }]
    }).artifacts, []);
  }

  const withTamperedMarkdown = normalizeTraceinkAssetStore({
    ...stored,
    artifacts: [{ ...artifact, rawMarkdown: `${artifact.rawMarkdown}tampered` }]
  });
  assert.deepEqual(withTamperedMarkdown.artifacts, []);
  assert.deepEqual(withTamperedMarkdown.activeIndexByDate, {});

  const withDanglingPointer = normalizeTraceinkAssetStore({
    ...stored,
    activeIndexByDate: {
      [logicalDate]: { ...stored.activeIndexByDate[logicalDate], outputHash: "f".repeat(64) }
    }
  });
  assert.equal(withDanglingPointer.artifacts.length, 1);
  assert.equal(activeIndexReferenceForDate(withDanglingPointer, logicalDate), undefined);

  const legacyDailyReviewPackage = {
    schemaVersion: 1,
    id: "legacy-review",
    logicalDate,
    generatedAt: "2026-08-15T18:00:00.000Z",
    evidenceCutoff: "2026-08-15T18:00:00.000Z",
    promptProfile: "traceink-review-v1",
    compilerProvider: "codex",
    model: "legacy-model",
    evidence: [],
    worklines: [],
    warnings: [],
    rawOutput: { worklines: [] }
  };
  assert.equal(normalizeTraceinkArtifactV1(legacyDailyReviewPackage), undefined);
  assert.deepEqual(normalizeTraceinkAssetStore(legacyDailyReviewPackage), createEmptyTraceinkAssetStore());
});

test("one asset identity cannot silently cross stage or logical-date lineages", () => {
  const stored = appendTraceinkIndexRevision(createEmptyTraceinkAssetStore(), indexDraft("# date one\n"));
  const first = stored.artifacts[0]!;
  const otherMarkdown = "# date two under a reused identity\n";
  const conflictingRevision: TraceinkArtifactV1 = {
    ...first,
    logicalDate: "2026-08-16",
    revision: 2,
    rawMarkdown: otherMarkdown,
    outputHash: hash(otherMarkdown)
  };
  const normalized = normalizeTraceinkAssetStore({
    ...stored,
    artifacts: [first, conflictingRevision]
  });

  assert.deepEqual(normalized.artifacts, []);
  assert.deepEqual(normalized.activeIndexByDate, {});
});

test("proposal and reflection references resolve exact immutable revisions or are rejected", () => {
  const dossierMarkdown = "# dossier\n";
  const dossier: TraceinkArtifactV1 = {
    ...baseArtifact("traceink-dossier-workline-a", "dossier", dossierMarkdown),
    worklineId: "workline-a"
  };
  const reflectionText = "  我自己的判断。\r\n";
  const reflection = {
    schemaVersion: 1,
    id: "reflection-workline-a",
    logicalDate,
    worklineId: "workline-a",
    dossier: referenceFor(dossier),
    revision: 1,
    text: reflectionText,
    createdAt: "2026-08-15T19:00:00.000Z",
    savedAt: "2026-08-15T19:01:00.000Z",
    contentHash: hash(reflectionText)
  } as const;
  const proposalMarkdown = `# proposals\r\n${reflectionText}`;
  const proposal: TraceinkArtifactV1 = {
    ...baseArtifact("traceink-proposals-workline-a", "proposals", proposalMarkdown),
    worklineId: "workline-a",
    sourceReflection: {
      reflectionId: reflection.id,
      revision: reflection.revision,
      contentHash: reflection.contentHash
    },
    navigation: [
      {
        id: "proposal-good",
        markdownAnchor: "proposal-good",
        evidenceIds: [],
        category: "judgment",
        sourceQuote: "我自己的判断"
      },
      {
        id: "proposal-invented",
        markdownAnchor: "proposal-invented",
        evidenceIds: [],
        category: "tomorrow",
        sourceQuote: "反思中从未出现的句子"
      },
      {
        id: "proposal-category-only",
        markdownAnchor: "proposal-category-only",
        evidenceIds: [],
        category: "ctx"
      } as TraceinkArtifactV1["navigation"][number],
      {
        id: "proposal-quote-only",
        markdownAnchor: "proposal-quote-only",
        evidenceIds: [],
        sourceQuote: "我自己的判断"
      } as TraceinkArtifactV1["navigation"][number]
    ]
  };
  const valid = normalizeTraceinkAssetStore({
    schemaVersion: 1,
    artifacts: [dossier, proposal],
    reflections: [reflection],
    activeIndexByDate: {}
  });

  assert.equal(valid.reflections[0]?.text, reflectionText);
  assert.deepEqual(valid.artifacts.map((item) => item.stage), ["dossier", "proposals"]);
  assert.deepEqual(valid.artifacts[1]?.navigation.map((item) => item.id), ["proposal-good"]);
  assert.match(valid.artifacts[1]?.warnings.join("\n") ?? "", /blocked 2 malformed or duplicate navigation/);
  assert.match(valid.artifacts[1]?.warnings.join("\n") ?? "", /proposal source quote/);

  const missingReflectionMarkdown = "# proposals without original reflection\n";
  const missingVerbatimReflection = normalizeTraceinkAssetStore({
    schemaVersion: 1,
    artifacts: [dossier, {
      ...proposal,
      rawMarkdown: missingReflectionMarkdown,
      outputHash: hash(missingReflectionMarkdown),
      navigation: proposal.navigation.slice(0, 1)
    }],
    reflections: [reflection],
    activeIndexByDate: {}
  });
  assert.equal(missingVerbatimReflection.artifacts[1]?.rawMarkdown, missingReflectionMarkdown);
  assert.match(missingVerbatimReflection.artifacts[1]?.warnings.join("\n") ?? "", /does not reproduce the saved reflection verbatim/);

  const malformed = normalizeTraceinkAssetStore({
    schemaVersion: 1,
    artifacts: [dossier, {
      ...proposal,
      sourceReflection: { ...proposal.sourceReflection!, revision: 2 }
    }],
    reflections: [{ ...reflection, dossier: { ...reflection.dossier, outputHash: "0".repeat(64) } }],
    activeIndexByDate: {}
  });
  assert.deepEqual(malformed.reflections, []);
  assert.deepEqual(malformed.artifacts.map((item) => item.stage), ["dossier"]);

  const dossierB: TraceinkArtifactV1 = {
    ...baseArtifact("traceink-dossier-workline-b", "dossier", "# dossier b\n"),
    worklineId: "workline-b"
  };
  const secondReflectionText = "另一个工作线上的判断。";
  const conflictingReflectionLineage = normalizeTraceinkAssetStore({
    schemaVersion: 1,
    artifacts: [dossier, dossierB],
    reflections: [reflection, {
      ...reflection,
      revision: 2,
      worklineId: "workline-b",
      dossier: referenceFor(dossierB),
      text: secondReflectionText,
      contentHash: hash(secondReflectionText)
    }],
    activeIndexByDate: {}
  });
  assert.deepEqual(conflictingReflectionLineage.reflections, []);
});

function indexDraft(rawMarkdown: string): TraceinkIndexArtifactDraftV1 {
  return {
    schemaVersion: 1,
    logicalDate,
    stage: "index",
    producer: producer(),
    inputEvidenceHash: "1".repeat(64),
    rawMarkdown,
    coverage: [{ sourceId: "session-a", disposition: "read", detail: "read in full" }],
    evidence: [{
      id: "session-a",
      kind: "session",
      provider: "codex",
      sessionId: "018f-full-session-id",
      path: "/tmp/session-a.jsonl",
      locator: "messages 1-4",
      contentHash: "2".repeat(64)
    }],
    navigation: [{ id: "line-a", markdownAnchor: "line-a", evidenceIds: ["session-a"] }],
    warnings: []
  };
}

function baseArtifact(id: string, stage: TraceinkArtifactV1["stage"], rawMarkdown: string): TraceinkArtifactV1 {
  return {
    schemaVersion: 1,
    id,
    logicalDate,
    stage,
    revision: 1,
    producer: producer(),
    inputEvidenceHash: "1".repeat(64),
    rawMarkdown,
    outputHash: hash(rawMarkdown),
    coverage: [],
    evidence: [],
    navigation: [],
    warnings: []
  };
}

function producer(): TraceinkArtifactV1["producer"] {
  return {
    provider: "codex",
    model: "gpt-5",
    reasoningConfiguration: "high",
    startedAt: "2026-08-15T18:00:00.000Z",
    completedAt: "2026-08-15T18:01:00.000Z",
    skill: {
      packageId: "traceink",
      version: "traceink-skill-bundle-v1",
      skillHash: "3".repeat(64),
      editorialContractHash: "4".repeat(64)
    }
  };
}

function referenceFor(artifact: TraceinkArtifactV1): {
  artifactId: string;
  stage: TraceinkArtifactV1["stage"];
  revision: number;
  outputHash: string;
} {
  return {
    artifactId: artifact.id,
    stage: artifact.stage,
    revision: artifact.revision,
    outputHash: artifact.outputHash
  };
}
