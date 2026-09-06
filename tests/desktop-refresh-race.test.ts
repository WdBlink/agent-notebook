import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("snapshot publication ignores obsolete scans and preserves concurrent settings", async () => {
  const main = await fs.readFile(path.resolve("app/desktop/main.ts"), "utf8");
  const source = main.slice(main.indexOf("async function refreshSnapshot("), main.indexOf("function scheduleSessionSummaries("));
  const executable = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const pending = new Map<string, (snapshot: any) => void>();
  const sandbox: any = {
    data: { settings: { marker: "old" }, workSessionSnapshot: { date: "2026-08-29", sessions: [] } },
    summaryAbort: undefined, activityDateCache: undefined, snapshotRunId: 0, activeDate: "2026-08-30", summaryRunId: 0, summaryJob: {}, summaryCache: {}, summaryModels: {}, runtimeFs: {}, os: { homedir: () => "/tmp" }, MAX_WORK_SESSION_SNAPSHOT_SESSIONS: 48,
    loadAgentWorkSnapshot: (_settings: any, { date }: any) => new Promise((resolve) => pending.set(date, resolve)),
    readCachedSessionSummaries: () => ({ summaries: [], misses: [] }), mergeSessionSummaries: (sessions: any) => sessions,
    notebook: {}, notebookStateForDate: () => ({ todayBoard: { mode: "raw" } }),
    requireTraceinkAssetRepository: () => ({ snapshot: () => ({}) }), projectStructuredTodayReview: () => ({}),
    effectiveTraceinkReviewState: () => ({ boardMode: "raw" }), effectiveStructuredBoardMode: () => "raw",
    normalizeData: (value: any) => value, setWorkSessionSnapshot: (current: any, snapshot: any) => ({ ...current, workSessionSnapshot: snapshot }),
    persistStore: async () => {}, shouldScheduleSessionSummaries: () => false
  };
  sandbox.ensureLoaded = async () => sandbox.data;
  runInNewContext(executable, sandbox);
  const older = sandbox.refreshSnapshot("2026-08-29", { scheduleSummaries: false });
  const newer = sandbox.refreshSnapshot("2026-08-30", { scheduleSummaries: false });
  await new Promise((resolve) => setImmediate(resolve));
  sandbox.data = { ...sandbox.data, settings: { marker: "new" } };
  pending.get("2026-08-30")!({ date: "2026-08-30", sessions: [] });
  await newer;
  pending.get("2026-08-29")!({ date: "2026-08-29", sessions: [] });
  await older;
  assert.equal(sandbox.data.workSessionSnapshot.date, "2026-08-30");
  assert.equal(sandbox.data.settings.marker, "new");
});
