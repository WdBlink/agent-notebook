import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dailyNotePath } from "../src/export";
import {
  addPlanFromModelTasks,
  CockpitPersistenceCoordinator,
  createEmptyData,
  DurableWriteGuard,
  normalizeData,
  registerCanonicalProject,
  resolveCanonicalProjectDirectory,
  SerialTransactionQueue,
  toggleTaskCompletion,
  WhiteboardCommitChannel,
  WhiteboardProjectRegistrationWorkflow
} from "../src/state";
import {
  appendProjectFrame,
  createNoteNode,
  rebaseGlobalBoardDocument,
  resolveGlobalBoardConflict,
  WhiteboardRebaseError,
  WhiteboardMigrationError
} from "../src/whiteboard-model";

test("model tasks become an uncompleted plan for the next local day", () => {
  const result = addPlanFromModelTasks(
    createEmptyData(),
    "明天研究一个项目，先查概念和代码结构。",
    [{ title: "梳理项目核心概念", detail: "读 README、论文和 docs。", category: "research", priority: "P0" }],
    "local-model",
    "test",
    "2026-07-03T08:00:00.000Z"
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.schemaVersion, 4);
  assert.deepEqual(result.data.whiteboard, {
    schemaVersion: 2,
    viewport: { x: 80, y: 72, zoom: 1 },
    projects: [],
    nodes: [],
    edges: [],
    console: { provider: "codex" }
  });
  assert.equal(result.data.plans[0]?.targetDate, "2026-07-04");
  assert.equal(result.data.plans[0]?.tasks[0]?.completed, false);
});

test("empty intent is rejected before model tasks are stored", () => {
  const result = addPlanFromModelTasks(createEmptyData(), "  ", [{ title: "x", detail: "x" }]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "EMPTY_INTENT");
});

test("ordinary task completion can be toggled without changing another plan", () => {
  const first = addPlanFromModelTasks(
    createEmptyData(),
    "第一个计划。",
    [{ title: "第一个任务", detail: "先做 A。" }],
    "local-model",
    undefined,
    "2026-07-03T08:00:00.000Z"
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = addPlanFromModelTasks(
    first.data,
    "第二个计划。",
    [{ title: "第二个任务", detail: "先做 B。" }],
    "local-model",
    undefined,
    "2026-07-03T08:01:00.000Z"
  );
  assert.equal(second.ok, true);
  if (!second.ok) return;

  const untouchedPlan = second.data.plans[1];
  const taskId = second.data.plans[0]?.tasks[0]?.id ?? "";
  const updated = toggleTaskCompletion(second.data, taskId, true, "2026-07-03T08:10:00.000Z");
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  assert.equal(updated.data.plans[0]?.tasks[0]?.completed, true);
  assert.equal(updated.data.plans[1]?.updatedAt, untouchedPlan?.updatedAt);
});

test("missing task id returns a recoverable error", () => {
  const result = toggleTaskCompletion(createEmptyData(), "missing-task", true);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "TASK_NOT_FOUND");
});

test("schema two data gains target dates and drops retired task semantics", () => {
  const normalized = normalizeData({
    schemaVersion: 2,
    settings: {
      dailyNoteFolder: 42,
      llmEndpoint: "",
      llmModel: "",
      sessionScanRoots: ["~/.claude/tasks", "~/.minimax/plans", "/custom/session-root"]
    },
    plans: [
      {
        id: "plan-a",
        intent: "研究项目",
        createdAt: "2026-07-03T08:00:00.000Z",
        updatedAt: "2026-07-03T08:00:00.000Z",
        tasks: [
          {
            id: "task-a",
            title: "任务",
            detail: "细节",
            category: "bad",
            priority: "urgent",
            completed: false,
            createdAt: "2026-07-03T08:00:00.000Z",
            updatedAt: "2026-07-03T08:00:00.000Z"
          }
        ]
      }
    ]
  });

  assert.equal(normalized.schemaVersion, 4);
  assert.equal(normalized.settings.dailyNoteFolder, "Agent Notebook");
  assert.equal(normalized.settings.llmEndpoint, "http://127.0.0.1:11434/v1/chat/completions");
  assert.ok(normalized.settings.sessionScanRoots.includes("~/.codex/sessions"));
  assert.ok(normalized.settings.sessionScanRoots.includes("~/.claude/projects"));
  assert.ok(normalized.settings.sessionScanRoots.includes("/custom/session-root"));
  assert.deepEqual(normalized.settings.enabledSessionProviders, ["codex", "claude"]);
  assert.equal(normalized.settings.sessionScanRoots.includes("~/.claude/tasks"), false);
  assert.equal(normalized.settings.sessionScanRoots.includes("~/.minimax/plans"), false);
  assert.equal(normalized.plans[0]?.targetDate, "2026-07-04");
  assert.equal(normalized.plans[0]?.tasks[0]?.category, "other");
  assert.equal(normalized.plans[0]?.tasks[0]?.priority, "P1");
  assert.equal(dailyNotePath(normalized, new Date("2026-07-03T00:00:00.000Z")), "Agent Notebook/2026-07-03.md");
});

test("session provider selection keeps an intentional empty selection and removes unsupported ids", () => {
  assert.deepEqual(
    normalizeData({ schemaVersion: 4, settings: { enabledSessionProviders: [] }, plans: [] }).settings.enabledSessionProviders,
    []
  );
  assert.deepEqual(
    normalizeData({
      schemaVersion: 4,
      settings: { enabledSessionProviders: ["claude", "future-agent", "claude", "codex"] },
      plans: []
    }).settings.enabledSessionProviders,
    ["claude", "codex"]
  );
});

test("daily review preparation is disabled by default and persists one valid local time", () => {
  const defaults = normalizeData({ schemaVersion: 4, settings: {}, plans: [] }).settings;
  assert.equal(defaults.dailyReviewScheduleEnabled, false);
  assert.equal(defaults.dailyReviewScheduleTime, "18:30");

  const configured = normalizeData({
    schemaVersion: 4,
    settings: { dailyReviewScheduleEnabled: true, dailyReviewScheduleTime: "21:15" },
    plans: []
  }).settings;
  assert.equal(configured.dailyReviewScheduleEnabled, true);
  assert.equal(configured.dailyReviewScheduleTime, "21:15");

  const invalid = normalizeData({
    schemaVersion: 4,
    settings: { dailyReviewScheduleEnabled: "yes", dailyReviewScheduleTime: "tomorrow" },
    plans: []
  }).settings;
  assert.equal(invalid.dailyReviewScheduleEnabled, false);
  assert.equal(invalid.dailyReviewScheduleTime, "18:30");
});

test("snapshot normalization preserves the full desktop Session cap and its frozen evidence scope", () => {
  const base = createEmptyData();
  const sessions = Array.from({ length: 48 }, (_, index) => ({
    id: `session-${index}`,
    platform: "codex",
    title: `Session ${index}`,
    summary: "",
    path: `/tmp/session-${index}.jsonl`,
    updatedAt: "2026-08-15T10:00:00.000Z",
    artifacts: [],
    status: "completed"
  }));
  const coverage = sessions.map((session) => ({
    sourceId: `codex:${session.path}`,
    disposition: "read",
    detail: "已采用规范副本。"
  }));
  const scope = {
    timeZone: "Asia/Shanghai",
    startInclusive: "2026-08-14T16:00:00.000Z",
    endExclusive: "2026-08-15T16:00:00.000Z",
    evidenceCutoff: "2026-08-15T10:00:00.000Z"
  };

  const normalized = normalizeData({
    ...base,
    workSessionSnapshot: {
      date: "2026-08-15",
      generatedAt: scope.evidenceCutoff,
      sessions,
      sources: ["/tmp"],
      warnings: [],
      evidenceCoverage: coverage,
      evidenceScope: scope
    }
  });

  assert.equal(normalized.workSessionSnapshot.sessions.length, 48);
  assert.equal(normalized.workSessionSnapshot.evidenceCoverage?.length, 48);
  assert.deepEqual(normalized.workSessionSnapshot.evidenceScope, scope);
  assert.equal(
    normalizeData({
      ...normalized,
      workSessionSnapshot: {
        ...normalized.workSessionSnapshot,
        evidenceScope: { ...scope, timeZone: "Not/A-Timezone" }
      }
    }).workSessionSnapshot.evidenceScope,
    undefined
  );
});

test("a stale stored plan is not kept active after normalization", () => {
  const normalized = normalizeData({
    schemaVersion: 2,
    settings: {},
    activePlanId: "old-plan",
    plans: [
      {
        id: "old-plan",
        intent: "旧计划",
        createdAt: "2026-07-02T08:00:00.000Z",
        updatedAt: "2026-07-02T08:00:00.000Z",
        tasks: []
      }
    ]
  });
  assert.equal(normalized.activePlanId, undefined);
});

test("normalizeData migrates a valid schema-one whiteboard without retired store fields", () => {
  const normalized = normalizeData({
    schemaVersion: 4,
    settings: {},
    plans: [],
    whiteboard: {
      projects: [{ id: "project-a", name: "A", rootPath: "/workspace/a" }],
      activeProjectId: "project-a",
      boards: {
        "project-a": {
          schemaVersion: 1,
          projectId: "project-a",
          viewport: { x: 20, y: 10, zoom: 1.2 },
          nodes: [{
            id: "note-a",
            kind: "note",
            x: 100,
            y: 120,
            width: 320,
            height: 240,
            zIndex: 1,
            markdown: "# exact\n"
          }],
          edges: []
        }
      }
    }
  });

  assert.equal(normalized.schemaVersion, 4);
  assert.equal(normalized.whiteboard.schemaVersion, 2);
  assert.equal(normalized.whiteboard.projects[0]?.id, "project-a");
  assert.equal(normalized.whiteboard.nodes[0]?.projectId, "project-a");
  assert.equal(normalized.whiteboard.nodes[0]?.kind === "note" ? normalized.whiteboard.nodes[0].markdown : "", "# exact\n");
  assert.equal("boards" in normalized.whiteboard, false);
  assert.equal("activeProjectId" in normalized.whiteboard, false);
});

test("normalizeData leaves schema-two whiteboard output byte-idempotent", () => {
  const first = normalizeData({
    schemaVersion: 4,
    settings: {},
    plans: [],
    whiteboard: {
      schemaVersion: 2,
      viewport: { x: -10, y: 25, zoom: 0.5 },
      projects: [],
      nodes: [],
      edges: [],
      console: { provider: "claude-code" }
    }
  });
  const second = normalizeData(first);
  assert.equal(JSON.stringify(second.whiteboard), JSON.stringify(first.whiteboard));
});

test("normalizeData distinguishes an absent whiteboard from present invalid data", () => {
  assert.deepEqual(normalizeData({ schemaVersion: 4, settings: {}, plans: [] }).whiteboard, createEmptyData().whiteboard);
  for (const whiteboard of [null, {}, { schemaVersion: 2, projects: [] }]) {
    assert.throws(
      () => normalizeData({ schemaVersion: 4, settings: {}, plans: [], whiteboard }),
      (error: unknown) => error instanceof WhiteboardMigrationError
    );
  }
  assert.throws(
    () => normalizeData({ ...createEmptyData(), whiteboardRevision: -1 }),
    (error: unknown) => error instanceof WhiteboardMigrationError
  );
});

test("serialized transactions compute from current committed data and continue after rejection", async () => {
  const queue = new SerialTransactionQueue();
  let data = createEmptyData();
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

  const first = queue.run(async () => {
    await firstGate;
    data = { ...data, settings: { ...data.settings, llmModel: "queued-model" } };
  });
  const second = queue.run(async () => {
    data = { ...data, whiteboard: appendProjectFrame(data.whiteboard, "/workspace/a", "A", "project-a") };
  });
  releaseFirst();
  await Promise.all([first, second]);
  assert.equal(data.settings.llmModel, "queued-model");
  assert.deepEqual(data.whiteboard.projects.map((project) => project.id), ["project-a"]);

  await assert.rejects(queue.run(async () => {
    const next = { ...data, settings: { ...data.settings, llmModel: "must-not-commit" } };
    await Promise.reject(new Error("durable save failed"));
    data = next;
  }), /durable save failed/);
  await queue.run(async () => {
    data = { ...data, settings: { ...data.settings, dailyNoteFolder: "After Failure" } };
  });
  assert.equal(data.settings.llmModel, "queued-model");
  assert.equal(data.settings.dailyNoteFolder, "After Failure");

  let releaseCoordinator!: () => void;
  const firstWrite = new Promise<void>((resolve) => { releaseCoordinator = resolve; });
  let writeCount = 0;
  const coordinator = new CockpitPersistenceCoordinator(createEmptyData(), async () => {
    writeCount += 1;
    if (writeCount === 1) await firstWrite;
  });
  const settings = coordinator.transact((current) => ({
    write: true,
    data: { ...current, settings: { ...current.settings, llmModel: "coordinator-model" } },
    value: true
  }));
  const board = appendProjectFrame(createEmptyData().whiteboard, "/workspace/alpha", "Alpha", "project-alpha");
  const whiteboard = coordinator.saveWhiteboard(board, 0);
  const registration = coordinator.registerProject("/workspace/beta", "Beta");
  releaseCoordinator();
  const [, boardResult, registrationResult] = await Promise.all([settings, whiteboard, registration]);
  assert.equal(boardResult.ok, true);
  assert.equal(registrationResult.ok, true);
  assert.equal(coordinator.snapshot().settings.llmModel, "coordinator-model");
  assert.deepEqual(coordinator.snapshot().whiteboard.projects.map((project) => project.name), ["Alpha", "Beta"]);
  assert.equal(coordinator.snapshot().whiteboardRevision, 2);
});

test("durable migration recovery remains blocked after a rejected save and opens only after success", async () => {
  const migrationError = new WhiteboardMigrationError("malformed persisted whiteboard");
  const guard = new DurableWriteGuard(migrationError);
  let writes = 0;
  await assert.rejects(guard.recover(createEmptyData(), async () => {
    writes += 1;
    throw new Error("disk full");
  }), /disk full/);
  assert.equal(guard.blocked, true);
  assert.throws(() => guard.assertWritable(), (error: unknown) => error === migrationError);
  assert.equal(writes, 1);

  await guard.recover(createEmptyData(), async () => { writes += 1; });
  assert.equal(guard.blocked, false);
  assert.doesNotThrow(() => guard.assertWritable());
  assert.equal(writes, 2);

  let rejectWrite = true;
  let coordinatorWrites = 0;
  const coordinator = new CockpitPersistenceCoordinator(createEmptyData(), async () => {
    coordinatorWrites += 1;
    if (rejectWrite) throw new Error("disk full");
  });
  coordinator.block(migrationError);
  await assert.rejects(coordinator.recover(async () => createEmptyData()), /disk full/);
  await assert.rejects(
    coordinator.transact((current) => ({ write: true, data: current, value: true })),
    (error: unknown) => error === migrationError
  );
  rejectWrite = false;
  await coordinator.recover(async () => createEmptyData());
  assert.equal(coordinatorWrites, 2);
});

test("queued canonical project registration preserves concurrent roots and rejects canonical duplicates", async () => {
  const queue = new SerialTransactionQueue();
  let data = createEmptyData();
  const outcomes = await Promise.all([
    queue.run(async () => {
      const result = registerCanonicalProject(data, "/canonical/alpha", "Alpha");
      if (result.ok) data = result.data;
      return result.ok;
    }),
    queue.run(async () => {
      const result = registerCanonicalProject(data, "/canonical/beta", "Beta");
      if (result.ok) data = result.data;
      return result.ok;
    }),
    queue.run(async () => {
      const result = registerCanonicalProject(data, "/canonical/alpha", "Alpha alias");
      if (result.ok) data = result.data;
      return result.ok;
    })
  ]);
  assert.deepEqual(outcomes, [true, true, false]);
  assert.deepEqual(data.whiteboard.projects.map((project) => project.rootPath), ["/canonical/alpha", "/canonical/beta"]);

  const base = appendProjectFrame(createEmptyData().whiteboard, "/workspace/alpha", "Alpha", "project-alpha");
  const coordinator = new CockpitPersistenceCoordinator({ ...createEmptyData(), whiteboard: base }, async () => undefined);
  const localA = createNoteNode(base, "project-alpha", undefined, "note-a");
  const localB = createNoteNode(base, "project-alpha", undefined, "note-b");

  const first = await coordinator.saveWhiteboard(localA, 0);
  const stale = await coordinator.saveWhiteboard(localB, 0);
  assert.equal(first.ok, true);
  assert.equal(stale.ok, false);
  if (stale.ok) return;
  const rebased = rebaseGlobalBoardDocument(base, localB, stale.document);
  const retried = await coordinator.saveWhiteboard(rebased, stale.revision);

  assert.equal(retried.ok, true);
  assert.deepEqual(
    coordinator.snapshot().whiteboard.nodes.map((node) => node.id).sort(),
    ["note-a", "note-b"]
  );

  const aliasCoordinator = new CockpitPersistenceCoordinator(createEmptyData(), async () => undefined);
  const aliases = await Promise.all([
    aliasCoordinator.registerProject("/canonical/alpha", "Alpha"),
    aliasCoordinator.registerProject("/canonical/alpha", "Alpha alias")
  ]);
  assert.deepEqual(aliases.map((result) => result.ok), [true, false]);
  assert.equal(aliasCoordinator.snapshot().whiteboard.projects.length, 1);
  const cancelled = new AbortController();
  cancelled.abort();
  const cancelledResult = await aliasCoordinator.registerProject("/canonical/cancelled", "Cancelled", cancelled.signal);
  assert.equal(cancelledResult.ok, false);
  assert.equal(aliasCoordinator.snapshot().whiteboard.projects.length, 1);
});

test("same-record conflicts expose typed details and both resolutions preserve disjoint remote changes", () => {
  const base = appendProjectFrame(createEmptyData().whiteboard, "/workspace/alpha", "Alpha", "project-alpha");
  const withNote = createNoteNode(base, "project-alpha", undefined, "note-a");
  const local = {
    ...withNote,
    nodes: withNote.nodes.map((node) => node.id === "note-a" && node.kind === "note"
      ? { ...node, markdown: "local" }
      : node)
  };
  const remoteChanged = {
    ...withNote,
    projects: withNote.projects.map((project) => ({ ...project, name: "Alpha remote" })),
    nodes: withNote.nodes.map((node) => node.id === "note-a" && node.kind === "note"
      ? { ...node, markdown: "remote" }
      : node)
  };

  assert.throws(
    () => rebaseGlobalBoardDocument(withNote, local, remoteChanged),
    (error: unknown) => error instanceof WhiteboardRebaseError && error.conflicts.includes("节点 note-a")
  );
  const keepLocal = resolveGlobalBoardConflict(withNote, local, remoteChanged, "local");
  const adoptRemote = resolveGlobalBoardConflict(withNote, local, remoteChanged, "remote");
  assert.equal(keepLocal.projects[0]?.name, "Alpha remote");
  assert.equal(keepLocal.nodes[0]?.kind === "note" ? keepLocal.nodes[0].markdown : "", "local");
  assert.equal(adoptRemote.projects[0]?.name, "Alpha remote");
  assert.equal(adoptRemote.nodes[0]?.kind === "note" ? adoptRemote.nodes[0].markdown : "", "remote");
});

test("whiteboard commit channel updates idle controllers once and excludes the origin", () => {
  const channel = new WhiteboardCommitChannel();
  const document = appendProjectFrame(createEmptyData().whiteboard, "/workspace/alpha", "Alpha", "project-alpha");
  const receivedA: number[] = [];
  const receivedB: number[] = [];
  const controllerA = { receiveWhiteboardCommit: (_document: typeof document, revision: number) => receivedA.push(revision) };
  const controllerB = { receiveWhiteboardCommit: (_document: typeof document, revision: number) => receivedB.push(revision) };
  channel.subscribe(controllerA);
  const unsubscribeB = channel.subscribe(controllerB);
  channel.publish(document, 1, controllerA);
  channel.publish(document, 2, controllerB);
  unsubscribeB();
  channel.publish(document, 3, controllerA);
  assert.deepEqual(receivedA, [2]);
  assert.deepEqual(receivedB, [1]);
});

test("project workflow cancels validation and queue wait but completes after the durable commit point", async () => {
  let resolveValidation!: (value: string | null) => void;
  const validationGate = new Promise<string | null>((resolve) => { resolveValidation = resolve; });
  let validationWrites = 0;
  const validationCoordinator = new CockpitPersistenceCoordinator(createEmptyData(), async () => { validationWrites += 1; });
  const validationWorkflow = new WhiteboardProjectRegistrationWorkflow(
    () => validationGate,
    (...values) => validationCoordinator.registerProject(...values)
  );
  const validationAbort = new AbortController();
  const validationRun = validationWorkflow.run("/workspace/alpha", "Alpha", validationAbort.signal);
  validationAbort.abort();
  resolveValidation("/workspace/alpha");
  assert.equal((await validationRun).ok, false);
  assert.equal(validationWrites, 0);

  let releaseQueue!: () => void;
  const queueGate = new Promise<void>((resolve) => { releaseQueue = resolve; });
  let queueWrites = 0;
  const queueCoordinator = new CockpitPersistenceCoordinator(createEmptyData(), async () => { queueWrites += 1; });
  const blocker = queueCoordinator.transact(async (current) => {
    await queueGate;
    return { write: false, value: current };
  });
  const queueWorkflow = new WhiteboardProjectRegistrationWorkflow(
    async (value) => value,
    (...values) => queueCoordinator.registerProject(...values)
  );
  const queueAbort = new AbortController();
  const queuedRun = queueWorkflow.run("/workspace/beta", "Beta", queueAbort.signal);
  await Promise.resolve();
  queueAbort.abort();
  releaseQueue();
  await blocker;
  assert.equal((await queuedRun).ok, false);
  assert.equal(queueWrites, 0);

  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  let durableWrites = 0;
  const durableCoordinator = new CockpitPersistenceCoordinator(createEmptyData(), async () => {
    durableWrites += 1;
    await saveGate;
  });
  const durableWorkflow = new WhiteboardProjectRegistrationWorkflow(
    async (value) => value,
    (...values) => durableCoordinator.registerProject(...values)
  );
  const durableAbort = new AbortController();
  const phases: string[] = [];
  const durableRun = durableWorkflow.run(
    "/workspace/gamma",
    "Gamma",
    durableAbort.signal,
    (phase) => phases.push(phase)
  );
  while (!phases.includes("saving")) await new Promise((resolve) => setTimeout(resolve, 0));
  durableAbort.abort();
  releaseSave();
  assert.equal((await durableRun).ok, true);
  assert.equal(durableWrites, 1);
  assert.deepEqual(phases, ["validating", "queued", "saving", "committed"]);
  assert.equal(durableCoordinator.snapshot().whiteboard.projects[0]?.name, "Gamma");
});

test("project directory resolution uses filesystem canonicalization, readability, searchability, and cancellation", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-notebook-project-"));
  const project = path.join(temp, "project");
  const alias = path.join(temp, "alias");
  const file = path.join(temp, "file.txt");
  await fs.mkdir(project);
  await fs.symlink(project, alias);
  await fs.writeFile(file, "not a directory");
  const runtime = {
    homeDirectory: os.homedir(),
    readableSearchableMode: 5,
    resolve: path.resolve,
    realpath: fs.realpath,
    stat: fs.stat,
    access: fs.access,
    readdir: fs.readdir
  };
  try {
    const canonicalProject = await fs.realpath(project);
    assert.equal(await resolveCanonicalProjectDirectory(project, runtime), canonicalProject);
    assert.equal(await resolveCanonicalProjectDirectory(alias, runtime), canonicalProject);
    assert.equal(await resolveCanonicalProjectDirectory(file, runtime), null);
    assert.equal(await resolveCanonicalProjectDirectory("bad\0path", runtime), null);
    const aborted = new AbortController();
    aborted.abort();
    assert.equal(await resolveCanonicalProjectDirectory(project, runtime, aborted.signal), null);
    assert.equal(await resolveCanonicalProjectDirectory(project, {
      ...runtime,
      access: async () => { throw new Error("permission denied"); }
    }), null);
    assert.equal(await resolveCanonicalProjectDirectory(project, {
      ...runtime,
      readdir: async () => { throw new Error("not searchable"); }
    }), null);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test("work session snapshots are capped and retired task paths cannot remain resumable", () => {
  const sessions = Array.from({ length: 60 }, (_, index) => ({
    id: `session-${index}`,
    platform: index === 0 ? "claude" : "unknown-platform",
    title: `昨日会话 ${index}`,
    summary: `summary ${index}`,
    path: index === 0 ? "/Users/example/.claude/tasks/session.jsonl " : `~/.codex/archived_sessions/session-${index}.jsonl`,
    updatedAt: "2026-07-02T08:00:00.000Z",
    resumable: true,
    transcriptCapture: index === 0 ? {
      canonicalPath: "/Users/example/.claude/tasks/session.jsonl ",
      sha256: "da66d7a01759dbfbceace356dc1f2d87976249c58fb22c5afe79245986b587be",
      byteLength: 261,
      coverage: { startByte: 0, endByte: 261 }
    } : undefined,
    artifacts: index === 0 ? ["src/main.ts", ".agents", "session-0"] : ["src/main.ts"],
    status: index === 0 ? "completed" : "bad"
  }));
  const data = normalizeData({
    schemaVersion: 2,
    settings: {},
    plans: [],
    workSessionSnapshot: {
      date: "2026-07-02",
      generatedAt: "2026-07-03T08:00:00.000Z",
      sources: ["~/.claude/tasks"],
      sessions
    }
  });
  assert.equal(data.workSessionSnapshot.sessions.length, 48);
  assert.equal(data.workSessionSnapshot.sessions[0]?.resumable, false);
  assert.deepEqual(data.workSessionSnapshot.sessions[0]?.artifacts, ["src/main.ts"]);
  assert.deepEqual(data.workSessionSnapshot.sessions[0]?.transcriptCapture, {
    canonicalPath: "/Users/example/.claude/tasks/session.jsonl ",
    sha256: "da66d7a01759dbfbceace356dc1f2d87976249c58fb22c5afe79245986b587be",
    byteLength: 261,
    coverage: { startByte: 0, endByte: 261 }
  });
  assert.equal(data.workSessionSnapshot.sessions[1]?.platform, "other");
  assert.equal(data.workSessionSnapshot.sessions[1]?.status, "unknown");
});

test("work session snapshot normalization preserves exact filesystem path whitespace", () => {
  const exactPath = "/tmp/session  evidence.jsonl ";
  const data = normalizeData({
    ...createEmptyData(),
    workSessionSnapshot: {
      date: "2026-08-09",
      generatedAt: "2026-08-09T10:00:00.000Z",
      sources: [],
      warnings: [],
      sessions: [{
        id: "path-whitespace",
        platform: "codex",
        title: "路径保真",
        summary: "路径不是 prose。",
        path: exactPath,
        updatedAt: "2026-08-09T10:00:00.000Z",
        artifacts: [],
        status: "completed",
        transcriptCapture: {
          canonicalPath: exactPath,
          sha256: "7eb259ab4a8d18e582fe130bbe7c5eab409a7aad12f157fd63130c3c7d3b648d",
          byteLength: 20,
          coverage: { startByte: 0, endByte: 20 }
        }
      }]
    }
  });

  assert.equal(data.workSessionSnapshot.sessions[0]?.path, exactPath);
  assert.equal(data.workSessionSnapshot.sessions[0]?.transcriptCapture?.canonicalPath, exactPath);
});

test("malformed transcript captures are dropped atomically without dropping legacy sessions", () => {
  const invalidCaptures = [
    {
      canonicalPath: "/tmp/session-a.jsonl",
      sha256: "not-a-sha",
      byteLength: 20,
      coverage: { startByte: 0, endByte: 20 }
    },
    {
      canonicalPath: "/tmp/session-b.jsonl",
      sha256: "7eb259ab4a8d18e582fe130bbe7c5eab409a7aad12f157fd63130c3c7d3b648d",
      byteLength: -1,
      coverage: { startByte: 0, endByte: -1 }
    },
    {
      canonicalPath: "/tmp/session-c.jsonl",
      sha256: "7eb259ab4a8d18e582fe130bbe7c5eab409a7aad12f157fd63130c3c7d3b648d",
      byteLength: 20,
      coverage: { startByte: 1, endByte: 20 }
    }
  ];
  const data = normalizeData({
    ...createEmptyData(),
    workSessionSnapshot: {
      date: "2026-08-09",
      generatedAt: "2026-08-09T10:00:00.000Z",
      sources: [],
      warnings: [],
      sessions: invalidCaptures.map((transcriptCapture, index) => ({
        id: `invalid-${index}`,
        platform: "codex",
        title: "Legacy session remains",
        summary: "Invalid capture does not become trusted.",
        path: `/tmp/session-${index}.jsonl`,
        updatedAt: "2026-08-09T10:00:00.000Z",
        artifacts: [],
        status: "completed",
        transcriptCapture
      }))
    }
  });

  assert.equal(data.workSessionSnapshot.sessions.length, 3);
  assert.deepEqual(data.workSessionSnapshot.sessions.map((item) => item.transcriptCapture), [undefined, undefined, undefined]);
});
