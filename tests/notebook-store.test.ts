import assert from "node:assert/strict";
import test from "node:test";
import type { AgentWorkSession } from "../src/types";
import {
  compileWorkRecords,
  composeDailyPage,
  createEmptyNotebookDocument,
  createNotebookNote,
  markNotebookDelivery,
  normalizeNotebookDocument,
  notebookStateForDate,
  saveDailyDraft,
  sealDailyPage,
  updateNotebookNote
} from "../app/desktop/notebook-store";

const sessions: AgentWorkSession[] = [
  {
    id: "codex-1",
    platform: "codex",
    title: "明确今日手帐闭环",
    summary: "把白天采集、晚间整理和封页连接成同一条路径。",
    path: "/tmp/codex-1.jsonl",
    updatedAt: "2026-08-01T10:00:00+08:00",
    projectPath: "/workspace/agent-notebook",
    resumable: true,
    artifacts: [],
    status: "active"
  },
  {
    id: "claude-1",
    platform: "claude",
    title: "验证便签路由边界",
    summary: "便签只有经由小飞机操作才会离开今日页面。",
    path: "/tmp/claude-1.jsonl",
    updatedAt: "2026-08-01T15:00:00+08:00",
    projectPath: "/workspace/agent-notebook",
    resumable: true,
    artifacts: [],
    status: "blocked"
  }
];

test("project records create information gain without losing session evidence", () => {
  const records = compileWorkRecords(sessions);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.projectName, "agent-notebook");
  assert.match(records[0]?.changed ?? "", /2 条会话被归并/);
  assert.match(records[0]?.uncertainty ?? "", /阻塞/);
  assert.deepEqual(records[0]?.sessions.map((session) => session.id), ["codex-1", "claude-1"]);
});

test("notes remain durable user ink and delivery is explicit", () => {
  const created = createNotebookNote(createEmptyNotebookDocument("/wiki"), "2026-08-01", { body: "https://example.com 一条参考资料" }, new Date("2026-08-01T09:00:00Z"), "note-1");
  assert.equal(created.notes[0]?.kind, "web");
  assert.equal(created.notes[0]?.deliveries.length, 0);
  const edited = updateNotebookNote(created, "note-1", { favorite: true });
  const delivered = markNotebookDelivery(edited, "note-1", { kind: "wiki", deliveredAt: "2026-08-01T10:00:00.000Z", target: "/wiki/raw/note-1.md", status: "queued" });
  assert.equal(delivered.notes[0]?.favorite, true);
  assert.equal(delivered.notes[0]?.deliveries[0]?.target, "/wiki/raw/note-1.md");
});

test("sealing freezes work records, reflection, and selected bookmarks", () => {
  const empty = createEmptyNotebookDocument();
  const composed = composeDailyPage(empty, "2026-08-01", sessions, new Date("2026-08-01T18:00:00Z"));
  const state = notebookStateForDate(composed, "2026-08-01", sessions);
  const selected = state.continuationCandidates.map((item) => item.id);
  const drafted = saveDailyDraft(composed, "2026-08-01", { reflection: "今天到这里。", bookmarkIds: selected }, state.continuationCandidates, new Date("2026-08-01T18:05:00Z"));
  const sealed = sealDailyPage(drafted, "2026-08-01", { reflection: "今天到这里。", bookmarkIds: selected }, state.continuationCandidates, new Date("2026-08-01T18:10:00Z"));
  assert.equal(sealed.pages["2026-08-01"]?.status, "sealed");
  assert.equal(sealed.pages["2026-08-01"]?.reflection, "今天到这里。");
  assert.equal(sealed.pages["2026-08-01"]?.workRecords.length, 1);
  assert.throws(() => composeDailyPage(sealed, "2026-08-01", [], new Date("2026-08-01T19:00:00Z")), /已经封页/);
});

test("normalization keeps malformed legacy notebook data from entering the renderer", () => {
  const normalized = normalizeNotebookDocument({ schemaVersion: 99, knowledgeRoot: "/wiki", notes: [{ id: "", body: "invalid" }], pages: { nope: { status: "sealed" }, "2026-08-01": { status: "sealed", workRecords: [{ id: "record", projectKey: "/tmp/project", title: "unsafe", sessions: [{ id: {}, path: null }] }] } } });
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.knowledgeRoot, "/wiki");
  assert.deepEqual(normalized.notes, []);
  assert.equal(normalized.pages["2026-08-01"]?.workRecords.length, 0);
});
