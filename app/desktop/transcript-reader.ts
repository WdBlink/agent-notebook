import type { AgentPlatform } from "../../src/types";
import type { SessionTranscriptMessage, SessionTranscriptState } from "./api";

const MAX_MESSAGE_CHARACTERS = 80_000;
const MAX_TOTAL_CHARACTERS = 3_000_000;

export function parseSessionTranscript(input: {
  content: string;
  platform: AgentPlatform;
  sessionId: string;
  title: string;
  path: string;
  truncated?: boolean;
}): SessionTranscriptState {
  const records = input.content.split(/\r?\n/).map(parseRecord).filter((record): record is Record<string, unknown> => Boolean(record));
  const primary = input.platform === "claude" ? parseClaudeMessages(records) : parseCodexMessages(records);
  const limited = limitMessages(deduplicateMessages(primary.messages));
  const contentTruncated = limited.truncated;
  const state: SessionTranscriptState = {
    sessionId: input.sessionId,
    platform: input.platform,
    title: input.title,
    path: input.path,
    messages: limited.messages,
    omittedToolEvents: primary.omittedToolEvents,
    truncated: input.truncated === true || contentTruncated
  };
  if (input.truncated) state.warning = "会话文件较大，阅读器保留了开头与最近内容，中间部分已省略。";
  else if (contentTruncated) state.warning = "会话正文很长，阅读器已在安全上限处停止显示。原始记录没有被修改。";
  return state;
}

function parseCodexMessages(records: Record<string, unknown>[]): { messages: SessionTranscriptMessage[]; omittedToolEvents: number } {
  const messages: SessionTranscriptMessage[] = [];
  const fallback: SessionTranscriptMessage[] = [];
  let omittedToolEvents = 0;
  for (const [index, record] of records.entries()) {
    const payload = asRecord(record.payload);
    const timestamp = cleanTimestamp(record.timestamp);
    if (record.type === "response_item" && payload?.type === "message") {
      const role = normalizeRole(payload.role);
      const content = extractContent(payload.content);
      if (role && content) messages.push(message(payload.id, index, role, content, timestamp));
      continue;
    }
    if (record.type === "event_msg" && (payload?.type === "user_message" || payload?.type === "agent_message")) {
      const role = payload.type === "user_message" ? "user" : "assistant";
      const content = cleanText(payload.message);
      if (content) fallback.push(message(undefined, index, role, content, timestamp));
      continue;
    }
    if (record.type === "response_item" && typeof payload?.type === "string" && /tool|function|command|computer|web/i.test(payload.type)) {
      omittedToolEvents += 1;
    }
  }
  return { messages: messages.length ? messages : fallback, omittedToolEvents };
}

function parseClaudeMessages(records: Record<string, unknown>[]): { messages: SessionTranscriptMessage[]; omittedToolEvents: number } {
  const messages: SessionTranscriptMessage[] = [];
  let omittedToolEvents = 0;
  for (const [index, record] of records.entries()) {
    const nested = asRecord(record.message);
    const role = normalizeRole(nested?.role ?? record.type);
    if (role) {
      const content = extractContent(nested?.content ?? record.content);
      if (content) messages.push(message(record.uuid, index, role, content, cleanTimestamp(record.timestamp)));
    }
    const type = typeof record.type === "string" ? record.type : "";
    if (/tool|progress|queue-operation/i.test(type)) omittedToolEvents += 1;
  }
  return { messages, omittedToolEvents };
}

function message(id: unknown, index: number, role: "user" | "assistant", content: string, timestamp?: string): SessionTranscriptMessage {
  const value: SessionTranscriptMessage = {
    id: typeof id === "string" && id ? id : `message-${index}`,
    role,
    content: content.length > MAX_MESSAGE_CHARACTERS ? `${content.slice(0, MAX_MESSAGE_CHARACTERS)}\n\n[这条消息过长，后续内容已省略]` : content
  };
  if (timestamp) value.timestamp = timestamp;
  return value;
}

function extractContent(value: unknown): string | undefined {
  if (typeof value === "string") return cleanText(value);
  if (!Array.isArray(value)) return undefined;
  const parts: string[] = [];
  for (const item of value) {
    if (typeof item === "string") parts.push(item);
    else {
      const record = asRecord(item);
      const type = typeof record?.type === "string" ? record.type : "";
      if (!type || /text/i.test(type)) {
        const text = cleanText(record?.text ?? record?.content);
        if (text) parts.push(text);
      }
    }
  }
  return cleanText(parts.join("\n\n"));
}

function deduplicateMessages(messages: SessionTranscriptMessage[]): SessionTranscriptMessage[] {
  const seen = new Set<string>();
  return messages.filter((item) => {
    const key = `${item.role}:${item.timestamp ?? ""}:${item.content}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function limitMessages(messages: SessionTranscriptMessage[]): { messages: SessionTranscriptMessage[]; truncated: boolean } {
  let total = 0;
  const kept: SessionTranscriptMessage[] = [];
  for (const item of messages) {
    if (total + item.content.length > MAX_TOTAL_CHARACTERS) return { messages: kept, truncated: true };
    kept.push(item);
    total += item.content.length;
  }
  return { messages: kept, truncated: false };
}

function normalizeRole(value: unknown): "user" | "assistant" | undefined {
  return value === "user" || value === "assistant" ? value : undefined;
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/\r\n/g, "\n").trim();
  return clean || undefined;
}

function cleanTimestamp(value: unknown): string | undefined {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

function parseRecord(line: string): Record<string, unknown> | undefined {
  if (!line.trim()) return undefined;
  try {
    const value = JSON.parse(line) as unknown;
    return asRecord(value);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}
