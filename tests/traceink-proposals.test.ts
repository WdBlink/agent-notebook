import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createEmptyData } from "../src/state";
import {
  TRACEINK_PROPOSALS_TRANSPORT_SCHEMA,
  compileTraceinkProposals
} from "../src/traceink-review";
import {
  sha256TraceinkText,
  traceinkArtifactReference,
  userReflectionAssetReference,
  type TraceinkDossierArtifactV1,
  type TraceinkProposalCategoryV1,
  type TraceinkProposalsArtifactDraftV1,
  type UserReflectionAssetV1
} from "../src/traceink-review-assets";
import { loadTraceinkSkillBundle } from "../src/traceink-skill-bundle";
import {
  appendTraceinkProposalDisposition,
  appendTraceinkProposalsRevision,
  activeIndexReferenceForDate,
  appendTraceinkDossierRevision,
  appendTraceinkIndexRevision,
  appendTraceinkReflectionRevision,
  createEmptyTraceinkAssetStore,
  currentTraceinkWorklineLineage,
  latestTraceinkDossier,
  latestTraceinkProposalDispositions,
  latestTraceinkProposals,
  normalizeTraceinkAssetStore
} from "../app/desktop/traceink-asset-store";
import { traceinkWorklineSelections } from "../src/traceink-index-navigation";
import { projectTraceinkReview } from "../src/traceink-review-state";

const logicalDate = "2026-08-15";
const reflectionText = "  我的思考是：我倾向于先验证 Research IR，但 Receipt 不应该直接承担 IR。\r\n明天先选两类真实任务；fixture 可以交给后台。以后可以写进 CTX，但现在先别执行任何写入。  ";

test("a saved reflection compiles into five proposal categories while preserving the user's exact bytes", async () => {
  const settings = createEmptyData().settings;
  settings.enabledSessionProviders = ["codex"];
  const bundle = await loadTraceinkSkillBundle();
  const dossier = dossierArtifact();
  const reflection = reflectionAsset(dossier);
  const rawMarkdown = proposalMarkdown(reflection.text);
  const proposals = proposalTransportItems();
  let providerCalls = 0;

  const draft = await compileTraceinkProposals(settings, dossier, reflection, {
    bundleLoader: async () => bundle,
    now: sequenceTimes("2026-08-15T12:01:00.000Z", "2026-08-15T12:02:00.000Z"),
    runner: async (request) => {
      if (request.args[0] === "features") return featureResult();
      providerCalls += 1;
      assert.match(request.stdin, /Execute only Traceink workflow step 5/);
      assert.match(request.stdin, /original ink/i);
      assert.ok(request.stdin.includes(reflection.text));
      assert.ok(request.stdin.includes(dossier.rawMarkdown));
      assert.match(request.stdin, /does not write CTX, schedule tomorrow, start background work, or seal anything/i);
      assert.equal(request.args.some((value) => value.startsWith("mcp_servers.")), false);
      const schemaIndex = request.args.indexOf("--output-schema");
      assert.ok(schemaIndex >= 0);
      assert.deepEqual(
        JSON.parse(await readFile(request.args[schemaIndex + 1]!, "utf8")),
        TRACEINK_PROPOSALS_TRANSPORT_SCHEMA
      );
      return codexResult({ rawMarkdown, proposals, transportComplete: true });
    }
  });

  assert.equal(providerCalls, 1);
  assert.equal(draft.stage, "proposals");
  assert.equal(draft.logicalDate, logicalDate);
  assert.equal(draft.worklineId, dossier.worklineId);
  assert.deepEqual(draft.sourceReflection, userReflectionAssetReference(reflection));
  assert.equal(draft.rawMarkdown, rawMarkdown);
  assert.ok(draft.rawMarkdown.includes(reflection.text));
  assert.deepEqual(
    draft.navigation.map((item) => "category" in item ? item.category : undefined),
    ["judgment", "tomorrow", "ctx", "background", "today-only"]
  );
  assert.deepEqual(draft.navigation.map((item) => item.id), ["J1", "T1", "C1", "B1", "D1"]);
  for (const item of draft.navigation) {
    assert.ok("proposalText" in item && rawMarkdown.includes(item.proposalText));
    assert.ok("sourceQuote" in item && reflection.text.includes(item.sourceQuote));
  }
});

test("proposal compilation rejects missing categories, invented source quotes, and altered original ink", async () => {
  const settings = createEmptyData().settings;
  settings.enabledSessionProviders = ["codex"];
  const dossier = dossierArtifact();
  const reflection = reflectionAsset(dossier);
  const validItems = proposalTransportItems();

  for (const output of [
    { rawMarkdown: proposalMarkdown(reflection.text), proposals: validItems.slice(0, 4), transportComplete: true },
    {
      rawMarkdown: proposalMarkdown(reflection.text),
      proposals: validItems.map((item, index) => index === 0 ? { ...item, sourceQuote: "原文里不存在" } : item),
      transportComplete: true
    },
    { rawMarkdown: proposalMarkdown(reflection.text.trim()), proposals: validItems, transportComplete: true }
  ]) {
    await assert.rejects(
      compileTraceinkProposals(settings, dossier, reflection, {
        runner: async (request) => request.args[0] === "features"
          ? featureResult()
          : codexResult(output)
      }),
      /five proposal categories|source quote|original reflection/i
    );
  }
});

test("proposal dispositions are immutable per-item records and never mutate proposal text", () => {
  const lineage = canonicalStoreWithReflection();
  const { dossier, reflection } = lineage;
  const draft = proposalDraft(dossier, reflection);
  const withProposals = appendTraceinkProposalsRevision(lineage.store, draft, userReflectionAssetReference(reflection));
  const proposal = latestTraceinkProposals(withProposals, reflection)!;
  const proposalReference = { ...traceinkArtifactReference(proposal), stage: "proposals" as const };
  const originalMarkdown = proposal.rawMarkdown;

  const accepted = appendTraceinkProposalDisposition(
    withProposals,
    proposalReference,
    "J1",
    { action: "accept", decidedAt: "2026-08-15T12:03:00.000Z" }
  );
  const dismissed = appendTraceinkProposalDisposition(
    accepted,
    proposalReference,
    "T1",
    { action: "dismiss", decidedAt: "2026-08-15T12:04:00.000Z" }
  );
  const deferred = appendTraceinkProposalDisposition(
    dismissed,
    proposalReference,
    "C1",
    { action: "defer", decidedAt: "2026-08-15T12:05:00.000Z" }
  );
  const rewritten = appendTraceinkProposalDisposition(
    deferred,
    proposalReference,
    "B1",
    { action: "rewrite", rewriteText: "  只整理清单，不启动任务。  ", decidedAt: "2026-08-15T12:06:00.000Z" }
  );
  const changedAgain = appendTraceinkProposalDisposition(
    rewritten,
    proposalReference,
    "J1",
    { action: "defer", decidedAt: "2026-08-15T12:07:00.000Z" }
  );

  assert.equal(changedAgain.artifacts.length, withProposals.artifacts.length);
  assert.equal(latestTraceinkProposals(changedAgain, reflection)?.rawMarkdown, originalMarkdown);
  assert.deepEqual(
    latestTraceinkProposalDispositions(changedAgain, proposal).map((item) => [item.proposalId, item.action, item.rewriteText]),
    [
      ["J1", "defer", undefined],
      ["T1", "dismiss", undefined],
      ["C1", "defer", undefined],
      ["B1", "rewrite", "  只整理清单，不启动任务。  "]
    ]
  );
  assert.equal(changedAgain.proposalDispositions?.filter((item) => item.proposalId === "J1").length, 2);
  assert.throws(
    () => appendTraceinkProposalDisposition(changedAgain, proposalReference, "unknown", {
      action: "accept",
      decidedAt: "2026-08-15T12:08:00.000Z"
    }),
    /proposal item/i
  );
  assert.throws(
    () => appendTraceinkProposalDisposition(changedAgain, proposalReference, "D1", {
      action: "rewrite",
      decidedAt: "2026-08-15T12:08:00.000Z"
    }),
    /rewrite text/i
  );
});

test("proposal append rejects a stale reflection and a competing proposal generation", () => {
  const lineage = canonicalStoreWithReflection();
  const { dossier, reflection, store: base } = lineage;
  const changedReflectionStore = appendTraceinkReflectionRevision(
    base,
    { ...traceinkArtifactReference(dossier), stage: "dossier" },
    "新的回顾版本。",
    "2026-08-15T12:05:00.000Z"
  );
  assert.throws(
    () => appendTraceinkProposalsRevision(
      changedReflectionStore,
      proposalDraft(dossier, reflection),
      userReflectionAssetReference(reflection),
      null
    ),
    /saved reflection changed/i
  );

  const first = appendTraceinkProposalsRevision(
    base,
    proposalDraft(dossier, reflection),
    userReflectionAssetReference(reflection),
    null
  );
  assert.throws(
    () => appendTraceinkProposalsRevision(
      first,
      proposalDraft(dossier, reflection),
      userReflectionAssetReference(reflection),
      null
    ),
    /proposals changed/i
  );
});

test("Today mutations accept only active index → latest dossier → latest reflection → latest proposals", () => {
  const initial = canonicalStoreWithReflection();
  const { dossier: dossierV1, reflection: reflectionV1 } = initial;
  let withProposalsV1 = appendTraceinkProposalsRevision(
    initial.store,
    proposalDraft(dossierV1, reflectionV1),
    userReflectionAssetReference(reflectionV1),
    null
  );
  const proposalsV1 = latestTraceinkProposals(withProposalsV1, reflectionV1)!;
  const proposalsV1Reference = { ...traceinkArtifactReference(proposalsV1), stage: "proposals" as const };

  const active = activeIndexReferenceForDate(withProposalsV1, logicalDate)!;
  const seed = dossierArtifact();
  const { id: _id, revision: _revision, outputHash: _outputHash, ...dossierDraft } = seed;
  const withDossierV2 = appendTraceinkDossierRevision(withProposalsV1, dossierDraft, active);
  const currentAfterDossier = currentTraceinkWorklineLineage(withDossierV2, logicalDate, dossierV1.worklineId);
  assert.equal(currentAfterDossier?.dossier?.revision, 2);
  assert.equal(currentAfterDossier?.reflection, undefined);
  assert.equal(currentAfterDossier?.proposals, undefined);
  assert.throws(
    () => appendTraceinkReflectionRevision(
      withDossierV2,
      { ...traceinkArtifactReference(dossierV1), stage: "dossier" },
      "不能保存到旧 dossier",
      "2026-08-15T12:10:00.000Z"
    ),
    /dossier changed/i
  );
  assert.throws(
    () => appendTraceinkProposalsRevision(
      withDossierV2,
      proposalDraft(dossierV1, reflectionV1),
      userReflectionAssetReference(reflectionV1),
      proposalsV1Reference
    ),
    /saved reflection changed/i
  );
  assert.throws(
    () => appendTraceinkProposalDisposition(withDossierV2, proposalsV1Reference, "J1", {
      action: "accept",
      decidedAt: "2026-08-15T12:11:00.000Z"
    }),
    /proposal artifact changed/i
  );

  const withReflectionV2 = appendTraceinkReflectionRevision(
    withProposalsV1,
    { ...traceinkArtifactReference(dossierV1), stage: "dossier" },
    "第二版回顾：明天再判断。",
    "2026-08-15T12:12:00.000Z"
  );
  const reflectionV2 = withReflectionV2.reflections.at(-1)!;
  const currentAfterReflection = currentTraceinkWorklineLineage(withReflectionV2, logicalDate, dossierV1.worklineId);
  assert.equal(currentAfterReflection?.reflection?.revision, 2);
  assert.equal(currentAfterReflection?.proposals, undefined);
  assert.throws(
    () => appendTraceinkProposalsRevision(
      withReflectionV2,
      proposalDraft(dossierV1, reflectionV1),
      userReflectionAssetReference(reflectionV1),
      proposalsV1Reference
    ),
    /saved reflection changed/i
  );
  assert.throws(
    () => appendTraceinkProposalDisposition(withReflectionV2, proposalsV1Reference, "J1", {
      action: "accept",
      decidedAt: "2026-08-15T12:13:00.000Z"
    }),
    /proposal artifact changed/i
  );
  assert.deepEqual(
    currentTraceinkWorklineLineage(withReflectionV2, logicalDate, dossierV1.worklineId)?.reflection,
    reflectionV2
  );

  const proposalsV2Draft = proposalDraft(dossierV1, reflectionV1);
  proposalsV2Draft.rawMarkdown += "\n\n重新整理于第二次请求。";
  const withProposalsV2 = appendTraceinkProposalsRevision(
    withProposalsV1,
    proposalsV2Draft,
    userReflectionAssetReference(reflectionV1),
    proposalsV1Reference
  );
  const proposalsV2 = latestTraceinkProposals(withProposalsV2, reflectionV1)!;
  assert.equal(proposalsV2.revision, 2);
  assert.throws(
    () => appendTraceinkProposalDisposition(withProposalsV2, proposalsV1Reference, "J1", {
      action: "accept",
      decidedAt: "2026-08-15T12:14:00.000Z"
    }),
    /proposal artifact changed/i
  );
  withProposalsV1 = appendTraceinkProposalDisposition(
    withProposalsV2,
    { ...traceinkArtifactReference(proposalsV2), stage: "proposals" },
    "J1",
    { action: "accept", decidedAt: "2026-08-15T12:15:00.000Z" }
  );
  assert.equal(withProposalsV1.proposalDispositions?.at(-1)?.proposalArtifact.revision, 2);
});

test("legacy proposal sidecars stay readable but do not block a compatible interactive revision", () => {
  const lineage = canonicalStoreWithReflection();
  const { dossier, reflection } = lineage;
  const current = appendTraceinkProposalsRevision(
    lineage.store,
    proposalDraft(dossier, reflection),
    userReflectionAssetReference(reflection)
  );
  const proposal = latestTraceinkProposals(current, reflection)!;
  const legacy = normalizeTraceinkAssetStore({
    ...current,
    artifacts: current.artifacts.map((artifact) => artifact.id === proposal.id
      ? {
          ...proposal,
          navigation: proposal.navigation.map(({ proposalText: _proposalText, ...item }) => item)
        }
      : artifact)
  });

  assert.equal(legacy.artifacts.find((item) => item.stage === "proposals")?.rawMarkdown, proposal.rawMarkdown);
  assert.equal(latestTraceinkProposals(legacy, reflection), undefined);
  const regenerated = appendTraceinkProposalsRevision(
    legacy,
    proposalDraft(dossier, reflection),
    userReflectionAssetReference(reflection),
    null
  );
  assert.equal(latestTraceinkProposals(regenerated, reflection)?.revision, 2);
});

test("a stored disposition must use the deterministic receipt lineage for its exact proposal item", () => {
  const lineage = canonicalStoreWithReflection();
  const { dossier, reflection } = lineage;
  let store = appendTraceinkProposalsRevision(
    lineage.store,
    proposalDraft(dossier, reflection),
    userReflectionAssetReference(reflection)
  );
  const proposals = latestTraceinkProposals(store, reflection)!;
  const proposalReference = { ...traceinkArtifactReference(proposals), stage: "proposals" as const };
  store = appendTraceinkProposalDisposition(store, proposalReference, "J1", {
    action: "accept",
    decidedAt: "2026-08-15T12:03:00.000Z"
  });
  const valid = store.proposalDispositions![0]!;
  const normalized = normalizeTraceinkAssetStore({
    ...store,
    proposalDispositions: [valid, {
      ...valid,
      id: "forged-other-lineage",
      revision: 100,
      action: "dismiss"
    }]
  });

  assert.equal(normalized.proposalDispositions?.length, 1);
  assert.equal(latestTraceinkProposalDispositions(normalized, proposals)[0]?.action, "accept");
});

test("review projection exposes stable proposal items and only their latest local disposition", () => {
  let store = appendTraceinkIndexRevision(createEmptyTraceinkAssetStore(), {
    schemaVersion: 1,
    logicalDate,
    stage: "index",
    producer: producer(),
    inputEvidenceHash: "8".repeat(64),
    rawMarkdown: "1. **产品方向**\n",
    coverage: [], evidence: [], navigation: [], warnings: []
  });
  const index = store.artifacts[0]!;
  const indexReference = activeIndexReferenceForDate(store, logicalDate)!;
  const selection = traceinkWorklineSelections(index as never)[0]!;
  store = appendTraceinkDossierRevision(store, {
    schemaVersion: 1,
    logicalDate,
    stage: "dossier",
    worklineId: selection.worklineId,
    producer: producer(),
    inputEvidenceHash: "7".repeat(64),
    rawMarkdown: "仍需你判断。",
    coverage: [],
    evidence: [{
      id: "E1", kind: "session", provider: "codex", sessionId: "session-one",
      path: "/tmp/session-one.jsonl", locator: "messages 1-3", contentHash: "2".repeat(64)
    }],
    navigation: [], warnings: []
  }, indexReference);
  const dossier = latestTraceinkDossierForState(store, selection.worklineId);
  store = appendTraceinkReflectionRevision(
    store,
    { ...traceinkArtifactReference(dossier), stage: "dossier" },
    reflectionText,
    "2026-08-15T12:00:00.000Z"
  );
  const reflection = store.reflections[0]!;
  store = appendTraceinkProposalsRevision(store, proposalDraft(dossier, reflection), userReflectionAssetReference(reflection));
  const proposals = latestTraceinkProposals(store, reflection)!;
  const proposalReference = { ...traceinkArtifactReference(proposals), stage: "proposals" as const };
  store = appendTraceinkProposalDisposition(store, proposalReference, "J1", {
    action: "accept", decidedAt: "2026-08-15T12:03:00.000Z"
  });
  store = appendTraceinkProposalDisposition(store, proposalReference, "J1", {
    action: "defer", decidedAt: "2026-08-15T12:04:00.000Z"
  });

  const projection = projectTraceinkReview(store, logicalDate, []);
  const workline = projection.worklines?.[0];
  assert.equal(workline?.proposals?.id, proposals.id);
  assert.equal(workline?.proposalItems.length, 5);
  assert.deepEqual(workline?.proposalItems[0], {
    proposalId: "J1",
    category: "judgment",
    proposalText: "倾向先验证 Research IR。",
    sourceQuote: "我倾向于先验证 Research IR",
    evidenceIds: ["E1"],
    latestDisposition: {
      ...(store.proposalDispositions?.at(-1)!),
      action: "defer"
    }
  });
});

function proposalDraft(
  dossier: TraceinkDossierArtifactV1,
  reflection: UserReflectionAssetV1
): TraceinkProposalsArtifactDraftV1 {
  const rawMarkdown = proposalMarkdown(reflection.text);
  const categoryPrefixes: Record<TraceinkProposalCategoryV1, string> = {
    judgment: "J", tomorrow: "T", ctx: "C", background: "B", "today-only": "D"
  };
  return {
    schemaVersion: 1,
    logicalDate,
    stage: "proposals",
    worklineId: dossier.worklineId,
    sourceReflection: userReflectionAssetReference(reflection),
    producer: dossier.producer,
    inputEvidenceHash: sha256TraceinkText("proposal input"),
    rawMarkdown,
    coverage: dossier.coverage,
    evidence: dossier.evidence,
    navigation: proposalTransportItems().map((item) => ({
      ...item,
      id: `${categoryPrefixes[item.category]}1`,
      markdownAnchor: `${categoryPrefixes[item.category]}1`.toLowerCase()
    })),
    warnings: []
  };
}

function dossierArtifact(): TraceinkDossierArtifactV1 {
  const rawMarkdown = "### 仍需你判断\n\n是否先验证 Research IR？ [E1]\n";
  return {
    schemaVersion: 1,
    id: "traceink-dossier-workline-one",
    logicalDate,
    stage: "dossier",
    worklineId: "workline-one",
    revision: 1,
    producer: producer(),
    inputEvidenceHash: "1".repeat(64),
    rawMarkdown,
    outputHash: sha256TraceinkText(rawMarkdown),
    coverage: [],
    evidence: [{
      id: "E1", kind: "session", provider: "codex", sessionId: "session-one",
      path: "/tmp/session-one.jsonl", locator: "messages 1-3", contentHash: "2".repeat(64)
    }],
    navigation: [],
    warnings: []
  };
}

function canonicalStoreWithReflection(): {
  store: ReturnType<typeof createEmptyTraceinkAssetStore>;
  dossier: TraceinkDossierArtifactV1;
  reflection: UserReflectionAssetV1;
} {
  let store = appendTraceinkIndexRevision(createEmptyTraceinkAssetStore(), {
    schemaVersion: 1,
    logicalDate,
    stage: "index",
    producer: producer(),
    inputEvidenceHash: sha256TraceinkText("index input"),
    rawMarkdown: "1. **产品方向**\n",
    coverage: [],
    evidence: [],
    navigation: [],
    warnings: []
  });
  const active = activeIndexReferenceForDate(store, logicalDate)!;
  const seed = dossierArtifact();
  const { id: _id, revision: _revision, outputHash: _outputHash, ...draft } = seed;
  store = appendTraceinkDossierRevision(store, draft, active);
  const dossier = latestTraceinkDossier(store, active, seed.worklineId)!;
  store = appendTraceinkReflectionRevision(
    store,
    { ...traceinkArtifactReference(dossier), stage: "dossier" },
    reflectionText,
    "2026-08-15T12:00:00.000Z"
  );
  return { store, dossier, reflection: store.reflections.at(-1)! };
}

function latestTraceinkDossierForState(
  store: ReturnType<typeof createEmptyTraceinkAssetStore>,
  worklineId: string
): TraceinkDossierArtifactV1 {
  const artifact = store.artifacts.find((item) => item.stage === "dossier" && item.worklineId === worklineId);
  assert.ok(artifact && artifact.stage === "dossier" && artifact.worklineId);
  return artifact as TraceinkDossierArtifactV1;
}

function reflectionAsset(dossier: TraceinkDossierArtifactV1): UserReflectionAssetV1 {
  return {
    schemaVersion: 1,
    id: "reflection-one",
    logicalDate,
    worklineId: dossier.worklineId,
    dossier: { ...traceinkArtifactReference(dossier), stage: "dossier" },
    revision: 1,
    text: reflectionText,
    createdAt: "2026-08-15T12:00:00.000Z",
    savedAt: "2026-08-15T12:00:00.000Z",
    contentHash: sha256TraceinkText(reflectionText)
  };
}

function proposalTransportItems(): Array<{
  category: TraceinkProposalCategoryV1;
  proposalText: string;
  sourceQuote: string;
  evidenceIds: string[];
}> {
  return [
    { category: "judgment", proposalText: "倾向先验证 Research IR。", sourceQuote: "我倾向于先验证 Research IR", evidenceIds: ["E1"] },
    { category: "tomorrow", proposalText: "选择两类真实任务。", sourceQuote: "明天先选两类真实任务", evidenceIds: [] },
    { category: "ctx", proposalText: "以后把方向变化整理成 CTX 候选。", sourceQuote: "以后可以写进 CTX", evidenceIds: [] },
    { category: "background", proposalText: "把 fixture 整理列为后台候选。", sourceQuote: "fixture 可以交给后台", evidenceIds: [] },
    { category: "today-only", proposalText: "不执行任何写入。", sourceQuote: "现在先别执行任何写入", evidenceIds: [] }
  ];
}

function proposalMarkdown(original: string): string {
  return [
    "### 你的原文 · 保持原样",
    "",
    original,
    "",
    "### 形成的判断",
    "- [J1] 倾向先验证 Research IR。",
    "### 明日候选",
    "- [T1] 选择两类真实任务。",
    "### CTX 候选",
    "- [C1] 以后把方向变化整理成 CTX 候选。",
    "### 后台候选",
    "- [B1] 把 fixture 整理列为后台候选。",
    "### 只留在今天",
    "- [D1] 不执行任何写入。",
    "",
    "以上全部只是提案；接受、驳回、延后或改写都不会触发外部动作。"
  ].join("\n");
}

function producer() {
  return {
    provider: "codex" as const,
    model: "gpt-5.6-sol",
    reasoningConfiguration: "ultra",
    startedAt: "2026-08-15T11:00:00.000Z",
    completedAt: "2026-08-15T11:01:00.000Z",
    skill: {
      packageId: "traceink" as const,
      version: "traceink-skill-bundle-v1",
      skillHash: "3".repeat(64),
      editorialContractHash: "4".repeat(64)
    },
    scope: {
      timeZone: "Asia/Shanghai",
      startInclusive: "2026-08-14T16:00:00.000Z",
      endExclusive: "2026-08-15T16:00:00.000Z",
      evidenceCutoff: "2026-08-15T10:00:00.000Z"
    }
  };
}

function featureResult(): { stdout: string; stderr: string } {
  return {
    stdout: [
      "shell_tool stable true",
      "unified_exec stable true",
      "view_image stable true",
      "skill_search stable true",
      "code_mode_buffered_exec under-development false"
    ].join("\n") + "\n",
    stderr: ""
  };
}

function codexResult(value: unknown): { stdout: string; stderr: string } {
  return {
    stdout: `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(value) } })}\n`,
    stderr: ""
  };
}

function sequenceTimes(...values: string[]): () => Date {
  return () => new Date(values.shift()!);
}
