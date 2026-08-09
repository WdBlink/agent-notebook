import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

test("sealed transcript guard verifies and returns only the admitted prefix when the source was appended", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sealed-transcript-prefix-"));
  try {
    const sourcePath = path.join(directory, "session.jsonl");
    await fs.writeFile(sourcePath, "captured transcript\nAPPENDED_SECRET\n", "utf8");

    const source = await readBoundedTranscriptSource(sourcePath, {
      origin: "sealed-package",
      transcriptCapture: {
        canonicalPath: sourcePath,
        sha256: "7eb259ab4a8d18e582fe130bbe7c5eab409a7aad12f157fd63130c3c7d3b648d",
        byteLength: 20,
        coverage: { startByte: 0, endByte: 20 }
      }
    });

    assert.equal(source.content, "captured transcript\n");
    assert.equal(source.truncated, false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("current activity reads honor the scanner-admitted prefix when capture metadata is present", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "current-transcript-prefix-"));
  try {
    const sourcePath = path.join(directory, "session.jsonl");
    await fs.writeFile(sourcePath, "captured transcript\nAPPENDED_AFTER_SCAN\n", "utf8");

    const source = await readBoundedTranscriptSource(sourcePath, {
      origin: "current-snapshot",
      transcriptCapture: {
        canonicalPath: sourcePath,
        sha256: "7eb259ab4a8d18e582fe130bbe7c5eab409a7aad12f157fd63130c3c7d3b648d",
        byteLength: 20,
        coverage: { startByte: 0, endByte: 20 }
      }
    });

    assert.equal(source.content, "captured transcript\n");
    assert.equal(source.truncated, false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("sealed transcript guard rejects a covered-prefix mutation with the same byte length and mtime", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sealed-transcript-mutation-"));
  const fixedTime = new Date("2026-08-09T10:00:00.000Z");
  try {
    const sourcePath = path.join(directory, "session.jsonl");
    await fs.writeFile(sourcePath, "captured transcript\n", "utf8");
    await fs.utimes(sourcePath, fixedTime, fixedTime);
    await fs.writeFile(sourcePath, "mutated transcript!\n", "utf8");
    await fs.utimes(sourcePath, fixedTime, fixedTime);

    await assert.rejects(
      readBoundedTranscriptSource(sourcePath, {
        origin: "sealed-package",
        transcriptCapture: {
          canonicalPath: sourcePath,
          sha256: "7eb259ab4a8d18e582fe130bbe7c5eab409a7aad12f157fd63130c3c7d3b648d",
          byteLength: 20,
          coverage: { startByte: 0, endByte: 20 }
        }
      }),
      /SHA-256|完整性|已采纳/
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("sealed transcript guard rejects a source shorter than the admitted byte range", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sealed-transcript-short-"));
  try {
    const sourcePath = path.join(directory, "session.jsonl");
    await fs.writeFile(sourcePath, "captured transcrip\n", "utf8");

    await assert.rejects(
      readBoundedTranscriptSource(sourcePath, {
        origin: "sealed-package",
        transcriptCapture: {
          canonicalPath: sourcePath,
          sha256: "7eb259ab4a8d18e582fe130bbe7c5eab409a7aad12f157fd63130c3c7d3b648d",
          byteLength: 20,
          coverage: { startByte: 0, endByte: 20 }
        }
      }),
      /短于已采纳范围/
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("large sealed transcript tail is bounded by the admitted end rather than a live append", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sealed-transcript-large-prefix-"));
  const admittedLength = 24 * 1024 * 1024 + 128;
  try {
    const sourcePath = path.join(directory, "session.jsonl");
    const admitted = Buffer.alloc(admittedLength, 0x61);
    const headEnd = 8 * 1024 * 1024;
    const tailStart = admittedLength - 16 * 1024 * 1024;
    admitted[headEnd - 1] = 0x0a;
    admitted[tailStart] = 0x0a;
    admitted.write("CAPTURED_END_MARKER\n", admittedLength - 20, "utf8");
    const append = Buffer.from("APPENDED_SECRET_SHOULD_NOT_APPEAR\n", "utf8");
    await fs.writeFile(sourcePath, Buffer.concat([admitted, append]));
    const sha256 = createHash("sha256").update(admitted).digest("hex");

    const source = await readBoundedTranscriptSource(sourcePath, {
      origin: "sealed-package",
      transcriptCapture: {
        canonicalPath: sourcePath,
        sha256,
        byteLength: admittedLength,
        coverage: { startByte: 0, endByte: admittedLength }
      }
    });

    assert.equal(source.truncated, true);
    assert.equal(source.content.includes("CAPTURED_END_MARKER"), true);
    assert.equal(source.content.includes("APPENDED_SECRET_SHOULD_NOT_APPEAR"), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
