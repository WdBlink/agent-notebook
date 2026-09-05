import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  AtomicFindingSchema,
  CitedStatementSchema,
  EvidenceMessageLocatorSchema,
  HostSpanCandidateSchema,
  parseEvidenceJsonl,
  parseEvidenceRecords,
  resolveEvidenceSpan,
  verifyEvidenceSpan,
} from "../src/structured-today-evidence-spans";

test("append-only captures preserve messageKey and change capture-specific locator IDs", () => {
  const original = jsonl([
    codexMessage("user", "first", "provider-u1"),
    codexMessage("assistant", "second")
  ]);
  const appended = Buffer.concat([original, Buffer.from(`${JSON.stringify(codexMessage("assistant", "third", "a3"))}\n`, "utf8")]);
  const firstCapture = parseCodex(original);
  const laterCapture = parseCodex(appended);
  const frozenReplay = parseCodex(appended, original.byteLength);

  assert.equal(firstCapture.messages.length, 2);
  assert.deepEqual(
    laterCapture.messages.slice(0, 2).map((message) => message.locator.messageKey),
    firstCapture.messages.map((message) => message.locator.messageKey)
  );
  assert.notDeepEqual(
    laterCapture.messages.slice(0, 2).map((message) => message.locator.messageLocatorId),
    firstCapture.messages.map((message) => message.locator.messageLocatorId)
  );
  assert.deepEqual(
    frozenReplay.messages.map((message) => message.locator.messageLocatorId),
    firstCapture.messages.map((message) => message.locator.messageLocatorId)
  );
});

test("Codex primary projection suppresses mirrored fallback while fallback-only remains admissible", () => {
  const mirrored = jsonl([
    codexMessage("user", "same utterance", "primary-id"),
    { type: "event_msg", payload: { type: "user_message", message: "same utterance" } }
  ]);
  const primary = parseCodex(mirrored);
  assert.equal(primary.messages.length, 1);
  assert.equal(primary.messages[0]!.projectionKind, "primary");
  assert.equal(primary.messages[0]!.locator.providerMessageId, "primary-id");

  const fallbackOnly = parseCodex(jsonl([
    { type: "event_msg", payload: { type: "user_message", message: "fallback utterance" } }
  ]));
  assert.equal(fallbackOnly.messages.length, 1);
  assert.equal(fallbackOnly.messages[0]!.projectionKind, "fallback");
  assert.equal(fallbackOnly.messages[0]!.content, "fallback utterance");
});

test("provider IDs remain optional diagnostics for Codex and Claude", () => {
  const codex = parseCodex(jsonl([
    codexMessage("user", "with id", "codex-id"),
    codexMessage("assistant", "without id")
  ]));
  assert.equal(codex.messages[0]!.locator.providerMessageId, "codex-id");
  assert.equal(codex.messages[1]!.locator.providerMessageId, undefined);

  const claude = parseEvidenceJsonl({
    source: jsonl([
      { type: "user", uuid: "claude-id", message: { role: "user", content: "with uuid" } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "without uuid" }] } }
    ]),
    provider: "claude",
    sessionId: "claude-session",
    evidenceId: "claude-evidence"
  });
  assert.equal(claude.messages[0]!.locator.providerMessageId, "claude-id");
  assert.equal(claude.messages[1]!.locator.providerMessageId, undefined);
});

test("user role is not human authority without a host-owned raw-record classification", () => {
  const forged = codexMessage("user", "human decision", "u1") as any;
  forged.payload.authorKind = "human";
  const bytes = jsonl([forged]);
  const unclassified = parseCodex(bytes);
  assert.equal(unclassified.messages[0]?.locator.role, "user");
  assert.equal(unclassified.messages[0]?.locator.authorKind, "unknown");

  const recordEnd = bytes.byteLength - 1;
  const classified = parseEvidenceJsonl({
    source: bytes,
    provider: "codex",
    sessionId: "codex-session",
    evidenceId: "codex-evidence",
    authorKindsByRecordRange: { [`0:${recordEnd}`]: "human" }
  });
  assert.equal(classified.messages[0]?.locator.authorKind, "human");
  assert.equal(classified.messages[0]?.locator.messageKey, unclassified.messages[0]?.locator.messageKey);
  assert.notEqual(classified.messages[0]?.locator.messageLocatorId, unclassified.messages[0]?.locator.messageLocatorId);

  const automation = codexMessage("user", "scheduled task", "u2") as any;
  automation.isMeta = true;
  assert.equal(parseCodex(jsonl([automation])).messages[0]?.locator.authorKind, "automation");
});

test("CRLF records retain exact UTF-8 half-open ranges and hashes", () => {
  const first = JSON.stringify(codexMessage("user", "你好", "u1"));
  const second = JSON.stringify(codexMessage("assistant", "😀", "a1"));
  const source = Buffer.from(`${first}\r\n${second}\r\n`, "utf8");
  const parsed = parseCodex(source);
  const firstBytes = Buffer.byteLength(first, "utf8");
  const secondStart = firstBytes + 2;

  assert.deepEqual(parsed.messages[0]!.locator.rawRecord, {
    unit: "utf8-byte",
    start: 0,
    end: firstBytes,
    contentHash: sha256(Buffer.from(first, "utf8"))
  });
  assert.deepEqual(parsed.messages[1]!.locator.rawRecord, {
    unit: "utf8-byte",
    start: secondStart,
    end: secondStart + Buffer.byteLength(second, "utf8"),
    contentHash: sha256(Buffer.from(second, "utf8"))
  });
});

test("verified streaming records produce the same identities without rebuilding the source", () => {
  const first = JSON.stringify(codexMessage("user", "stream one", "u1"));
  const second = JSON.stringify(codexMessage("assistant", "stream two", "a1"));
  const source = Buffer.from(`${first}\n${second}\n`, "utf8");
  const secondStart = Buffer.byteLength(first, "utf8") + 1;
  const records = [
    {
      ordinal: 0,
      startByte: 0,
      endByte: Buffer.byteLength(first, "utf8"),
      bytes: Buffer.from(first, "utf8")
    },
    {
      ordinal: 1,
      startByte: secondStart,
      endByte: secondStart + Buffer.byteLength(second, "utf8"),
      bytes: Buffer.from(second, "utf8")
    }
  ];
  const streamed = parseEvidenceRecords({
    records,
    provider: "codex",
    sessionId: "codex-session",
    evidenceId: "codex-evidence",
    frozenSourcePrefix: { byteLength: source.byteLength, contentHash: sha256(source) }
  });
  const contiguous = parseCodex(source);
  assert.deepEqual(streamed.messages, contiguous.messages);
  assert.deepEqual(streamed.issues, []);
});

test("malformed and incomplete records are explicit and never become messages", () => {
  const valid = JSON.stringify(codexMessage("user", "valid", "u1"));
  const source = Buffer.from(`${valid}\n{bad json}\n{"type":"response_item"`, "utf8");
  const parsed = parseCodex(source);

  assert.deepEqual(parsed.messages.map((message) => message.content), ["valid"]);
  assert.deepEqual(parsed.issues.map((issue) => issue.kind), ["malformed-record", "incomplete-record"]);

  const completeButCutBeforeNewline = Buffer.from(`${valid}\n`, "utf8");
  const cutoff = Buffer.byteLength(valid, "utf8");
  const cut = parseCodex(completeButCutBeforeNewline, cutoff);
  assert.equal(cut.messages.length, 0);
  assert.equal(cut.issues[0]?.kind, "incomplete-record");
});

test("distinct same-text primary records are preserved without content deduplication", () => {
  const parsed = parseCodex(jsonl([
    codexMessage("assistant", "repeat", "a1"),
    codexMessage("assistant", "repeat", "a2")
  ]));
  assert.equal(parsed.messages.length, 2);
  assert.notEqual(parsed.messages[0]!.locator.rawRecord.start, parsed.messages[1]!.locator.rawRecord.start);
  assert.notEqual(parsed.messages[0]!.locator.messageKey, parsed.messages[1]!.locator.messageKey);
});

test("host resolver emits Unicode code-point positions without splitting graphemes", () => {
  const parsed = parseCodex(jsonl([codexMessage("assistant", "前缀😀e\u0301中文后缀", "a1")]));
  const message = parsed.messages[0]!;
  const resolved = resolveEvidenceSpan({
    messageKey: message.locator.messageKey,
    exactQuote: "😀e\u0301中文"
  }, parsed.messages);

  assert.equal(resolved.status, "resolved");
  if (resolved.status !== "resolved") return;
  assert.deepEqual(resolved.span.textPosition, { unit: "unicode-code-point", start: 2, end: 7 });
  assert.equal(resolved.span.textQuote.exact, "😀e\u0301中文");
  assert.equal(resolved.span.quoteHash, sha256(Buffer.from("😀e\u0301中文", "utf8")));
  assert.equal(resolved.span.messageLocatorId, message.locator.messageLocatorId);

  const splitCombining = resolveEvidenceSpan({
    messageKey: message.locator.messageKey,
    exactQuote: "e"
  }, parsed.messages);
  assert.deepEqual(splitCombining, { status: "unresolved", reason: "grapheme-boundary" });
});

test("repeated, cross-message, unknown, and non-enumerated selector input fail closed", () => {
  const parsed = parseCodex(jsonl([
    codexMessage("assistant", "same same alpha", "a1"),
    codexMessage("assistant", "beta", "a2")
  ]));
  const first = parsed.messages[0]!;
  assert.deepEqual(
    resolveEvidenceSpan({ messageKey: first.locator.messageKey, exactQuote: "same" }, parsed.messages),
    { status: "unresolved", reason: "repeated-quote" }
  );
  assert.deepEqual(
    resolveEvidenceSpan({ messageKey: first.locator.messageKey, exactQuote: "alphabeta" }, parsed.messages),
    { status: "unresolved", reason: "quote-not-found" }
  );
  assert.deepEqual(
    resolveEvidenceSpan({ messageKey: `msg-v2-${"f".repeat(64)}`, exactQuote: "alpha" }, parsed.messages),
    { status: "unresolved", reason: "unknown-message-key" }
  );
  assert.throws(() => HostSpanCandidateSchema.parse({
    messageKey: first.locator.messageKey,
    exactQuote: "alpha",
    start: 10
  }));
});

test("synthetic omission projections and quotes are never citable", () => {
  const parsed = parseCodex(jsonl([
    codexMessage("assistant", "[中间消息因模型输入预算省略]", "structured-today-omission"),
    codexMessage("assistant", "real message", "a1")
  ]));
  assert.deepEqual(parsed.messages.map((message) => message.content), ["real message"]);
  assert.equal(parsed.issues.some((issue) => issue.kind === "synthetic-omission"), true);
  assert.deepEqual(resolveEvidenceSpan({
    messageKey: parsed.messages[0]!.locator.messageKey,
    exactQuote: "[中间消息因模型输入预算省略]"
  }, parsed.messages), { status: "unresolved", reason: "synthetic-omission" });
});

test("schemas enforce locator bounds and evidence relation semantics", () => {
  const parsed = parseCodex(jsonl([codexMessage("assistant", "source fact", "a1")]));
  const message = parsed.messages[0]!;
  const resolved = resolveEvidenceSpan({ messageKey: message.locator.messageKey, exactQuote: "source fact" }, parsed.messages);
  assert.equal(resolved.status, "resolved");
  if (resolved.status !== "resolved") return;
  const spanId = resolved.span.spanId;

  assert.doesNotThrow(() => AtomicFindingSchema.parse({
    findingId: "finding-1",
    text: "source fact",
    claimKind: "fact",
    relation: "source-span",
    spanIds: [spanId]
  }));
  assert.doesNotThrow(() => CitedStatementSchema.parse({
    statementId: "statement-1",
    text: "source fact",
    relation: "source-span",
    findingIds: ["finding-1"],
    spanIds: [spanId]
  }));
  assert.throws(() => AtomicFindingSchema.parse({
    findingId: "finding-2",
    text: "workflow status",
    claimKind: "fact",
    relation: "workflow-state",
    spanIds: [spanId]
  }));
  assert.throws(() => CitedStatementSchema.parse({
    statementId: "statement-2",
    text: "missing finding",
    relation: "unresolved",
    findingIds: [],
    spanIds: []
  }));
  assert.throws(() => EvidenceMessageLocatorSchema.parse({
    ...message.locator,
    rawRecord: { ...message.locator.rawRecord, end: message.locator.frozenSourcePrefix.byteLength + 1 }
  }));
});

test("stored span replay re-verifies identity, context, and Unicode positions", () => {
  const parsed = parseCodex(jsonl([codexMessage("assistant", "前缀😀证据后缀", "a1")]));
  const message = parsed.messages[0]!;
  const resolved = resolveEvidenceSpan({ messageKey: message.locator.messageKey, exactQuote: "😀证据" }, parsed.messages);
  assert.equal(resolved.status, "resolved");
  if (resolved.status !== "resolved") return;

  assert.deepEqual(verifyEvidenceSpan(resolved.span, message), {
    status: "verified",
    utf16Start: 2,
    utf16End: 6
  });
  assert.deepEqual(verifyEvidenceSpan({
    ...resolved.span,
    messageLocatorId: `locator-v2-${"f".repeat(64)}`
  }, message), { status: "unavailable", reason: "identity-mismatch" });
  assert.deepEqual(verifyEvidenceSpan({
    ...resolved.span,
    textPosition: { ...resolved.span.textPosition, start: resolved.span.textPosition.start + 1 }
  }, message), { status: "unavailable", reason: "selector-mismatch" });
  assert.deepEqual(verifyEvidenceSpan({
    ...resolved.span,
    textQuote: { ...resolved.span.textQuote, prefix: "错误前缀" }
  }, message), { status: "unavailable", reason: "selector-mismatch" });
});

function parseCodex(source: Uint8Array, frozenPrefixByteLength?: number) {
  return parseEvidenceJsonl({
    source,
    provider: "codex",
    sessionId: "codex-session",
    evidenceId: "codex-evidence",
    ...(frozenPrefixByteLength === undefined ? {} : { frozenPrefixByteLength })
  });
}

function codexMessage(role: "user" | "assistant", content: string, id?: string) {
  return {
    type: "response_item",
    payload: {
      type: "message",
      role,
      ...(id ? { id } : {}),
      content: [{ type: role === "user" ? "input_text" : "output_text", text: content }]
    }
  };
}

function jsonl(records: unknown[]): Buffer {
  return Buffer.from(`${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
