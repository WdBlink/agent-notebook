import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createTraceinkAssetRepository,
  type TraceinkAssetRepositoryIo
} from "../app/desktop/traceink-asset-repository";
import {
  runTraceinkReviewPreparation,
  type TraceinkReviewPreparationInput
} from "../app/desktop/traceink-review-preparation";
import {
  activeIndexReferenceForDate,
  appendTraceinkIndexRevision
} from "../app/desktop/traceink-asset-store";
import type { TraceinkIndexArtifactDraftV1 } from "../src/traceink-review-assets";
import type { AgentWorkSession } from "../src/types";

const logicalDate = "2026-08-15";

test("raw preparation clones evidence and commits exactly one canonical index asset", async () => {
  await withRepository(async (repository) => {
    let receivedSessions: AgentWorkSession[] | undefined;
    const input = preparationInput("raw");
    const original = structuredClone(input.sessions);
    const result = await runTraceinkReviewPreparation(input, {
      repository,
      async compile(compileInput) {
        receivedSessions = compileInput.capturedSessions;
        assert.notEqual(compileInput.capturedSessions, input.sessions);
        assert.equal(compileInput.logicalDate, logicalDate);
        assert.equal(compileInput.evidenceCutoff, input.evidenceCutoff);
        compileInput.capturedSessions[0]!.title = "compiler-local mutation";
        return indexDraft("\n# canonical index\r\n  exact  \r\n");
      }
    });

    assert.deepEqual(input.sessions, original);
    assert.equal(receivedSessions?.[0]?.title, "compiler-local mutation");
    assert.deepEqual(result.capturedSessions, original);
    assert.equal(result.document.artifacts.length, 1);
    assert.equal(result.document.reflections.length, 0);
    assert.equal(result.activeIndex.stage, "index");
    assert.equal(result.activeIndex.rawMarkdown, "\n# canonical index\r\n  exact  \r\n");
    assert.deepEqual(activeIndexReferenceForDate(repository.snapshot(), logicalDate), result.activeIndexReference);
  });
});

test("compiler and draft-validation failures commit zero artifacts and preserve the last good index", async () => {
  await withRepository(async (repository) => {
    await repository.load();
    await assert.rejects(runTraceinkReviewPreparation(preparationInput("raw"), {
      repository,
      async compile() { throw new Error("compiler unavailable"); }
    }), /compiler unavailable/);
    assert.equal(repository.snapshot().artifacts.length, 0);

    await repository.mutate((current) => appendTraceinkIndexRevision(current, indexDraft("# last good\n")));
    const before = repository.snapshot();
    await assert.rejects(runTraceinkReviewPreparation(preparationInput("compiled"), {
      repository,
      async compile() {
        return { ...indexDraft("# wrong day\n"), logicalDate: "2026-08-14" };
      }
    }), /different logical date/);
    assert.deepEqual(repository.snapshot(), before);

    await assert.rejects(runTraceinkReviewPreparation(preparationInput("compiled"), {
      repository,
      async compile() {
        return { ...indexDraft("# wrong stage\n"), stage: "dossier" } as unknown as TraceinkIndexArtifactDraftV1;
      }
    }), /invalid stage/);
    assert.deepEqual(repository.snapshot(), before);
  });
});

test("a competing refresh wins and the slow preparation is rejected by exact-reference CAS", async () => {
  await withRepository(async (repository) => {
    await repository.mutate((current) => appendTraceinkIndexRevision(current, indexDraft("# revision one\n")));
    let startCompiler!: () => void;
    const compilerStarted = new Promise<void>((resolve) => { startCompiler = resolve; });
    let finishCompiler!: (draft: TraceinkIndexArtifactDraftV1) => void;
    const compilerResult = new Promise<TraceinkIndexArtifactDraftV1>((resolve) => { finishCompiler = resolve; });

    const slowPreparation = runTraceinkReviewPreparation(preparationInput("stale"), {
      repository,
      async compile() {
        startCompiler();
        return compilerResult;
      }
    });
    await compilerStarted;
    const expectedFirst = activeIndexReferenceForDate(repository.snapshot(), logicalDate)!;
    await repository.mutate((current) => appendTraceinkIndexRevision(
      current,
      indexDraft("# competing revision\n"),
      expectedFirst
    ));
    finishCompiler(indexDraft("# slow stale result\n"));

    await assert.rejects(slowPreparation, /active index changed/);
    const finalDocument = repository.snapshot();
    assert.equal(finalDocument.artifacts.length, 2);
    assert.equal(finalDocument.artifacts.at(-1)?.rawMarkdown, "# competing revision\n");
    assert.equal(activeIndexReferenceForDate(finalDocument, logicalDate)?.revision, 2);
  });
});

test("persistence failure commits no prepared artifact and preserves the last durable document", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "traceink-preparation-persist-"));
  const filePath = path.join(directory, "traceink-assets-v1.json");
  let failReplacement = false;
  const io = failingIo(() => failReplacement);
  try {
    const repository = createTraceinkAssetRepository({ filePath, io });
    await repository.load();
    const durableBefore = await fs.readFile(filePath, "utf8");
    failReplacement = true;

    await assert.rejects(runTraceinkReviewPreparation(preparationInput("raw"), {
      repository,
      async compile() { return indexDraft("# cannot persist\n"); }
    }), /disk unavailable/);

    assert.equal(repository.snapshot().artifacts.length, 0);
    assert.equal(await fs.readFile(filePath, "utf8"), durableBefore);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("date, snapshot, mode, and current asset mode are validated before compiler work", async () => {
  await withRepository(async (repository) => {
    let compileCalls = 0;
    const dependencies = {
      repository,
      async compile() {
        compileCalls += 1;
        return indexDraft("# forbidden\n");
      }
    };
    await assert.rejects(runTraceinkReviewPreparation({
      ...preparationInput("raw"),
      logicalDate: "2026-02-30",
      snapshotDate: "2026-02-30"
    }, dependencies), /date is invalid/);
    await assert.rejects(runTraceinkReviewPreparation({
      ...preparationInput("raw"),
      snapshotDate: "2026-08-14"
    }, dependencies), /snapshot does not match/);
    await assert.rejects(runTraceinkReviewPreparation({
      ...preparationInput("raw"),
      mode: "unknown" as "raw"
    }, dependencies), /mode is invalid/);
    await assert.rejects(runTraceinkReviewPreparation({
      ...preparationInput("raw"),
      evidenceCutoff: "not-a-timestamp"
    }, dependencies), /cutoff is invalid/);
    assert.equal(compileCalls, 0);

    await repository.load();
    await assert.rejects(runTraceinkReviewPreparation(preparationInput("compiled"), dependencies), /current mode is raw/);
    assert.equal(compileCalls, 0);
    await repository.mutate((current) => appendTraceinkIndexRevision(current, indexDraft("# existing\n")));
    await assert.rejects(runTraceinkReviewPreparation(preparationInput("raw"), dependencies), /current mode is not raw/);
    assert.equal(compileCalls, 0);
  });
});

test("canonical preparation and repository have no legacy review or notebook dependency", async () => {
  const sources = await Promise.all([
    fs.readFile(new URL("../app/desktop/traceink-review-preparation.ts", import.meta.url), "utf8"),
    fs.readFile(new URL("../app/desktop/traceink-asset-repository.ts", import.meta.url), "utf8")
  ]);
  for (const source of sources) {
    assert.doesNotMatch(source, /from ["'][^"']*(?:notebook-store|daily-review-preparation|workline-review)["']/);
    assert.doesNotMatch(source, /\b(?:DailyReviewPackage|NotebookDocument|appendDailyReviewGeneration)\b/);
  }
});

async function withRepository(run: (repository: ReturnType<typeof createTraceinkAssetRepository>) => Promise<void>): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "traceink-preparation-"));
  try {
    await run(createTraceinkAssetRepository({ filePath: path.join(directory, "traceink-assets-v1.json") }));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function preparationInput(mode: TraceinkReviewPreparationInput["mode"]): TraceinkReviewPreparationInput {
  return {
    logicalDate,
    snapshotDate: logicalDate,
    mode,
    evidenceCutoff: "2026-08-15T18:00:00.000+08:00",
    sessions: [session()]
  };
}

function session(): AgentWorkSession {
  return {
    id: "session-1",
    platform: "codex",
    title: "Provider metadata only",
    summary: "Not semantic authority",
    path: "/tmp/session-1.jsonl",
    startedAt: "2026-08-15T09:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
    projectPath: "/workspace/project",
    resumable: true,
    artifacts: [],
    status: "active"
  };
}

function indexDraft(rawMarkdown: string): TraceinkIndexArtifactDraftV1 {
  return {
    schemaVersion: 1,
    logicalDate,
    stage: "index",
    producer: {
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningConfiguration: "ultra",
      startedAt: "2026-08-15T10:00:00.000Z",
      completedAt: "2026-08-15T10:05:00.000Z",
      skill: {
        packageId: "traceink",
        version: "traceink-skill-bundle-v1",
        skillHash: "a".repeat(64),
        editorialContractHash: "b".repeat(64)
      }
    },
    inputEvidenceHash: "c".repeat(64),
    rawMarkdown,
    coverage: [],
    evidence: [],
    navigation: [],
    warnings: []
  };
}

function failingIo(shouldFail: () => boolean): TraceinkAssetRepositoryIo {
  return {
    readText(filePath) { return fs.readFile(filePath, "utf8"); },
    async ensureDirectory(directoryPath) { await fs.mkdir(directoryPath, { recursive: true }); },
    async writeNewText(filePath, text) {
      await fs.writeFile(filePath, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
    },
    async replaceFile(sourcePath, destinationPath) {
      if (shouldFail()) throw new Error("disk unavailable");
      await fs.rename(sourcePath, destinationPath);
    },
    async removeFile(filePath) { await fs.rm(filePath, { force: true }); }
  };
}
