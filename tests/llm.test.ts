import assert from "node:assert/strict";
import test from "node:test";
import { buildUserPrompt, parseDecompositionContent } from "../src/llm-core";

test("buildUserPrompt keeps decomposition scoped to ordinary tasks", () => {
  const prompt = buildUserPrompt("明天研究项目");
  assert.ok(prompt.includes("待办"));
  assert.ok(prompt.includes("不启动 Agent"));
});

test("parseDecompositionContent accepts fenced JSON model output", () => {
  const parsed = parseDecompositionContent(
    "```json\n{\"tasks\":[{\"title\":\"查概念\",\"detail\":\"读资料\",\"category\":\"research\",\"priority\":\"P0\"}]}\n```",
    "local-model"
  );

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.data.tasks[0]?.title, "查概念");
  assert.equal(parsed.data.model, "local-model");
});

test("parseDecompositionContent rejects non-json output", () => {
  const parsed = parseDecompositionContent("我觉得你应该先研究。");
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.error.code, "LLM_PARSE_FAILED");
});
