import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  StructuredTodayProvenanceSessionSchema,
  parseEvidenceJsonl,
  type EvidenceJsonlParseResultV1,
  type StructuredTodayProvenanceSessionV1
} from "../src/structured-today-evidence-spans";
import { resolveDigestFindingCandidates } from "../src/structured-today-v2-findings";
import {
  DigestFindingCandidateSetSchema,
  ResolvedDigestFindingsSchema,
  type DigestFindingCandidateSetV1
} from "../src/structured-today-v2-workflow";

test("resolved findings preserve candidate order and partial failures remain typed unresolved", () => {
  const provenance = provenanceSession(["alpha source", "repeat repeat", "gamma source"]);
  const [alpha, repeated, gamma] = provenance.admittedMessages;
  const candidates = candidateSet([
    candidate("Gamma finding", gamma!.locator.messageKey, "gamma source"),
    candidate("Forged finding", `msg-v2-${"f".repeat(64)}`, "missing"),
    candidate("Alpha finding", alpha!.locator.messageKey, "alpha source"),
    candidate("Repeated finding", repeated!.locator.messageKey, "repeat")
  ]);

  const result = resolveDigestFindingCandidates(candidates, provenance);
  assert.deepEqual(result.findings.map((finding) => finding.text), ["Gamma finding", "Alpha finding"]);
  assert.deepEqual(result.messageLocators.map((locator) => locator.messageKey), [
    gamma!.locator.messageKey,
    alpha!.locator.messageKey
  ]);
  assert.deepEqual(result.unresolvedCandidates.map((item) => item.reason), [
    "unknown-message-key",
    "repeated-quote"
  ]);
  assert.doesNotThrow(() => ResolvedDigestFindingsSchema.parse(result));
});

test("duplicate resolved candidates collapse to the minimal locator and span closure", () => {
  const provenance = provenanceSession(["one exact source"]);
  const message = provenance.admittedMessages[0]!;
  const duplicate = candidate("Same finding", message.locator.messageKey, "exact source");
  const candidates = candidateSet([
    duplicate,
    duplicate,
    candidate("Different semantic finding", message.locator.messageKey, "exact source")
  ]);

  const result = resolveDigestFindingCandidates(candidates, provenance);
  assert.equal(result.messageLocators.length, 1);
  assert.equal(result.spans.length, 1);
  assert.equal(result.findings.length, 2);
  assert.deepEqual(result.findings.map((finding) => finding.text), ["Same finding", "Different semantic finding"]);
  assert.deepEqual(result.findings.map((finding) => finding.spanIds), [
    [result.spans[0]!.spanId],
    [result.spans[0]!.spanId]
  ]);
});

test("candidate and provenance Session identities must match", () => {
  const provenance = provenanceSession(["source"]);
  const candidates = DigestFindingCandidateSetSchema.parse({
    sessionId: "another-session",
    findings: [candidate("Finding", provenance.admittedMessages[0]!.locator.messageKey, "source")],
    uncertainties: []
  });
  assert.throws(
    () => resolveDigestFindingCandidates(candidates, provenance),
    /does not match the provenance Session/u
  );
});

test("tampered admitted content hashes fail closed as unresolved with an empty evidence closure", () => {
  const provenance = provenanceSession(["trusted source"]);
  const candidates = candidateSet([
    candidate("Trusted finding", provenance.admittedMessages[0]!.locator.messageKey, "trusted source")
  ]);
  const tampered = structuredClone(provenance);
  tampered.admittedMessages[0]!.contentHash = "f".repeat(64);

  const result = resolveDigestFindingCandidates(candidates, tampered);
  assert.deepEqual(result.messageLocators, []);
  assert.deepEqual(result.spans, []);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.unresolvedCandidates.map((item) => item.reason), ["provenance-integrity-mismatch"]);
});

test("append captures keep finding identity stable while locator and span authority change", () => {
  const originalBytes = jsonl([codexMessage("stable source", "a1")]);
  const appendedBytes = Buffer.concat([originalBytes, jsonl([codexMessage("later source", "a2")])]);
  const original = provenanceFromParse(parseCodex(originalBytes));
  const appended = provenanceFromParse(parseCodex(appendedBytes));
  const candidates = candidateSet([
    candidate("Stable finding", original.admittedMessages[0]!.locator.messageKey, "stable source")
  ]);

  const first = resolveDigestFindingCandidates(candidates, original);
  const later = resolveDigestFindingCandidates(candidates, appended);
  assert.equal(first.findings[0]!.findingId, later.findings[0]!.findingId);
  assert.equal(first.messageLocators[0]!.messageKey, later.messageLocators[0]!.messageKey);
  assert.notEqual(first.messageLocators[0]!.messageLocatorId, later.messageLocators[0]!.messageLocatorId);
  assert.notEqual(first.spans[0]!.spanId, later.spans[0]!.spanId);
});

test("the resolver is deterministic and uses only candidate messageKey plus exactQuote", () => {
  const provenance = provenanceSession(["bounded exact quote"]);
  const message = provenance.admittedMessages[0]!;
  const candidates = candidateSet([
    candidate("Bounded finding", message.locator.messageKey, "exact quote")
  ]);
  const first = resolveDigestFindingCandidates(candidates, provenance);
  const second = resolveDigestFindingCandidates(structuredClone(candidates), structuredClone(provenance));
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(candidates.findings[0]!).sort(), ["claimKind", "exactQuote", "messageKey", "text"]);
});

test("human claims reject user-role, heartbeat, and task notification records but accept host-classified human records", () => {
  for (const kind of ["unknown", "automation", "host-notification"] as const) {
    const provenance = provenanceForUserRecord(kind);
    const message = provenance.admittedMessages[0]!;
    const result = resolveDigestFindingCandidates(candidateSet([{
      ...candidate("The human approved the change.", message.locator.messageKey, "approved the change"),
      claimKind: "human-adoption"
    }]), provenance);
    assert.deepEqual(result.findings, [], `${kind} must not authorize a human claim`);
    assert.deepEqual(result.spans, []);
    assert.deepEqual(result.messageLocators, []);
    assert.equal(result.unresolvedCandidates[0]?.reason, "author-authority-mismatch");
  }

  const human = provenanceForUserRecord("human");
  const message = human.admittedMessages[0]!;
  const accepted = resolveDigestFindingCandidates(candidateSet([{
    ...candidate("The human approved the change.", message.locator.messageKey, "approved the change"),
    claimKind: "human-adoption"
  }]), human);
  assert.equal(accepted.findings[0]?.claimKind, "human-adoption");
  assert.equal(accepted.messageLocators[0]?.authorKind, "human");
});

function provenanceSession(contents: string[]): StructuredTodayProvenanceSessionV1 {
  return provenanceFromParse(parseCodex(jsonl(contents.map((content, index) => codexMessage(content, `a${index}`)))));
}

function provenanceForUserRecord(kind: "human" | "automation" | "host-notification" | "unknown"): StructuredTodayProvenanceSessionV1 {
  const source = jsonl([codexUserMessage("I approved the change.", "u1")]);
  const recordEnd = source.byteLength - 1;
  return provenanceFromParse(parseEvidenceJsonl({
    source,
    provider: "codex",
    sessionId: "session-1",
    evidenceId: "evidence-1",
    ...(kind === "unknown" ? {} : { authorKindsByRecordRange: { [`0:${recordEnd}`]: kind } })
  }));
}

function provenanceFromParse(parsed: EvidenceJsonlParseResultV1): StructuredTodayProvenanceSessionV1 {
  const admittedMessages = parsed.messages.map((message) => ({
    locator: message.locator,
    content: message.content,
    contentHash: message.locator.normalizedMessageHash,
    completeMessage: true as const
  }));
  const admittedCorpusHash = sha256(JSON.stringify(admittedMessages.map((message) => ({
    messageLocatorId: message.locator.messageLocatorId,
    contentHash: message.contentHash,
    completeMessage: message.completeMessage
  }))));
  return StructuredTodayProvenanceSessionSchema.parse({
    schema: "structured-today-provenance-session/v1",
    provider: parsed.provider,
    sessionId: parsed.sessionId,
    evidenceId: parsed.evidenceId,
    parserVersion: parsed.parserVersion,
    admissionPolicyVersion: parsed.admissionPolicyVersion,
    frozenSourcePrefix: parsed.frozenSourcePrefix,
    coverage: parsed.issues.length === 0 ? "complete" : "partial",
    admittedMessages,
    omissions: [],
    parseIssues: parsed.issues,
    admittedCorpusHash
  });
}

function candidateSet(findings: DigestFindingCandidateSetV1["findings"]): DigestFindingCandidateSetV1 {
  return DigestFindingCandidateSetSchema.parse({
    sessionId: "session-1",
    findings,
    uncertainties: []
  });
}

function candidate(text: string, messageKey: string, exactQuote: string) {
  return { text, claimKind: "fact" as const, messageKey, exactQuote };
}

function parseCodex(source: Uint8Array): EvidenceJsonlParseResultV1 {
  return parseEvidenceJsonl({
    source,
    provider: "codex",
    sessionId: "session-1",
    evidenceId: "evidence-1"
  });
}

function codexMessage(content: string, id: string) {
  return {
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      authorKind: "agent",
      id,
      content: [{ type: "output_text", text: content }]
    }
  };
}

function codexUserMessage(content: string, id: string) {
  return {
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      id,
      content: [{ type: "input_text", text: content }]
    }
  };
}

function jsonl(records: unknown[]): Buffer {
  return Buffer.from(`${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
