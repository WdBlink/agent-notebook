import assert from "node:assert/strict";
import test from "node:test";
import { parseSessionTranscript } from "../app/desktop/transcript-reader";

test("Codex transcript reader keeps conversation text and folds system and tool noise", () => {
  const content = [
    JSON.stringify({ timestamp: "2026-07-21T08:00:00.000Z", type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "hidden instruction" }] } }),
    JSON.stringify({ timestamp: "2026-07-21T08:01:00.000Z", type: "response_item", payload: { type: "message", id: "u1", role: "user", content: [{ type: "input_text", text: "把证据页做成内置阅读器" }] } }),
    JSON.stringify({ timestamp: "2026-07-21T08:02:00.000Z", type: "response_item", payload: { type: "custom_tool_call", name: "read_file" } }),
    JSON.stringify({ timestamp: "2026-07-21T08:03:00.000Z", type: "response_item", payload: { type: "message", id: "a1", role: "assistant", content: [{ type: "output_text", text: "已经完成只读会话视图。" }] } })
  ].join("\n");
  const transcript = parseSessionTranscript({ content, platform: "codex", sessionId: "session", title: "证据阅读器", path: "/tmp/session.jsonl" });
  assert.deepEqual(transcript.messages.map((message) => [message.role, message.content]), [
    ["user", "把证据页做成内置阅读器"],
    ["assistant", "已经完成只读会话视图。"]
  ]);
  assert.equal(transcript.omittedToolEvents, 1);
  assert.equal(transcript.messages.some((message) => message.content.includes("hidden instruction")), false);
});

test("Claude transcript reader supports nested text content", () => {
  const content = [
    JSON.stringify({ type: "user", uuid: "u1", timestamp: "2026-07-21T09:00:00.000Z", message: { role: "user", content: "阅读 Claude 会话" } }),
    JSON.stringify({ type: "assistant", uuid: "a1", timestamp: "2026-07-21T09:01:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "正文已经提取。" }, { type: "tool_use", name: "Read" }] } })
  ].join("\n");
  const transcript = parseSessionTranscript({ content, platform: "claude", sessionId: "session", title: "Claude 会话", path: "/tmp/session.jsonl" });
  assert.deepEqual(transcript.messages.map((message) => message.content), ["阅读 Claude 会话", "正文已经提取。"]);
});
