import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  adjudicateMessageSpanGate,
  adjudicateMessageSpanEligibility,
  buildMessageSpanEligibilityPolicy,
  buildMessageSpanGateInventory,
  detectMessageSpanGateTrigger,
  deriveMessageSpanCorpusCommitment,
  extractAdmittedMessageCorpus,
  loadLatestExactIndexWorkflowInput,
  parseMessageSpanEligibilityPolicy,
  parseMessageSpanGateArm,
  parseMessageSpanGateInventory,
  sampleFormalMessageSpanGate,
  sampleMessageSpanConclusions,
  type EligibleMessageSpanConclusion
} from "../src/message-span-gate";
import type {
  StructuredTodayIndexWorkflowInput,
  TodayWorklineIndexV1
} from "../src/structured-today-contracts";
import {
  canonicalContentHash,
  sha256Text,
  StructuredTodayProposalArtifactSchema,
  TodayWorklineDossierSchema
} from "../src/structured-today-contracts";
import { NodeSqliteSaver } from "../src/langgraph-node-sqlite-checkpointer";

test("Message Span Gate applies the fixed 6/2/1/1 quota deterministically", () => {
  const inventory = [
    ...inventoryItems("typed", 10),
    ...inventoryItems("narrative", 5),
    ...inventoryItems("participation", 3),
    ...inventoryItems("crossSession", 3)
  ];
  const first = sampleMessageSpanConclusions({
    inventory,
    evidenceManifestId: "manifest-fixed",
    seed: "review-1"
  });
  const second = sampleMessageSpanConclusions({
    inventory: [...inventory].reverse(),
    evidenceManifestId: "manifest-fixed",
    seed: "review-1"
  });

  assert.deepEqual(first, second);
  assert.equal(first.conclusions.length, 10);
  assert.deepEqual(countBy(first.conclusions, (item) => item.quotaSlot), {
    typed: 6,
    narrative: 2,
    participation: 1,
    crossSession: 1
  });
  assert.deepEqual(first.coverageDeficits, []);
});

test("Message Span Gate only falls back between typed and narrative and records the deficit", () => {
  const result = sampleMessageSpanConclusions({
    inventory: [
      ...inventoryItems("typed", 4),
      ...inventoryItems("narrative", 4),
      ...inventoryItems("participation", 1),
      ...inventoryItems("crossSession", 1)
    ],
    evidenceManifestId: "manifest-fallback",
    seed: "review-2"
  });

  assert.equal(result.conclusions.length, 10);
  assert.equal(result.conclusions.filter((item) => item.quotaSlot === "typed" && item.selection === "fallback").length, 2);
  assert.deepEqual(result.coverageDeficits, [{
    category: "typed",
    required: 6,
    available: 4,
    missing: 2,
    fallbackCategory: "narrative",
    fallbackFilled: 2
  }]);
});

test("Message Span Gate fails closed when the declared policy cannot produce exactly ten", () => {
  assert.throws(() => sampleMessageSpanConclusions({
    inventory: [
      ...inventoryItems("typed", 8),
      ...inventoryItems("narrative", 3),
      ...inventoryItems("crossSession", 1)
    ],
    evidenceManifestId: "manifest-short",
    seed: "review-3"
  }), /requires exactly 10 conclusions.*selected 9/u);
});

test("Message Span Gate fails closed when the exact index checkpoint is missing", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "message-span-gate-missing-"));
  try {
    assert.throws(() => loadLatestExactIndexWorkflowInput(
      path.join(temporaryRoot, "missing.sqlite"),
      minimalIndex()
    ), /checkpoint unavailable/u);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("Message Span Gate preserves actual checkpoint messages and excludes the synthetic omission", () => {
  const index = minimalIndex();
  const workflowInput = {
    logicalDate: index.logicalDate,
    workflowRunId: index.workflowRunId,
    artifactId: index.artifactId,
    revision: index.revision,
    evidenceManifestId: index.evidenceManifestId,
    sessions: [{
      session: index.sessions[0],
      evidence: index.evidence,
      evidenceText: JSON.stringify({
        coverage: "partial",
        messages: [
          { id: "m-1", role: "user", timestamp: "2026-08-29T09:00:00.000Z", content: "first" },
          { id: "structured-today-omission", role: "assistant", content: "[中间消息因模型输入预算省略]" },
          { id: "m-2", role: "assistant", content: "second" }
        ]
      })
    }],
    evidence: index.evidence
  } as unknown as StructuredTodayIndexWorkflowInput;

  const corpus = extractAdmittedMessageCorpus(workflowInput, index);

  assert.equal(corpus.syntheticOmissionsExcluded, 1);
  assert.deepEqual(corpus.messages.map((message) => ({
    evidenceId: message.evidenceId,
    sessionId: message.sessionId,
    provider: message.provider,
    messageId: message.messageId,
    messageOrdinal: message.messageOrdinal,
    role: message.role,
    timestamp: message.timestamp,
    content: message.content,
    hashLength: message.contentHash.length
  })), [
    {
      evidenceId: "evidence-1",
      sessionId: "session-1",
      provider: "codex",
      messageId: "m-1",
      messageOrdinal: 0,
      role: "user",
      timestamp: "2026-08-29T09:00:00.000Z",
      content: "first",
      hashLength: 64
    },
    {
      evidenceId: "evidence-1",
      sessionId: "session-1",
      provider: "codex",
      messageId: "m-2",
      messageOrdinal: 2,
      role: "assistant",
      timestamp: null,
      content: "second",
      hashLength: 64
    }
  ]);
});

test("Message Span Gate adjudication emits a valid final 5/10 failure receipt", () => {
  const fixture = adjudicationFixture();
  const receipt = adjudicateMessageSpanGate(
    fixture.packBytes,
    jsonBytes(fixture.reviewA),
    jsonBytes(fixture.reviewB)
  );

  assert.equal(receipt.schema, "message-span-gate-result/v1");
  assert.equal(receipt.status, "final");
  assert.equal(receipt.decision, "fail");
  assert.equal(receipt.threshold, 9);
  assert.deepEqual(receipt.reviewerPassCounts, { A: 5, B: 5 });
  assert.equal(receipt.verdictAgreement, 10);
  assert.equal(receipt.consensusPass, 5);
  assert.deepEqual(receipt.failureCodeDistribution, {
    F1: 10,
    F2: 0,
    F3: 0,
    F4: 0,
    F5: 0,
    F6: 0,
    F7: 0,
    F8: 0
  });
  assert.match(receipt.packHash, /^[a-f0-9]{64}$/u);
  assert.match(receipt.reviewerHashes.A, /^[a-f0-9]{64}$/u);
  assert.match(receipt.reviewerHashes.B, /^[a-f0-9]{64}$/u);
});

test("Message Span Gate adjudication rejects forged quotes and message tuples", () => {
  const quoteFixture = adjudicationFixture();
  quoteFixture.reviewA.annotations[0]!.spans[0]!.exactQuote = "not present";
  assert.throws(() => adjudicateMessageSpanGate(
    quoteFixture.packBytes,
    jsonBytes(quoteFixture.reviewA),
    jsonBytes(quoteFixture.reviewB)
  ), /not one unique verbatim substring/u);

  const tupleFixture = adjudicationFixture();
  tupleFixture.reviewA.annotations[0]!.spans[0]!.sessionId = "forged-session";
  assert.throws(() => adjudicateMessageSpanGate(
    tupleFixture.packBytes,
    jsonBytes(tupleFixture.reviewA),
    jsonBytes(tupleFixture.reviewB)
  ), /forged or ambiguous message tuple/u);
});

test("Message Span Gate adjudication rejects duplicate and missing annotations", () => {
  const duplicateFixture = adjudicationFixture();
  duplicateFixture.reviewA.annotations[9] = structuredClone(duplicateFixture.reviewA.annotations[0]!);
  assert.throws(() => adjudicateMessageSpanGate(
    duplicateFixture.packBytes,
    jsonBytes(duplicateFixture.reviewA),
    jsonBytes(duplicateFixture.reviewB)
  ), /duplicates annotation/u);

  const missingFixture = adjudicationFixture();
  missingFixture.reviewA.annotations.pop();
  assert.throws(() => adjudicateMessageSpanGate(
    missingFixture.packBytes,
    jsonBytes(missingFixture.reviewA),
    jsonBytes(missingFixture.reviewB)
  ), /exactly 10 annotations/u);
});

test("Message Span Gate adjudication withholds decision on verdict disagreement", () => {
  const fixture = adjudicationFixture();
  fixture.reviewB.annotations[0] = {
    ...fixture.reviewB.annotations[0]!,
    verdict: "fail",
    failureCode: "F2",
    spans: [],
    rationale: "Reviewer B does not accept the direct support."
  };
  const receipt = adjudicateMessageSpanGate(
    fixture.packBytes,
    jsonBytes(fixture.reviewA),
    jsonBytes(fixture.reviewB)
  );

  assert.equal(receipt.status, "needs-adjudication");
  assert.equal(receipt.verdictAgreement, 9);
  assert.equal(receipt.consensusPass, 4);
  assert.equal("decision" in receipt, false);
});

test("formal eligibility policy is deterministic, arm-bound, and tamper evident", () => {
  const fixture = formalFixture();
  const first = buildMessageSpanEligibilityPolicy(fixture.armBytes, fixture.waitingStoreBytes);
  const second = buildMessageSpanEligibilityPolicy(fixture.armBytes, fixture.waitingStoreBytes);
  assert.deepEqual(first, second);
  assert.equal(first.publicSeed, "formal-public-seed");
  assert.equal(first.fallback, "none");
  assert.equal(first.codebookVersion, "message-span-gate-codebook/v1");
  assert.equal(first.triggerOrderingFormula,
    "sourceReflection.savedAt ASC -> artifactId ASC -> revision ASC -> contentHash ASC");
  assert.equal(first.decisionFormula,
    "agreement=10 && consensusPass>=9 && F5=0 && F7=0 && integrity=0");
  assert.deepEqual(first.quotas, { typed: 6, narrative: 2, participation: 1, crossSession: 1 });
  assert.deepEqual(parseMessageSpanEligibilityPolicy(jsonBytes(first)), first);

  const tampered = { ...first, publicSeed: "changed-after-freeze" };
  assert.throws(() => parseMessageSpanEligibilityPolicy(jsonBytes(tampered)), /modified/u);
  const arm = JSON.parse(fixture.armBytes.toString("utf8"));
  arm.proposalFrontier[0].worklineId = "tampered-workline";
  assert.throws(() => parseMessageSpanGateArm(jsonBytes(arm)), /frontier hash/u);
});

test("formal trigger waits on an unchanged frontier and rejects a missing armed proposal", () => {
  const fixture = formalFixture();
  const policyBytes = jsonBytes(buildMessageSpanEligibilityPolicy(fixture.armBytes, fixture.waitingStoreBytes));
  const waiting = detectMessageSpanGateTrigger({
    armBytes: fixture.armBytes,
    policyBytes,
    assetStoreBytes: fixture.waitingStoreBytes
  });
  assert.equal(waiting.status, "waiting");

  const missingStore = structuredClone(fixture.waitingStore);
  missingStore.structuredProposals = [];
  assert.throws(() => detectMessageSpanGateTrigger({
    armBytes: fixture.armBytes,
    policyBytes,
    assetStoreBytes: jsonBytes(missingStore)
  }), /frontier proposal no longer resolves exactly/u);
});

test("formal trigger selects the earliest reflection and fails closed on broken exact lineage", () => {
  const fixture = formalFixture();
  const policyBytes = jsonBytes(buildMessageSpanEligibilityPolicy(fixture.armBytes, fixture.waitingStoreBytes));
  const result = detectMessageSpanGateTrigger({
    armBytes: fixture.armBytes,
    policyBytes,
    assetStoreBytes: fixture.triggerStoreBytes
  });
  assert.equal(result.status, "triggered");
  if (result.status !== "triggered") return;
  assert.equal(result.trigger.triggerProposal.artifactId, "proposal-delta-earliest");
  assert.equal(result.trigger.sourceReflection.savedAt, "2026-08-30T11:00:00.000Z");

  const forgedLaterTrigger = structuredClone(result.trigger) as any;
  const laterProposal = (fixture.triggerStore.structuredProposals as any[])
    .find((item) => item.artifactId === "proposal-delta-later")!;
  const laterReflection = (fixture.triggerStore.structuredReflections as any[])
    .find((item) => item.reflectionId === laterProposal.sourceReflection.reflectionId)!;
  forgedLaterTrigger.triggerProposal = {
    logicalDate: laterProposal.logicalDate,
    artifactId: laterProposal.artifactId,
    revision: laterProposal.revision,
    contentHash: laterProposal.contentHash,
    worklineId: laterProposal.worklineId
  };
  forgedLaterTrigger.sourceReflection = {
    reflectionId: laterReflection.reflectionId,
    revision: laterReflection.revision,
    contentHash: laterReflection.contentHash,
    savedAt: laterReflection.savedAt
  };
  const { contentHash: _triggerHash, ...forgedTriggerHashable } = forgedLaterTrigger;
  forgedLaterTrigger.contentHash = hashCanonical(forgedTriggerHashable);
  assert.throws(() => buildMessageSpanGateInventory({
    armBytes: fixture.armBytes,
    policyBytes,
    triggerBytes: jsonBytes(forgedLaterTrigger),
    assetStoreBytes: fixture.triggerStoreBytes,
    corpusCommitment: {
      checkpointId: "checkpoint",
      workflowInputHash: "c".repeat(64),
      admittedMessageCorpusHash: "d".repeat(64),
      admittedMessageCount: 1
    }
  }), /not the deterministic first frontier delta/u);

  const broken = structuredClone(fixture.triggerStore);
  const proposal = (broken.structuredProposals as any[]).find((item: any) => item.artifactId === "proposal-delta-earliest")!;
  proposal.sourceReflection = { ...proposal.sourceReflection, reflectionId: "missing-reflection" };
  const { contentHash: _oldHash, ...withoutHash } = proposal;
  proposal.contentHash = canonicalContentHash(withoutHash);
  assert.throws(() => detectMessageSpanGateTrigger({
    armBytes: fixture.armBytes,
    policyBytes,
    assetStoreBytes: jsonBytes(broken)
  }), /source reflection does not resolve exactly once/u);
});

test("formal inventory rejects a recomputed later-proposal trigger", () => {
  const fixture = formalFixture();
  const policyBytes = jsonBytes(buildMessageSpanEligibilityPolicy(fixture.armBytes, fixture.waitingStoreBytes));
  const detection = detectMessageSpanGateTrigger({
    armBytes: fixture.armBytes,
    policyBytes,
    assetStoreBytes: fixture.triggerStoreBytes
  });
  assert.equal(detection.status, "triggered");
  if (detection.status !== "triggered") return;
  const forged = structuredClone(detection.trigger) as any;
  const proposal = (fixture.triggerStore.structuredProposals as any[])
    .find((item) => item.artifactId === "proposal-delta-later")!;
  const reflection = (fixture.triggerStore.structuredReflections as any[])
    .find((item) => item.reflectionId === proposal.sourceReflection.reflectionId)!;
  forged.triggerProposal = {
    logicalDate: proposal.logicalDate,
    artifactId: proposal.artifactId,
    revision: proposal.revision,
    contentHash: proposal.contentHash,
    worklineId: proposal.worklineId
  };
  forged.sourceReflection = {
    reflectionId: reflection.reflectionId,
    revision: reflection.revision,
    contentHash: reflection.contentHash,
    savedAt: reflection.savedAt
  };
  const { contentHash: _old, ...hashable } = forged;
  forged.contentHash = hashCanonical(hashable);
  assert.throws(() => buildMessageSpanGateInventory({
    armBytes: fixture.armBytes,
    policyBytes,
    triggerBytes: jsonBytes(forged),
    assetStoreBytes: fixture.triggerStoreBytes,
    corpusCommitment: {
      checkpointId: "checkpoint",
      workflowInputHash: "c".repeat(64),
      admittedMessageCorpusHash: "d".repeat(64),
      admittedMessageCount: 1
    }
  }), /not the deterministic first frontier delta/u);
});

test("message-free inventory binds commitments without leaking corpus, evidence, or Session IDs", () => {
  const fixture = preparedFormalFixture();
  const inventory = fixture.inventory;
  const serialized = JSON.stringify(inventory);
  assert.equal(serialized.includes("admittedMessages"), false);
  assert.equal(serialized.includes("evidenceId"), false);
  assert.equal(serialized.includes("sessionId"), false);
  assert.equal(serialized.includes("unique quote"), false);
  assert.equal(inventory.corpusCommitment.checkpointId, "checkpoint-formal-1");
  assert.deepEqual(parseMessageSpanGateInventory(jsonBytes(inventory)), inventory);

  const unknownField = structuredClone(inventory) as any;
  unknownField.uncommitted = true;
  const { contentHash: _old, ...withoutHash } = unknownField;
  unknownField.contentHash = hashCanonical(withoutHash);
  assert.throws(() => parseMessageSpanGateInventory(jsonBytes(unknownField)), /fields are invalid/u);
  assert.throws(
    () => preparedFormalFixture({ authorityLeak: true }),
    /leaked an exact authority value/u
  );
});

test("message-free inventory rejects conclusion-text authority canaries", () => {
  assert.throws(
    () => preparedFormalFixture({ authorityLeak: true }),
    /leaked an exact authority value/u
  );
});

test("blind eligibility disagreement includes exclusion-code disagreement and blocks sampling", () => {
  const fixture = preparedFormalFixture();
  const reviewA = eligibilityReview(fixture.inventory, fixture.policy, "A");
  const reviewB = eligibilityReview(fixture.inventory, fixture.policy, "B");
  reviewA.annotations[0] = {
    ...reviewA.annotations[0]!,
    verdict: "ineligible",
    exclusionCode: "E2",
    rationale: "Absence assertion."
  };
  reviewB.annotations[0] = {
    ...reviewB.annotations[0]!,
    verdict: "ineligible",
    exclusionCode: "E3",
    rationale: "Inference assertion."
  };
  const result = adjudicateMessageSpanEligibility({
    policyBytes: fixture.policyBytes,
    inventoryBytes: fixture.inventoryBytes,
    reviewerABytes: jsonBytes(reviewA),
    reviewerBBytes: jsonBytes(reviewB)
  });
  assert.equal(result.status, "needs-adjudication");
  assert.equal(result.agreementCount, fixture.inventory.conclusions.length - 1);
  assert.throws(() => sampleFormalMessageSpanGate({
    policyBytes: fixture.policyBytes,
    triggerBytes: fixture.triggerBytes,
    inventoryBytes: fixture.inventoryBytes,
    eligibilityResultBytes: jsonBytes(result),
    reviewerABytes: jsonBytes(reviewA),
    reviewerBBytes: jsonBytes(reviewB)
  }), /blocked by eligibility disagreement/u);
});

test("formal sampler uses native 6/2/1/1 only and fails rather than falling back", () => {
  const fixture = preparedFormalFixture();
  const reviewA = eligibilityReview(fixture.inventory, fixture.policy, "A");
  const reviewB = eligibilityReview(fixture.inventory, fixture.policy, "B");
  const eligibility = adjudicateMessageSpanEligibility({
    policyBytes: fixture.policyBytes,
    inventoryBytes: fixture.inventoryBytes,
    reviewerABytes: jsonBytes(reviewA),
    reviewerBBytes: jsonBytes(reviewB)
  });
  assert.equal(eligibility.status, "final");
  const forgedEligibility = structuredClone(eligibility) as any;
  forgedEligibility.eligiblePools.typed = forgedEligibility.eligiblePools.typed.slice(0, 6);
  const { contentHash: _forgedHash, ...forgedHashable } = forgedEligibility;
  forgedEligibility.contentHash = hashCanonical(forgedHashable);
  assert.throws(() => sampleFormalMessageSpanGate({
    policyBytes: fixture.policyBytes,
    triggerBytes: fixture.triggerBytes,
    inventoryBytes: fixture.inventoryBytes,
    eligibilityResultBytes: jsonBytes(forgedEligibility),
    reviewerABytes: jsonBytes(reviewA),
    reviewerBBytes: jsonBytes(reviewB)
  }), /does not equal fresh A\/B adjudication/u);
  const sample = sampleFormalMessageSpanGate({
    policyBytes: fixture.policyBytes,
    triggerBytes: fixture.triggerBytes,
    inventoryBytes: fixture.inventoryBytes,
    eligibilityResultBytes: jsonBytes(eligibility),
    reviewerABytes: jsonBytes(reviewA),
    reviewerBBytes: jsonBytes(reviewB)
  });
  assert.equal(sample.status, "frozen");
  if (sample.status === "frozen") {
    assert.deepEqual(countBy(sample.conclusions, (item) => item.category), {
      typed: 6,
      narrative: 2,
      participation: 1,
      crossSession: 1
    });
    assert.equal(sample.fallback, "none");
  }

  const typed = fixture.inventory.conclusions.filter((item) => item.category === "typed");
  for (const review of [reviewA, reviewB]) {
    for (const conclusion of typed.slice(5)) {
      const annotation = review.annotations.find((item) => item.conclusionId === conclusion.conclusionId)!;
      Object.assign(annotation, { verdict: "ineligible", exclusionCode: "E7", rationale: "Non-atomic." });
    }
  }
  const deficientEligibility = adjudicateMessageSpanEligibility({
    policyBytes: fixture.policyBytes,
    inventoryBytes: fixture.inventoryBytes,
    reviewerABytes: jsonBytes(reviewA),
    reviewerBBytes: jsonBytes(reviewB)
  });
  const failed = sampleFormalMessageSpanGate({
    policyBytes: fixture.policyBytes,
    triggerBytes: fixture.triggerBytes,
    inventoryBytes: fixture.inventoryBytes,
    eligibilityResultBytes: jsonBytes(deficientEligibility),
    reviewerABytes: jsonBytes(reviewA),
    reviewerBBytes: jsonBytes(reviewB)
  });
  assert.equal(failed.status, "failed");
  if (failed.status === "failed") assert.deepEqual(failed.deficits, [{ category: "typed", required: 6, available: 5 }]);
});

test("formal sampler rejects a rehashed forged eligibility result", () => {
  const fixture = preparedFormalFixture();
  const reviewA = eligibilityReview(fixture.inventory, fixture.policy, "A");
  const reviewB = eligibilityReview(fixture.inventory, fixture.policy, "B");
  const eligibility = adjudicateMessageSpanEligibility({
    policyBytes: fixture.policyBytes,
    inventoryBytes: fixture.inventoryBytes,
    reviewerABytes: jsonBytes(reviewA),
    reviewerBBytes: jsonBytes(reviewB)
  });
  assert.equal(eligibility.status, "final");
  const forged = structuredClone(eligibility) as any;
  forged.eligiblePools.typed = forged.eligiblePools.typed.slice(0, 6);
  const { contentHash: _old, ...hashable } = forged;
  forged.contentHash = hashCanonical(hashable);
  assert.throws(() => sampleFormalMessageSpanGate({
    policyBytes: fixture.policyBytes,
    triggerBytes: fixture.triggerBytes,
    inventoryBytes: fixture.inventoryBytes,
    eligibilityResultBytes: jsonBytes(forged),
    reviewerABytes: jsonBytes(reviewA),
    reviewerBBytes: jsonBytes(reviewB)
  }), /does not equal fresh A\/B adjudication/u);
});

test("policy CLI writes 0600 once and refuses overwrite", () => {
  const fixture = formalFixture();
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "message-span-policy-cli-"));
  try {
    const armPath = path.join(temporaryRoot, "arm.json");
    const storePath = path.join(temporaryRoot, "store.json");
    const outputPath = path.join(temporaryRoot, "policy.json");
    fs.writeFileSync(armPath, fixture.armBytes, { mode: 0o600 });
    fs.writeFileSync(storePath, fixture.waitingStoreBytes, { mode: 0o600 });
    const args = [
      "scripts/message-span-gate-policy.mjs",
      "--arm", armPath,
      "--asset-store", storePath,
      "--out", outputPath
    ];
    const first = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
    const policy = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert.equal(policy.preTriggerStatus, "waiting");
    assert.equal(policy.preTriggerAssetStoreHash, hash(fixture.waitingStoreBytes));
    const before = hash(fs.readFileSync(outputPath));
    const second = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: "utf8" });
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /EEXIST/u);
    assert.equal(hash(fs.readFileSync(outputPath)), before);

    const symlinkOutput = path.join(temporaryRoot, "symlink-policy.json");
    const symlinkTarget = path.join(temporaryRoot, "symlink-target.json");
    fs.symlinkSync(symlinkTarget, symlinkOutput);
    const symlinkAttempt = spawnSync(process.execPath, [
      "scripts/message-span-gate-policy.mjs",
      "--arm", armPath,
      "--asset-store", storePath,
      "--out", symlinkOutput
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.notEqual(symlinkAttempt.status, 0);
    assert.match(symlinkAttempt.stderr, /EEXIST/u);
    assert.equal(fs.existsSync(symlinkTarget), false);

    fs.writeFileSync(storePath, fixture.triggerStoreBytes, { mode: 0o600 });
    const lateOutput = path.join(temporaryRoot, "late-policy.json");
    const late = spawnSync(process.execPath, [
      "scripts/message-span-gate-policy.mjs",
      "--arm", armPath,
      "--asset-store", storePath,
      "--out", lateOutput
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.notEqual(late.status, 0);
    assert.match(late.stderr, /too late/u);
    assert.equal(fs.existsSync(lateOutput), false);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("formal inventory CLI derives its corpus commitment from the exact checkpoint", async () => {
  const fixture = preparedFormalFixture();
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "message-span-inventory-cli-"));
  const checkpointPath = path.join(temporaryRoot, "checkpoints.sqlite");
  const saver = NodeSqliteSaver.fromConnectionString(checkpointPath);
  try {
    const editorialText = "formal editorial contract";
    const workflowInput = {
      logicalDate: fixture.index.logicalDate,
      workflowRunId: fixture.index.workflowRunId,
      artifactId: fixture.index.artifactId,
      revision: fixture.index.revision,
      evidenceManifestId: fixture.index.evidenceManifestId,
      editorialContract: {
        ref: {
          packageId: "traceink",
          version: "formal-v1",
          editorialContractHash: sha256Text(editorialText)
        },
        text: editorialText
      },
      sessions: fixture.index.sessions.map((session, ordinal) => {
        const sessionEvidence = fixture.index.evidence.filter((item) => item.sessionId === session.sessionId);
        return {
          logicalDate: fixture.index.logicalDate,
          editorialContract: {
            ref: {
              packageId: "traceink",
              version: "formal-v1",
              editorialContractHash: sha256Text(editorialText)
            },
            text: editorialText
          },
          session,
          evidence: sessionEvidence,
          evidenceText: JSON.stringify({
            coverage: "complete",
            messages: [{ id: `message-${ordinal}`, role: ordinal === 0 ? "user" : "assistant", content: `checkpoint message ${ordinal}` }]
          })
        };
      }),
      evidence: fixture.index.evidence
    } as unknown as StructuredTodayIndexWorkflowInput;
    await saver.put(
      { configurable: { thread_id: fixture.index.workflowRunId } },
      {
        v: 4,
        id: "checkpoint-formal-1",
        ts: "2026-08-30T13:00:00.000Z",
        channel_values: { input: workflowInput },
        channel_versions: { input: 1 },
        versions_seen: {}
      },
      { source: "input", step: 0, parents: {} }
    );
    saver.close();
    const paths = {
      arm: path.join(temporaryRoot, "arm.json"),
      policy: path.join(temporaryRoot, "policy.json"),
      trigger: path.join(temporaryRoot, "trigger.json"),
      store: path.join(temporaryRoot, "store.json"),
      out: path.join(temporaryRoot, "inventory.json")
    };
    fs.writeFileSync(paths.arm, fixture.armBytes);
    fs.writeFileSync(paths.policy, fixture.policyBytes);
    fs.writeFileSync(paths.trigger, fixture.triggerBytes);
    fs.writeFileSync(paths.store, fixture.triggerStoreBytes);
    const result = spawnSync(process.execPath, [
      "scripts/message-span-gate-inventory.mjs",
      "--arm", paths.arm,
      "--policy", paths.policy,
      "--trigger", paths.trigger,
      "--asset-store", paths.store,
      "--checkpoint-db", checkpointPath,
      "--out", paths.out
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const inventory = JSON.parse(fs.readFileSync(paths.out, "utf8"));
    const expected = deriveMessageSpanCorpusCommitment({
      triggerBytes: fixture.triggerBytes,
      assetStoreBytes: fixture.triggerStoreBytes,
      checkpointDatabasePath: checkpointPath
    });
    assert.deepEqual(inventory.corpusCommitment, expected);
    assert.equal(inventory.corpusCommitment.admittedMessageCount, 2);
    assert.equal(fs.statSync(paths.out).mode & 0o777, 0o600);
    const rejected = spawnSync(process.execPath, [
      "scripts/message-span-gate-inventory.mjs",
      "--arm", paths.arm,
      "--policy", paths.policy,
      "--trigger", paths.trigger,
      "--asset-store", paths.store,
      "--checkpoint-id", "operator-chosen",
      "--out", path.join(temporaryRoot, "forged.json")
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.notEqual(rejected.status, 0);
  } finally {
    try { saver.close(); } catch { /* already closed */ }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

function formalFixture(options: { authorityLeak?: boolean } = {}) {
  const provenance = {
    workflowVersion: "structured-today-workflow-v4",
    editorialContract: {
      packageId: "traceink" as const,
      version: "fixture-v1",
      editorialContractHash: "a".repeat(64)
    },
    modelFunctionVersions: {},
    providerInvocations: []
  };
  const evidence = [0, 1].map((ordinal) => ({
    evidenceId: `formal-evidence-${ordinal}`,
    sourceKind: "session" as const,
    provider: ordinal === 0 ? "codex" as const : "claude" as const,
    sessionId: `formal-session-${ordinal}`,
    sourcePath: `/tmp/formal-session-${ordinal}.jsonl`,
    range: "bytes 0-100",
    contentHash: String(ordinal + 1).repeat(64)
  }));
  const sessions = evidence.map((item, ordinal) => ({
    sessionId: item.sessionId,
    provider: item.provider,
    sourcePath: item.sourcePath,
    title: `Formal Session ${ordinal}`,
    startedAt: `2026-08-30T0${ordinal + 1}:00:00.000Z`,
    endedAt: `2026-08-30T0${ordinal + 2}:00:00.000Z`,
    evidenceIds: [item.evidenceId]
  }));
  const indexWithoutHash = {
    schema: "today-workline-index/v1" as const,
    artifactId: "formal-index",
    revision: 1,
    logicalDate: "2026-08-30",
    workflowRunId: "formal-index-run",
    evidenceManifestId: "formal-manifest",
    sessions,
    evidence,
    dispositions: sessions.map((session, ordinal) => ({
      sessionId: session.sessionId,
      kind: "assigned" as const,
      worklineIds: ["formal-workline"],
      nodeOutputId: `node-${ordinal}`
    })),
    worklines: [{
      worklineId: "formal-workline",
      title: "Formal workline",
      summary: "Two Sessions completed one shared implementation.",
      startedAt: "2026-08-30T01:00:00.000Z",
      endedAt: "2026-08-30T03:00:00.000Z",
      currentStop: "The implementation is ready for review.",
      possibleChange: "It may change the product.",
      possibleChangeAdopted: false as const,
      participation: {
        status: "described" as const,
        human: "The user set the acceptance boundary.",
        joint: "The user and Agent reviewed the result."
      },
      evidenceReadiness: "ready" as const,
      sessionIds: sessions.map((item) => item.sessionId),
      evidenceIds: evidence.map((item) => item.evidenceId),
      extensions: []
    }],
    coverage: { admitted: 2, assigned: 2, excluded: 0, failed: 0, unresolved: 0, complete: true },
    provenance
  };
  const index = { ...indexWithoutHash, contentHash: canonicalContentHash(indexWithoutHash) };
  const dossierWithoutHash = {
    schema: "today-workline-dossier/v1" as const,
    artifactId: "formal-dossier",
    revision: 1,
    logicalDate: "2026-08-30",
    workflowRunId: "formal-dossier-run",
    sourceIndex: { artifactId: index.artifactId, revision: index.revision, contentHash: index.contentHash },
    worklineId: "formal-workline",
    admittedSessionIds: sessions.map((item) => item.sessionId),
    evidence,
    content: {
      title: "Formal dossier",
      priorContext: "The workline began from a frozen specification.",
      whatHappened: "Both Sessions produced one tested change.",
      possibleChange: "The result may change later priorities.",
      supportingEvidence: Array.from({ length: 8 }, (_, ordinal) => ({
        claim: options.authorityLeak && ordinal === 0
          ? `Typed formal claim leaks formal-evidence-0`
          : `Typed formal claim ${ordinal}`,
        evidenceIds: [evidence[ordinal % evidence.length]!.evidenceId]
      })),
      opposingEvidence: [],
      falsifiableObservation: "A future run could falsify it.",
      gaps: ["No gap belongs in the denominator."],
      humanQuestion: "Should this be adopted?",
      evidenceIds: evidence.map((item) => item.evidenceId),
      extensions: [],
      possibleChangeAdopted: false as const
    },
    validation: { schema: "passed" as const, evidence: "passed" as const, semantic: "passed" as const, critiqueIssues: [] },
    provenance
  };
  const provisionalDossier = TodayWorklineDossierSchema.parse({
    ...dossierWithoutHash,
    contentHash: "0".repeat(64)
  });
  const { contentHash: _provisionalHash, ...dossierHashable } = provisionalDossier;
  const dossier = { ...dossierHashable, contentHash: canonicalContentHash(dossierHashable) };
  const reflection = (id: string, savedAt: string, text: string) => ({
    schema: "today-workline-reflection/v1" as const,
    reflectionId: id,
    revision: 1,
    logicalDate: "2026-08-30",
    worklineId: "formal-workline",
    sourceDossier: { artifactId: dossier.artifactId, revision: dossier.revision, contentHash: dossier.contentHash },
    text,
    createdAt: savedAt,
    savedAt,
    contentHash: sha256Text(text)
  });
  const frontierReflection = reflection("reflection-frontier", "2026-08-30T09:00:00.000Z", "Frontier reflection");
  const laterReflection = reflection("reflection-later", "2026-08-30T12:00:00.000Z", "Later reflection");
  const earliestReflection = reflection("reflection-earliest", "2026-08-30T11:00:00.000Z", "Earliest reflection");
  const proposal = (artifactId: string, sourceReflection: ReturnType<typeof reflection>) => {
    const proposalWithoutHash = {
      schema: "today-workline-proposals/v1" as const,
      artifactId,
      revision: 1,
      logicalDate: "2026-08-30",
      worklineId: "formal-workline",
      sourceDossier: { artifactId: dossier.artifactId, revision: dossier.revision, contentHash: dossier.contentHash },
      sourceReflection: {
        reflectionId: sourceReflection.reflectionId,
        revision: sourceReflection.revision,
        contentHash: sourceReflection.contentHash
      },
      proposals: ["judgment", "tomorrow", "ctx", "background", "today-only"].map((category, ordinal) => ({
        proposalId: `${artifactId}-${ordinal}`,
        category,
        proposalText: `Proposal ${ordinal}`,
        sourceQuote: sourceReflection.text,
        evidenceIds: []
      })),
      provenance
    };
    const provisional = StructuredTodayProposalArtifactSchema.parse({
      ...proposalWithoutHash,
      contentHash: "0".repeat(64)
    });
    const { contentHash: _proposalHash, ...proposalHashable } = provisional;
    return { ...proposalHashable, contentHash: canonicalContentHash(proposalHashable) };
  };
  const frontierProposal = proposal("proposal-frontier", frontierReflection);
  const laterProposal = proposal("proposal-delta-later", laterReflection);
  const earliestProposal = proposal("proposal-delta-earliest", earliestReflection);
  const store = (reflections: unknown[], proposals: unknown[]) => ({
    schemaVersion: 1,
    artifacts: [],
    reflections: [],
    proposalDispositions: [],
    activeIndexByDate: {},
    structuredIndexes: [index],
    structuredDossiers: [dossier],
    activeStructuredIndexByDate: {
      "2026-08-30": { artifactId: index.artifactId, revision: index.revision, contentHash: index.contentHash }
    },
    structuredReflections: reflections,
    structuredProposals: proposals,
    structuredProposalDispositions: [],
    structuredRuns: []
  });
  const waitingStore = store([frontierReflection], [frontierProposal]);
  const waitingStoreBytes = jsonBytes(waitingStore);
  const frontierRef = {
    logicalDate: frontierProposal.logicalDate,
    artifactId: frontierProposal.artifactId,
    revision: frontierProposal.revision,
    contentHash: frontierProposal.contentHash,
    worklineId: frontierProposal.worklineId
  };
  const arm = {
    schema: "message-span-gate-arm/v1",
    status: "armed",
    armedAt: "2026-08-30T10:00:00.000Z",
    rule: "next-natural-proposal-review-after-arm",
    publicSeed: "formal-public-seed",
    assetStoreHashAtArm: hash(waitingStoreBytes),
    proposalFrontierHash: hash(`${JSON.stringify([frontierRef])}\n`),
    proposalFrontier: [frontierRef],
    discoveryBaseline: {
      batchId: "discovery-batch",
      receiptSha256: "f".repeat(64),
      decision: "fail",
      consensusPass: 5,
      threshold: 9,
      countsAsNextReviewGate: false
    }
  };
  const triggerStore = store(
    [frontierReflection, laterReflection, earliestReflection],
    [frontierProposal, laterProposal, earliestProposal]
  );
  return {
    armBytes: jsonBytes(arm),
    index,
    waitingStore,
    waitingStoreBytes,
    triggerStore,
    triggerStoreBytes: jsonBytes(triggerStore)
  };
}

function preparedFormalFixture(options: { authorityLeak?: boolean } = {}) {
  const fixture = formalFixture(options);
  const policy = buildMessageSpanEligibilityPolicy(fixture.armBytes, fixture.waitingStoreBytes);
  const policyBytes = jsonBytes(policy);
  const detection = detectMessageSpanGateTrigger({
    armBytes: fixture.armBytes,
    policyBytes,
    assetStoreBytes: fixture.triggerStoreBytes
  });
  assert.equal(detection.status, "triggered");
  if (detection.status !== "triggered") throw new Error("Formal fixture did not trigger.");
  const triggerBytes = jsonBytes(detection.trigger);
  const inventory = buildMessageSpanGateInventory({
    armBytes: fixture.armBytes,
    policyBytes,
    triggerBytes,
    assetStoreBytes: fixture.triggerStoreBytes,
    corpusCommitment: {
      checkpointId: "checkpoint-formal-1",
      workflowInputHash: "c".repeat(64),
      admittedMessageCorpusHash: "d".repeat(64),
      admittedMessageCount: 42
    }
  });
  return {
    ...fixture,
    policy,
    policyBytes,
    trigger: detection.trigger,
    triggerBytes,
    inventory,
    inventoryBytes: jsonBytes(inventory)
  };
}

function eligibilityReview(
  inventory: ReturnType<typeof preparedFormalFixture>["inventory"],
  policy: ReturnType<typeof preparedFormalFixture>["policy"],
  reviewer: "A" | "B"
) {
  return {
    schema: "message-span-eligibility-review/v1",
    inventoryContentHash: inventory.contentHash,
    eligibilityPolicyHash: policy.contentHash,
    reviewer,
    blind: true,
    annotations: inventory.conclusions.map((conclusion) => ({
      conclusionId: conclusion.conclusionId,
      verdict: "eligible" as "eligible" | "ineligible",
      exclusionCode: null as null | "E1" | "E2" | "E3" | "E4" | "E5" | "E6" | "E7" | "E8",
      rationale: "The conclusion belongs to the frozen direct-message denominator."
    }))
  };
}

function hashCanonical(value: unknown): string {
  const canonical = (candidate: unknown): string => {
    if (Array.isArray(candidate)) return `[${candidate.map(canonical).join(",")}]`;
    if (candidate && typeof candidate === "object") {
      const record = candidate as Record<string, unknown>;
      return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
    }
    return JSON.stringify(candidate);
  };
  return hash(canonical(value));
}

function inventoryItems(
  category: EligibleMessageSpanConclusion["category"],
  count: number
): EligibleMessageSpanConclusion[] {
  return Array.from({ length: count }, (_, ordinal) => ({
    conclusionId: `${category}-${ordinal}`,
    category,
    subtype: `${category}-fixture`,
    text: `${category} conclusion ${ordinal}`,
    textHash: String(ordinal).padStart(64, "0"),
    sourceArtifact: {
      kind: "dossier",
      artifactId: "dossier-1",
      revision: 1,
      contentHash: "a".repeat(64)
    },
    jsonPointer: `/fixture/${category}/${ordinal}`,
    atomOrdinal: 0,
    declaredEvidenceIds: ["evidence-1"],
    declaredSessionIds: ["session-1"]
  }));
}

function adjudicationFixture() {
  const messages = Array.from({ length: 10 }, (_, ordinal) => {
    const content = `Message ${ordinal}: unique quote ${ordinal}.`;
    return {
      evidenceId: `evidence-${ordinal}`,
      sessionId: `session-${ordinal}`,
      provider: ordinal % 2 === 0 ? "codex" as const : "claude" as const,
      messageId: `message-${ordinal}`,
      messageOrdinal: ordinal,
      role: ordinal % 2 === 0 ? "user" as const : "assistant" as const,
      timestamp: null,
      content,
      contentHash: hash(content)
    };
  });
  const conclusions = Array.from({ length: 10 }, (_, ordinal) => ({
    conclusionId: `conclusion-${String(ordinal).padStart(32, "0")}`
  }));
  const index = {
    kind: "index",
    artifactId: "structured-today-index-2026-08-29",
    revision: 1,
    contentHash: "a".repeat(64)
  };
  const admittedMessageCorpusHash = hash(JSON.stringify(messages));
  const pack = {
    schema: "message-span-gate/v1",
    batchId: "",
    phase: "gate-a",
    status: "frozen",
    logicalDate: "2026-08-29",
    seed: "adjudication-fixture",
    artifacts: { index, dossiers: [] },
    manifest: {
      admittedMessageCount: messages.length,
      admittedMessageCorpusHash
    },
    conclusions,
    admittedMessages: messages
  };
  pack.batchId = `gate-a-${hash(JSON.stringify({
    logicalDate: pack.logicalDate,
    seed: pack.seed,
    index,
    conclusions: conclusions.map((conclusion) => conclusion.conclusionId),
    admittedMessageCorpusHash
  })).slice(0, 32)}`;
  const packBytes = jsonBytes(pack);
  const packSha256 = hash(packBytes);
  const review = (reviewer: "A" | "B") => ({
    schema: "message-span-gate-review/v1",
    batchId: pack.batchId,
    packSha256,
    reviewer,
    blind: true,
    annotations: conclusions.map((conclusion, ordinal) => ordinal < 5
      ? {
          conclusionId: conclusion.conclusionId,
          verdict: "pass" as const,
          failureCode: null,
          spans: [{
            evidenceId: messages[ordinal]!.evidenceId,
            sessionId: messages[ordinal]!.sessionId,
            provider: messages[ordinal]!.provider,
            messageId: messages[ordinal]!.messageId,
            messageOrdinal: messages[ordinal]!.messageOrdinal,
            role: messages[ordinal]!.role,
            exactQuote: `unique quote ${ordinal}`
          }],
          rationale: "The quote directly supports the conclusion."
        }
      : {
          conclusionId: conclusion.conclusionId,
          verdict: "fail" as const,
          failureCode: "F1" as "F1" | "F2",
          spans: [],
          rationale: "No direct admitted message support."
        })
  });
  return { packBytes, reviewA: review("A"), reviewB: review("B") };
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

function minimalIndex(): TodayWorklineIndexV1 {
  return {
    logicalDate: "2026-08-29",
    workflowRunId: "workflow-run-1",
    artifactId: "structured-today-index-2026-08-29",
    revision: 1,
    evidenceManifestId: "manifest-1",
    sessions: [{
      sessionId: "session-1",
      provider: "codex",
      sourcePath: "/tmp/session.jsonl",
      title: "Session",
      startedAt: "2026-08-29T09:00:00.000Z",
      endedAt: "2026-08-29T10:00:00.000Z",
      evidenceIds: ["evidence-1"]
    }],
    evidence: [{
      evidenceId: "evidence-1",
      sourceKind: "session",
      provider: "codex",
      sessionId: "session-1",
      sourcePath: "/tmp/session.jsonl",
      range: "bytes 0-10",
      contentHash: "b".repeat(64)
    }]
  } as unknown as TodayWorklineIndexV1;
}
