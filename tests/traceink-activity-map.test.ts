import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalActivityGroups } from "../app/desktop/today-board";
import { traceinkIndexPresentation } from "../src/traceink-index-presentation";
import { traceinkWorklineSelections } from "../src/traceink-index-navigation";
import type { TraceinkIndexArtifactV1 } from "../src/traceink-review-assets";
import type { TraceinkWorklineReviewState } from "../src/traceink-review-state";
import type { AgentWorkSession } from "../src/types";

const HASH = "a".repeat(64);

test("Traceink natural-language index projects workline Session lanes and preserves unmatched evidence", () => {
  const sessions = [session("codex-a"), session("claude-b", "claude"), session("codex-unmatched")];
  const worklines: TraceinkWorklineReviewState[] = [
    workline("line-a", 1, "跨会话研究主线"),
    workline("line-b", 2, "发布检查")
  ];
  const markdown = [
    "1. **跨会话研究主线**",
    "- 会话：Codex `codex-a`、Claude Code `claude-b`",
    "- 参与：`共同推进`——你设定边界，Agent 执行检查。",
    "",
    "2. **发布检查**",
    "- 会话：没有可确认的 Session ID",
    "- 参与：`无法确定`"
  ].join("\n");
  const projected = canonicalActivityGroups(markdown, worklines, sessions);
  assert.deepEqual(projected.groups[0]?.sessions.map((item) => item.id), ["codex-a", "claude-b"]);
  assert.deepEqual(projected.groups[0]?.participation, ["共同推进"]);
  assert.deepEqual(projected.groups[1]?.sessions, []);
  assert.deepEqual(projected.groups[1]?.participation, ["无法确定"]);
  assert.deepEqual(projected.ungrouped.map((item) => item.id), ["codex-unmatched"]);
});

test("today's proven Traceink index becomes five visual activity groups with the reading signals intact", async () => {
  const rawMarkdown = await readFile(
    new URL("./skill-fixtures/traceink-golden/today-2026-08-15-index.md", import.meta.url),
    "utf8"
  );
  const index = artifact(rawMarkdown);
  index.evidence = [
    evidence("e-work-continuity", "019fe682-2ae8-75c0-970c-a3438bd51db1", "/tmp/work-continuity.jsonl"),
    evidence("e-loop", "019ff55d-2782-77a0-abb8-f2b11dcd01f2", "/tmp/loop.jsonl"),
    evidence("e-campaign", "01a003a2-f248-7aa0-bbcc-001122334455", "/tmp/campaign.jsonl"),
    evidence("e-adapter", "019fd9f8-48e6-77a2-9775-6f392b570065", "/tmp/adapter.jsonl"),
    evidence("e-folo", "019fd2c1-b372-77aa-bbcc-556677889900", "/tmp/folo.jsonl")
  ];
  const presentations = traceinkIndexPresentation(index);
  const byId = new Map(presentations.map((item) => [item.selection.worklineId, item]));
  const worklines: TraceinkWorklineReviewState[] = traceinkWorklineSelections(index).map((selection) => ({
    selection,
    ...(byId.get(selection.worklineId) ? { presentation: byId.get(selection.worklineId)! } : {}),
    proposalItems: []
  }));
  const sessions = index.evidence.map((item) => session(item.sessionId!, item.provider, item.path));

  const projected = canonicalActivityGroups(rawMarkdown, worklines, sessions, index.evidence);

  assert.equal(projected.groups.length, 5);
  assert.equal(projected.groups[0]?.timeText, "09:22–14:28");
  assert.equal(projected.groups[2]?.statusText, "`COMPLETED`，终局无可推广结果");
  assert.match(projected.groups[2]?.result ?? "", /49 个 seal candidate/);
  assert.deepEqual(projected.groups[3]?.participation, ["Agent 独立推进"]);
  assert.match(projected.groups[0]?.currentStop ?? "", /code-mode host is disabled/);
  assert.match(projected.groups[1]?.changeSignal ?? "", /历史经验必须真实改变下一轮候选分布/);
  assert.match(projected.groups[4]?.result ?? "", /候选 100/);
  assert.match(projected.groups[4]?.changeSignal ?? "", /有界原始来源核验/);
  assert.equal(projected.groups[4]?.evidenceReadiness, "高。");
  assert.deepEqual(projected.groups.map((group) => group.sessions.length), [1, 1, 1, 1, 1]);
  assert.deepEqual(
    projected.groups.map((group) => [...group.evidenceBySessionIdentity.values()].map((item) => item.id)),
    [["e-work-continuity"], ["e-loop"], ["e-campaign"], ["e-adapter"], ["e-folo"]]
  );
  assert.deepEqual(projected.ungrouped, []);
});

function workline(worklineId: string, ordinal: number, title: string): TraceinkWorklineReviewState {
  return {
    proposalItems: [],
    selection: {
      worklineId,
      ordinal,
      title,
      sourceIndex: { artifactId: "index", stage: "index", revision: 1, outputHash: "a".repeat(64) }
    }
  };
}

function session(id: string, platform: AgentWorkSession["platform"] = "codex", path = `/tmp/${id}.jsonl`): AgentWorkSession {
  return {
    id, platform, title: id, summary: "", path, updatedAt: "2026-08-15T12:00:00.000Z",
    artifacts: [], status: "completed"
  };
}

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
  return {
    id,
    kind: "session" as const,
    provider: "codex" as const,
    sessionId,
    path,
    locator: "bytes 0-100",
    contentHash: HASH
  };
}
