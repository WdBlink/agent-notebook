import assert from "node:assert/strict";
import test from "node:test";
import { canonicalActivityGroups } from "../app/desktop/today-board";
import type { TraceinkWorklineReviewState } from "../src/traceink-review-state";
import type { AgentWorkSession } from "../src/types";

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

function session(id: string, platform: AgentWorkSession["platform"] = "codex"): AgentWorkSession {
  return {
    id, platform, title: id, summary: "", path: `/tmp/${id}.jsonl`, updatedAt: "2026-08-15T12:00:00.000Z",
    artifacts: [], status: "completed"
  };
}
