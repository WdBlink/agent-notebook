import { createHash } from "node:crypto";
import {
  AtomicFindingSchema,
  StructuredTodayProvenanceSessionSchema,
  resolveEvidenceSpan,
  type EvidenceSpanResolutionFailureV1,
  type ParsedEvidenceMessageV1,
  type StructuredTodayProvenanceSessionV1
} from "./structured-today-evidence-spans";
import {
  DigestFindingCandidateSetSchema,
  ResolvedDigestFindingsSchema,
  type DigestFindingCandidateSetV1,
  type ResolvedDigestFindingsV1
} from "./structured-today-v2-workflow";

export type DigestFindingUnresolvedReasonV1 =
  | EvidenceSpanResolutionFailureV1
  | "provenance-integrity-mismatch"
  | "author-authority-mismatch";

/**
 * Resolves model-proposed messageKey + exactQuote pairs against one exact,
 * already-admitted provenance Session. It creates no prose and performs no
 * transcript search outside the enumerated messages.
 */
export function resolveDigestFindingCandidates(
  candidateSetInput: DigestFindingCandidateSetV1,
  provenanceSessionInput: StructuredTodayProvenanceSessionV1
): ResolvedDigestFindingsV1 {
  const candidateSet = DigestFindingCandidateSetSchema.parse(candidateSetInput);
  const rawSessionId = rawProvenanceSessionId(provenanceSessionInput);
  if (candidateSet.sessionId !== rawSessionId) {
    throw new Error("Digest finding candidate Session does not match the provenance Session.");
  }

  const provenanceResult = StructuredTodayProvenanceSessionSchema.safeParse(provenanceSessionInput);
  if (!provenanceResult.success) {
    if (provenanceResult.error.issues.some(isProvenanceIntegrityIssue)) {
      return unresolvedResult(candidateSet, "provenance-integrity-mismatch");
    }
    throw provenanceResult.error;
  }
  const provenance = provenanceResult.data;
  const enumeratedMessages: ParsedEvidenceMessageV1[] = provenance.admittedMessages.map((message) => ({
    locator: message.locator,
    content: message.content,
    projectionKind: "primary"
  }));
  const locatorById = new Map<string, typeof provenance.admittedMessages[number]["locator"]>();
  const spanById = new Map<string, ResolvedDigestFindingsV1["spans"][number]>();
  const findingById = new Map<string, ResolvedDigestFindingsV1["findings"][number]>();
  const unresolvedCandidates: ResolvedDigestFindingsV1["unresolvedCandidates"] = [];

  for (const candidate of candidateSet.findings) {
    const resolution = resolveEvidenceSpan({
      messageKey: candidate.messageKey,
      exactQuote: candidate.exactQuote
    }, enumeratedMessages);
    if (resolution.status === "unresolved") {
      unresolvedCandidates.push({ ...candidate, reason: resolution.reason });
      continue;
    }
    const span = resolution.span;
    const locator = provenance.admittedMessages.find((message) =>
      message.locator.messageLocatorId === span.messageLocatorId
    )?.locator;
    if (!locator) {
      unresolvedCandidates.push({ ...candidate, reason: "message-integrity-mismatch" });
      continue;
    }
    if ((candidate.claimKind === "human-participation" || candidate.claimKind === "human-adoption") &&
      locator.authorKind !== "human") {
      unresolvedCandidates.push({ ...candidate, reason: "author-authority-mismatch" });
      continue;
    }
    const findingId = `finding-v1-${hashTuple([
      candidateSet.sessionId,
      candidate.text,
      candidate.claimKind,
      candidate.messageKey,
      candidate.exactQuote,
      "source-span"
    ])}`;
    const finding = AtomicFindingSchema.parse({
      findingId,
      text: candidate.text,
      claimKind: candidate.claimKind,
      relation: "source-span",
      spanIds: [span.spanId]
    });
    locatorById.set(locator.messageLocatorId, locator);
    spanById.set(span.spanId, span);
    const previousFinding = findingById.get(findingId);
    if (previousFinding && JSON.stringify(previousFinding) !== JSON.stringify(finding)) {
      throw new Error(`Digest finding identity collision: ${findingId}`);
    }
    findingById.set(findingId, finding);
  }

  return ResolvedDigestFindingsSchema.parse({
    sessionId: candidateSet.sessionId,
    messageLocators: [...locatorById.values()],
    spans: [...spanById.values()],
    findings: [...findingById.values()],
    unresolvedCandidates
  });
}

function unresolvedResult(
  candidateSet: DigestFindingCandidateSetV1,
  reason: DigestFindingUnresolvedReasonV1
): ResolvedDigestFindingsV1 {
  return ResolvedDigestFindingsSchema.parse({
    sessionId: candidateSet.sessionId,
    messageLocators: [],
    spans: [],
    findings: [],
    unresolvedCandidates: candidateSet.findings.map((candidate) => ({ ...candidate, reason }))
  });
}

function rawProvenanceSessionId(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    typeof (value as { sessionId?: unknown }).sessionId !== "string" ||
    !(value as { sessionId: string }).sessionId.trim()) {
    throw new Error("Provenance Session has no valid sessionId.");
  }
  return (value as { sessionId: string }).sessionId;
}

function isProvenanceIntegrityIssue(issue: { path: PropertyKey[]; message: string }): boolean {
  return issue.path.includes("admittedMessages") || issue.path.includes("admittedCorpusHash") ||
    /hash|content/i.test(issue.message);
}

function hashTuple(values: string[]): string {
  return createHash("sha256")
    .update(JSON.stringify(["atomic-finding/v1", ...values]), "utf8")
    .digest("hex");
}
