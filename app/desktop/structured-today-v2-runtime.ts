import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { beginCheckpointRun, cleanupPublishedCheckpoint } from "../../src/langgraph-node-sqlite-checkpointer";
import type { CliRunner } from "../../src/agent-summary";
import { sha256Text } from "../../src/structured-today-contracts";
import { loadStructuredTodayEditorialContract } from "../../src/structured-today-model-functions";
import { buildStructuredTodayIndexV2 } from "../../src/structured-today-v2-artifacts";
import type { TodayWorklineIndexV2 } from "../../src/structured-today-v2-contracts";
import {
  createStructuredTodayV2LangGraphIndex,
  invokeStructuredTodayV2LangGraphIndex,
  retryStructuredTodayV2LangGraphIndex,
  type StructuredTodayV2IndexGraphDependencies
} from "../../src/structured-today-v2-langgraph";
import { createStructuredTodayV2IndexModelFunctions } from "../../src/structured-today-v2-model-functions";
import {
  STRUCTURED_TODAY_V2_WORKFLOW_VERSION
} from "../../src/structured-today-v2-workflow";
import type { AgentWorkSnapshot, CockpitSettings } from "../../src/types";
import {
  appendStructuredTodayIndexV2Candidate,
  latestStructuredTodayIndexV2Candidate,
  nextStructuredTodayIndexV2CandidateRevision,
  structuredTodayIndexArtifactId
} from "./traceink-asset-store";
import type { TraceinkAssetRepository } from "./traceink-asset-repository";
import {
  createStructuredTodayCliCaller,
  freezeStructuredTodayProviderPlan
} from "./structured-today-cli-caller";
import { buildStructuredTodayIndexInputV2 } from "./structured-today-input";

/** Builds and persists an unmerged V2 candidate without changing active Today. */
export async function runStructuredTodayIndexV2CandidatePreparation(input: {
  logicalDate: string;
  snapshot: AgentWorkSnapshot;
  settings: CockpitSettings;
  repository: Pick<TraceinkAssetRepository, "load" | "mutate">;
  checkpointer: BaseCheckpointSaver;
  runner: CliRunner;
  digestConcurrency?: number;
  buildIndex?: StructuredTodayV2IndexGraphDependencies["buildIndex"];
}): Promise<{ artifact: TodayWorklineIndexV2; publishable: boolean; issues: string[] }> {
  const starting = await input.repository.load();
  const revision = nextStructuredTodayIndexV2CandidateRevision(starting, input.logicalDate);
  const artifactId = structuredTodayIndexArtifactId(input.logicalDate);
  const editorialContract = await loadStructuredTodayEditorialContract();
  const plan = freezeStructuredTodayProviderPlan(
    input.settings,
    input.snapshot.sessions.flatMap((session) =>
      session.platform === "codex" || session.platform === "claude" || session.platform === "copilot"
        ? [{ sessionId: session.id, provider: session.platform }]
        : []
    )
  );
  const workflowRunId = `structured-today-index-v2-${sha256Text(JSON.stringify({
    workflowVersion: STRUCTURED_TODAY_V2_WORKFLOW_VERSION,
    editorialContract: editorialContract.ref,
    providerPlan: plan,
    logicalDate: input.logicalDate,
    revision,
    sessions: input.snapshot.sessions.map((session) => ({
      provider: session.platform,
      sessionId: session.id,
      path: session.transcriptCapture?.canonicalPath ?? session.path,
      hash: session.transcriptCapture?.sha256 ?? null,
      bytes: session.transcriptCapture?.byteLength ?? null
    })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  })).slice(0, 32)}`;
  const workflowInput = await buildStructuredTodayIndexInputV2({
    logicalDate: input.logicalDate,
    snapshot: input.snapshot,
    editorialContract,
    artifactId,
    revision,
    workflowRunId
  });
  const models = createStructuredTodayV2IndexModelFunctions(createStructuredTodayCliCaller({
    settings: input.settings,
    plan,
    runner: input.runner
  }));
  const graph = createStructuredTodayV2LangGraphIndex({
    dependencies: {
      models,
      buildIndex(buildInput) {
        return input.buildIndex?.(buildInput) ?? buildStructuredTodayIndexV2(buildInput);
      }
    },
    checkpointer: input.checkpointer
  });
  const finishCheckpointRun = await beginCheckpointRun(input.checkpointer, workflowRunId);
  try {
  const existingCheckpoint = await input.checkpointer.getTuple({ configurable: { thread_id: workflowRunId } });
  let output: Awaited<ReturnType<typeof invokeStructuredTodayV2LangGraphIndex>>;
  try {
    output = existingCheckpoint
      ? await retryStructuredTodayV2LangGraphIndex({
          graph,
          threadId: workflowRunId,
          digestConcurrency: input.digestConcurrency ?? 3
        })
      : await invokeStructuredTodayV2LangGraphIndex({
          graph,
          workflowInput,
          threadId: workflowRunId,
          digestConcurrency: input.digestConcurrency ?? 3
        });
  } catch (error) {
    if (await isTerminalSemanticCheckpoint(input.checkpointer, workflowRunId, "synthesisEnvelope")) {
      await input.checkpointer.deleteThread(workflowRunId);
    }
    throw error;
  }
  if ("interrupted" in output) throw new Error("Structured Today V2 candidate suspended unexpectedly.");
  const document = await input.repository.mutate((current) =>
    appendStructuredTodayIndexV2Candidate(current, output.artifact)
  );
  const artifact = latestStructuredTodayIndexV2Candidate(document, input.logicalDate);
  if (!artifact || artifact.workflowRunId !== workflowRunId || artifact.contentHash !== output.artifact.contentHash) {
    throw new Error("Structured Today V2 candidate was saved but could not be reopened exactly.");
  }
  await cleanupPublishedCheckpoint(input.checkpointer, workflowRunId);
  return { artifact, publishable: output.publishable, issues: output.issues };
  } finally {
    await finishCheckpointRun();
  }
}

async function isTerminalSemanticCheckpoint(
  checkpointer: BaseCheckpointSaver,
  threadId: string,
  completedEnvelope: string
): Promise<boolean> {
  const tuple = await checkpointer.getTuple({ configurable: { thread_id: threadId } });
  const values = tuple?.checkpoint.channel_values as Record<string, unknown> | undefined;
  return Boolean(values && values[completedEnvelope] && !values.output);
}
