import assert from "node:assert/strict";
import test from "node:test";
import {
  compileDailyWorklineReview,
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
          ]
        });
      }
    }
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.command, "codex");
  assert.deepEqual(requests[0]?.args.slice(0, 4), ["exec", "--model", "review-model", "--ephemeral"]);
  assert.match(requests[0]?.stdin ?? "", /load-bearing assumption/i);
  assert.match(requests[0]?.stdin ?? "", /falsifiable future observation/i);
  assert.match(requests[0]?.stdin ?? "", /must not claim that the user decided/i);
  assert.ok(requests[0]?.stdin.includes("codex-scheduler.jsonl"));
  assert.ok(requests[0]?.stdin.includes("claude-research-ir.jsonl"));
  assert.equal(requests[0]?.stdin.includes("SECRET_THIN_SUMMARY"), false);
  assert.equal(requests[0]?.stdin.includes("ANOTHER_SECRET_THIN_SUMMARY"), false);

  assert.equal(review.promptProfile, "ksi-workline-review-v1");
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
  assert.match(requests[0]?.stdin ?? "", /read relevant canonical artifact paths/i);
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
          participation: [],
          dossier: { title: "材料路径", dek: "", blocks: [{ id: "one", kind: "evidence", title: "结果", body: "读取结果。", evidenceIds: ["artifact:codex:codex-relative:0"] }] }
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
        participation: [],
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
            }
          ]
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
