// Audit-only probes: assertions describe observed defects, not desired behavior.
import { loadAgentWorkSnapshot } from "../src/agent-sessions";
import { createStructuredTodayCitationTargets } from "../app/desktop/structured-today-citations";
import { canonicalContentHash } from "../src/structured-today-contracts";
import { normalizeTraceinkAssetStore, upsertStructuredTodayRun } from "../app/desktop/traceink-asset-store";
import { parseSessionTranscript } from "../app/desktop/transcript-reader";

async function auditFixture(run: (value: any) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "full-chain-audit-"));
  const transcriptPath = path.join(root, "session.jsonl");
  const marker = "AUDIT_FROZEN_FACT_7B8C";
  const transcript = JSON.stringify({ type: "response_item", timestamp: "2026-08-29T01:00:00.000Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: marker }] } }) + "\n";
  await fs.writeFile(transcriptPath, transcript);
  const session = capturedSession(transcriptPath, transcript);
  const snapshot = { date: logicalDate, generatedAt: "2026-08-29T02:00:00.000Z", sessions: [session], sources: [], warnings: [] };
  let writes = 0;
  const repository = createTraceinkAssetRepository({ filePath: path.join(root, "assets.json"), onPublish() { writes++; } });
  const checkpointer = NodeSqliteSaver.fromConnectionString(":memory:");
  const args = { logicalDate, snapshot, settings: settings(), repository, checkpointer };
  try {
    await repository.load();
    await run({ root, marker, transcriptPath, transcript, session, args, writes: () => writes });
  } finally {
    checkpointer.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("AUDIT retry preserves terminal digest failure even after provider recovers", async () => {
  await auditFixture(async ({ args }) => {
    let fail = true;
    let calls = 0;
    const delegate = structuredRunner();
    const runner: CliRunner = async (request) => {
      calls++;
      if (fail) throw new Error("transient provider outage");
      return delegate(request);
    };
    await assert.rejects(runStructuredTodayIndexPreparation({ ...args, runner }), /publication gates/);
    const first = calls;
    fail = false;
    await assert.rejects(runStructuredTodayIndexPreparation({ ...args, runner }), /publication gates/);
    assert.equal(calls, first);
    console.log("AUDIT_RESULT", JSON.stringify({ probe: "terminal-retry", firstCalls: first, retryAdditionalCalls: calls - first, retryStillFails: true }));
  });
});

test("AUDIT dossier receives no frozen fact and still publishes after source deletion", async () => {
  await auditFixture(async ({ args, marker, transcriptPath, writes }) => {
    const prompts: string[] = [];
    const delegate = structuredRunner();
    const runner: CliRunner = async (request) => { prompts.push(request.stdin); return delegate(request); };
    const before = writes();
    const index = await runStructuredTodayIndexPreparation({ ...args, runner });
    const indexWrites = writes() - before;
    assert.equal(prompts[0]!.includes(marker), true);
    prompts.length = 0;
    await fs.rm(transcriptPath);
    const dossier = await runStructuredTodayDossierPreparation({
      ...args, indexReference: index.reference, worklineId: index.artifact.worklines[0]!.worklineId, runner
    });
    assert.equal(prompts.length, 3);
    assert.equal(prompts.some((prompt) => prompt.includes(marker)), false);
    assert.ok(dossier.content.supportingEvidence.length);
    console.log("AUDIT_RESULT", JSON.stringify({ probe: "dossier-grounding", modelCalls: prompts.length, frozenFactInPrompts: false, publishedWithDeletedSource: true, oneSessionIndexRepositoryPublishes: indexWrites }));
  });
});

test("AUDIT family child evidence is admitted but cannot become a citation or reopen", async () => {
  await auditFixture(async ({ args, root, session, transcript }) => {
    const childPath = path.join(root, "child.jsonl");
    await fs.writeFile(childPath, transcript);
    const child = { ...capturedSession(childPath, transcript), id: "child-1", lineage: { origin: "subagent", parentSessionId: session.id } };
    const result = await runStructuredTodayIndexPreparation({ ...args, snapshot: { ...args.snapshot, sessions: [session, child] }, runner: structuredRunner() });
    const evidenceId = "family-child:codex:child-1";
    assert.ok(result.artifact.evidence.some((item) => item.evidenceId === evidenceId));
    assert.equal(createStructuredTodayCitationTargets(result.artifact, [evidenceId], "E").length, 0);
    assert.throws(() => authorizeSessionTranscriptRequest({ id: child.id, platform: "codex", path: child.path, structuredTodayRef: { ...result.reference, logicalDate, evidenceId } }, [session, child], createEmptyNotebookDocument(), args.repository.snapshot()), /找不到指定 Session/);
    console.log("AUDIT_RESULT", JSON.stringify({ probe: "child-citation", admitted: true, clickableTargets: 0, authorized: false }));
  });
});

test("AUDIT historical day is starved by 180 newer candidate files", async () => {
  await auditFixture(async ({ root }) => {
    const scanRoot = path.join(root, "codex", "sessions");
    const oldDir = path.join(scanRoot, "2026", "08", "29");
    const newDir = path.join(scanRoot, "2026", "09", "05");
    await fs.mkdir(oldDir, { recursive: true });
    await fs.mkdir(newDir, { recursive: true });
    const line = (date: string) => JSON.stringify({ type: "response_item", timestamp: date + "T01:00:00.000Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "target activity" }] } }) + "\n";
    await fs.writeFile(path.join(oldDir, "old.jsonl"), line(logicalDate));
    await Promise.all(Array.from({ length: 180 }, (_, i) => fs.writeFile(path.join(newDir, `new-${i}.jsonl`), line("2026-09-05"))));
    const runtimeFs = { stat: fs.stat, readdir: (p: string) => fs.readdir(p), readFile: (p: string) => fs.readFile(p, "utf8"), readBytes: fs.readFile, realpath: fs.realpath };
    const snapshot = await loadAgentWorkSnapshot({ ...settings(), sessionScanRoots: [scanRoot] }, { date: logicalDate, now: new Date(), fs: runtimeFs, maxFiles: 180, maxDepth: 5, maxEntries: 2400 });
    assert.equal(snapshot.sessions.length, 0);
    assert.ok(snapshot.evidenceCoverage?.some((item) => item.disposition === "truncated"));
    assert.equal(snapshot.warnings.length, 0);
    console.log("AUDIT_RESULT", JSON.stringify({ probe: "history-starvation", existingTargetSessions: 1, returnedSessions: snapshot.sessions.length, newerFiles: 180, warnings: snapshot.warnings.length, truncationInCoverageOnly: true }));
  });
});

test("AUDIT per-message truncation remains marked complete", async () => {
  const raw = JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "x".repeat(81000) }] } });
  const parsed = parseSessionTranscript({ content: raw, platform: "codex", sessionId: "a", title: "a", path: "/tmp/a" });
  assert.equal(parsed.truncated, false);
  assert.ok(parsed.messages[0]!.content.length < 81000);
  console.log("AUDIT_RESULT", JSON.stringify({ probe: "message-truncation", originalCharacters: 81000, retainedCharacters: parsed.messages[0]!.content.length, truncated: parsed.truncated }));
});

test("AUDIT model evidence cap counts content but not serialized metadata", async () => {
  await auditFixture(async ({ args, session }) => {
    const messages = Array.from({ length: 4000 }, (_, i) => JSON.stringify({ type: "response_item", timestamp: "2026-08-29T01:00:00.000Z", payload: { type: "message", id: String(i), role: "assistant", content: [{ type: "output_text", text: `msg-${i}` }] } })).join("\n");
    const result = await buildStructuredTodayIndexInput({ logicalDate, snapshot: args.snapshot, editorialContract: await loadStructuredTodayEditorialContract(), artifactId: "audit", revision: 1, workflowRunId: "audit", readTranscript: async () => ({ content: messages, truncated: false }) });
    assert.ok(result.sessions[0]!.evidenceText.length > 240000);
    const body = JSON.parse(result.sessions[0]!.evidenceText);
    console.log("AUDIT_RESULT", JSON.stringify({ probe: "evidence-budget", advertisedCap: 240000, actualCharacters: result.sessions[0]!.evidenceText.length, inputMessages: 4000, outputMessages: body.messages.length, uniqueMessageIds: new Set(body.messages.map((m: any) => m.id)).size }));
  });
});

test("AUDIT changing no evidence still recomputes successful family digest", async () => {
  await auditFixture(async ({ args }) => {
    let calls = 0;
    const delegate = structuredRunner();
    const runner: CliRunner = async (request) => { calls++; return delegate(request); };
    await runStructuredTodayIndexPreparation({ ...args, runner });
    const first = calls;
    await runStructuredTodayIndexPreparation({ ...args, runner });
    assert.equal(calls - first, first);
    console.log("AUDIT_RESULT", JSON.stringify({ probe: "incremental-reuse", firstCalls: first, unchangedEvidenceSecondCalls: calls - first }));
  });
});

test("AUDIT repository progress cost scales with immutable history", async () => {
  await auditFixture(async ({ args }) => {
    const { artifact } = await runStructuredTodayIndexPreparation({ ...args, runner: structuredRunner() });
    const samples = [];
    for (const count of [10, 100, 500]) {
      const indexes = Array.from({ length: count }, (_, i) => {
        const { contentHash: omittedHash, ...body } = structuredClone(artifact);
        body.revision = i + 1;
        body.worklines[0]!.summary = "Historical context. ".repeat(500).trim();
        return { ...body, contentHash: canonicalContentHash(body) };
      });
      const last = indexes.at(-1)!;
      const document = normalizeTraceinkAssetStore({ schemaVersion: 1, artifacts: [], reflections: [], activeIndexByDate: {}, structuredIndexes: indexes, activeStructuredIndexByDate: { [logicalDate]: { artifactId: last.artifactId, revision: last.revision, contentHash: last.contentHash } } });
      assert.equal(document.structuredIndexes?.length, count);
      let bytes = 0;
      const repository = createTraceinkAssetRepository({ filePath: "/audit/assets.json", io: {
        readText: async () => JSON.stringify(document), ensureDirectory: async () => {}, writeNewText: async (_, text) => { bytes += Buffer.byteLength(text); }, replaceFile: async () => {}, removeFile: async () => {}
      } });
      await repository.load();
      const times = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const started = performance.now();
        await repository.mutate((current) => upsertStructuredTodayRun(current, { runId: "audit-progress", kind: "index", logicalDate, status: "running", stage: "digest", completed: attempt, total: 10, startedAt: "2026-08-29T01:00:00.000Z", updatedAt: "2026-08-29T01:10:00.000Z" }));
        times.push(performance.now() - started);
      }
      times.sort((a, b) => a - b);
      samples.push({ revisions: count, storeBytes: Buffer.byteLength(JSON.stringify(document)), medianProgressMutationMs: Math.round(times[1]! * 10) / 10, serializedBytesPerProgressWrite: Math.round(bytes / 3) });
    }
    console.log("AUDIT_RESULT", JSON.stringify({ probe: "history-progress-cost", diskIo: "stubbed", samples }));
  });
});

import { runInNewContext } from "node:vm";
import ts from "typescript";

test("AUDIT original refreshSnapshot publishes an obsolete date and overwrites newer settings", async () => {
  const main = await fs.readFile(path.resolve("app/desktop/main.ts"), "utf8");
  const source = main.slice(main.indexOf("async function refreshSnapshot("), main.indexOf("function scheduleSessionSummaries("));
  const executable = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const pending = new Map<string, (snapshot: any) => void>();
  const sandbox: any = {
    data: { settings: { marker: "old" }, workSessionSnapshot: { date: "2026-08-29", sessions: [] } },
    summaryRunId: 0, summaryJob: {}, summaryCache: {}, summaryModels: {}, runtimeFs: {}, os: { homedir: () => "/tmp" }, MAX_WORK_SESSION_SNAPSHOT_SESSIONS: 48,
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
  assert.equal(sandbox.data.workSessionSnapshot.date, "2026-08-29");
  assert.equal(sandbox.data.settings.marker, "old");
  console.log("AUDIT_RESULT", JSON.stringify({ probe: "refresh-race", harness: "original function with gated dependencies", requestedLatestDate: "2026-08-30", finalSnapshotDate: sandbox.data.workSessionSnapshot.date, newSettingsOverwritten: true }));
});
