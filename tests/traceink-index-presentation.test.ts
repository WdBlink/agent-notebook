import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { traceinkIndexPresentation } from "../src/traceink-index-presentation";
import type { TraceinkIndexArtifactV1 } from "../src/traceink-review-assets";

const HASH = "a".repeat(64);

test("today's proven Traceink index projects all five worklines without turning the recommendation list into duplicates", async () => {
  const rawMarkdown = await readFile(
    new URL("./skill-fixtures/traceink-golden/today-2026-08-15-index.md", import.meta.url),
    "utf8"
  );
  const presentation = traceinkIndexPresentation(artifact(rawMarkdown));

  assert.equal(presentation.length, 5);
  assert.deepEqual(presentation.map((item) => item.selection.title), [
    "把 Traceink 的真实产物变成 Work Continuity 的核心界面",
    "让自动因子发现引擎真正达到“中金式 AI Loop”标准",
    "有界因子发现实跑：首个 campaign 已封存但没有 Alpha",
    "Autoresearch Adapter ↔ Evaluator 自动往返与权限边界",
    "FOLO RSS → LLM-Wiki：从相关性筛选升级为证据质量门"
  ]);
  assert.equal(presentation[0]?.timeText, "09:22–14:28");
  assert.equal(presentation[2]?.statusText, "`COMPLETED`，终局无可推广结果");
  assert.match(presentation[2]?.resultMarkdown ?? "", /49 个 seal candidate/);
  assert.match(presentation[3]?.participationText ?? "", /Agent 独立推进/);
  assert.match(presentation[0]?.currentStopMarkdown ?? "", /code-mode host is disabled/);
  assert.match(presentation[1]?.changeSignalMarkdown ?? "", /历史经验必须真实改变下一轮候选分布/);
  assert.match(presentation[4]?.resultMarkdown ?? "", /候选 100/);
  assert.match(presentation[4]?.changeSignalMarkdown ?? "", /有界原始来源核验/);
  assert.match(presentation[4]?.evidenceReadinessText ?? "", /^高/);
});

test("presentation resolves only exact or unique-prefix evidence references", () => {
  const markdown = [
    "## 1. 可重开证据",
    "",
    "**时间：** 09:00–10:00",
    "**状态：** 等待人判断",
    "**参与：** `共同推进`",
    "**当前停点：** 见 `019fd9f8-48e6…` 与 [报告](/tmp/report.md)。",
    "**证据完整度：** 高"
  ].join("\n");
  const value = artifact(markdown);
  value.evidence = [
    evidence("session-autoresearch", "019fd9f8-48e6-77a2-9775-6f392b570065", "/tmp/autoresearch.jsonl"),
    { id: "report", kind: "document", path: "/tmp/report.md", locator: "bytes 0-20", contentHash: HASH }
  ];
  assert.deepEqual(traceinkIndexPresentation(value)[0]?.evidenceIds, ["session-autoresearch", "report"]);
});

function artifact(rawMarkdown: string): TraceinkIndexArtifactV1 {
  return {
    schemaVersion: 1,
    id: "traceink-index-2026-08-15",
    logicalDate: "2026-08-15",
    stage: "index",
    revision: 1,
    producer: {
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningConfiguration: "ultra",
      startedAt: "2026-08-15T06:00:00.000Z",
      completedAt: "2026-08-15T06:12:00.000Z",
      skill: { packageId: "traceink", version: "traceink-skill-bundle-v1", skillHash: HASH, editorialContractHash: HASH }
    },
    inputEvidenceHash: HASH,
    rawMarkdown,
    outputHash: HASH,
    coverage: [],
    evidence: [],
    navigation: [],
    warnings: []
  };
}

function evidence(id: string, sessionId: string, path: string) {
  return { id, kind: "session" as const, provider: "codex" as const, sessionId, path, locator: "bytes 0-100", contentHash: HASH };
}
