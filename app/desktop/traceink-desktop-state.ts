import type { TraceinkReviewProjection } from "../../src/traceink-review-state";
import { projectTraceinkReview } from "../../src/traceink-review-state";
import type { TraceinkReviewScopeV1 } from "../../src/traceink-review-assets";
import type { DailyReviewPreparationState } from "../../src/daily-review-schedule";
import type { TodayBoardMode } from "../../src/today-board";
import type { AgentWorkSession, AgentWorkSnapshot } from "../../src/types";
import type { TraceinkAssetStoreDocumentV1 } from "./traceink-asset-store";

const MAX_TRACEINK_ERROR_LENGTH = 240;

export interface EffectiveTraceinkReviewState {
  projection: TraceinkReviewProjection;
  boardMode: TodayBoardMode;
}

export function effectiveTraceinkReviewState(
  store: TraceinkAssetStoreDocumentV1,
  logicalDate: string,
  sessions: AgentWorkSession[],
  legacyBoardMode: TodayBoardMode
): EffectiveTraceinkReviewState {
  const projection = projectTraceinkReview(store, logicalDate, sessions);
  return {
    projection,
    boardMode: projection.activeIndex
      ? projection.mode
      : legacyBoardMode === "sealed"
        ? "sealed"
        : projection.mode
  };
}

export function traceinkActivityDates(store: TraceinkAssetStoreDocumentV1): string[] {
  return Array.from(new Set([
    ...Object.keys(store.activeIndexByDate),
    ...Object.keys(store.activeStructuredIndexByDate ?? {}),
    ...store.artifacts.map((artifact) => artifact.logicalDate),
    ...(store.structuredIndexes ?? []).map((artifact) => artifact.logicalDate),
    ...(store.structuredDossiers ?? []).map((artifact) => artifact.logicalDate),
    ...store.reflections.map((reflection) => reflection.logicalDate)
  ])).sort((left, right) => right.localeCompare(left));
}

export function boundedTraceinkError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const oneLine = raw.replace(/\s+/g, " ").trim() || "工作脉络整理失败。";
  if (oneLine.length <= MAX_TRACEINK_ERROR_LENGTH) return oneLine;
  return `${oneLine.slice(0, MAX_TRACEINK_ERROR_LENGTH - 1).trimEnd()}…`;
}

export function traceinkScopeFromSnapshot(
  snapshot: AgentWorkSnapshot,
  logicalDate: string
): TraceinkReviewScopeV1 {
  const scope = snapshot.evidenceScope;
  if (!scope) throw new Error("Session 扫描没有提供可冻结的本地日期范围。");
  if (snapshot.date !== logicalDate || scope.evidenceCutoff !== snapshot.generatedAt) {
    throw new Error("Session 扫描范围与工作脉络日期或材料截止点不一致。");
  }
  const start = Date.parse(scope.startInclusive);
  const end = Date.parse(scope.endExclusive);
  const cutoff = Date.parse(scope.evidenceCutoff);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(cutoff) || end <= start || cutoff < start) {
    throw new Error("Session 扫描范围无效。");
  }
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: scope.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    formatter.format(new Date(0));
  } catch {
    throw new Error("Session 扫描时区无效。");
  }
  if (
    dateInTimeZone(start, formatter) !== logicalDate ||
    dateInTimeZone(end - 1, formatter) !== logicalDate ||
    dateInTimeZone(end, formatter) !== nextCalendarDate(logicalDate)
  ) {
    throw new Error("Session 扫描范围与工作脉络的本地日界不一致。");
  }
  return structuredClone(scope);
}

export function automaticTraceinkEligibilityMode(mode: TodayBoardMode): TodayBoardMode {
  return mode === "stale" ? "raw" : mode;
}

export function exposeTraceinkFailure(
  state: DailyReviewPreparationState,
  error: string | undefined,
  surfaceMode: TodayBoardMode
): DailyReviewPreparationState {
  if (!error || state.status === "preparing" || surfaceMode === "sealed") return state;
  const {
    scheduledFor: _scheduledFor,
    trigger: _trigger,
    startedAt: _startedAt,
    finishedAt: _finishedAt,
    ...base
  } = state;
  return { ...base, status: "failed", message: error };
}

function dateInTimeZone(timestamp: number, formatter: Intl.DateTimeFormat): string {
  const parts = formatter.formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("Session 扫描范围无法解析。");
  return `${year}-${month}-${day}`;
}

function nextCalendarDate(logicalDate: string): string {
  const date = new Date(`${logicalDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
