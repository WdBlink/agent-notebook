import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { StructuredTodayRuntimeStore } from "../app/desktop/structured-today-runtime-store";
import { createTraceinkAssetRepository } from "../app/desktop/traceink-asset-repository";

test("progress persists independently of review history and survives reopening", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-state-"));
  const filename = path.join(root, "state.sqlite");
  const assetPath = path.join(root, "assets.json");
  let store = new StructuredTodayRuntimeStore(filename);
  let publications = 0;
  try {
    const repository = createTraceinkAssetRepository({ filePath: assetPath, onPublish() { publications += 1; } });
    await repository.load();
    const before = await fs.readFile(assetPath, "utf8");
    for (let n = 0; n < 20; n++) store.saveRun({ runId: "run", logicalDate: "2026-08-29", kind: "index",
      status: "running", stage: "digest", completed: n, total: 20, startedAt: "2026-08-29T01:00:00Z", updatedAt: "2026-08-29T02:00:00Z" });
    assert.equal(publications, 1, "progress never republishes the asset repository");
    assert.equal(await fs.readFile(assetPath, "utf8"), before);
    store.close();
    store = new StructuredTodayRuntimeStore(filename);
    assert.equal(store.getRun("run")?.completed, 19);
    assert.equal(store.listRuns().length, 1);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("invalid digest cache entries are discarded without blocking regeneration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-cache-"));
  const filename = path.join(root, "state.sqlite");
  const store = new StructuredTodayRuntimeStore(filename);
  const db = new DatabaseSync(filename);
  try {
    for (const value of ["{broken", "{}"]) {
      db.prepare("INSERT INTO digests VALUES (?, ?, ?)").run("bad", value, 0);
      assert.equal(store.getDigest("bad"), undefined);
      assert.equal(db.prepare("SELECT key FROM digests WHERE key = ?").get("bad"), undefined);
    }
  } finally {
    db.close();
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
