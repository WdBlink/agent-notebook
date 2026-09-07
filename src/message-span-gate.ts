import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  StructuredTodayIndexWorkflowInputSchema,
  StructuredTodayProposalArtifactSchema,
  StructuredTodayReflectionSchema,
  TodayWorklineDossierSchema,
  TodayWorklineIndexSchema,
  type StructuredTodayProposalArtifactV1,
  type StructuredTodayReflectionV1,
  type StructuredTodayIndexWorkflowInput,
  type TodayWorklineDossierV1,
  type TodayWorklineIndexV1
} from "./structured-today-contracts";
import {
  validateStructuredTodayDossier,
  validateStructuredTodayIndex,
  validateStructuredTodayProposalArtifact
} from "./structured-today-artifacts";

export const MESSAGE_SPAN_GATE_SCHEMA = "message-span-gate/v1" as const;
export const MESSAGE_SPAN_GATE_REVIEW_SCHEMA = "message-span-gate-review/v1" as const;
export const MESSAGE_SPAN_GATE_RESULT_SCHEMA = "message-span-gate-result/v1" as const;
export const MESSAGE_SPAN_GATE_SAMPLE_SIZE = 10;
export const MESSAGE_SPAN_GATE_THRESHOLD = 9;
export const MESSAGE_SPAN_ELIGIBILITY_POLICY_SCHEMA = "message-span-eligibility-policy/v1" as const;
export const MESSAGE_SPAN_GATE_ARM_SCHEMA = "message-span-gate-arm/v1" as const;
export const MESSAGE_SPAN_GATE_TRIGGER_SCHEMA = "message-span-gate-trigger/v1" as const;
export const MESSAGE_SPAN_GATE_INVENTORY_SCHEMA = "message-span-gate-inventory/v1" as const;
export const MESSAGE_SPAN_ELIGIBILITY_REVIEW_SCHEMA = "message-span-eligibility-review/v1" as const;
export const MESSAGE_SPAN_ELIGIBILITY_RESULT_SCHEMA = "message-span-eligibility-result/v1" as const;
export const MESSAGE_SPAN_FORMAL_SAMPLE_SCHEMA = "message-span-formal-sample/v1" as const;

export const MESSAGE_SPAN_GATE_QUOTAS = {
  typed: 6,
  narrative: 2,
  participation: 1,
  crossSession: 1
} as const;

export type MessageSpanConclusionCategory = keyof typeof MESSAGE_SPAN_GATE_QUOTAS;

export interface MessageSpanArtifactReference {
  kind: "index" | "dossier";
  artifactId: string;
  revision: number;
  contentHash: string;
}

export interface EligibleMessageSpanConclusion {
  conclusionId: string;
  category: MessageSpanConclusionCategory;
  subtype: string;
  text: string;
  textHash: string;
  sourceArtifact: MessageSpanArtifactReference;
  jsonPointer: string;
  atomOrdinal: number;
  declaredEvidenceIds: string[];
  declaredSessionIds: string[];
}

export interface SampledMessageSpanConclusion extends EligibleMessageSpanConclusion {
  samplingHash: string;
  quotaSlot: MessageSpanConclusionCategory;
  selection: "primary" | "fallback";
}

export interface MessageSpanCoverageDeficit {
  category: "typed" | "narrative" | "participation" | "crossSession";
  required: number;
  available: number;
  missing: number;
  fallbackCategory: "typed" | "narrative" | null;
  fallbackFilled: number;
}

export interface AdmittedMessageEvidence {
  evidenceId: string;
  sessionId: string;
  provider: "codex" | "claude" | "copilot";
  messageId: string;
  messageOrdinal: number;
  role: "user" | "assistant";
  timestamp: string | null;
  content: string;
  contentHash: string;
}

export interface MessageSpanGateV1 {
  schema: typeof MESSAGE_SPAN_GATE_SCHEMA;
  batchId: string;
  phase: "gate-a";
  status: "frozen";
  logicalDate: string;
  seed: string;
  artifacts: {
    index: MessageSpanArtifactReference;
    dossiers: Array<MessageSpanArtifactReference & { worklineId: string }>;
  };
  manifest: {
    evidenceManifestId: string;
    sessions: TodayWorklineIndexV1["sessions"];
    evidence: TodayWorklineIndexV1["evidence"];
    workflowRunId: string;
    workflowInputHash: string;
    checkpoint: {
      threadId: string;
      checkpointNamespace: "";
      checkpointId: string;
    };
    eligibleInventoryHash: string;
    eligibleConclusionCount: number;
    admittedMessageCorpusHash: string;
    admittedMessageCount: number;
    syntheticOmissionsExcluded: number;
  };
  sampling: {
    sampleSize: typeof MESSAGE_SPAN_GATE_SAMPLE_SIZE;
    quotas: typeof MESSAGE_SPAN_GATE_QUOTAS;
    fallbackPolicy: "typed<->narrative-only";
    coverageDeficits: MessageSpanCoverageDeficit[];
  };
  conclusions: SampledMessageSpanConclusion[];
  admittedMessages: AdmittedMessageEvidence[];
}

export interface MessageSpanGateOptions {
  assetStorePath: string;
  checkpointDatabasePath: string;
  logicalDate: string;
  seed: string;
}

export type MessageSpanGateFailureCode = "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8";

export interface MessageSpanGateReviewSpanV1 {
  evidenceId: string;
  sessionId: string;
  provider: "codex" | "claude" | "copilot";
  messageId: string;
  messageOrdinal: number;
  role: "user" | "assistant";
  exactQuote: string;
}

export interface MessageSpanGateReviewAnnotationV1 {
  conclusionId: string;
  verdict: "pass" | "fail";
  failureCode: MessageSpanGateFailureCode | null;
  spans: MessageSpanGateReviewSpanV1[];
  rationale: string;
}

export interface MessageSpanGateReviewV1 {
  schema: typeof MESSAGE_SPAN_GATE_REVIEW_SCHEMA;
  batchId: string;
  packSha256: string;
  reviewer: "A" | "B";
  blind: true;
  annotations: MessageSpanGateReviewAnnotationV1[];
}

export interface MessageSpanGateResultItemV1 {
  conclusionId: string;
  reviewerA: { verdict: "pass" | "fail"; failureCode: MessageSpanGateFailureCode | null };
  reviewerB: { verdict: "pass" | "fail"; failureCode: MessageSpanGateFailureCode | null };
  verdictAgreement: boolean;
  consensusPass: boolean;
}

interface MessageSpanGateResultBaseV1 {
  schema: typeof MESSAGE_SPAN_GATE_RESULT_SCHEMA;
  batchId: string;
  phase: "gate-a";
  packHash: string;
  reviewerHashes: { A: string; B: string };
  threshold: typeof MESSAGE_SPAN_GATE_THRESHOLD;
  reviewerPassCounts: { A: number; B: number };
  verdictAgreement: number;
  consensusPass: number;
  failureCodeDistribution: Record<MessageSpanGateFailureCode, number>;
  results: MessageSpanGateResultItemV1[];
}

export type MessageSpanGateResultV1 = MessageSpanGateResultBaseV1 & (
  | { status: "final"; decision: "pass" | "fail" }
  | { status: "needs-adjudication" }
);

export const MESSAGE_SPAN_ELIGIBILITY_CODES = {
  E1: "non-declarative-or-question",
  E2: "absence-gap-or-coverage",
  E3: "inference-prediction-or-future",
  E4: "product-workflow-state",
  E5: "reflection-question-or-proposal",
  E6: "participation-or-adoption-semantics-ineligible",
  E7: "non-atomic-or-diffuse",
  E8: "visible-source-class-or-atom-mismatch"
} as const;

export const MESSAGE_SPAN_EVIDENCE_FAILURE_CODES = {
  F1: "no-direct-support",
  F2: "admitted-coverage-limit",
  F3: "contradicted",
  F4: "non-atomic-or-more-than-three-spans",
  F5: "role-authority-mismatch",
  F6: "ambiguous-exact-range",
  F7: "wrong-target-or-declared-basis",
  F8: "partial-overclaim"
} as const;

export const MESSAGE_SPAN_INTEGRITY_CODES = {
  I1: "pack-or-lineage-mismatch",
  I2: "corpus-or-declared-basis-mismatch",
  I3: "quote-or-tuple-forgery",
  I4: "raw-prefix-or-message-hash-mismatch",
  I5: "position-or-grapheme-mismatch",
  I6: "review-coverage-or-identity-mismatch"
} as const;

export type MessageSpanEligibilityCode = keyof typeof MESSAGE_SPAN_ELIGIBILITY_CODES;
export type MessageSpanIntegrityCode = keyof typeof MESSAGE_SPAN_INTEGRITY_CODES;

export const MESSAGE_SPAN_FORMAL_FIELD_ALLOWLIST = {
  typed: [
    "/content/supportingEvidence/*/claim",
    "/content/opposingEvidence/*/claim"
  ],
  narrative: [
    "/worklines/*/summary",
    "/worklines/*/currentStop",
    "/content/priorContext",
    "/content/whatHappened"
  ],
  participation: [
    "/worklines/*/participation/human",
    "/worklines/*/participation/joint"
  ],
  crossSession: [
    "/worklines/*/summary when sessionIds.length > 1",
    "/content/whatHappened when admittedSessionIds.length > 1"
  ]
} as const;

export const MESSAGE_SPAN_FORMAL_SAMPLING_FORMULA =
  "sha256(publicSeed|eligibilityPolicyHash|triggerProposalExactRef|conclusionId)" as const;
export const MESSAGE_SPAN_TRIGGER_ORDERING_FORMULA =
  "sourceReflection.savedAt ASC -> artifactId ASC -> revision ASC -> contentHash ASC" as const;

export interface MessageSpanGateArmProposalReferenceV1 {
  logicalDate: string;
  artifactId: string;
  revision: number;
  contentHash: string;
  worklineId: string;
}

export interface MessageSpanGateArmV1 {
  schema: typeof MESSAGE_SPAN_GATE_ARM_SCHEMA;
  status: "armed";
  armedAt: string;
  rule: "next-natural-proposal-review-after-arm";
  publicSeed: string;
  assetStoreHashAtArm: string;
  proposalFrontierHash: string;
  proposalFrontier: MessageSpanGateArmProposalReferenceV1[];
  discoveryBaseline: {
    batchId: string;
    receiptSha256: string;
    decision: "pass" | "fail";
    consensusPass: number;
    threshold: number;
    countsAsNextReviewGate: false;
  };
}

export interface MessageSpanEligibilityPolicyV1 {
  schema: typeof MESSAGE_SPAN_ELIGIBILITY_POLICY_SCHEMA;
  status: "frozen";
  armReceiptHash: string;
  publicSeed: string;
  preTriggerAssetStoreHash: string;
  verifiedFrontierHash: string;
  verifiedFrontierCount: number;
  preTriggerStatus: "waiting";
  extractorVersion: "message-span-inventory-extractor/v1";
  atomizerVersion: "message-span-conclusion-atomizer/v1";
  codebookVersion: "message-span-gate-codebook/v1";
  fieldAllowlist: typeof MESSAGE_SPAN_FORMAL_FIELD_ALLOWLIST;
  quotas: typeof MESSAGE_SPAN_GATE_QUOTAS;
  fallback: "none";
  eligibilityCodebook: typeof MESSAGE_SPAN_ELIGIBILITY_CODES;
  evidenceFailureCodebook: typeof MESSAGE_SPAN_EVIDENCE_FAILURE_CODES;
  integrityCodebook: typeof MESSAGE_SPAN_INTEGRITY_CODES;
  reviewProtocol: {
    reviewers: ["A", "B"];
    blind: true;
    completeInventoryCoverage: true;
    disagreement: "needs-adjudication";
    corpusReveal: "after-final-sample-only";
  };
  samplingFormula: typeof MESSAGE_SPAN_FORMAL_SAMPLING_FORMULA;
  triggerOrderingFormula: typeof MESSAGE_SPAN_TRIGGER_ORDERING_FORMULA;
  relevantCorpus: "source-index-digest-admitted/v1";
  decisionFormula: "agreement=10 && consensusPass>=9 && F5=0 && F7=0 && integrity=0";
  contentHash: string;
}

export interface MessageSpanGateTriggerV1 {
  schema: typeof MESSAGE_SPAN_GATE_TRIGGER_SCHEMA;
  status: "frozen";
  armReceiptHash: string;
  eligibilityPolicyHash: string;
  triggerProposal: MessageSpanGateArmProposalReferenceV1;
  sourceReflection: { reflectionId: string; revision: number; contentHash: string; savedAt: string };
  sourceDossier: MessageSpanArtifactReference & { kind: "dossier"; worklineId: string };
  sourceIndex: MessageSpanArtifactReference & { kind: "index"; logicalDate: string };
  inventoryDossiers: Array<MessageSpanArtifactReference & { kind: "dossier"; worklineId: string }>;
  assetStoreSnapshotHash: string;
  contentHash: string;
}

export type MessageSpanGateTriggerDetectionV1 =
  | {
      status: "waiting";
      armReceiptHash: string;
      eligibilityPolicyHash: string;
      assetStoreSnapshotHash: string;
      frontierCount: number;
      currentProposalCount: number;
    }
  | { status: "triggered"; trigger: MessageSpanGateTriggerV1 };

export interface MessageFreeConclusionV1 {
  conclusionId: string;
  category: MessageSpanConclusionCategory;
  subtype: string;
  text: string;
  textHash: string;
  sourceArtifact: MessageSpanArtifactReference;
  jsonPointer: string;
  atomOrdinal: number;
}

export interface MessageSpanGateInventoryV1 {
  schema: typeof MESSAGE_SPAN_GATE_INVENTORY_SCHEMA;
  status: "frozen";
  armReceiptHash: string;
  eligibilityPolicyHash: string;
  triggerReceiptHash: string;
  triggerProposal: MessageSpanGateArmProposalReferenceV1;
  sourceIndex: MessageSpanGateTriggerV1["sourceIndex"];
  sourceDossiers: MessageSpanGateTriggerV1["inventoryDossiers"];
  corpusCommitment: {
    checkpointId: string;
    workflowInputHash: string;
    admittedMessageCorpusHash: string;
    admittedMessageCount: number;
  };
  categoryCounts: Record<MessageSpanConclusionCategory, number>;
  conclusions: MessageFreeConclusionV1[];
  inventoryHash: string;
  contentHash: string;
}

export interface MessageSpanEligibilityReviewV1 {
  schema: typeof MESSAGE_SPAN_ELIGIBILITY_REVIEW_SCHEMA;
  inventoryContentHash: string;
  eligibilityPolicyHash: string;
  reviewer: "A" | "B";
  blind: true;
  annotations: Array<{
    conclusionId: string;
    verdict: "eligible" | "ineligible";
    exclusionCode: MessageSpanEligibilityCode | null;
    rationale: string;
  }>;
}

export interface MessageSpanEligibilityResultItemV1 {
  conclusionId: string;
  category: MessageSpanConclusionCategory;
  reviewerA: { verdict: "eligible" | "ineligible"; exclusionCode: MessageSpanEligibilityCode | null };
  reviewerB: { verdict: "eligible" | "ineligible"; exclusionCode: MessageSpanEligibilityCode | null };
  agreement: boolean;
  finalEligibility?: "eligible" | "ineligible";
}

interface MessageSpanEligibilityResultBaseV1 {
  schema: typeof MESSAGE_SPAN_ELIGIBILITY_RESULT_SCHEMA;
  inventoryContentHash: string;
  eligibilityPolicyHash: string;
  reviewerHashes: { A: string; B: string };
  agreementCount: number;
  exclusionCodeDistribution: Record<MessageSpanEligibilityCode, number>;
  results: MessageSpanEligibilityResultItemV1[];
  contentHash: string;
}

export type MessageSpanEligibilityResultV1 = MessageSpanEligibilityResultBaseV1 & (
  | { status: "needs-adjudication" }
  | {
      status: "final";
      eligiblePools: Record<MessageSpanConclusionCategory, string[]>;
    }
);

export type MessageSpanFormalSampleV1 =
  | {
      schema: typeof MESSAGE_SPAN_FORMAL_SAMPLE_SCHEMA;
      status: "failed";
      reason: "quota-deficit";
      triggerProposal: MessageSpanGateArmProposalReferenceV1;
      eligibilityPolicyHash: string;
      triggerReceiptHash: string;
      inventoryContentHash: string;
      eligibilityResultHash: string;
      deficits: Array<{ category: MessageSpanConclusionCategory; required: number; available: number }>;
      contentHash: string;
    }
  | {
      schema: typeof MESSAGE_SPAN_FORMAL_SAMPLE_SCHEMA;
      status: "frozen";
      triggerProposal: MessageSpanGateArmProposalReferenceV1;
      eligibilityPolicyHash: string;
      triggerReceiptHash: string;
      inventoryContentHash: string;
      eligibilityResultHash: string;
      samplingFormula: typeof MESSAGE_SPAN_FORMAL_SAMPLING_FORMULA;
      quotas: typeof MESSAGE_SPAN_GATE_QUOTAS;
      fallback: "none";
      conclusions: Array<MessageFreeConclusionV1 & { samplingHash: string }>;
      contentHash: string;
    };

interface LoadedGateArtifacts {
  index: TodayWorklineIndexV1;
  dossiers: TodayWorklineDossierV1[];
}

interface LoadedCheckpointInput {
  checkpointId: string;
  workflowInput: StructuredTodayIndexWorkflowInput;
}

interface ConclusionCandidateInput {
  category: MessageSpanConclusionCategory;
  subtype: string;
  text: string;
  sourceArtifact: MessageSpanArtifactReference;
  jsonPointer: string;
  atomOrdinal: number;
  declaredEvidenceIds: string[];
  declaredSessionIds: string[];
}

/**
 * Gate A is intentionally read-only: it freezes the actual evidence already
 * admitted to the model and samples conclusions. It neither locates spans nor
 * changes the production artifact contract.
 */
export function buildMessageSpanGate(options: MessageSpanGateOptions): MessageSpanGateV1 {
  const logicalDate = requiredLogicalDate(options.logicalDate);
  const seed = requiredText(options.seed, "seed");
  const artifacts = loadGateArtifacts(options.assetStorePath, logicalDate);
  const checkpoint = loadLatestExactIndexWorkflowInput(
    options.checkpointDatabasePath,
    artifacts.index
  );
  const inventory = buildEligibleConclusionInventory(artifacts.index, artifacts.dossiers);
  const sampled = sampleMessageSpanConclusions({
    inventory,
    evidenceManifestId: artifacts.index.evidenceManifestId,
    seed
  });
  const corpus = extractAdmittedMessageCorpus(checkpoint.workflowInput, artifacts.index);
  const indexReference = artifactReference("index", artifacts.index);
  const dossierReferences = artifacts.dossiers.map((dossier) => ({
    ...artifactReference("dossier", dossier),
    worklineId: dossier.worklineId
  }));
  const admittedMessageCorpusHash = sha256(JSON.stringify(corpus.messages));
  const batchId = `gate-a-${sha256(JSON.stringify({
    logicalDate,
    seed,
    index: indexReference,
    conclusions: sampled.conclusions.map((item) => item.conclusionId),
    admittedMessageCorpusHash
  })).slice(0, 32)}`;
  return {
    schema: MESSAGE_SPAN_GATE_SCHEMA,
    batchId,
    phase: "gate-a",
    status: "frozen",
    logicalDate,
    seed,
    artifacts: { index: indexReference, dossiers: dossierReferences },
    manifest: {
      evidenceManifestId: artifacts.index.evidenceManifestId,
      sessions: artifacts.index.sessions,
      evidence: artifacts.index.evidence,
      workflowRunId: artifacts.index.workflowRunId,
      workflowInputHash: sha256(JSON.stringify(checkpoint.workflowInput)),
      checkpoint: {
        threadId: artifacts.index.workflowRunId,
        checkpointNamespace: "",
        checkpointId: checkpoint.checkpointId
      },
      eligibleInventoryHash: sha256(JSON.stringify(inventory)),
      eligibleConclusionCount: inventory.length,
      admittedMessageCorpusHash,
      admittedMessageCount: corpus.messages.length,
      syntheticOmissionsExcluded: corpus.syntheticOmissionsExcluded
    },
    sampling: {
      sampleSize: MESSAGE_SPAN_GATE_SAMPLE_SIZE,
      quotas: MESSAGE_SPAN_GATE_QUOTAS,
      fallbackPolicy: "typed<->narrative-only",
      coverageDeficits: sampled.coverageDeficits
    },
    conclusions: sampled.conclusions,
    admittedMessages: corpus.messages
  };
}

/**
 * Validates two blind-review files against the exact frozen pack bytes and
 * emits a hash-bound receipt. Any malformed identity, quote, or tuple aborts
 * instead of being counted as a reviewer failure.
 */
export function adjudicateMessageSpanGate(
  packBytes: Uint8Array,
  reviewerABytes: Uint8Array,
  reviewerBBytes: Uint8Array
): MessageSpanGateResultV1 {
  const packHash = sha256(packBytes);
  const pack = parseFrozenGatePack(packBytes);
  const reviewerA = parseGateReview(
    reviewerABytes,
    "A",
    pack,
    packHash
  );
  const reviewerB = parseGateReview(
    reviewerBBytes,
    "B",
    pack,
    packHash
  );
  const byA = new Map(reviewerA.annotations.map((annotation) => [annotation.conclusionId, annotation]));
  const byB = new Map(reviewerB.annotations.map((annotation) => [annotation.conclusionId, annotation]));
  const failureCodeDistribution = emptyFailureCodeDistribution();
  for (const review of [reviewerA, reviewerB]) {
    for (const annotation of review.annotations) {
      if (annotation.failureCode) failureCodeDistribution[annotation.failureCode] += 1;
    }
  }
  const results = pack.conclusions.map((conclusion): MessageSpanGateResultItemV1 => {
    const annotationA = byA.get(conclusion.conclusionId);
    const annotationB = byB.get(conclusion.conclusionId);
    if (!annotationA || !annotationB) {
      throw new Error(`Message Span Gate review coverage lost conclusion ${conclusion.conclusionId}.`);
    }
    const verdictAgreement = annotationA.verdict === annotationB.verdict;
    return {
      conclusionId: conclusion.conclusionId,
      reviewerA: { verdict: annotationA.verdict, failureCode: annotationA.failureCode },
      reviewerB: { verdict: annotationB.verdict, failureCode: annotationB.failureCode },
      verdictAgreement,
      consensusPass: annotationA.verdict === "pass" && annotationB.verdict === "pass"
    };
  });
  const reviewerPassCounts = {
    A: reviewerA.annotations.filter((annotation) => annotation.verdict === "pass").length,
    B: reviewerB.annotations.filter((annotation) => annotation.verdict === "pass").length
  };
  const verdictAgreement = results.filter((result) => result.verdictAgreement).length;
  const consensusPass = results.filter((result) => result.consensusPass).length;
  const base: MessageSpanGateResultBaseV1 = {
    schema: MESSAGE_SPAN_GATE_RESULT_SCHEMA,
    batchId: pack.batchId,
    phase: "gate-a",
    packHash,
    reviewerHashes: {
      A: sha256(reviewerABytes),
      B: sha256(reviewerBBytes)
    },
    threshold: MESSAGE_SPAN_GATE_THRESHOLD,
    reviewerPassCounts,
    verdictAgreement,
    consensusPass,
    failureCodeDistribution,
    results
  };
  if (verdictAgreement !== MESSAGE_SPAN_GATE_SAMPLE_SIZE) {
    return { ...base, status: "needs-adjudication" };
  }
  return {
    ...base,
    status: "final",
    decision: consensusPass >= MESSAGE_SPAN_GATE_THRESHOLD ? "pass" : "fail"
  };
}

export function adjudicateMessageSpanGateFiles(input: {
  packPath: string;
  reviewerAPath: string;
  reviewerBPath: string;
}): MessageSpanGateResultV1 {
  try {
    return adjudicateMessageSpanGate(
      readFileSync(requiredText(input.packPath, "pack path")),
      readFileSync(requiredText(input.reviewerAPath, "reviewer A path")),
      readFileSync(requiredText(input.reviewerBPath, "reviewer B path"))
    );
  } catch (error) {
    throw new Error(`Message Span Gate adjudication failed: ${errorMessage(error)}`);
  }
}

export function parseMessageSpanGateArm(bytes: Uint8Array): MessageSpanGateArmV1 {
  const raw = asRecord(parseJsonBytes(bytes, "arm receipt"));
  assertExactKeys(raw, [
    "schema",
    "status",
    "armedAt",
    "rule",
    "publicSeed",
    "assetStoreHashAtArm",
    "proposalFrontierHash",
    "proposalFrontier",
    "discoveryBaseline"
  ], "arm receipt");
  if (!raw ||
    raw.schema !== MESSAGE_SPAN_GATE_ARM_SCHEMA ||
    raw.status !== "armed" ||
    raw.rule !== "next-natural-proposal-review-after-arm" ||
    !validTimestamp(raw.armedAt) ||
    !isSha256(raw.assetStoreHashAtArm) ||
    !isSha256(raw.proposalFrontierHash)) {
    throw new Error("Message Span Gate arm receipt identity is invalid.");
  }
  const publicSeed = recordText(raw, "publicSeed", "arm publicSeed");
  if (!Array.isArray(raw.proposalFrontier) || raw.proposalFrontier.length === 0) {
    throw new Error("Message Span Gate arm frontier is empty or invalid.");
  }
  const proposalFrontier = raw.proposalFrontier.map((value, ordinal) =>
    parseArmProposalReference(value, `arm frontier ${ordinal}`)
  );
  const sortedFrontier = [...proposalFrontier].sort(compareArmProposalReferences);
  if (JSON.stringify(proposalFrontier) !== JSON.stringify(sortedFrontier) ||
    new Set(proposalFrontier.map(proposalReferenceKey)).size !== proposalFrontier.length) {
    throw new Error("Message Span Gate arm frontier is not uniquely and canonically ordered.");
  }
  const expectedFrontierHash = sha256(`${JSON.stringify(sortedFrontier)}\n`);
  if (raw.proposalFrontierHash !== expectedFrontierHash) {
    throw new Error("Message Span Gate arm frontier hash is invalid.");
  }
  const discovery = asRecord(raw.discoveryBaseline);
  assertExactKeys(discovery, [
    "batchId",
    "receiptSha256",
    "decision",
    "consensusPass",
    "threshold",
    "countsAsNextReviewGate"
  ], "arm discovery baseline");
  if (!discovery ||
    (discovery.decision !== "pass" && discovery.decision !== "fail") ||
    !isSha256(discovery.receiptSha256) ||
    !Number.isSafeInteger(discovery.consensusPass) ||
    !Number.isSafeInteger(discovery.threshold) ||
    discovery.countsAsNextReviewGate !== false) {
    throw new Error("Message Span Gate arm discovery baseline is invalid.");
  }
  return {
    schema: MESSAGE_SPAN_GATE_ARM_SCHEMA,
    status: "armed",
    armedAt: String(raw.armedAt),
    rule: "next-natural-proposal-review-after-arm",
    publicSeed,
    assetStoreHashAtArm: String(raw.assetStoreHashAtArm),
    proposalFrontierHash: String(raw.proposalFrontierHash),
    proposalFrontier,
    discoveryBaseline: {
      batchId: recordText(discovery, "batchId", "discovery batchId"),
      receiptSha256: String(discovery.receiptSha256),
      decision: discovery.decision,
      consensusPass: Number(discovery.consensusPass),
      threshold: Number(discovery.threshold),
      countsAsNextReviewGate: false
    }
  };
}

export function buildMessageSpanEligibilityPolicy(
  armBytes: Uint8Array,
  assetStoreBytes: Uint8Array
): MessageSpanEligibilityPolicyV1 {
  const arm = parseMessageSpanGateArm(armBytes);
  const preTrigger = verifyPreTriggerState(arm, assetStoreBytes);
  const withoutHash = {
    schema: MESSAGE_SPAN_ELIGIBILITY_POLICY_SCHEMA,
    status: "frozen" as const,
    armReceiptHash: sha256(armBytes),
    publicSeed: arm.publicSeed,
    preTriggerAssetStoreHash: preTrigger.assetStoreSnapshotHash,
    verifiedFrontierHash: arm.proposalFrontierHash,
    verifiedFrontierCount: preTrigger.frontierCount,
    preTriggerStatus: "waiting" as const,
    extractorVersion: "message-span-inventory-extractor/v1" as const,
    atomizerVersion: "message-span-conclusion-atomizer/v1" as const,
    codebookVersion: "message-span-gate-codebook/v1" as const,
    fieldAllowlist: MESSAGE_SPAN_FORMAL_FIELD_ALLOWLIST,
    quotas: MESSAGE_SPAN_GATE_QUOTAS,
    fallback: "none" as const,
    eligibilityCodebook: MESSAGE_SPAN_ELIGIBILITY_CODES,
    evidenceFailureCodebook: MESSAGE_SPAN_EVIDENCE_FAILURE_CODES,
    integrityCodebook: MESSAGE_SPAN_INTEGRITY_CODES,
    reviewProtocol: {
      reviewers: ["A", "B"] as ["A", "B"],
      blind: true as const,
      completeInventoryCoverage: true as const,
      disagreement: "needs-adjudication" as const,
      corpusReveal: "after-final-sample-only" as const
    },
    samplingFormula: MESSAGE_SPAN_FORMAL_SAMPLING_FORMULA,
    triggerOrderingFormula: MESSAGE_SPAN_TRIGGER_ORDERING_FORMULA,
    relevantCorpus: "source-index-digest-admitted/v1" as const,
    decisionFormula: "agreement=10 && consensusPass>=9 && F5=0 && F7=0 && integrity=0" as const
  };
  return { ...withoutHash, contentHash: canonicalHash(withoutHash) };
}

export function parseMessageSpanEligibilityPolicy(bytes: Uint8Array): MessageSpanEligibilityPolicyV1 {
  const raw = asRecord(parseJsonBytes(bytes, "eligibility policy"));
  assertExactKeys(raw, [
    "schema",
    "status",
    "armReceiptHash",
    "publicSeed",
    "preTriggerAssetStoreHash",
    "verifiedFrontierHash",
    "verifiedFrontierCount",
    "preTriggerStatus",
    "extractorVersion",
    "atomizerVersion",
    "codebookVersion",
    "fieldAllowlist",
    "quotas",
    "fallback",
    "eligibilityCodebook",
    "evidenceFailureCodebook",
    "integrityCodebook",
    "reviewProtocol",
    "samplingFormula",
    "triggerOrderingFormula",
    "relevantCorpus",
    "decisionFormula",
    "contentHash"
  ], "eligibility policy");
  if (!raw || raw.schema !== MESSAGE_SPAN_ELIGIBILITY_POLICY_SCHEMA || raw.status !== "frozen" ||
    !isSha256(raw.armReceiptHash) || !isSha256(raw.contentHash)) {
    throw new Error("Message Span Gate eligibility policy identity is invalid.");
  }
  const publicSeed = recordText(raw, "publicSeed", "eligibility policy publicSeed");
  if (!isSha256(raw.preTriggerAssetStoreHash) || !isSha256(raw.verifiedFrontierHash) ||
    !Number.isSafeInteger(raw.verifiedFrontierCount) || Number(raw.verifiedFrontierCount) <= 0 ||
    raw.preTriggerStatus !== "waiting") {
    throw new Error("Message Span Gate eligibility policy pre-trigger proof is invalid.");
  }
  const expected = buildPolicyFromBindings({
    armReceiptHash: String(raw.armReceiptHash),
    publicSeed,
    preTriggerAssetStoreHash: String(raw.preTriggerAssetStoreHash),
    verifiedFrontierHash: String(raw.verifiedFrontierHash),
    verifiedFrontierCount: Number(raw.verifiedFrontierCount)
  });
  if (canonicalJson(raw) !== canonicalJson(expected)) {
    throw new Error("Message Span Gate eligibility policy constants or content hash were modified.");
  }
  return expected;
}

export function detectMessageSpanGateTrigger(input: {
  armBytes: Uint8Array;
  policyBytes: Uint8Array;
  assetStoreBytes: Uint8Array;
}): MessageSpanGateTriggerDetectionV1 {
  const arm = parseMessageSpanGateArm(input.armBytes);
  const policy = parseMessageSpanEligibilityPolicy(input.policyBytes);
  if (policy.armReceiptHash !== sha256(input.armBytes) || policy.publicSeed !== arm.publicSeed) {
    throw new Error("Message Span Gate policy does not bind the supplied arm receipt.");
  }
  if (policy.verifiedFrontierHash !== arm.proposalFrontierHash ||
    policy.verifiedFrontierCount !== arm.proposalFrontier.length ||
    policy.preTriggerStatus !== "waiting") {
    throw new Error("Message Span Gate policy frontier proof does not match the supplied arm receipt.");
  }
  if (policy.triggerOrderingFormula !== MESSAGE_SPAN_TRIGGER_ORDERING_FORMULA) {
    throw new Error("Message Span Gate policy trigger ordering formula is invalid.");
  }
  const snapshotHash = sha256(input.assetStoreBytes);
  const store = parseFormalAssetStore(input.assetStoreBytes);
  const frontier = new Set(arm.proposalFrontier.map(proposalReferenceKey));
  const currentProposals = store.proposals.map((artifact) => proposalArtifactReference(artifact));
  for (const armed of arm.proposalFrontier) {
    const current = currentProposals.find((reference) => proposalReferenceKey(reference) === proposalReferenceKey(armed));
    if (!current || canonicalJson(current) !== canonicalJson(armed)) {
      throw new Error(`Message Span Gate armed frontier proposal no longer resolves exactly: ${armed.artifactId}.`);
    }
  }
  const deltaReferences = currentProposals.filter((reference) => !frontier.has(proposalReferenceKey(reference)));
  if (deltaReferences.length === 0) {
    return {
      status: "waiting",
      armReceiptHash: policy.armReceiptHash,
      eligibilityPolicyHash: policy.contentHash,
      assetStoreSnapshotHash: snapshotHash,
      frontierCount: arm.proposalFrontier.length,
      currentProposalCount: currentProposals.length
    };
  }
  const candidates = deltaReferences.map((reference) => resolveFormalProposalLineage(store, reference));
  candidates.sort(compareFormalTriggerCandidates);
  const selected = candidates[0];
  if (!selected) throw new Error("Message Span Gate frontier delta disappeared during trigger resolution.");
  const inventoryDossiers = selectInventoryDossiers(store.dossiers, selected.index, selected.dossier);
  const withoutHash = {
    schema: MESSAGE_SPAN_GATE_TRIGGER_SCHEMA,
    status: "frozen" as const,
    armReceiptHash: policy.armReceiptHash,
    eligibilityPolicyHash: policy.contentHash,
    triggerProposal: proposalArtifactReference(selected.proposal),
    sourceReflection: {
      reflectionId: selected.reflection.reflectionId,
      revision: selected.reflection.revision,
      contentHash: selected.reflection.contentHash,
      savedAt: selected.reflection.savedAt
    },
    sourceDossier: {
      ...artifactReference("dossier", selected.dossier),
      kind: "dossier" as const,
      worklineId: selected.dossier.worklineId
    },
    sourceIndex: {
      ...artifactReference("index", selected.index),
      kind: "index" as const,
      logicalDate: selected.index.logicalDate
    },
    inventoryDossiers,
    assetStoreSnapshotHash: snapshotHash
  };
  return {
    status: "triggered",
    trigger: { ...withoutHash, contentHash: canonicalHash(withoutHash) }
  };
}

export function parseMessageSpanGateTrigger(bytes: Uint8Array): MessageSpanGateTriggerV1 {
  const raw = asRecord(parseJsonBytes(bytes, "trigger receipt"));
  assertExactKeys(raw, [
    "schema",
    "status",
    "armReceiptHash",
    "eligibilityPolicyHash",
    "triggerProposal",
    "sourceReflection",
    "sourceDossier",
    "sourceIndex",
    "inventoryDossiers",
    "assetStoreSnapshotHash",
    "contentHash"
  ], "trigger receipt");
  if (!raw || raw.schema !== MESSAGE_SPAN_GATE_TRIGGER_SCHEMA || raw.status !== "frozen" ||
    !isSha256(raw.armReceiptHash) || !isSha256(raw.eligibilityPolicyHash) ||
    !isSha256(raw.assetStoreSnapshotHash) || !isSha256(raw.contentHash)) {
    throw new Error("Message Span Gate trigger receipt identity is invalid.");
  }
  const { contentHash, ...withoutHash } = raw;
  if (canonicalHash(withoutHash) !== contentHash) {
    throw new Error("Message Span Gate trigger receipt content hash is invalid.");
  }
  const triggerProposal = parseArmProposalReference(raw.triggerProposal, "trigger proposal");
  const sourceReflection = parseTriggerReflection(raw.sourceReflection);
  const sourceDossier = parseTriggerArtifactReference(raw.sourceDossier, "dossier", "trigger source dossier");
  const sourceIndex = parseTriggerArtifactReference(raw.sourceIndex, "index", "trigger source index");
  const logicalDate = recordText(asRecord(raw.sourceIndex), "logicalDate", "trigger source index logicalDate");
  if (!Array.isArray(raw.inventoryDossiers)) throw new Error("Message Span Gate trigger dossier set is invalid.");
  const inventoryDossiers = raw.inventoryDossiers.map((value, ordinal) => ({
    ...parseTriggerArtifactReference(value, "dossier", `inventory dossier ${ordinal}`),
    worklineId: recordText(asRecord(value), "worklineId", `inventory dossier ${ordinal} worklineId`)
  }));
  return {
    schema: MESSAGE_SPAN_GATE_TRIGGER_SCHEMA,
    status: "frozen",
    armReceiptHash: String(raw.armReceiptHash),
    eligibilityPolicyHash: String(raw.eligibilityPolicyHash),
    triggerProposal,
    sourceReflection,
    sourceDossier: { ...sourceDossier, worklineId: recordText(asRecord(raw.sourceDossier), "worklineId", "source dossier worklineId") },
    sourceIndex: { ...sourceIndex, logicalDate },
    inventoryDossiers,
    assetStoreSnapshotHash: String(raw.assetStoreSnapshotHash),
    contentHash: String(contentHash)
  };
}

export function buildMessageSpanGateInventory(input: {
  armBytes: Uint8Array;
  policyBytes: Uint8Array;
  triggerBytes: Uint8Array;
  assetStoreBytes: Uint8Array;
  corpusCommitment: {
    checkpointId: string;
    workflowInputHash: string;
    admittedMessageCorpusHash: string;
    admittedMessageCount: number;
  };
}): MessageSpanGateInventoryV1 {
  const policy = parseMessageSpanEligibilityPolicy(input.policyBytes);
  const trigger = parseMessageSpanGateTrigger(input.triggerBytes);
  const expectedTrigger = detectMessageSpanGateTrigger({
    armBytes: input.armBytes,
    policyBytes: input.policyBytes,
    assetStoreBytes: input.assetStoreBytes
  });
  if (expectedTrigger.status !== "triggered" ||
    canonicalJson(expectedTrigger.trigger) !== canonicalJson(trigger)) {
    throw new Error("Message Span Gate inventory trigger is not the deterministic first frontier delta.");
  }
  if (trigger.eligibilityPolicyHash !== policy.contentHash ||
    trigger.assetStoreSnapshotHash !== sha256(input.assetStoreBytes)) {
    throw new Error("Message Span Gate inventory inputs do not match the frozen trigger.");
  }
  if (!input.corpusCommitment.checkpointId.trim() ||
    !isSha256(input.corpusCommitment.workflowInputHash) ||
    !isSha256(input.corpusCommitment.admittedMessageCorpusHash) ||
    !Number.isSafeInteger(input.corpusCommitment.admittedMessageCount) ||
    input.corpusCommitment.admittedMessageCount < 0) {
    throw new Error("Message Span Gate corpus commitment is invalid.");
  }
  const store = parseFormalAssetStore(input.assetStoreBytes);
  const index = exactArtifact(store.indexes, trigger.sourceIndex, "inventory source index");
  const dossiers = trigger.inventoryDossiers.map((reference) =>
    exactArtifact(store.dossiers, reference, `inventory dossier ${reference.worklineId}`)
  );
  for (const dossier of dossiers) {
    if (!sameArtifactReference(dossier.sourceIndex, index)) {
      throw new Error(`Message Span Gate inventory dossier ${dossier.worklineId} changed source index.`);
    }
  }
  const inventoryCandidates = buildEligibleConclusionInventory(index, dossiers);
  assertConclusionTextDoesNotLeakAuthority(
    inventoryCandidates,
    collectArtifactAuthorityValues(index, dossiers)
  );
  const conclusions = inventoryCandidates.map(stripConclusionAuthority);
  assertMessageFree(conclusions);
  const categoryCounts = countConclusionCategories(conclusions);
  const inventoryHash = canonicalHash(conclusions);
  const withoutHash = {
    schema: MESSAGE_SPAN_GATE_INVENTORY_SCHEMA,
    status: "frozen" as const,
    armReceiptHash: trigger.armReceiptHash,
    eligibilityPolicyHash: policy.contentHash,
    triggerReceiptHash: trigger.contentHash,
    triggerProposal: trigger.triggerProposal,
    sourceIndex: trigger.sourceIndex,
    sourceDossiers: trigger.inventoryDossiers,
    corpusCommitment: { ...input.corpusCommitment },
    categoryCounts,
    conclusions,
    inventoryHash
  };
  const inventory = { ...withoutHash, contentHash: canonicalHash(withoutHash) };
  assertMessageFree(inventory.conclusions);
  return inventory;
}

export function deriveMessageSpanCorpusCommitment(input: {
  triggerBytes: Uint8Array;
  assetStoreBytes: Uint8Array;
  checkpointDatabasePath: string;
}): MessageSpanGateInventoryV1["corpusCommitment"] {
  const trigger = parseMessageSpanGateTrigger(input.triggerBytes);
  if (trigger.assetStoreSnapshotHash !== sha256(input.assetStoreBytes)) {
    throw new Error("Message Span Gate corpus commitment does not use the frozen trigger snapshot.");
  }
  const store = parseFormalAssetStore(input.assetStoreBytes);
  const index = exactArtifact(store.indexes, trigger.sourceIndex, "corpus source index");
  const checkpoint = loadLatestExactIndexWorkflowInput(input.checkpointDatabasePath, index);
  const corpus = extractAdmittedMessageCorpus(checkpoint.workflowInput, index);
  return {
    checkpointId: checkpoint.checkpointId,
    workflowInputHash: sha256(JSON.stringify(checkpoint.workflowInput)),
    admittedMessageCorpusHash: sha256(JSON.stringify(corpus.messages)),
    admittedMessageCount: corpus.messages.length
  };
}

export function parseMessageSpanGateInventory(bytes: Uint8Array): MessageSpanGateInventoryV1 {
  const raw = asRecord(parseJsonBytes(bytes, "message-free inventory"));
  assertExactKeys(raw, [
    "schema",
    "status",
    "armReceiptHash",
    "eligibilityPolicyHash",
    "triggerReceiptHash",
    "triggerProposal",
    "sourceIndex",
    "sourceDossiers",
    "corpusCommitment",
    "categoryCounts",
    "conclusions",
    "inventoryHash",
    "contentHash"
  ], "message-free inventory");
  if (!raw || raw.schema !== MESSAGE_SPAN_GATE_INVENTORY_SCHEMA || raw.status !== "frozen" ||
    !isSha256(raw.armReceiptHash) || !isSha256(raw.eligibilityPolicyHash) ||
    !isSha256(raw.triggerReceiptHash) || !isSha256(raw.inventoryHash) || !isSha256(raw.contentHash)) {
    throw new Error("Message Span Gate message-free inventory identity is invalid.");
  }
  const { contentHash, ...withoutHash } = raw;
  if (canonicalHash(withoutHash) !== contentHash) {
    throw new Error("Message Span Gate message-free inventory content hash is invalid.");
  }
  if (!Array.isArray(raw.conclusions) || raw.conclusions.length === 0) {
    throw new Error("Message Span Gate message-free inventory has no conclusions.");
  }
  assertMessageFree(raw.conclusions);
  const conclusions = raw.conclusions.map((value, ordinal) => parseMessageFreeConclusion(value, ordinal));
  if (new Set(conclusions.map((item) => item.conclusionId)).size !== conclusions.length ||
    canonicalHash(conclusions) !== raw.inventoryHash) {
    throw new Error("Message Span Gate message-free inventory conclusion hash or identity is invalid.");
  }
  const corpusCommitment = asRecord(raw.corpusCommitment);
  assertExactKeys(corpusCommitment, [
    "checkpointId",
    "workflowInputHash",
    "admittedMessageCorpusHash",
    "admittedMessageCount"
  ], "message-free corpus commitment");
  if (!corpusCommitment || typeof corpusCommitment.checkpointId !== "string" || !corpusCommitment.checkpointId ||
    !isSha256(corpusCommitment.workflowInputHash) ||
    !isSha256(corpusCommitment.admittedMessageCorpusHash) ||
    !Number.isSafeInteger(corpusCommitment.admittedMessageCount) || Number(corpusCommitment.admittedMessageCount) < 0) {
    throw new Error("Message Span Gate message-free inventory corpus commitment is invalid.");
  }
  const categoryCounts = countConclusionCategories(conclusions);
  assertExactKeys(asRecord(raw.categoryCounts), ["typed", "narrative", "participation", "crossSession"],
    "message-free category counts");
  if (canonicalJson(categoryCounts) !== canonicalJson(raw.categoryCounts)) {
    throw new Error("Message Span Gate message-free inventory category counts are invalid.");
  }
  parseArmProposalReference(raw.triggerProposal, "message-free trigger proposal");
  parseTriggerArtifactReference(raw.sourceIndex, "index", "message-free source index");
  if (!Array.isArray(raw.sourceDossiers)) throw new Error("Message Span Gate message-free dossier refs are invalid.");
  raw.sourceDossiers.forEach((reference, ordinal) =>
    parseTriggerArtifactReference(reference, "dossier", `message-free source dossier ${ordinal}`)
  );
  return raw as unknown as MessageSpanGateInventoryV1;
}

export function adjudicateMessageSpanEligibility(input: {
  policyBytes: Uint8Array;
  inventoryBytes: Uint8Array;
  reviewerABytes: Uint8Array;
  reviewerBBytes: Uint8Array;
}): MessageSpanEligibilityResultV1 {
  const policy = parseMessageSpanEligibilityPolicy(input.policyBytes);
  const inventory = parseMessageSpanGateInventory(input.inventoryBytes);
  if (inventory.eligibilityPolicyHash !== policy.contentHash) {
    throw new Error("Message Span Gate eligibility inventory does not bind the supplied policy.");
  }
  const reviewerA = parseEligibilityReview(input.reviewerABytes, "A", policy, inventory);
  const reviewerB = parseEligibilityReview(input.reviewerBBytes, "B", policy, inventory);
  const byA = new Map(reviewerA.annotations.map((item) => [item.conclusionId, item]));
  const byB = new Map(reviewerB.annotations.map((item) => [item.conclusionId, item]));
  const exclusionCodeDistribution = emptyEligibilityCodeDistribution();
  for (const review of [reviewerA, reviewerB]) {
    for (const annotation of review.annotations) {
      if (annotation.exclusionCode) exclusionCodeDistribution[annotation.exclusionCode] += 1;
    }
  }
  const results = inventory.conclusions.map((conclusion): MessageSpanEligibilityResultItemV1 => {
    const a = byA.get(conclusion.conclusionId);
    const b = byB.get(conclusion.conclusionId);
    if (!a || !b) throw new Error(`Message Span Gate eligibility lost ${conclusion.conclusionId}.`);
    const agreement = a.verdict === b.verdict && a.exclusionCode === b.exclusionCode;
    return {
      conclusionId: conclusion.conclusionId,
      category: conclusion.category,
      reviewerA: { verdict: a.verdict, exclusionCode: a.exclusionCode },
      reviewerB: { verdict: b.verdict, exclusionCode: b.exclusionCode },
      agreement,
      ...(agreement ? { finalEligibility: a.verdict } : {})
    };
  });
  const baseWithoutHash = {
    schema: MESSAGE_SPAN_ELIGIBILITY_RESULT_SCHEMA,
    inventoryContentHash: inventory.contentHash,
    eligibilityPolicyHash: policy.contentHash,
    reviewerHashes: {
      A: sha256(input.reviewerABytes),
      B: sha256(input.reviewerBBytes)
    },
    agreementCount: results.filter((item) => item.agreement).length,
    exclusionCodeDistribution,
    results
  };
  if (results.some((item) => !item.agreement)) {
    const withoutHash = { ...baseWithoutHash, status: "needs-adjudication" as const };
    return { ...withoutHash, contentHash: canonicalHash(withoutHash) };
  }
  const eligiblePools = emptyConclusionPools();
  for (const result of results) {
    if (result.finalEligibility === "eligible") eligiblePools[result.category].push(result.conclusionId);
  }
  for (const category of Object.keys(eligiblePools) as MessageSpanConclusionCategory[]) {
    eligiblePools[category].sort();
  }
  const withoutHash = { ...baseWithoutHash, status: "final" as const, eligiblePools };
  return { ...withoutHash, contentHash: canonicalHash(withoutHash) };
}

export function parseMessageSpanEligibilityResult(bytes: Uint8Array): MessageSpanEligibilityResultV1 {
  const raw = asRecord(parseJsonBytes(bytes, "eligibility result"));
  if (!raw || raw.schema !== MESSAGE_SPAN_ELIGIBILITY_RESULT_SCHEMA ||
    (raw.status !== "final" && raw.status !== "needs-adjudication") ||
    !isSha256(raw.inventoryContentHash) || !isSha256(raw.eligibilityPolicyHash) || !isSha256(raw.contentHash)) {
    throw new Error("Message Span Gate eligibility result identity is invalid.");
  }
  const { contentHash, ...withoutHash } = raw;
  if (canonicalHash(withoutHash) !== contentHash) {
    throw new Error("Message Span Gate eligibility result content hash is invalid.");
  }
  return raw as unknown as MessageSpanEligibilityResultV1;
}

export function sampleFormalMessageSpanGate(input: {
  policyBytes: Uint8Array;
  triggerBytes: Uint8Array;
  inventoryBytes: Uint8Array;
  eligibilityResultBytes: Uint8Array;
  reviewerABytes: Uint8Array;
  reviewerBBytes: Uint8Array;
}): MessageSpanFormalSampleV1 {
  const policy = parseMessageSpanEligibilityPolicy(input.policyBytes);
  const trigger = parseMessageSpanGateTrigger(input.triggerBytes);
  const inventory = parseMessageSpanGateInventory(input.inventoryBytes);
  const suppliedEligibility = parseMessageSpanEligibilityResult(input.eligibilityResultBytes);
  const eligibility = adjudicateMessageSpanEligibility({
    policyBytes: input.policyBytes,
    inventoryBytes: input.inventoryBytes,
    reviewerABytes: input.reviewerABytes,
    reviewerBBytes: input.reviewerBBytes
  });
  if (canonicalJson(suppliedEligibility) !== canonicalJson(eligibility)) {
    throw new Error("Message Span Gate supplied eligibility result does not equal fresh A/B adjudication.");
  }
  if (trigger.eligibilityPolicyHash !== policy.contentHash ||
    inventory.eligibilityPolicyHash !== policy.contentHash ||
    inventory.triggerReceiptHash !== trigger.contentHash ||
    eligibility.eligibilityPolicyHash !== policy.contentHash ||
    eligibility.inventoryContentHash !== inventory.contentHash) {
    throw new Error("Message Span Gate formal sample inputs do not share one frozen lineage.");
  }
  if (eligibility.status !== "final") {
    throw new Error("Message Span Gate formal sampling is blocked by eligibility disagreement.");
  }
  const deficits = (Object.keys(MESSAGE_SPAN_GATE_QUOTAS) as MessageSpanConclusionCategory[]).flatMap((category) => {
    const available = eligibility.eligiblePools[category].length;
    const required = MESSAGE_SPAN_GATE_QUOTAS[category];
    return available < required ? [{ category, required, available }] : [];
  });
  const common = {
    schema: MESSAGE_SPAN_FORMAL_SAMPLE_SCHEMA,
    triggerProposal: trigger.triggerProposal,
    eligibilityPolicyHash: policy.contentHash,
    triggerReceiptHash: trigger.contentHash,
    inventoryContentHash: inventory.contentHash,
    eligibilityResultHash: eligibility.contentHash
  };
  if (deficits.length > 0) {
    const withoutHash = { ...common, status: "failed" as const, reason: "quota-deficit" as const, deficits };
    return { ...withoutHash, contentHash: canonicalHash(withoutHash) };
  }
  const byId = new Map(inventory.conclusions.map((item) => [item.conclusionId, item]));
  const triggerKey = proposalReferenceKey(trigger.triggerProposal);
  const conclusions = (Object.keys(MESSAGE_SPAN_GATE_QUOTAS) as MessageSpanConclusionCategory[]).flatMap((category) =>
    eligibility.eligiblePools[category]
      .map((conclusionId) => {
        const conclusion = byId.get(conclusionId);
        if (!conclusion || conclusion.category !== category) {
          throw new Error(`Message Span Gate eligible pool invented ${conclusionId}.`);
        }
        return {
          ...conclusion,
          samplingHash: sha256(
            `${policy.publicSeed}|${policy.contentHash}|${triggerKey}|${conclusionId}`
          )
        };
      })
      .sort((left, right) => left.samplingHash.localeCompare(right.samplingHash) ||
        left.conclusionId.localeCompare(right.conclusionId))
      .slice(0, MESSAGE_SPAN_GATE_QUOTAS[category])
  );
  const withoutHash = {
    ...common,
    status: "frozen" as const,
    samplingFormula: MESSAGE_SPAN_FORMAL_SAMPLING_FORMULA,
    quotas: MESSAGE_SPAN_GATE_QUOTAS,
    fallback: "none" as const,
    conclusions
  };
  return { ...withoutHash, contentHash: canonicalHash(withoutHash) };
}

export function buildEligibleConclusionInventory(
  index: TodayWorklineIndexV1,
  dossiers: TodayWorklineDossierV1[]
): EligibleMessageSpanConclusion[] {
  const candidates: EligibleMessageSpanConclusion[] = [];
  const indexReference = artifactReference("index", index);

  index.worklines.forEach((workline, worklineOrdinal) => {
    const pointer = `/worklines/${worklineOrdinal}`;
    const crossSession = workline.sessionIds.length > 1;
    addTextAtoms(candidates, {
      category: crossSession ? "crossSession" : "narrative",
      subtype: crossSession ? "workline-summary-aggregate" : "workline-summary",
      text: workline.summary,
      sourceArtifact: indexReference,
      jsonPointer: `${pointer}/summary`,
      declaredEvidenceIds: workline.evidenceIds,
      declaredSessionIds: workline.sessionIds
    });
    addTextAtoms(candidates, {
      category: "narrative",
      subtype: "workline-current-stop",
      text: workline.currentStop,
      sourceArtifact: indexReference,
      jsonPointer: `${pointer}/currentStop`,
      declaredEvidenceIds: workline.evidenceIds,
      declaredSessionIds: workline.sessionIds
    });
    if (workline.participation.status === "described") {
      for (const role of ["human", "joint"] as const) {
        const text = workline.participation[role];
        if (!text) continue;
        addTextAtoms(candidates, {
          category: "participation",
          subtype: `participation-${role}`,
          text,
          sourceArtifact: indexReference,
          jsonPointer: `${pointer}/participation/${role}`,
          declaredEvidenceIds: workline.evidenceIds,
          declaredSessionIds: workline.sessionIds
        });
      }
    }
  });

  dossiers.forEach((dossier) => {
    const dossierReference = artifactReference("dossier", dossier);
    const sessionIds = dossier.admittedSessionIds;
    const summaryEvidenceIds = dossier.content.evidenceIds;
    addTextAtoms(candidates, {
      category: "narrative",
      subtype: "dossier-prior-context",
      text: dossier.content.priorContext,
      sourceArtifact: dossierReference,
      jsonPointer: "/content/priorContext",
      declaredEvidenceIds: summaryEvidenceIds,
      declaredSessionIds: sessionIds
    });
    addTextAtoms(candidates, {
      category: sessionIds.length > 1 ? "crossSession" : "narrative",
      subtype: sessionIds.length > 1 ? "dossier-what-happened-aggregate" : "dossier-what-happened",
      text: dossier.content.whatHappened,
      sourceArtifact: dossierReference,
      jsonPointer: "/content/whatHappened",
      declaredEvidenceIds: summaryEvidenceIds,
      declaredSessionIds: sessionIds
    });
    for (const [groupName, claims] of [
      ["supportingEvidence", dossier.content.supportingEvidence],
      ["opposingEvidence", dossier.content.opposingEvidence]
    ] as const) {
      claims.forEach((claim, claimOrdinal) => addTextAtoms(candidates, {
        category: "typed",
        subtype: groupName === "supportingEvidence" ? "supporting-claim" : "opposing-claim",
        text: claim.claim,
        sourceArtifact: dossierReference,
        jsonPointer: `/content/${groupName}/${claimOrdinal}/claim`,
        declaredEvidenceIds: claim.evidenceIds,
        declaredSessionIds: sessionIdsForEvidenceIds(dossier, claim.evidenceIds)
      }));
    }
  });

  const byId = new Map<string, EligibleMessageSpanConclusion>();
  for (const candidate of candidates) {
    const previous = byId.get(candidate.conclusionId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(candidate)) {
      throw new Error(`Message Span Gate conclusion identity collision: ${candidate.conclusionId}`);
    }
    byId.set(candidate.conclusionId, candidate);
  }
  return [...byId.values()].sort((left, right) => left.conclusionId.localeCompare(right.conclusionId));
}

export function sampleMessageSpanConclusions(input: {
  inventory: EligibleMessageSpanConclusion[];
  evidenceManifestId: string;
  seed: string;
}): { conclusions: SampledMessageSpanConclusion[]; coverageDeficits: MessageSpanCoverageDeficit[] } {
  const manifestId = requiredText(input.evidenceManifestId, "evidenceManifestId");
  const seed = requiredText(input.seed, "seed");
  const ids = new Set<string>();
  for (const conclusion of input.inventory) {
    if (ids.has(conclusion.conclusionId)) {
      throw new Error(`Message Span Gate inventory contains duplicate conclusionId ${conclusion.conclusionId}.`);
    }
    ids.add(conclusion.conclusionId);
  }
  const ranked = Object.fromEntries(
    (Object.keys(MESSAGE_SPAN_GATE_QUOTAS) as MessageSpanConclusionCategory[]).map((category) => [
      category,
      input.inventory
        .filter((conclusion) => conclusion.category === category)
        .map((conclusion) => ({
          ...conclusion,
          samplingHash: sha256(`${manifestId}|${conclusion.conclusionId}|${seed}`)
        }))
        .sort((left, right) => left.samplingHash.localeCompare(right.samplingHash) ||
          left.conclusionId.localeCompare(right.conclusionId))
    ])
  ) as Record<MessageSpanConclusionCategory, Array<EligibleMessageSpanConclusion & { samplingHash: string }>>;

  const primary = {
    typed: ranked.typed.slice(0, MESSAGE_SPAN_GATE_QUOTAS.typed),
    narrative: ranked.narrative.slice(0, MESSAGE_SPAN_GATE_QUOTAS.narrative),
    participation: ranked.participation.slice(0, MESSAGE_SPAN_GATE_QUOTAS.participation),
    crossSession: ranked.crossSession.slice(0, MESSAGE_SPAN_GATE_QUOTAS.crossSession)
  };
  const typedMissing = MESSAGE_SPAN_GATE_QUOTAS.typed - primary.typed.length;
  const narrativeMissing = MESSAGE_SPAN_GATE_QUOTAS.narrative - primary.narrative.length;
  const typedFallback = ranked.narrative.slice(
    MESSAGE_SPAN_GATE_QUOTAS.narrative,
    MESSAGE_SPAN_GATE_QUOTAS.narrative + typedMissing
  );
  const narrativeFallback = ranked.typed.slice(
    MESSAGE_SPAN_GATE_QUOTAS.typed,
    MESSAGE_SPAN_GATE_QUOTAS.typed + narrativeMissing
  );
  const coverageDeficits: MessageSpanCoverageDeficit[] = [];
  for (const category of Object.keys(MESSAGE_SPAN_GATE_QUOTAS) as MessageSpanConclusionCategory[]) {
    const required = MESSAGE_SPAN_GATE_QUOTAS[category];
    const available = ranked[category].length;
    if (available >= required) continue;
    coverageDeficits.push({
      category,
      required,
      available,
      missing: required - available,
      fallbackCategory: category === "typed"
        ? "narrative"
        : category === "narrative"
          ? "typed"
          : null,
      fallbackFilled: category === "typed"
        ? typedFallback.length
        : category === "narrative"
          ? narrativeFallback.length
          : 0
    });
  }
  const selected: SampledMessageSpanConclusion[] = [
    ...primary.typed.map((item) => sampledConclusion(item, "typed", "primary")),
    ...typedFallback.map((item) => sampledConclusion(item, "typed", "fallback")),
    ...primary.narrative.map((item) => sampledConclusion(item, "narrative", "primary")),
    ...narrativeFallback.map((item) => sampledConclusion(item, "narrative", "fallback")),
    ...primary.participation.map((item) => sampledConclusion(item, "participation", "primary")),
    ...primary.crossSession.map((item) => sampledConclusion(item, "crossSession", "primary"))
  ];
  if (selected.length !== MESSAGE_SPAN_GATE_SAMPLE_SIZE) {
    const inventoryCounts = Object.fromEntries(
      (Object.keys(MESSAGE_SPAN_GATE_QUOTAS) as MessageSpanConclusionCategory[])
        .map((category) => [category, ranked[category].length])
    );
    throw new Error(
      `Message Span Gate requires exactly ${MESSAGE_SPAN_GATE_SAMPLE_SIZE} conclusions after the declared ` +
      `typed<->narrative fallback; selected ${selected.length}. Inventory=${JSON.stringify(inventoryCounts)}.`
    );
  }
  return { conclusions: selected, coverageDeficits };
}

export function extractAdmittedMessageCorpus(
  workflowInput: StructuredTodayIndexWorkflowInput,
  index: TodayWorklineIndexV1
): { messages: AdmittedMessageEvidence[]; syntheticOmissionsExcluded: number } {
  assertExactWorkflowInputIdentity(workflowInput, index);
  const admittedSessionIds = new Set(index.sessions.map((session) => session.sessionId));
  const messages: AdmittedMessageEvidence[] = [];
  let syntheticOmissionsExcluded = 0;
  for (const item of workflowInput.sessions) {
    if (!admittedSessionIds.has(item.session.sessionId)) continue;
    const evidenceLocators = item.evidence.filter((evidence) =>
      evidence.sourceKind === "session" &&
      evidence.sessionId === item.session.sessionId &&
      evidence.provider === item.session.provider
    );
    if (evidenceLocators.length !== 1) {
      throw new Error(`Message Span Gate requires one exact Session evidence locator for ${item.session.sessionId}.`);
    }
    const evidence = evidenceLocators[0];
    if (!evidence) throw new Error(`Message Span Gate lost evidence for ${item.session.sessionId}.`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(item.evidenceText) as unknown;
    } catch {
      throw new Error(`Message Span Gate evidenceText is not JSON for Session ${item.session.sessionId}.`);
    }
    const rawMessages = asRecord(parsed)?.messages;
    if (rawMessages === undefined) continue;
    if (!Array.isArray(rawMessages)) {
      throw new Error(`Message Span Gate evidenceText messages are invalid for Session ${item.session.sessionId}.`);
    }
    rawMessages.forEach((rawMessage, messageOrdinal) => {
      const message = asRecord(rawMessage);
      if (!message || typeof message.id !== "string" || typeof message.content !== "string" ||
        (message.role !== "user" && message.role !== "assistant")) {
        throw new Error(`Message Span Gate found an invalid admitted message in Session ${item.session.sessionId}.`);
      }
      if (isSyntheticOmission(message)) {
        syntheticOmissionsExcluded += 1;
        return;
      }
      const timestamp = typeof message.timestamp === "string" ? message.timestamp : null;
      messages.push({
        evidenceId: evidence.evidenceId,
        sessionId: item.session.sessionId,
        provider: item.session.provider,
        messageId: message.id,
        messageOrdinal,
        role: message.role,
        timestamp,
        content: message.content,
        contentHash: sha256(message.content)
      });
    });
  }
  return { messages, syntheticOmissionsExcluded };
}

export function loadLatestExactIndexWorkflowInput(
  checkpointDatabasePath: string,
  index: TodayWorklineIndexV1
): LoadedCheckpointInput {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(requiredText(checkpointDatabasePath, "checkpoint database path"), {
      readOnly: true
    });
    const table = database.prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'checkpoints'"
    ).get() as { present?: number } | undefined;
    if (table?.present !== 1) throw new Error("checkpoints table is missing");
    const row = database.prepare(`
      SELECT checkpoint_id, type, checkpoint
      FROM checkpoints
      WHERE thread_id = ? AND checkpoint_ns = ''
      ORDER BY checkpoint_id DESC
      LIMIT 1
    `).get(index.workflowRunId) as {
      checkpoint_id: string;
      type: string | null;
      checkpoint: string | Uint8Array;
    } | undefined;
    if (!row) throw new Error(`no checkpoint exists for thread ${index.workflowRunId}`);
    if ((row.type ?? "json") !== "json") {
      throw new Error(`unsupported checkpoint serializer ${String(row.type)}`);
    }
    const checkpoint = JSON.parse(blobText(row.checkpoint)) as unknown;
    const channelValues = asRecord(checkpoint)?.channel_values;
    let workflowInputRaw = asRecord(channelValues)?.input;
    const inputHash = asRecord(workflowInputRaw)?.__workContinuityInputRef;
    if (typeof inputHash === "string") {
      const frozen = database.prepare("SELECT type, value FROM workflow_items WHERE thread_id = ? AND item_id = '__workflow_input__'")
        .get(index.workflowRunId) as { type: string; value: Uint8Array } | undefined;
      if (!frozen || frozen.type !== "json" || createHash("sha256").update(frozen.value).digest("hex") !== inputHash) {
        throw new Error("frozen workflow input is missing or corrupt");
      }
      workflowInputRaw = JSON.parse(blobText(frozen.value));
    }
    const parsed = StructuredTodayIndexWorkflowInputSchema.safeParse(workflowInputRaw);
    if (!parsed.success) throw new Error("latest checkpoint has no exact Structured Today index input");
    assertExactWorkflowInputIdentity(parsed.data, index);
    return { checkpointId: row.checkpoint_id, workflowInput: parsed.data };
  } catch (error) {
    throw new Error(`Message Span Gate checkpoint unavailable: ${errorMessage(error)}`);
  } finally {
    database?.close();
  }
}

function loadGateArtifacts(assetStorePath: string, logicalDate: string): LoadedGateArtifacts {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(requiredText(assetStorePath, "asset store path"), "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Message Span Gate asset store unavailable: ${errorMessage(error)}`);
  }
  const document = asRecord(raw);
  const activeByDate = asRecord(document?.activeStructuredIndexByDate);
  const active = asRecord(activeByDate?.[logicalDate]);
  if (!active) throw new Error(`Message Span Gate has no active Structured Today index for ${logicalDate}.`);
  const indexes = Array.isArray(document?.structuredIndexes) ? document.structuredIndexes : [];
  const exactIndexes = indexes.flatMap((candidate) => {
    const parsed = TodayWorklineIndexSchema.safeParse(candidate);
    if (!parsed.success || validateStructuredTodayIndex(parsed.data).length > 0) return [];
    return exactReferenceMatches(parsed.data, active) ? [parsed.data] : [];
  });
  if (exactIndexes.length !== 1 || exactIndexes[0]?.logicalDate !== logicalDate) {
    throw new Error("Message Span Gate active Structured Today index does not resolve exactly once.");
  }
  const index = exactIndexes[0];
  const dossiersByWorkline = new Map<string, TodayWorklineDossierV1>();
  const dossierCandidates = Array.isArray(document?.structuredDossiers) ? document.structuredDossiers : [];
  for (const candidate of dossierCandidates) {
    const parsed = TodayWorklineDossierSchema.safeParse(candidate);
    if (!parsed.success || validateStructuredTodayDossier(parsed.data).length > 0 ||
      !exactReferenceMatches(index, parsed.data.sourceIndex)) continue;
    const previous = dossiersByWorkline.get(parsed.data.worklineId);
    if (!previous || parsed.data.revision > previous.revision) {
      dossiersByWorkline.set(parsed.data.worklineId, parsed.data);
    } else if (parsed.data.revision === previous.revision && parsed.data.contentHash !== previous.contentHash) {
      throw new Error(`Message Span Gate found conflicting dossier revision for ${parsed.data.worklineId}.`);
    }
  }
  return {
    index,
    dossiers: [...dossiersByWorkline.values()].sort((left, right) =>
      left.worklineId.localeCompare(right.worklineId) || left.revision - right.revision
    )
  };
}

function assertExactWorkflowInputIdentity(
  workflowInput: StructuredTodayIndexWorkflowInput,
  index: TodayWorklineIndexV1
): void {
  if (
    workflowInput.logicalDate !== index.logicalDate ||
    workflowInput.workflowRunId !== index.workflowRunId ||
    workflowInput.artifactId !== index.artifactId ||
    workflowInput.revision !== index.revision ||
    workflowInput.evidenceManifestId !== index.evidenceManifestId ||
    JSON.stringify(workflowInput.sessions.map((item) => item.session)) !== JSON.stringify(index.sessions) ||
    JSON.stringify(workflowInput.evidence) !== JSON.stringify(index.evidence)
  ) {
    throw new Error("Message Span Gate checkpoint input does not exactly match the active index.");
  }
}

function addTextAtoms(
  output: EligibleMessageSpanConclusion[],
  input: Omit<ConclusionCandidateInput, "atomOrdinal">
): void {
  conclusionAtoms(input.text).forEach((text, atomOrdinal) => addAtomicCandidate(output, {
    ...input,
    text,
    atomOrdinal
  }));
}

function addAtomicCandidate(
  output: EligibleMessageSpanConclusion[],
  input: ConclusionCandidateInput
): void {
  const text = input.text.trim();
  if (!text) return;
  const textHash = sha256(text);
  const sourceIdentity = `${input.sourceArtifact.kind}:${input.sourceArtifact.artifactId}:` +
    `${input.sourceArtifact.revision}:${input.sourceArtifact.contentHash}`;
  const conclusionId = `conclusion-${sha256(
    `${sourceIdentity}|${input.jsonPointer}|${input.atomOrdinal}|${textHash}`
  ).slice(0, 32)}`;
  output.push({
    conclusionId,
    category: input.category,
    subtype: input.subtype,
    text,
    textHash,
    sourceArtifact: input.sourceArtifact,
    jsonPointer: input.jsonPointer,
    atomOrdinal: input.atomOrdinal,
    declaredEvidenceIds: uniqueSorted(input.declaredEvidenceIds),
    declaredSessionIds: uniqueSorted(input.declaredSessionIds)
  });
}

function conclusionAtoms(text: string): string[] {
  return text
    .split(/(?<=[。！？!?；;])\s*|\n+/u)
    .map((item) => item.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/u, "").trim())
    .filter(Boolean);
}

function sessionIdsForEvidenceIds(dossier: TodayWorklineDossierV1, evidenceIds: string[]): string[] {
  const selected = new Set(evidenceIds);
  return uniqueSorted(dossier.evidence.flatMap((evidence) =>
    selected.has(evidence.evidenceId) && evidence.sessionId ? [evidence.sessionId] : []
  ));
}

function sampledConclusion(
  conclusion: EligibleMessageSpanConclusion & { samplingHash: string },
  quotaSlot: MessageSpanConclusionCategory,
  selection: "primary" | "fallback"
): SampledMessageSpanConclusion {
  return { ...conclusion, quotaSlot, selection };
}

function artifactReference(
  kind: "index" | "dossier",
  artifact: { artifactId: string; revision: number; contentHash: string }
): MessageSpanArtifactReference {
  return {
    kind,
    artifactId: artifact.artifactId,
    revision: artifact.revision,
    contentHash: artifact.contentHash
  };
}

function exactReferenceMatches(
  artifact: { artifactId: string; revision: number; contentHash: string },
  reference: Record<string, unknown>
): boolean {
  return artifact.artifactId === reference.artifactId &&
    artifact.revision === reference.revision &&
    artifact.contentHash === reference.contentHash;
}

function isSyntheticOmission(message: Record<string, unknown>): boolean {
  return message.id === "structured-today-omission" &&
    message.role === "assistant" &&
    message.content === "[中间消息因模型输入预算省略]";
}

interface FormalAssetStore {
  indexes: TodayWorklineIndexV1[];
  dossiers: TodayWorklineDossierV1[];
  reflections: StructuredTodayReflectionV1[];
  proposals: StructuredTodayProposalArtifactV1[];
}

function buildPolicyFromBindings(input: {
  armReceiptHash: string;
  publicSeed: string;
  preTriggerAssetStoreHash: string;
  verifiedFrontierHash: string;
  verifiedFrontierCount: number;
}): MessageSpanEligibilityPolicyV1 {
  const withoutHash = {
    schema: MESSAGE_SPAN_ELIGIBILITY_POLICY_SCHEMA,
    status: "frozen" as const,
    armReceiptHash: input.armReceiptHash,
    publicSeed: input.publicSeed,
    preTriggerAssetStoreHash: input.preTriggerAssetStoreHash,
    verifiedFrontierHash: input.verifiedFrontierHash,
    verifiedFrontierCount: input.verifiedFrontierCount,
    preTriggerStatus: "waiting" as const,
    extractorVersion: "message-span-inventory-extractor/v1" as const,
    atomizerVersion: "message-span-conclusion-atomizer/v1" as const,
    codebookVersion: "message-span-gate-codebook/v1" as const,
    fieldAllowlist: MESSAGE_SPAN_FORMAL_FIELD_ALLOWLIST,
    quotas: MESSAGE_SPAN_GATE_QUOTAS,
    fallback: "none" as const,
    eligibilityCodebook: MESSAGE_SPAN_ELIGIBILITY_CODES,
    evidenceFailureCodebook: MESSAGE_SPAN_EVIDENCE_FAILURE_CODES,
    integrityCodebook: MESSAGE_SPAN_INTEGRITY_CODES,
    reviewProtocol: {
      reviewers: ["A", "B"] as ["A", "B"],
      blind: true as const,
      completeInventoryCoverage: true as const,
      disagreement: "needs-adjudication" as const,
      corpusReveal: "after-final-sample-only" as const
    },
    samplingFormula: MESSAGE_SPAN_FORMAL_SAMPLING_FORMULA,
    triggerOrderingFormula: MESSAGE_SPAN_TRIGGER_ORDERING_FORMULA,
    relevantCorpus: "source-index-digest-admitted/v1" as const,
    decisionFormula: "agreement=10 && consensusPass>=9 && F5=0 && F7=0 && integrity=0" as const
  };
  return { ...withoutHash, contentHash: canonicalHash(withoutHash) };
}

function parseArmProposalReference(value: unknown, label: string): MessageSpanGateArmProposalReferenceV1 {
  const raw = asRecord(value);
  assertExactKeys(raw, ["logicalDate", "artifactId", "revision", "contentHash", "worklineId"], label);
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/u.test(String(raw.logicalDate)) ||
    typeof raw.artifactId !== "string" || !raw.artifactId ||
    !Number.isSafeInteger(raw.revision) || Number(raw.revision) <= 0 ||
    !isSha256(raw.contentHash) || typeof raw.worklineId !== "string" || !raw.worklineId) {
    throw new Error(`Message Span Gate ${label} is invalid.`);
  }
  return {
    logicalDate: String(raw.logicalDate),
    artifactId: raw.artifactId,
    revision: Number(raw.revision),
    contentHash: raw.contentHash,
    worklineId: raw.worklineId
  };
}

function compareArmProposalReferences(
  left: MessageSpanGateArmProposalReferenceV1,
  right: MessageSpanGateArmProposalReferenceV1
): number {
  return left.artifactId.localeCompare(right.artifactId) ||
    left.revision - right.revision ||
    left.contentHash.localeCompare(right.contentHash) ||
    left.logicalDate.localeCompare(right.logicalDate) ||
    left.worklineId.localeCompare(right.worklineId);
}

function proposalReferenceKey(value: {
  artifactId: string;
  revision: number;
  contentHash: string;
}): string {
  return JSON.stringify([value.artifactId, value.revision, value.contentHash]);
}

function proposalArtifactReference(artifact: StructuredTodayProposalArtifactV1): MessageSpanGateArmProposalReferenceV1 {
  return {
    logicalDate: artifact.logicalDate,
    artifactId: artifact.artifactId,
    revision: artifact.revision,
    contentHash: artifact.contentHash,
    worklineId: artifact.worklineId
  };
}

function verifyPreTriggerState(
  arm: MessageSpanGateArmV1,
  assetStoreBytes: Uint8Array
): { assetStoreSnapshotHash: string; frontierCount: number } {
  const store = parseFormalAssetStore(assetStoreBytes);
  const current = store.proposals.map(proposalArtifactReference);
  const currentByKey = new Map(current.map((reference) => [proposalReferenceKey(reference), reference]));
  for (const armed of arm.proposalFrontier) {
    const resolved = currentByKey.get(proposalReferenceKey(armed));
    if (!resolved || canonicalJson(resolved) !== canonicalJson(armed)) {
      throw new Error(`Message Span Gate armed frontier proposal no longer resolves exactly: ${armed.artifactId}.`);
    }
  }
  const frontier = new Set(arm.proposalFrontier.map(proposalReferenceKey));
  if (current.some((reference) => !frontier.has(proposalReferenceKey(reference)))) {
    throw new Error("Message Span Gate eligibility policy freeze is too late: a frontier delta already exists.");
  }
  return { assetStoreSnapshotHash: sha256(assetStoreBytes), frontierCount: arm.proposalFrontier.length };
}

function parseFormalAssetStore(bytes: Uint8Array): FormalAssetStore {
  const raw = asRecord(parseJsonBytes(bytes, "formal asset store"));
  if (!raw || raw.schemaVersion !== 1) throw new Error("Message Span Gate formal asset store schema is invalid.");
  const indexes = parseArtifactArray(raw.structuredIndexes, TodayWorklineIndexSchema, validateStructuredTodayIndex, "index");
  const dossiers = parseArtifactArray(raw.structuredDossiers, TodayWorklineDossierSchema, validateStructuredTodayDossier, "dossier");
  const reflections = parseSchemaArray(raw.structuredReflections, StructuredTodayReflectionSchema, "reflection");
  const proposals = parseSchemaArray(raw.structuredProposals, StructuredTodayProposalArtifactSchema, "proposal");
  assertUniqueRevisionIdentity(indexes, "index");
  assertUniqueRevisionIdentity(dossiers, "dossier");
  assertUniqueRevisionIdentity(reflections.map((item) => ({
    artifactId: item.reflectionId,
    revision: item.revision,
    contentHash: item.contentHash
  })), "reflection");
  assertUniqueRevisionIdentity(proposals, "proposal");
  return { indexes, dossiers, reflections, proposals };
}

function parseArtifactArray<T extends { artifactId: string; revision: number; contentHash: string }>(
  value: unknown,
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } },
  validate: (artifact: T) => string[],
  label: string
): T[] {
  if (!Array.isArray(value)) return [];
  return value.map((candidate, ordinal) => {
    const parsed = schema.safeParse(candidate);
    const issues = parsed.success ? validate(parsed.data) : [];
    if (!parsed.success || issues.length > 0) {
      throw new Error(
        `Message Span Gate formal ${label} ${ordinal} failed integrity validation` +
        `${issues.length > 0 ? `: ${issues.join(" ")}` : "."}`
      );
    }
    return parsed.data;
  });
}

function parseSchemaArray<T>(
  value: unknown,
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } },
  label: string
): T[] {
  if (!Array.isArray(value)) return [];
  return value.map((candidate, ordinal) => {
    const parsed = schema.safeParse(candidate);
    if (!parsed.success) throw new Error(`Message Span Gate formal ${label} ${ordinal} is invalid.`);
    return parsed.data;
  });
}

function assertUniqueRevisionIdentity(
  artifacts: Array<{ artifactId: string; revision: number; contentHash: string }>,
  label: string
): void {
  const identities = new Set<string>();
  for (const artifact of artifacts) {
    const key = JSON.stringify([artifact.artifactId, artifact.revision]);
    if (identities.has(key)) throw new Error(`Message Span Gate formal store duplicates ${label} revision ${key}.`);
    identities.add(key);
  }
}

function resolveFormalProposalLineage(
  store: FormalAssetStore,
  reference: MessageSpanGateArmProposalReferenceV1
): {
  proposal: StructuredTodayProposalArtifactV1;
  reflection: StructuredTodayReflectionV1;
  dossier: TodayWorklineDossierV1;
  index: TodayWorklineIndexV1;
} {
  const proposal = exactArtifact(store.proposals, reference, "frontier delta proposal");
  const reflectionMatches = store.reflections.filter((item) =>
    item.reflectionId === proposal.sourceReflection.reflectionId &&
    item.revision === proposal.sourceReflection.revision &&
    item.contentHash === proposal.sourceReflection.contentHash
  );
  if (reflectionMatches.length !== 1) throw new Error("Message Span Gate proposal source reflection does not resolve exactly once.");
  const reflection = reflectionMatches[0]!;
  const dossier = exactArtifact(store.dossiers, proposal.sourceDossier, "proposal source dossier");
  const index = exactArtifact(store.indexes, dossier.sourceIndex, "dossier source index");
  const proposalIssues = validateStructuredTodayProposalArtifact(proposal, reflection);
  if (proposal.logicalDate !== reflection.logicalDate ||
    proposal.logicalDate !== dossier.logicalDate ||
    proposal.logicalDate !== index.logicalDate ||
    proposal.worklineId !== reflection.worklineId ||
    proposal.worklineId !== dossier.worklineId ||
    !sameArtifactReference(reflection.sourceDossier, dossier) ||
    !index.worklines.some((workline) => workline.worklineId === dossier.worklineId) ||
    proposalIssues.length > 0) {
    throw new Error(
      `Message Span Gate proposal lineage failed exact validation` +
      `${proposalIssues.length > 0 ? `: ${proposalIssues.join(" ")}` : "."}`
    );
  }
  return { proposal, reflection, dossier, index };
}

function compareFormalTriggerCandidates(
  left: ReturnType<typeof resolveFormalProposalLineage>,
  right: ReturnType<typeof resolveFormalProposalLineage>
): number {
  // This comparator is the executable form of MESSAGE_SPAN_TRIGGER_ORDERING_FORMULA.
  return left.reflection.savedAt.localeCompare(right.reflection.savedAt) ||
    left.proposal.artifactId.localeCompare(right.proposal.artifactId) ||
    left.proposal.revision - right.proposal.revision ||
    left.proposal.contentHash.localeCompare(right.proposal.contentHash);
}

function exactArtifact<T extends { artifactId: string; revision: number; contentHash: string }>(
  artifacts: T[],
  reference: { artifactId: string; revision: number; contentHash: string },
  label: string
): T {
  const matches = artifacts.filter((item) => sameArtifactReference(item, reference));
  if (matches.length !== 1) throw new Error(`Message Span Gate ${label} does not resolve exactly once.`);
  return matches[0]!;
}

function sameArtifactReference(
  left: { artifactId: string; revision: number; contentHash: string },
  right: { artifactId: string; revision: number; contentHash: string }
): boolean {
  return left.artifactId === right.artifactId && left.revision === right.revision && left.contentHash === right.contentHash;
}

function selectInventoryDossiers(
  dossiers: TodayWorklineDossierV1[],
  index: TodayWorklineIndexV1,
  triggerDossier: TodayWorklineDossierV1
): Array<MessageSpanArtifactReference & { kind: "dossier"; worklineId: string }> {
  const byWorkline = new Map<string, TodayWorklineDossierV1>();
  byWorkline.set(triggerDossier.worklineId, triggerDossier);
  for (const dossier of dossiers) {
    if (!sameArtifactReference(dossier.sourceIndex, index) || dossier.worklineId === triggerDossier.worklineId) continue;
    const previous = byWorkline.get(dossier.worklineId);
    if (!previous || dossier.revision > previous.revision) byWorkline.set(dossier.worklineId, dossier);
  }
  return [...byWorkline.values()]
    .sort((left, right) => left.worklineId.localeCompare(right.worklineId))
    .map((dossier) => ({
      ...artifactReference("dossier", dossier),
      kind: "dossier" as const,
      worklineId: dossier.worklineId
    }));
}

function parseTriggerReflection(value: unknown): MessageSpanGateTriggerV1["sourceReflection"] {
  const raw = asRecord(value);
  assertExactKeys(raw, ["reflectionId", "revision", "contentHash", "savedAt"], "trigger reflection");
  if (!raw || typeof raw.reflectionId !== "string" || !raw.reflectionId ||
    !Number.isSafeInteger(raw.revision) || Number(raw.revision) <= 0 ||
    !isSha256(raw.contentHash) || !validTimestamp(raw.savedAt)) {
    throw new Error("Message Span Gate trigger reflection is invalid.");
  }
  return {
    reflectionId: raw.reflectionId,
    revision: Number(raw.revision),
    contentHash: raw.contentHash,
    savedAt: String(raw.savedAt)
  };
}

function parseTriggerArtifactReference<K extends "index" | "dossier">(
  value: unknown,
  kind: K,
  label: string
): MessageSpanArtifactReference & { kind: K } {
  const raw = asRecord(value);
  assertExactKeys(
    raw,
    kind === "index"
      ? ["kind", "artifactId", "revision", "contentHash", "logicalDate"]
      : ["kind", "artifactId", "revision", "contentHash", "worklineId"],
    label
  );
  if (!raw || raw.kind !== kind || typeof raw.artifactId !== "string" || !raw.artifactId ||
    !Number.isSafeInteger(raw.revision) || Number(raw.revision) <= 0 || !isSha256(raw.contentHash)) {
    throw new Error(`Message Span Gate ${label} is invalid.`);
  }
  return {
    kind,
    artifactId: raw.artifactId,
    revision: Number(raw.revision),
    contentHash: raw.contentHash
  };
}

function stripConclusionAuthority(conclusion: EligibleMessageSpanConclusion): MessageFreeConclusionV1 {
  return {
    conclusionId: conclusion.conclusionId,
    category: conclusion.category,
    subtype: conclusion.subtype,
    text: conclusion.text,
    textHash: conclusion.textHash,
    sourceArtifact: conclusion.sourceArtifact,
    jsonPointer: conclusion.jsonPointer,
    atomOrdinal: conclusion.atomOrdinal
  };
}

function collectArtifactAuthorityValues(
  index: TodayWorklineIndexV1,
  dossiers: TodayWorklineDossierV1[]
): string[] {
  const values = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === "string" && value.length >= 4) values.add(value);
  };
  for (const value of [
    index.artifactId,
    index.contentHash,
    index.workflowRunId,
    index.evidenceManifestId,
    ...index.worklines.map((workline) => workline.worklineId)
  ]) add(value);
  for (const session of index.sessions) {
    add(session.sessionId);
    add(session.sourcePath);
    session.evidenceIds.forEach(add);
  }
  for (const evidence of index.evidence) {
    add(evidence.evidenceId);
    add(evidence.sessionId);
    add(evidence.sourcePath);
    add(evidence.range);
    add(evidence.contentHash);
  }
  for (const dossier of dossiers) {
    add(dossier.artifactId);
    add(dossier.contentHash);
    add(dossier.workflowRunId);
    add(dossier.worklineId);
    add(dossier.sourceIndex.artifactId);
    add(dossier.sourceIndex.contentHash);
    dossier.admittedSessionIds.forEach(add);
    dossier.content.evidenceIds.forEach(add);
    for (const evidence of dossier.evidence) {
      add(evidence.evidenceId);
      add(evidence.sessionId);
      add(evidence.sourcePath);
      add(evidence.range);
      add(evidence.contentHash);
    }
  }
  return [...values].sort((left, right) => right.length - left.length || left.localeCompare(right));
}

function assertConclusionTextDoesNotLeakAuthority(
  conclusions: Array<{ conclusionId: string; text: string }>,
  authorityValues: string[]
): void {
  for (const conclusion of conclusions) {
    if (authorityValues.some((value) => conclusion.text.includes(value))) {
      throw new Error(
        `Message Span Gate message-free conclusion ${conclusion.conclusionId} leaked an exact authority value.`
      );
    }
  }
}

function parseMessageFreeConclusion(value: unknown, ordinal: number): MessageFreeConclusionV1 {
  const raw = asRecord(value);
  assertExactKeys(raw, [
    "conclusionId",
    "category",
    "subtype",
    "text",
    "textHash",
    "sourceArtifact",
    "jsonPointer",
    "atomOrdinal"
  ], `message-free conclusion ${ordinal}`);
  if (!raw || typeof raw.conclusionId !== "string" || !raw.conclusionId ||
    !isConclusionCategory(raw.category) || typeof raw.subtype !== "string" || !raw.subtype ||
    typeof raw.text !== "string" || !raw.text || !isSha256(raw.textHash) || sha256(raw.text) !== raw.textHash ||
    typeof raw.jsonPointer !== "string" || !raw.jsonPointer.startsWith("/") ||
    !Number.isSafeInteger(raw.atomOrdinal) || Number(raw.atomOrdinal) < 0) {
    throw new Error(`Message Span Gate message-free conclusion ${ordinal} is invalid.`);
  }
  const source = asRecord(raw.sourceArtifact);
  assertExactKeys(source, ["kind", "artifactId", "revision", "contentHash"],
    `message-free conclusion ${ordinal} source`);
  if (!source || (source.kind !== "index" && source.kind !== "dossier") ||
    typeof source.artifactId !== "string" || !source.artifactId ||
    !Number.isSafeInteger(source.revision) || Number(source.revision) <= 0 || !isSha256(source.contentHash)) {
    throw new Error(`Message Span Gate message-free conclusion ${ordinal} source is invalid.`);
  }
  return raw as unknown as MessageFreeConclusionV1;
}

function assertMessageFree(value: unknown): void {
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    const record = asRecord(candidate);
    if (!record) return;
    for (const [key, nested] of Object.entries(record)) {
      if (/(?:evidence|session|message|corpus|locator)/iu.test(key)) {
        throw new Error(`Message Span Gate message-free inventory leaked forbidden field ${key}.`);
      }
      visit(nested);
    }
  };
  visit(value);
}

function countConclusionCategories(
  conclusions: Array<{ category: MessageSpanConclusionCategory }>
): Record<MessageSpanConclusionCategory, number> {
  const counts = { typed: 0, narrative: 0, participation: 0, crossSession: 0 };
  for (const conclusion of conclusions) counts[conclusion.category] += 1;
  return counts;
}

function emptyConclusionPools(): Record<MessageSpanConclusionCategory, string[]> {
  return { typed: [], narrative: [], participation: [], crossSession: [] };
}

function emptyEligibilityCodeDistribution(): Record<MessageSpanEligibilityCode, number> {
  return { E1: 0, E2: 0, E3: 0, E4: 0, E5: 0, E6: 0, E7: 0, E8: 0 };
}

function parseEligibilityReview(
  bytes: Uint8Array,
  expectedReviewer: "A" | "B",
  policy: MessageSpanEligibilityPolicyV1,
  inventory: MessageSpanGateInventoryV1
): MessageSpanEligibilityReviewV1 {
  const raw = asRecord(parseJsonBytes(bytes, `eligibility reviewer ${expectedReviewer}`));
  assertExactKeys(raw, [
    "schema",
    "inventoryContentHash",
    "eligibilityPolicyHash",
    "reviewer",
    "blind",
    "annotations"
  ], `eligibility reviewer ${expectedReviewer}`);
  if (!raw || raw.schema !== MESSAGE_SPAN_ELIGIBILITY_REVIEW_SCHEMA ||
    raw.inventoryContentHash !== inventory.contentHash || raw.eligibilityPolicyHash !== policy.contentHash ||
    raw.reviewer !== expectedReviewer || raw.blind !== true || !Array.isArray(raw.annotations) ||
    raw.annotations.length !== inventory.conclusions.length) {
    throw new Error(`Message Span Gate eligibility reviewer ${expectedReviewer} identity or coverage is invalid.`);
  }
  const expectedIds = new Set(inventory.conclusions.map((item) => item.conclusionId));
  const seen = new Set<string>();
  const annotations = raw.annotations.map((value, ordinal) => {
    const annotation = asRecord(value);
    assertExactKeys(annotation, ["conclusionId", "verdict", "exclusionCode", "rationale"],
      `eligibility annotation ${expectedReviewer}/${ordinal}`);
    const conclusionId = recordText(annotation, "conclusionId", `eligibility annotation ${ordinal} conclusionId`);
    if (!expectedIds.has(conclusionId) || seen.has(conclusionId)) {
      throw new Error(`Message Span Gate eligibility reviewer ${expectedReviewer} has unknown or duplicate ${conclusionId}.`);
    }
    seen.add(conclusionId);
    const verdict = annotation?.verdict;
    const exclusionCode = annotation?.exclusionCode;
    if (verdict === "eligible") {
      if (exclusionCode !== null) throw new Error("Eligible conclusion cannot carry an exclusion code.");
    } else if (verdict === "ineligible") {
      if (!isEligibilityCode(exclusionCode)) throw new Error("Ineligible conclusion requires one E1-E8 code.");
    } else {
      throw new Error("Message Span Gate eligibility verdict is invalid.");
    }
    return {
      conclusionId,
      verdict: verdict as "eligible" | "ineligible",
      exclusionCode: exclusionCode as MessageSpanEligibilityCode | null,
      rationale: recordText(annotation, "rationale", `eligibility annotation ${ordinal} rationale`)
    };
  });
  return {
    schema: MESSAGE_SPAN_ELIGIBILITY_REVIEW_SCHEMA,
    inventoryContentHash: inventory.contentHash,
    eligibilityPolicyHash: policy.contentHash,
    reviewer: expectedReviewer,
    blind: true,
    annotations
  };
}

function isEligibilityCode(value: unknown): value is MessageSpanEligibilityCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MESSAGE_SPAN_ELIGIBILITY_CODES, value);
}

function isConclusionCategory(value: unknown): value is MessageSpanConclusionCategory {
  return value === "typed" || value === "narrative" || value === "participation" || value === "crossSession";
}

function validTimestamp(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function assertExactKeys(
  record: Record<string, unknown> | undefined,
  keys: string[],
  label: string
): void {
  if (!record || canonicalJson(Object.keys(record).sort()) !== canonicalJson([...keys].sort())) {
    throw new Error(`Message Span Gate ${label} fields are invalid.`);
  }
}

function canonicalHash(value: unknown): string {
  return sha256(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseFrozenGatePack(bytes: Uint8Array): MessageSpanGateV1 {
  const raw = parseJsonBytes(bytes, "frozen pack");
  const pack = asRecord(raw);
  if (!pack || pack.schema !== MESSAGE_SPAN_GATE_SCHEMA || pack.phase !== "gate-a" || pack.status !== "frozen") {
    throw new Error("Message Span Gate frozen pack schema, phase, or status is invalid.");
  }
  const batchId = recordText(pack, "batchId", "frozen pack batchId");
  const logicalDate = requiredLogicalDate(recordText(pack, "logicalDate", "frozen pack logicalDate"));
  const seed = recordText(pack, "seed", "frozen pack seed");
  const conclusionsRaw = pack.conclusions;
  if (!Array.isArray(conclusionsRaw) || conclusionsRaw.length !== MESSAGE_SPAN_GATE_SAMPLE_SIZE) {
    throw new Error("Message Span Gate frozen pack must contain exactly 10 conclusions.");
  }
  const conclusionIds = conclusionsRaw.map((candidate, ordinal) =>
    recordText(asRecord(candidate), "conclusionId", `frozen conclusion ${ordinal} conclusionId`)
  );
  if (new Set(conclusionIds).size !== MESSAGE_SPAN_GATE_SAMPLE_SIZE) {
    throw new Error("Message Span Gate frozen pack conclusion IDs are not unique.");
  }
  const messagesRaw = pack.admittedMessages;
  if (!Array.isArray(messagesRaw)) throw new Error("Message Span Gate frozen pack admitted corpus is invalid.");
  const messageTupleIds = new Set<string>();
  messagesRaw.forEach((candidate, ordinal) => {
    const message = asRecord(candidate);
    if (!message ||
      typeof message.evidenceId !== "string" || !message.evidenceId ||
      typeof message.sessionId !== "string" || !message.sessionId ||
      (message.provider !== "codex" && message.provider !== "claude") ||
      typeof message.messageId !== "string" || !message.messageId ||
      !Number.isSafeInteger(message.messageOrdinal) || Number(message.messageOrdinal) < 0 ||
      (message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string" ||
      typeof message.contentHash !== "string" || message.contentHash !== sha256(message.content)) {
      throw new Error(`Message Span Gate frozen corpus message ${ordinal} is invalid.`);
    }
    const tupleId = messageTupleKey(message as unknown as AdmittedMessageEvidence);
    if (messageTupleIds.has(tupleId)) {
      throw new Error(`Message Span Gate frozen corpus has a duplicate message tuple at ${ordinal}.`);
    }
    messageTupleIds.add(tupleId);
  });
  const manifest = asRecord(pack.manifest);
  if (!manifest ||
    manifest.admittedMessageCount !== messagesRaw.length ||
    manifest.admittedMessageCorpusHash !== sha256(JSON.stringify(messagesRaw))) {
    throw new Error("Message Span Gate frozen pack admitted corpus manifest is invalid.");
  }
  const artifacts = asRecord(pack.artifacts);
  const index = asRecord(artifacts?.index);
  if (!index ||
    typeof index.artifactId !== "string" || !index.artifactId ||
    !Number.isSafeInteger(index.revision) || Number(index.revision) <= 0 ||
    !isSha256(index.contentHash)) {
    throw new Error("Message Span Gate frozen pack index reference is invalid.");
  }
  const expectedBatchId = `gate-a-${sha256(JSON.stringify({
    logicalDate,
    seed,
    index,
    conclusions: conclusionIds,
    admittedMessageCorpusHash: manifest.admittedMessageCorpusHash
  })).slice(0, 32)}`;
  if (batchId !== expectedBatchId) throw new Error("Message Span Gate frozen pack batchId is invalid.");
  return pack as unknown as MessageSpanGateV1;
}

function parseGateReview(
  bytes: Uint8Array,
  expectedReviewer: "A" | "B",
  pack: MessageSpanGateV1,
  packHash: string
): MessageSpanGateReviewV1 {
  const raw = parseJsonBytes(bytes, `reviewer ${expectedReviewer}`);
  const review = asRecord(raw);
  if (!review || review.schema !== MESSAGE_SPAN_GATE_REVIEW_SCHEMA) {
    throw new Error(`Message Span Gate reviewer ${expectedReviewer} schema is invalid.`);
  }
  if (review.batchId !== pack.batchId || review.packSha256 !== packHash) {
    throw new Error(`Message Span Gate reviewer ${expectedReviewer} pack SHA or batchId does not match.`);
  }
  if (review.reviewer !== expectedReviewer || review.blind !== true) {
    throw new Error(`Message Span Gate reviewer ${expectedReviewer} identity or blind flag is invalid.`);
  }
  if (!Array.isArray(review.annotations) || review.annotations.length !== MESSAGE_SPAN_GATE_SAMPLE_SIZE) {
    throw new Error(`Message Span Gate reviewer ${expectedReviewer} must provide exactly 10 annotations.`);
  }
  const expectedIds = new Set(pack.conclusions.map((conclusion) => conclusion.conclusionId));
  const seen = new Set<string>();
  const annotations = review.annotations.map((candidate, ordinal): MessageSpanGateReviewAnnotationV1 => {
    const annotation = asRecord(candidate);
    const conclusionId = recordText(
      annotation,
      "conclusionId",
      `reviewer ${expectedReviewer} annotation ${ordinal} conclusionId`
    );
    if (!expectedIds.has(conclusionId)) {
      throw new Error(`Message Span Gate reviewer ${expectedReviewer} references unknown annotation ${conclusionId}.`);
    }
    if (seen.has(conclusionId)) {
      throw new Error(`Message Span Gate reviewer ${expectedReviewer} duplicates annotation ${conclusionId}.`);
    }
    seen.add(conclusionId);
    const verdict = annotation?.verdict;
    if (verdict !== "pass" && verdict !== "fail") {
      throw new Error(`Message Span Gate reviewer ${expectedReviewer} annotation ${conclusionId} verdict is invalid.`);
    }
    const rationale = recordText(
      annotation,
      "rationale",
      `reviewer ${expectedReviewer} annotation ${conclusionId} rationale`
    );
    const spansRaw = annotation?.spans;
    if (!Array.isArray(spansRaw)) {
      throw new Error(`Message Span Gate reviewer ${expectedReviewer} annotation ${conclusionId} spans are invalid.`);
    }
    const failureCode = annotation?.failureCode;
    if (verdict === "pass") {
      if (failureCode !== null || spansRaw.length < 1 || spansRaw.length > 3) {
        throw new Error(
          `Message Span Gate reviewer ${expectedReviewer} pass annotation ${conclusionId} needs 1-3 spans and null failureCode.`
        );
      }
    } else if (!isFailureCode(failureCode) || spansRaw.length !== 0) {
      throw new Error(
        `Message Span Gate reviewer ${expectedReviewer} fail annotation ${conclusionId} needs one F1-F8 code and no spans.`
      );
    }
    const spans = spansRaw.map((span, spanOrdinal) => parseAndValidateReviewSpan(
      span,
      pack.admittedMessages,
      expectedReviewer,
      conclusionId,
      spanOrdinal
    ));
    const quotedCodePoints = spans.reduce((sum, span) => sum + [...span.exactQuote].length, 0);
    if (quotedCodePoints > 2_000) {
      throw new Error(
        `Message Span Gate reviewer ${expectedReviewer} annotation ${conclusionId} exceeds 2000 quoted Unicode code points.`
      );
    }
    return {
      conclusionId,
      verdict,
      failureCode: failureCode as MessageSpanGateFailureCode | null,
      spans,
      rationale
    };
  });
  const missing = [...expectedIds].filter((conclusionId) => !seen.has(conclusionId));
  if (missing.length > 0) {
    throw new Error(`Message Span Gate reviewer ${expectedReviewer} is missing annotations: ${missing.join(", ")}.`);
  }
  return {
    schema: MESSAGE_SPAN_GATE_REVIEW_SCHEMA,
    batchId: pack.batchId,
    packSha256: packHash,
    reviewer: expectedReviewer,
    blind: true,
    annotations
  };
}

function parseAndValidateReviewSpan(
  value: unknown,
  corpus: AdmittedMessageEvidence[],
  reviewer: "A" | "B",
  conclusionId: string,
  spanOrdinal: number
): MessageSpanGateReviewSpanV1 {
  const span = asRecord(value);
  if (!span ||
    typeof span.evidenceId !== "string" || !span.evidenceId ||
    typeof span.sessionId !== "string" || !span.sessionId ||
    (span.provider !== "codex" && span.provider !== "claude") ||
    typeof span.messageId !== "string" || !span.messageId ||
    !Number.isSafeInteger(span.messageOrdinal) || Number(span.messageOrdinal) < 0 ||
    (span.role !== "user" && span.role !== "assistant") ||
    typeof span.exactQuote !== "string" || span.exactQuote.length === 0) {
    throw new Error(`Message Span Gate reviewer ${reviewer} annotation ${conclusionId} span ${spanOrdinal} is invalid.`);
  }
  const normalized: MessageSpanGateReviewSpanV1 = {
    evidenceId: span.evidenceId,
    sessionId: span.sessionId,
    provider: span.provider,
    messageId: span.messageId,
    messageOrdinal: Number(span.messageOrdinal),
    role: span.role,
    exactQuote: span.exactQuote
  };
  const tupleMatches = corpus.filter((message) => messageTupleKey(message) === messageTupleKey(normalized));
  if (tupleMatches.length !== 1) {
    throw new Error(
      `Message Span Gate reviewer ${reviewer} annotation ${conclusionId} span ${spanOrdinal} has a forged or ambiguous message tuple.`
    );
  }
  const message = tupleMatches[0];
  if (!message || countExactOccurrences(message.content, normalized.exactQuote) !== 1) {
    throw new Error(
      `Message Span Gate reviewer ${reviewer} annotation ${conclusionId} span ${spanOrdinal} quote is not one unique verbatim substring.`
    );
  }
  return normalized;
}

function messageTupleKey(value: {
  evidenceId: string;
  sessionId: string;
  provider: "codex" | "claude" | "copilot";
  messageId: string;
  messageOrdinal: number;
  role: "user" | "assistant";
}): string {
  return JSON.stringify([
    value.evidenceId,
    value.sessionId,
    value.provider,
    value.messageId,
    value.messageOrdinal,
    value.role
  ]);
}

function countExactOccurrences(content: string, quote: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= content.length - quote.length) {
    const found = content.indexOf(quote, offset);
    if (found < 0) break;
    count += 1;
    if (count > 1) return count;
    offset = found + 1;
  }
  return count;
}

function emptyFailureCodeDistribution(): Record<MessageSpanGateFailureCode, number> {
  return { F1: 0, F2: 0, F3: 0, F4: 0, F5: 0, F6: 0, F7: 0, F8: 0 };
}

function isFailureCode(value: unknown): value is MessageSpanGateFailureCode {
  return typeof value === "string" && /^(?:F[1-8])$/u.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function parseJsonBytes(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(`Message Span Gate ${label} JSON is invalid: ${errorMessage(error)}`);
  }
}

function recordText(
  record: Record<string, unknown> | undefined,
  key: string,
  label: string
): string {
  const value = record?.[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Message Span Gate ${label} is invalid.`);
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function blobText(value: string | Uint8Array): string {
  return typeof value === "string" ? value : Buffer.from(value).toString("utf8");
}

function sha256(value: string | Uint8Array): string {
  const hash = createHash("sha256");
  return (typeof value === "string" ? hash.update(value, "utf8") : hash.update(value)).digest("hex");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function requiredText(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Message Span Gate ${label} is required.`);
  return value;
}

function requiredLogicalDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error("Message Span Gate logical date is invalid.");
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
