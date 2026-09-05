import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { beginCheckpointRun, cleanupPublishedCheckpoint } from "../../src/langgraph-node-sqlite-checkpointer";
import type { CliRunner } from "../../src/agent-summary";
import { sha256Text } from "../../src/structured-today-contracts";
import { loadStructuredTodayEditorialContract } from "../../src/structured-today-model-functions";
import type { TodayWorklineDossierV2, TodayWorklineIndexV2 } from "../../src/structured-today-v2-contracts";
import {
  createStructuredTodayV2DossierLangGraph,
  invokeStructuredTodayV2DossierLangGraph,
  retryStructuredTodayV2DossierLangGraph,
  type StructuredTodayV2DossierGraphDependencies
} from "../../src/structured-today-v2-dossier-langgraph";
import { createStructuredTodayV2DossierModelFunctions } from "../../src/structured-today-v2-dossier-model-functions";
import type { CockpitSettings } from "../../src/types";
import {
  appendStructuredTodayDossierV2Candidate,
  latestStructuredTodayDossierV2Candidate,
  nextStructuredTodayDossierV2CandidateRevision,
  structuredTodayDossierArtifactId
} from "./traceink-asset-store";
import type { TraceinkAssetRepository } from "./traceink-asset-repository";
import { createStructuredTodayCliCaller, freezeStructuredTodayProviderPlan } from "./structured-today-cli-caller";

/** Builds one unmerged dossier candidate from an exact stored V2 index candidate. */
export async function runStructuredTodayDossierV2CandidatePreparation(input: {
  sourceIndex: { artifactId: string; revision: number; contentHash: string };
  worklineId: string;
  settings: CockpitSettings;
  repository: Pick<TraceinkAssetRepository, "load" | "mutate">;
  checkpointer: BaseCheckpointSaver;
  runner: CliRunner;
  buildDossier?: StructuredTodayV2DossierGraphDependencies["buildDossier"];
}): Promise<TodayWorklineDossierV2> {
  const starting = await input.repository.load();
  const index = exactIndexCandidate(starting.structuredIndexV2Candidates ?? [], input.sourceIndex);
  const existing = latestStructuredTodayDossierV2Candidate(starting, input.sourceIndex, input.worklineId);
  if (existing) return existing;
  if (!index.worklines.some((workline) => workline.worklineId === input.worklineId)) {
    throw new Error("选择的工作线不属于指定 V2 index candidate。");
  }
  const revision = nextStructuredTodayDossierV2CandidateRevision(starting, input.sourceIndex, input.worklineId);
  const artifactId = structuredTodayDossierArtifactId(input.sourceIndex, input.worklineId);
  const editorialContract = await loadStructuredTodayEditorialContract();
  const plan = freezeStructuredTodayProviderPlan(
    input.settings,
    index.sessions.map((session) => ({ sessionId: session.sessionId, provider: session.provider }))
  );
  const workflowRunId = `structured-today-dossier-v2-${sha256Text(JSON.stringify({
    sourceIndex: input.sourceIndex,
    worklineId: input.worklineId,
    revision,
    editorialContract: editorialContract.ref,
    providerPlan: plan
  })).slice(0, 32)}`;
  const models = createStructuredTodayV2DossierModelFunctions(createStructuredTodayCliCaller({
    settings: input.settings,
    plan,
    runner: input.runner
  }));
  const graph = createStructuredTodayV2DossierLangGraph({
    dependencies: {
      models,
      ...(input.buildDossier ? { buildDossier: input.buildDossier } : {})
    },
    checkpointer: input.checkpointer
  });
  const finishCheckpointRun = await beginCheckpointRun(input.checkpointer, workflowRunId);
  try {
  const existingCheckpoint = await input.checkpointer.getTuple({ configurable: { thread_id: workflowRunId } });
  let output: Awaited<ReturnType<typeof invokeStructuredTodayV2DossierLangGraph>>;
  try {
    output = existingCheckpoint
      ? await retryStructuredTodayV2DossierLangGraph({ graph, threadId: workflowRunId })
      : await invokeStructuredTodayV2DossierLangGraph({
          graph,
          workflowInput: {
            logicalDate: index.logicalDate,
            workflowRunId,
            artifactId,
            revision,
            editorialContract,
            sourceIndex: index,
            selectedWorklineId: input.worklineId
          },
          threadId: workflowRunId
        });
  } catch (error) {
    if (await isTerminalSemanticCheckpoint(input.checkpointer, workflowRunId, "composeEnvelope")) {
      await input.checkpointer.deleteThread(workflowRunId);
    }
    throw error;
  }
  const document = await input.repository.mutate((current) =>
    appendStructuredTodayDossierV2Candidate(current, output.artifact)
  );
  const dossier = latestStructuredTodayDossierV2Candidate(document, input.sourceIndex, input.worklineId);
  if (!dossier || dossier.workflowRunId !== workflowRunId || dossier.contentHash !== output.artifact.contentHash) {
    throw new Error("Structured Today V2 dossier candidate was saved but could not be reopened exactly.");
  }
  await cleanupPublishedCheckpoint(input.checkpointer, workflowRunId);
  return dossier;
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

function exactIndexCandidate(
  candidates: TodayWorklineIndexV2[],
  reference: { artifactId: string; revision: number; contentHash: string }
): TodayWorklineIndexV2 {
  const matches = candidates.filter((candidate) =>
    candidate.artifactId === reference.artifactId &&
    candidate.revision === reference.revision &&
    candidate.contentHash === reference.contentHash
  );
  if (matches.length !== 1) throw new Error("指定 V2 index candidate 无法精确解析。");
  return matches[0]!;
}
