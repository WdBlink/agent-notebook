import type { AgentWorkSnapshot } from "../../src/types";

export interface DailyReviewSnapshotDependencies {
  refreshSnapshot(logicalDate: string): Promise<void>;
  loadSnapshot(): Promise<AgentWorkSnapshot>;
}

export async function loadFreshDailyReviewSnapshot(
  logicalDate: string,
  dependencies: DailyReviewSnapshotDependencies
): Promise<AgentWorkSnapshot> {
  await dependencies.refreshSnapshot(logicalDate);
  const snapshot = await dependencies.loadSnapshot();
  if (snapshot.date !== logicalDate) throw new Error("刷新后的会话快照与回看日期不一致。");
  return structuredClone(snapshot);
}
