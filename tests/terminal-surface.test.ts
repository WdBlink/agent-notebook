import assert from "node:assert/strict";
import test from "node:test";
import { createTerminalOperationQueue } from "../src/terminal-operation-queue";

test("terminal operation queue keeps failed resize as a barrier until a resize succeeds", async () => {
  const errors: unknown[] = [];
  const calls: string[] = [];
  const queue = createTerminalOperationQueue((error) => errors.push(error));

  await assert.rejects(
    queue.enqueueResize(async () => {
      calls.push("resize");
      throw new Error("transient resize failure");
    }),
    /transient resize failure/
  );
  await assert.rejects(queue.enqueueWrite(async () => { calls.push("unsafe-write"); }), /transient resize failure/);
  await queue.enqueueResize(async () => { calls.push("resize-retry"); });
  await queue.enqueueWrite(async () => { calls.push("write"); });

  assert.deepEqual(calls, ["resize", "resize-retry", "write"]);
  assert.equal(errors.length, 2);
  assert.match(errors[0] instanceof Error ? errors[0].message : "", /transient resize failure/);
});
