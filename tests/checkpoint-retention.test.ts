import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { emptyCheckpoint } from "@langchain/langgraph-checkpoint";
import { NodeSqliteSaver, cleanupPublishedCheckpoint } from "../src/langgraph-node-sqlite-checkpointer";

test("frozen input is stored once, checked on replay, and bounded by inactive retention", async () => {
  const db = new DatabaseSync(":memory:");
  const saver = new NodeSqliteSaver(db);
  const body = "private frozen evidence ".repeat(50000);
  const input = { workflowRunId: "old", artifactId: "today", revision: 1, sessions: [{ session: { sessionId: "session" }, evidenceText: body }] };
  async function save(id: string, revision = 1) {
    const checkpoint = emptyCheckpoint();
    checkpoint.id = `${id}-checkpoint`;
    checkpoint.channel_values = { input: { ...input, workflowRunId: id, revision }, __start__: { input: { ...input, workflowRunId: id, revision } } };
    return saver.put({ configurable: { thread_id: id } }, checkpoint, { source: "input", step: -1, parents: {} });
  }
  const config = await save("old");
  await saver.putWrites(config, [["input", input], ["__start__", { input }]], "start");
  assert.equal((db.prepare("SELECT count(*) n FROM workflow_items").get() as { n: number }).n, 1);
  for (const row of db.prepare("SELECT checkpoint AS value FROM checkpoints UNION ALL SELECT value FROM writes").all() as Array<{ value: Uint8Array }>) {
    assert.ok(row.value.length < 10000);
    assert.equal(Buffer.from(row.value).includes(Buffer.from("private frozen evidence")), false);
  }
  assert.deepEqual((await saver.getTuple(config))?.checkpoint.channel_values.input, input);
  assert.deepEqual((await saver.getTuple(config))?.pendingWrites?.[0]?.[2], input);
  assert.equal((await saver.getWorkflowItem("old", "session") as { evidenceText: string }).evidenceText, body);
  await save("new", 2);
  saver.beginThread("old");
  assert.deepEqual(await saver.prune(), []); // Superseded, but still executing.
  await saver.endThread("old");
  assert.equal(await saver.getTuple(config), undefined);
  assert.ok(await saver.getTuple({ configurable: { thread_id: "new" } }));
  db.prepare("UPDATE workflow_items SET value = ? WHERE thread_id = 'new'").run(Buffer.from("{}"));
  await assert.rejects(() => saver.getTuple({ configurable: { thread_id: "new" } }), /missing or corrupt/);
  assert.deepEqual(await saver.prune([], Date.now() + 25 * 3600000), ["new"]);
  assert.equal((db.prepare("SELECT count(*) n FROM workflow_items").get() as { n: number }).n, 0);
  saver.close();
});

test("published cleanup failure stays nonfatal and remains eligible for maintenance", async () => {
  const db = new DatabaseSync(":memory:");
  const saver = new NodeSqliteSaver(db);
  saver.beginThread("published");
  await saver.putWorkflowItem("published", "item", { evidence: "temporary" });
  const remove = saver.deleteThread.bind(saver);
  saver.deleteThread = async () => { throw new Error("temporary storage failure"); };
  await cleanupPublishedCheckpoint(saver, "published");
  assert.equal((db.prepare("SELECT completed FROM workflow_threads").get() as { completed: number }).completed, 1);
  saver.deleteThread = remove;
  await saver.endThread("published");
  assert.equal(await saver.getWorkflowItem("published", "item"), undefined);
  saver.close();
});

test("legacy timestamps expire without resetting age to migration day", async () => {
  const db = new DatabaseSync(":memory:");
  let saver = new NodeSqliteSaver(db);
  const checkpoint = emptyCheckpoint();
  checkpoint.ts = "2026-01-01T00:00:00.000Z";
  await saver.put({ configurable: { thread_id: "legacy" } }, checkpoint, { source: "input", step: -1, parents: {} });
  db.exec("DROP TABLE workflow_threads");
  saver = new NodeSqliteSaver(db);
  assert.deepEqual(await saver.prune([], Date.parse("2026-09-05T00:00:00Z")), ["legacy"]);
  saver.close();
});
