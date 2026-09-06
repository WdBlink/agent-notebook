import assert from "node:assert/strict";
import test from "node:test";
import { createSessionActivityCache, sessionActivityCacheKey } from "../app/desktop/session-activity-cache";
import type { SessionTranscriptState } from "../app/desktop/api";
import type { AgentWorkSession } from "../src/types";

// Break protected: using a mutable current-date value after an awaited read can
// project date B under date A's cache key and poison a later revisit to date A.
test("keeps blocked date loads and cached lanes bound to their request dates", async () => {
  const firstReadStarted = deferred<void>();
  const firstReadReleased = deferred<void>();
  let reads = 0;
  const cache = createSessionActivityCache({
    async readTranscript() {
      reads += 1;
      if (reads === 1) {
        firstReadStarted.resolve();
        await firstReadReleased.promise;
      }
      return transcript();
    }
  });

  const august9 = cache.load("2026-08-09", [session()]);
  await firstReadStarted.promise;
  const august10 = await cache.load("2026-08-10", [session()]);
  firstReadReleased.resolve();
  const august9Result = await august9;

  assert.deepEqual(august9Result.lanes[0]?.userInterventions.map((event) => event.timestamp), ["2026-08-09T09:00:00+08:00"]);
  assert.deepEqual(august10.lanes[0]?.userInterventions.map((event) => event.timestamp), ["2026-08-10T09:00:00+08:00"]);

  const cachedAugust9 = await cache.load("2026-08-09", [session()]);
  const cachedAugust10 = await cache.load("2026-08-10", [session()]);
  assert.deepEqual(cachedAugust9.lanes[0]?.timeRange, { start: "2026-08-09T01:00:00.000Z", end: "2026-08-09T01:02:00.000Z" });
  assert.deepEqual(cachedAugust10.lanes[0]?.timeRange, { start: "2026-08-10T01:00:00.000Z", end: "2026-08-10T01:03:00.000Z" });
  assert.equal(reads, 2);
});

test("uses captured transcript content as the activity-cache revision instead of mutable metadata", () => {
  const captured = {
    ...session(),
    transcriptCapture: {
      canonicalPath: "/tmp/shared.jsonl",
      sha256: "a".repeat(64),
      byteLength: 128,
      coverage: { startByte: 0, endByte: 128 }
    }
  } satisfies AgentWorkSession;
  const metadataOnly = {
    ...captured,
    title: "重新生成的标题",
    summary: "重新生成的摘要",
    status: "active" as const,
    updatedAt: "2026-08-10T12:00:00+08:00"
  };
  const contentChanged = {
    ...metadataOnly,
    transcriptCapture: {
      ...metadataOnly.transcriptCapture,
      sha256: "b".repeat(64)
    }
  };

  assert.equal(
    sessionActivityCacheKey("2026-08-10", captured),
    sessionActivityCacheKey("2026-08-10", metadataOnly)
  );
  assert.notEqual(
    sessionActivityCacheKey("2026-08-10", captured),
    sessionActivityCacheKey("2026-08-10", contentChanged)
  );
});

function session(): AgentWorkSession {
  return {
    id: "shared-session",
    platform: "codex",
    title: "Shared",
    summary: "",
    path: "/tmp/shared.jsonl",
    updatedAt: "2026-08-10T09:03:00+08:00",
    artifacts: [],
    status: "completed",
    lineage: { origin: "primary" }
  };
}

function transcript(): SessionTranscriptState {
  return {
    sessionId: "shared-session",
    platform: "codex",
    title: "Shared",
    path: "/tmp/shared.jsonl",
    omittedToolEvents: 0,
    truncated: false,
    messages: [
      { id: "u-9", role: "user", authorKind: "human", content: "day nine", timestamp: "2026-08-09T09:00:00+08:00" },
      { id: "a-9", role: "assistant", content: "done", timestamp: "2026-08-09T09:02:00+08:00" },
      { id: "u-10", role: "user", authorKind: "human", content: "day ten", timestamp: "2026-08-10T09:00:00+08:00" },
      { id: "a-10", role: "assistant", content: "done", timestamp: "2026-08-10T09:03:00+08:00" }
    ]
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((next) => { resolve = next; }), resolve };
}

test("activity cache bounds read concurrency and retries transient failures", async () => {
  let active = 0;
  let peak = 0;
  let reads = 0;
  const cache = createSessionActivityCache({ async readTranscript() {
    reads += 1;
    if (reads === 1) throw new Error("temporary failure");
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return transcript();
  } });
  const sessions = Array.from({ length: 12 }, (_, n) => ({ ...session(), id: String(n) }));
  await cache.load("2026-08-10", sessions);
  await cache.load("2026-08-10", sessions);
  assert.equal(reads, 13);
  assert.ok(peak <= 3);
});
