import type { DailyReviewPreparationMode, DesktopNotebookState } from "./api";
import type { AgentWorkSession } from "../../src/types";
import type { TodayBoardProjection } from "../../src/today-board";
import type { DailyReviewPackage } from "../../src/workline-review";

export interface DailyReviewPreparationInput {
  logicalDate: string;
  mode: DailyReviewPreparationMode;
  snapshotDate: string;
  evidenceCutoff: string;
  sessions: AgentWorkSession[];
  board: TodayBoardProjection;
}

export interface DailyReviewPreparationDependencies<TResult = DesktopNotebookState> {
  compile(input: {
    logicalDate: string;
    evidenceCutoff: string;
    capturedSessions: AgentWorkSession[];
  }): Promise<DailyReviewPackage>;
  commitSuccess(input: {
    logicalDate: string;
    reviewPackage: DailyReviewPackage;
    capturedSessions: AgentWorkSession[];
    expectedActiveGenerationId: string | null;
  }): Promise<TResult>;
  recordFailure(input: {
    logicalDate: string;
    message: string;
    expectedActiveGenerationId: string | null;
  }): Promise<void>;
}

export async function runDailyReviewPreparation<TResult>(
  input: DailyReviewPreparationInput,
  dependencies: DailyReviewPreparationDependencies<TResult>
): Promise<TResult> {
  if (!isLogicalDate(input.logicalDate)) throw new Error("回看日期无效。");
  if (input.mode !== "compile" && input.mode !== "refresh") throw new Error("回看整理方式无效。");
  if (input.snapshotDate !== input.logicalDate) throw new Error("当前会话快照与回看日期不一致，请先读取该日期。");
  if (input.board.mode === "sealed") throw new Error("这一天已经封页，不能重新整理。");
  if (input.board.mode === "raw" && input.mode !== "compile") throw new Error("这一天还没有工作线，请先编译。");
  if (input.board.mode !== "raw" && input.mode !== "refresh") throw new Error("这一天已有工作线，请使用刷新。");

  const capturedSessions = structuredClone(input.sessions);
  const expectedActiveGenerationId = input.board.activeGeneration?.id ?? null;
  let reviewPackage: DailyReviewPackage;
  try {
    reviewPackage = await dependencies.compile({
      logicalDate: input.logicalDate,
      evidenceCutoff: input.evidenceCutoff,
      capturedSessions
    });
    if (reviewPackage.logicalDate !== input.logicalDate) throw new Error("模型返回的回看日期与请求日期不一致。");
  } catch (error) {
    await dependencies.recordFailure({
      logicalDate: input.logicalDate,
      message: errorMessage(error),
      expectedActiveGenerationId
    });
    throw error;
  }
  return dependencies.commitSuccess({
    logicalDate: input.logicalDate,
    reviewPackage,
    capturedSessions,
    expectedActiveGenerationId
  });
}

function isLogicalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.toISOString().slice(0, 10) === value;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.replace(/\s+/g, " ").trim().slice(0, 2_000);
  return "整理失败，请重试。";
}
