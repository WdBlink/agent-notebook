import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  STRUCTURED_TODAY_DOSSIER_V2_SCHEMA,
  STRUCTURED_TODAY_INDEX_V2_SCHEMA,
  TodayWorklineDossierV2Schema,
  TodayWorklineIndexV2Schema,
  parseTodayWorklineDossierArtifact,
  parseTodayWorklineIndexArtifact,
  validateTodayWorklineDossierArtifact,
  validateTodayWorklineDossierV2,
  validateTodayWorklineIndexArtifact,
  validateTodayWorklineIndexV2
} from "../src/structured-today-v2-contracts";
import {
  STRUCTURED_TODAY_DOSSIER_SCHEMA,
  STRUCTURED_TODAY_INDEX_SCHEMA,
  canonicalContentHash
} from "../src/structured-today-contracts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const MESSAGE_KEY = `msg-v2-${"1".repeat(64)}`;
const LOCATOR_ID = `locator-v2-${"2".repeat(64)}`;
const SPAN_ID = `span-v2-${"3".repeat(64)}`;
const SECOND_SPAN_ID = `span-v2-${"8".repeat(64)}`;
const QUOTE = "Agent completed the implementation.";

test("strict V2 index and dossier contracts accept one closed evidence graph", () => {
  const index = v2Index();
  const dossier = v2Dossier(index);

  assert.equal(TodayWorklineIndexV2Schema.parse(index).schema, STRUCTURED_TODAY_INDEX_V2_SCHEMA);
  assert.equal(TodayWorklineDossierV2Schema.parse(dossier).schema, STRUCTURED_TODAY_DOSSIER_V2_SCHEMA);
  assert.deepEqual(validateTodayWorklineIndexV2(index), []);
  assert.deepEqual(validateTodayWorklineDossierV2(dossier), []);
});

test("V2 permits an all-unresolved artifact without locators or spans", () => {
  const index = unresolvedIndex();
  const dossier = unresolvedDossier(index);

  assert.deepEqual(index.messageLocators, []);
  assert.deepEqual(index.spans, []);
  assert.deepEqual(validateTodayWorklineIndexV2(index), []);
  assert.deepEqual(validateTodayWorklineDossierV2(dossier), []);
});

test("V2 artifact validation rejects orphan locators, spans, and findings", () => {
  const orphanLocator = {
    ...messageLocator(),
    messageKey: `msg-v2-${"4".repeat(64)}`,
    messageLocatorId: `locator-v2-${"5".repeat(64)}`
  };
  const orphanSpan = {
    ...span(),
    spanId: `span-v2-${"6".repeat(64)}`,
    textQuote: { exact: "orphan quote" },
    textPosition: { unit: "unicode-code-point" as const, start: 1, end: 13 },
    quoteHash: sha256("orphan quote")
  };
  const orphanFinding = {
    findingId: "finding-orphan",
    text: "Unused finding.",
    claimKind: "fact" as const,
    relation: "source-span" as const,
    spanIds: [SPAN_ID]
  };
  const base = v2Index();
  const value = rehash({
    ...withoutHash(base),
    messageLocators: [...base.messageLocators, orphanLocator],
    spans: [...base.spans, orphanSpan],
    findings: [...base.findings, orphanFinding]
  });

  const issues = validateTodayWorklineIndexV2(value).join("\n");
  assert.match(issues, /Message locator .* is orphaned/u);
  assert.match(issues, /Span .* is orphaned/u);
  assert.match(issues, /Finding finding-orphan is orphaned/u);
});

test("source-span statements resolve only through same-artifact source findings and spans", () => {
  const base = v2Index();
  const forgedHumanClaim = {
    ...withoutHash(base),
    findings: base.findings.map((finding, index) => index === 0
      ? { ...finding, claimKind: "human-adoption" as const }
      : finding)
  };
  assert.match(
    validateTodayWorklineIndexV2(rehash(forgedHumanClaim)).join("\n"),
    /human-adoption requires a host-classified human-authored span/u
  );

  const nonSourceFinding = {
    ...base.findings[0]!,
    relation: "inference-basis" as const
  };
  const badRelation = rehash({ ...withoutHash(base), findings: [nonSourceFinding] });
  assert.match(
    validateTodayWorklineIndexV2(badRelation).join("\n"),
    /relation source-span cannot reference inference-basis finding/u
  );

  const workflowMismatch = {
    ...withoutHash(base),
    worklines: base.worklines.map((workline, index) => index === 0
      ? {
          ...workline,
          summary: { ...workline.summary, relation: "workflow-state" as const, spanIds: [] }
        }
      : workline)
  };
  assert.match(
    validateTodayWorklineIndexV2(rehash(workflowMismatch)).join("\n"),
    /relation workflow-state cannot reference source-span finding/u
  );

  const wrongParticipationAuthority = {
    ...withoutHash(base),
    worklines: base.worklines.map((workline, index) => index === 0
      ? {
          ...workline,
          participation: {
            ...workline.participation,
            account: { status: "described" as const, human: "User authorized the work." }
          }
        }
      : workline)
  };
  assert.match(
    validateTodayWorklineIndexV2(rehash(wrongParticipationAuthority)).join("\n"),
    /human\/joint participation requires a user-authored source span/u
  );

  const missingSpanId = `span-v2-${"7".repeat(64)}`;
  const missingSpan = structuredClone(base);
  missingSpan.worklines[0]!.summary.spanIds = [missingSpanId];
  const missingSpanValue = rehash(withoutHash(missingSpan));
  const issues = validateTodayWorklineIndexV2(missingSpanValue).join("\n");
  assert.match(issues, /references unknown span/u);
  assert.match(issues, /is not owned by one of its findings/u);

  const indexWithTwoSpans = v2Index();
  indexWithTwoSpans.spans.push(secondSpan());
  indexWithTwoSpans.findings[0]!.spanIds = [SPAN_ID, SECOND_SPAN_ID];
  indexWithTwoSpans.worklines[0]!.summary.spanIds = [SECOND_SPAN_ID, SPAN_ID];
  const reversedSpans = rehash(withoutHash(indexWithTwoSpans));
  assert.match(validateTodayWorklineIndexV2(reversedSpans).join("\n"), /do not preserve finding order/u);

  const dossier = v2Dossier(base);
  dossier.content.supportingEvidence[0]!.findingIds = ["finding-missing"];
  const dossierWithMissingFinding = rehash(withoutHash(dossier));
  assert.match(validateTodayWorklineDossierV2(dossierWithMissingFinding).join("\n"), /references unknown finding/u);
});

test("all embedded V2 evidence and material statements participate in contentHash", () => {
  const index = v2Index();
  const tamperedIndex = structuredClone(index);
  tamperedIndex.worklines[0]!.summary.text = "Tampered material statement.";
  assert.match(validateTodayWorklineIndexV2(tamperedIndex).join("\n"), /contentHash/u);

  const dossier = v2Dossier(index);
  const tamperedDossier = structuredClone(dossier);
  tamperedDossier.spans[0]!.textQuote.exact = "tampered quote";
  const dossierIssues = validateTodayWorklineDossierV2(tamperedDossier).join("\n");
  assert.match(dossierIssues, /quoteHash/u);
  assert.match(dossierIssues, /contentHash/u);
});

test("versioned union parsers preserve V1 bytes and accept V2 without promotion", () => {
  const v1IndexValue = v1Index();
  const v1DossierValue = v1Dossier(v1IndexValue);
  const indexBytes = JSON.stringify(v1IndexValue);
  const dossierBytes = JSON.stringify(v1DossierValue);

  assert.equal(JSON.stringify(parseTodayWorklineIndexArtifact(JSON.parse(indexBytes))), indexBytes);
  assert.equal(JSON.stringify(parseTodayWorklineDossierArtifact(JSON.parse(dossierBytes))), dossierBytes);
  assert.deepEqual(validateTodayWorklineIndexArtifact(v1IndexValue), []);
  assert.deepEqual(validateTodayWorklineDossierArtifact(v1DossierValue), []);
  assert.deepEqual(validateTodayWorklineIndexArtifact(v2Index()), []);
  assert.deepEqual(validateTodayWorklineDossierArtifact(v2Dossier(v2Index())), []);
  assert.equal(parseTodayWorklineIndexArtifact(v2Index()).schema, STRUCTURED_TODAY_INDEX_V2_SCHEMA);
  assert.equal(parseTodayWorklineDossierArtifact(v2Dossier(v2Index())).schema, STRUCTURED_TODAY_DOSSIER_V2_SCHEMA);
  assert.throws(() => parseTodayWorklineIndexArtifact({ ...v1IndexValue, schema: "today-workline-index/v3" }));
});

function v2Index() {
  const evidence = sessionEvidence();
  const locator = messageLocator();
  const evidenceSpan = span();
  const finding = atomicFinding();
  const base = {
    schema: STRUCTURED_TODAY_INDEX_V2_SCHEMA,
    artifactId: "structured-today-index-v2",
    revision: 2,
    logicalDate: "2026-08-30",
    workflowRunId: "structured-today-v2-run",
    evidenceManifestId: "manifest-v2",
    sessions: [sessionRef()],
    evidence: [evidence],
    messageLocators: [locator],
    spans: [evidenceSpan],
    findings: [finding],
    dispositions: [{
      sessionId: "session-1",
      kind: "assigned" as const,
      worklineIds: ["workline-1"],
      nodeOutputId: "node-output-1"
    }],
    worklines: [{
      worklineId: "workline-1",
      title: "Evidence-first workline",
      summary: citedStatement("statement-summary", "The implementation completed."),
      startedAt: "2026-08-30T01:00:00.000Z",
      endedAt: "2026-08-30T02:00:00.000Z",
      currentStop: citedStatement("statement-stop", "The current stop is validation."),
      possibleChange: citedStatement("statement-change", "The architecture may become auditable.", "inference-basis"),
      possibleChangeAdopted: false as const,
      participation: {
        account: { status: "described" as const, agent: "Agent implemented the change." },
        statement: citedStatement("statement-participation", "Agent implemented the change.")
      },
      evidenceReadiness: "ready" as const,
      sessionIds: ["session-1"],
      evidenceIds: ["evidence-1"],
      extensions: []
    }],
    coverage: { admitted: 1, assigned: 1, excluded: 0, failed: 0, unresolved: 0, complete: true },
    provenance: provenance()
  };
  return rehash(base);
}

function v2Dossier(index: ReturnType<typeof v2Index>) {
  const base = {
    schema: STRUCTURED_TODAY_DOSSIER_V2_SCHEMA,
    artifactId: "structured-today-dossier-v2",
    revision: 2,
    logicalDate: index.logicalDate,
    workflowRunId: "structured-today-dossier-v2-run",
    sourceIndex: {
      schema: STRUCTURED_TODAY_INDEX_V2_SCHEMA,
      artifactId: index.artifactId,
      revision: index.revision,
      contentHash: index.contentHash
    },
    worklineId: "workline-1",
    admittedSessionIds: ["session-1"],
    evidence: index.evidence,
    messageLocators: index.messageLocators,
    spans: index.spans,
    findings: index.findings,
    content: {
      title: "Evidence-first dossier",
      priorContext: citedStatement("dossier-prior", "The previous contract was Session-level."),
      whatHappened: citedStatement("dossier-happened", "The implementation completed."),
      possibleChange: citedStatement("dossier-change", "The result may improve auditability.", "inference-basis"),
      possibleChangeAdopted: false as const,
      supportingEvidence: [citedStatement("dossier-support", "The implementation completed.")],
      opposingEvidence: [],
      falsifiableObservation: citedStatement("dossier-falsifiable", "A holdout can falsify the result.", "inference-basis"),
      gaps: [],
      humanQuestion: citedStatement("dossier-question", "Should the V2 route proceed?", "inference-basis"),
      extensions: []
    },
    validation: { schema: "passed" as const, evidence: "passed" as const, semantic: "passed" as const, critiqueIssues: [] },
    provenance: provenance()
  };
  return rehash(base);
}

function unresolvedIndex() {
  const base = v2Index();
  const unresolvedFinding = {
    findingId: "finding-unresolved",
    text: "No exact message span is available.",
    claimKind: "fact" as const,
    relation: "unresolved" as const,
    spanIds: []
  };
  return rehash({
    ...withoutHash(base),
    messageLocators: [],
    spans: [],
    findings: [unresolvedFinding],
    worklines: base.worklines.map((workline) => ({
      ...workline,
      summary: unresolvedStatement("unresolved-summary", workline.summary.text),
      currentStop: unresolvedStatement("unresolved-stop", workline.currentStop.text),
      possibleChange: unresolvedStatement("unresolved-change", workline.possibleChange.text),
      participation: {
        ...workline.participation,
        statement: unresolvedStatement("unresolved-participation", workline.participation.statement.text)
      }
    }))
  });
}

function unresolvedDossier(index: ReturnType<typeof unresolvedIndex>) {
  const base = v2Dossier(v2Index());
  return rehash({
    ...withoutHash(base),
    sourceIndex: {
      schema: STRUCTURED_TODAY_INDEX_V2_SCHEMA,
      artifactId: index.artifactId,
      revision: index.revision,
      contentHash: index.contentHash
    },
    messageLocators: [],
    spans: [],
    findings: index.findings,
    content: {
      ...base.content,
      priorContext: unresolvedStatement("unresolved-prior", base.content.priorContext.text),
      whatHappened: unresolvedStatement("unresolved-happened", base.content.whatHappened.text),
      possibleChange: unresolvedStatement("unresolved-dossier-change", base.content.possibleChange.text),
      supportingEvidence: [unresolvedStatement("unresolved-support", "Support is unresolved.")],
      opposingEvidence: [],
      falsifiableObservation: unresolvedStatement("unresolved-falsifiable", base.content.falsifiableObservation.text),
      gaps: [unresolvedStatement("unresolved-gap", "The exact message range is unavailable.")],
      humanQuestion: unresolvedStatement("unresolved-question", base.content.humanQuestion.text)
    }
  });
}

function v1Index() {
  const base = {
    schema: STRUCTURED_TODAY_INDEX_SCHEMA,
    artifactId: "structured-today-index-v1",
    revision: 1,
    logicalDate: "2026-08-30",
    workflowRunId: "structured-today-v1-run",
    evidenceManifestId: "manifest-v1",
    sessions: [sessionRef()],
    evidence: [sessionEvidence()],
    dispositions: [{
      sessionId: "session-1",
      kind: "assigned" as const,
      worklineIds: ["workline-1"],
      nodeOutputId: "node-output-v1"
    }],
    worklines: [{
      worklineId: "workline-1",
      title: "V1 workline",
      summary: "Session-level summary.",
      startedAt: "2026-08-30T01:00:00.000Z",
      endedAt: "2026-08-30T02:00:00.000Z",
      currentStop: "Session-level stop.",
      possibleChange: "Session-level possible change.",
      possibleChangeAdopted: false as const,
      participation: { status: "described" as const, agent: "Agent worked." },
      evidenceReadiness: "ready" as const,
      sessionIds: ["session-1"],
      evidenceIds: ["evidence-1"],
      extensions: []
    }],
    coverage: { admitted: 1, assigned: 1, excluded: 0, failed: 0, unresolved: 0, complete: true },
    provenance: provenance()
  };
  return rehash(base);
}

function v1Dossier(index: ReturnType<typeof v1Index>) {
  const base = {
    schema: STRUCTURED_TODAY_DOSSIER_SCHEMA,
    artifactId: "structured-today-dossier-v1",
    revision: 1,
    logicalDate: index.logicalDate,
    workflowRunId: "structured-today-dossier-v1-run",
    sourceIndex: { artifactId: index.artifactId, revision: index.revision, contentHash: index.contentHash },
    worklineId: "workline-1",
    admittedSessionIds: ["session-1"],
    evidence: index.evidence,
    content: {
      title: "V1 dossier",
      priorContext: "Prior context.",
      whatHappened: "What happened.",
      possibleChange: "Possible change.",
      possibleChangeAdopted: false as const,
      supportingEvidence: [{ claim: "Supported claim.", evidenceIds: ["evidence-1"] }],
      opposingEvidence: [],
      falsifiableObservation: "Falsifiable observation.",
      gaps: [],
      humanQuestion: "What should happen next?",
      evidenceIds: ["evidence-1"],
      extensions: []
    },
    validation: { schema: "passed" as const, evidence: "passed" as const, semantic: "passed" as const, critiqueIssues: [] },
    provenance: provenance()
  };
  return rehash(base);
}

function sessionRef() {
  return {
    sessionId: "session-1",
    provider: "codex" as const,
    sourcePath: "/tmp/session-1.jsonl",
    title: "Session One",
    startedAt: "2026-08-30T01:00:00.000Z",
    endedAt: "2026-08-30T02:00:00.000Z",
    evidenceIds: ["evidence-1"]
  };
}

function sessionEvidence() {
  return {
    evidenceId: "evidence-1",
    sourceKind: "session" as const,
    provider: "codex" as const,
    sessionId: "session-1",
    sourcePath: "/tmp/session-1.jsonl",
    range: "bytes 0-200",
    contentHash: HASH_A
  };
}

function messageLocator() {
  return {
    messageKey: MESSAGE_KEY,
    messageLocatorId: LOCATOR_ID,
    evidenceId: "evidence-1",
    provider: "codex" as const,
    sessionId: "session-1",
    role: "assistant" as const,
    authorKind: "agent" as const,
    providerMessageId: "provider-message-1",
    rawRecord: { unit: "utf8-byte" as const, start: 0, end: 120, contentHash: HASH_B },
    parserVersion: "structured-today-evidence-parser/v2",
    admissionPolicyVersion: "structured-today-admission-policy/v1",
    normalizedMessageHash: HASH_C,
    frozenSourcePrefix: { byteLength: 200, contentHash: HASH_D }
  };
}

function span() {
  return {
    spanId: SPAN_ID,
    evidenceId: "evidence-1",
    messageKey: MESSAGE_KEY,
    messageLocatorId: LOCATOR_ID,
    textQuote: { exact: QUOTE, prefix: "Before.", suffix: "After." },
    textPosition: { unit: "unicode-code-point" as const, start: 8, end: 8 + [...QUOTE].length },
    quoteHash: sha256(QUOTE)
  };
}

function secondSpan() {
  const exact = "Second exact quote.";
  return {
    ...span(),
    spanId: SECOND_SPAN_ID,
    textQuote: { exact, prefix: "Before second.", suffix: "After second." },
    textPosition: { unit: "unicode-code-point" as const, start: 50, end: 50 + [...exact].length },
    quoteHash: sha256(exact)
  };
}

function atomicFinding() {
  return {
    findingId: "finding-1",
    text: "The implementation completed.",
    claimKind: "fact" as const,
    relation: "source-span" as const,
    spanIds: [SPAN_ID]
  };
}

function citedStatement(statementId: string, text: string, relation: "source-span" | "inference-basis" = "source-span") {
  return {
    statementId,
    text,
    relation,
    findingIds: ["finding-1"],
    spanIds: [SPAN_ID]
  };
}

function unresolvedStatement(statementId: string, text: string) {
  return {
    statementId,
    text,
    relation: "unresolved" as const,
    findingIds: ["finding-unresolved"],
    spanIds: []
  };
}

function provenance() {
  return {
    workflowVersion: "structured-today-workflow-v2",
    editorialContract: { packageId: "traceink" as const, version: "v1", editorialContractHash: HASH_A },
    modelFunctionVersions: { DigestSession: "DigestSession/v2" },
    providerInvocations: [{
      invocationId: "invocation-1",
      provider: "codex",
      model: "fixture",
      functionName: "DigestSession" as const,
      functionVersion: "DigestSession/v2"
    }]
  };
}

function withoutHash<T extends { contentHash: string }>(value: T): Omit<T, "contentHash"> {
  const { contentHash: _contentHash, ...rest } = value;
  return rest;
}

function rehash<T extends Record<string, unknown>>(value: T): T & { contentHash: string } {
  return { ...value, contentHash: canonicalContentHash(value) };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
