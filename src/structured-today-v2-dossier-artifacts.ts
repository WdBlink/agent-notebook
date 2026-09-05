import { z } from "zod";
import {
  StructuredTodayModelInvocationSchema,
  canonicalContentHash,
  sha256Text,
  type StructuredTodayModelInvocationV1
} from "./structured-today-contracts";
import {
  CitedStatementSchema,
  type AtomicFindingV1,
  type CitedStatementV1,
  type EvidenceMessageLocatorV1,
  type EvidenceRelationKindV1,
  type EvidenceSpanV1
} from "./structured-today-evidence-spans";
import {
  DossierComposeCandidateV2Schema,
  type DossierComposeCandidateV2
} from "./structured-today-v2-dossier-model-functions";
import type { MaterialStatementCandidateV2 } from "./structured-today-v2-model-functions";
import {
  STRUCTURED_TODAY_DOSSIER_V2_SCHEMA,
  STRUCTURED_TODAY_INDEX_V2_SCHEMA,
  TodayWorklineDossierV2Schema,
  TodayWorklineIndexV2Schema,
  type TodayWorklineDossierV2,
  type TodayWorklineIndexV2,
  type TodayWorklineV2
} from "./structured-today-v2-contracts";

export interface BuildStructuredTodayDossierV2Input {
  sourceIndex: TodayWorklineIndexV2;
  selectedWorklineId: string;
  candidate: DossierComposeCandidateV2;
  invocations: StructuredTodayModelInvocationV1[];
  artifactId: string;
  revision: number;
  workflowRunId: string;
}

export function buildStructuredTodayDossierV2(input: BuildStructuredTodayDossierV2Input): TodayWorklineDossierV2 {
  const sourceIndex = TodayWorklineIndexV2Schema.parse(input.sourceIndex);
  const candidate = DossierComposeCandidateV2Schema.parse(input.candidate);
  const invocations = input.invocations.map((item) => StructuredTodayModelInvocationSchema.parse(item));
  const artifactId = z.string().trim().min(1).parse(input.artifactId);
  const revision = z.number().int().positive().parse(input.revision);
  const workflowRunId = z.string().trim().min(1).parse(input.workflowRunId);
  const selected = sourceIndex.worklines.find((workline) => workline.worklineId === input.selectedWorklineId);
  if (!selected) throw new Error(`Selected V2 workline ${input.selectedWorklineId} does not exist in sourceIndex.`);

  const locatorById = uniqueMap(sourceIndex.messageLocators, (item) => item.messageLocatorId, "message locator");
  const spanById = uniqueMap(sourceIndex.spans, (item) => item.spanId, "span");
  const findingById = uniqueMap(sourceIndex.findings, (item) => item.findingId, "finding");
  const selectedFindingIds = new Set(materialStatements(selected).flatMap((statement) => statement.findingIds));
  const participationFindingIds = new Set(selected.participation.statement.findingIds);
  const statementCandidates: Array<[string, MaterialStatementCandidateV2]> = [
    ["priorContext", candidate.priorContext],
    ["whatHappened", candidate.whatHappened],
    ["possibleChange", candidate.possibleChange],
    ...candidate.supportingEvidence.map((statement, index): [string, MaterialStatementCandidateV2] =>
      [`supportingEvidence/${index}`, statement]
    ),
    ...candidate.opposingEvidence.map((statement, index): [string, MaterialStatementCandidateV2] =>
      [`opposingEvidence/${index}`, statement]
    ),
    ["falsifiableObservation", candidate.falsifiableObservation],
    ...candidate.gaps.map((statement, index): [string, MaterialStatementCandidateV2] =>
      [`gaps/${index}`, statement]
    ),
    ["humanQuestion", candidate.humanQuestion]
  ];
  const builtStatements = new Map(statementCandidates.map(([slot, statement]) => [
    slot,
    buildStatement({
      artifactId,
      revision,
      workflowRunId,
      sourceIndex,
      worklineId: selected.worklineId,
      slot,
      candidate: statement,
      selectedFindingIds,
      participationFindingIds,
      findingById,
      spanById,
      locatorById,
      enforceUserAuthority: selected.participation.account.status === "described" &&
        Boolean(selected.participation.account.human || selected.participation.account.joint)
    })
  ]));
  const statements = [...builtStatements.values()];
  const usedFindingIds = uniquePreservingOrder(statements.flatMap((statement) => statement.findingIds));
  const findings = usedFindingIds.map((findingId) => required(findingById, findingId, "finding"));
  const usedSpanIds = uniquePreservingOrder(findings.flatMap((finding) => finding.spanIds));
  const spans = usedSpanIds.map((spanId) => required(spanById, spanId, "span"));
  const usedLocatorIds = uniquePreservingOrder(spans.map((span) => span.messageLocatorId));
  const messageLocators = usedLocatorIds.map((locatorId) => required(locatorById, locatorId, "message locator"));
  const admittedSessionIds = [...selected.sessionIds];
  const evidenceIds = uniquePreservingOrder([
    ...selected.evidenceIds,
    ...admittedSessionIds.flatMap((sessionId) => {
      const session = sourceIndex.sessions.find((item) => item.sessionId === sessionId);
      if (!session) throw new Error(`Selected workline references unknown Session ${sessionId}.`);
      return session.evidenceIds;
    }),
    ...messageLocators.map((locator) => locator.evidenceId)
  ]);
  const selectedEvidence = sourceIndex.evidence.filter((evidence) => evidenceIds.includes(evidence.evidenceId));
  if (selectedEvidence.length !== evidenceIds.length) {
    const missing = evidenceIds.find((evidenceId) => !selectedEvidence.some((item) => item.evidenceId === evidenceId));
    throw new Error(`Selected dossier evidence closure lost evidence ${missing ?? "unknown"}.`);
  }

  const artifactWithoutHash = {
    schema: STRUCTURED_TODAY_DOSSIER_V2_SCHEMA,
    artifactId,
    revision,
    logicalDate: sourceIndex.logicalDate,
    workflowRunId,
    sourceIndex: {
      schema: STRUCTURED_TODAY_INDEX_V2_SCHEMA,
      artifactId: sourceIndex.artifactId,
      revision: sourceIndex.revision,
      contentHash: sourceIndex.contentHash
    },
    worklineId: selected.worklineId,
    admittedSessionIds,
    evidence: selectedEvidence,
    messageLocators,
    spans,
    findings,
    content: {
      title: candidate.title,
      priorContext: required(builtStatements, "priorContext", "statement"),
      whatHappened: required(builtStatements, "whatHappened", "statement"),
      possibleChange: required(builtStatements, "possibleChange", "statement"),
      possibleChangeAdopted: false as const,
      supportingEvidence: candidate.supportingEvidence.map((_statement, index) =>
        required(builtStatements, `supportingEvidence/${index}`, "statement")
      ),
      opposingEvidence: candidate.opposingEvidence.map((_statement, index) =>
        required(builtStatements, `opposingEvidence/${index}`, "statement")
      ),
      falsifiableObservation: required(builtStatements, "falsifiableObservation", "statement"),
      gaps: candidate.gaps.map((_statement, index) => required(builtStatements, `gaps/${index}`, "statement")),
      humanQuestion: required(builtStatements, "humanQuestion", "statement"),
      extensions: candidate.extensions.map((value) => ({ kind: "model-note", value }))
    },
    validation: {
      schema: "passed" as const,
      evidence: "passed" as const,
      semantic: "passed" as const,
      critiqueIssues: []
    },
    provenance: {
      workflowVersion: sourceIndex.provenance.workflowVersion,
      editorialContract: sourceIndex.provenance.editorialContract,
      modelFunctionVersions: Object.fromEntries(
        invocations.map((item) => [item.functionName, item.functionVersion])
      ),
      providerInvocations: invocations
    }
  };
  return TodayWorklineDossierV2Schema.parse({
    ...artifactWithoutHash,
    contentHash: canonicalContentHash(artifactWithoutHash)
  });
}

function buildStatement(input: {
  artifactId: string;
  revision: number;
  workflowRunId: string;
  sourceIndex: TodayWorklineIndexV2;
  worklineId: string;
  slot: string;
  candidate: MaterialStatementCandidateV2;
  selectedFindingIds: Set<string>;
  participationFindingIds: Set<string>;
  findingById: Map<string, AtomicFindingV1>;
  spanById: Map<string, EvidenceSpanV1>;
  locatorById: Map<string, EvidenceMessageLocatorV1>;
  enforceUserAuthority: boolean;
}): CitedStatementV1 {
  const findings = input.candidate.findingIds.map((findingId) => {
    if (!input.selectedFindingIds.has(findingId)) {
      throw new Error(`Dossier statement ${input.slot} references finding ${findingId} outside selected workline closure.`);
    }
    return required(input.findingById, findingId, "finding");
  });
  for (const finding of findings) {
    assertHumanFindingAuthority(finding, input.spanById, input.locatorById, `Dossier statement ${input.slot}`);
    if (!relationAllowsFinding(input.candidate.relation, finding.relation)) {
      throw new Error(
        `Dossier statement ${input.slot} relation ${input.candidate.relation} cannot use ${finding.relation} finding ${finding.findingId}.`
      );
    }
  }
  const spanIds = uniquePreservingOrder(findings.flatMap((finding) => finding.spanIds));
  if (input.enforceUserAuthority && input.candidate.findingIds.some((findingId) => input.participationFindingIds.has(findingId))) {
    const hasUserSpan = spanIds.some((spanId) => {
      const span = required(input.spanById, spanId, "span");
      return required(input.locatorById, span.messageLocatorId, "message locator").authorKind === "human";
    });
    if (!hasUserSpan) throw new Error(`Dossier statement ${input.slot} human participation basis lacks a user-authored span.`);
  }
  const statementWithoutId = {
    text: input.candidate.text,
    relation: input.candidate.relation,
    findingIds: input.candidate.findingIds,
    spanIds
  };
  return CitedStatementSchema.parse({
    statementId: `dossier-statement-v2-${sha256Text(JSON.stringify({
      artifactId: input.artifactId,
      revision: input.revision,
      workflowRunId: input.workflowRunId,
      sourceIndex: {
        artifactId: input.sourceIndex.artifactId,
        revision: input.sourceIndex.revision,
        contentHash: input.sourceIndex.contentHash
      },
      worklineId: input.worklineId,
      slot: input.slot,
      ...statementWithoutId
    })).slice(0, 32)}`,
    ...statementWithoutId
  });
}

function materialStatements(workline: TodayWorklineV2): CitedStatementV1[] {
  return [workline.summary, workline.currentStop, workline.possibleChange, workline.participation.statement];
}

function relationAllowsFinding(statement: EvidenceRelationKindV1, finding: EvidenceRelationKindV1): boolean {
  if (statement === "source-span") return finding === "source-span";
  if (statement === "inference-basis") return finding === "source-span" || finding === "inference-basis";
  return statement === finding;
}

function assertHumanFindingAuthority(
  finding: AtomicFindingV1,
  spanById: Map<string, EvidenceSpanV1>,
  locatorById: Map<string, EvidenceMessageLocatorV1>,
  label: string
): void {
  if (finding.claimKind !== "human-participation" && finding.claimKind !== "human-adoption") return;
  const hasHumanAuthor = finding.spanIds.some((spanId) => {
    const span = required(spanById, spanId, "span");
    return required(locatorById, span.messageLocatorId, "message locator").authorKind === "human";
  });
  if (!hasHumanAuthor) {
    throw new Error(`${label} uses ${finding.claimKind} finding ${finding.findingId} without a human-authored span.`);
  }
}

function uniqueMap<T>(values: T[], key: (value: T) => string, label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = key(value);
    if (result.has(id)) throw new Error(`Duplicate ${label} ${id}.`);
    result.set(id, value);
  }
  return result;
}

function uniquePreservingOrder<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function required<K, V>(map: Map<K, V>, key: K, label: string): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Unknown ${label} ${String(key)}.`);
  return value;
}
