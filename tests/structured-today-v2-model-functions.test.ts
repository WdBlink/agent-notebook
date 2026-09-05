import assert from "node:assert/strict";
import test from "node:test";
import { sha256Text } from "../src/structured-today-contracts";
import {
  createStructuredTodayV2IndexModelFunctions,
  type SynthesizeWorklineIndexV2Candidate
} from "../src/structured-today-v2-model-functions";
import type { StructuredTodayStructuredCaller } from "../src/structured-today-model-functions";

const MESSAGE_1 = `msg-v2-${"1".repeat(64)}`;
const MESSAGE_2 = `msg-v2-${"2".repeat(64)}`;

test("V2 digest exposes a strict finding-only schema with host-enumerated message keys", async () => {
  let call: Parameters<StructuredTodayStructuredCaller["call"]>[0] | undefined;
  const models = createStructuredTodayV2IndexModelFunctions({
    async call(input) {
      call = input;
      return {
        output: {
          sessionId: "session-1",
          findings: [{ text: "The user fixed the release threshold.", claimKind: "fact", messageKey: MESSAGE_1, exactQuote: "release threshold" }],
          uncertainties: []
        },
        invocationId: "invoke-digest-v2",
        provider: "codex",
        model: "model-v2"
      };
    }
  });

  const result = await models.digestSessionFindingsV2({
    logicalDate: "2026-08-30",
    editorialContract: editorialContract(),
    admittedMessagesJson: JSON.stringify([
      { messageKey: MESSAGE_1, role: "user", authorKind: "unknown", content: "The user fixed the release threshold." },
      { messageKey: MESSAGE_2, role: "assistant", authorKind: "agent", content: "Implementation followed." }
    ]),
    expectedSessionId: "session-1",
    allowedMessageKeys: [MESSAGE_1, MESSAGE_2]
  });

  assert.equal(result.output.findings[0]?.messageKey, MESSAGE_1);
  assert.equal(result.invocation.functionVersion, "DigestSessionFindingsV2/structured-v1");
  assert.ok(call);
  assert.equal(call.functionName, "DigestSession");
  assert.match(call.instructions, /atomic finding text/u);
  assert.match(call.instructions, /Never return or infer span IDs, offsets, positions, paths, evidence IDs/u);
  assert.equal(call.variables.allowedMessageKeysJson, JSON.stringify([MESSAGE_1, MESSAGE_2]));
  const root = record(call.outputJsonSchema);
  assert.equal(root.additionalProperties, false);
  const findings = record(record(root.properties).findings);
  const finding = record(findings.items);
  assert.equal(finding.additionalProperties, false);
  const messageKey = record(record(finding.properties).messageKey);
  assert.deepEqual(messageKey.enum, [MESSAGE_1, MESSAGE_2]);
  assert.deepEqual(Object.keys(record(finding.properties)).sort(), ["claimKind", "exactQuote", "messageKey", "text"]);
});

test("V2 digest rejects a forged but syntactically valid messageKey even if the caller ignores JSON Schema", async () => {
  const forged = `msg-v2-${"f".repeat(64)}`;
  const models = createStructuredTodayV2IndexModelFunctions(callerReturning({
    sessionId: "session-1",
    findings: [{ text: "Forged finding", claimKind: "fact", messageKey: forged, exactQuote: "Forged" }],
    uncertainties: []
  }));

  await assert.rejects(() => models.digestSessionFindingsV2({
    logicalDate: "2026-08-30",
    editorialContract: editorialContract(),
    admittedMessagesJson: "[]",
    expectedSessionId: "session-1",
    allowedMessageKeys: [MESSAGE_1]
  }), /invented messageKey/u);
});

test("V2 synthesis schema permits only typed material statements and enumerated finding and Session IDs", async () => {
  let call: Parameters<StructuredTodayStructuredCaller["call"]>[0] | undefined;
  const output = validSynthesis();
  const models = createStructuredTodayV2IndexModelFunctions({
    async call(input) {
      call = input;
      return {
        output,
        invocationId: "invoke-synthesis-v2",
        provider: "claude",
        model: "model-v2"
      };
    }
  });

  const result = await models.synthesizeWorklineIndexV2({
    logicalDate: "2026-08-30",
    editorialContract: editorialContract(),
    evidenceManifestJson: "{}",
    resolvedDigestsJson: "[]",
    verifiedFindingsJson: "[]",
    allowedSessionIds: ["session-1", "session-2"],
    allowedFindingIds: ["finding-1", "finding-2"]
  });

  assert.equal(result.output.worklines.length, 1);
  assert.equal(result.invocation.functionVersion, "SynthesizeWorklineIndexV2/structured-v1");
  assert.ok(call);
  assert.equal(call.functionName, "SynthesizeWorklineIndex");
  const serialized = JSON.stringify(call.outputJsonSchema);
  assert.match(serialized, /"findingIds"/u);
  assert.match(serialized, /"enum":\["finding-1","finding-2"\]/u);
  assert.match(serialized, /"enum":\["session-1","session-2"\]/u);
  for (const forbidden of ["spanId", "offset", "sourcePath", "evidenceId", "messageKey", "exactQuote"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked into synthesis output schema`);
  }
  const root = record(call.outputJsonSchema);
  assert.equal(root.additionalProperties, false);
  const worklines = record(record(root.properties).worklines);
  const workline = record(worklines.items);
  const summary = record(record(workline.properties).summary);
  assert.deepEqual(record(record(summary.properties).relation).enum, ["source-span", "inference-basis"]);
});

test("V2 synthesis rejects invented finding IDs after strict output parsing", async () => {
  const output = validSynthesis();
  output.worklines[0]!.summary.findingIds = ["finding-invented"];
  const models = createStructuredTodayV2IndexModelFunctions(callerReturning(output));

  await assert.rejects(() => models.synthesizeWorklineIndexV2({
    logicalDate: "2026-08-30",
    editorialContract: editorialContract(),
    evidenceManifestJson: "{}",
    resolvedDigestsJson: "[]",
    verifiedFindingsJson: "[]",
    allowedSessionIds: ["session-1", "session-2"],
    allowedFindingIds: ["finding-1", "finding-2"]
  }), /invented findingId finding-invented/u);
});

test("V2 synthesis fails closed when assignments and unresolved IDs do not cover every Session exactly once", async () => {
  const output = validSynthesis();
  output.assignments = [{ sessionId: "session-1", worklineIds: ["workline-1"], reason: null }];
  output.unresolvedSessionIds = [];
  const models = createStructuredTodayV2IndexModelFunctions(callerReturning(output));

  await assert.rejects(() => models.synthesizeWorklineIndexV2({
    logicalDate: "2026-08-30",
    editorialContract: editorialContract(),
    evidenceManifestJson: "{}",
    resolvedDigestsJson: "[]",
    verifiedFindingsJson: "[]",
    allowedSessionIds: ["session-1", "session-2"],
    allowedFindingIds: ["finding-1", "finding-2"]
  }), /cover Session session-2 exactly once/u);
});

function validSynthesis(): SynthesizeWorklineIndexV2Candidate {
  const statement = (text: string, findingIds: string[]) => ({
    text,
    relation: "source-span" as const,
    findingIds
  });
  return {
    worklines: [{
      worklineId: "workline-1",
      title: "Verified workline",
      summary: statement("The workline combined two verified findings.", ["finding-1", "finding-2"]),
      startedAt: "2026-08-30T01:00:00.000Z",
      endedAt: "2026-08-30T02:00:00.000Z",
      currentStop: statement("The implementation is ready for review.", ["finding-2"]),
      possibleChange: statement("The factual basis may alter the next plan.", ["finding-1"]),
      participation: {
        account: { human: "Set the threshold", agent: null, joint: null, undeterminedReason: null },
        statement: statement("The user set the threshold.", ["finding-1"])
      },
      evidenceReadiness: "ready",
      sessionIds: ["session-1"],
      extensions: []
    }],
    assignments: [{ sessionId: "session-1", worklineIds: ["workline-1"], reason: null }],
    unresolvedSessionIds: ["session-2"]
  };
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

function callerReturning(output: unknown): StructuredTodayStructuredCaller {
  return {
    async call() {
      return {
        output,
        invocationId: "invoke-v2",
        provider: "codex",
        model: "model-v2"
      };
    }
  };
}

function record(value: unknown): Record<string, any> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, any>;
}
