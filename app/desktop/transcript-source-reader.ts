import { createHash } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { AgentTranscriptCapture } from "../../src/types";

const MAX_TRANSCRIPT_BYTES = 24 * 1024 * 1024;
const TRANSCRIPT_HEAD_BYTES = 8 * 1024 * 1024;

export type TranscriptSourceOrigin = "current-snapshot" | "sealed-package";

export interface TranscriptSourceReadOptions {
  origin: TranscriptSourceOrigin;
  expectedModifiedAt?: string;
  transcriptCapture?: AgentTranscriptCapture;
}

export async function readBoundedTranscriptSource(
  filePath: string,
  options: TranscriptSourceReadOptions
): Promise<{ content: string; truncated: boolean }> {
  if (options.origin === "sealed-package") {
    const linkStat = await fs.lstat(filePath);
    if (linkStat.isSymbolicLink()) throw new Error("封存会话原文路径的最终文件是符号链接，拒绝读取。");
  }

  let handle: FileHandle;
  try {
    const noFollow = options.origin === "sealed-package" ? constants.O_NOFOLLOW : 0;
    handle = await fs.open(filePath, constants.O_RDONLY | noFollow);
  } catch (error) {
    if (options.origin === "sealed-package" && isNoFollowError(error)) {
      throw new Error("封存会话原文路径的最终文件是符号链接，拒绝读取。");
    }
    throw error;
  }

  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("会话记录不是可读取的普通文件。");
    if (options.transcriptCapture) {
      return await readCapturedTranscriptPrefix(handle, stat.size, filePath, options.transcriptCapture);
    }
    if (options.origin === "sealed-package" && options.expectedModifiedAt) {
      if (stat.mtime.toISOString() !== options.expectedModifiedAt) {
        throw new Error("封存会话原文的修改标识已经变化，拒绝读取被替换的文件。");
      }
    }
    if (stat.size <= MAX_TRANSCRIPT_BYTES) {
      return { content: await handle.readFile({ encoding: "utf8" }), truncated: false };
    }

    const tailBytes = MAX_TRANSCRIPT_BYTES - TRANSCRIPT_HEAD_BYTES;
    const head = Buffer.alloc(TRANSCRIPT_HEAD_BYTES);
    const tail = Buffer.alloc(tailBytes);
    const headRead = await handle.read(head, 0, head.length, 0);
    const tailRead = await handle.read(tail, 0, tail.length, Math.max(0, stat.size - tailBytes));
    const headText = head.subarray(0, headRead.bytesRead).toString("utf8");
    const tailText = tail.subarray(0, tailRead.bytesRead).toString("utf8");
    const safeHead = headText.slice(0, Math.max(0, headText.lastIndexOf("\n")));
    const firstTailLine = tailText.indexOf("\n");
    const safeTail = firstTailLine >= 0 ? tailText.slice(firstTailLine + 1) : tailText;
    return { content: `${safeHead}\n${safeTail}`, truncated: true };
  } finally {
    await handle.close();
  }
}

async function readCapturedTranscriptPrefix(
  handle: FileHandle,
  sourceSize: number,
  filePath: string,
  capture: AgentTranscriptCapture
): Promise<{ content: string; truncated: boolean }> {
  if (
    filePath !== capture.canonicalPath ||
    !Number.isSafeInteger(capture.byteLength) ||
    capture.byteLength < 0 ||
    capture.coverage.startByte !== 0 ||
    capture.coverage.endByte !== capture.byteLength ||
    !/^[a-f0-9]{64}$/.test(capture.sha256)
  ) {
    throw new Error("封存会话原文的已采纳范围无效，拒绝读取。");
  }
  if (sourceSize < capture.byteLength) {
    throw new Error("封存会话原文短于已采纳范围，拒绝读取。");
  }

  const truncated = capture.byteLength > MAX_TRANSCRIPT_BYTES;
  const complete = truncated ? undefined : Buffer.alloc(capture.byteLength);
  const head = truncated ? Buffer.alloc(TRANSCRIPT_HEAD_BYTES) : undefined;
  const tailBytes = MAX_TRANSCRIPT_BYTES - TRANSCRIPT_HEAD_BYTES;
  const tail = truncated ? Buffer.alloc(tailBytes) : undefined;
  const tailStart = capture.byteLength - tailBytes;
  const hash = createHash("sha256");
  let position = 0;

  while (position < capture.byteLength) {
    const requested = Math.min(64 * 1024, capture.byteLength - position);
    const buffer = Buffer.allocUnsafe(requested);
    const { bytesRead } = await handle.read(buffer, 0, requested, position);
    if (bytesRead === 0) throw new Error("封存会话原文在已采纳范围内提前结束，拒绝读取。");
    const chunk = buffer.subarray(0, bytesRead);
    hash.update(chunk);
    if (complete) {
      chunk.copy(complete, position);
    } else {
      copyIntersection(chunk, position, head!, 0, TRANSCRIPT_HEAD_BYTES);
      copyIntersection(chunk, position, tail!, tailStart, capture.byteLength);
    }
    position += bytesRead;
  }

  if (hash.digest("hex") !== capture.sha256) {
    throw new Error("封存会话原文已采纳范围的 SHA-256 完整性校验失败，拒绝读取。");
  }
  if (complete) return { content: complete.toString("utf8"), truncated: false };

  const headText = head!.toString("utf8");
  const tailText = tail!.toString("utf8");
  const safeHead = headText.slice(0, Math.max(0, headText.lastIndexOf("\n")));
  const firstTailLine = tailText.indexOf("\n");
  const safeTail = firstTailLine >= 0 ? tailText.slice(firstTailLine + 1) : tailText;
  return { content: `${safeHead}\n${safeTail}`, truncated: true };
}

function copyIntersection(
  chunk: Buffer,
  chunkStart: number,
  destination: Buffer,
  rangeStart: number,
  rangeEnd: number
): void {
  const chunkEnd = chunkStart + chunk.byteLength;
  const start = Math.max(chunkStart, rangeStart);
  const end = Math.min(chunkEnd, rangeEnd);
  if (start >= end) return;
  chunk.copy(destination, start - rangeStart, start - chunkStart, end - chunkStart);
}

function isNoFollowError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === "ELOOP" || code === "EMLINK";
}
