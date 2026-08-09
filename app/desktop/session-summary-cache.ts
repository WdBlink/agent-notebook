import type { GeneratedSessionSummary } from "../../src/agent-sessions";
import type { AgentWorkSession } from "../../src/types";

export const SESSION_SUMMARY_PROMPT_VERSION = 1;
export const MAX_SESSION_SUMMARY_CACHE_ENTRIES = 600;

export interface SummaryModelMap {
  codex: string;
  claude: string;
}

export interface SessionSummaryCacheEntry {
  key: string;
  cachedAt: string;
  summary: GeneratedSessionSummary;
}

export interface SessionSummaryCacheDocument {
  schemaVersion: 1;
  entries: SessionSummaryCacheEntry[];
}

export function createEmptySessionSummaryCache(): SessionSummaryCacheDocument {
  return { schemaVersion: 1, entries: [] };
}

export function normalizeSessionSummaryCache(value: unknown): SessionSummaryCacheDocument {
  if (!value || typeof value !== "object") return createEmptySessionSummaryCache();
  const candidate = value as Partial<SessionSummaryCacheDocument>;
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.entries)) return createEmptySessionSummaryCache();
  const entries = candidate.entries.filter(isCacheEntry).slice(0, MAX_SESSION_SUMMARY_CACHE_ENTRIES);
  return { schemaVersion: 1, entries };
}

export function sessionSummaryCacheKey(
  date: string,
  session: AgentWorkSession,
  models: SummaryModelMap
): string {
  const capture = session.transcriptCapture;
  const sourcePath = capture?.canonicalPath ?? session.path;
  const revision = capture
    ? `sha256:${capture.sha256}:${capture.byteLength}`
    : `mtime:${session.updatedAt}`;
  return [
    `v${SESSION_SUMMARY_PROMPT_VERSION}`,
    date,
    session.platform,
    session.platform === "codex" || session.platform === "claude" ? models[session.platform] : "unsupported",
    session.id,
    sourcePath,
    revision
  ].map(encodeURIComponent).join("|");
}

export function readCachedSessionSummaries(
  cache: SessionSummaryCacheDocument,
  date: string,
  sessions: AgentWorkSession[],
  models: SummaryModelMap
): { summaries: GeneratedSessionSummary[]; misses: AgentWorkSession[] } {
  const byKey = new Map(cache.entries.map((entry) => [entry.key, entry.summary]));
  const summaries: GeneratedSessionSummary[] = [];
  const misses: AgentWorkSession[] = [];
  for (const session of sessions) {
    const summary = byKey.get(sessionSummaryCacheKey(date, session, models));
    if (summary) summaries.push(summary);
    else misses.push(session);
  }
  return { summaries, misses };
}

export function writeCachedSessionSummaries(
  cache: SessionSummaryCacheDocument,
  date: string,
  sessions: AgentWorkSession[],
  summaries: GeneratedSessionSummary[],
  models: SummaryModelMap,
  now = new Date().toISOString()
): SessionSummaryCacheDocument {
  const sessionsByIdentity = new Map(sessions.map((session) => [`${session.platform}:${session.id}`, session]));
  const nextEntries = [...cache.entries];
  const byKey = new Map(nextEntries.map((entry, index) => [entry.key, index]));
  for (const summary of summaries) {
    const session = sessionsByIdentity.get(`${summary.platform}:${summary.id}`);
    if (!session) continue;
    const key = sessionSummaryCacheKey(date, session, models);
    const entry: SessionSummaryCacheEntry = { key, cachedAt: now, summary };
    const index = byKey.get(key);
    if (index === undefined) {
      byKey.set(key, nextEntries.length);
      nextEntries.push(entry);
    } else {
      nextEntries[index] = entry;
    }
  }
  nextEntries.sort((a, b) => b.cachedAt.localeCompare(a.cachedAt));
  return { schemaVersion: 1, entries: nextEntries.slice(0, MAX_SESSION_SUMMARY_CACHE_ENTRIES) };
}

function isCacheEntry(value: unknown): value is SessionSummaryCacheEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<SessionSummaryCacheEntry>;
  const summary = entry.summary as Partial<GeneratedSessionSummary> | undefined;
  return typeof entry.key === "string"
    && typeof entry.cachedAt === "string"
    && typeof summary?.id === "string"
    && (summary.platform === "codex" || summary.platform === "claude")
    && typeof summary.title === "string"
    && typeof summary.summary === "string"
    && Array.isArray(summary.artifacts)
    && (summary.status === "active" || summary.status === "blocked" || summary.status === "completed" || summary.status === "unknown");
}
