import type { SessionTranscriptState } from "../app/desktop/api";
import type { AgentWorkSession } from "./types";

export type ActivityConfidence = "observed" | "uncertain";

export interface SessionActivitySource {
  session: AgentWorkSession;
  transcript: Pick<SessionTranscriptState, "messages" | "truncated" | "warning">;
}

export interface UserIntervention {
  id: string;
  timestamp: string;
}

export interface AgentActivityWindow {
  start: string;
  end: string;
  durationMs: number;
  basis: "timestamped-user-to-assistant";
  coverage: "observed";
}

export interface SessionActivityLane {
  identity: string;
  sessionId: string;
  platform: AgentWorkSession["platform"];
  path: string;
  operationalState: "running" | "not-running";
  confidence: ActivityConfidence;
  timeRange?: { start: string; end: string };
  userInterventions: UserIntervention[];
  agentActivityWindows: AgentActivityWindow[];
  warnings: string[];
}

export interface DailyActivityFacts {
  userInterventionCount: number;
  observedAgentActivityMs: number;
  observedConcurrentAgentActivityMs: number;
  peakObservedAgentConcurrency: number;
  contextSwitchCount: number;
  confidence: ActivityConfidence;
  basis: {
    userInterventions: "timestamped-user-messages";
    agentActivity: "union-of-timestamped-user-to-assistant-response-windows";
    concurrency: "overlap-of-observed-agent-response-windows";
    contextSwitches: "chronological-timestamped-user-session-transitions";
  };
}

export interface DailySessionActivity {
  logicalDate: string;
  lanes: SessionActivityLane[];
  facts: DailyActivityFacts;
}

export function projectDailySessionActivity(input: {
  logicalDate: string;
  sessions: SessionActivitySource[];
  timeZone?: string;
}): DailySessionActivity {
  const timeZone = input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const lanes = input.sessions.map((source) => projectSessionActivityLane({
    logicalDate: input.logicalDate,
    source,
    ...(input.timeZone ? { timeZone } : {})
  }));
  return summarizeDailySessionActivity({ logicalDate: input.logicalDate, lanes });
}

export function projectSessionActivityLane(input: {
  logicalDate: string;
  source: SessionActivitySource;
  timeZone?: string;
}): SessionActivityLane {
  return projectLane(input.logicalDate, input.source, input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
}

export function summarizeDailySessionActivity(input: {
  logicalDate: string;
  lanes: SessionActivityLane[];
}): DailySessionActivity {
  const lanes = input.lanes;
  const windows = lanes.flatMap((lane) => lane.agentActivityWindows.map((window) => ({
    start: Date.parse(window.start),
    end: Date.parse(window.end)
  })));
  const measurements = measureWindows(windows);
  const chronologicalUserEvents = lanes
    .flatMap((lane) => lane.userInterventions.map((event) => ({ identity: lane.identity, timestamp: event.timestamp, time: Date.parse(event.timestamp) })))
    .sort((left, right) => left.time - right.time || left.identity.localeCompare(right.identity));
  const facts: DailyActivityFacts = {
    userInterventionCount: chronologicalUserEvents.length,
    observedAgentActivityMs: measurements.unionMs,
    observedConcurrentAgentActivityMs: measurements.concurrentMs,
    peakObservedAgentConcurrency: measurements.peakConcurrency,
    contextSwitchCount: countContextSwitches(chronologicalUserEvents),
    confidence: lanes.every((lane) => lane.confidence === "observed") ? "observed" : "uncertain",
    basis: {
      userInterventions: "timestamped-user-messages",
      agentActivity: "union-of-timestamped-user-to-assistant-response-windows",
      concurrency: "overlap-of-observed-agent-response-windows",
      contextSwitches: "chronological-timestamped-user-session-transitions"
    }
  };
  return { logicalDate: input.logicalDate, lanes, facts };
}

function projectLane(logicalDate: string, source: SessionActivitySource, timeZone: string): SessionActivityLane {
  const messages = source.transcript.messages;
  const warnings: string[] = [];
  if (source.transcript.warning) warnings.push(source.transcript.warning);
  const parsed = messages.map((message) => ({ ...message, time: parseTimestamp(message.timestamp) }));
  const hasMissingTimestamp = parsed.some((message) => message.time === undefined);
  const hasReversedTimestamp = hasReverseTimestamp(parsed);
  const hasNoMessages = messages.length === 0;
  if (source.transcript.truncated) warnings.push("会话记录为有界读取，活动覆盖不完整。");
  if (hasNoMessages) warnings.push("没有可用于活动判断的用户或助手消息。");
  if (hasMissingTimestamp) warnings.push("部分用户或助手消息缺少可用时间戳，无法推断持续时间。");
  if (hasReversedTimestamp) warnings.push("会话时间戳顺序异常，无法推断持续时间。");

  const dailyMessages = parsed.filter((message) => message.time !== undefined && dateInTimeZone(message.time, timeZone) === logicalDate);
  const userInterventions = dailyMessages
    .filter((message) => message.role === "user")
    .map((message) => ({ id: message.id, timestamp: message.timestamp as string }));
  const usableForWindows = !hasMissingTimestamp && !hasReversedTimestamp && !source.transcript.truncated;
  const agentActivityWindows = usableForWindows ? responseWindows(dailyMessages) : [];
  const observedTimes = dailyMessages.map((message) => message.time as number);
  const timeRange = observedTimes.length > 0
    ? { start: dailyMessages[0]?.timestamp as string, end: dailyMessages.at(-1)?.timestamp as string }
    : undefined;
  const confidence: ActivityConfidence = hasNoMessages || hasMissingTimestamp || hasReversedTimestamp || source.transcript.truncated || (messages.length > 0 && observedTimes.length === 0)
    ? "uncertain"
    : "observed";
  if (messages.length > 0 && observedTimes.length === 0 && warnings.length === 0) warnings.push("没有属于当前日期的可用活动时间戳。");

  return {
    identity: sessionIdentity(source.session),
    sessionId: source.session.id,
    platform: source.session.platform,
    path: source.session.path,
    operationalState: source.session.status === "active" ? "running" : "not-running",
    confidence,
    ...(timeRange ? { timeRange } : {}),
    userInterventions,
    agentActivityWindows,
    warnings
  };
}

function responseWindows(messages: Array<{ id: string; role: "user" | "assistant"; timestamp?: string; time: number | undefined }>): AgentActivityWindow[] {
  const windows: AgentActivityWindow[] = [];
  for (let index = 1; index < messages.length; index += 1) {
    const previous = messages[index - 1];
    const current = messages[index];
    if (!previous || !current || previous.role !== "user" || current.role !== "assistant" || previous.time === undefined || current.time === undefined) continue;
    if (current.time <= previous.time) continue;
    windows.push({
      start: previous.timestamp as string,
      end: current.timestamp as string,
      durationMs: current.time - previous.time,
      basis: "timestamped-user-to-assistant",
      coverage: "observed"
    });
  }
  return windows;
}

function hasReverseTimestamp(messages: Array<{ time: number | undefined }>): boolean {
  let previous: number | undefined;
  for (const message of messages) {
    if (message.time === undefined) continue;
    if (previous !== undefined && message.time < previous) return true;
    previous = message.time;
  }
  return false;
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : time;
}

function dateInTimeZone(time: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(time));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function sessionIdentity(session: AgentWorkSession): string {
  return `${session.platform}:${session.id}:${session.path}`;
}

function measureWindows(windows: Array<{ start: number; end: number }>): { unionMs: number; concurrentMs: number; peakConcurrency: number } {
  const boundaries = [...new Set(windows.flatMap((window) => [window.start, window.end]))].sort((left, right) => left - right);
  let unionMs = 0;
  let concurrentMs = 0;
  let peakConcurrency = 0;
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (start === undefined || end === undefined || end <= start) continue;
    const concurrency = windows.filter((window) => window.start <= start && window.end > start).length;
    if (concurrency > 0) unionMs += end - start;
    if (concurrency > 1) concurrentMs += end - start;
    peakConcurrency = Math.max(peakConcurrency, concurrency);
  }
  return { unionMs, concurrentMs, peakConcurrency };
}

function countContextSwitches(events: Array<{ identity: string }>): number {
  let switches = 0;
  let previous: string | undefined;
  for (const event of events) {
    if (previous !== undefined && event.identity !== previous) switches += 1;
    previous = event.identity;
  }
  return switches;
}
