import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStructuredTodayDossierV2,
  type BuildStructuredTodayDossierV2Input
} from "../src/structured-today-v2-dossier-artifacts";
import { DossierComposeCandidateV2Schema } from "../src/structured-today-v2-dossier-model-functions";
import {
  TodayWorklineDossierV2Schema,
  TodayWorklineIndexV2Schema
} from "../src/structured-today-v2-contracts";
import { canonicalContentHash, sha256Text } from "../src/structured-today-contracts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

test("buildStructuredTodayDossierV2 derives deterministic statements and the actual selected closure", () => {
  const fixture = dossierFixture();
  const first = buildStructuredTodayDossierV2(fixture);
  const second = buildStructuredTodayDossierV2(structuredClone(fixture));

  assert.deepEqual(first, second);
  assert.doesNotThrow(() => TodayWorklineDossierV2Schema.parse(first));
  assert.deepEqual(first.admittedSessionIds, ["session-1", "session-2"]);
  assert.deepEqual(first.evidence.map((item) => item.evidenceId), ["evidence-1", "evidence-2"]);
  assert.deepEqual(first.findings.map((item) => item.findingId), ["finding-1"]);
  assert.deepEqual(first.spans.map((item) => item.spanId), [spanId(1)]);
  assert.deepEqual(first.messageLocators.map((item) => item.messageLocatorId), [locatorId(1)]);
  assert.match(first.content.priorContext.statementId, /^dossier-statement-v2-[a-f0-9]{32}$/u);
  assert.deepEqual(first.sourceIndex, {
    schema: "today-workline-index/v2",
    artifactId: fixture.sourceIndex.artifactId,
    revision: fixture.sourceIndex.revision,
    contentHash: fixture.sourceIndex.contentHash
  });
});

test("dossier builder rejects forged and cross-workline finding IDs", () => {
  const fixture = dossierFixture();
  const forged = structuredClone(fixture.candidate);
  forged.priorContext.findingIds = ["finding-forged"];
  assert.throws(
    () => buildStructuredTodayDossierV2({ ...fixture, candidate: forged }),
    /outside selected workline closure/u
  );

  const crossWorkline = structuredClone(fixture.candidate);
  crossWorkline.whatHappened.findingIds = ["finding-3"];
  assert.throws(
    () => buildStructuredTodayDossierV2({ ...fixture, candidate: crossWorkline }),
    /finding-3 outside selected workline closure/u
  );
});

test("source and inference relations are revalidated against selected findings", () => {
  const fixture = dossierFixture();
  const invalidSource = structuredClone(fixture.candidate);
  invalidSource.supportingEvidence = [{
    text: "An inference cannot be promoted to direct source.",
    relation: "source-span",
    findingIds: ["finding-4"]
  }];
  assert.throws(
    () => buildStructuredTodayDossierV2({ ...fixture, candidate: invalidSource }),
    /relation source-span cannot use inference-basis finding finding-4/u
  );

  const validInference = structuredClone(fixture.candidate);
  validInference.possibleChange = {
    text: "Source and inference findings jointly support this interpretation.",
    relation: "inference-basis",
    findingIds: ["finding-1", "finding-4"]
  };
  const dossier = buildStructuredTodayDossierV2({ ...fixture, candidate: validInference });
  assert.deepEqual(dossier.content.possibleChange.spanIds, [spanId(1)]);
});

test("human participation authority is preserved from the exact source index", () => {
  const fixture = dossierFixture();
  const humanBasis = structuredClone(fixture.candidate);
  humanBasis.supportingEvidence = [{
    text: "The user explicitly authorized the work.",
    relation: "source-span",
    findingIds: ["finding-2"]
  }];
  const dossier = buildStructuredTodayDossierV2({ ...fixture, candidate: humanBasis });
  const userLocatorId = dossier.spans.find((span) => span.spanId === spanId(2))?.messageLocatorId;
  assert.equal(dossier.messageLocators.find((locator) => locator.messageLocatorId === userLocatorId)?.role, "user");

  const invalidIndex = structuredClone(fixture.sourceIndex);
  invalidIndex.messageLocators.find((locator) => locator.messageLocatorId === locatorId(2))!.authorKind = "agent";
  const invalidSourceIndex = rehash(withoutHash(invalidIndex));
  assert.throws(
    () => buildStructuredTodayDossierV2({ ...fixture, sourceIndex: invalidSourceIndex }),
    /user-authored source span/u
  );

  const forgedHumanClaim = structuredClone(fixture.sourceIndex);
  forgedHumanClaim.findings.find((finding) => finding.findingId === "finding-1")!.claimKind = "human-adoption";
  const forgedHumanSourceIndex = rehash(withoutHash(forgedHumanClaim));
  assert.throws(
    () => buildStructuredTodayDossierV2({ ...fixture, sourceIndex: forgedHumanSourceIndex }),
    /human-adoption requires a host-classified human-authored span/u
  );
});

test("strict candidate authority and canonical dossier hash reject tampering", () => {
  const fixture = dossierFixture();
  const modelAuthority = structuredClone(fixture.candidate) as unknown as {
    priorContext: Record<string, unknown>;
  };
  modelAuthority.priorContext.statementId = "model-authored";
  modelAuthority.priorContext.spanIds = [spanId(1)];
  assert.throws(
    () => buildStructuredTodayDossierV2({ ...fixture, candidate: modelAuthority as never }),
    /unrecognized key|Unrecognized key/u
  );

  const dossier = buildStructuredTodayDossierV2(fixture);
  const tampered = structuredClone(dossier);
  tampered.content.whatHappened.text = "Tampered after hashing.";
  assert.equal(TodayWorklineDossierV2Schema.safeParse(tampered).success, false);
});

function dossierFixture(): BuildStructuredTodayDossierV2Input {
  return {
    sourceIndex: sourceIndex(),
    selectedWorklineId: "workline-1",
    candidate: DossierComposeCandidateV2Schema.parse({
      title: "Selected workline dossier",
      priorContext: material("Previous context.", "source-span", ["finding-1"]),
      whatHappened: material("The implementation completed.", "source-span", ["finding-1"]),
      possibleChange: material("The result may improve auditability.", "inference-basis", ["finding-1"]),
      supportingEvidence: [material("The implementation completed.", "source-span", ["finding-1"])],
      opposingEvidence: [],
      falsifiableObservation: material("A holdout may falsify the result.", "inference-basis", ["finding-1"]),
      gaps: [],
      humanQuestion: material("Should this route continue?", "inference-basis", ["finding-1"]),
      extensions: []
    }),
    invocations: [
      invocation("analysis", "AnalyzeWorklineDossier", "AnalyzeWorklineDossierV2/structured-v1"),
      invocation("critique", "CritiqueWorklineDossier", "CritiqueWorklineDossierV2/structured-v1"),
      invocation("compose", "ComposeWorklineDossier", "ComposeWorklineDossierV2/structured-v1")
    ],
    artifactId: "structured-today-dossier-v2",
    revision: 1,
    workflowRunId: "structured-today-dossier-v2-run"
  };
}

function sourceIndex() {
  const locators = [messageLocator(1, "assistant"), messageLocator(2, "user"), messageLocator(3, "assistant")];
  const spans = [evidenceSpan(1), evidenceSpan(2), evidenceSpan(3)];
  const findings = [
    finding("finding-1", "source-span", [spanId(1)]),
    finding("finding-2", "source-span", [spanId(2)], "human-participation"),
    finding("finding-3", "source-span", [spanId(3)]),
    finding("finding-4", "inference-basis", [spanId(1)])
  ];
  const worklineOne = {
    worklineId: "workline-1",
    title: "Selected workline",
    summary: statement("wl1-summary", "Summary.", "source-span", ["finding-1"], [spanId(1)]),
    startedAt: "2026-08-30T01:00:00.000Z",
    endedAt: "2026-08-30T02:00:00.000Z",
    currentStop: statement("wl1-stop", "Stop.", "source-span", ["finding-1"], [spanId(1)]),
    possibleChange: statement("wl1-change", "Change.", "inference-basis", ["finding-4"], [spanId(1)]),
    possibleChangeAdopted: false as const,
    participation: {
      account: { status: "described" as const, human: "User authorized the work." },
      statement: statement("wl1-participation", "User authorized the work.", "source-span", ["finding-2"], [spanId(2)])
    },
    evidenceReadiness: "ready" as const,
    sessionIds: ["session-1", "session-2"],
    evidenceIds: ["evidence-1", "evidence-2"],
    extensions: []
  };
  const worklineTwo = {
    worklineId: "workline-2",
    title: "Other workline",
    summary: statement("wl2-summary", "Other summary.", "source-span", ["finding-3"], [spanId(3)]),
    startedAt: "2026-08-30T03:00:00.000Z",
    endedAt: "2026-08-30T04:00:00.000Z",
    currentStop: statement("wl2-stop", "Other stop.", "source-span", ["finding-3"], [spanId(3)]),
    possibleChange: statement("wl2-change", "Other change.", "inference-basis", ["finding-3"], [spanId(3)]),
    possibleChangeAdopted: false as const,
    participation: {
      account: { status: "described" as const, agent: "Agent worked." },
      statement: statement("wl2-participation", "Agent worked.", "source-span", ["finding-3"], [spanId(3)])
    },
    evidenceReadiness: "ready" as const,
    sessionIds: ["session-3"],
    evidenceIds: ["evidence-3"],
    extensions: []
  };
  const base = {
    schema: "today-workline-index/v2" as const,
    artifactId: "structured-today-index-v2",
    revision: 2,
    logicalDate: "2026-08-30",
    workflowRunId: "structured-today-index-v2-run",
    evidenceManifestId: "manifest-v2",
    sessions: [sessionRef(1), sessionRef(2), sessionRef(3)],
    evidence: [evidence(1), evidence(2), evidence(3)],
    messageLocators: locators,
    spans,
    findings,
    dispositions: [
      { sessionId: "session-1", kind: "assigned" as const, worklineIds: ["workline-1"], nodeOutputId: "node-1" },
      { sessionId: "session-2", kind: "assigned" as const, worklineIds: ["workline-1"], nodeOutputId: "node-2" },
      { sessionId: "session-3", kind: "assigned" as const, worklineIds: ["workline-2"], nodeOutputId: "node-3" }
    ],
    worklines: [worklineOne, worklineTwo],
    coverage: { admitted: 3, assigned: 3, excluded: 0, failed: 0, unresolved: 0, complete: true },
    provenance: provenance()
  };
  return TodayWorklineIndexV2Schema.parse(rehash(base));
}

function material(text: string, relation: "source-span" | "inference-basis", findingIds: string[]) {
  return { text, relation, findingIds };
}

function statement(
  statementId: string,
  text: string,
  relation: "source-span" | "inference-basis",
  findingIds: string[],
  spanIds: string[]
) {
  return { statementId, text, relation, findingIds, spanIds };
}

function finding(
  findingId: string,
  relation: "source-span" | "inference-basis",
  spanIds: string[],
  claimKind: "fact" | "human-participation" | "human-adoption" = "fact"
) {
  return { findingId, text: `${findingId} text`, claimKind, relation, spanIds };
}

function messageLocator(ordinal: number, role: "user" | "assistant") {
  return {
    messageKey: messageKey(ordinal),
    messageLocatorId: locatorId(ordinal),
    evidenceId: `evidence-${ordinal}`,
    provider: "codex" as const,
    sessionId: `session-${ordinal}`,
    role,
    authorKind: role === "user" ? "human" as const : "agent" as const,
    providerMessageId: `provider-${ordinal}`,
    rawRecord: { unit: "utf8-byte" as const, start: 0, end: 80, contentHash: HASH_B },
    parserVersion: "structured-today-evidence-parser/v2",
    admissionPolicyVersion: "structured-today-admission-policy/v1",
    normalizedMessageHash: sha256Text(`Exact quote ${ordinal}.`),
    frozenSourcePrefix: { byteLength: 100, contentHash: HASH_A }
  };
}

function evidenceSpan(ordinal: number) {
  const exact = `Exact quote ${ordinal}.`;
  return {
    spanId: spanId(ordinal),
    evidenceId: `evidence-${ordinal}`,
    messageKey: messageKey(ordinal),
    messageLocatorId: locatorId(ordinal),
    textQuote: { exact },
    textPosition: { unit: "unicode-code-point" as const, start: 0, end: [...exact].length },
    quoteHash: sha256Text(exact)
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

function provenance() {
  return {
    workflowVersion: "structured-today-workflow-v5-message-spans",
    editorialContract: { packageId: "traceink" as const, version: "v2", editorialContractHash: HASH_A },
    modelFunctionVersions: { SynthesizeWorklineIndex: "SynthesizeWorklineIndexV2/structured-v1" },
    providerInvocations: [{
      invocationId: "synthesis",
      provider: "codex",
      model: "fixture",
      functionName: "SynthesizeWorklineIndex" as const,
      functionVersion: "SynthesizeWorklineIndexV2/structured-v1"
    }]
  };
}

function invocation(
  invocationId: string,
  functionName: "AnalyzeWorklineDossier" | "CritiqueWorklineDossier" | "ComposeWorklineDossier",
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

function withoutHash<T extends { contentHash: string }>(value: T): Omit<T, "contentHash"> {
  const { contentHash: _contentHash, ...rest } = value;
  return rest;
}

function rehash<T extends Record<string, unknown>>(value: T): T & { contentHash: string } {
  return { ...value, contentHash: canonicalContentHash(value) };
}
