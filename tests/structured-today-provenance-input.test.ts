import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  StructuredTodayProvenanceSessionSchema,
  buildStructuredTodayProvenanceSession
} from "../app/desktop/structured-today-provenance-input";

test("provenance session input preserves verified record locators and a complete admitted corpus", async () => {
  await withTranscript([
    codexMessage("user", "确定消息级证据目标。", "user-1"),
    codexMessage("assistant", "实现原子 finding。", "assistant-1")
  ], async ({ sourcePath, capture }) => {
    const result = await buildStructuredTodayProvenanceSession({
      sourcePath,
      capture,
      provider: "codex",
      sessionId: "session-1",
      evidenceId: "evidence-1"
    });

    assert.equal(result.coverage, "complete");
    assert.equal(result.admittedMessages.length, 2);
    assert.deepEqual(result.admittedMessages.map((message) => message.content), [
      "确定消息级证据目标。",
      "实现原子 finding。"
    ]);
    assert.equal(result.admittedMessages[0]?.locator.rawRecord.start, 0);
    assert.equal(result.admittedMessages.every((message) => message.completeMessage), true);
    assert.doesNotThrow(() => StructuredTodayProvenanceSessionSchema.parse(result));
  });
});

test("provenance admission excludes oversized messages instead of creating citable truncation text", async () => {
  const oversized = "界".repeat(80_001);
  await withTranscript([
    codexMessage("user", oversized, "oversized"),
    codexMessage("assistant", "保留的短消息", "short")
  ], async ({ sourcePath, capture }) => {
    const result = await buildStructuredTodayProvenanceSession({
      sourcePath,
      capture,
      provider: "codex",
      sessionId: "session-large",
      evidenceId: "evidence-large"
    });

    assert.equal(result.coverage, "partial");
    assert.deepEqual(result.admittedMessages.map((message) => message.content), ["保留的短消息"]);
    assert.deepEqual(result.omissions.map((item) => item.reason), ["single-message-limit"]);
    assert.equal(JSON.stringify(result).includes("[中间消息因模型输入预算省略]"), false);
  });
});

test("provenance admission keeps deterministic head and tail messages under the total model budget", async () => {
  const text = (label: string) => `${label}${"a".repeat(69_999)}`;
  await withTranscript([
    codexMessage("user", text("A"), "a"),
    codexMessage("assistant", text("B"), "b"),
    codexMessage("user", text("C"), "c"),
    codexMessage("assistant", text("D"), "d")
  ], async ({ sourcePath, capture }) => {
    const result = await buildStructuredTodayProvenanceSession({
      sourcePath,
      capture,
      provider: "codex",
      sessionId: "session-budget",
      evidenceId: "evidence-budget"
    });

    assert.deepEqual(result.admittedMessages.map((message) => message.content[0]), ["A", "C", "D"]);
    assert.deepEqual(result.omissions.map((item) => item.reason), ["total-model-budget"]);
    assert.equal(result.coverage, "partial");
  });
});

test("synthetic omission and an unterminated tail stay explicit and non-citable", async () => {
  const records = [
    codexMessage("assistant", "[中间消息因模型输入预算省略]", "structured-today-omission"),
    codexMessage("assistant", "真实消息", "real")
  ];
  const terminated = Buffer.from(`${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  const tail = Buffer.from('{"type":"response_item"', "utf8");
  const bytes = Buffer.concat([terminated, tail]);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "structured-provenance-tail-"));
  try {
    const sourcePath = path.join(directory, "session.jsonl");
    await fs.writeFile(sourcePath, bytes);
    const result = await buildStructuredTodayProvenanceSession({
      sourcePath,
      capture: captureFor(sourcePath, bytes),
      provider: "codex",
      sessionId: "session-tail",
      evidenceId: "evidence-tail"
    });
    assert.deepEqual(result.admittedMessages.map((message) => message.content), ["真实消息"]);
    assert.deepEqual(result.parseIssues.map((issue) => issue.kind), ["synthetic-omission", "incomplete-record"]);
    assert.equal(result.coverage, "partial");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

async function withTranscript(
  records: unknown[],
  run: (input: { sourcePath: string; capture: ReturnType<typeof captureFor> }) => Promise<void>
): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "structured-provenance-"));
  try {
    const sourcePath = path.join(directory, "session.jsonl");
    const bytes = Buffer.from(`${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
    await fs.writeFile(sourcePath, bytes);
    await run({ sourcePath, capture: captureFor(sourcePath, bytes) });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function captureFor(sourcePath: string, bytes: Uint8Array) {
  return {
    canonicalPath: sourcePath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.byteLength,
    coverage: { startByte: 0, endByte: bytes.byteLength }
  };
}

function codexMessage(role: "user" | "assistant", text: string, id: string) {
  return {
    type: "response_item",
    payload: {
      type: "message",
      id,
      role,
      content: [{ type: role === "user" ? "input_text" : "output_text", text }]
    }
  };
}
