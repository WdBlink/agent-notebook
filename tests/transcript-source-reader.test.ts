import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readBoundedTranscriptSource } from "../app/desktop/transcript-source-reader";

test("sealed transcript guard reads the same regular file identity", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sealed-transcript-"));
  try {
    const sourcePath = path.join(directory, "session.jsonl");
    await fs.writeFile(sourcePath, '{"type":"message"}\n', "utf8");
    const identity = (await fs.stat(sourcePath)).mtime.toISOString();

    const source = await readBoundedTranscriptSource(sourcePath, {
      origin: "sealed-package",
      expectedModifiedAt: identity
    });

    assert.equal(source.content, '{"type":"message"}\n');
    assert.equal(source.truncated, false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("sealed transcript guard rejects a final-component symlink", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sealed-transcript-"));
  try {
    const target = path.join(directory, "target.jsonl");
    const link = path.join(directory, "session.jsonl");
    await fs.writeFile(target, "different local file", "utf8");
    await fs.symlink(target, link);

    await assert.rejects(
      readBoundedTranscriptSource(link, { origin: "sealed-package" }),
      /符号链接/
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("sealed transcript guard rejects a path replaced by a differently modified file", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sealed-transcript-"));
  try {
    const sourcePath = path.join(directory, "session.jsonl");
    const retiredPath = path.join(directory, "retired.jsonl");
    await fs.writeFile(sourcePath, "original", "utf8");
    const identity = (await fs.stat(sourcePath)).mtime.toISOString();
    await fs.rename(sourcePath, retiredPath);
    await fs.writeFile(sourcePath, "replacement", "utf8");
    const changed = new Date(Date.parse(identity) + 5_000);
    await fs.utimes(sourcePath, changed, changed);

    await assert.rejects(
      readBoundedTranscriptSource(sourcePath, { origin: "sealed-package", expectedModifiedAt: identity }),
      /修改标识已经变化/
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
