import { projectSessionActivityLane, summarizeDailySessionActivity, type DailySessionActivity, type SessionActivityLane } from "../../src/session-activity";
import type { AgentWorkSession } from "../../src/types";
import type { SessionTranscriptState } from "./api";

export interface SessionActivityCache {
  load(logicalDate: string, sessions: AgentWorkSession[]): Promise<DailySessionActivity>;
}

export function createSessionActivityCache(input: {
  readTranscript(session: AgentWorkSession): Promise<SessionTranscriptState>;
}): SessionActivityCache {
  const lanes = new Map<string, Promise<SessionActivityLane>>();
  return {
    async load(logicalDate, sessions) {
      const projected = await Promise.all(sessions.map(async (session) => {
        const key = sessionActivityCacheKey(logicalDate, session);
        let cached = lanes.get(key);
        if (!cached) {
          cached = input.readTranscript(session)
            .then((transcript) => projectSessionActivityLane({ logicalDate, source: { session, transcript } }))
            .catch((error: unknown) => projectSessionActivityLane({
              logicalDate,
              source: {
                session,
                transcript: unreadableTranscript(session, error)
              }
            }));
          lanes.set(key, cached);
        }
        const lane = await cached;
        return { ...lane, operationalState: session.status === "active" ? "running" as const : "not-running" as const };
      }));
      return summarizeDailySessionActivity({ logicalDate, lanes: projected });
    }
  };
}

export function sessionActivityCacheKey(logicalDate: string, session: AgentWorkSession): string {
  const capture = session.transcriptCapture;
  const sourcePath = capture?.canonicalPath ?? session.path;
  const revision = capture
    ? `sha256:${capture.sha256}:${capture.byteLength}`
    : `mtime:${session.updatedAt}`;
  return [logicalDate, session.platform, session.id, sourcePath, revision].map(encodeURIComponent).join("|");
}

function unreadableTranscript(session: AgentWorkSession, error: unknown): SessionTranscriptState {
  return {
    sessionId: session.id,
    platform: session.platform,
    title: session.title,
    path: session.path,
    messages: [],
    omittedToolEvents: 0,
    truncated: true,
    warning: `无法读取活动依据：${errorMessage(error)}`
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message.replace(/\s+/g, " ").trim().slice(-220) : "未知错误";
}
