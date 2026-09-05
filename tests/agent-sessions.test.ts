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
      payload: { session_id: "parent-session", id: "codex-thread-1", cwd: "/workspace/project" }
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
  assert.equal(session?.resumable, true);
});

test("Codex archived sessions are completed and model summaries cannot reopen them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-notebook-archive-"));
  const archive = path.join(root, ".codex", "archived_sessions");
  await mkdir(archive, { recursive: true });
  const sessionPath = path.join(archive, "rollout-archived.jsonl");
  await writeFile(sessionPath, [
    JSON.stringify({ timestamp: "2026-07-21T04:00:00.000Z", type: "session_meta", payload: { id: "archived-id", cwd: root } }),
    JSON.stringify({ timestamp: "2026-07-21T04:01:00.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "归档这条会话" }] } })
  ].join("\n"));
  try {
    const settings = { ...createEmptyData().settings, sessionScanRoots: [archive], enabledSessionProviders: ["codex" as const] };
    const snapshot = await loadAgentWorkSnapshot(settings, {
      date: "2026-07-21",
      fs: fsAdapter,
      homeDir: root,
      summarizer: async () => ({ summaries: [{ id: "archived-id", platform: "codex", title: "模型标题", summary: "模型认为仍在进行。", artifacts: [], status: "active" }], warnings: [] })
    });
    assert.equal(snapshot.sessions[0]?.status, "completed");
    assert.equal(snapshot.sessions[0]?.title, "模型标题");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("extracts current Claude Code session metadata and nested messages", () => {
  const content = [
    JSON.stringify({ type: "mode", mode: "default", sessionId: "16d0cc2d-b022-4205-863d-3924305c92f9" }),
    JSON.stringify({
      type: "user",
      sessionId: "16d0cc2d-b022-4205-863d-3924305c92f9",
      cwd: "/workspace/feature-worktree",
      timestamp: "2026-07-02T09:00:00.000Z",
      message: { role: "user", content: "修复会话恢复按钮" }
    }),
    JSON.stringify({
      type: "ai-title",
      sessionId: "16d0cc2d-b022-4205-863d-3924305c92f9",
      aiTitle: "修复会话恢复按钮"
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "16d0cc2d-b022-4205-863d-3924305c92f9",
      cwd: "/workspace/feature-worktree",
      message: { role: "assistant", content: [{ type: "text", text: "按钮已接入真实 session id。" }] }
    })
  ].join("\n");

  const session = extractWorkSessionFromText(
    content,
    "/tmp/.claude/projects/project/16d0cc2d-b022-4205-863d-3924305c92f9.jsonl",
    "claude",
    "2026-07-02T10:00:00.000Z"
  );

  assert.equal(session?.id, "16d0cc2d-b022-4205-863d-3924305c92f9");
  assert.equal(session?.title, "修复会话恢复按钮");
  assert.equal(session?.summary, "按钮已接入真实 session id。");
  assert.equal(session?.projectPath, "/workspace/feature-worktree");
  assert.equal(session?.resumeHint, "claude --resume 16d0cc2d-b022-4205-863d-3924305c92f9");
  assert.equal(session?.resumable, true);
});

test("uses only provider-owned metadata for resume identity and cwd", () => {
  const claude = extractWorkSessionFromText(
    [
      JSON.stringify({ type: "user", message: { sessionId: "nested-untrusted", cwd: "/tmp/untrusted" } }),
      JSON.stringify({
        type: "user",
        sessionId: "canonical-session",
        cwd: "/tmp/trusted-worktree",
        message: { role: "user", content: "继续可信会话" }
      })
    ].join("\n"),
    "/tmp/.claude/projects/project/canonical-session.jsonl",
    "claude",
    "2026-07-02T10:00:00.000Z"
  );
  const codex = extractWorkSessionFromText(
    JSON.stringify({ type: "response_item", payload: { root: "/tmp/untrusted", id: "nested-untrusted" } }),
    "/tmp/.codex/sessions/rollout-019f1111-2222-7333-8444-555555555555.jsonl",
    "codex",
    "2026-07-02T10:00:00.000Z"
  );

  assert.equal(claude?.id, "canonical-session");
  assert.equal(claude?.projectPath, "/tmp/trusted-worktree");
  assert.equal(codex?.resumable, false);
  assert.notEqual(codex?.id, "019f1111-2222-7333-8444-555555555555");
  assert.equal(codex?.projectPath, undefined);
});

test("a UUID in a Claude task path does not create a resumable session", () => {
  const session = extractWorkSessionFromText(
    JSON.stringify({ subject: "旧任务记录", description: "没有平台会话元数据" }),
    "/tmp/.claude/tasks/019f1111-2222-7333-8444-555555555555/task.jsonl",
    "claude",
    "2026-07-02T10:00:00.000Z"
  );
  assert.equal(session?.resumable, false);
  assert.notEqual(session?.id, "019f1111-2222-7333-8444-555555555555");
});

test("scans yesterday Codex and Claude files from configured local roots", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "agent-notebook-sessions-"));
  const codexRoot = path.join(temp, "codex");
  const claudeRoot = path.join(temp, "claude", "projects");
  const targetTime = new Date("2026-07-02T14:30:00.000Z");

  try {
    await mkdir(codexRoot, { recursive: true });
    await mkdir(path.join(claudeRoot, "project-a"), { recursive: true });
    const codexFile = path.join(codexRoot, "rollout-2026-07-02.jsonl");
    const claudeFile = path.join(claudeRoot, "project-a", "session.jsonl");
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
        sessionId: "claude-task-1",
        subject: "等 batch v2 完成 + 报告 final",
        description: "读 best/alpha_search_v2_*.json 找 ann>15% alpha。",
        status: "completed",
        cwd: "/tmp/claude-project"
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

test("descends the Codex year/month/day hierarchy even when parent directory mtimes are newer", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "agent-notebook-codex-tree-"));
  const root = path.join(temp, ".codex", "sessions");
  const dayDir = path.join(root, "2026", "07", "02");
  const file = path.join(dayDir, "rollout-2026-07-02T09-00-00-019f1111-2222-7333-8444-555555555555.jsonl");
  try {
    await mkdir(dayDir, { recursive: true });
    await writeFile(
      file,
      JSON.stringify({
        type: "session_meta",
        payload: { id: "019f1111-2222-7333-8444-555555555555", cwd: "/tmp/project" }
      })
    );
    await utimes(file, new Date("2026-07-02T09:00:00.000Z"), new Date("2026-07-02T09:00:00.000Z"));
    for (const directory of [root, path.join(root, "2026"), path.join(root, "2026", "07")]) {
      await utimes(directory, new Date("2026-07-03T09:00:00.000Z"), new Date("2026-07-03T09:00:00.000Z"));
    }

    const snapshot = await loadAgentWorkSnapshot(createEmptyData().settings, {
      now: new Date("2026-07-03T12:00:00.000Z"),
      roots: [root],
      fs: fsAdapter
    });
    assert.equal(snapshot.sessions[0]?.id, "019f1111-2222-7333-8444-555555555555");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("keeps a cross-midnight Codex session eligible for target-day provider analysis", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "agent-notebook-cross-midnight-"));
  const root = path.join(temp, ".codex", "sessions");
  const oldDayDir = path.join(root, "2026", "06", "30");
  const file = path.join(oldDayDir, "rollout-2026-06-30T09-00-00-019f1111-2222-7333-8444-666666666666.jsonl");
  const todayOnlyFile = path.join(
    oldDayDir,
    "rollout-2026-06-30T10-00-00-019f1111-2222-7333-8444-777777777777.jsonl"
  );
  try {
    await mkdir(oldDayDir, { recursive: true });
    await writeFile(
      file,
      [
        JSON.stringify({
          timestamp: "2026-06-30T09:00:00.000Z",
          type: "session_meta",
          payload: { id: "019f1111-2222-7333-8444-666666666666", cwd: "/tmp/project" }
        }),
        JSON.stringify({ timestamp: "2026-07-02T10:00:00.000Z", type: "event_msg", payload: { type: "task_started" } })
      ].join("\n")
    );
    await writeFile(
      todayOnlyFile,
      [
        JSON.stringify({
          timestamp: "2026-06-30T10:00:00.000Z",
          type: "session_meta",
          payload: { id: "019f1111-2222-7333-8444-777777777777", cwd: "/tmp/project" }
        }),
        JSON.stringify({ timestamp: "2026-07-03T02:00:00.000Z", type: "event_msg", payload: { type: "task_started" } })
      ].join("\n")
    );
    await utimes(file, new Date("2026-07-03T01:00:00.000Z"), new Date("2026-07-03T01:00:00.000Z"));
    await utimes(todayOnlyFile, new Date("2026-07-03T02:00:00.000Z"), new Date("2026-07-03T02:00:00.000Z"));
    await utimes(oldDayDir, new Date("2026-06-30T09:00:00.000Z"), new Date("2026-06-30T09:00:00.000Z"));

    const snapshot = await loadAgentWorkSnapshot(createEmptyData().settings, {
      now: new Date("2026-07-03T04:00:00.000Z"),
      roots: [root],
      fs: fsAdapter
    });

    assert.equal(snapshot.sessions.length, 1);
    assert.equal(snapshot.sessions[0]?.id, "019f1111-2222-7333-8444-666666666666");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("recognizes a Git worktree without replacing its canonical cwd", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "agent-notebook-worktree-"));
  const root = path.join(temp, "codex-sessions");
  const worktree = path.join(temp, "repo-worktrees", "resume fix");
  const mainRepo = path.join(temp, "repo");
  const file = path.join(root, "session.jsonl");
  try {
    await mkdir(root, { recursive: true });
    await mkdir(worktree, { recursive: true });
    await writeFile(path.join(worktree, ".git"), `gitdir: ${mainRepo}/.git/worktrees/resume-fix\n`);
    await writeFile(
      file,
      JSON.stringify({ type: "session_meta", payload: { id: "worktree-session", cwd: worktree } })
    );
    await utimes(file, new Date("2026-07-02T09:00:00.000Z"), new Date("2026-07-02T09:00:00.000Z"));

    const snapshot = await loadAgentWorkSnapshot(createEmptyData().settings, {
      now: new Date("2026-07-03T12:00:00.000Z"),
      roots: [root],
      fs: fsAdapter
    });
    assert.equal(snapshot.sessions[0]?.projectPath, worktree);
    assert.equal(snapshot.sessions[0]?.worktreePath, worktree);
    assert.equal(snapshot.sessions[0]?.repositoryPath, mainRepo);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("merges model summaries without allowing canonical paths or ids to change", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "agent-notebook-summary-merge-"));
  const file = path.join(temp, "rollout.jsonl");
  try {
    await writeFile(
      file,
      JSON.stringify({ type: "session_meta", payload: { id: "canonical-id", cwd: "/trusted/worktree" } })
    );
    await utimes(file, new Date("2026-07-02T09:00:00.000Z"), new Date("2026-07-02T09:00:00.000Z"));
    const snapshot = await loadAgentWorkSnapshot(createEmptyData().settings, {
      now: new Date("2026-07-03T12:00:00.000Z"),
      roots: [path.join(temp, "codex")],
      fs: {
        ...fsAdapter,
        async readdir(target) {
          if (target === path.join(temp, "codex")) return ["rollout.jsonl"];
          return readdir(target);
        },
        async stat(target) {
          if (target === path.join(temp, "codex", "rollout.jsonl")) return stat(file);
          return stat(target);
        },
        async readFile(target, encoding) {
          if (target === path.join(temp, "codex", "rollout.jsonl")) return readFile(file, encoding);
          return readFile(target, encoding);
        }
      },
      summarizer: async () => ({
        summaries: [
          {
            id: "canonical-id",
            platform: "codex",
            title: "Agent 生成标题",
            summary: "Agent 生成摘要",
            artifacts: ["src/main.ts", "canonical-id", ".git", ".agents", file],
            status: "active"
          }
        ],
        warnings: []
      })
    });

    assert.equal(snapshot.sessions[0]?.title, "Agent 生成标题");
    assert.equal(snapshot.sessions[0]?.id, "canonical-id");
    assert.equal(snapshot.sessions[0]?.projectPath, "/trusted/worktree");
    assert.deepEqual(snapshot.sessions[0]?.artifacts, ["src/main.ts"]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("missing session roots return an empty snapshot", async () => {
  const snapshot = await loadAgentWorkSnapshot(createEmptyData().settings, {
    now: new Date("2026-07-03T09:00:00.000Z"),
    roots: ["/tmp/agent-notebook-missing-root"],
    fs: fsAdapter
  });

  assert.equal(snapshot.date, "2026-07-02");
  assert.equal(snapshot.sessions.length, 0);
});

test("provider selection supports both, either provider, and neither", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "agent-notebook-provider-selection-"));
  const codexRoot = path.join(temp, ".codex", "sessions");
  const claudeRoot = path.join(temp, ".claude", "projects", "project-a");
  const roots = [path.dirname(claudeRoot), codexRoot];
  const targetTime = new Date("2026-07-02T09:00:00.000Z");
  try {
    await mkdir(codexRoot, { recursive: true });
    await mkdir(claudeRoot, { recursive: true });
    const codexFile = path.join(codexRoot, "rollout.jsonl");
    const claudeFile = path.join(claudeRoot, "session.jsonl");
    await writeFile(codexFile, JSON.stringify({
      type: "session_meta",
      payload: { id: "codex-provider-test", cwd: "/tmp/codex-project" }
    }));
    await writeFile(claudeFile, JSON.stringify({
      type: "user",
      sessionId: "claude-provider-test",
      cwd: "/tmp/claude-project",
      message: { role: "user", content: "验证平台选择" }
    }));
    await utimes(codexFile, targetTime, targetTime);
    await utimes(claudeFile, targetTime, targetTime);

    const scan = (providers: Array<"codex" | "claude">) => loadAgentWorkSnapshot(createEmptyData().settings, {
      now: new Date("2026-07-03T12:00:00.000Z"),
      roots,
      providers,
      fs: fsAdapter
    });
    const [both, codexOnly, claudeOnly, neither] = await Promise.all([
      scan(["codex", "claude"]),
      scan(["codex"]),
      scan(["claude"]),
      scan([])
    ]);

    assert.deepEqual(new Set(both.sessions.map(({ platform }) => platform)), new Set(["codex", "claude"]));
    assert.deepEqual(codexOnly.sessions.map(({ platform }) => platform), ["codex"]);
    assert.deepEqual(claudeOnly.sessions.map(({ platform }) => platform), ["claude"]);
    assert.deepEqual(neither.sessions, []);
    assert.deepEqual(neither.sources, []);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
