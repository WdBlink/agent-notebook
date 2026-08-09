import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadAgentWorkSnapshot, type RuntimeFileSystem } from "../src/agent-sessions";
import { createEmptyData } from "../src/state";
import {
  buildSessionEvidenceManifest,
  createTodayBoardGeneration,
  projectTodayBoard
} from "../src/today-board";
import type { AgentWorkSession } from "../src/types";
import type { DailyReviewPackage } from "../src/workline-review";

const fsAdapter: RuntimeFileSystem = {
  stat,
  readdir,
  async readFile(filePath, encoding) {
    return readFile(filePath, encoding);
  },
  async readBytes(filePath) {
    return readFile(filePath);
  },
  realpath
};

const session: AgentWorkSession = {
  id: "codex-1",
  platform: "codex",
  title: "整理今天的工作线",
  summary: "把会话证据编排成可回看的工作线。",
  path: "/tmp/codex-1.jsonl",
  startedAt: "2026-08-01T08:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
  projectPath: "/workspace/today-board",
  artifacts: ["notes.md"],
  status: "active"
};

test("projection is raw when the page has no successful package", () => {
  const projection = projectTodayBoard({ status: "unformed" }, [session]);

  assert.equal(projection.mode, "raw");
  assert.equal(projection.activeGeneration, undefined);
  assert.deepEqual(projection.uncompiledEvidence.map((entry) => entry.identity), ["codex:codex-1:/tmp/codex-1.jsonl"]);
});

test("projection stays compiled when the admitted manifest exactly matches the snapshot despite a later wall clock", () => {
  const generation = createTodayBoardGeneration(reviewPackage(), [session]);
  const projection = projectTodayBoard({ status: "draft", packageGenerations: [generation], activePackageGenerationId: generation.id }, [session]);

  assert.equal(projection.mode, "compiled");
  assert.equal(projection.activeGeneration?.id, generation.id);
  assert.deepEqual(projection.uncompiledEvidence, []);
});

test("projection is stale only when snapshot evidence differs from the admitted package manifest", () => {
  const generation = createTodayBoardGeneration(reviewPackage(), [session]);
  const updatedSession = { ...session, updatedAt: "2026-08-01T11:00:00.000Z" };
  const newSession = { ...session, id: "codex-2", path: "/tmp/codex-2.jsonl", updatedAt: "2026-08-01T09:00:00.000Z" };
  const projection = projectTodayBoard(
    { status: "draft", packageGenerations: [generation], activePackageGenerationId: generation.id },
    [updatedSession, newSession]
  );

  assert.equal(projection.mode, "stale");
  assert.deepEqual(projection.uncompiledEvidence.map((entry) => entry.identity), [
    "codex:codex-1:/tmp/codex-1.jsonl",
    "codex:codex-2:/tmp/codex-2.jsonl"
  ]);
});

test("sealed projection stays read-only even when newer evidence arrives", () => {
  const generation = createTodayBoardGeneration(reviewPackage(), [session]);
  const projection = projectTodayBoard(
    { status: "sealed", packageGenerations: [generation], activePackageGenerationId: generation.id },
    [{ ...session, updatedAt: "2026-08-01T11:00:00.000Z" }]
  );

  assert.equal(projection.mode, "sealed");
  assert.equal(projection.activeGeneration?.package.id, "package-1");
  assert.equal(projection.uncompiledEvidence.length, 1);
});

test("sealed projection never falls back when an explicit active generation id is corrupt", () => {
  const generation = createTodayBoardGeneration(reviewPackage(), [session]);
  const projection = projectTodayBoard(
    { status: "sealed", packageGenerations: [generation], activePackageGenerationId: "generation-does-not-exist" },
    [session]
  );

  assert.equal(projection.mode, "sealed");
  assert.equal(projection.activeGeneration, undefined);
});

test("projection does not infer an active id when package generations are present", () => {
  const generation = createTodayBoardGeneration(reviewPackage(), [session]);
  const projection = projectTodayBoard(
    { status: "draft", packageGenerations: [generation] },
    [session]
  );

  assert.equal(projection.mode, "raw");
  assert.equal(projection.activeGeneration, undefined);
});

test("projection still infers the single package for a genuine legacy page", () => {
  const legacyPackage = reviewPackage();
  const projection = projectTodayBoard({ status: "draft", reviewPackage: legacyPackage }, [session]);

  assert.equal(projection.activeGeneration?.package.id, legacyPackage.id);
});

test("session evidence manifest changes when stable session revision metadata changes", () => {
  const original = buildSessionEvidenceManifest([session]);
  const changed = buildSessionEvidenceManifest([{ ...session, artifacts: ["notes.md", "result.md"] }]);

  assert.equal(original[0]?.identity, changed[0]?.identity);
  assert.notEqual(original[0]?.revision, changed[0]?.revision);
});

test("captured transcript metadata changes do not make an admitted generation stale", () => {
  const capturedSession: AgentWorkSession = {
    ...session,
    transcriptCapture: {
      canonicalPath: session.path,
      sha256: "da66d7a01759dbfbceace356dc1f2d87976249c58fb22c5afe79245986b587be",
      byteLength: 261,
      coverage: { startByte: 0, endByte: 261 }
    }
  };
  const generation = createTodayBoardGeneration(reviewPackage(), [capturedSession]);
  assert.equal(generation.admittedEvidence[0]?.revision, `sha256:${capturedSession.transcriptCapture!.sha256}:261`);
  const metadataOnlyChange: AgentWorkSession = {
    ...capturedSession,
    title: "模型重新概括的标题",
    summary: "模型重新概括的摘要。",
    updatedAt: "2026-08-01T11:00:00.000Z",
    artifacts: ["notes.md", "result.md"],
    status: "completed"
  };

  const projection = projectTodayBoard(
    { status: "draft", packageGenerations: [generation], activePackageGenerationId: generation.id },
    [metadataOnlyChange]
  );

  assert.equal(projection.mode, "compiled");
  assert.deepEqual(projection.uncompiledEvidence, []);
});

test("captured transcript content hash changes make an admitted generation stale even when mtime is unchanged", () => {
  const capturedSession: AgentWorkSession = {
    ...session,
    transcriptCapture: {
      canonicalPath: session.path,
      sha256: "da66d7a01759dbfbceace356dc1f2d87976249c58fb22c5afe79245986b587be",
      byteLength: 261,
      coverage: { startByte: 0, endByte: 261 }
    }
  };
  const generation = createTodayBoardGeneration(reviewPackage(), [capturedSession]);
  const sameMtimeMutation: AgentWorkSession = {
    ...capturedSession,
    transcriptCapture: {
      ...capturedSession.transcriptCapture!,
      sha256: "aa66d7a01759dbfbceace356dc1f2d87976249c58fb22c5afe79245986b587be"
    }
  };

  const projection = projectTodayBoard(
    { status: "draft", packageGenerations: [generation], activePackageGenerationId: generation.id },
    [sameMtimeMutation]
  );

  assert.equal(projection.mode, "stale");
  assert.deepEqual(projection.uncompiledEvidence.map((entry) => entry.identity), ["codex:codex-1:/tmp/codex-1.jsonl"]);
});

test("symlinked scan root detects same-mtime content mutation from scan through generation projection", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "work-continuity-stale-e2e-"));
  const realRoot = path.join(temp, "real-sessions");
  const aliasRoot = path.join(temp, ".codex", "sessions");
  const transcriptPath = path.join(realRoot, "rollout-2026-08-01.jsonl");
  const fixedTime = new Date("2026-08-01T10:00:00.000Z");
  const content = (marker: string) => [
    JSON.stringify({ timestamp: "2026-08-01T09:00:00.000Z", type: "session_meta", payload: { id: "codex-1" } }),
    JSON.stringify({ timestamp: "2026-08-01T09:01:00.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: marker }] } })
  ].join("\n");

  try {
    await mkdir(realRoot, { recursive: true });
    await mkdir(path.dirname(aliasRoot), { recursive: true });
    await symlink(realRoot, aliasRoot, "dir");
    await writeFile(transcriptPath, content("alpha"));
    await utimes(transcriptPath, fixedTime, fixedTime);
    const scan = () => loadAgentWorkSnapshot(createEmptyData().settings, {
      now: new Date("2026-08-02T12:00:00.000Z"),
      date: "2026-08-01",
      roots: [aliasRoot],
      fs: fsAdapter
    });
    const first = await scan();
    const firstSession = first.sessions[0];
    assert.ok(firstSession?.transcriptCapture);
    assert.equal(firstSession.path, await realpath(transcriptPath));
    const admittedPackage = reviewPackage();
    admittedPackage.evidence = [{
      id: "session:codex:codex-1",
      kind: "session",
      label: firstSession.title,
      path: firstSession.path,
      platform: firstSession.platform,
      sessionId: firstSession.id,
      updatedAt: firstSession.updatedAt,
      transcriptCapture: structuredClone(firstSession.transcriptCapture)
    }];
    const generation = createTodayBoardGeneration(admittedPackage, first.sessions);
    assert.equal(projectTodayBoard(
      { status: "draft", packageGenerations: [generation], activePackageGenerationId: generation.id },
      first.sessions
    ).mode, "compiled");

    await writeFile(transcriptPath, content("bravo"));
    await utimes(transcriptPath, fixedTime, fixedTime);
    const second = await scan();
    assert.equal(second.sessions[0]?.updatedAt, firstSession.updatedAt);
    assert.notEqual(second.sessions[0]?.transcriptCapture?.sha256, firstSession.transcriptCapture.sha256);
    assert.equal(projectTodayBoard(
      { status: "draft", packageGenerations: [generation], activePackageGenerationId: generation.id },
      second.sessions
    ).mode, "stale");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

function reviewPackage(): DailyReviewPackage {
  return {
    schemaVersion: 1,
    id: "package-1",
    logicalDate: "2026-08-01",
    generatedAt: "2026-08-01T10:00:00.000Z",
    evidenceCutoff: "2026-08-01T10:00:00.000Z",
    promptProfile: "ksi-workline-review-v1",
    compilerProvider: "codex",
    model: "review-model",
    evidence: [{ id: "session:codex:codex-1", kind: "session", label: "整理今天的工作线", path: "/tmp/codex-1.jsonl", platform: "codex", sessionId: "codex-1" }],
    worklines: [{
      id: "workline-1",
      title: "建立工作线",
      summary: "把会话转换为工作线。",
      status: "ready",
      sourceSessionIds: ["codex:codex-1"],
      participation: [],
      dossier: { title: "证据", dek: "证据", blocks: [] },
      payload: {}
    }],
    warnings: [],
    rawOutput: { worklines: [] }
  };
}
