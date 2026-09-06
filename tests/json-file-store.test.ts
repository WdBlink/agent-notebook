import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readJsonFile, writeJsonFile } from "../app/desktop/json-file-store";

test("JSON storage preserves unreadable data and serializes atomic writes including recovery", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "json-store-"));
  const file = path.join(root, "data.json");
  try {
    assert.deepEqual(await readJsonFile(file, () => ({ empty: true })), { empty: true });
    await fs.writeFile(file, "{broken");
    await assert.rejects(readJsonFile(file, () => ({})), /原文件已保留/);
    assert.equal(await fs.readFile(file, "utf8"), "{broken");
    await Promise.all(Array.from({ length: 10 }, (_, revision) => writeJsonFile(file, { revision })));
    assert.deepEqual(await readJsonFile(file, () => ({})), { revision: 9 });
    await fs.rm(file);
    await fs.mkdir(file);
    await assert.rejects(writeJsonFile(file, { revision: 10 }));
    await fs.rmdir(file);
    await writeJsonFile(file, { revision: 11 });
    assert.deepEqual(await readJsonFile(file, () => ({})), { revision: 11 });
    assert.deepEqual(await fs.readdir(root), ["data.json"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
