import assert from "node:assert/strict";
import test from "node:test";
import { authorizeSessionTranscriptRequest } from "../app/desktop/session-transcript-access";
import { composeDailyPage, createEmptyNotebookDocument } from "../app/desktop/notebook-store";
import type { SessionTranscriptRequest } from "../app/desktop/api";
import type { AgentWorkSession } from "../src/types";
import type { DailyReviewPackage } from "../src/workline-review";

const logicalDate = "2026-08-09";
const historical: AgentWorkSession = {
  id: "historical-session",
  platform: "claude",
  title: "历史会话",
  summary: "封页后仍能由包内证据安全重开。",
  path: "/archive/historical-session.jsonl",
  updatedAt: "2026-08-09T10:00:00.000Z",
  artifacts: [],
  status: "completed"
};

test("current snapshot tuple is authorized without a package reference", () => {
  const request: SessionTranscriptRequest = { id: historical.id, platform: historical.platform, path: historical.path };

  const authorized = authorizeSessionTranscriptRequest(request, [historical], createEmptyNotebookDocument());

  assert.deepEqual(authorized, {
    id: historical.id,
    platform: historical.platform,
    path: historical.path,
    title: historical.title
  });
});

test("exact evidence in the active historical package authorizes transcript reopening", () => {
  const document = composeDailyPage(
    createEmptyNotebookDocument(),
    logicalDate,
    [historical],
    new Date("2026-08-09T18:00:00.000Z"),
    reviewPackage()
  );
  const generation = document.pages[logicalDate]?.packageGenerations?.[0];
  assert.ok(generation);
  const request: SessionTranscriptRequest = {
    id: historical.id,
    platform: historical.platform,
    path: historical.path,
    packageRef: {
      logicalDate,
      generationId: generation.id,
      evidenceId: "session:claude:historical-session"
    }
  };

  const authorized = authorizeSessionTranscriptRequest(request, [], document);

  assert.deepEqual(authorized, {
    id: historical.id,
    platform: historical.platform,
    path: historical.path,
    title: historical.title
  });
});

test("historical authorization rejects a tampered path, generation, or evidence id", () => {
  const document = composeDailyPage(
    createEmptyNotebookDocument(),
    logicalDate,
    [historical],
    new Date("2026-08-09T18:00:00.000Z"),
    reviewPackage()
  );
  const generationId = document.pages[logicalDate]?.activePackageGenerationId ?? "";
  const base: SessionTranscriptRequest = {
    id: historical.id,
    platform: historical.platform,
    path: historical.path,
    packageRef: { logicalDate, generationId, evidenceId: "session:claude:historical-session" }
  };

  assert.throws(
    () => authorizeSessionTranscriptRequest({ ...base, path: "/tmp/tampered.jsonl" }, [], document),
    /不匹配/
  );
  assert.throws(
    () => authorizeSessionTranscriptRequest({ ...base, packageRef: { ...base.packageRef!, generationId: "generation-tampered" } }, [], document),
    /不是当前封存证据包/
  );
  assert.throws(
    () => authorizeSessionTranscriptRequest({ ...base, packageRef: { ...base.packageRef!, evidenceId: "artifact:claude:historical-session:0" } }, [], document),
    /没有找到这条会话证据/
  );
});

function reviewPackage(): DailyReviewPackage {
  return {
    schemaVersion: 1,
    id: "historical-package",
    logicalDate,
    generatedAt: "2026-08-09T18:00:00.000Z",
    evidenceCutoff: "2026-08-09T18:00:00.000Z",
    promptProfile: "traceink-review-v1",
    compilerProvider: "codex",
    model: "review-model",
    evidence: [{
      id: "session:claude:historical-session",
      kind: "session",
      label: historical.title,
      path: historical.path,
      platform: historical.platform,
      sessionId: historical.id
    }],
    worklines: [{
      id: "historical-workline",
      title: "历史工作线",
      summary: "证据仍可追溯。",
      status: "complete",
      sourceSessionIds: ["claude:historical-session"],
      participation: [{ id: "agent-1", kind: "agent", label: "Agent 处理" }],
      dossier: {
        title: "历史工作线",
        dek: "封存材料。",
        blocks: [{
          id: "evidence",
          kind: "evidence-change",
          title: "已形成证据",
          body: "历史会话已进入封存包。",
          evidenceIds: ["session:claude:historical-session"],
          payload: {}
        }, {
          id: "future",
          kind: "future-observation",
          title: "未来观察",
          body: "未来可以重新核对原文。",
          evidenceIds: ["session:claude:historical-session"],
          payload: {}
        }],
        question: { prompt: "这份历史证据是否仍支持当时的判断？" }
      },
      payload: {}
    }],
    warnings: [],
    rawOutput: { worklines: [{ id: "historical-workline" }] }
  };
}
