import assert from "node:assert/strict";
import test from "node:test";
import {
  CliProtocolError,
  createCliOutputCollector,
  structuredCliError
} from "../src/cli-output-collector";

test("Codex JSONL collector discards oversized tool output and preserves a split UTF-8 final event", () => {
  const collector = createCliOutputCollector("codex-jsonl");
  const privateMarker = "PRIVATE_TRANSCRIPT_SENTINEL";
  const toolEvent = Buffer.from(`${JSON.stringify({
    type: "item.completed",
    item: { type: "command_execution", aggregated_output: `${privateMarker}${"x".repeat(5 * 1024 * 1024)}` }
  })}\n`);
  for (let offset = 0; offset < toolEvent.byteLength; offset += 37_013) {
    collector.pushStdout(toolEvent.subarray(offset, Math.min(toolEvent.byteLength, offset + 37_013)));
  }
  const finalEvent = Buffer.from(`${JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text: "{\"title\":\"中文结果\"}" }
  })}\n`);
  const split = finalEvent.indexOf(Buffer.from("中")) + 1;
  collector.pushStdout(finalEvent.subarray(0, split));
  collector.pushStdout(finalEvent.subarray(split));

  const result = collector.finish();

  assert.equal(result.stdout.includes(privateMarker), false);
  assert.match(result.stdout, /中文结果/);
  assert.ok(Buffer.byteLength(result.stdout) < 1_024);
});

test("Codex JSONL collector keeps only the latest final message", () => {
  const collector = createCliOutputCollector("codex-jsonl");
  collector.pushStdout(`${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "first" } })}\n`);
  collector.pushStdout(`${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "second" } })}\n`);

  const result = collector.finish();

  assert.equal(result.stdout.includes("first"), false);
  assert.match(result.stdout, /second/);
});

test("Codex JSONL collector preserves a structured failure without retaining progress", () => {
  const collector = createCliOutputCollector("codex-jsonl");
  collector.pushStdout(`${JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: "PRIVATE_REASONING" } })}\n`);
  collector.pushStdout(`${JSON.stringify({ type: "turn.failed", error: { message: "provider context rejected" } })}\n`);

  const result = collector.finish();

  assert.equal(result.stdout.includes("PRIVATE_REASONING"), false);
  assert.equal(structuredCliError(result.stdout), "provider context rejected");
});

test("Codex JSONL collector rejects an oversized final answer rather than truncating it", () => {
  const collector = createCliOutputCollector("codex-jsonl");
  const event = `${JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text: "x".repeat(5 * 1024 * 1024) }
  })}\n`;
  for (let offset = 0; offset < event.length; offset += 64 * 1024) collector.pushStdout(event.slice(offset, offset + 64 * 1024));

  assert.throws(
    () => collector.finish(),
    (error: unknown) => error instanceof CliProtocolError && error.code === "final-output-too-large"
  );
});
