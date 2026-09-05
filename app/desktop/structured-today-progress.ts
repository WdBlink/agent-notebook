import type { StructuredTodayProgressState, StructuredTodayRunProgress } from "./api";
import type { StructuredTodayRunRecordV1 } from "./traceink-asset-store";

export function projectStructuredTodayProgress(
  logicalDate: string,
  runs: StructuredTodayRunRecordV1[],
  memory: StructuredTodayProgressState = { dossierByWorklineId: {} }
): StructuredTodayProgressState {
  const dated = runs
    .filter((run) => run.logicalDate === logicalDate)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  const indexRun = dated.filter((run) => run.kind === "index").at(-1);
  const dossierByWorklineId: Record<string, StructuredTodayRunProgress> = {};
  const proposalByWorklineId: Record<string, StructuredTodayRunProgress> = {};
  for (const run of dated) {
    if (!run.worklineId) continue;
    if (run.kind === "dossier") dossierByWorklineId[run.worklineId] = recoveredRunProgress(run, memory.dossierByWorklineId[run.worklineId]);
    if (run.kind === "proposals") proposalByWorklineId[run.worklineId] = recoveredRunProgress(run, memory.proposalByWorklineId?.[run.worklineId]);
  }
  return {
    ...(memory.index ? { index: memory.index } : indexRun ? { index: recoveredRunProgress(indexRun, undefined) } : {}),
    dossierByWorklineId: { ...dossierByWorklineId, ...memory.dossierByWorklineId },
    proposalByWorklineId: { ...proposalByWorklineId, ...(memory.proposalByWorklineId ?? {}) }
  };
}

function recoveredRunProgress(
  run: StructuredTodayRunRecordV1,
  memory: StructuredTodayRunProgress | undefined
): StructuredTodayRunProgress {
  if (memory?.runId === run.runId) return memory;
  const interrupted = run.status === "running";
  return {
    runId: run.runId,
    status: interrupted ? "failed" : run.status,
    stage: interrupted ? "interrupted" : run.stage,
    completed: run.completed,
    total: run.total,
    ...(interrupted
      ? { message: "上次整理在应用退出时中断；再次操作会在恢复记录有效时继续，否则重新整理。" }
      : run.message ? { message: run.message } : {})
  };
}
