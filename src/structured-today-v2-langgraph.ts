import type { BaseCheckpointSaver } from "@langchain/langgraph";
import {
  Command,
  END,
  ReducedValue,
  Send,
  START,
  StateGraph,
  StateSchema,
  interrupt
} from "@langchain/langgraph";
import { z } from "zod";
import { StructuredTodayModelInvocationSchema } from "./structured-today-contracts";
import type { AdmittedProvenanceMessageV1 } from "./structured-today-evidence-spans";
import { TodayWorklineIndexV2Schema, type TodayWorklineIndexV2 } from "./structured-today-v2-contracts";
import {
  buildStructuredTodayIndexV2,
  type BuildStructuredTodayIndexV2Input
} from "./structured-today-v2-artifacts";
import { resolveDigestFindingCandidates } from "./structured-today-v2-findings";
import {
  DigestFindingCandidateSetSchema,
  ResolvedDigestFindingsSchema,
  StructuredTodayIndexWorkflowInputV2Schema,
  StructuredTodayV2SessionInputSchema,
  type StructuredTodayIndexWorkflowInputV2
} from "./structured-today-v2-workflow";
import {
  SynthesizeWorklineIndexV2CandidateSchema,
  type StructuredTodayV2IndexModelFunctions
} from "./structured-today-v2-model-functions";

export const STRUCTURED_TODAY_V2_DIGEST_PAYLOAD_CHAR_LIMIT = 400_000;

const NonEmptyString = z.string().trim().min(1);

const DigestCandidateResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("success"),
    sessionId: NonEmptyString,
    candidate: DigestFindingCandidateSetSchema,
    invocation: StructuredTodayModelInvocationSchema
  }).strict(),
  z.object({
    status: z.literal("excluded"),
    sessionId: NonEmptyString,
    reason: NonEmptyString
  }).strict(),
  z.object({
    status: z.literal("failed"),
    sessionId: NonEmptyString,
    reason: NonEmptyString
  }).strict()
]);

const ResolvedSessionResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("success"),
    sessionId: NonEmptyString,
    resolved: ResolvedDigestFindingsSchema,
    invocation: StructuredTodayModelInvocationSchema
  }).strict(),
  z.object({
    status: z.literal("excluded"),
    sessionId: NonEmptyString,
    reason: NonEmptyString
  }).strict(),
  z.object({
    status: z.literal("failed"),
    sessionId: NonEmptyString,
    reason: NonEmptyString
  }).strict()
]);

const SynthesisEnvelopeSchema = z.object({
  synthesis: SynthesizeWorklineIndexV2CandidateSchema,
  invocation: StructuredTodayModelInvocationSchema.optional()
}).strict();

const SessionOutcomeSchema = z.object({
  sessionId: NonEmptyString,
  status: z.enum(["resolved", "excluded", "failed"]),
  findingCount: z.number().int().nonnegative(),
  unresolvedCandidateCount: z.number().int().nonnegative(),
  reason: NonEmptyString.optional()
}).strict();

export const StructuredTodayV2IndexGraphOutputSchema = z.object({
  artifact: TodayWorklineIndexV2Schema,
  publishable: z.boolean(),
  issues: z.array(NonEmptyString),
  sessionOutcomes: z.array(SessionOutcomeSchema)
}).strict();

export type DigestCandidateResultV2 = z.infer<typeof DigestCandidateResultSchema>;
export type ResolvedSessionResultV2 = z.infer<typeof ResolvedSessionResultSchema>;
export type StructuredTodayV2IndexGraphOutput = z.infer<typeof StructuredTodayV2IndexGraphOutputSchema>;

const DigestCandidateResults = new ReducedValue(
  z.array(DigestCandidateResultSchema).default(() => []),
  {
    inputSchema: DigestCandidateResultSchema,
    reducer: (current, next) => [...current, next]
  }
);

const ResolvedSessionResults = new ReducedValue(
  z.array(ResolvedSessionResultSchema).default(() => []),
  {
    inputSchema: ResolvedSessionResultSchema,
    reducer: (current, next) => [...current, next]
  }
);

const IndexV2State = new StateSchema({
  input: StructuredTodayIndexWorkflowInputV2Schema,
  currentSessionId: NonEmptyString.optional(),
  currentCandidate: DigestCandidateResultSchema.optional(),
  candidateResults: DigestCandidateResults,
  resolvedResults: ResolvedSessionResults,
  synthesisEnvelope: SynthesisEnvelopeSchema.optional(),
  output: StructuredTodayV2IndexGraphOutputSchema.optional()
});

export type StructuredTodayIndexV2BuildInput = BuildStructuredTodayIndexV2Input;

export interface StructuredTodayV2IndexGraphDependencies {
  models: StructuredTodayV2IndexModelFunctions;
  resolveFindings?: typeof resolveDigestFindingCandidates;
  buildIndex?: (input: StructuredTodayIndexV2BuildInput) => TodayWorklineIndexV2;
}

export function createStructuredTodayV2LangGraphIndex(input: {
  dependencies: StructuredTodayV2IndexGraphDependencies;
  checkpointer?: BaseCheckpointSaver;
}) {
  const dependencies = input.dependencies;
  const resolveFindings = dependencies.resolveFindings ?? resolveDigestFindingCandidates;
  const buildIndex = dependencies.buildIndex ?? buildStructuredTodayIndexV2;
  const localItems = new Map<string, z.infer<typeof StructuredTodayV2SessionInputSchema>>();
  const itemStore = workflowItemStore(input.checkpointer);

  const dispatchDigests = async () => ({});
  const routeDigests = (state: typeof IndexV2State.State) => state.input.sessions.map((session) => new Send(
    "digest-finding-candidates",
    { currentSessionId: session.session.sessionId }
  ));
  const digestFindingCandidates: typeof IndexV2State.Node = async (state, config) => {
    const sessionId = state.currentSessionId;
    if (!sessionId) throw new Error("Structured Today V2 digest did not receive a Session reference.");
    const threadId = typeof config.configurable?.thread_id === "string" ? config.configurable.thread_id : "";
    const stored = localItems.get(sessionId) ?? (threadId ? await itemStore?.getWorkflowItem(threadId, sessionId) : undefined);
    const item = StructuredTodayV2SessionInputSchema.parse(stored);
    if (item.preDisposition) {
      return {
        candidateResults: {
          status: item.preDisposition.kind,
          sessionId: item.session.sessionId,
          reason: item.preDisposition.reason
        }
      };
    }
    const provenance = item.provenanceSession;
    if (!provenance || provenance.admittedMessages.length === 0) {
      return {
        candidateResults: {
          status: "failed",
          sessionId: item.session.sessionId,
          reason: "Session has no admitted provenance messages."
        }
      };
    }
    const admittedMessagesJson = digestModelPayload(provenance.admittedMessages);
    if (admittedMessagesJson.length > STRUCTURED_TODAY_V2_DIGEST_PAYLOAD_CHAR_LIMIT) {
      return {
        candidateResults: {
          status: "failed",
          sessionId: item.session.sessionId,
          reason: `Digest model payload exceeds ${STRUCTURED_TODAY_V2_DIGEST_PAYLOAD_CHAR_LIMIT} characters.`
        }
      };
    }
    try {
      const result = await dependencies.models.digestSessionFindingsV2({
        logicalDate: item.logicalDate,
        editorialContract: item.editorialContract,
        admittedMessagesJson,
        expectedSessionId: item.session.sessionId,
        allowedMessageKeys: nonEmptyTuple(provenance.admittedMessages.map((message) => message.locator.messageKey),
          "V2 digest requires admitted message keys")
      });
      return {
        candidateResults: {
          status: "success",
          sessionId: item.session.sessionId,
          candidate: result.output,
          invocation: result.invocation
        }
      };
    } catch (error) {
      return {
        candidateResults: {
          status: "failed",
          sessionId: item.session.sessionId,
          reason: boundedError(error)
        }
      };
    }
  };

  const dispatchResolvers = async () => ({});
  const routeResolvers = (state: typeof IndexV2State.State) => state.candidateResults.map((candidate) =>
    new Send("resolve-findings", { currentCandidate: candidate })
  );
  const resolveFindingsNode: typeof IndexV2State.Node = async (state, config) => {
    const result = state.currentCandidate;
    if (!result) throw new Error("Structured Today V2 resolver did not receive a candidate result.");
    if (result.status !== "success") return { resolvedResults: result };
    const threadId = typeof config.configurable?.thread_id === "string" ? config.configurable.thread_id : "";
    const item = localItems.get(result.sessionId) ?? (threadId ? await itemStore?.getWorkflowItem(threadId, result.sessionId) : undefined);
    const provenance = StructuredTodayV2SessionInputSchema.parse(item).provenanceSession;
    if (!provenance) {
      return {
        resolvedResults: {
          status: "failed",
          sessionId: result.sessionId,
          reason: "Resolved Session lost its frozen provenance input."
        }
      };
    }
    const resolved = await resolveFindings(result.candidate, provenance);
    return {
      resolvedResults: {
        status: "success",
        sessionId: result.sessionId,
        resolved,
        invocation: result.invocation
      }
    };
  };

  const synthesizeV2: typeof IndexV2State.Node = async (state) => {
    if (state.input.pauseBeforeSynthesis) {
      interrupt<{ reason: "structured-today-v2-before-synthesis" }, { continue: true }>({
        reason: "structured-today-v2-before-synthesis"
      });
    }
    const successful = orderedResolvedResults(state.input, state.resolvedResults).filter(isResolvedSuccess);
    const findings = successful.flatMap((result) => result.resolved.findings);
    const successfulSessionIds = successful.map((result) => result.sessionId);
    if (successfulSessionIds.length === 0 || findings.length === 0) {
      return {
        synthesisEnvelope: {
          synthesis: {
            worklines: [],
            assignments: [],
            unresolvedSessionIds: successfulSessionIds
          }
        }
      };
    }
    const result = await dependencies.models.synthesizeWorklineIndexV2({
      logicalDate: state.input.logicalDate,
      editorialContract: state.input.editorialContract,
      evidenceManifestJson: JSON.stringify(synthesisMetadata(state.input, successful)),
      resolvedDigestsJson: JSON.stringify(successful.map((item) => ({
        sessionId: item.sessionId,
        findingIds: item.resolved.findings.map((finding) => finding.findingId),
        unresolvedCandidateCount: item.resolved.unresolvedCandidates.length,
        unresolvedReasons: [...new Set(item.resolved.unresolvedCandidates.map((candidate) => candidate.reason))]
      }))),
      verifiedFindingsJson: JSON.stringify(findings.map((finding) => ({
        findingId: finding.findingId,
        text: finding.text,
        claimKind: finding.claimKind,
        relation: finding.relation
      }))),
      allowedSessionIds: nonEmptyTuple(successfulSessionIds, "V2 synthesis requires resolved Session IDs"),
      allowedFindingIds: nonEmptyTuple(findings.map((finding) => finding.findingId),
        "V2 synthesis requires verified finding IDs")
    });
    return { synthesisEnvelope: { synthesis: result.output, invocation: result.invocation } };
  };

  const validateAndBuild: typeof IndexV2State.Node = async (state) => {
    if (!state.synthesisEnvelope) throw new Error("Structured Today V2 synthesis produced no envelope.");
    const orderedResults = orderedResolvedResults(state.input, state.resolvedResults);
    const successful = orderedResults.filter(isResolvedSuccess);
    const candidateBySession = new Map(state.candidateResults.map((result) => [result.sessionId, result]));
    const invocations = [
      ...state.input.sessions.flatMap((item) => {
        const result = candidateBySession.get(item.session.sessionId);
        return result?.status === "success" ? [result.invocation] : [];
      }),
      ...(state.synthesisEnvelope.invocation ? [state.synthesisEnvelope.invocation] : [])
    ];
    const artifact = buildIndex({
      initial: state.input,
      resolvedDigests: successful.map((result) => result.resolved),
      executionDispositions: orderedResults.flatMap((result) => {
        if (result.status === "success") return [];
        const source = state.input.sessions.find((item) => item.session.sessionId === result.sessionId);
        return source?.preDisposition
          ? []
          : [{ sessionId: result.sessionId, kind: result.status, reason: result.reason }];
      }),
      synthesis: state.synthesisEnvelope.synthesis,
      invocations,
      runtimeRunId: state.input.workflowRunId
    });
    const issues = [
      artifact.coverage.complete ? "" : "Structured Today V2 index coverage is incomplete.",
      artifact.worklines.length > 0 ? "" : "Structured Today V2 index produced no worklines."
    ].filter(Boolean);
    return {
      output: StructuredTodayV2IndexGraphOutputSchema.parse({
        artifact,
        publishable: issues.length === 0,
        issues,
        sessionOutcomes: sessionOutcomes(orderedResults)
      })
    };
  };

  const graph = new StateGraph(IndexV2State)
    .addNode("dispatch-digests", dispatchDigests)
    .addNode("digest-finding-candidates", digestFindingCandidates)
    .addNode("dispatch-resolvers", dispatchResolvers)
    .addNode("resolve-findings", resolveFindingsNode)
    .addNode("synthesize-index-v2", synthesizeV2)
    .addNode("validate-index-v2", validateAndBuild)
    .addEdge(START, "dispatch-digests")
    .addConditionalEdges("dispatch-digests", routeDigests, ["digest-finding-candidates"])
    .addEdge("digest-finding-candidates", "dispatch-resolvers")
    .addConditionalEdges("dispatch-resolvers", routeResolvers, ["resolve-findings"])
    .addEdge("resolve-findings", "synthesize-index-v2")
    .addEdge("synthesize-index-v2", "validate-index-v2")
    .addEdge("validate-index-v2", END)
    .compile({
      ...(input.checkpointer ? { checkpointer: input.checkpointer } : {}),
      name: "structured-today-index-v2",
      description: "Evidence-first V2 index workflow with checkpointed model candidates and deterministic host resolution."
    });
  return Object.assign(graph, {
    async registerWorkflowInput(workflowInput: StructuredTodayIndexWorkflowInputV2, threadId: string): Promise<void> {
      for (const item of workflowInput.sessions) {
        localItems.set(item.session.sessionId, item);
        // SQLite stores the complete frozen input once; recovery resolves this Session from it.
      }
    }
  });
}

export async function invokeStructuredTodayV2LangGraphIndex(input: {
  graph: ReturnType<typeof createStructuredTodayV2LangGraphIndex>;
  workflowInput: StructuredTodayIndexWorkflowInputV2;
  threadId: string;
  digestConcurrency: number;
}): Promise<StructuredTodayV2IndexGraphOutput | { interrupted: true }> {
  await input.graph.registerWorkflowInput(input.workflowInput, input.threadId);
  const result = await input.graph.invoke(
    { input: input.workflowInput },
    {
      configurable: { thread_id: input.threadId },
      maxConcurrency: positiveConcurrency(input.digestConcurrency)
    }
  );
  if ("__interrupt__" in result) return { interrupted: true };
  if (!result.output) throw new Error("Structured Today V2 index run completed without output.");
  return StructuredTodayV2IndexGraphOutputSchema.parse(result.output);
}

interface WorkflowItemStore {
  putWorkflowItem(threadId: string, itemId: string, value: unknown): Promise<void>;
  getWorkflowItem(threadId: string, itemId: string): Promise<unknown | undefined>;
}

function workflowItemStore(checkpointer: BaseCheckpointSaver | undefined): WorkflowItemStore | undefined {
  if (!checkpointer) return undefined;
  const candidate = checkpointer as BaseCheckpointSaver & Partial<WorkflowItemStore>;
  return typeof candidate.putWorkflowItem === "function" && typeof candidate.getWorkflowItem === "function"
    ? candidate as BaseCheckpointSaver & WorkflowItemStore
    : undefined;
}

export async function resumeStructuredTodayV2LangGraphIndex(input: {
  graph: ReturnType<typeof createStructuredTodayV2LangGraphIndex>;
  threadId: string;
  digestConcurrency: number;
}): Promise<StructuredTodayV2IndexGraphOutput> {
  const result = await input.graph.invoke(
    new Command({ resume: { continue: true } }),
    {
      configurable: { thread_id: input.threadId },
      maxConcurrency: positiveConcurrency(input.digestConcurrency)
    }
  );
  if (!result.output) throw new Error("Structured Today V2 resumed run completed without output.");
  return StructuredTodayV2IndexGraphOutputSchema.parse(result.output);
}

export async function retryStructuredTodayV2LangGraphIndex(input: {
  graph: ReturnType<typeof createStructuredTodayV2LangGraphIndex>;
  threadId: string;
  digestConcurrency: number;
}): Promise<StructuredTodayV2IndexGraphOutput> {
  const result = await input.graph.invoke(
    null as never,
    {
      configurable: { thread_id: input.threadId },
      maxConcurrency: positiveConcurrency(input.digestConcurrency)
    }
  );
  if (!result.output) throw new Error("Structured Today V2 retried run completed without output.");
  return StructuredTodayV2IndexGraphOutputSchema.parse(result.output);
}

function digestModelPayload(messages: AdmittedProvenanceMessageV1[]): string {
  return JSON.stringify(messages.map((message) => ({
    messageKey: message.locator.messageKey,
    role: message.locator.role,
    authorKind: message.locator.authorKind,
    content: message.content
  })));
}

function synthesisMetadata(
  input: StructuredTodayIndexWorkflowInputV2,
  successful: Array<Extract<ResolvedSessionResultV2, { status: "success" }>>
) {
  const successfulIds = new Set(successful.map((item) => item.sessionId));
  return {
    evidenceManifestId: input.evidenceManifestId,
    logicalDate: input.logicalDate,
    sessions: input.sessions.flatMap((item) => successfulIds.has(item.session.sessionId)
      ? [{
          sessionId: item.session.sessionId,
          title: item.session.title,
          startedAt: item.session.startedAt,
          endedAt: item.session.endedAt ?? null
        }]
      : [])
  };
}

function sessionOutcomes(results: ResolvedSessionResultV2[]) {
  return results.map((result) => result.status === "success"
    ? {
        sessionId: result.sessionId,
        status: "resolved" as const,
        findingCount: result.resolved.findings.length,
        unresolvedCandidateCount: result.resolved.unresolvedCandidates.length
      }
    : {
        sessionId: result.sessionId,
        status: result.status,
        findingCount: 0,
        unresolvedCandidateCount: 0,
        reason: result.reason
      });
}

function orderedResolvedResults(
  input: StructuredTodayIndexWorkflowInputV2,
  results: ResolvedSessionResultV2[]
): ResolvedSessionResultV2[] {
  const bySession = new Map(results.map((result) => [result.sessionId, result]));
  return input.sessions.flatMap((item) => {
    const result = bySession.get(item.session.sessionId);
    return result ? [result] : [];
  });
}

function isResolvedSuccess(
  value: ResolvedSessionResultV2
): value is Extract<ResolvedSessionResultV2, { status: "success" }> {
  return value.status === "success";
}

function nonEmptyTuple(values: string[], label: string): [string, ...string[]] {
  const [first, ...rest] = [...new Set(values)];
  if (!first) throw new Error(label);
  return [first, ...rest];
}

function positiveConcurrency(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 32) {
    throw new Error("digestConcurrency must be an integer from 1 to 32.");
  }
  return value;
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/gu, " ").trim().slice(0, 800) || "Unknown V2 workflow failure.";
}
