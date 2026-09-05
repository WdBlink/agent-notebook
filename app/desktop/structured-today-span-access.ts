import path from "node:path";
import {
  parseEvidenceRecords,
  verifyEvidenceSpan,
  type EvidenceSourceRecordV1
} from "../../src/structured-today-evidence-spans";
import type {
  TodayWorklineDossierV2,
  TodayWorklineIndexV2
} from "../../src/structured-today-v2-contracts";
import { scanVerifiedTranscriptRecords } from "./transcript-source-reader";

export interface VerifiedStructuredTodaySpanTarget {
  artifactId: string;
  revision: number;
  contentHash: string;
  logicalDate: string;
  statementId: string;
  spanId: string;
  evidenceId: string;
  provider: "codex" | "claude";
  sessionId: string;
  sourcePath: string;
  messageKey: string;
  messageLocatorId: string;
  role: "user" | "assistant";
  authorKind: "human" | "agent" | "automation" | "host-notification" | "unknown";
  content: string;
  utf16Start: number;
  utf16End: number;
  messages: Array<{
    messageKey: string;
    role: "user" | "assistant";
    authorKind: "human" | "agent" | "automation" | "host-notification" | "unknown";
    content: string;
  }>;
  omittedBefore: number;
  omittedAfter: number;
}

/** Resolves and re-verifies one exact span from a trusted owner artifact. */
export async function readStructuredTodaySpanTarget(input: {
  owner: TodayWorklineIndexV2 | TodayWorklineDossierV2;
  statementId: string;
  spanId: string;
}): Promise<VerifiedStructuredTodaySpanTarget> {
  const statement = materialStatements(input.owner).find((item) => item.statementId === input.statementId);
  if (!statement || !statement.spanIds.includes(input.spanId)) {
    throw new Error("消息级引用不属于指定陈述或 owner artifact。");
  }
  const span = input.owner.spans.find((item) => item.spanId === input.spanId);
  const locator = span && input.owner.messageLocators.find((item) => item.messageLocatorId === span.messageLocatorId);
  const evidence = locator && input.owner.evidence.find((item) => item.evidenceId === locator.evidenceId);
  if (!span || !locator || !evidence || evidence.sourceKind !== "session" ||
    evidence.provider !== locator.provider || evidence.sessionId !== locator.sessionId ||
    !path.isAbsolute(evidence.sourcePath) ||
    evidence.range !== `bytes 0-${locator.frozenSourcePrefix.byteLength}` ||
    evidence.contentHash !== locator.frozenSourcePrefix.contentHash) {
    throw new Error("消息级引用的 Session evidence tuple 无法通过 owner artifact 校验。");
  }
  const records: EvidenceSourceRecordV1[] = [];
  const scan = await scanVerifiedTranscriptRecords(evidence.sourcePath, {
    canonicalPath: evidence.sourcePath,
    sha256: locator.frozenSourcePrefix.contentHash,
    byteLength: locator.frozenSourcePrefix.byteLength,
    coverage: { startByte: 0, endByte: locator.frozenSourcePrefix.byteLength }
  }, (record) => { records.push(record); });
  const parsed = parseEvidenceRecords({
    records,
    provider: locator.provider,
    sessionId: locator.sessionId,
    evidenceId: locator.evidenceId,
    frozenSourcePrefix: { byteLength: scan.byteLength, contentHash: scan.contentHash },
    parserVersion: locator.parserVersion,
    admissionPolicyVersion: locator.admissionPolicyVersion,
    // Replay the host classification frozen by the trusted owner, not today's scanner defaults.
    ...(locator.role === "user" && locator.authorKind !== "host-notification"
      ? { defaultUserAuthorKind: locator.authorKind } : {}),
    authorKindsByRecordRange: Object.fromEntries(input.owner.messageLocators.flatMap((item) =>
      item.evidenceId === locator.evidenceId && item.role === "user" &&
      (item.authorKind === "human" || item.authorKind === "automation" || item.authorKind === "host-notification")
        ? [[`${item.rawRecord.start}:${item.rawRecord.end}`, item.authorKind]] : []
    ))
  });
  const message = parsed.messages.find((item) => item.locator.messageLocatorId === locator.messageLocatorId);
  if (!message || JSON.stringify(message.locator) !== JSON.stringify(locator)) {
    throw new Error("消息级引用无法从冻结 Session record 精确重建。");
  }
  const verification = verifyEvidenceSpan(span, message);
  if (verification.status !== "verified") {
    throw new Error(`消息级引用 selector 校验失败：${verification.reason}`);
  }
  const messageIndex = parsed.messages.findIndex((item) => item.locator.messageLocatorId === locator.messageLocatorId);
  const windowStart = Math.max(0, messageIndex - 40);
  const windowEnd = Math.min(parsed.messages.length, messageIndex + 41);
  return {
    artifactId: input.owner.artifactId,
    revision: input.owner.revision,
    contentHash: input.owner.contentHash,
    logicalDate: input.owner.logicalDate,
    statementId: statement.statementId,
    spanId: span.spanId,
    evidenceId: evidence.evidenceId,
    provider: locator.provider,
    sessionId: locator.sessionId,
    sourcePath: evidence.sourcePath,
    messageKey: locator.messageKey,
    messageLocatorId: locator.messageLocatorId,
    role: locator.role,
    authorKind: locator.authorKind,
    content: message.content,
    utf16Start: verification.utf16Start,
    utf16End: verification.utf16End,
    messages: parsed.messages.slice(windowStart, windowEnd).map((item) => ({
      messageKey: item.locator.messageKey,
      role: item.locator.role,
      authorKind: item.locator.authorKind,
      content: item.content
    })),
    omittedBefore: windowStart,
    omittedAfter: parsed.messages.length - windowEnd
  };
}

function materialStatements(owner: TodayWorklineIndexV2 | TodayWorklineDossierV2) {
  if (owner.schema === "today-workline-index/v2") {
    return owner.worklines.flatMap((workline) => [
      workline.summary,
      workline.currentStop,
      workline.possibleChange,
      workline.participation.statement
    ]);
  }
  return [
    owner.content.priorContext,
    owner.content.whatHappened,
    owner.content.possibleChange,
    ...owner.content.supportingEvidence,
    ...owner.content.opposingEvidence,
    owner.content.falsifiableObservation,
    ...owner.content.gaps,
    owner.content.humanQuestion
  ];
}
