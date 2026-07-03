import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractWorkSessionFromText, loadAgentWorkSnapshot, type RuntimeFileSystem } from "../src/agent-sessions";
import { createEmptyData } from "../src/state";

const fsAdapter: RuntimeFileSystem = {
  stat,
  readdir,
  async readFile(filePath: string, encoding: "utf8") {
    return readFile(filePath, encoding);
  }
};

test("extracts Codex JSONL sessions with resume hints", () => {
  const content = [
    JSON.stringify({
      timestamp: "2026-07-02T08:00:00.000Z",
      type: "session_meta",
      payload: { session_id: "codex-thread-1", cwd: "/workspace/project" }
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "实现昨日工作会话看板" }]
      }
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "完成本地扫描器、会话区 UI 和导出字段。" }]
      }
    })
  ].join("\n");

  const session = extractWorkSessionFromText(
    content,
    "/tmp/codex/rollout-2026-07-02.jsonl",
    "codex",
    "2026-07-02T08:30:00.000Z"
  );

  assert.equal(session?.id, "codex-thread-1");
  assert.equal(session?.title, "实现昨日工作会话看板");
  assert.equal(session?.projectPath, "/workspace/project");
  assert.equal(session?.resumeHint, "codex resume codex-thread-1");
});

test("scans yesterday Codex and Claude files from configured local roots", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "daily-cockpit-sessions-"));
  const codexRoot = path.join(temp, "codex");
  const claudeRoot = path.join(temp, "claude", "tasks");
  const targetTime = new Date("2026-07-02T14:30:00.000Z");

  try {
    await mkdir(codexRoot, { recursive: true });
    await mkdir(path.join(claudeRoot, "task-a"), { recursive: true });
    const codexFile = path.join(codexRoot, "rollout-2026-07-02.jsonl");
    const claudeFile = path.join(claudeRoot, "task-a", "1.json");
    await writeFile(
      codexFile,
      [
        JSON.stringify({ type: "session_meta", payload: { session_id: "codex-yesterday", cwd: "/tmp/project" } }),
        JSON.stringify({
          type: "response_item",
          payload: { type: "message", role: "user", content: [{ text: "整理昨日 Codex 工作" }] }
        })
      ].join("\n")
    );
    await writeFile(
      claudeFile,
      JSON.stringify({
        id: "claude-task-1",
        subject: "等 batch v2 完成 + 报告 final",
        description: "读 best/alpha_search_v2_*.json 找 ann>15% alpha。",
        status: "completed"
      })
    );
    await utimes(codexFile, targetTime, targetTime);
    await utimes(claudeFile, targetTime, targetTime);

    const snapshot = await loadAgentWorkSnapshot(createEmptyData().settings, {
      now: new Date("2026-07-03T09:00:00.000Z"),
      roots: [codexRoot, claudeRoot],
      fs: fsAdapter,
      maxFiles: 10,
      maxSessions: 10
    });

    assert.equal(snapshot.date, "2026-07-02");
    assert.equal(snapshot.sessions.length, 2);
    assert.ok(snapshot.sessions.some((session) => session.platform === "codex" && session.resumeHint === "codex resume codex-yesterday"));
    assert.ok(snapshot.sessions.some((session) => session.platform === "claude" && session.title.includes("等 batch v2 完成")));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("missing session roots return an empty snapshot", async () => {
  const snapshot = await loadAgentWorkSnapshot(createEmptyData().settings, {
    now: new Date("2026-07-03T09:00:00.000Z"),
    roots: ["/tmp/daily-cockpit-missing-root"],
    fs: fsAdapter
  });

  assert.equal(snapshot.date, "2026-07-02");
  assert.equal(snapshot.sessions.length, 0);
});
