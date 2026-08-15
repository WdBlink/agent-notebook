import type { AgentWorkSession } from "../../src/types";
import type {
  TraceinkIndexArtifactDraftV1,
  TraceinkIndexArtifactV1
} from "../../src/traceink-review-assets";
import {
  activeIndexReferenceForDate,
  appendTraceinkIndexRevision,
  findTraceinkArtifact,
  type TraceinkAssetStoreDocumentV1,
  type TraceinkIndexArtifactReferenceV1
} from "./traceink-asset-store";
import type { TraceinkAssetRepository } from "./traceink-asset-repository";

export type TraceinkReviewPreparationMode = "raw" | "compiled" | "stale";

export interface TraceinkReviewPreparationInput {
  logicalDate: string;
  snapshotDate: string;
  mode: TraceinkReviewPreparationMode;
  evidenceCutoff: string;
  sessions: AgentWorkSession[];
}

export interface TraceinkReviewPreparationDependencies {
  repository: Pick<TraceinkAssetRepository, "load" | "mutate">;
  compile(input: {
    logicalDate: string;
    evidenceCutoff: string;
    capturedSessions: AgentWorkSession[];
  }): Promise<TraceinkIndexArtifactDraftV1>;
}

export interface TraceinkReviewPreparationResult {
  logicalDate: string;
  requestedMode: TraceinkReviewPreparationMode;
  capturedSessions: AgentWorkSession[];
  document: TraceinkAssetStoreDocumentV1;
  activeIndexReference: TraceinkIndexArtifactReferenceV1;
  activeIndex: TraceinkIndexArtifactV1;
}

/**
 * Runs only the canonical Traceink index stage. The expected active reference
 * is captured before the long model invocation, then checked again inside the
 * repository's serialized durable mutation.
 */
export async function runTraceinkReviewPreparation(
  input: TraceinkReviewPreparationInput,
  dependencies: TraceinkReviewPreparationDependencies
): Promise<TraceinkReviewPreparationResult> {
  validateInput(input);
  const startingDocument = await dependencies.repository.load();
  const expectedActiveIndex = activeIndexReferenceForDate(startingDocument, input.logicalDate) ?? null;
  validateModeAgainstAssets(input.mode, expectedActiveIndex);

  const capturedSessions = structuredClone(input.sessions);
  const draft = await dependencies.compile({
    logicalDate: input.logicalDate,
    evidenceCutoff: input.evidenceCutoff,
    capturedSessions: structuredClone(capturedSessions)
  });
  if (draft.schemaVersion !== 1 || draft.stage !== "index") {
    throw new Error("Traceink compiler returned an invalid stage.");
  }
  if (draft.logicalDate !== input.logicalDate) {
    throw new Error("Traceink compiler returned a different logical date.");
  }
  const committedDraft = structuredClone(draft);

  const document = await dependencies.repository.mutate((current) => {
    const next = appendTraceinkIndexRevision(current, committedDraft, expectedActiveIndex);
    if (next.artifacts.length !== current.artifacts.length + 1) {
      throw new Error("Traceink preparation must append exactly one index artifact.");
    }
    if (next.reflections.length !== current.reflections.length) {
      throw new Error("Traceink index preparation cannot create or change reflections.");
    }
    return next;
  });
  const activeIndexReference = activeIndexReferenceForDate(document, input.logicalDate);
  const reopenedArtifact = activeIndexReference
    ? findTraceinkArtifact(document, activeIndexReference)
    : undefined;
  const activeIndex = asIndexArtifact(reopenedArtifact);
  if (!activeIndexReference || !activeIndex) {
    throw new Error("Traceink index was saved but could not be reopened.");
  }

  return {
    logicalDate: input.logicalDate,
    requestedMode: input.mode,
    capturedSessions,
    document,
    activeIndexReference,
    activeIndex
  };
}

function asIndexArtifact(
  artifact: ReturnType<typeof findTraceinkArtifact>
): TraceinkIndexArtifactV1 | undefined {
  if (!artifact || artifact.stage !== "index" || artifact.worklineId !== undefined || artifact.sourceReflection !== undefined) {
    return undefined;
  }
  const { worklineId: _worklineId, sourceReflection: _sourceReflection, ...fields } = artifact;
  return { ...fields, stage: "index" };
}

function validateInput(input: TraceinkReviewPreparationInput): void {
  if (!isLogicalDate(input.logicalDate)) throw new Error("Traceink review date is invalid.");
  if (!isLogicalDate(input.snapshotDate) || input.snapshotDate !== input.logicalDate) {
    throw new Error("Traceink session snapshot does not match the requested date.");
  }
  if (input.mode !== "raw" && input.mode !== "compiled" && input.mode !== "stale") {
    throw new Error("Traceink review mode is invalid.");
  }
  if (!isTimestamp(input.evidenceCutoff)) throw new Error("Traceink evidence cutoff is invalid.");
}

function validateModeAgainstAssets(
  mode: TraceinkReviewPreparationMode,
  active: TraceinkIndexArtifactReferenceV1 | null
): void {
  if (mode === "raw" && active) {
    throw new Error("Traceink index already exists; the current mode is not raw.");
  }
  if ((mode === "compiled" || mode === "stale") && !active) {
    throw new Error("Traceink index is missing; the current mode is raw.");
  }
}

function isLogicalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isTimestamp(value: string): boolean {
  return Boolean(value.trim()) && !Number.isNaN(Date.parse(value));
}
