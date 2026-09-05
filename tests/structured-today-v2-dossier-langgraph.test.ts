import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NodeSqliteSaver } from "../src/langgraph-node-sqlite-checkpointer";
import {
  createStructuredTodayV2DossierLangGraph,
  invokeStructuredTodayV2DossierLangGraph,
  retryStructuredTodayV2DossierLangGraph,
  type DossierAnalysisCandidateV2,
  type DossierComposeCandidateV2,
  type DossierCritiqueCandidateV2,
  type StructuredTodayDossierWorkflowInputV2,
  type StructuredTodayV2DossierModelFunctions
} from "../src/structured-today-v2-dossier-langgraph";
import { createStructuredTodayV2DossierModelFunctions } from "../src/structured-today-v2-dossier-model-functions";
import {
  STRUCTURED_TODAY_DOSSIER_V2_SCHEMA,
  STRUCTURED_TODAY_INDEX_V2_SCHEMA,
  TodayWorklineIndexV2Schema,
  type TodayWorklineIndexV2
} from "../src/structured-today-v2-contracts";
import {
  canonicalContentHash,
  sha256Text,
  type StructuredTodayModelInvocationV1
} from "../src/structured-today-contracts";

test("selected-workline dossier graph exposes only its sanitized exact finding closure", async () => {
  const workflowInput = dossierInput();
  const seenAllowed: string[][] = [];
  const visibleVariables: string[] = [];
  const boundaryModels = createStructuredTodayV2DossierModelFunctions({
    async call(input) {
      visibleVariables.push(...Object.values(input.variables));
      seenAllowed.push(JSON.parse(input.variables.allowedFindingIdsJson ?? "[]") as string[]);
      const output = input.functionName === "AnalyzeWorklineDossier"
        ? analysis("finding-selected")
        : input.functionName === "CritiqueWorklineDossier"
          ? { issues: [], missingFindingIds: [] }
          : composeCandidate("finding-selected");
      return {
        output,
        invocationId: `${input.functionName}-boundary`,
        provider: "codex",
        model: "dossier-v2"
      };
    }
  });
  const graph = createStructuredTodayV2DossierLangGraph({
    dependencies: {
      models: boundaryModels
    }
  });

  const result = await invokeStructuredTodayV2DossierLangGraph({
    graph,
    workflowInput,
    threadId: "dossier-v2-success"
  });

  assert.equal(result.artifact.schema, STRUCTURED_TODAY_DOSSIER_V2_SCHEMA);
  assert.deepEqual(result.artifact.findings.map((finding) => finding.findingId), ["finding-selected"]);
  assert.deepEqual(seenAllowed, [["finding-selected"], ["finding-selected"], ["finding-selected"]]);
  const visible = visibleVariables.join("\n");
  assert.match(visible, /Selected verified finding/u);
  assert.equal(visible.includes("Other workline finding"), false);
  for (const rawAuthority of [
    "/private/tmp/selected.jsonl",
    "evidence-selected",
    `msg-v2-${"1".repeat(64)}`,
    "selected source quote",
    `span-v2-${"1".repeat(64)}`
  ]) {
    assert.equal(visible.includes(rawAuthority), false, `${rawAuthority} leaked to a dossier model node`);
  }
});

test("dossier graph rejects any model statement that cites a finding outside the selected workline", async () => {
  let critiqueCalls = 0;
  const graph = createStructuredTodayV2DossierLangGraph({
    dependencies: {
      models: models({
        analyze() {
          const candidate = analysis("finding-selected");
          candidate.supportingEvidence[0]!.findingIds = ["finding-other"];
          return candidate;
        },
        critique() {
          critiqueCalls += 1;
          return { issues: [], missingFindingIds: [] };
        },
        compose() {
          return composeCandidate("finding-selected");
        }
      })
    }
  });

  await assert.rejects(() => invokeStructuredTodayV2DossierLangGraph({
    graph,
    workflowInput: dossierInput(),
    threadId: "dossier-v2-outside-finding"
  }), /outside selected workline: finding-other/u);
  assert.equal(critiqueCalls, 0);
});

test("SQLite retry resumes at failed critique without repeating completed analysis", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dossier-v2-checkpoint-"));
  const saver = NodeSqliteSaver.fromConnectionString(path.join(temporaryRoot, "checkpoints.sqlite"));
  let analyzeCalls = 0;
  let critiqueCalls = 0;
  let composeCalls = 0;
  try {
    const graph = createStructuredTodayV2DossierLangGraph({
      dependencies: {
        models: models({
          analyze() {
            analyzeCalls += 1;
            return analysis("finding-selected");
          },
          critique() {
            critiqueCalls += 1;
            if (critiqueCalls === 1) throw new Error("injected critique interruption");
            return { issues: [], missingFindingIds: [] };
          },
          compose() {
            composeCalls += 1;
            return composeCandidate("finding-selected");
          }
        })
      },
      checkpointer: saver
    });

    await assert.rejects(() => invokeStructuredTodayV2DossierLangGraph({
      graph,
      workflowInput: dossierInput(),
      threadId: "dossier-v2-critique-retry"
    }), /critique interruption/u);
    assert.equal(analyzeCalls, 1);
    assert.equal(critiqueCalls, 1);
    assert.equal(composeCalls, 0);

    const result = await retryStructuredTodayV2DossierLangGraph({
      graph,
      threadId: "dossier-v2-critique-retry"
    });
    assert.equal(result.artifact.schema, STRUCTURED_TODAY_DOSSIER_V2_SCHEMA);
    assert.equal(analyzeCalls, 1);
    assert.equal(critiqueCalls, 2);
    assert.equal(composeCalls, 1);
  } finally {
    saver.close();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

function models(input: {
  analyze(args: Parameters<StructuredTodayV2DossierModelFunctions["analyzeWorklineDossierV2"]>[0]): DossierAnalysisCandidateV2;
  critique(args: Parameters<StructuredTodayV2DossierModelFunctions["critiqueWorklineDossierV2"]>[0]): DossierCritiqueCandidateV2;
  compose(args: Parameters<StructuredTodayV2DossierModelFunctions["composeWorklineDossierV2"]>[0]): DossierComposeCandidateV2;
}): StructuredTodayV2DossierModelFunctions {
  return {
    async analyzeWorklineDossierV2(args) {
      return { output: input.analyze(args), invocation: invocation("AnalyzeWorklineDossier", "AnalyzeWorklineDossierV2/structured-v1") };
    },
    async critiqueWorklineDossierV2(args) {
      return { output: input.critique(args), invocation: invocation("CritiqueWorklineDossier", "CritiqueWorklineDossierV2/structured-v1") };
    },
    async composeWorklineDossierV2(args) {
      return { output: input.compose(args), invocation: invocation("ComposeWorklineDossier", "ComposeWorklineDossierV2/structured-v1") };
    }
  };
}

function analysis(findingId: string): DossierAnalysisCandidateV2 {
  return {
    priorContext: statement("The selected workline began from a verified state.", findingId),
    whatHappened: statement("The selected implementation completed.", findingId),
    possibleChange: statement("The verified result may change the next plan.", findingId, "inference-basis"),
    supportingEvidence: [statement("The implementation has direct support.", findingId)],
    opposingEvidence: [],
    falsifiableObservation: statement("A holdout may falsify the conclusion.", findingId, "inference-basis"),
    gaps: []
  };
}

function composeCandidate(findingId: string): DossierComposeCandidateV2 {
  return {
    title: "Selected V2 dossier",
    ...analysis(findingId),
    humanQuestion: statement("Should the verified result be adopted?", findingId, "inference-basis"),
    extensions: []
  };
}

function statement(
  text: string,
  findingId: string,
  relation: "source-span" | "inference-basis" = "source-span"
) {
  return { text, relation, findingIds: [findingId] };
}

function dossierInput(): StructuredTodayDossierWorkflowInputV2 {
  return {
    logicalDate: "2026-08-30",
    workflowRunId: "dossier-v2-run",
    artifactId: "dossier-v2-artifact",
    revision: 1,
    editorialContract: editorialContract(),
    sourceIndex: sourceIndex(),
    selectedWorklineId: "workline-selected"
  };
}

function sourceIndex(): TodayWorklineIndexV2 {
  const selected = evidenceBundle("selected", "1", "session-selected", "Selected verified finding");
  const other = evidenceBundle("other", "2", "session-other", "Other workline finding");
  const workline = (id: string, bundle: ReturnType<typeof evidenceBundle>) => ({
    worklineId: id,
    title: id === "workline-selected" ? "Selected workline" : "Other workline",
    summary: cited(`${id}-summary`, `${bundle.finding.text}.`, bundle),
    startedAt: "2026-08-30T01:00:00.000Z",
    endedAt: "2026-08-30T02:00:00.000Z",
    currentStop: cited(`${id}-stop`, "The current stop is verified.", bundle),
    possibleChange: cited(`${id}-change`, "The result may change the plan.", bundle, "inference-basis"),
    possibleChangeAdopted: false as const,
    participation: {
      account: { status: "described" as const, agent: "Agent completed the work." },
      statement: cited(`${id}-participation`, "Agent completed the work.", bundle)
    },
    evidenceReadiness: "ready" as const,
    sessionIds: [bundle.session.sessionId],
    evidenceIds: [bundle.evidence.evidenceId],
    extensions: []
  });
  const worklines = [workline("workline-selected", selected), workline("workline-other", other)];
  const base = {
    schema: STRUCTURED_TODAY_INDEX_V2_SCHEMA,
    artifactId: "index-v2-source",
    revision: 1,
    logicalDate: "2026-08-30",
    workflowRunId: "index-v2-run",
    evidenceManifestId: "manifest-v2",
    sessions: [selected.session, other.session],
    evidence: [selected.evidence, other.evidence],
    messageLocators: [selected.locator, other.locator],
    spans: [selected.span, other.span],
    findings: [selected.finding, other.finding],
    dispositions: [
      { sessionId: selected.session.sessionId, kind: "assigned" as const, worklineIds: ["workline-selected"], nodeOutputId: "node-selected" },
      { sessionId: other.session.sessionId, kind: "assigned" as const, worklineIds: ["workline-other"], nodeOutputId: "node-other" }
    ],
    worklines,
    coverage: { admitted: 2, assigned: 2, excluded: 0, failed: 0, unresolved: 0, complete: true },
    provenance: provenance([])
  };
  return TodayWorklineIndexV2Schema.parse({ ...base, contentHash: canonicalContentHash(base) });
}

function evidenceBundle(label: string, digit: string, sessionId: string, findingText: string) {
  const evidenceId = `evidence-${label}`;
  const messageKey = `msg-v2-${digit.repeat(64)}`;
  const locatorId = `locator-v2-${digit.repeat(64)}`;
  const spanId = `span-v2-${digit.repeat(64)}`;
  const sourceHash = digit.repeat(64);
  const quote = `${label} source quote`;
  return {
    session: {
      sessionId,
      provider: "codex" as const,
      sourcePath: `/private/tmp/${label}.jsonl`,
      title: `${label} Session`,
      startedAt: "2026-08-30T01:00:00.000Z",
      endedAt: "2026-08-30T02:00:00.000Z",
      evidenceIds: [evidenceId]
    },
    evidence: {
      evidenceId,
      sourceKind: "session" as const,
      provider: "codex" as const,
      sessionId,
      sourcePath: `/private/tmp/${label}.jsonl`,
      range: "bytes 0-100",
      contentHash: sourceHash
    },
    locator: {
      messageKey,
      messageLocatorId: locatorId,
      evidenceId,
      provider: "codex" as const,
      sessionId,
      role: "assistant" as const,
      authorKind: "agent" as const,
      rawRecord: { unit: "utf8-byte" as const, start: 0, end: 50, contentHash: "a".repeat(64) },
      parserVersion: "parser-v1",
      admissionPolicyVersion: "admission-v1",
      normalizedMessageHash: "b".repeat(64),
      frozenSourcePrefix: { byteLength: 100, contentHash: sourceHash }
    },
    span: {
      spanId,
      evidenceId,
      messageKey,
      messageLocatorId: locatorId,
      textQuote: { exact: quote },
      textPosition: { unit: "unicode-code-point" as const, start: 0, end: [...quote].length },
      quoteHash: sha256Text(quote)
    },
    finding: {
      findingId: `finding-${label}`,
      text: findingText,
      claimKind: "fact" as const,
      relation: "source-span" as const,
      spanIds: [spanId]
    }
  };
}

function cited(
  statementId: string,
  text: string,
  bundle: ReturnType<typeof evidenceBundle>,
  relation: "source-span" | "inference-basis" = "source-span"
) {
  return {
    statementId,
    text,
    relation,
    findingIds: [bundle.finding.findingId],
    spanIds: [bundle.span.spanId]
  };
}

function editorialContract() {
  const text = "canonical dossier V2 editorial contract";
  return {
    ref: { packageId: "traceink" as const, version: "dossier-v2", editorialContractHash: sha256Text(text) },
    text
  };
}

function provenance(invocations: StructuredTodayModelInvocationV1[]) {
  return {
    workflowVersion: "structured-today-workflow-v5-message-spans",
    editorialContract: editorialContract().ref,
    modelFunctionVersions: Object.fromEntries(invocations.map((item) => [item.functionName, item.functionVersion])),
    providerInvocations: invocations
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
