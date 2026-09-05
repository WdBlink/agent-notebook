import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import {
  EditorialContractBindingSchema,
  StructuredTodayModelInvocationSchema
} from "./structured-today-contracts";
import { AtomicFindingSchema } from "./structured-today-evidence-spans";
import {
  TodayWorklineDossierV2Schema,
  TodayWorklineIndexV2Schema,
  TodayWorklineV2Schema,
  type TodayWorklineDossierV2
} from "./structured-today-v2-contracts";
import {
  type MaterialStatementCandidateV2
} from "./structured-today-v2-model-functions";
import {
  DossierAnalysisCandidateV2Schema,
  DossierComposeCandidateV2Schema,
  DossierCritiqueCandidateV2Schema,
  type DossierAnalysisCandidateV2,
  type DossierComposeCandidateV2,
  type DossierCritiqueCandidateV2,
  type StructuredTodayV2DossierModelFunctions
} from "./structured-today-v2-dossier-model-functions";
import {
  buildStructuredTodayDossierV2,
  type BuildStructuredTodayDossierV2Input
} from "./structured-today-v2-dossier-artifacts";

export {
  DossierAnalysisCandidateV2Schema,
  DossierComposeCandidateV2Schema,
  DossierCritiqueCandidateV2Schema
} from "./structured-today-v2-dossier-model-functions";
export type {
  DossierAnalysisCandidateV2,
  DossierComposeCandidateV2,
  DossierCritiqueCandidateV2,
  StructuredTodayV2DossierModelFunctions
} from "./structured-today-v2-dossier-model-functions";

const NonEmptyString = z.string().trim().min(1);
const LogicalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

export const StructuredTodayDossierWorkflowInputV2Schema = z.object({
  logicalDate: LogicalDate,
  workflowRunId: NonEmptyString,
  artifactId: NonEmptyString,
  revision: z.number().int().positive(),
  editorialContract: EditorialContractBindingSchema,
  sourceIndex: TodayWorklineIndexV2Schema,
  selectedWorklineId: NonEmptyString
}).strict().superRefine((value, context) => {
  if (value.sourceIndex.logicalDate !== value.logicalDate) {
    context.addIssue({ code: "custom", message: "Dossier logicalDate does not match source index.", path: ["logicalDate"] });
  }
  if (!value.sourceIndex.worklines.some((workline) => workline.worklineId === value.selectedWorklineId)) {
    context.addIssue({ code: "custom", message: "Selected workline is absent from the exact source index.", path: ["selectedWorklineId"] });
  }
});

const GatheredFindingClosureSchema = z.object({
  workline: TodayWorklineV2Schema,
  findingIds: z.array(NonEmptyString).min(1),
  findings: z.array(AtomicFindingSchema).min(1)
}).strict();

const AnalysisEnvelopeSchema = z.object({
  candidate: DossierAnalysisCandidateV2Schema,
  invocation: StructuredTodayModelInvocationSchema
}).strict();

const CritiqueEnvelopeSchema = z.object({
  candidate: DossierCritiqueCandidateV2Schema,
  invocation: StructuredTodayModelInvocationSchema
}).strict();

const ComposeEnvelopeSchema = z.object({
  candidate: DossierComposeCandidateV2Schema,
  invocation: StructuredTodayModelInvocationSchema
}).strict();

export const StructuredTodayV2DossierGraphOutputSchema = z.object({
  artifact: TodayWorklineDossierV2Schema,
  publishable: z.literal(true),
  issues: z.array(NonEmptyString)
}).strict();

export type StructuredTodayDossierWorkflowInputV2 = z.infer<typeof StructuredTodayDossierWorkflowInputV2Schema>;
export type StructuredTodayV2DossierGraphOutput = z.infer<typeof StructuredTodayV2DossierGraphOutputSchema>;

const DossierV2State = new StateSchema({
  input: StructuredTodayDossierWorkflowInputV2Schema,
  gathered: GatheredFindingClosureSchema.optional(),
  analysisEnvelope: AnalysisEnvelopeSchema.optional(),
  critiqueEnvelope: CritiqueEnvelopeSchema.optional(),
  composeEnvelope: ComposeEnvelopeSchema.optional(),
  output: StructuredTodayV2DossierGraphOutputSchema.optional()
});

export interface StructuredTodayV2DossierGraphDependencies {
  models: StructuredTodayV2DossierModelFunctions;
  buildDossier?: (input: BuildStructuredTodayDossierV2Input) => TodayWorklineDossierV2;
}

export function createStructuredTodayV2DossierLangGraph(input: {
  dependencies: StructuredTodayV2DossierGraphDependencies;
  checkpointer?: BaseCheckpointSaver;
}) {
  const dependencies = input.dependencies;
  const buildDossier = dependencies.buildDossier ?? buildStructuredTodayDossierV2;

  const gather: typeof DossierV2State.Node = async (state) => {
    const workline = state.input.sourceIndex.worklines.find((item) =>
      item.worklineId === state.input.selectedWorklineId
    );
    if (!workline) throw new Error("Selected V2 workline does not belong to the source index.");
    const findingIds = selectedWorklineFindingIds(workline);
    const findingById = new Map(state.input.sourceIndex.findings.map((finding) => [finding.findingId, finding]));
    const findings = findingIds.map((findingId) => {
      const finding = findingById.get(findingId);
      if (!finding) throw new Error(`Selected V2 workline references unknown finding ${findingId}.`);
      return finding;
    });
    return { gathered: { workline, findingIds, findings } };
  };

  const analyze: typeof DossierV2State.Node = async (state) => {
    if (!state.gathered) throw new Error("V2 dossier gather produced no finding closure.");
    const result = await dependencies.models.analyzeWorklineDossierV2({
      editorialContract: state.input.editorialContract,
      selectedWorkline: state.gathered.workline,
      verifiedFindings: state.gathered.findings,
      allowedFindingIds: nonEmptyTuple(state.gathered.findingIds)
    });
    assertAnalysisFindingClosure(result.output, state.gathered.findingIds, "analysis");
    return { analysisEnvelope: { candidate: result.output, invocation: result.invocation } };
  };

  const critique: typeof DossierV2State.Node = async (state) => {
    if (!state.gathered || !state.analysisEnvelope) throw new Error("V2 dossier analysis state is incomplete.");
    const result = await dependencies.models.critiqueWorklineDossierV2({
      editorialContract: state.input.editorialContract,
      selectedWorkline: state.gathered.workline,
      verifiedFindings: state.gathered.findings,
      analysis: state.analysisEnvelope.candidate,
      allowedFindingIds: nonEmptyTuple(state.gathered.findingIds)
    });
    assertCritiqueFindingClosure(result.output, state.gathered.findingIds);
    return { critiqueEnvelope: { candidate: result.output, invocation: result.invocation } };
  };

  const compose: typeof DossierV2State.Node = async (state) => {
    if (!state.gathered || !state.analysisEnvelope || !state.critiqueEnvelope) {
      throw new Error("V2 dossier critique state is incomplete.");
    }
    const result = await dependencies.models.composeWorklineDossierV2({
      editorialContract: state.input.editorialContract,
      selectedWorkline: state.gathered.workline,
      verifiedFindings: state.gathered.findings,
      analysis: state.analysisEnvelope.candidate,
      critique: state.critiqueEnvelope.candidate,
      allowedFindingIds: nonEmptyTuple(state.gathered.findingIds)
    });
    assertComposeFindingClosure(result.output, state.gathered.findingIds);
    return { composeEnvelope: { candidate: result.output, invocation: result.invocation } };
  };

  const build: typeof DossierV2State.Node = async (state) => {
    if (!state.analysisEnvelope || !state.critiqueEnvelope || !state.composeEnvelope) {
      throw new Error("V2 dossier compose state is incomplete.");
    }
    const artifact = buildDossier({
      sourceIndex: state.input.sourceIndex,
      selectedWorklineId: state.input.selectedWorklineId,
      candidate: state.composeEnvelope.candidate,
      invocations: [
        state.analysisEnvelope.invocation,
        state.critiqueEnvelope.invocation,
        state.composeEnvelope.invocation
      ],
      artifactId: state.input.artifactId,
      revision: state.input.revision,
      workflowRunId: state.input.workflowRunId
    });
    return {
      output: StructuredTodayV2DossierGraphOutputSchema.parse({ artifact, publishable: true, issues: [] })
    };
  };

  return new StateGraph(DossierV2State)
    .addNode("gather-selected-findings", gather)
    .addNode("analyze-dossier-v2", analyze)
    .addNode("critique-dossier-v2", critique)
    .addNode("compose-dossier-v2", compose)
    .addNode("build-dossier-v2", build)
    .addEdge(START, "gather-selected-findings")
    .addEdge("gather-selected-findings", "analyze-dossier-v2")
    .addEdge("analyze-dossier-v2", "critique-dossier-v2")
    .addEdge("critique-dossier-v2", "compose-dossier-v2")
    .addEdge("compose-dossier-v2", "build-dossier-v2")
    .addEdge("build-dossier-v2", END)
    .compile({
      ...(input.checkpointer ? { checkpointer: input.checkpointer } : {}),
      name: "structured-today-dossier-v2",
      description: "Selected-workline V2 dossier over one exact verified finding closure."
    });
}

export async function invokeStructuredTodayV2DossierLangGraph(input: {
  graph: ReturnType<typeof createStructuredTodayV2DossierLangGraph>;
  workflowInput: StructuredTodayDossierWorkflowInputV2;
  threadId: string;
}): Promise<StructuredTodayV2DossierGraphOutput> {
  const result = await input.graph.invoke(
    { input: input.workflowInput },
    { configurable: { thread_id: input.threadId } }
  );
  if (!result.output) throw new Error("Structured Today V2 dossier run completed without output.");
  return StructuredTodayV2DossierGraphOutputSchema.parse(result.output);
}

export async function retryStructuredTodayV2DossierLangGraph(input: {
  graph: ReturnType<typeof createStructuredTodayV2DossierLangGraph>;
  threadId: string;
}): Promise<StructuredTodayV2DossierGraphOutput> {
  const result = await input.graph.invoke(
    null as never,
    { configurable: { thread_id: input.threadId } }
  );
  if (!result.output) throw new Error("Structured Today V2 dossier retry completed without output.");
  return StructuredTodayV2DossierGraphOutputSchema.parse(result.output);
}

function selectedWorklineFindingIds(workline: z.infer<typeof TodayWorklineV2Schema>): string[] {
  const ids = [
    ...workline.summary.findingIds,
    ...workline.currentStop.findingIds,
    ...workline.possibleChange.findingIds,
    ...workline.participation.statement.findingIds
  ];
  return [...new Set(ids)];
}

function assertAnalysisFindingClosure(
  candidate: DossierAnalysisCandidateV2,
  allowedFindingIds: string[],
  stage: string
): void {
  assertStatementsFindingClosure([
    candidate.priorContext,
    candidate.whatHappened,
    candidate.possibleChange,
    ...candidate.supportingEvidence,
    ...candidate.opposingEvidence,
    candidate.falsifiableObservation,
    ...candidate.gaps
  ], allowedFindingIds, stage);
}

function assertComposeFindingClosure(candidate: DossierComposeCandidateV2, allowedFindingIds: string[]): void {
  assertAnalysisFindingClosure(candidate, allowedFindingIds, "compose");
  assertStatementsFindingClosure([candidate.humanQuestion], allowedFindingIds, "compose");
}

function assertCritiqueFindingClosure(candidate: DossierCritiqueCandidateV2, allowedFindingIds: string[]): void {
  const allowed = new Set(allowedFindingIds);
  const invented = candidate.missingFindingIds.find((findingId) => !allowed.has(findingId));
  if (invented) throw new Error(`V2 dossier critique references finding outside selected workline: ${invented}.`);
}

function assertStatementsFindingClosure(
  statements: MaterialStatementCandidateV2[],
  allowedFindingIds: string[],
  stage: string
): void {
  const allowed = new Set(allowedFindingIds);
  for (const statement of statements) {
    const invented = statement.findingIds.find((findingId) => !allowed.has(findingId));
    if (invented) {
      throw new Error(`V2 dossier ${stage} references finding outside selected workline: ${invented}.`);
    }
  }
}

function nonEmptyTuple(values: string[]): [string, ...string[]] {
  const [first, ...rest] = values;
  if (!first) throw new Error("Selected V2 workline has no verified findings.");
  return [first, ...rest];
}
