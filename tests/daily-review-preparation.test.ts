import assert from "node:assert/strict";
import test from "node:test";
import {
  runDailyReviewPreparation,
  type DailyReviewPreparationDependencies
} from "../app/desktop/daily-review-preparation";
import { loadFreshDailyReviewSnapshot } from "../app/desktop/daily-review-snapshot";
import {
  appendDailyReviewGeneration,
  composeDailyPage,
  createEmptyNotebookDocument,
  notebookStateForDate,
  recordDailyCompilationFailure,
  sealDailyPage,
  type NotebookDocument
} from "../app/desktop/notebook-store";
import type { DesktopNotebookState } from "../app/desktop/api";
import type { AgentWorkSession } from "../src/types";
import type { DailyReviewPackage } from "../src/workline-review";

const logicalDate = "2026-08-09";
const sessions: AgentWorkSession[] = [{
  id: "session-1",
  platform: "codex",
  title: "重建今日工作线",
  summary: "把跨会话证据整理成可回看的工作现场。",
  path: "/tmp/session-1.jsonl",
  startedAt: "2026-08-09T09:00:00.000Z",
  updatedAt: "2026-08-09T10:00:00.000Z",
  projectPath: "/workspace/review",
  resumable: true,
  artifacts: [],
  status: "active"
}];

test("explicit preparation refreshes the requested date before loading its evidence snapshot", async () => {
  let storedSnapshot = {
    date: "2026-08-08",
    generatedAt: "2026-08-08T10:00:00.000Z",
    sessions: [{ ...sessions[0]!, id: "stale-session" }],
    sources: [],
    warnings: []
  };
  const events: string[] = [];

  const snapshot = await loadFreshDailyReviewSnapshot(logicalDate, {
    async refreshSnapshot(requestedDate) {
      events.push(`refresh:${requestedDate}`);
      storedSnapshot = {
        date: requestedDate,
        generatedAt: "2026-08-09T10:01:00.000Z",
        sessions: [{ ...sessions[0]!, id: "fresh-session" }],
        sources: [],
        warnings: []
      };
    },
    async loadSnapshot() {
      events.push("load");
      return structuredClone(storedSnapshot);
    }
  });

  assert.deepEqual(events, [`refresh:${logicalDate}`, "load"]);
  assert.equal(snapshot.date, logicalDate);
  assert.equal(snapshot.generatedAt, "2026-08-09T10:01:00.000Z");
  assert.equal(snapshot.sessions[0]?.id, "fresh-session");
});

test("raw compile appends the first package generation only after the compiler succeeds", async () => {
  const harness = createHarness(createEmptyNotebookDocument(), [reviewPackage("package-1", "2026-08-09T10:05:00.000Z")]);

  const state = await harness.prepare("compile");

  assert.equal(harness.compileCalls, 1);
  assert.equal(harness.commitCalls, 1);
  assert.equal(harness.failureCalls, 0);
  assert.equal(state.todayBoard.mode, "compiled");
  assert.deepEqual(state.page.packageGenerations?.map((generation) => generation.package.id), ["package-1"]);
});

test("refresh appends a second generation without replacing the first package or personal ink", async () => {
  const first = composeDailyPage(
    createEmptyNotebookDocument(),
    logicalDate,
    sessions,
    new Date("2026-08-09T10:05:00.000Z"),
    reviewPackage("package-1", "2026-08-09T10:05:00.000Z")
  );
  const withInk: NotebookDocument = {
    ...first,
    pages: {
      ...first.pages,
      [logicalDate]: {
        ...first.pages[logicalDate]!,
        reflection: "这是用户自己的判断。",
        bookmarks: [{
          id: "bookmark-1",
          title: "继续验证",
          projectName: "review",
          provider: "codex",
          sessionId: "session-1",
          sessionPath: "/tmp/session-1.jsonl"
        }]
      }
    }
  };
  const harness = createHarness(withInk, [reviewPackage("package-2", "2026-08-09T11:05:00.000Z")]);

  const state = await harness.prepare("refresh");

  assert.deepEqual(state.page.packageGenerations?.map((generation) => generation.package.id), ["package-1", "package-2"]);
  assert.equal(state.page.reflection, "这是用户自己的判断。");
  assert.deepEqual(state.page.bookmarks.map((bookmark) => bookmark.id), ["bookmark-1"]);
});

test("refresh failure preserves the active package asset and records only a diagnostic", async () => {
  const first = composeDailyPage(
    createEmptyNotebookDocument(),
    logicalDate,
    sessions,
    new Date("2026-08-09T10:05:00.000Z"),
    reviewPackage("package-1", "2026-08-09T10:05:00.000Z")
  );
  const before = notebookStateForDate(first, logicalDate, sessions).page;
  const harness = createHarness(first, [new Error("模型暂时不可用")]);

  await assert.rejects(harness.prepare("refresh"), /模型暂时不可用/);

  const after = notebookStateForDate(harness.document, logicalDate, sessions).page;
  assert.equal(harness.commitCalls, 0);
  assert.equal(harness.failureCalls, 1);
  assert.deepEqual(after.packageGenerations, before.packageGenerations);
  assert.equal(after.activePackageGenerationId, before.activePackageGenerationId);
  assert.deepEqual(after.worklineReflections, before.worklineReflections);
  assert.deepEqual(after.bookmarks, before.bookmarks);
  assert.equal(after.lastCompilationError, "模型暂时不可用");
});

test("raw compile failure leaves the day raw and persists a retryable diagnostic", async () => {
  const harness = createHarness(createEmptyNotebookDocument(), [new Error("没有可用模型")]);

  await assert.rejects(harness.prepare("compile"), /没有可用模型/);

  assert.equal(harness.compileCalls, 1);
  assert.equal(harness.commitCalls, 0);
  assert.equal(harness.failureCalls, 1);
  assert.equal(notebookStateForDate(harness.document, logicalDate, sessions).todayBoard.mode, "raw");
  assert.equal(harness.document.pages[logicalDate]?.lastCompilationError, "没有可用模型");
});

test("sealed day rejects before the compiler is invoked", async () => {
  const drafted = composeDailyPage(
    createEmptyNotebookDocument(),
    logicalDate,
    sessions,
    new Date("2026-08-09T10:05:00.000Z"),
    reviewPackage("package-1", "2026-08-09T10:05:00.000Z")
  );
  const sealed = sealDailyPage(drafted, logicalDate, {
    reflection: "今天到这里。",
    bookmarkIds: [],
    expectedActiveGenerationId: drafted.pages[logicalDate]?.activePackageGenerationId ?? null
  }, [], new Date("2026-08-09T18:00:00.000Z"));
  const harness = createHarness(sealed, [reviewPackage("forbidden", "2026-08-09T18:05:00.000Z")]);

  await assert.rejects(harness.prepare("refresh"), /已经封页/);

  assert.equal(harness.compileCalls, 0);
  assert.equal(harness.commitCalls, 0);
  assert.equal(harness.failureCalls, 0);
});

test("preparation promise remains pending and does not mutate while the compiler is running", async () => {
  let resolveCompiler!: (value: DailyReviewPackage) => void;
  const compiler = new Promise<DailyReviewPackage>((resolve) => { resolveCompiler = resolve; });
  const harness = createHarness(createEmptyNotebookDocument(), [compiler]);
  let settled = false;

  const pending = harness.prepare("compile").finally(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(settled, false);
  assert.equal(harness.compileCalls, 1);
  assert.equal(harness.commitCalls, 0);
  assert.equal(harness.failureCalls, 0);

  resolveCompiler(reviewPackage("package-1", "2026-08-09T10:05:00.000Z"));
  await pending;
  assert.equal(harness.commitCalls, 1);
});

test("a successful refresh clears the previous compilation diagnostic", async () => {
  const first = composeDailyPage(
    createEmptyNotebookDocument(),
    logicalDate,
    sessions,
    new Date("2026-08-09T10:05:00.000Z"),
    reviewPackage("package-1", "2026-08-09T10:05:00.000Z")
  );
  const failed = recordDailyCompilationFailure(first, logicalDate, "上次刷新失败", new Date("2026-08-09T10:30:00.000Z"));
  const harness = createHarness(failed, [reviewPackage("package-2", "2026-08-09T11:05:00.000Z")]);

  const state = await harness.prepare("refresh");

  assert.equal(state.page.lastCompilationError, undefined);
  assert.equal(state.page.packageGenerations?.length, 2);
});

test("an impossible calendar date is rejected before the compiler is invoked", async () => {
  let compileCalls = 0;

  await assert.rejects(runDailyReviewPreparation({
    logicalDate: "2026-02-30",
    mode: "compile",
    snapshotDate: "2026-02-30",
    evidenceCutoff: "2026-02-28T10:00:00.000Z",
    sessions,
    board: { mode: "raw", uncompiledEvidence: [] }
  }, {
    async compile() {
      compileCalls += 1;
      return reviewPackage("forbidden", "2026-02-28T10:05:00.000Z");
    },
    async commitSuccess() {
      throw new Error("不应提交");
    },
    async recordFailure() {
      throw new Error("不应记录");
    }
  }), /日期无效/);

  assert.equal(compileCalls, 0);
});

test("an unknown preparation mode is rejected before the compiler is invoked", async () => {
  let compileCalls = 0;
  await assert.rejects(runDailyReviewPreparation({
    logicalDate,
    mode: "unknown" as "compile",
    snapshotDate: logicalDate,
    evidenceCutoff: "2026-08-09T10:00:00.000Z",
    sessions,
    board: { mode: "raw", uncompiledEvidence: [] }
  }, {
    async compile() {
      compileCalls += 1;
      return reviewPackage("forbidden", "2026-08-09T10:05:00.000Z");
    },
    async commitSuccess() { throw new Error("不应提交"); },
    async recordFailure() { throw new Error("不应记录"); }
  }), /方式无效/);
  assert.equal(compileCalls, 0);
});

function createHarness(
  initialDocument: NotebookDocument,
  compilerResults: Array<DailyReviewPackage | Error | Promise<DailyReviewPackage>>
) {
  let document = structuredClone(initialDocument);
  let compileCalls = 0;
  let commitCalls = 0;
  let failureCalls = 0;
  const dependencies: DailyReviewPreparationDependencies<DesktopNotebookState> = {
    async compile() {
      compileCalls += 1;
      const result = compilerResults.shift();
      if (result instanceof Error) throw result;
      if (!result) throw new Error("测试没有提供编译结果");
      return result;
    },
    async commitSuccess({ reviewPackage: nextPackage, capturedSessions, expectedActiveGenerationId }) {
      commitCalls += 1;
      document = appendDailyReviewGeneration(
        document,
        logicalDate,
        capturedSessions,
        new Date(nextPackage.generatedAt),
        nextPackage,
        expectedActiveGenerationId
      );
      return notebookStateForDate(document, logicalDate, capturedSessions);
    },
    async recordFailure({ message, expectedActiveGenerationId }) {
      failureCalls += 1;
      document = recordDailyCompilationFailure(
        document,
        logicalDate,
        message,
        new Date("2026-08-09T12:00:00.000Z"),
        expectedActiveGenerationId
      );
    }
  };
  return {
    get document() { return document; },
    get compileCalls() { return compileCalls; },
    get commitCalls() { return commitCalls; },
    get failureCalls() { return failureCalls; },
    prepare(mode: "compile" | "refresh") {
      const board = notebookStateForDate(document, logicalDate, sessions).todayBoard;
      return runDailyReviewPreparation({
        logicalDate,
        mode,
        snapshotDate: logicalDate,
        evidenceCutoff: "2026-08-09T10:00:00.000Z",
        sessions,
        board
      }, dependencies);
    }
  };
}

function reviewPackage(id: string, generatedAt: string): DailyReviewPackage {
  return {
    schemaVersion: 1,
    id,
    logicalDate,
    generatedAt,
    evidenceCutoff: generatedAt,
    promptProfile: "traceink-review-v1",
    compilerProvider: "codex",
    model: "review-model",
    evidence: [{
      id: "session:codex:session-1",
      kind: "session",
      label: "重建今日工作线",
      path: "/tmp/session-1.jsonl",
      platform: "codex",
      sessionId: "session-1",
      startedAt: "2026-08-09T09:00:00.000Z",
      updatedAt: "2026-08-09T10:00:00.000Z"
    }],
    worklines: [{
      id: "workline-1",
      title: "今日工作线",
      summary: "可回看的证据现场。",
      status: "needs-judgment",
      sourceSessionIds: ["codex:session-1"],
      participation: [{ id: "agent-1", kind: "agent", label: "Agent 处理" }],
      dossier: {
        title: "今日工作线",
        dek: "只整理证据，不替用户判断。",
        blocks: [{
          id: "evidence-1",
          kind: "evidence-change",
          title: "证据发生变化",
          body: "工作现场已经重建。",
          evidenceIds: ["session:codex:session-1"],
          payload: {}
        }, {
          id: "future-1",
          kind: "future-observation",
          title: "下一次观察",
          body: "下次回看验证材料是否减少翻找。",
          evidenceIds: ["session:codex:session-1"],
          payload: {}
        }],
        question: { prompt: "这套材料是否足以让你亲自判断？" }
      },
      payload: {}
    }],
    warnings: [],
    rawOutput: { worklines: [{ id: "workline-1" }] }
  };
}
