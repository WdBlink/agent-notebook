import assert from "node:assert/strict";
import test from "node:test";
import type { AgentWorkSession } from "../src/types";
import type { DailyReviewPackage } from "../src/workline-review";
import {
  appendDailyReviewGeneration,
  compileWorkRecords,
  composeDailyPage,
  createEmptyNotebookDocument,
  createNotebookNote,
  markNotebookDelivery,
  normalizeNotebookDocument,
  notebookStateForDate,
  recordDailyCompilationFailure,
  saveDailyDraft,
  sealDailyPage,
  updateNotebookNote
} from "../app/desktop/notebook-store";

const sessions: AgentWorkSession[] = [
  {
    id: "codex-1",
    platform: "codex",
    title: "明确今日手帐闭环",
    summary: "把白天采集、晚间整理和封页连接成同一条路径。",
    path: "/tmp/codex-1.jsonl",
    updatedAt: "2026-08-01T10:00:00+08:00",
    projectPath: "/workspace/work-continuity",
    resumable: true,
    artifacts: [],
    status: "active"
  },
  {
    id: "claude-1",
    platform: "claude",
    title: "验证便签路由边界",
    summary: "便签只有经由小飞机操作才会离开今日页面。",
    path: "/tmp/claude-1.jsonl",
    updatedAt: "2026-08-01T15:00:00+08:00",
    projectPath: "/workspace/work-continuity",
    resumable: true,
    artifacts: [],
    status: "blocked"
  }
];

test("project records create information gain without losing session evidence", () => {
  const records = compileWorkRecords(sessions);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.projectName, "work-continuity");
  assert.match(records[0]?.changed ?? "", /2 条会话被归并/);
  assert.match(records[0]?.uncertainty ?? "", /阻塞/);
  assert.deepEqual(records[0]?.sessions.map((session) => session.id), ["codex-1", "claude-1"]);
});

test("notes remain durable user ink and delivery is explicit", () => {
  const created = createNotebookNote(createEmptyNotebookDocument("/wiki"), "2026-08-01", { body: "https://example.com 一条参考资料" }, new Date("2026-08-01T09:00:00Z"), "note-1");
  assert.equal(created.notes[0]?.kind, "web");
  assert.equal(created.notes[0]?.deliveries.length, 0);
  const edited = updateNotebookNote(created, "note-1", { favorite: true });
  const delivered = markNotebookDelivery(edited, "note-1", { kind: "wiki", deliveredAt: "2026-08-01T10:00:00.000Z", target: "/wiki/raw/note-1.md", status: "queued" });
  assert.equal(delivered.notes[0]?.favorite, true);
  assert.equal(delivered.notes[0]?.deliveries[0]?.target, "/wiki/raw/note-1.md");
});

test("sealing freezes work records, reflection, and selected bookmarks", () => {
  const empty = createEmptyNotebookDocument();
  const composed = composeDailyPage(empty, "2026-08-01", sessions, new Date("2026-08-01T18:00:00Z"), reviewPackage());
  const state = notebookStateForDate(composed, "2026-08-01", sessions);
  const selected = state.continuationCandidates.map((item) => item.id);
  const drafted = saveDailyDraft(composed, "2026-08-01", {
    reflection: "今天到这里。",
    bookmarkIds: selected,
    expectedActiveGenerationId: composed.pages["2026-08-01"]?.activePackageGenerationId ?? null
  }, state.continuationCandidates, new Date("2026-08-01T18:05:00Z"));
  const sealed = sealDailyPage(drafted, "2026-08-01", {
    reflection: "今天到这里。",
    bookmarkIds: selected,
    expectedActiveGenerationId: drafted.pages["2026-08-01"]?.activePackageGenerationId ?? null
  }, state.continuationCandidates, new Date("2026-08-01T18:10:00Z"));
  assert.equal(sealed.pages["2026-08-01"]?.status, "sealed");
  assert.equal(sealed.pages["2026-08-01"]?.reflection, "今天到这里。");
  assert.equal(sealed.pages["2026-08-01"]?.workRecords.length, 1);
  assert.throws(() => composeDailyPage(sealed, "2026-08-01", [], new Date("2026-08-01T19:00:00Z")), /已经封页/);
});

test("review drafts preserve the exact generated package and one user reflection per workline", () => {
  const empty = createEmptyNotebookDocument();
  const review = reviewPackage();
  const composed = composeDailyPage(
    empty,
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:00:00Z"),
    review
  );
  const state = notebookStateForDate(composed, "2026-08-01", sessions);
  const drafted = saveDailyDraft(
    composed,
    "2026-08-01",
    {
      reflection: "",
      worklineReflections: [
        { worklineId: "workline-review", text: "我认为应该先验证真实任务。" },
        { worklineId: "invented-workline", text: "不能被保存。" }
      ],
      bookmarkIds: [],
      expectedActiveGenerationId: composed.pages["2026-08-01"]?.activePackageGenerationId ?? null
    },
    state.continuationCandidates,
    new Date("2026-08-01T18:05:00Z")
  );

  assert.equal(drafted.pages["2026-08-01"]?.schemaVersion, 3);
  assert.deepEqual(drafted.pages["2026-08-01"]?.reviewPackage, review);
  assert.deepEqual(drafted.pages["2026-08-01"]?.worklineReflections, [
    {
      packageGenerationId: composed.pages["2026-08-01"]!.activePackageGenerationId!,
      worklineId: "workline-review",
      text: "我认为应该先验证真实任务。",
      updatedAt: "2026-08-01T18:05:00.000Z"
    }
  ]);

  const sealed = sealDailyPage(
    drafted,
    "2026-08-01",
    {
      reflection: "",
      worklineReflections: [{ worklineId: "workline-review", text: "我认为应该先验证真实任务。" }],
      bookmarkIds: [],
      expectedActiveGenerationId: drafted.pages["2026-08-01"]?.activePackageGenerationId ?? null
    },
    state.continuationCandidates,
    new Date("2026-08-01T18:10:00Z")
  );
  const serialized = JSON.stringify(sealed.pages["2026-08-01"]);
  const reloaded = normalizeNotebookDocument(JSON.parse(JSON.stringify(sealed)));
  assert.deepEqual(reloaded.pages["2026-08-01"]?.reviewPackage, review);
  assert.deepEqual(reloaded.pages["2026-08-01"]?.worklineReflections, sealed.pages["2026-08-01"]?.worklineReflections);
  assert.throws(
    () => composeDailyPage(sealed, "2026-08-01", sessions, new Date("2026-08-01T19:00:00Z"), { ...review, id: "newer-review" }),
    /已经封页/
  );
  assert.equal(JSON.stringify(sealed.pages["2026-08-01"]), serialized);
});

test("successful refresh appends a package generation and activates it without replacing user data", () => {
  const first = composeDailyPage(createEmptyNotebookDocument(), "2026-08-01", sessions, new Date("2026-08-01T18:00:00Z"), reviewPackage());
  const drafted = saveDailyDraft(first, "2026-08-01", {
    reflection: "用户自己的判断。",
    bookmarkIds: [],
    expectedActiveGenerationId: first.pages["2026-08-01"]?.activePackageGenerationId ?? null
  }, [], new Date("2026-08-01T18:01:00Z"));
  const nextPackage = { ...reviewPackage(), id: "review-package-2", generatedAt: "2026-08-01T19:00:00.000Z", evidenceCutoff: "2026-08-01T19:00:00.000Z" };
  const refreshed = composeDailyPage(drafted, "2026-08-01", sessions, new Date("2026-08-01T19:00:00Z"), nextPackage);
  const page = refreshed.pages["2026-08-01"];

  assert.equal(page?.packageGenerations?.length, 2);
  assert.deepEqual(page?.packageGenerations?.map((generation) => generation.package.id), ["review-package", "review-package-2"]);
  assert.equal(page?.activePackageGenerationId, page?.packageGenerations?.[1]?.id);
  assert.equal(page?.reviewPackage?.id, "review-package-2");
  assert.equal(page?.reflection, "用户自己的判断。");
});

test("same-fingerprint successful refreshes retain distinct active generations after reload", () => {
  const firstPackage = reviewPackage();
  const secondPackage = { ...reviewPackage(), rawOutput: { worklines: [], compilation: "second successful result" } };
  const first = composeDailyPage(createEmptyNotebookDocument(), "2026-08-01", sessions, new Date("2026-08-01T18:00:00Z"), firstPackage);
  const refreshed = composeDailyPage(first, "2026-08-01", sessions, new Date("2026-08-01T18:00:00Z"), secondPackage);
  const reloaded = normalizeNotebookDocument(JSON.parse(JSON.stringify(refreshed)));
  const page = reloaded.pages["2026-08-01"];

  assert.equal(page?.packageGenerations?.length, 2);
  assert.notEqual(page?.packageGenerations?.[0]?.id, page?.packageGenerations?.[1]?.id);
  assert.equal(page?.activePackageGenerationId, page?.packageGenerations?.[1]?.id);
  assert.deepEqual(page?.reviewPackage?.rawOutput, { worklines: [], compilation: "second successful result" });
});

test("failed compilation records a retryable error without replacing the active successful generation", () => {
  const composed = composeDailyPage(createEmptyNotebookDocument(), "2026-08-01", sessions, new Date("2026-08-01T18:00:00Z"), reviewPackage());
  const failed = recordDailyCompilationFailure(composed, "2026-08-01", "模型没有返回可用工作线。", new Date("2026-08-01T19:00:00Z"));
  const page = failed.pages["2026-08-01"];

  assert.equal(page?.packageGenerations?.length, 1);
  assert.equal(page?.activePackageGenerationId, composed.pages["2026-08-01"]?.activePackageGenerationId);
  assert.equal(page?.reviewPackage?.id, "review-package");
  assert.equal(page?.lastCompilationError, "模型没有返回可用工作线。");
});

test("out-of-order refresh cannot append over a newer active generation", () => {
  const first = composeDailyPage(
    createEmptyNotebookDocument(),
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:00:00Z"),
    reviewPackage()
  );
  const firstGenerationId = first.pages["2026-08-01"]?.activePackageGenerationId ?? null;
  const secondPackage = {
    ...reviewPackage(),
    id: "review-package-2",
    generatedAt: "2026-08-01T18:10:00.000Z"
  };
  const second = appendDailyReviewGeneration(
    first,
    "2026-08-01",
    sessions,
    new Date(secondPackage.generatedAt),
    secondPackage,
    firstGenerationId
  );
  const secondGenerationId = second.pages["2026-08-01"]?.activePackageGenerationId;

  assert.throws(() => appendDailyReviewGeneration(
    second,
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:20:00.000Z"),
    { ...reviewPackage(), id: "late-package", generatedAt: "2026-08-01T18:20:00.000Z" },
    firstGenerationId
  ), /已经变化|过期/);
  assert.equal(second.pages["2026-08-01"]?.activePackageGenerationId, secondGenerationId);
  assert.deepEqual(second.pages["2026-08-01"]?.packageGenerations?.map((item) => item.package.id), ["review-package", "review-package-2"]);
});

test("an opened generation cannot save or seal after a newer generation becomes active", () => {
  const first = composeDailyPage(
    createEmptyNotebookDocument(),
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:00:00.000Z"),
    reviewPackage()
  );
  const openedGenerationId = first.pages["2026-08-01"]!.activePackageGenerationId!;
  const second = appendDailyReviewGeneration(
    first,
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:10:00.000Z"),
    { ...reviewPackage(), id: "review-package-2", generatedAt: "2026-08-01T18:10:00.000Z" },
    openedGenerationId
  );
  const before = JSON.stringify(second.pages["2026-08-01"]);
  const staleInput = {
    reflection: "",
    worklineReflections: [{ worklineId: "workline-review", text: "只属于打开时那一代的未存墨迹" }],
    bookmarkIds: [],
    expectedActiveGenerationId: openedGenerationId
  };

  assert.throws(
    () => saveDailyDraft(second, "2026-08-01", staleInput, [], new Date("2026-08-01T18:15:00.000Z")),
    /已经变化|过期/
  );
  assert.throws(
    () => sealDailyPage(second, "2026-08-01", staleInput, [], new Date("2026-08-01T18:15:00.000Z")),
    /已经变化|过期/
  );
  assert.equal(JSON.stringify(second.pages["2026-08-01"]), before);
  assert.deepEqual(second.pages["2026-08-01"]?.worklineReflections, []);
});

test("a late failed refresh cannot attach its diagnostic to a newer successful generation", () => {
  const first = composeDailyPage(
    createEmptyNotebookDocument(),
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:00:00Z"),
    reviewPackage()
  );
  const firstGenerationId = first.pages["2026-08-01"]?.activePackageGenerationId ?? null;
  const second = appendDailyReviewGeneration(
    first,
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:10:00.000Z"),
    { ...reviewPackage(), id: "review-package-2", generatedAt: "2026-08-01T18:10:00.000Z" },
    firstGenerationId
  );

  const afterLateFailure = recordDailyCompilationFailure(
    second,
    "2026-08-01",
    "较早的刷新刚刚失败",
    new Date("2026-08-01T18:15:00.000Z"),
    firstGenerationId
  );

  assert.equal(afterLateFailure.pages["2026-08-01"]?.lastCompilationError, undefined);
  assert.equal(afterLateFailure.pages["2026-08-01"]?.activePackageGenerationId, second.pages["2026-08-01"]?.activePackageGenerationId);
});

test("sealing requires the active generation the user actually reviewed", () => {
  const first = composeDailyPage(
    createEmptyNotebookDocument(),
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:00:00Z"),
    reviewPackage()
  );
  const firstGenerationId = first.pages["2026-08-01"]?.activePackageGenerationId ?? null;
  const second = appendDailyReviewGeneration(
    first,
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:10:00.000Z"),
    { ...reviewPackage(), id: "review-package-2", generatedAt: "2026-08-01T18:10:00.000Z" },
    firstGenerationId
  );

  assert.throws(() => sealDailyPage(second, "2026-08-01", {
    reflection: "我只看过第一版。",
    bookmarkIds: [],
    expectedActiveGenerationId: firstGenerationId
  }, [], new Date("2026-08-01T18:15:00.000Z")), /已经变化|过期/);
  assert.equal(second.pages["2026-08-01"]?.status, "draft");

  const sealed = sealDailyPage(first, "2026-08-01", {
    reflection: "我确认了这一版。",
    bookmarkIds: [],
    expectedActiveGenerationId: firstGenerationId
  }, [], new Date("2026-08-01T18:15:00.000Z"));
  assert.throws(() => appendDailyReviewGeneration(
    sealed,
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:20:00.000Z"),
    { ...reviewPackage(), id: "too-late", generatedAt: "2026-08-01T18:20:00.000Z" },
    firstGenerationId
  ), /已经封页/);
});

test("refresh and reload preserve user reflections attached to older package generations", () => {
  const firstPackage = reviewPackage();
  const first = composeDailyPage(
    createEmptyNotebookDocument(),
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:00:00Z"),
    firstPackage
  );
  const withInk = saveDailyDraft(first, "2026-08-01", {
    reflection: "",
    worklineReflections: [{ worklineId: "workline-review", text: "旧工作线上的用户判断。" }],
    bookmarkIds: [],
    expectedActiveGenerationId: first.pages["2026-08-01"]?.activePackageGenerationId ?? null
  }, [], new Date("2026-08-01T18:05:00Z"));
  const firstGenerationId = withInk.pages["2026-08-01"]?.activePackageGenerationId ?? null;
  const secondPackage: DailyReviewPackage = {
    ...reviewPackage(),
    id: "review-package-2",
    generatedAt: "2026-08-01T18:10:00.000Z",
    worklines: [{ ...reviewPackage().worklines[0]!, id: "workline-new", title: "新的工作线" }]
  };
  const refreshed = appendDailyReviewGeneration(
    withInk,
    "2026-08-01",
    sessions,
    new Date(secondPackage.generatedAt),
    secondPackage,
    firstGenerationId
  );
  const reloaded = normalizeNotebookDocument(JSON.parse(JSON.stringify(refreshed)));

  assert.deepEqual(reloaded.pages["2026-08-01"]?.worklineReflections, [{
    packageGenerationId: firstGenerationId,
    worklineId: "workline-review",
    text: "旧工作线上的用户判断。",
    updatedAt: "2026-08-01T18:05:00.000Z"
  }]);
  const rejectedNewWrite = saveDailyDraft(reloaded, "2026-08-01", {
    reflection: "",
    worklineReflections: [{ worklineId: "workline-review", text: "不能改写非当前工作线。" }],
    bookmarkIds: [],
    expectedActiveGenerationId: reloaded.pages["2026-08-01"]?.activePackageGenerationId ?? null
  }, [], new Date("2026-08-01T18:15:00Z"));
  assert.deepEqual(rejectedNewWrite.pages["2026-08-01"]?.worklineReflections, [{
    packageGenerationId: firstGenerationId,
    worklineId: "workline-review",
    text: "旧工作线上的用户判断。",
    updatedAt: "2026-08-01T18:05:00.000Z"
  }]);
});

test("the same workline id keeps independent ink in each package generation", () => {
  const first = composeDailyPage(
    createEmptyNotebookDocument(),
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:00:00.000Z"),
    reviewPackage()
  );
  const firstGenerationId = first.pages["2026-08-01"]!.activePackageGenerationId!;
  const withFirstInk = saveDailyDraft(first, "2026-08-01", {
    reflection: "",
    worklineReflections: [{ worklineId: "workline-review", text: "A" }],
    bookmarkIds: [],
    expectedActiveGenerationId: firstGenerationId
  }, [], new Date("2026-08-01T18:05:00.000Z"));
  const second = appendDailyReviewGeneration(
    withFirstInk,
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:10:00.000Z"),
    { ...reviewPackage(), id: "review-package-2", generatedAt: "2026-08-01T18:10:00.000Z" },
    firstGenerationId
  );
  const secondGenerationId = second.pages["2026-08-01"]!.activePackageGenerationId!;

  assert.deepEqual(second.pages["2026-08-01"]?.worklineReflections, [{
    packageGenerationId: firstGenerationId,
    worklineId: "workline-review",
    text: "A",
    updatedAt: "2026-08-01T18:05:00.000Z"
  }]);

  const withSecondInk = saveDailyDraft(second, "2026-08-01", {
    reflection: "",
    worklineReflections: [{ worklineId: "workline-review", text: "B" }],
    bookmarkIds: [],
    expectedActiveGenerationId: secondGenerationId
  }, [], new Date("2026-08-01T18:15:00.000Z"));
  const reloaded = normalizeNotebookDocument(JSON.parse(JSON.stringify(withSecondInk)));

  assert.deepEqual(reloaded.pages["2026-08-01"]?.worklineReflections, [
    {
      packageGenerationId: firstGenerationId,
      worklineId: "workline-review",
      text: "A",
      updatedAt: "2026-08-01T18:05:00.000Z"
    },
    {
      packageGenerationId: secondGenerationId,
      worklineId: "workline-review",
      text: "B",
      updatedAt: "2026-08-01T18:15:00.000Z"
    }
  ]);
});

test("legacy generation-less ink migrates once to the latest containing generation no later than its update", () => {
  const first = composeDailyPage(
    createEmptyNotebookDocument(),
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:00:00.000Z"),
    reviewPackage()
  );
  const firstGenerationId = first.pages["2026-08-01"]!.activePackageGenerationId!;
  const second = appendDailyReviewGeneration(
    first,
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:10:00.000Z"),
    { ...reviewPackage(), id: "review-package-2", generatedAt: "2026-08-01T18:10:00.000Z" },
    firstGenerationId
  );
  const raw = JSON.parse(JSON.stringify(second));
  raw.pages["2026-08-01"].worklineReflections = [{
    worklineId: "workline-review",
    text: "legacy A",
    updatedAt: "2026-08-01T18:05:00.000Z"
  }];

  const normalized = normalizeNotebookDocument(raw);

  assert.deepEqual(normalized.pages["2026-08-01"]?.worklineReflections, [{
    packageGenerationId: firstGenerationId,
    worklineId: "workline-review",
    text: "legacy A",
    updatedAt: "2026-08-01T18:05:00.000Z"
  }]);
});

test("legacy generation-less ink falls back to exactly the active generation", () => {
  const first = composeDailyPage(
    createEmptyNotebookDocument(),
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:00:00.000Z"),
    reviewPackage()
  );
  const firstGenerationId = first.pages["2026-08-01"]!.activePackageGenerationId!;
  const second = appendDailyReviewGeneration(
    first,
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:10:00.000Z"),
    { ...reviewPackage(), id: "review-package-2", generatedAt: "2026-08-01T18:10:00.000Z" },
    firstGenerationId
  );
  const secondGenerationId = second.pages["2026-08-01"]!.activePackageGenerationId!;
  const raw = JSON.parse(JSON.stringify(second));
  raw.pages["2026-08-01"].worklineReflections = [{
    worklineId: "workline-review",
    text: "legacy before packages",
    updatedAt: "2026-08-01T17:00:00.000Z"
  }];

  const normalized = normalizeNotebookDocument(raw);

  assert.deepEqual(normalized.pages["2026-08-01"]?.worklineReflections, [{
    packageGenerationId: secondGenerationId,
    worklineId: "workline-review",
    text: "legacy before packages",
    updatedAt: "2026-08-01T17:00:00.000Z"
  }]);
});

test("legacy generation-less ink never falls back to an active generation without its workline", () => {
  const first = composeDailyPage(
    createEmptyNotebookDocument(),
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:00:00.000Z"),
    reviewPackage()
  );
  const firstGenerationId = first.pages["2026-08-01"]!.activePackageGenerationId!;
  const secondPackage: DailyReviewPackage = {
    ...reviewPackage(),
    id: "review-package-2",
    generatedAt: "2026-08-01T18:10:00.000Z",
    worklines: [{ ...reviewPackage().worklines[0]!, id: "workline-new" }]
  };
  const second = appendDailyReviewGeneration(
    first,
    "2026-08-01",
    sessions,
    new Date(secondPackage.generatedAt),
    secondPackage,
    firstGenerationId
  );
  const raw = JSON.parse(JSON.stringify(second));
  raw.pages["2026-08-01"].worklineReflections = [{
    worklineId: "workline-review",
    text: "legacy before packages",
    updatedAt: "2026-08-01T17:00:00.000Z"
  }];

  const normalized = normalizeNotebookDocument(raw);

  assert.deepEqual(normalized.pages["2026-08-01"]?.worklineReflections, [{
    packageGenerationId: firstGenerationId,
    worklineId: "workline-review",
    text: "legacy before packages",
    updatedAt: "2026-08-01T17:00:00.000Z"
  }]);
});

test("sealing rejects a draft without a non-null active package generation", () => {
  const draftWithoutGeneration = composeDailyPage(
    createEmptyNotebookDocument(),
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:00:00.000Z")
  );

  assert.throws(() => sealDailyPage(draftWithoutGeneration, "2026-08-01", {
    reflection: "",
    bookmarkIds: [],
    expectedActiveGenerationId: null
  }, [], new Date("2026-08-01T18:05:00.000Z")), /工作线材料|generation|整理/);
  assert.equal(draftWithoutGeneration.pages["2026-08-01"]?.status, "draft");
});

test("a sealed page with an explicit missing or corrupt active generation id never falls back", () => {
  const first = composeDailyPage(
    createEmptyNotebookDocument(),
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:00:00.000Z"),
    reviewPackage()
  );
  const firstGenerationId = first.pages["2026-08-01"]!.activePackageGenerationId!;
  const second = appendDailyReviewGeneration(
    first,
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:10:00.000Z"),
    { ...reviewPackage(), id: "review-package-2", generatedAt: "2026-08-01T18:10:00.000Z" },
    firstGenerationId
  );
  for (const [tamperedId, normalizedId] of [["generation-does-not-exist", "generation-does-not-exist"], [null, ""]] as const) {
    const raw = JSON.parse(JSON.stringify(second));
    raw.pages["2026-08-01"].status = "sealed";
    raw.pages["2026-08-01"].sealedAt = "2026-08-01T18:15:00.000Z";
    raw.pages["2026-08-01"].activePackageGenerationId = tamperedId;

    const normalized = normalizeNotebookDocument(raw);
    const state = notebookStateForDate(normalized, "2026-08-01", sessions);

    assert.equal(normalized.pages["2026-08-01"]?.activePackageGenerationId, normalizedId);
    assert.equal(normalized.pages["2026-08-01"]?.reviewPackage, undefined);
    assert.equal(state.todayBoard.mode, "sealed");
    assert.equal(state.todayBoard.activeGeneration, undefined);
  }
});

test("a page with package generations but no active id stays fail-closed after reload", () => {
  const composed = composeDailyPage(
    createEmptyNotebookDocument(),
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:00:00.000Z"),
    reviewPackage()
  );
  const raw = JSON.parse(JSON.stringify(composed));
  delete raw.pages["2026-08-01"].activePackageGenerationId;

  const normalized = normalizeNotebookDocument(raw);
  const page = normalized.pages["2026-08-01"]!;
  const state = notebookStateForDate(normalized, "2026-08-01", sessions);

  assert.equal(page.activePackageGenerationId, undefined);
  assert.equal(page.reviewPackage, undefined);
  assert.equal(state.todayBoard.activeGeneration, undefined);
  assert.throws(() => sealDailyPage(normalized, "2026-08-01", {
    reflection: "",
    bookmarkIds: [],
    expectedActiveGenerationId: null
  }, [], new Date("2026-08-01T18:05:00.000Z")), /工作线材料|generation|整理/);
});

test("bookmark selection rejects an unresolved requested id and leaves the draft unchanged", () => {
  const draft = composeDailyPage(
    createEmptyNotebookDocument(),
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:00:00.000Z"),
    reviewPackage()
  );
  const before = JSON.stringify(draft.pages["2026-08-01"]);

  assert.throws(() => saveDailyDraft(draft, "2026-08-01", {
    reflection: "",
    bookmarkIds: ["missing-bookmark"],
    expectedActiveGenerationId: draft.pages["2026-08-01"]?.activePackageGenerationId ?? null
  }, [], new Date("2026-08-01T18:05:00.000Z")), /书签|续上|不存在/);
  assert.equal(JSON.stringify(draft.pages["2026-08-01"]), before);
  assert.equal(draft.pages["2026-08-01"]?.status, "draft");
});

test("bookmark selection rejects duplicate requested ids", () => {
  const draft = composeDailyPage(
    createEmptyNotebookDocument(),
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:00:00.000Z"),
    reviewPackage()
  );
  const candidate = notebookStateForDate(draft, "2026-08-01", sessions).continuationCandidates[0]!;

  assert.throws(() => saveDailyDraft(draft, "2026-08-01", {
    reflection: "",
    bookmarkIds: [candidate.id, candidate.id],
    expectedActiveGenerationId: draft.pages["2026-08-01"]?.activePackageGenerationId ?? null
  }, [candidate], new Date("2026-08-01T18:05:00.000Z")), /重复|唯一/);
});

test("bookmark selection rejects more than three requested ids", () => {
  const draft = composeDailyPage(
    createEmptyNotebookDocument(),
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:00:00.000Z"),
    reviewPackage()
  );
  const candidates = Array.from({ length: 4 }, (_, index) => ({
    id: `bookmark-${index}`,
    title: `bookmark ${index}`,
    projectName: "work-continuity",
    provider: "codex" as const,
    sessionId: `session-${index}`,
    sessionPath: `/tmp/session-${index}.jsonl`,
    resumeCommand: `codex resume session-${index}`
  }));

  assert.throws(() => saveDailyDraft(draft, "2026-08-01", {
    reflection: "",
    bookmarkIds: candidates.map((candidate) => candidate.id),
    expectedActiveGenerationId: draft.pages["2026-08-01"]?.activePackageGenerationId ?? null
  }, candidates, new Date("2026-08-01T18:05:00.000Z")), /最多|3/);
});

test("normal seal and reload preserve the exact immutable package provenance and user data", () => {
  const composed = composeDailyPage(
    createEmptyNotebookDocument(),
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:00:00.000Z"),
    reviewPackage()
  );
  const generationId = composed.pages["2026-08-01"]!.activePackageGenerationId!;
  const candidate = notebookStateForDate(composed, "2026-08-01", sessions).continuationCandidates[0]!;
  const sealed = sealDailyPage(composed, "2026-08-01", {
    reflection: "整页墨迹",
    worklineReflections: [{ worklineId: "workline-review", text: "generation ink" }],
    bookmarkIds: [candidate.id],
    expectedActiveGenerationId: generationId
  }, [candidate], new Date("2026-08-01T18:10:00.000Z"));
  const sealedPage = sealed.pages["2026-08-01"]!;

  const reloaded = normalizeNotebookDocument(JSON.parse(JSON.stringify(sealed)));

  assert.deepEqual({
    reviewPackage: reloaded.pages["2026-08-01"]?.reviewPackage,
    packageGenerations: reloaded.pages["2026-08-01"]?.packageGenerations,
    activePackageGenerationId: reloaded.pages["2026-08-01"]?.activePackageGenerationId,
    worklineReflections: reloaded.pages["2026-08-01"]?.worklineReflections,
    bookmarks: reloaded.pages["2026-08-01"]?.bookmarks,
    sealedAt: reloaded.pages["2026-08-01"]?.sealedAt
  }, {
    reviewPackage: sealedPage.reviewPackage,
    packageGenerations: sealedPage.packageGenerations,
    activePackageGenerationId: sealedPage.activePackageGenerationId,
    worklineReflections: sealedPage.worklineReflections,
    bookmarks: sealedPage.bookmarks,
    sealedAt: sealedPage.sealedAt
  });
  assert.equal(reloaded.pages["2026-08-01"]?.sealedAt, "2026-08-01T18:10:00.000Z");
  assert.equal(reloaded.pages["2026-08-01"]?.packageGenerations?.[0]?.id, generationId);
  assert.deepEqual(reloaded.pages["2026-08-01"]?.packageGenerations?.[0]?.admittedEvidence, sealedPage.packageGenerations?.[0]?.admittedEvidence);
});

test("reload preserves exact admitted evidence identity whitespace", () => {
  const composed = composeDailyPage(
    createEmptyNotebookDocument(),
    "2026-08-01",
    sessions,
    new Date("2026-08-01T18:00:00Z"),
    reviewPackage()
  );
  const generation = composed.pages["2026-08-01"]!.packageGenerations![0]!;
  generation.admittedEvidence[0]!.identity = "codex:codex-1:/tmp/session with trailing space ";

  const reloaded = normalizeNotebookDocument(JSON.parse(JSON.stringify(composed)));

  assert.equal(
    reloaded.pages["2026-08-01"]?.packageGenerations?.[0]?.admittedEvidence[0]?.identity,
    "codex:codex-1:/tmp/session with trailing space "
  );
});

test("normalization upgrades schema 1 and 2 pages without losing legacy notes or page data", () => {
  const legacy = normalizeNotebookDocument({
    schemaVersion: 1,
    knowledgeRoot: "/wiki",
    notes: [{ id: "legacy-note", logicalDate: "2026-08-01", createdAt: "2026-08-01T08:00:00Z", updatedAt: "2026-08-01T08:00:00Z", title: "保留", body: "已有用户记录", kind: "thought", sourceLabel: "个人记录", favorite: true, deliveries: [] }],
    pages: {
      "2026-08-01": { schemaVersion: 1, status: "draft", reflection: "旧反思", workRecords: [], worklineReflections: [], bookmarks: [] },
      "2026-08-02": { schemaVersion: 2, status: "draft", reflection: "旧包", workRecords: [], reviewPackage: { ...reviewPackage(), logicalDate: "2026-08-02", id: "review-package-legacy" }, worklineReflections: [], bookmarks: [] }
    }
  });

  assert.equal(legacy.notes[0]?.body, "已有用户记录");
  assert.equal(legacy.pages["2026-08-01"]?.reflection, "旧反思");
  assert.equal(legacy.pages["2026-08-01"]?.schemaVersion, 3);
  assert.equal(legacy.pages["2026-08-02"]?.packageGenerations?.length, 1);
  assert.equal(legacy.pages["2026-08-02"]?.reviewPackage?.id, "review-package-legacy");
});

test("normalization keeps malformed legacy notebook data from entering the renderer", () => {
  const normalized = normalizeNotebookDocument({ schemaVersion: 99, knowledgeRoot: "/wiki", notes: [{ id: "", body: "invalid" }], pages: { nope: { status: "sealed" }, "2026-08-01": { status: "sealed", workRecords: [{ id: "record", projectKey: "/tmp/project", title: "unsafe", sessions: [{ id: {}, path: null }] }] } } });
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.knowledgeRoot, "/wiki");
  assert.deepEqual(normalized.notes, []);
  assert.equal(normalized.pages["2026-08-01"]?.workRecords.length, 0);
});

function reviewPackage(): DailyReviewPackage {
  return {
    schemaVersion: 1,
    id: "review-package",
    logicalDate: "2026-08-01",
    generatedAt: "2026-08-01T18:00:00.000Z",
    evidenceCutoff: "2026-08-01T18:00:00.000Z",
    promptProfile: "ksi-workline-review-v1",
    compilerProvider: "codex",
    model: "review-model",
    evidence: [
      {
        id: "session:codex:codex-1",
        kind: "session",
        label: "明确今日手帐闭环",
        path: "/tmp/codex-1.jsonl",
        platform: "codex",
        sessionId: "codex-1"
      }
    ],
    worklines: [
      {
        id: "workline-review",
        title: "验证日终回看闭环",
        summary: "把 Session 重建为一条可读工作线。",
        status: "needs-judgment",
        sourceSessionIds: ["codex:codex-1"],
        participation: [],
        dossier: {
          title: "回看材料必须先于人的判断",
          dek: "AI 整理证据，但不替用户写结论。",
          blocks: [],
          question: { prompt: "这条路线是否真的值得继续？" }
        },
        payload: {}
      }
    ],
    warnings: [],
    rawOutput: { worklines: [{ id: "workline-review" }] }
  };
}
