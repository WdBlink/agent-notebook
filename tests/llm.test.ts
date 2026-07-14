import assert from "node:assert/strict";
import test from "node:test";
import { buildUserPrompt, parseDecompositionContent } from "../src/llm-core";

test("buildUserPrompt keeps decomposition scoped to tasks and hot start", () => {
  const prompt = buildUserPrompt("明天研究项目");
  assert.ok(prompt.includes("待办候选"));
  assert.ok(prompt.includes("warmStart"));
  assert.ok(prompt.includes("selectedForHotStart"));
});

test("parseDecompositionContent accepts fenced JSON model output", () => {
  const parsed = parseDecompositionContent(
    "```json\n{\"tasks\":[{\"title\":\"查概念\",\"detail\":\"读资料\",\"category\":\"research\",\"priority\":\"P0\",\"warmStart\":\"提前读 README\",\"selectedForHotStart\":true}]}\n```",
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
