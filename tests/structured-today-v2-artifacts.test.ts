import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStructuredTodayIndexV2,
  type BuildStructuredTodayIndexV2Input
} from "../src/structured-today-v2-artifacts";
import {
  StructuredTodayProvenanceSessionSchema,
  type AtomicFindingV1,
  type EvidenceMessageLocatorV1,
  type EvidenceSpanV1,
  type StructuredTodayProvenanceSessionV1
} from "../src/structured-today-evidence-spans";
import {
  StructuredTodayIndexWorkflowInputV2Schema,
  structuredTodayAdmittedCorpusHash,
  type ResolvedDigestFindingsV1,
  type StructuredTodayIndexWorkflowInputV2
} from "../src/structured-today-v2-workflow";
import { TodayWorklineIndexV2Schema } from "../src/structured-today-v2-contracts";
import { sha256Text } from "../src/structured-today-contracts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const LOGICAL_DATE = "2026-08-30";
const RUN_ID = "structured-today-v2-artifact-run";

test("buildStructuredTodayIndexV2 deterministically closes and deduplicates the used evidence graph", () => {
  const fixture = completeFixture();
  const first = buildStructuredTodayIndexV2(fixture);
  const second = buildStructuredTodayIndexV2({
    ...fixture,
    resolvedDigests: [...fixture.resolvedDigests].reverse()
  });

  assert.deepEqual(first, second);
  assert.doesNotThrow(() => TodayWorklineIndexV2Schema.parse(first));
  assert.equal(first.messageLocators.length, 2);
  assert.equal(first.spans.length, 2);
  assert.equal(first.findings.length, 2);
  assert.deepEqual(first.worklines[0]?.summary.spanIds, [spanId(2), spanId(1)]);
  assert.deepEqual(first.worklines[0]?.evidenceIds, ["evidence-1", "evidence-2"]);
  assert.match(first.worklines[0]?.summary.statementId ?? "", /^statement-v2-[a-f0-9]{32}$/u);
  assert.match(first.contentHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(first.coverage, {
    admitted: 2,
    assigned: 2,
    excluded: 0,
    failed: 0,
    unresolved: 0,
    complete: true
  });
});

test("host builds statement identities and rejects model-supplied or relation-incompatible material", () => {
  const fixture = completeFixture();
  const incompatibleResolved = structuredClone(fixture.resolvedDigests);
  incompatibleResolved[0]!.findings[0]!.relation = "inference-basis";
  assert.throws(
    () => buildStructuredTodayIndexV2({ ...fixture, resolvedDigests: incompatibleResolved }),
    /relation source-span cannot use inference-basis finding/u
  );

  const forgedHumanAuthority = structuredClone(fixture.resolvedDigests);
  forgedHumanAuthority[0]!.findings[0]!.claimKind = "human-adoption";
  assert.throws(
    () => buildStructuredTodayIndexV2({ ...fixture, resolvedDigests: forgedHumanAuthority }),
    /human-adoption finding .* without a human-authored span/u
  );

  const withModelAuthority = structuredClone(fixture.synthesis) as unknown as {
    worklines: Array<{ summary: Record<string, unknown> }>;
  };
  withModelAuthority.worklines[0]!.summary.statementId = "model-authored";
  withModelAuthority.worklines[0]!.summary.spanIds = [spanId(1)];
  assert.throws(
    () => buildStructuredTodayIndexV2({ ...fixture, synthesis: withModelAuthority as never }),
    /unrecognized key|Unrecognized key/u
  );

  const wrongParticipationAuthority = structuredClone(fixture.synthesis);
  wrongParticipationAuthority.worklines[0]!.participation.account = {
    human: "User authorized the work.",
    agent: null,
    joint: null,
    undeterminedReason: null
  };
  assert.throws(
    () => buildStructuredTodayIndexV2({ ...fixture, synthesis: wrongParticipationAuthority }),
    /human\/joint participation lacks a user-authored source span/u
  );
});

test("failed pre-dispositions and synthesis omissions produce total non-publishable coverage", () => {
  const fixture = completeFixture();
  const initialSessions = fixture.initial.sessions.map((item, index) => index === 0
    ? {
        logicalDate: item.logicalDate,
        editorialContract: item.editorialContract,
        session: item.session,
        evidence: item.evidence,
        preDisposition: { kind: "failed" as const, reason: "Frozen capture was unavailable." }
      }
    : item);
  const provenanceSessions = initialSessions.flatMap((item) =>
    "provenanceSession" in item && item.provenanceSession ? [item.provenanceSession] : []
  );
  const initial = StructuredTodayIndexWorkflowInputV2Schema.parse({
    ...fixture.initial,
    sessions: initialSessions,
    admittedCorpusHash: structuredTodayAdmittedCorpusHash(provenanceSessions)
  });
  const artifact = buildStructuredTodayIndexV2({
    ...fixture,
    initial,
    resolvedDigests: [fixture.resolvedDigests[1]!],
    synthesis: { worklines: [], assignments: [], unresolvedSessionIds: ["session-2"] }
  });

  assert.deepEqual(artifact.dispositions.map((item) => [item.sessionId, item.kind]), [
    ["session-1", "failed"],
    ["session-2", "unresolved"]
  ]);
  assert.deepEqual(artifact.coverage, {
    admitted: 2,
    assigned: 0,
    excluded: 0,
    failed: 1,
    unresolved: 1,
    complete: false
  });
  assert.deepEqual(artifact.worklines, []);
  assert.deepEqual(artifact.messageLocators, []);
  assert.deepEqual(artifact.spans, []);
  assert.deepEqual(artifact.findings, []);
});

test("execution failures remain failed while successful Sessions stay assignable", () => {
  const fixture = completeFixture();
  const findingId = "finding-2";
  const synthesis = {
    worklines: [{
      ...fixture.synthesis.worklines[0]!,
      summary: { text: "Session two completed.", relation: "source-span" as const, findingIds: [findingId] },
      currentStop: { text: "Session two validation.", relation: "source-span" as const, findingIds: [findingId] },
      possibleChange: { text: "Session two may pass.", relation: "inference-basis" as const, findingIds: [findingId] },
      participation: {
        account: { human: null, agent: "Agent completed implementation.", joint: null, undeterminedReason: null },
        statement: { text: "Agent completed implementation.", relation: "source-span" as const, findingIds: [findingId] }
      },
      sessionIds: ["session-2"]
    }],
    assignments: [{ sessionId: "session-2", worklineIds: ["workline-1"], reason: null }],
    unresolvedSessionIds: []
  };
  const artifact = buildStructuredTodayIndexV2({
    ...fixture,
    resolvedDigests: [fixture.resolvedDigests[1]!],
    executionDispositions: [{ sessionId: "session-1", kind: "failed", reason: "Digest model failed." }],
    synthesis
  });

  assert.deepEqual(artifact.dispositions.map((item) => [item.sessionId, item.kind]), [
    ["session-1", "failed"],
    ["session-2", "assigned"]
  ]);
  assert.deepEqual(artifact.coverage, {
    admitted: 2,
    assigned: 1,
    excluded: 0,
    failed: 1,
    unresolved: 0,
    complete: false
  });

  const allFailed = buildStructuredTodayIndexV2({
    ...fixture,
    resolvedDigests: [],
    executionDispositions: [
      { sessionId: "session-1", kind: "failed", reason: "Digest one failed." },
      { sessionId: "session-2", kind: "failed", reason: "Digest two failed." }
    ],
    synthesis: { worklines: [], assignments: [], unresolvedSessionIds: [] }
  });
  assert.deepEqual(allFailed.dispositions.map((item) => item.kind), ["failed", "failed"]);
  assert.deepEqual(allFailed.findings, []);
  assert.equal(allFailed.coverage.complete, false);
});

test("builder rejects unknown findings and locators outside the frozen admitted provenance", () => {
  const fixture = completeFixture();
  const unknownFinding = structuredClone(fixture.synthesis);
  unknownFinding.worklines[0]!.summary.findingIds = ["finding-unknown"];
  assert.throws(
    () => buildStructuredTodayIndexV2({ ...fixture, synthesis: unknownFinding }),
    /Unknown finding finding-unknown/u
  );

  const forgedResolved = structuredClone(fixture.resolvedDigests);
  forgedResolved[0]!.messageLocators[0]!.messageLocatorId = locatorId(9);
  assert.throws(
    () => buildStructuredTodayIndexV2({ ...fixture, resolvedDigests: forgedResolved }),
    /outside its admitted provenance/u
  );
});

test("builder rejects non-reciprocal, failed, and digest-free assignments", () => {
  const fixture = completeFixture();
  const nonReciprocal = structuredClone(fixture.synthesis);
  nonReciprocal.worklines[0]!.sessionIds = ["session-1"];
  assert.throws(
    () => buildStructuredTodayIndexV2({ ...fixture, synthesis: nonReciprocal }),
    /not reciprocal with assignments/u
  );

  assert.throws(
    () => buildStructuredTodayIndexV2({
      ...fixture,
      resolvedDigests: [fixture.resolvedDigests[0]!]
    }),
    /without resolved findings/u
  );
});

function completeFixture(): BuildStructuredTodayIndexV2Input {
  const first = sessionBundle(1);
  const second = sessionBundle(2);
  const initial = initialInput([first.provenance, second.provenance]);
  return {
    initial,
    resolvedDigests: [first.resolved, second.resolved],
    executionDispositions: [],
    synthesis: {
      worklines: [{
        worklineId: "workline-1",
        title: "Evidence-first implementation",
        summary: {
          text: "Two Sessions completed the implementation.",
          relation: "source-span",
          findingIds: ["finding-2", "finding-1"]
        },
        startedAt: "2026-08-30T01:00:00.000Z",
        endedAt: "2026-08-30T03:00:00.000Z",
        currentStop: {
          text: "Validation is the current stop.",
          relation: "source-span",
          findingIds: ["finding-1"]
        },
        possibleChange: {
          text: "The evidence path may become auditable.",
          relation: "inference-basis",
          findingIds: ["finding-1", "finding-2"]
        },
        participation: {
          account: { human: null, agent: "Agent completed implementation.", joint: null, undeterminedReason: null },
          statement: {
            text: "Agent completed implementation.",
            relation: "source-span",
            findingIds: ["finding-2"]
          }
        },
        evidenceReadiness: "ready",
        sessionIds: ["session-1", "session-2"],
        extensions: []
      }],
      assignments: [
        { sessionId: "session-1", worklineIds: ["workline-1"], reason: null },
        { sessionId: "session-2", worklineIds: ["workline-1"], reason: null }
      ],
      unresolvedSessionIds: []
    },
    invocations: [
      invocation("digest-1", "DigestSession", "DigestSessionFindingsV2/structured-v1"),
      invocation("synthesis-1", "SynthesizeWorklineIndex", "SynthesizeWorklineIndexV2/structured-v1")
    ],
    runtimeRunId: RUN_ID
  };
}

function initialInput(provenanceSessions: StructuredTodayProvenanceSessionV1[]): StructuredTodayIndexWorkflowInputV2 {
  const sessions = provenanceSessions.map((provenance, index) => {
    const ordinal = index + 1;
    return {
      logicalDate: LOGICAL_DATE,
      editorialContract: editorialContract(),
      session: sessionRef(ordinal),
      evidence: [evidence(ordinal)],
      provenanceSession: provenance
    };
  });
  return StructuredTodayIndexWorkflowInputV2Schema.parse({
    schema: "structured-today-index-input/v2",
    workflowVersion: "structured-today-workflow-v5-message-spans",
    logicalDate: LOGICAL_DATE,
    workflowRunId: RUN_ID,
    artifactId: "structured-today-index-v2",
    revision: 2,
    evidenceManifestId: "manifest-v2",
    editorialContract: editorialContract(),
    parserVersion: "structured-today-evidence-parser/v2",
    admissionPolicyVersion: "structured-today-admission-policy/v1",
    admittedCorpusHash: structuredTodayAdmittedCorpusHash(provenanceSessions),
    sessions,
    evidence: sessions.flatMap((item) => item.evidence)
  });
}

function sessionBundle(ordinal: number): {
  provenance: StructuredTodayProvenanceSessionV1;
  resolved: ResolvedDigestFindingsV1;
} {
  const locator = messageLocator(ordinal);
  const exact = `Exact quote ${ordinal}.`;
  const evidenceSpan: EvidenceSpanV1 = {
    spanId: spanId(ordinal),
    evidenceId: `evidence-${ordinal}`,
    messageKey: locator.messageKey,
    messageLocatorId: locator.messageLocatorId,
    textQuote: { exact },
    textPosition: { unit: "unicode-code-point", start: 0, end: [...exact].length },
    quoteHash: sha256Text(exact)
  };
  const finding: AtomicFindingV1 = {
    findingId: `finding-${ordinal}`,
    text: `Verified finding ${ordinal}.`,
    claimKind: "fact",
    relation: "source-span",
    spanIds: [evidenceSpan.spanId]
  };
  const admittedMessage = {
    locator,
    content: exact,
    contentHash: locator.normalizedMessageHash,
    completeMessage: true as const
  };
  const provenance = StructuredTodayProvenanceSessionSchema.parse({
    schema: "structured-today-provenance-session/v1",
    provider: "codex",
    sessionId: `session-${ordinal}`,
    evidenceId: `evidence-${ordinal}`,
    parserVersion: "structured-today-evidence-parser/v2",
    admissionPolicyVersion: "structured-today-admission-policy/v1",
    frozenSourcePrefix: locator.frozenSourcePrefix,
    coverage: "complete",
    admittedMessages: [admittedMessage],
    omissions: [],
    parseIssues: [],
    admittedCorpusHash: sha256Text(JSON.stringify([{
      messageLocatorId: locator.messageLocatorId,
      contentHash: admittedMessage.contentHash,
      completeMessage: true
    }]))
  });
  return {
    provenance,
    resolved: {
      sessionId: `session-${ordinal}`,
      messageLocators: [locator],
      spans: [evidenceSpan],
      findings: [finding],
      unresolvedCandidates: []
    }
  };
}

function messageLocator(ordinal: number): EvidenceMessageLocatorV1 {
  const content = `Exact quote ${ordinal}.`;
  return {
    messageKey: messageKey(ordinal),
    messageLocatorId: locatorId(ordinal),
    evidenceId: `evidence-${ordinal}`,
    provider: "codex",
    sessionId: `session-${ordinal}`,
    role: "assistant",
    authorKind: "agent",
    providerMessageId: `provider-${ordinal}`,
    rawRecord: { unit: "utf8-byte", start: 0, end: 80, contentHash: HASH_B },
    parserVersion: "structured-today-evidence-parser/v2",
    admissionPolicyVersion: "structured-today-admission-policy/v1",
    normalizedMessageHash: sha256Text(content),
    frozenSourcePrefix: { byteLength: 100, contentHash: HASH_A }
  };
}

function sessionRef(ordinal: number) {
  return {
    sessionId: `session-${ordinal}`,
    provider: "codex" as const,
    sourcePath: `/tmp/session-${ordinal}.jsonl`,
    title: `Session ${ordinal}`,
    startedAt: "2026-08-30T01:00:00.000Z",
    endedAt: "2026-08-30T02:00:00.000Z",
    evidenceIds: [`evidence-${ordinal}`]
  };
}

function evidence(ordinal: number) {
  return {
    evidenceId: `evidence-${ordinal}`,
    sourceKind: "session" as const,
    provider: "codex" as const,
    sessionId: `session-${ordinal}`,
    sourcePath: `/tmp/session-${ordinal}.jsonl`,
    range: "bytes 0-100",
    contentHash: HASH_A
  };
}

function editorialContract() {
  const text = "Evidence-first editorial contract.";
  return {
    ref: { packageId: "traceink" as const, version: "v2", editorialContractHash: sha256Text(text) },
    text
  };
}

function invocation(
  invocationId: string,
  functionName: "DigestSession" | "SynthesizeWorklineIndex",
  functionVersion: string
) {
  return { invocationId, provider: "codex", model: "fixture", functionName, functionVersion };
}

function messageKey(ordinal: number): string {
  return `msg-v2-${String(ordinal).repeat(64).slice(0, 64)}`;
}

function locatorId(ordinal: number): string {
  return `locator-v2-${String(ordinal).repeat(64).slice(0, 64)}`;
}

function spanId(ordinal: number): string {
  return `span-v2-${String(ordinal).repeat(64).slice(0, 64)}`;
}
