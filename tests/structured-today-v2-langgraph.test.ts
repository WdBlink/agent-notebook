import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NodeSqliteSaver } from "../src/langgraph-node-sqlite-checkpointer";
import {
  StructuredTodayProvenanceSessionSchema,
  parseEvidenceJsonl,
  type StructuredTodayProvenanceSessionV1
} from "../src/structured-today-evidence-spans";
import { resolveDigestFindingCandidates } from "../src/structured-today-v2-findings";
import { buildStructuredTodayIndexV2 } from "../src/structured-today-v2-artifacts";
import {
  STRUCTURED_TODAY_V2_DIGEST_PAYLOAD_CHAR_LIMIT,
  createStructuredTodayV2LangGraphIndex,
  invokeStructuredTodayV2LangGraphIndex,
  resumeStructuredTodayV2LangGraphIndex,
  retryStructuredTodayV2LangGraphIndex,
  type StructuredTodayIndexV2BuildInput
} from "../src/structured-today-v2-langgraph";
import type {
  StructuredTodayV2IndexModelFunctions,
  SynthesizeWorklineIndexV2Candidate
} from "../src/structured-today-v2-model-functions";
import {
  STRUCTURED_TODAY_INDEX_V2_SCHEMA,
  TodayWorklineIndexV2Schema
} from "../src/structured-today-v2-contracts";
import {
  StructuredTodayIndexWorkflowInputV2Schema,
  structuredTodayAdmittedCorpusHash,
  type DigestFindingCandidateSetV1,
  type StructuredTodayIndexWorkflowInputV2
} from "../src/structured-today-v2-workflow";
import {
  canonicalContentHash,
  participationAccount,
  sha256Text,
  type StructuredTodayModelInvocationV1
} from "../src/structured-today-contracts";

test("V2 graph fans out candidates, preserves preDisposition, and exposes only bounded message projection", async () => {
  const workflowInput = inputV2({ includeFailedSession: true });
  let digestCalls = 0;
  let digestPayload: unknown;
  let synthesisVariables: Record<string, string> | undefined;
  const graph = createStructuredTodayV2LangGraphIndex({
    dependencies: {
      models: models({
        onDigest(input) {
          digestCalls += 1;
          digestPayload = JSON.parse(input.admittedMessagesJson);
          const provenance = workflowInput.sessions[0]!.provenanceSession!;
          return candidateSet(provenance, [
            { text: "Verified implementation fact", exactQuote: "source exact fact" }
          ]);
        },
        onSynthesis(input) {
          synthesisVariables = {
            evidenceManifestJson: input.evidenceManifestJson,
            resolvedDigestsJson: input.resolvedDigestsJson,
            verifiedFindingsJson: input.verifiedFindingsJson
          };
          return synthesisCandidate(input.allowedFindingIds[0]!, "session-1");
        }
      }),
      buildIndex: buildArtifact
    }
  });

  const result = await invokeStructuredTodayV2LangGraphIndex({
    graph,
    workflowInput,
    threadId: "v2-success",
    digestConcurrency: 3
  });

  assert.equal("interrupted" in result, false);
  if ("interrupted" in result) return;
  assert.equal(digestCalls, 1, "pre-disposed Session never invokes the model");
  assert.deepEqual(digestPayload, [{
    messageKey: workflowInput.sessions[0]!.provenanceSession!.admittedMessages[0]!.locator.messageKey,
    role: "user",
    authorKind: "human",
    content: "source exact fact"
  }]);
  assert.ok(JSON.stringify(digestPayload).length < STRUCTURED_TODAY_V2_DIGEST_PAYLOAD_CHAR_LIMIT);
  assert.deepEqual(result.sessionOutcomes.map((item) => item.status), ["resolved", "failed"]);
  assert.equal(result.artifact.schema, STRUCTURED_TODAY_INDEX_V2_SCHEMA);
  assert.ok(synthesisVariables);
  const synthesisPayload = JSON.stringify(synthesisVariables);
  for (const rawAuthority of [
    "/private/tmp/secret-session.jsonl",
    "secret-evidence-1",
    workflowInput.sessions[0]!.provenanceSession!.admittedMessages[0]!.locator.messageKey,
    "source exact fact"
  ]) {
    assert.equal(synthesisPayload.includes(rawAuthority), false, `${rawAuthority} leaked to synthesis`);
  }
  const verifiedFindingsJson = synthesisVariables?.verifiedFindingsJson;
  assert.ok(verifiedFindingsJson);
  assert.match(verifiedFindingsJson, /Verified implementation fact/u);
  assert.deepEqual(JSON.parse(verifiedFindingsJson), [{
    findingId: result.artifact.findings[0]!.findingId,
    text: "Verified implementation fact",
    claimKind: "fact",
    relation: "source-span"
  }]);
});

test("V2 resolver retains a forged messageKey as partial unresolved while verified findings continue", async () => {
  const workflowInput = inputV2();
  const provenance = workflowInput.sessions[0]!.provenanceSession!;
  const graph = createStructuredTodayV2LangGraphIndex({
    dependencies: {
      models: models({
        onDigest() {
          return {
            sessionId: "session-1",
            findings: [
              {
                text: "Verified implementation fact",
                claimKind: "fact",
                messageKey: provenance.admittedMessages[0]!.locator.messageKey,
                exactQuote: "source exact fact"
              },
              {
                text: "Forged finding",
                claimKind: "fact",
                messageKey: `msg-v2-${"f".repeat(64)}`,
                exactQuote: "forged"
              }
            ],
            uncertainties: []
          };
        },
        onSynthesis(input) {
          assert.equal(input.allowedFindingIds.length, 1);
          return synthesisCandidate(input.allowedFindingIds[0]!, "session-1");
        }
      }),
      buildIndex: buildArtifact
    }
  });

  const result = await invokeStructuredTodayV2LangGraphIndex({
    graph,
    workflowInput,
    threadId: "v2-partial-unresolved",
    digestConcurrency: 2
  });
  assert.equal("interrupted" in result, false);
  if ("interrupted" in result) return;
  assert.equal(result.sessionOutcomes[0]?.findingCount, 1);
  assert.equal(result.sessionOutcomes[0]?.unresolvedCandidateCount, 1);
  assert.equal(result.artifact.findings.length, 1);
});

test("V2 digest model failure becomes an explicit failed artifact disposition without blocking other Sessions", async () => {
  const workflowInput = inputV2({ includeRuntimeFailureSession: true });
  const graph = createStructuredTodayV2LangGraphIndex({
    dependencies: {
      models: models({
        onDigest(input) {
          if (input.expectedSessionId === "session-runtime-failed") {
            throw new Error("injected digest provider failure");
          }
          const provenance = workflowInput.sessions.find((item) =>
            item.session.sessionId === input.expectedSessionId
          )!.provenanceSession!;
          return candidateSet(provenance, [{
            text: "Verified implementation fact",
            exactQuote: "source exact fact"
          }]);
        },
        onSynthesis(input) {
          return synthesisCandidate(input.allowedFindingIds[0]!, "session-1");
        }
      })
    }
  });

  const result = await invokeStructuredTodayV2LangGraphIndex({
    graph,
    workflowInput,
    threadId: "v2-runtime-failure",
    digestConcurrency: 2
  });
  assert.equal("interrupted" in result, false);
  if ("interrupted" in result) return;
  const disposition = result.artifact.dispositions.find((item) => item.sessionId === "session-runtime-failed");
  assert.equal(disposition?.kind, "failed");
  assert.match(disposition?.kind === "failed" ? disposition.reason : "", /digest provider failure/u);
  assert.equal(result.artifact.coverage.failed, 1);
  assert.equal(result.artifact.coverage.complete, false);
  assert.equal(result.publishable, false);
});

test("V2 SQLite retry resumes the deterministic resolver without repeating its checkpointed model candidate", async () => {
  const workflowInput = inputV2();
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "structured-v2-graph-"));
  const saver = NodeSqliteSaver.fromConnectionString(path.join(temporaryRoot, "checkpoints.sqlite"));
  let digestCalls = 0;
  let resolverCalls = 0;
  try {
    const graph = createStructuredTodayV2LangGraphIndex({
      dependencies: {
        models: models({
          onDigest() {
            digestCalls += 1;
            return candidateSet(workflowInput.sessions[0]!.provenanceSession!, [
              { text: "Verified implementation fact", exactQuote: "source exact fact" }
            ]);
          },
          onSynthesis(input) {
            return synthesisCandidate(input.allowedFindingIds[0]!, "session-1");
          }
        }),
        resolveFindings(candidate, provenance) {
          resolverCalls += 1;
          if (resolverCalls === 1) throw new Error("injected deterministic resolver interruption");
          return resolveDigestFindingCandidates(candidate, provenance);
        },
        buildIndex: buildArtifact
      },
      checkpointer: saver
    });

    await assert.rejects(() => invokeStructuredTodayV2LangGraphIndex({
      graph,
      workflowInput,
      threadId: "v2-resolver-retry",
      digestConcurrency: 2
    }), /resolver interruption/u);
    assert.equal(digestCalls, 1);

    const result = await retryStructuredTodayV2LangGraphIndex({
      graph,
      threadId: "v2-resolver-retry",
      digestConcurrency: 2
    });
    assert.equal(result.artifact.schema, STRUCTURED_TODAY_INDEX_V2_SCHEMA);
    assert.equal(digestCalls, 1, "checkpointed model candidate was reused");
    assert.equal(resolverCalls, 2);
  } finally {
    saver.close();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("V2 SQLite interrupt resumes before synthesis without repeating fanout or resolver work", async () => {
  const workflowInput = StructuredTodayIndexWorkflowInputV2Schema.parse({
    ...inputV2(),
    pauseBeforeSynthesis: true
  });
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "structured-v2-resume-"));
  const saver = NodeSqliteSaver.fromConnectionString(path.join(temporaryRoot, "checkpoints.sqlite"));
  let digestCalls = 0;
  let synthesisCalls = 0;
  try {
    const graph = createStructuredTodayV2LangGraphIndex({
      dependencies: {
        models: models({
          onDigest() {
            digestCalls += 1;
            return candidateSet(workflowInput.sessions[0]!.provenanceSession!, [{
              text: "Verified implementation fact",
              exactQuote: "source exact fact"
            }]);
          },
          onSynthesis(input) {
            synthesisCalls += 1;
            return synthesisCandidate(input.allowedFindingIds[0]!, "session-1");
          }
        }),
        buildIndex: buildArtifact
      },
      checkpointer: saver
    });
    const interrupted = await invokeStructuredTodayV2LangGraphIndex({
      graph,
      workflowInput,
      threadId: "v2-before-synthesis",
      digestConcurrency: 2
    });
    assert.deepEqual(interrupted, { interrupted: true });
    assert.equal(digestCalls, 1);
    assert.equal(synthesisCalls, 0);

    const resumed = await resumeStructuredTodayV2LangGraphIndex({
      graph,
      threadId: "v2-before-synthesis",
      digestConcurrency: 2
    });
    assert.equal(resumed.artifact.schema, STRUCTURED_TODAY_INDEX_V2_SCHEMA);
    assert.equal(digestCalls, 1);
    assert.equal(synthesisCalls, 1);
  } finally {
    saver.close();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("V2 graph records an oversized final digest JSON payload as an explicit per-Session failure", async () => {
  const workflowInput = inputV2();
  const provenance = workflowInput.sessions[0]!.provenanceSession!;
  const content = "x".repeat(STRUCTURED_TODAY_V2_DIGEST_PAYLOAD_CHAR_LIMIT);
  provenance.admittedMessages[0]!.content = content;
  provenance.admittedMessages[0]!.contentHash = sha256Text(content);
  provenance.admittedMessages[0]!.locator.normalizedMessageHash = sha256Text(content);
  provenance.admittedCorpusHash = admittedCorpusHash(provenance);
  workflowInput.admittedCorpusHash = structuredTodayAdmittedCorpusHash([provenance]);
  let digestCalls = 0;
  const graph = createStructuredTodayV2LangGraphIndex({
    dependencies: {
      models: models({
        onDigest() {
          digestCalls += 1;
          return candidateSet(provenance, []);
        },
        onSynthesis() {
          throw new Error("synthesis should not run");
        }
      }),
      buildIndex(input) {
        assert.equal(input.resolvedDigests.length, 0);
        return buildEmptyArtifact(input);
      }
    }
  });
  const result = await invokeStructuredTodayV2LangGraphIndex({
    graph,
    workflowInput: StructuredTodayIndexWorkflowInputV2Schema.parse(workflowInput),
    threadId: "v2-oversized-payload",
    digestConcurrency: 1
  });
  assert.equal("interrupted" in result, false);
  if ("interrupted" in result) return;
  assert.equal(digestCalls, 0);
  assert.equal(result.sessionOutcomes[0]?.status, "failed");
  assert.match(result.sessionOutcomes[0]?.reason ?? "", /payload exceeds/u);
});

function models(input: {
  onDigest(args: Parameters<StructuredTodayV2IndexModelFunctions["digestSessionFindingsV2"]>[0]): DigestFindingCandidateSetV1;
  onSynthesis(args: Parameters<StructuredTodayV2IndexModelFunctions["synthesizeWorklineIndexV2"]>[0]): SynthesizeWorklineIndexV2Candidate;
}): StructuredTodayV2IndexModelFunctions {
  return {
    async digestSessionFindingsV2(args) {
      return { output: input.onDigest(args), invocation: invocation("DigestSession", "DigestSessionFindingsV2/structured-v1") };
    },
    async synthesizeWorklineIndexV2(args) {
      return { output: input.onSynthesis(args), invocation: invocation("SynthesizeWorklineIndex", "SynthesizeWorklineIndexV2/structured-v1") };
    }
  };
}

function candidateSet(
  provenance: StructuredTodayProvenanceSessionV1,
  candidates: Array<{
    text: string;
    exactQuote: string;
    claimKind?: "fact" | "human-participation" | "human-adoption";
  }>
): DigestFindingCandidateSetV1 {
  return {
    sessionId: provenance.sessionId,
    findings: candidates.map((candidate) => ({
      text: candidate.text,
      exactQuote: candidate.exactQuote,
      claimKind: candidate.claimKind ?? "fact",
      messageKey: provenance.admittedMessages[0]!.locator.messageKey
    })),
    uncertainties: []
  };
}

function synthesisCandidate(findingId: string, sessionId: string): SynthesizeWorklineIndexV2Candidate {
  const statement = (text: string, relation: "source-span" | "inference-basis" = "source-span") => ({
    text,
    relation,
    findingIds: [findingId]
  });
  return {
    worklines: [{
      worklineId: "workline-v2",
      title: "Verified V2 workline",
      summary: statement("The verified implementation completed."),
      startedAt: "2026-08-30T01:00:00.000Z",
      endedAt: "2026-08-30T02:00:00.000Z",
      currentStop: statement("The result is ready for review."),
      possibleChange: statement("The verified basis may change the next plan.", "inference-basis"),
      participation: {
        account: { human: "Set the acceptance boundary", agent: null, joint: null, undeterminedReason: null },
        statement: statement("The user set the acceptance boundary.")
      },
      evidenceReadiness: "ready",
      sessionIds: [sessionId],
      extensions: []
    }],
    assignments: [{ sessionId, worklineIds: ["workline-v2"], reason: null }],
    unresolvedSessionIds: []
  };
}

function buildArtifact(input: StructuredTodayIndexV2BuildInput) {
  return buildStructuredTodayIndexV2(input);
}

function buildEmptyArtifact(input: StructuredTodayIndexV2BuildInput) {
  const session = input.initial.sessions[0]!.session;
  const execution = input.executionDispositions.find((item) => item.sessionId === session.sessionId);
  const base = {
    schema: STRUCTURED_TODAY_INDEX_V2_SCHEMA,
    artifactId: input.initial.artifactId,
    revision: input.initial.revision,
    logicalDate: input.initial.logicalDate,
    workflowRunId: input.runtimeRunId,
    evidenceManifestId: input.initial.evidenceManifestId,
    sessions: input.initial.sessions.map((item) => item.session),
    evidence: input.initial.evidence,
    messageLocators: [],
    spans: [],
    findings: [],
    dispositions: [{
      sessionId: session.sessionId,
      kind: execution?.kind ?? "unresolved" as const,
      worklineIds: [] as [],
      reason: execution?.reason ?? "Digest payload exceeded the model boundary."
    }],
    worklines: [],
    coverage: {
      admitted: 1,
      assigned: 0,
      excluded: execution?.kind === "excluded" ? 1 : 0,
      failed: execution?.kind === "failed" ? 1 : 0,
      unresolved: execution ? 0 : 1,
      complete: false
    },
    provenance: {
      workflowVersion: input.initial.workflowVersion,
      editorialContract: input.initial.editorialContract.ref,
      modelFunctionVersions: {},
      providerInvocations: []
    }
  };
  const artifact = TodayWorklineIndexV2Schema.parse({ ...base, contentHash: canonicalContentHash(base) });
  return artifact;
}

function inputV2(options: {
  includeFailedSession?: boolean;
  includeRuntimeFailureSession?: boolean;
} = {}): StructuredTodayIndexWorkflowInputV2 {
  const provenance = provenanceSession("session-1", "secret-evidence-1", "source exact fact");
  const editorial = editorialContract();
  const admitted = {
    logicalDate: "2026-08-30",
    editorialContract: editorial,
    session: {
      sessionId: "session-1",
      provider: "codex" as const,
      sourcePath: "/private/tmp/secret-session.jsonl",
      title: "Secret Session",
      startedAt: "2026-08-30T01:00:00.000Z",
      endedAt: "2026-08-30T02:00:00.000Z",
      evidenceIds: ["secret-evidence-1"]
    },
    evidence: [{
      evidenceId: "secret-evidence-1",
      sourceKind: "session" as const,
      provider: "codex" as const,
      sessionId: "session-1",
      sourcePath: "/private/tmp/secret-session.jsonl",
      range: `bytes 0-${provenance.frozenSourcePrefix.byteLength}`,
      contentHash: provenance.frozenSourcePrefix.contentHash
    }],
    provenanceSession: provenance
  };
  const failed = {
    logicalDate: "2026-08-30",
    editorialContract: editorial,
    session: {
      sessionId: "session-failed",
      provider: "claude" as const,
      sourcePath: "/private/tmp/failed-session.jsonl",
      title: "Failed Session",
      startedAt: "2026-08-30T03:00:00.000Z",
      evidenceIds: ["failed-evidence"]
    },
    evidence: [{
      evidenceId: "failed-evidence",
      sourceKind: "session" as const,
      provider: "claude" as const,
      sessionId: "session-failed",
      sourcePath: "/private/tmp/failed-session.jsonl",
      range: "metadata-only",
      contentHash: "e".repeat(64)
    }],
    preDisposition: { kind: "failed" as const, reason: "Frozen transcript capture is unavailable." }
  };
  const runtimeFailedProvenance = provenanceSession(
    "session-runtime-failed",
    "runtime-failed-evidence",
    "runtime failure source"
  );
  const runtimeFailed = {
    logicalDate: "2026-08-30",
    editorialContract: editorial,
    session: {
      sessionId: "session-runtime-failed",
      provider: "codex" as const,
      sourcePath: "/private/tmp/runtime-failed-session.jsonl",
      title: "Runtime Failed Session",
      startedAt: "2026-08-30T03:00:00.000Z",
      evidenceIds: ["runtime-failed-evidence"]
    },
    evidence: [{
      evidenceId: "runtime-failed-evidence",
      sourceKind: "session" as const,
      provider: "codex" as const,
      sessionId: "session-runtime-failed",
      sourcePath: "/private/tmp/runtime-failed-session.jsonl",
      range: `bytes 0-${runtimeFailedProvenance.frozenSourcePrefix.byteLength}`,
      contentHash: runtimeFailedProvenance.frozenSourcePrefix.contentHash
    }],
    provenanceSession: runtimeFailedProvenance
  };
  const sessions = options.includeFailedSession
    ? [admitted, failed]
    : options.includeRuntimeFailureSession
      ? [admitted, runtimeFailed]
      : [admitted];
  const provenanceSessions = options.includeRuntimeFailureSession
    ? [provenance, runtimeFailedProvenance]
    : [provenance];
  return StructuredTodayIndexWorkflowInputV2Schema.parse({
    schema: "structured-today-index-input/v2",
    workflowVersion: "structured-today-workflow-v5-message-spans",
    logicalDate: "2026-08-30",
    workflowRunId: "structured-v2-test-run",
    artifactId: "structured-v2-test-index",
    revision: 1,
    evidenceManifestId: "manifest-v2-test",
    editorialContract: editorial,
    parserVersion: provenance.parserVersion,
    admissionPolicyVersion: provenance.admissionPolicyVersion,
    admittedCorpusHash: structuredTodayAdmittedCorpusHash(provenanceSessions),
    sessions,
    evidence: options.includeFailedSession
      ? [...admitted.evidence, ...failed.evidence]
      : options.includeRuntimeFailureSession
        ? [...admitted.evidence, ...runtimeFailed.evidence]
      : admitted.evidence
  });
}

function provenanceSession(
  sessionId: string,
  evidenceId: string,
  content: string
): StructuredTodayProvenanceSessionV1 {
  const source = Buffer.from(`${JSON.stringify({
    type: "response_item",
    timestamp: "2026-08-30T01:00:00.000Z",
    payload: {
      type: "message",
      id: "provider-message-1",
      role: "user",
      authorKind: "human",
      content: [{ type: "input_text", text: content }]
    }
  })}\n`, "utf8");
  const parsed = parseEvidenceJsonl({
    source,
    provider: "codex",
    sessionId,
    evidenceId,
    authorKindsByRecordRange: { [`0:${source.byteLength - 1}`]: "human" }
  });
  const admittedMessages = parsed.messages.map((message) => ({
    locator: message.locator,
    content: message.content,
    contentHash: message.locator.normalizedMessageHash,
    completeMessage: true as const
  }));
  return StructuredTodayProvenanceSessionSchema.parse({
    schema: "structured-today-provenance-session/v1",
    provider: parsed.provider,
    sessionId,
    evidenceId,
    parserVersion: parsed.parserVersion,
    admissionPolicyVersion: parsed.admissionPolicyVersion,
    frozenSourcePrefix: parsed.frozenSourcePrefix,
    coverage: "complete",
    admittedMessages,
    omissions: [],
    parseIssues: [],
    admittedCorpusHash: sha256Text(JSON.stringify(admittedMessages.map((message) => ({
      messageLocatorId: message.locator.messageLocatorId,
      contentHash: message.contentHash,
      completeMessage: message.completeMessage
    }))))
  });
}

function admittedCorpusHash(provenance: StructuredTodayProvenanceSessionV1): string {
  return sha256Text(JSON.stringify(provenance.admittedMessages.map((message) => ({
    messageLocatorId: message.locator.messageLocatorId,
    contentHash: message.contentHash,
    completeMessage: message.completeMessage
  }))));
}

function editorialContract() {
  const text = "canonical V2 editorial contract";
  return {
    ref: {
      packageId: "traceink" as const,
      version: "v2-test",
      editorialContractHash: sha256Text(text)
    },
    text
  };
}

function invocation(
  functionName: StructuredTodayModelInvocationV1["functionName"],
  functionVersion: string
): StructuredTodayModelInvocationV1 {
  return {
    invocationId: `${functionName}-${functionVersion}`,
    provider: "codex",
    model: "model-v2",
    functionName,
    functionVersion
  };
}

function coverage(dispositions: Array<{ kind: "assigned" | "excluded" | "failed" | "unresolved" }>) {
  const count = (kind: "assigned" | "excluded" | "failed" | "unresolved") =>
    dispositions.filter((item) => item.kind === kind).length;
  const failed = count("failed");
  const unresolved = count("unresolved");
  return {
    admitted: dispositions.length,
    assigned: count("assigned"),
    excluded: count("excluded"),
    failed,
    unresolved,
    complete: failed === 0 && unresolved === 0
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
