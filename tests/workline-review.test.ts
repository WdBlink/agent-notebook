import assert from "node:assert/strict";
import test from "node:test";
import {
  compileDailyWorklineReview,
  normalizeDailyReviewPackage,
  type DailyReviewPackage
} from "../src/workline-review";
import { createEmptyData } from "../src/state";
import type { AgentWorkSession } from "../src/types";
import type { CliRunRequest } from "../src/agent-summary";

test("one Prompt reconstructs a cross-provider workline and keeps only verified evidence", async () => {
  const requests: CliRunRequest[] = [];
  const sessions = [
    session({
      id: "codex-scheduler",
      platform: "codex",
      path: "/tmp/codex-scheduler.jsonl",
      title: "优化 scheduler",
      summary: "SECRET_THIN_SUMMARY",
      artifacts: ["/workspace/research/results/scheduler.json"]
    }),
    session({
      id: "claude-research-ir",
      platform: "claude",
      path: "/tmp/claude-research-ir.jsonl",
      title: "设计 Research IR",
      summary: "ANOTHER_SECRET_THIN_SUMMARY",
      artifacts: ["/workspace/research/ctx/spec/research-ir.md"]
    })
  ];

  const review = await compileDailyWorklineReview(
    createEmptyData().settings,
    "2026-08-09",
    sessions,
    {
      homeDir: "/Users/test",
      preferredProvider: "codex",
      model: "review-model",
      evidenceCutoff: "2026-08-09T19:55:00+08:00",
      now: () => new Date("2026-08-09T20:15:00+08:00"),
      runner: async (request) => {
        requests.push(request);
        return codexResult({
          worklines: [
            {
              id: "research-ir-direction",
              title: "Research IR 取代 scheduler 优化成为主线",
              summary: "三轮实验没有改善调度结果，任务表示暴露出结构问题。",
              status: "needs-judgment",
              sourceSessionIds: [
                "codex:codex-scheduler",
                "claude:claude-research-ir",
                "codex:invented-session"
              ],
              startedAt: "2026-08-09T09:20:00+08:00",
              endedAt: "2026-08-09T18:05:00+08:00",
              participation: [
                {
                  id: "span-user",
                  kind: "user",
                  startAt: "2026-08-09T09:20:00+08:00",
                  endAt: "2026-08-09T09:35:00+08:00",
                  label: "你限定了实验范围"
                },
                {
                  id: "span-agent",
                  kind: "agent",
                  startAt: "2026-08-09T09:35:00+08:00",
                  endAt: "2026-08-09T17:40:00+08:00",
                  label: "Agent 独立推进"
                }
              ],
              dossier: {
                title: "瓶颈判断从调度性能转向任务表示",
                dek: "依据两个平台的会话与两份项目材料重建。",
                blocks: [
                  {
                    id: "prior",
                    kind: "prior-assumption",
                    label: "原来的判断",
                    title: "性能瓶颈可能在 scheduler",
                    body: "当天最初的工作以调度优化为目标。",
                    evidenceIds: ["session:codex:codex-scheduler"]
                  },
                  {
                    id: "counterfactual",
                    kind: "counterfactual-window",
                    label: "仍需验证",
                    title: "如果问题确实在 Research IR",
                    body: "更换两类真实任务后，结构失败应显著下降。",
                    evidenceIds: ["artifact:claude:claude-research-ir:0", "session:codex:missing"],
                    relation: "refines",
                    modelNote: { confidence: "medium" }
                  }
                ],
                question: {
                  prompt: "是否暂停 scheduler 优化，转向 Research IR？",
                  context: "证据支持重新评估，但尚不能证明用户已经决定。"
                }
              }
            }
          ],
          warnings: ["Claude transcript ended before the final user reply; prior context is unknown."]
        });
      }
    }
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.command, "codex");
  assert.deepEqual(requests[0]?.args.slice(0, 4), ["exec", "--model", "review-model", "--ephemeral"]);
  assert.match(requests[0]?.stdin ?? "", /complete admitted manifest/i);
  assert.match(requests[0]?.stdin ?? "", /weak hints, never authority/i);
  for (const marker of ["failed paths", "route changes", "conflicts", "scope", "current stop", "user participation", "Agent-independent work"]) {
    assert.match(requests[0]?.stdin ?? "", new RegExp(marker, "i"));
  }
  assert.match(requests[0]?.stdin ?? "", /prior assumption or context.*unknown/i);
  assert.match(requests[0]?.stdin ?? "", /possible change/i);
  assert.match(requests[0]?.stdin ?? "", /future observation.*strengthen, narrow, or overturn/i);
  assert.match(requests[0]?.stdin ?? "", /one real human question/i);
  assert.match(requests[0]?.stdin ?? "", /must not claim that the user decided/i);
  assert.ok(requests[0]?.stdin.includes("codex-scheduler.jsonl"));
  assert.ok(requests[0]?.stdin.includes("claude-research-ir.jsonl"));
  assert.equal(requests[0]?.stdin.includes("SECRET_THIN_SUMMARY"), false);
  assert.equal(requests[0]?.stdin.includes("ANOTHER_SECRET_THIN_SUMMARY"), false);

  assert.equal(review.promptProfile, "traceink-review-v1");
  assert.equal(review.generatedAt, "2026-08-09T12:15:00.000Z");
  assert.equal(review.evidenceCutoff, "2026-08-09T11:55:00.000Z");
  assert.equal(review.worklines.length, 1);
  assert.deepEqual(review.worklines[0]?.sourceSessionIds, [
    "codex:codex-scheduler",
    "claude:claude-research-ir"
  ]);
  assert.deepEqual(review.worklines[0]?.dossier.blocks[1]?.evidenceIds, [
    "artifact:claude:claude-research-ir:0"
  ]);
  assert.deepEqual(review.worklines[0]?.dossier.blocks[1]?.payload, {
    relation: "refines",
    modelNote: { confidence: "medium" }
  });
  assert.equal(review.worklines[0]?.dossier.question?.prompt, "是否暂停 scheduler 优化，转向 Research IR？");
  assert.equal(review.evidence.some((item) => item.id === "session:codex:missing"), false);
  assert.equal(review.rawOutput.worklines ? true : false, true);
  assert.equal(review.warnings.includes("Claude transcript ended before the final user reply; prior context is unknown."), true);
  assert.equal(review.provenance?.compiler.id, "workline-review");
  assert.equal(review.provenance?.compiler.version, "2");
  assert.equal(review.provenance?.promptProfile, "traceink-review-v1");
  assert.equal(review.provenance?.model.provider, "codex");
  assert.equal(review.provenance?.model.name, "review-model");
  assert.equal(review.provenance?.evidence.manifestVersion, "workline-evidence-manifest-v1");
  assert.deepEqual(review.provenance?.evidence.sourceRefs.map((source) => source.id), [
    "session:codex:codex-scheduler",
    "artifact:codex:codex-scheduler:0",
    "session:claude:claude-research-ir",
    "artifact:claude:claude-research-ir:0"
  ]);
  assert.deepEqual(review.provenance?.evidence.completenessWarnings, review.warnings);
});

test("relative artifact evidence is resolved against the provider-owned working directory", async () => {
  const review = await compileDailyWorklineReview(
    createEmptyData().settings,
    "2026-08-09",
    [session({ id: "codex-relative", path: "/tmp/codex-relative.jsonl", projectPath: "/workspace/research", artifacts: ["results/run.json"] })],
    {
      runner: async () => codexResult({
        worklines: [{
          id: "relative",
          title: "相对材料仍可重开",
          summary: "路径按会话工作目录解析。",
          sourceSessionIds: ["codex:codex-relative"],
          participation: [{ id: "unknown", kind: "unknown", label: "无法从可读范围确认用户参与。" }],
          dossier: {
            title: "材料路径",
            dek: "",
            blocks: [
              { id: "one", kind: "evidence", title: "结果", body: "读取结果。", evidenceIds: ["artifact:codex:codex-relative:0"] },
              { id: "future", kind: "validation-window", title: "未来验证", body: "若重开相对路径，路径解析应该通过并继续指向会话工作目录。", evidenceIds: ["artifact:codex:codex-relative:0"] }
            ],
            question: { prompt: "是否需要保留这条材料路径作为后续复核入口？" }
          }
        }]
      })
    }
  );
  assert.equal(review.evidence.find((item) => item.kind === "artifact")?.path, "/workspace/research/results/run.json");
});

test("a later Prompt may add a semantic role without requiring a schema migration", async () => {
  const review = await runReview({
    worklines: [
      {
        id: "one",
        title: "一条工作线",
        summary: "保留未知语义块。",
        status: "ready",
        sourceSessionIds: ["codex:codex-one"],
        participation: [{ id: "unknown", kind: "unknown", label: "无法从现有时间戳确认用户参与。" }],
        dossier: {
          title: "可读 dossier",
          dek: "",
          blocks: [
            {
              id: "novel",
              kind: "scope-tension",
              title: "适用边界仍有张力",
              body: "模型使用了未来版本才认识的组织方式。",
              evidenceIds: ["session:codex:codex-one"],
              affectedScopes: ["local", "project"],
              visualHint: "margin-note"
            },
            {
              id: "future",
              kind: "future-check",
              title: "未来如何验证",
              body: "若下一次整理仍出现相同边界张力，适用范围需要收窄。",
              evidenceIds: ["session:codex:codex-one"]
            }
          ],
          question: { prompt: "这条边界张力是否值得在下一次回看时优先核验？" }
        }
      }
    ]
  });

  assert.equal(review.worklines[0]?.dossier.blocks[0]?.kind, "scope-tension");
  assert.deepEqual(review.worklines[0]?.dossier.blocks[0]?.payload, {
    affectedScopes: ["local", "project"],
    visualHint: "margin-note"
  });
});

test("rejects a workline that omits any required Prompt-profile semantic gate", async () => {
  const omissions: Array<{ name: string; output: Record<string, unknown> }> = [
    {
      name: "admitted material evidence",
      output: semanticWorkline({ dossier: { blocks: [{ id: "claim", kind: "claim", title: "材料", body: "这是一个重要主张。", evidenceIds: [] }] } })
    },
    {
      name: "participation boundary",
      output: semanticWorkline({ participation: [] })
    },
    {
      name: "falsifiable future observation",
      output: semanticWorkline({ dossier: { blocks: [{ id: "claim", kind: "claim", title: "当前材料", body: "证据支持重新评估。", evidenceIds: ["session:codex:codex-one"] }] } })
    },
    {
      name: "human question",
      output: semanticWorkline({ dossier: { question: undefined } })
    }
  ];

  for (const omission of omissions) {
    await assert.rejects(
      () => runReview({ worklines: [omission.output] }),
      /没有返回可用的跨会话工作线/,
      omission.name
    );
  }
});

test("rejects a vague modal continuation as a future observation", async () => {
  const vague = semanticWorkline({
    dossier: {
      blocks: [
        { id: "material", kind: "material", title: "当前材料", body: "证据支持重新评估。", evidenceIds: ["session:codex:codex-one"] },
        { id: "vague", kind: "open-ended", title: "后续", body: "如果需要，可以继续优化", evidenceIds: ["session:codex:codex-one"] }
      ]
    }
  });

  await assert.rejects(
    () => runReview({ worklines: [vague] }),
    /没有返回可用的跨会话工作线/
  );
});

test("rejects a newly compiled workline when any substantive block lacks admitted evidence", async () => {
  const unsupported = semanticWorkline({
    dossier: {
      blocks: [
        { id: "material", kind: "material", title: "当前材料", body: "证据支持重新评估。", evidenceIds: ["session:codex:codex-one"] },
        { id: "unsupported", kind: "new-role", title: "没有依据的解释", body: "这是另一个实质解释。", evidenceIds: [] },
        { id: "future", kind: "future-check", title: "未来验证", body: "若约束失败再次出现，适用范围应该收窄。", evidenceIds: ["session:codex:codex-one"] }
      ]
    }
  });

  await assert.rejects(
    () => runReview({ worklines: [unsupported] }),
    /没有返回可用的跨会话工作线/
  );
});

test("reload keeps a semantically incomplete legacy workline and surfaces an incompleteness warning", () => {
  const stored = legacyStoredPackage();

  const reloaded = normalizeDailyReviewPackage(stored, "2026-08-09");

  assert.equal(reloaded?.worklines.length, 1);
  assert.equal(reloaded?.worklines[0]?.id, "legacy-workline");
  assert.deepEqual(reloaded?.worklines[0]?.participation, []);
  assert.equal(reloaded?.worklines[0]?.dossier.question, undefined);
  assert.match(reloaded?.warnings.join(" ") ?? "", /incomplete/i);
});

test("reload preserves a historically versioned provenance record when canonical facts still match", async () => {
  const review = await runReview({ worklines: [semanticWorkline()] });
  const stored = JSON.parse(JSON.stringify(review)) as DailyReviewPackage;
  stored.provenance!.compiler.version = "1";
  stored.provenance!.evidence.manifestVersion = "workline-evidence-manifest-v0";

  const reloaded = normalizeDailyReviewPackage(stored, "2026-08-09");

  assert.equal(reloaded?.provenance?.compiler.version, "1");
  assert.equal(reloaded?.provenance?.evidence.manifestVersion, "workline-evidence-manifest-v0");
  assert.equal(reloaded?.provenance?.evidence.cutoff, review.evidenceCutoff);
  assert.deepEqual(reloaded?.provenance?.evidence.sourceRefs, review.evidence);
  assert.deepEqual(reloaded?.provenance?.evidence.completenessWarnings, review.warnings);
});

test("reload surfaces malformed provenance instead of silently erasing it", async () => {
  const review = await runReview({ worklines: [semanticWorkline()] });
  const stored = JSON.parse(JSON.stringify(review)) as DailyReviewPackage;
  stored.provenance!.evidence.sourceRefs[0]!.path = "/tmp/not-the-admitted-path.jsonl";

  const reloaded = normalizeDailyReviewPackage(stored, "2026-08-09");

  assert.equal(reloaded?.provenance, undefined);
  assert.match(reloaded?.warnings.join(" ") ?? "", /provenance/i);
});

test("reload reserves warning capacity for provenance diagnostics", async () => {
  const review = await runReview({ worklines: [semanticWorkline()] });
  const stored = JSON.parse(JSON.stringify(review)) as DailyReviewPackage;
  stored.warnings = Array.from({ length: 12 }, (_, index) => `ordinary warning ${index + 1}`);
  stored.provenance!.evidence.completenessWarnings = [...stored.warnings];
  stored.provenance!.evidence.sourceRefs[0]!.path = "/tmp/not-the-admitted-path.jsonl";

  const reloaded = normalizeDailyReviewPackage(stored, "2026-08-09");

  assert.equal(reloaded?.warnings.length, 12);
  assert.match(reloaded?.warnings.join(" ") ?? "", /provenance/i);
});

test("reload leaves a legacy package without provenance free of invented provenance warnings", async () => {
  const review = await runReview({ worklines: [semanticWorkline()] });
  const stored = JSON.parse(JSON.stringify(review)) as DailyReviewPackage;
  delete stored.provenance;

  const reloaded = normalizeDailyReviewPackage(stored, "2026-08-09");

  assert.equal(reloaded?.provenance, undefined);
  assert.deepEqual(reloaded?.warnings, review.warnings);
});

test("zero valid worklines is a visible compiler failure, not a thin-summary fallback", async () => {
  await assert.rejects(
    () => runReview({ worklines: [] }),
    /没有返回可用的跨会话工作线/
  );
});

async function runReview(output: unknown): Promise<DailyReviewPackage> {
  return compileDailyWorklineReview(
    createEmptyData().settings,
    "2026-08-09",
    [session({ id: "codex-one", platform: "codex", path: "/tmp/codex-one.jsonl" })],
    {
      homeDir: "/Users/test",
      now: () => new Date("2026-08-09T20:15:00+08:00"),
      runner: async () => codexResult(output)
    }
  );
}

function semanticWorkline(overrides: { participation?: unknown; dossier?: Record<string, unknown> } = {}): Record<string, unknown> {
  const dossier = {
    title: "Evidence-led review",
    dek: "",
    blocks: [
      {
        id: "material",
        kind: "unfixed-semantic-role",
        title: "来自会话的材料",
        body: "证据表明值得重新评估。",
        evidenceIds: ["session:codex:codex-one"],
        futurePayload: { remains: "extensible" }
      },
      {
        id: "future",
        kind: "another-future-role",
        title: "未来如何验证",
        body: "若下次观察到相同约束失败，应该收窄这个可能变化。",
        evidenceIds: ["session:codex:codex-one"]
      }
    ],
    question: { prompt: "是否值得优先验证这个可能变化？" },
    ...overrides.dossier
  };
  return {
    id: "semantic-workline",
    title: "一条可复核的工作线",
    summary: "由可重开材料支持。",
    status: "needs-judgment",
    sourceSessionIds: ["codex:codex-one"],
    participation: overrides.participation ?? [{ id: "uncertain", kind: "uncertain", label: "无法确定用户参与边界。" }],
    dossier
  };
}

function legacyStoredPackage(): DailyReviewPackage {
  return {
    schemaVersion: 1,
    id: "review-2026-08-09-legacy",
    logicalDate: "2026-08-09",
    generatedAt: "2026-08-09T12:00:00.000Z",
    evidenceCutoff: "2026-08-09T11:55:00.000Z",
    promptProfile: "ksi-workline-review-v1",
    compilerProvider: "codex",
    model: "legacy-review-model",
    evidence: [{
      id: "session:codex:legacy-session",
      kind: "session",
      label: "旧会话",
      path: "/tmp/legacy-session.jsonl",
      platform: "codex",
      sessionId: "legacy-session",
      startedAt: "2026-08-09T01:00:00.000Z",
      updatedAt: "2026-08-09T02:00:00.000Z"
    }],
    worklines: [{
      id: "legacy-workline",
      title: "旧工作线",
      summary: "历史包只有基础整理结果。",
      status: "uncertain",
      sourceSessionIds: ["codex:legacy-session"],
      participation: [],
      dossier: {
        title: "旧 dossier",
        dek: "",
        blocks: [{
          id: "legacy-block",
          kind: "legacy-note",
          title: "当时发生了什么",
          body: "旧编译器保留了这个有依据的事实块。",
          evidenceIds: ["session:codex:legacy-session"],
          payload: { historical: true }
        }]
      },
      payload: {}
    }],
    warnings: [],
    rawOutput: { worklines: [{ id: "legacy-workline" }] }
  };
}

function codexResult(output: unknown): { stdout: string; stderr: string } {
  return {
    stdout: `${JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: JSON.stringify(output) }
    })}\n`,
    stderr: ""
  };
}

function session(overrides: Partial<AgentWorkSession> = {}): AgentWorkSession {
  return {
    id: "codex-default",
    platform: "codex",
    title: "默认会话",
    summary: "元数据摘要不应成为 dossier 的证据。",
    path: "/tmp/default.jsonl",
    updatedAt: "2026-08-09T18:00:00+08:00",
    startedAt: "2026-08-09T09:00:00+08:00",
    projectPath: "/workspace/research",
    branch: "feature/research-ir",
    artifacts: [],
    status: "active",
    ...overrides
  };
}
