import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptySessionSummaryCache,
  normalizeSessionSummaryCache,
  readCachedSessionSummaries,
  sessionSummaryCacheKey,
  writeCachedSessionSummaries,
  type SummaryModelMap
} from "../app/desktop/session-summary-cache";
import type { GeneratedSessionSummary } from "../src/agent-sessions";
import type { AgentWorkSession } from "../src/types";

const models: SummaryModelMap = { codex: "spark", claude: "fable" };

test("summary cache returns hits and leaves changed transcripts as misses", () => {
  const original = session();
  const cache = writeCachedSessionSummaries(
    createEmptySessionSummaryCache(),
    "2026-07-21",
    [original],
    [summary()],
    models,
    "2026-07-21T10:00:00.000Z"
  );
  const hit = readCachedSessionSummaries(cache, "2026-07-21", [original], models);
  assert.equal(hit.summaries[0]?.title, "实现智能标题");
  assert.equal(hit.misses.length, 0);

  const changed = { ...original, updatedAt: "2026-07-21T11:00:00.000Z" };
  const miss = readCachedSessionSummaries(cache, "2026-07-21", [changed], models);
  assert.equal(miss.summaries.length, 0);
  assert.deepEqual(miss.misses, [changed]);
});

test("summary cache keys include date, provider model and canonical path", () => {
  const base = session();
  const key = sessionSummaryCacheKey("2026-07-21", base, models);
  assert.notEqual(key, sessionSummaryCacheKey("2026-07-20", base, models));
  assert.notEqual(key, sessionSummaryCacheKey("2026-07-21", base, { ...models, codex: "other" }));
  assert.notEqual(key, sessionSummaryCacheKey("2026-07-21", { ...base, path: "/tmp/other.jsonl" }, models));
});

test("invalid cache files safely normalize to an empty document", () => {
  assert.deepEqual(normalizeSessionSummaryCache({ schemaVersion: 2, entries: [] }), createEmptySessionSummaryCache());
  assert.deepEqual(normalizeSessionSummaryCache(null), createEmptySessionSummaryCache());
});

function session(): AgentWorkSession {
  return {
    id: "session-id",
    platform: "codex",
    title: "Metadata title",
    summary: "Metadata summary",
    path: "/tmp/session.jsonl",
    updatedAt: "2026-07-21T09:00:00.000Z",
    resumable: true,
    summarySource: "metadata",
    artifacts: [],
    status: "unknown"
  };
}

function summary(): GeneratedSessionSummary {
  return {
    id: "session-id",
    platform: "codex",
    title: "实现智能标题",
    summary: "完成后台摘要与缓存。",
    artifacts: [],
    status: "active"
  };
}
