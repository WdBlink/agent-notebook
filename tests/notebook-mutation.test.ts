import assert from "node:assert/strict";
import test from "node:test";
import { commitNotebookMutation } from "../app/desktop/notebook-mutation";
import { createEmptyNotebookDocument, createNotebookNote } from "../app/desktop/notebook-store";
import type { AgentWorkSession } from "../src/types";

const logicalDate = "2026-08-09";
const capturedSessions: AgentWorkSession[] = [{
  id: "captured-a",
  platform: "codex",
  title: "日期 A 的会话",
  summary: "必须用于日期 A 的返回视图。",
  path: "/tmp/captured-a.jsonl",
  updatedAt: "2026-08-09T10:00:00.000Z",
  resumable: true,
  artifacts: [],
  status: "active"
}];

for (const failure of ["write failed", "rename failed"]) {
  test(`${failure} leaves the published notebook on the prior durable document`, async () => {
    const initial = createEmptyNotebookDocument();
    let visible = initial;
    let publishCalls = 0;

    await assert.rejects(commitNotebookMutation({
      current: visible,
      logicalDate,
      viewSessions: capturedSessions,
      operation: (document) => createNotebookNote(document, logicalDate, { body: "不能提前可见" }),
      async persist(next) {
        assert.equal(visible, initial);
        assert.equal(next.notes.length, 1);
        throw new Error(failure);
      },
      publish(next) {
        publishCalls += 1;
        visible = next;
      }
    }), new RegExp(failure));

    assert.equal(publishCalls, 0);
    assert.equal(visible, initial);
    assert.deepEqual(visible.notes, []);
  });
}

test("successful persistence publishes once and builds the response from captured same-date Sessions", async () => {
  const initial = createEmptyNotebookDocument();
  let visible = initial;
  let durable = initial;

  const state = await commitNotebookMutation({
    current: visible,
    logicalDate,
    viewSessions: capturedSessions,
    operation: (document) => createNotebookNote(document, logicalDate, { body: "已经持久化" }),
    async persist(next) {
      durable = structuredClone(next);
    },
    publish(next) {
      visible = next;
    }
  });

  assert.deepEqual(visible, durable);
  assert.equal(state.previewRecords[0]?.sessions[0]?.id, "captured-a");
  assert.equal(state.continuationCandidates[0]?.sessionId, "captured-a");
});
