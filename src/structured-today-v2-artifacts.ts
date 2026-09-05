import { z } from "zod";
import {
  StructuredTodayModelInvocationSchema,
  canonicalContentHash,
  participationAccount,
  sha256Text,
  type SessionDispositionV1,
  type StructuredTodayModelInvocationV1
} from "./structured-today-contracts";
import {
  AtomicFindingSchema,
  CitedStatementSchema,
  EvidenceMessageLocatorSchema,
  EvidenceSpanSchema,
  type AtomicFindingV1,
  type CitedStatementV1,
  type EvidenceMessageLocatorV1,
  type EvidenceRelationKindV1,
  type EvidenceSpanV1
} from "./structured-today-evidence-spans";
import {
  SynthesizeWorklineIndexV2CandidateSchema,
  type MaterialStatementCandidateV2,
  type SynthesizeWorklineIndexV2Candidate,
  type WorklineCandidateV2
} from "./structured-today-v2-model-functions";
import {
  ResolvedDigestFindingsSchema,
  StructuredTodayIndexWorkflowInputV2Schema,
  type ResolvedDigestFindingsV1,
  type StructuredTodayIndexWorkflowInputV2
} from "./structured-today-v2-workflow";
import {
  STRUCTURED_TODAY_INDEX_V2_SCHEMA,
  TodayWorklineIndexV2Schema,
  type TodayWorklineIndexV2,
  type TodayWorklineV2
} from "./structured-today-v2-contracts";

export interface BuildStructuredTodayIndexV2Input {
  initial: StructuredTodayIndexWorkflowInputV2;
  resolvedDigests: ResolvedDigestFindingsV1[];
  executionDispositions: StructuredTodayV2ExecutionDisposition[];
  synthesis: SynthesizeWorklineIndexV2Candidate;
  invocations: StructuredTodayModelInvocationV1[];
  runtimeRunId: string;
}

export const StructuredTodayV2ExecutionDispositionSchema = z.object({
  sessionId: z.string().trim().min(1),
  kind: z.enum(["excluded", "failed"]),
  reason: z.string().trim().min(1)
}).strict();

export type StructuredTodayV2ExecutionDisposition = z.infer<typeof StructuredTodayV2ExecutionDispositionSchema>;

export function buildStructuredTodayIndexV2(input: BuildStructuredTodayIndexV2Input): TodayWorklineIndexV2 {
  const initial = StructuredTodayIndexWorkflowInputV2Schema.parse(input.initial);
  const synthesis = SynthesizeWorklineIndexV2CandidateSchema.parse(input.synthesis);
  const invocations = input.invocations.map((item) => StructuredTodayModelInvocationSchema.parse(item));
  if (!input.runtimeRunId.trim() || input.runtimeRunId !== initial.workflowRunId) {
    throw new Error("V2 runtimeRunId must equal the frozen workflowRunId.");
  }

  const sessionInputById = uniqueMap(
    initial.sessions,
    (item) => item.session.sessionId,
    "workflow Session"
  );
  const resolvedBySession = uniqueMap(
    input.resolvedDigests.map((item) => ResolvedDigestFindingsSchema.parse(item)),
    (item) => item.sessionId,
    "resolved digest"
  );
  const executionBySession = uniqueMap(
    input.executionDispositions.map((item) => StructuredTodayV2ExecutionDispositionSchema.parse(item)),
    (item) => item.sessionId,
    "execution disposition"
  );
  const orderedResolved = initial.sessions.flatMap((item) => {
    const resolved = resolvedBySession.get(item.session.sessionId);
    return resolved ? [resolved] : [];
  });
  if (orderedResolved.length !== resolvedBySession.size) {
    const unknown = [...resolvedBySession.keys()].find((sessionId) => !sessionInputById.has(sessionId));
    throw new Error(`Resolved digest references unknown Session ${unknown ?? "unknown"}.`);
  }
  for (const [sessionId] of executionBySession) {
    const sessionInput = sessionInputById.get(sessionId);
    if (!sessionInput) throw new Error(`Execution disposition references unknown Session ${sessionId}.`);
    if (sessionInput.preDisposition) throw new Error(`Session ${sessionId} has both preDisposition and execution disposition.`);
    if (resolvedBySession.has(sessionId)) throw new Error(`Session ${sessionId} has both resolved findings and execution disposition.`);
  }

  const pool = collectResolvedEvidence(initial, orderedResolved);
  const worklineIds = uniqueStrings(synthesis.worklines.map((item) => item.worklineId), "workline ID");
  const worklineIdSet = new Set(worklineIds);
  const unresolvedSessionIds = uniqueStrings(synthesis.unresolvedSessionIds, "unresolved Session ID");
  const unresolvedSet = new Set(unresolvedSessionIds);
  for (const sessionId of unresolvedSessionIds) {
    const sessionInput = sessionInputById.get(sessionId);
    if (!sessionInput) throw new Error(`Synthesis marks unknown Session ${sessionId} unresolved.`);
    if (sessionInput.preDisposition) throw new Error(`Pre-disposed Session ${sessionId} cannot be synthesized as unresolved.`);
    if (executionBySession.has(sessionId)) throw new Error(`Execution-failed Session ${sessionId} cannot be synthesized as unresolved.`);
  }

  const assignments = buildAssignments(
    synthesis,
    sessionInputById,
    resolvedBySession,
    executionBySession,
    worklineIdSet,
    unresolvedSet
  );
  const builtWorklines = synthesis.worklines.map((candidate) => buildWorkline({
    initial,
    candidate,
    assignedSessionIds: assignedSessionsForWorkline(initial, assignments, candidate.worklineId),
    pool
  }));

  const usedFindingIds = uniquePreservingOrder(builtWorklines.flatMap((item) => materialStatements(item)
    .flatMap((statement) => statement.findingIds)));
  const findings = usedFindingIds.map((findingId) => required(pool.findingById, findingId, "finding"));
  const usedSpanIds = uniquePreservingOrder(findings.flatMap((finding) => finding.spanIds));
  const spans = usedSpanIds.map((spanId) => required(pool.spanById, spanId, "span"));
  const usedLocatorIds = uniquePreservingOrder(spans.map((span) => span.messageLocatorId));
  const messageLocators = usedLocatorIds.map((locatorId) => required(pool.locatorById, locatorId, "message locator"));

  const dispositions = buildDispositions(initial, resolvedBySession, executionBySession, assignments, unresolvedSet);
  const coverage = coverageFrom(dispositions, initial.sessions.length);
  const artifactWithoutHash = {
    schema: STRUCTURED_TODAY_INDEX_V2_SCHEMA,
    artifactId: initial.artifactId,
    revision: initial.revision,
    logicalDate: initial.logicalDate,
    workflowRunId: input.runtimeRunId,
    evidenceManifestId: initial.evidenceManifestId,
    sessions: initial.sessions.map((item) => item.session),
    evidence: initial.evidence,
    messageLocators,
    spans,
    findings,
    dispositions,
    worklines: builtWorklines,
    coverage,
    provenance: {
      workflowVersion: initial.workflowVersion,
      editorialContract: initial.editorialContract.ref,
      modelFunctionVersions: Object.fromEntries(
        invocations.map((item) => [item.functionName, item.functionVersion])
      ),
      providerInvocations: invocations
    }
  };
  return TodayWorklineIndexV2Schema.parse({
    ...artifactWithoutHash,
    contentHash: canonicalContentHash(artifactWithoutHash)
  });
}

interface ResolvedEvidencePool {
  locatorById: Map<string, EvidenceMessageLocatorV1>;
  spanById: Map<string, EvidenceSpanV1>;
  findingById: Map<string, AtomicFindingV1>;
  findingOrigins: Map<string, Set<string>>;
}

function collectResolvedEvidence(
  initial: StructuredTodayIndexWorkflowInputV2,
  resolvedDigests: ResolvedDigestFindingsV1[]
): ResolvedEvidencePool {
  const locatorById = new Map<string, EvidenceMessageLocatorV1>();
  const spanById = new Map<string, EvidenceSpanV1>();
  const findingById = new Map<string, AtomicFindingV1>();
  const findingOrigins = new Map<string, Set<string>>();
  const sessionById = new Map(initial.sessions.map((item) => [item.session.sessionId, item]));

  for (const digest of resolvedDigests) {
    const sessionInput = sessionById.get(digest.sessionId);
    if (!sessionInput) throw new Error(`Resolved digest references unknown Session ${digest.sessionId}.`);
    if (sessionInput.preDisposition || !sessionInput.provenanceSession ||
      sessionInput.provenanceSession.admittedMessages.length === 0) {
      throw new Error(`Pre-disposed or evidence-empty Session ${digest.sessionId} cannot have resolved findings.`);
    }
    const admittedByLocator = new Map(sessionInput.provenanceSession.admittedMessages.map((message) => [
      message.locator.messageLocatorId,
      message.locator
    ]));
    const localLocatorById = uniqueMap(digest.messageLocators, (item) => item.messageLocatorId, "digest message locator");
    uniqueMap(digest.messageLocators, (item) => item.messageKey, "digest message key");
    for (const locatorInput of digest.messageLocators) {
      const locator = EvidenceMessageLocatorSchema.parse(locatorInput);
      const admitted = admittedByLocator.get(locator.messageLocatorId);
      if (!admitted || JSON.stringify(admitted) !== JSON.stringify(locator) || locator.sessionId !== digest.sessionId) {
        throw new Error(`Resolved digest ${digest.sessionId} contains a locator outside its admitted provenance.`);
      }
      mergeIdentity(locatorById, locator.messageLocatorId, locator, "message locator");
    }

    const localSpanById = uniqueMap(digest.spans, (item) => item.spanId, "digest span");
    for (const spanInput of digest.spans) {
      const span = EvidenceSpanSchema.parse(spanInput);
      const locator = localLocatorById.get(span.messageLocatorId);
      if (!locator || span.messageKey !== locator.messageKey || span.evidenceId !== locator.evidenceId) {
        throw new Error(`Resolved digest ${digest.sessionId} contains a span outside its locator set.`);
      }
      mergeIdentity(spanById, span.spanId, span, "span");
    }

    uniqueMap(digest.findings, (item) => item.findingId, "digest finding");
    for (const findingInput of digest.findings) {
      const finding = AtomicFindingSchema.parse(findingInput);
      for (const spanId of finding.spanIds) {
        if (!localSpanById.has(spanId)) {
          throw new Error(`Resolved finding ${finding.findingId} references a span outside Session ${digest.sessionId}.`);
        }
      }
      mergeIdentity(findingById, finding.findingId, finding, "finding");
      const origins = findingOrigins.get(finding.findingId) ?? new Set<string>();
      origins.add(digest.sessionId);
      findingOrigins.set(finding.findingId, origins);
    }
  }
  return { locatorById, spanById, findingById, findingOrigins };
}

function buildAssignments(
  synthesis: SynthesizeWorklineIndexV2Candidate,
  sessionInputById: Map<string, StructuredTodayIndexWorkflowInputV2["sessions"][number]>,
  resolvedBySession: Map<string, ResolvedDigestFindingsV1>,
  executionBySession: Map<string, StructuredTodayV2ExecutionDisposition>,
  worklineIds: Set<string>,
  unresolved: Set<string>
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const assignment of synthesis.assignments) {
    if (result.has(assignment.sessionId)) throw new Error(`Synthesis duplicates assignment for Session ${assignment.sessionId}.`);
    const sessionInput = sessionInputById.get(assignment.sessionId);
    if (!sessionInput) throw new Error(`Synthesis assigns unknown Session ${assignment.sessionId}.`);
    if (sessionInput.preDisposition) throw new Error(`Synthesis assigns pre-disposed Session ${assignment.sessionId}.`);
    if (executionBySession.has(assignment.sessionId)) {
      throw new Error(`Synthesis assigns execution-failed Session ${assignment.sessionId}.`);
    }
    const resolved = resolvedBySession.get(assignment.sessionId);
    if (!resolved || resolved.findings.length === 0) {
      throw new Error(`Synthesis assigns Session ${assignment.sessionId} without resolved findings.`);
    }
    if (unresolved.has(assignment.sessionId)) {
      throw new Error(`Synthesis both assigns and marks Session ${assignment.sessionId} unresolved.`);
    }
    const ids = uniqueStrings(assignment.worklineIds, `workline assignment for ${assignment.sessionId}`);
    ids.forEach((worklineId) => {
      if (!worklineIds.has(worklineId)) throw new Error(`Synthesis assigns unknown workline ${worklineId}.`);
    });
    result.set(assignment.sessionId, ids);
  }
  return result;
}

function assignedSessionsForWorkline(
  initial: StructuredTodayIndexWorkflowInputV2,
  assignments: Map<string, string[]>,
  worklineId: string
): string[] {
  return initial.sessions.flatMap((item) =>
    assignments.get(item.session.sessionId)?.includes(worklineId) ? [item.session.sessionId] : []
  );
}

function buildWorkline(input: {
  initial: StructuredTodayIndexWorkflowInputV2;
  candidate: WorklineCandidateV2;
  assignedSessionIds: string[];
  pool: ResolvedEvidencePool;
}): TodayWorklineV2 {
  const candidateSessionIds = uniqueStrings(input.candidate.sessionIds, `Session membership for ${input.candidate.worklineId}`);
  if (!sameSet(candidateSessionIds, input.assignedSessionIds)) {
    throw new Error(`Workline ${input.candidate.worklineId} Session membership is not reciprocal with assignments.`);
  }
  const statementInputs: Array<[string, MaterialStatementCandidateV2]> = [
    ["summary", input.candidate.summary],
    ["currentStop", input.candidate.currentStop],
    ["possibleChange", input.candidate.possibleChange],
    ["participation", input.candidate.participation.statement]
  ];
  const builtStatements = new Map(statementInputs.map(([slot, candidate]) => [
    slot,
    buildStatement({
      artifactId: input.initial.artifactId,
      revision: input.initial.revision,
      worklineId: input.candidate.worklineId,
      slot,
      candidate,
      pool: input.pool
    })
  ]));
  const statements = [...builtStatements.values()];
  const participationStatement = required(builtStatements, "participation", "statement");
  const participation = participationAccount(input.candidate.participation.account);
  if (participation.status === "described" && (participation.human || participation.joint)) {
    const hasUserSpan = participationStatement.spanIds.some((spanId) => {
      const span = required(input.pool.spanById, spanId, "span");
      return required(input.pool.locatorById, span.messageLocatorId, "message locator").authorKind === "human";
    });
    if (!hasUserSpan) {
      throw new Error(`Workline ${input.candidate.worklineId} human/joint participation lacks a user-authored source span.`);
    }
  }
  const worklineFindingIds = new Set(statements.flatMap((statement) => statement.findingIds));
  for (const sessionId of input.assignedSessionIds) {
    if (![...worklineFindingIds].some((findingId) => input.pool.findingOrigins.get(findingId)?.has(sessionId))) {
      throw new Error(`Workline ${input.candidate.worklineId} has no verified finding from assigned Session ${sessionId}.`);
    }
  }
  const evidenceIds = uniquePreservingOrder([
    ...input.assignedSessionIds.flatMap((sessionId) =>
      required(new Map(input.initial.sessions.map((item) => [item.session.sessionId, item.session])), sessionId, "Session").evidenceIds
    ),
    ...statements.flatMap((statement) => statement.spanIds.map((spanId) => {
      const span = required(input.pool.spanById, spanId, "span");
      return required(input.pool.locatorById, span.messageLocatorId, "message locator").evidenceId;
    }))
  ]);
  return {
    worklineId: input.candidate.worklineId,
    title: input.candidate.title,
    summary: required(builtStatements, "summary", "statement"),
    startedAt: input.candidate.startedAt,
    ...(input.candidate.endedAt ? { endedAt: input.candidate.endedAt } : {}),
    currentStop: required(builtStatements, "currentStop", "statement"),
    possibleChange: required(builtStatements, "possibleChange", "statement"),
    possibleChangeAdopted: false,
    participation: {
      account: participation,
      statement: participationStatement
    },
    evidenceReadiness: input.candidate.evidenceReadiness,
    sessionIds: input.assignedSessionIds,
    evidenceIds,
    extensions: input.candidate.extensions.map((value) => ({ kind: "model-note", value }))
  };
}

function buildStatement(input: {
  artifactId: string;
  revision: number;
  worklineId: string;
  slot: string;
  candidate: MaterialStatementCandidateV2;
  pool: ResolvedEvidencePool;
}): CitedStatementV1 {
  const findings = input.candidate.findingIds.map((findingId) => required(input.pool.findingById, findingId, "finding"));
  for (const finding of findings) {
    assertHumanFindingAuthority(finding, input.pool.spanById, input.pool.locatorById, `Statement ${input.worklineId}/${input.slot}`);
    if (!relationAllowsFinding(input.candidate.relation, finding.relation)) {
      throw new Error(
        `Statement ${input.worklineId}/${input.slot} relation ${input.candidate.relation} cannot use ${finding.relation} finding ${finding.findingId}.`
      );
    }
  }
  const spanIds = uniquePreservingOrder(findings.flatMap((finding) => finding.spanIds));
  const statementWithoutId = {
    text: input.candidate.text,
    relation: input.candidate.relation,
    findingIds: input.candidate.findingIds,
    spanIds
  };
  return CitedStatementSchema.parse({
    statementId: `statement-v2-${sha256Text(JSON.stringify({
      artifactId: input.artifactId,
      revision: input.revision,
      worklineId: input.worklineId,
      slot: input.slot,
      ...statementWithoutId
    })).slice(0, 32)}`,
    ...statementWithoutId
  });
}

function buildDispositions(
  initial: StructuredTodayIndexWorkflowInputV2,
  resolvedBySession: Map<string, ResolvedDigestFindingsV1>,
  executionBySession: Map<string, StructuredTodayV2ExecutionDisposition>,
  assignments: Map<string, string[]>,
  unresolved: Set<string>
): SessionDispositionV1[] {
  return initial.sessions.map((item): SessionDispositionV1 => {
    const sessionId = item.session.sessionId;
    if (item.preDisposition) {
      return {
        sessionId,
        kind: item.preDisposition.kind,
        worklineIds: [],
        reason: item.preDisposition.reason
      };
    }
    const execution = executionBySession.get(sessionId);
    if (execution) {
      return {
        sessionId,
        kind: execution.kind,
        worklineIds: [],
        reason: execution.reason
      };
    }
    const resolved = resolvedBySession.get(sessionId);
    if (!resolved) {
      return { sessionId, kind: "unresolved", worklineIds: [], reason: "Session produced no resolved digest findings." };
    }
    if (resolved.findings.length === 0) {
      return { sessionId, kind: "unresolved", worklineIds: [], reason: "Session produced no verified findings." };
    }
    const worklineIds = assignments.get(sessionId) ?? [];
    if (worklineIds.length > 0) {
      return {
        sessionId,
        kind: "assigned",
        worklineIds,
        nodeOutputId: `resolved-v2-${sha256Text(JSON.stringify(resolved)).slice(0, 32)}`
      };
    }
    return {
      sessionId,
      kind: "unresolved",
      worklineIds: [],
      reason: unresolved.has(sessionId)
        ? "Workline synthesis explicitly left this Session unresolved."
        : "Workline synthesis omitted this resolved Session."
    };
  });
}

function coverageFrom(dispositions: SessionDispositionV1[], admitted: number) {
  const count = (kind: SessionDispositionV1["kind"]) => dispositions.filter((item) => item.kind === kind).length;
  const failed = count("failed");
  const unresolved = count("unresolved");
  return {
    admitted,
    assigned: count("assigned"),
    excluded: count("excluded"),
    failed,
    unresolved,
    complete: failed === 0 && unresolved === 0
  };
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

function uniqueMap<T>(items: T[], key: (item: T) => string, label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    const id = key(item);
    if (result.has(id)) throw new Error(`Duplicate ${label} ${id}.`);
    result.set(id, item);
  }
  return result;
}

function mergeIdentity<T>(target: Map<string, T>, id: string, value: T, label: string): void {
  const existing = target.get(id);
  if (existing && JSON.stringify(existing) !== JSON.stringify(value)) {
    throw new Error(`Conflicting ${label} identity ${id}.`);
  }
  if (!existing) target.set(id, value);
}

function uniqueStrings(values: string[], label: string): string[] {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}.`);
  return values;
}

function uniquePreservingOrder<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function sameSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function required<K, V>(map: Map<K, V>, key: K, label: string): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Unknown ${label} ${String(key)}.`);
  return value;
}
