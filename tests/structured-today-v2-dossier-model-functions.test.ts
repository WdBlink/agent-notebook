import assert from "node:assert/strict";
import test from "node:test";
import { sha256Text } from "../src/structured-today-contracts";
import type { AtomicFindingV1 } from "../src/structured-today-evidence-spans";
import type { TodayWorklineV2 } from "../src/structured-today-v2-contracts";
import {
  DossierComposeCandidateV2Schema,
  createStructuredTodayV2DossierModelFunctions,
  type DossierAnalysisCandidateV2,
  type DossierComposeCandidateV2,
  type DossierCritiqueCandidateV2
} from "../src/structured-today-v2-dossier-model-functions";
import type { StructuredTodayStructuredCaller } from "../src/structured-today-model-functions";

const SPAN_1 = `span-v2-${"1".repeat(64)}`;
const SPAN_2 = `span-v2-${"2".repeat(64)}`;

test("Analyze V2 exposes only sanitized workline and finding projections with enumerated IDs", async () => {
  let call: Parameters<StructuredTodayStructuredCaller["call"]>[0] | undefined;
  const models = createStructuredTodayV2DossierModelFunctions({
    async call(input) {
      call = input;
      return result(validAnalysis(), "analyze-invocation");
    }
  });

  const output = await models.analyzeWorklineDossierV2(boundaryInput());
  assert.equal(output.invocation.functionName, "AnalyzeWorklineDossier");
  assert.equal(output.invocation.functionVersion, "AnalyzeWorklineDossierV2/structured-v1");
  assert.ok(call);
  assert.match(call.instructions, /host-verified findings/u);
  const variables = `${call.variables.selectedWorklineJson}\n${call.variables.verifiedFindingsJson}`;
  for (const forbidden of ["sourcePath", "evidenceId", "messageKey", "exactQuote", "spanId", "spanIds", "messageLocatorId", "quoteHash"]) {
    assert.equal(variables.includes(forbidden), false, `${forbidden} leaked into the model boundary`);
  }
  assert.deepEqual(JSON.parse(call.variables.verifiedFindingsJson!), [
    {
      findingId: "finding-source",
      text: "The implementation completed.",
      claimKind: "human-participation",
      relation: "source-span"
    },
    {
      findingId: "finding-inference",
      text: "The result may improve auditability.",
      claimKind: "fact",
      relation: "inference-basis"
    }
  ]);
  const root = record(call.outputJsonSchema);
  assert.equal(root.additionalProperties, false);
  const prior = record(record(root.properties).priorContext);
  assert.equal(prior.additionalProperties, false);
  assert.deepEqual(record(record(prior.properties).findingIds).items, {
    type: "string",
    enum: ["finding-source", "finding-inference"]
  });
});

test("Analyze V2 rejects forged finding IDs after strict provider parsing", async () => {
  const analysis = validAnalysis();
  analysis.supportingEvidence[0]!.findingIds = ["finding-forged"];
  const models = createStructuredTodayV2DossierModelFunctions(callerReturning(analysis));
  await assert.rejects(() => models.analyzeWorklineDossierV2(boundaryInput()), /invented material findingId finding-forged/u);
});

test("Critique V2 returns only issues and enumerated missing finding IDs", async () => {
  let call: Parameters<StructuredTodayStructuredCaller["call"]>[0] | undefined;
  const critique: DossierCritiqueCandidateV2 = {
    issues: ["Clarify the inference."],
    missingFindingIds: ["finding-inference"]
  };
  const models = createStructuredTodayV2DossierModelFunctions({
    async call(input) {
      call = input;
      return result(critique, "critique-invocation");
    }
  });
  const output = await models.critiqueWorklineDossierV2({ ...boundaryInput(), analysis: validAnalysis() });
  assert.deepEqual(output.output, critique);
  assert.equal(output.invocation.functionName, "CritiqueWorklineDossier");
  assert.equal(output.invocation.functionVersion, "CritiqueWorklineDossierV2/structured-v1");
  assert.ok(call);
  assert.deepEqual(Object.keys(record(call.outputJsonSchema).properties as object).sort(), ["issues", "missingFindingIds"]);
  const missing = record(record(record(call.outputJsonSchema).properties).missingFindingIds);
  assert.deepEqual(missing.items, { type: "string", enum: ["finding-source", "finding-inference"] });

  const forged = createStructuredTodayV2DossierModelFunctions(callerReturning({
    issues: [],
    missingFindingIds: ["finding-forged"]
  }));
  await assert.rejects(
    () => forged.critiqueWorklineDossierV2({ ...boundaryInput(), analysis: validAnalysis() }),
    /invented critique missingFindingId finding-forged/u
  );
});

test("Compose V2 types every material field and uses a distinct transport version", async () => {
  let call: Parameters<StructuredTodayStructuredCaller["call"]>[0] | undefined;
  const compose = validCompose();
  const models = createStructuredTodayV2DossierModelFunctions({
    async call(input) {
      call = input;
      return result(compose, "compose-invocation");
    }
  });
  const output = await models.composeWorklineDossierV2({
    ...boundaryInput(),
    analysis: validAnalysis(),
    critique: { issues: [], missingFindingIds: [] }
  });
  assert.deepEqual(output.output, compose);
  assert.equal(output.invocation.functionName, "ComposeWorklineDossier");
  assert.equal(output.invocation.functionVersion, "ComposeWorklineDossierV2/structured-v1");
  assert.ok(call);
  assert.match(call.instructions, /humanQuestion/u);
  assert.deepEqual(Object.keys(output.output.humanQuestion).sort(), ["findingIds", "relation", "text"]);
  assert.deepEqual(output.output.extensions, []);
  assert.doesNotThrow(() => DossierComposeCandidateV2Schema.parse(output.output));
});

test("Compose V2 rejects invented IDs, hidden authority fields, and source relation over inference findings", async () => {
  const forgedId = validCompose();
  forgedId.gaps[0]!.findingIds = ["finding-forged"];
  await assert.rejects(() => createStructuredTodayV2DossierModelFunctions(callerReturning(forgedId))
    .composeWorklineDossierV2({
      ...boundaryInput(),
      analysis: validAnalysis(),
      critique: { issues: [], missingFindingIds: [] }
    }), /invented material findingId finding-forged/u);

  const hiddenAuthority = { ...validCompose(), evidenceIds: ["evidence-forged"] };
  await assert.rejects(() => createStructuredTodayV2DossierModelFunctions(callerReturning(hiddenAuthority))
    .composeWorklineDossierV2({
      ...boundaryInput(),
      analysis: validAnalysis(),
      critique: { issues: [], missingFindingIds: [] }
    }));

  const badRelation = validCompose();
  badRelation.possibleChange = material("Wrong direct claim.", "source-span", ["finding-inference"]);
  await assert.rejects(() => createStructuredTodayV2DossierModelFunctions(callerReturning(badRelation))
    .composeWorklineDossierV2({
      ...boundaryInput(),
      analysis: validAnalysis(),
      critique: { issues: [], missingFindingIds: [] }
    }), /references non-source findingId finding-inference/u);
});

function boundaryInput() {
  return {
    editorialContract: editorialContract(),
    selectedWorkline: selectedWorkline(),
    verifiedFindings: verifiedFindings(),
    allowedFindingIds: ["finding-source", "finding-inference"] as [string, ...string[]]
  };
}

function selectedWorkline(): TodayWorklineV2 {
  return {
    worklineId: "workline-1",
    title: "Selected V2 workline",
    summary: cited("statement-summary", "The implementation completed.", "source-span", ["finding-source"], [SPAN_1]),
    startedAt: "2026-08-30T01:00:00.000Z",
    endedAt: "2026-08-30T02:00:00.000Z",
    currentStop: cited("statement-stop", "Validation is next.", "source-span", ["finding-source"], [SPAN_1]),
    possibleChange: cited("statement-change", "The result may improve auditability.", "inference-basis", ["finding-inference"], [SPAN_2]),
    possibleChangeAdopted: false,
    participation: {
      account: { status: "described", agent: "Agent implemented the change." },
      statement: cited("statement-participation", "Agent implemented the change.", "source-span", ["finding-source"], [SPAN_1])
    },
    evidenceReadiness: "ready",
    sessionIds: ["session-1"],
    evidenceIds: ["evidence-1"],
    extensions: []
  };
}

function verifiedFindings(): AtomicFindingV1[] {
  return [
    {
      findingId: "finding-source",
      text: "The implementation completed.",
      claimKind: "human-participation",
      relation: "source-span",
      spanIds: [SPAN_1]
    },
    {
      findingId: "finding-inference",
      text: "The result may improve auditability.",
      claimKind: "fact",
      relation: "inference-basis",
      spanIds: [SPAN_2]
    }
  ];
}

function validAnalysis(): DossierAnalysisCandidateV2 {
  return {
    priorContext: material("The previous contract was Session-level.", "inference-basis", ["finding-source"]),
    whatHappened: material("The implementation completed.", "source-span", ["finding-source"]),
    possibleChange: material("The result may improve auditability.", "inference-basis", ["finding-inference"]),
    supportingEvidence: [material("The implementation completed.", "source-span", ["finding-source"])],
    opposingEvidence: [],
    falsifiableObservation: material("A holdout can falsify the inference.", "inference-basis", ["finding-inference"]),
    gaps: [material("Long-term behavior remains unknown.", "inference-basis", ["finding-source"])]
  };
}

function validCompose(): DossierComposeCandidateV2 {
  return {
    title: "Evidence-first dossier",
    ...validAnalysis(),
    humanQuestion: material("Should the V2 route proceed?", "inference-basis", ["finding-source"]),
    extensions: []
  };
}

function material(
  text: string,
  relation: "source-span" | "inference-basis",
  findingIds: string[]
) {
  return { text, relation, findingIds };
}

function cited(
  statementId: string,
  text: string,
  relation: "source-span" | "inference-basis",
  findingIds: string[],
  spanIds: string[]
) {
  return { statementId, text, relation, findingIds, spanIds };
}

function editorialContract() {
  const text = "canonical dossier V2 editorial contract";
  return {
    ref: {
      packageId: "traceink" as const,
      version: "dossier-v2-test",
      editorialContractHash: sha256Text(text)
    },
    text
  };
}

function callerReturning(output: unknown): StructuredTodayStructuredCaller {
  return { async call() { return result(output, "dossier-v2-invocation"); } };
}

function result(output: unknown, invocationId: string) {
  return { output, invocationId, provider: "codex", model: "model-v2" };
}

function record(value: unknown): Record<string, any> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, any>;
}
