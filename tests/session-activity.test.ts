import assert from "node:assert/strict";
import test from "node:test";
import { projectDailySessionActivity } from "../src/session-activity";
import { parseSessionTranscript } from "../app/desktop/transcript-reader";
import type { AgentWorkSession } from "../src/types";

// Break protected: pairing an assistant response with anything other than the
// preceding timestamped user intervention would invent an Agent activity window.
test("projects provider-native Codex and Claude messages into user pulses and observed response windows", () => {
  const codex = parseSessionTranscript({
    platform: "codex",
    sessionId: "codex-a",
    title: "Codex lane",
    path: "/tmp/codex-a.jsonl",
    content: [
      JSON.stringify({ timestamp: "2026-08-09T09:00:00+08:00", type: "response_item", payload: { type: "message", id: "cu1", role: "user", content: [{ type: "input_text", text: "implement lanes" }] } }),
      JSON.stringify({ timestamp: "2026-08-09T09:12:00+08:00", type: "response_item", payload: { type: "message", id: "ca1", role: "assistant", content: [{ type: "output_text", text: "implemented" }] } }),
      JSON.stringify({ timestamp: "2026-08-09T09:30:00+08:00", type: "response_item", payload: { type: "message", id: "cu2", role: "user", content: [{ type: "input_text", text: "add coverage" }] } }),
      JSON.stringify({ timestamp: "2026-08-09T09:35:00+08:00", type: "response_item", payload: { type: "message", id: "ca2", role: "assistant", content: [{ type: "output_text", text: "covered" }] } })
    ].join("\n")
  });
  const claude = parseSessionTranscript({
    platform: "claude",
    sessionId: "claude-b",
    title: "Claude lane",
    path: "/tmp/claude-b.jsonl",
    content: [
      JSON.stringify({ type: "user", uuid: "au1", timestamp: "2026-08-09T09:05:00+08:00", message: { role: "user", content: "review activity" } }),
      JSON.stringify({ type: "assistant", uuid: "aa1", timestamp: "2026-08-09T09:20:00+08:00", message: { role: "assistant", content: [{ type: "text", text: "reviewed" }] } })
    ].join("\n")
  });

  const activity = projectDailySessionActivity({
    logicalDate: "2026-08-09",
    timeZone: "Asia/Shanghai",
    sessions: [source("codex-a", "codex", codex), source("claude-b", "claude", claude)]
  });

  assert.deepEqual(activity.lanes[0]?.userInterventions.map((event) => event.timestamp), [
    "2026-08-09T09:00:00+08:00",
    "2026-08-09T09:30:00+08:00"
  ]);
  assert.deepEqual(activity.lanes[0]?.agentActivityWindows.map((window) => [window.start, window.end, window.durationMs, window.basis, window.coverage]), [
    ["2026-08-09T09:00:00+08:00", "2026-08-09T09:12:00+08:00", 12 * 60_000, "timestamped-user-to-assistant", "observed"],
    ["2026-08-09T09:30:00+08:00", "2026-08-09T09:35:00+08:00", 5 * 60_000, "timestamped-user-to-assistant", "observed"]
  ]);
  assert.deepEqual(activity.facts, {
    userInterventionCount: 3,
    observedAgentActivityMs: 25 * 60_000,
    observedConcurrentAgentActivityMs: 7 * 60_000,
    peakObservedAgentConcurrency: 2,
    contextSwitchCount: 2,
    confidence: "observed",
    basis: {
      userInterventions: "timestamped-user-messages",
      agentActivity: "union-of-timestamped-user-to-assistant-response-windows",
      concurrency: "overlap-of-observed-agent-response-windows",
      contextSwitches: "chronological-timestamped-user-session-transitions"
    }
  });
});

// Break protected: sorting or filling timestamp gaps must not turn malformed
// evidence into a measured response duration.
test("marks missing and reversed transcript timestamps uncertain without inventing minutes", () => {
  const activity = projectDailySessionActivity({
    logicalDate: "2026-08-09",
    timeZone: "Asia/Shanghai",
    sessions: [
      source("missing", "codex", {
        sessionId: "missing", platform: "codex", title: "Missing", path: "/tmp/missing.jsonl", omittedToolEvents: 0, truncated: false,
        messages: [{ id: "u", role: "user", content: "no timestamp" }, { id: "a", role: "assistant", content: "answer", timestamp: "2026-08-09T10:02:00+08:00" }]
      }),
      source("reversed", "claude", {
        sessionId: "reversed", platform: "claude", title: "Reversed", path: "/tmp/reversed.jsonl", omittedToolEvents: 0, truncated: false,
        messages: [{ id: "u", role: "user", content: "start", timestamp: "2026-08-09T11:05:00+08:00" }, { id: "a", role: "assistant", content: "earlier", timestamp: "2026-08-09T11:00:00+08:00" }]
      })
    ]
  });

  assert.deepEqual(activity.lanes.map((lane) => [lane.confidence, lane.agentActivityWindows.length]), [["uncertain", 0], ["uncertain", 0]]);
  assert.equal(activity.facts.observedAgentActivityMs, 0);
  assert.equal(activity.facts.confidence, "uncertain");
});

// Break protected: an active Session must remain an operational signal, not a
// fabricated continuous attention or Agent-progress interval.
test("keeps a running Session operationally visible while preserving a point intervention", () => {
  const activity = projectDailySessionActivity({
    logicalDate: "2026-08-09",
    timeZone: "Asia/Shanghai",
    sessions: [source("running", "codex", {
      sessionId: "running", platform: "codex", title: "Running", path: "/tmp/running.jsonl", omittedToolEvents: 0, truncated: false,
      messages: [{ id: "u", role: "user", content: "keep going", timestamp: "2026-08-09T14:00:00+08:00" }]
    }, "active")]
  });

  assert.deepEqual(activity.lanes[0], {
    identity: "codex:running:/tmp/running.jsonl",
    sessionId: "running",
    platform: "codex",
    path: "/tmp/running.jsonl",
    operationalState: "running",
    confidence: "observed",
    timeRange: { start: "2026-08-09T14:00:00+08:00", end: "2026-08-09T14:00:00+08:00" },
    userInterventions: [{ id: "u", timestamp: "2026-08-09T14:00:00+08:00" }],
    agentActivityWindows: [],
    warnings: []
  });
  assert.equal(activity.facts.observedAgentActivityMs, 0);
});

// Break protected: bounded transcript warnings are evidence completeness data;
// dropping them would make an incomplete lane look fully observed.
test("preserves a bounded transcript warning on an uncertain lane", () => {
  const activity = projectDailySessionActivity({
    logicalDate: "2026-08-09",
    timeZone: "Asia/Shanghai",
    sessions: [source("bounded", "claude", {
      sessionId: "bounded", platform: "claude", title: "Bounded", path: "/tmp/bounded.jsonl", omittedToolEvents: 0, truncated: true,
      warning: "会话文件较大，阅读器保留了开头与最近内容，中间部分已省略。",
      messages: [{ id: "u", role: "user", content: "continue", timestamp: "2026-08-09T16:00:00+08:00" }]
    })]
  });

  assert.equal(activity.lanes[0]?.confidence, "uncertain");
  assert.deepEqual(activity.lanes[0]?.warnings, [
    "会话文件较大，阅读器保留了开头与最近内容，中间部分已省略。",
    "会话记录为有界读取，活动覆盖不完整。"
  ]);
});

// Break protected: a provider Session with no admitted messages is insufficient
// evidence, even if its operational status says it is active.
test("keeps an empty running Session uncertain without creating activity", () => {
  const activity = projectDailySessionActivity({
    logicalDate: "2026-08-09",
    timeZone: "Asia/Shanghai",
    sessions: [source("empty", "codex", {
      sessionId: "empty", platform: "codex", title: "Empty", path: "/tmp/empty.jsonl", omittedToolEvents: 0, truncated: false, messages: []
    }, "active")]
  });

  assert.equal(activity.lanes[0]?.operationalState, "running");
  assert.equal(activity.lanes[0]?.confidence, "uncertain");
  assert.deepEqual(activity.lanes[0]?.agentActivityWindows, []);
  assert.equal(activity.facts.confidence, "uncertain");
});

function source(
  id: string,
  platform: "codex" | "claude",
  transcript: ReturnType<typeof parseSessionTranscript>,
  status: AgentWorkSession["status"] = "completed"
) {
  return {
    session: {
      id,
      platform,
      title: transcript.title,
      summary: "",
      path: transcript.path,
      updatedAt: "2026-08-09T15:00:00+08:00",
      artifacts: [],
      status
    } satisfies AgentWorkSession,
    transcript
  };
}
