import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { CliRunner } from "../src/agent-summary";
import { NodeSqliteSaver } from "../src/langgraph-node-sqlite-checkpointer";
import type { AgentWorkSnapshot, CockpitSettings } from "../src/types";
import { createTraceinkAssetRepository } from "../app/desktop/traceink-asset-repository";
import { activeStructuredTodayIndexReferenceForDate } from "../app/desktop/traceink-asset-store";
import { runStructuredTodayIndexV2CandidatePreparation } from "../app/desktop/structured-today-v2-runtime";
import { runStructuredTodayDossierV2CandidatePreparation } from "../app/desktop/structured-today-v2-dossier-runtime";
import { buildStructuredTodayIndexV2 } from "../src/structured-today-v2-artifacts";
import { buildStructuredTodayDossierV2 } from "../src/structured-today-v2-dossier-artifacts";

test("real V2 candidate runtime persists exact findings without rotating the active V1 index", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "structured-v2-runtime-"));
  const checkpointer = NodeSqliteSaver.fromConnectionString(":memory:");
  try {
    const sourcePath = path.join(directory, "session.jsonl");
    const transcript = `${JSON.stringify({
      type: "response_item",
      timestamp: "2026-08-30T01:00:00.000Z",
      payload: {
        type: "message",
        id: "user-v2",
        role: "user",
        content: [{ type: "input_text", text: "实现消息级证据。" }]
      }
    })}\n`;
    await fs.writeFile(sourcePath, transcript, "utf8");
    const repository = createTraceinkAssetRepository({ filePath: path.join(directory, "assets.json") });
    await repository.load();
    const calls: string[] = [];
    const result = await runStructuredTodayIndexV2CandidatePreparation({
      logicalDate: "2026-08-30",
      snapshot: snapshot(sourcePath, transcript),
      settings: settings(),
      repository,
      checkpointer,
      runner: runner(calls)
    });

    assert.equal(result.publishable, true, JSON.stringify({
      issues: result.issues,
      coverage: result.artifact.coverage,
      worklines: result.artifact.worklines.length,
      dispositions: result.artifact.dispositions
    }));
    assert.equal(result.artifact.schema, "today-workline-index/v2");
    assert.equal(result.artifact.findings.length, 1);
    assert.equal(result.artifact.spans[0]?.textQuote.exact, "实现消息级证据。");
    assert.equal(result.artifact.worklines[0]?.summary.spanIds.length, 1);
    assert.equal(activeStructuredTodayIndexReferenceForDate(repository.snapshot(), "2026-08-30"), undefined);
    assert.equal(repository.snapshot().structuredIndexes?.length, 0);
    assert.equal(repository.snapshot().structuredIndexV2Candidates?.length, 1);
    const dossier = await runStructuredTodayDossierV2CandidatePreparation({
      sourceIndex: {
        artifactId: result.artifact.artifactId,
        revision: result.artifact.revision,
        contentHash: result.artifact.contentHash
      },
      worklineId: "workline-v2",
      settings: settings(),
      repository,
      checkpointer,
      runner: runner(calls)
    });
    assert.equal(dossier.schema, "today-workline-dossier/v2");
    assert.equal(dossier.content.supportingEvidence[0]?.spanIds.length, 1);
    assert.equal(repository.snapshot().structuredDossierV2Candidates?.length, 1);
    assert.deepEqual(calls, ["digest", "synthesis", "analysis", "critique", "compose"]);

    const reopened = createTraceinkAssetRepository({ filePath: path.join(directory, "assets.json") });
    await reopened.load();
    assert.equal(reopened.snapshot().structuredIndexV2Candidates?.[0]?.contentHash, result.artifact.contentHash);
    assert.equal(reopened.snapshot().structuredDossierV2Candidates?.[0]?.contentHash, dossier.contentHash);
  } finally {
    checkpointer.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("terminal index and dossier builder failures clear poisoned checkpoints for one fresh explicit retry", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "structured-v2-fresh-retry-"));
  const checkpointer = NodeSqliteSaver.fromConnectionString(":memory:");
  try {
    const sourcePath = path.join(directory, "session.jsonl");
    const transcript = [
      JSON.stringify({
        type: "session_meta",
        timestamp: "2026-08-30T01:00:00.000Z",
        payload: { id: "session-v2", cwd: directory }
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-08-30T01:01:00.000Z",
        payload: {
          type: "message",
          id: "user-v2",
          role: "user",
          content: [{ type: "input_text", text: "实现消息级证据。" }]
        }
      })
    ].join("\n") + "\n";
    await fs.writeFile(sourcePath, transcript, "utf8");
    const repository = createTraceinkAssetRepository({ filePath: path.join(directory, "assets.json") });
    await repository.load();
    const calls: string[] = [];
    const retryingRunner = runner(calls);
    let indexBuildAttempts = 0;
    const runIndex = () => runStructuredTodayIndexV2CandidatePreparation({
      logicalDate: "2026-08-30",
      snapshot: snapshot(sourcePath, transcript),
      settings: settings(),
      repository,
      checkpointer,
      runner: retryingRunner,
      buildIndex(input) {
        indexBuildAttempts += 1;
        if (indexBuildAttempts === 1) throw new Error("injected terminal index builder failure");
        return buildStructuredTodayIndexV2(input);
      }
    });

    await assert.rejects(runIndex, /injected terminal index builder failure/u);
    assert.equal(repository.snapshot().structuredIndexV2Candidates?.length ?? 0, 0);
    assert.equal((await checkpointThreadIds(checkpointer)).some((id) => id.startsWith("structured-today-index-v2-")), false);

    const index = await runIndex();
    assert.equal(index.artifact.coverage.complete, true);
    assert.deepEqual(calls.filter((stage) => stage === "digest" || stage === "synthesis"), [
      "digest", "synthesis", "digest", "synthesis"
    ]);
    const sourceIndex = {
      artifactId: index.artifact.artifactId,
      revision: index.artifact.revision,
      contentHash: index.artifact.contentHash
    };
    let dossierBuildAttempts = 0;
    const runDossier = () => runStructuredTodayDossierV2CandidatePreparation({
      sourceIndex,
      worklineId: "workline-v2",
      settings: settings(),
      repository,
      checkpointer,
      runner: retryingRunner,
      buildDossier(input) {
        dossierBuildAttempts += 1;
        if (dossierBuildAttempts === 1) throw new Error("injected terminal dossier builder failure");
        return buildStructuredTodayDossierV2(input);
      }
    });

    await assert.rejects(runDossier, /injected terminal dossier builder failure/u);
    assert.equal(repository.snapshot().structuredDossierV2Candidates?.length ?? 0, 0);
    assert.equal((await checkpointThreadIds(checkpointer)).some((id) => id.startsWith("structured-today-dossier-v2-")), false);

    const dossier = await runDossier();
    assert.equal(dossier.schema, "today-workline-dossier/v2");
    assert.deepEqual(calls.filter((stage) => ["analysis", "critique", "compose"].includes(stage)), [
      "analysis", "critique", "compose", "analysis", "critique", "compose"
    ]);
  } finally {
    checkpointer.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

function runner(calls: string[]): CliRunner {
  return async (request) => {
    let output: unknown;
    if (request.stdin.includes("Extract atomic")) {
      calls.push("digest");
      const messageKey = request.stdin.match(/msg-v2-[a-f0-9]{64}/u)?.[0];
      assert.ok(messageKey);
      output = {
        sessionId: "session-v2",
        findings: [{ text: "用户要求实现消息级证据。", claimKind: "fact", messageKey, exactQuote: "实现消息级证据。" }],
        uncertainties: []
      };
    } else if (request.stdin.includes("Reconstruct cross-Session")) {
      calls.push("synthesis");
      const findingId = request.stdin.match(/finding-v1-[a-f0-9]{64}/u)?.[0];
      assert.ok(findingId);
      const statement = (text: string, relation: "source-span" | "inference-basis" = "source-span") => ({
        text,
        relation,
        findingIds: [findingId]
      });
      output = {
        worklines: [{
          worklineId: "workline-v2",
          title: "消息级证据实现",
          summary: statement("用户要求实现消息级证据。"),
          startedAt: "2026-08-30T01:00:00.000Z",
          endedAt: "2026-08-30T01:10:00.000Z",
          currentStop: statement("当前进入实现阶段。"),
          possibleChange: statement("引用可能变得可审计。", "inference-basis"),
          participation: {
            account: { agent: "Agent 开始实现。" },
            statement: statement("用户要求实现消息级证据。")
          },
          evidenceReadiness: "ready",
          sessionIds: ["session-v2"],
          extensions: []
        }],
        assignments: [{ sessionId: "session-v2", worklineIds: ["workline-v2"] }],
        unresolvedSessionIds: []
      };
    } else if (request.stdin.includes("Analyze only the selected V2")) {
      calls.push("analysis");
      const findingId = request.stdin.match(/finding-v1-[a-f0-9]{64}/u)?.[0];
      assert.ok(findingId);
      const statement = (text: string, relation: "source-span" | "inference-basis" = "source-span") => ({
        text,
        relation,
        findingIds: [findingId]
      });
      output = {
        priorContext: statement("用户要求消息级证据。"),
        whatHappened: statement("开始实现消息级证据。"),
        possibleChange: statement("引用可能可审计。", "inference-basis"),
        supportingEvidence: [statement("用户要求实现消息级证据。")],
        opposingEvidence: [],
        falsifiableObservation: statement("真实 Gate 可以验证。", "inference-basis"),
        gaps: []
      };
    } else if (request.stdin.includes("Critique the V2 dossier")) {
      calls.push("critique");
      output = { issues: [], missingFindingIds: [] };
    } else if (request.stdin.includes("Compose the final V2 dossier")) {
      calls.push("compose");
      const findingId = request.stdin.match(/finding-v1-[a-f0-9]{64}/u)?.[0];
      assert.ok(findingId);
      const statement = (text: string, relation: "source-span" | "inference-basis" = "source-span") => ({
        text,
        relation,
        findingIds: [findingId]
      });
      output = {
        title: "消息级证据档案",
        priorContext: statement("用户要求消息级证据。"),
        whatHappened: statement("开始实现消息级证据。"),
        possibleChange: statement("引用可能可审计。", "inference-basis"),
        supportingEvidence: [statement("用户要求实现消息级证据。")],
        opposingEvidence: [],
        falsifiableObservation: statement("真实 Gate 可以验证。", "inference-basis"),
        gaps: [],
        humanQuestion: statement("是否继续验证消息级证据？", "inference-basis"),
        extensions: []
      };
    } else {
      throw new Error(`Unexpected V2 prompt: ${request.stdin.slice(0, 120)}`);
    }
    return {
      stdout: `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(output) } })}\n`,
      stderr: ""
    };
  };
}

async function checkpointThreadIds(checkpointer: NodeSqliteSaver): Promise<string[]> {
  const ids = new Set<string>();
  for await (const tuple of checkpointer.list({})) {
    const threadId = tuple.config.configurable?.thread_id;
    if (typeof threadId === "string") ids.add(threadId);
  }
  return [...ids];
}

function snapshot(sourcePath: string, transcript: string): AgentWorkSnapshot {
  const bytes = Buffer.from(transcript, "utf8");
  return {
    date: "2026-08-30",
    generatedAt: "2026-08-30T02:00:00.000Z",
    sessions: [{
      id: "session-v2",
      platform: "codex",
      title: "V2 Session",
      summary: "metadata",
      path: sourcePath,
      startedAt: "2026-08-30T01:00:00.000Z",
      updatedAt: "2026-08-30T01:10:00.000Z",
      artifacts: [],
      status: "active",
      transcriptCapture: {
        canonicalPath: sourcePath,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.byteLength,
        coverage: { startByte: 0, endByte: bytes.byteLength }
      }
    }],
    sources: [sourcePath],
    warnings: []
  };
}

function settings(): CockpitSettings {
  return {
    dailyNoteFolder: "Agent Cockpit",
    llmEndpoint: "http://127.0.0.1:11434/v1/chat/completions",
    llmModel: "local-model",
    sessionScanRoots: [],
    enabledSessionProviders: ["codex"],
    sessionSummaryMode: "metadata",
    runtimeNodePath: "node",
    codexCliPath: "codex",
    claudeCliPath: "claude",
    cursorCliPath: "agent",
    dailyReviewScheduleEnabled: false,
    dailyReviewScheduleTime: "18:30"
  };
}
