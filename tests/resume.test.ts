import assert from "node:assert/strict";
import test from "node:test";
import { buildResumeCommand } from "../src/resume";
import type { AgentWorkSession } from "../src/types";

test("builds a project-aware Codex resume command", () => {
  const command = buildResumeCommand(session({ projectPath: "/Users/wdblink/Documents/new day board" }));
  assert.equal(command, "cd '/Users/wdblink/Documents/new day board' && codex resume session-123");
});

test("expands a home-relative Claude project path at shell runtime", () => {
  const command = buildResumeCommand(
    session({ platform: "claude", projectPath: "~/Work/research notes", id: "claude-thread-7" })
  );
  assert.equal(command, 'cd "$HOME/Work/research notes" && claude --resume claude-thread-7');
});

test("copies only the resume command when a project path is unavailable", () => {
  assert.equal(buildResumeCommand(session()), "codex resume session-123");
});

test("does not offer resume when the adapter did not verify the session", () => {
  const nonResumable = session();
  nonResumable.resumable = false;
  assert.equal(buildResumeCommand(nonResumable), undefined);
});

test("shell-quotes unsafe session ids", () => {
  const command = buildResumeCommand(session({ id: "session; echo unsafe" }));
  assert.equal(command, "codex resume 'session; echo unsafe'");
});

test("ignores stored resume text and derives the command from verified platform metadata", () => {
  const command = buildResumeCommand(session({ resumeHint: "rm -rf /", projectPath: "/tmp/project" }));
  assert.equal(command, "cd /tmp/project && codex resume session-123");
});

test("does not execute resume hints for unsupported platforms", () => {
  assert.equal(buildResumeCommand(session({ platform: "other", resumeHint: "dangerous-command" })), undefined);
});

test("prefers the exact worktree over the repository path", () => {
  const command = buildResumeCommand(
    session({ projectPath: "/tmp/repository", worktreePath: "/tmp/repository worktrees/fix" })
  );
  assert.equal(command, "cd '/tmp/repository worktrees/fix' && codex resume session-123");
});

function session(overrides: Partial<AgentWorkSession> = {}): AgentWorkSession {
  return {
    id: "session-123",
    platform: "codex",
    title: "恢复昨日工作",
    summary: "继续测试会话恢复。",
    path: "/tmp/session.jsonl",
    updatedAt: "2026-07-12T12:00:00.000Z",
    resumeHint: "codex resume session-123",
    resumable: true,
    artifacts: [],
    status: "completed",
    ...overrides
  };
}
