import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, realpath, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  compileDailyWorklineReview,
  inspectDailyReviewPackageQuality,
  normalizeDailyReviewPackage,
  type DailyReviewPackage,
  type WorklineTranscriptFreezer
} from "../src/workline-review";
import { createEmptyData } from "../src/state";
import type { AgentWorkSession, CockpitSettings } from "../src/types";
import type { CliRunRequest } from "../src/agent-summary";
import { CliProtocolError } from "../src/cli-output-collector";

const passThroughTranscriptFreezer: WorklineTranscriptFreezer = async (sessions, use) =>
  use(sessions, "/tmp/work-continuity-test-freeze");

test("compile reads only the scanner-admitted prefix from a temporary frozen transcript and removes it afterward", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "work-continuity-review-freeze-"));
  const sourcePath = path.join(temp, "session.jsonl");
  const admittedContent = "captured transcript\n";
  let frozenPath = "";

  try {
    await writeFile(sourcePath, admittedContent);
    const canonicalPath = await realpath(sourcePath);
    await appendFile(sourcePath, "APPENDED_SECRET\n");
    const review = await compileDailyWorklineReview(
      createEmptyData().settings,
      "2026-08-09",
      [session({
        id: "codex-one",
        path: canonicalPath,
        transcriptCapture: {
          canonicalPath,
          sha256: "7eb259ab4a8d18e582fe130bbe7c5eab409a7aad12f157fd63130c3c7d3b648d",
          byteLength: 20,
          coverage: { startByte: 0, endByte: 20 }
        }
      })],
      {
        runner: async (request) => {
          const match = request.stdin.match(/"transcriptPath":\s*("(?:[^"\\]|\\.)*")/);
          assert.ok(match?.[1]);
          frozenPath = JSON.parse(match[1]) as string;
          assert.notEqual(frozenPath, canonicalPath);
          assert.equal(request.cwd, path.dirname(frozenPath));
          assert.equal(await readFile(frozenPath, "utf8"), admittedContent);
          assert.equal((await stat(frozenPath)).mode & 0o777, 0o400);
          assert.equal(request.stdin.includes(canonicalPath), false);
          assert.equal(request.stdin.includes(sourcePath), false);
          assert.equal(request.stdin.includes("APPENDED_SECRET"), false);
          return codexResult({ worklines: [semanticWorkline()] });
        }
      }
    );

    assert.deepEqual(review.evidence[0], {
      id: "session:codex:codex-one",
      kind: "session",
      label: "默认会话",
      path: canonicalPath,
      platform: "codex",
      sessionId: "codex-one",
      startedAt: "2026-08-09T01:00:00.000Z",
      updatedAt: "2026-08-09T10:00:00.000Z",
      transcriptCapture: {
        canonicalPath,
        sha256: "7eb259ab4a8d18e582fe130bbe7c5eab409a7aad12f157fd63130c3c7d3b648d",
        byteLength: 20,
        coverage: { startByte: 0, endByte: 20 }
      }
    });
    assert.deepEqual(review.provenance?.evidence.sourceRefs, review.evidence);
    assert.equal(JSON.stringify(review).includes("work-continuity-evidence-"), false);
    await assert.rejects(() => readFile(frozenPath), { code: "ENOENT" });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("compile rejects a covered-prefix mutation even when byte length and mtime are unchanged", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "work-continuity-review-mutation-"));
  const sourcePath = path.join(temp, "session.jsonl");
  const fixedTime = new Date("2026-08-09T10:00:00.000Z");

  try {
    await writeFile(sourcePath, "captured transcript\n");
    await utimes(sourcePath, fixedTime, fixedTime);
    const canonicalPath = await realpath(sourcePath);
    await writeFile(sourcePath, "mutated transcript!\n");
    await utimes(sourcePath, fixedTime, fixedTime);
    assert.equal((await stat(sourcePath)).size, 20);
    assert.equal((await stat(sourcePath)).mtime.toISOString(), fixedTime.toISOString());

    await assert.rejects(
      () => compileDailyWorklineReview(
        createEmptyData().settings,
        "2026-08-09",
        [session({
          id: "codex-one",
          path: canonicalPath,
          transcriptCapture: {
            canonicalPath,
            sha256: "7eb259ab4a8d18e582fe130bbe7c5eab409a7aad12f157fd63130c3c7d3b648d",
            byteLength: 20,
            coverage: { startByte: 0, endByte: 20 }
          }
        })],
        { runner: async () => codexResult({ worklines: [semanticWorkline()] }) }
      ),
      /证据.*(变化|不匹配)|hash|SHA-256/i
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("compile removes its frozen transcript when the model runner fails", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "work-continuity-review-cleanup-"));
  const sourcePath = path.join(temp, "session.jsonl");
  let frozenPath = "";

  try {
    await writeFile(sourcePath, "captured transcript\n");
    const canonicalPath = await realpath(sourcePath);
    await assert.rejects(
      compileDailyWorklineReview(
        createEmptyData().settings,
        "2026-08-09",
        [session({
          id: "codex-one",
          path: canonicalPath,
          transcriptCapture: {
            canonicalPath,
            sha256: "7eb259ab4a8d18e582fe130bbe7c5eab409a7aad12f157fd63130c3c7d3b648d",
            byteLength: 20,
            coverage: { startByte: 0, endByte: 20 }
          }
        })],
        {
          runner: async (request) => {
            const match = request.stdin.match(/"transcriptPath":\s*("(?:[^"\\]|\\.)*")/);
            assert.ok(match?.[1]);
            frozenPath = JSON.parse(match[1]) as string;
            throw new Error("runner failed after reading frozen evidence");
          }
        }
      ),
      /runner failed/
    );
    assert.ok(frozenPath);
    await assert.rejects(() => readFile(frozenPath), { code: "ENOENT" });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

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
      transcriptFreezer: passThroughTranscriptFreezer,
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
                    evidenceIds: ["session:claude:claude-research-ir", "session:codex:missing"],
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
  assert.deepEqual(requests[0]?.args.slice(0, 6), [
    "exec",
    "--ignore-user-config",
    "--model",
    "review-model",
    "--ephemeral",
    "--skip-git-repo-check"
  ]);
  assert.match(requests[0]?.stdin ?? "", /complete admitted manifest/i);
  assert.match(requests[0]?.stdin ?? "", /bounded batches/i);
  assert.match(requests[0]?.stdin ?? "", /coverage register/i);
  assert.match(requests[0]?.stdin ?? "", /Never cat or print a whole large transcript/i);
  assert.match(requests[0]?.stdin ?? "", /inventory event types and timestamps/i);
  assert.equal(requests[0]?.stdoutMode, "codex-jsonl");
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
    "session:claude:claude-research-ir"
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
  assert.equal(review.provenance?.compiler.version, "3");
  assert.equal(review.provenance?.promptProfile, "traceink-review-v1");
  assert.equal(review.provenance?.model.provider, "codex");
  assert.equal(review.provenance?.model.name, "review-model");
  assert.equal(review.provenance?.evidence.manifestVersion, "workline-evidence-manifest-v2");
  assert.deepEqual(review.provenance?.evidence.sourceRefs.map((source) => source.id), [
    "session:codex:codex-scheduler",
    "session:claude:claude-research-ir"
  ]);
  assert.deepEqual(review.provenance?.evidence.completenessWarnings, review.warnings);
});

test("review falls back once to another enabled provider when the preferred CLI invocation fails", async () => {
  const commands: string[] = [];
  const settings: CockpitSettings = {
    ...createEmptyData().settings,
    enabledSessionProviders: ["codex", "claude"]
  };

  const review = await compileDailyWorklineReview(
    settings,
    "2026-08-09",
    [session({ id: "codex-one", path: "/tmp/codex-one.jsonl" })],
    {
      transcriptFreezer: passThroughTranscriptFreezer,
      runner: async (request) => {
        commands.push(request.command);
        if (request.command === "codex") throw new Error("CLI 退出码 1：provider unavailable");
        return {
          stdout: JSON.stringify({ structured_output: { worklines: [semanticWorkline()] } }),
          stderr: ""
        };
      }
    }
  );

  assert.deepEqual(commands, ["codex", "claude"]);
  assert.equal(review.compilerProvider, "claude");
  assert.match(review.warnings.join(" "), /Codex.*失败.*Claude Code/i);
});

test("semantic validation failure never triggers a second provider call", async () => {
  const commands: string[] = [];
  const settings: CockpitSettings = {
    ...createEmptyData().settings,
    enabledSessionProviders: ["codex", "claude"]
  };

  await assert.rejects(
    () => compileDailyWorklineReview(
      settings,
      "2026-08-09",
      [session({ id: "codex-one", path: "/tmp/codex-one.jsonl" })],
      {
        transcriptFreezer: passThroughTranscriptFreezer,
        runner: async (request) => {
          commands.push(request.command);
          return codexResult({ worklines: [] });
        }
      }
    ),
    /没有返回可用的跨会话工作线/
  );

  assert.deepEqual(commands, ["codex"]);
});

test("a local final-output protocol failure never spends a second provider call", async () => {
  const commands: string[] = [];
  const settings: CockpitSettings = {
    ...createEmptyData().settings,
    enabledSessionProviders: ["codex", "claude"]
  };

  await assert.rejects(
    () => compileDailyWorklineReview(
      settings,
      "2026-08-09",
      [session({ id: "codex-one", path: "/tmp/codex-one.jsonl" })],
      {
        transcriptFreezer: passThroughTranscriptFreezer,
        runner: async (request) => {
          commands.push(request.command);
          throw new CliProtocolError("final-output-too-large", "Codex 最终整理结果超过 4 MB 限制");
        }
      }
    ),
    /最终整理结果超过 4 MB/
  );

  assert.deepEqual(commands, ["codex"]);
});

test("path-only artifacts are excluded until their bytes have an integrity capture", async () => {
  let prompt = "";
  const review = await compileDailyWorklineReview(
    createEmptyData().settings,
    "2026-08-09",
    [session({ id: "codex-relative", path: "/tmp/codex-relative.jsonl", projectPath: "/workspace/research", artifacts: ["results/run.json"] })],
    {
      transcriptFreezer: passThroughTranscriptFreezer,
      runner: async (request) => {
        prompt = request.stdin;
        return codexResult({
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
              { id: "one", kind: "evidence", title: "结果", body: "当前只采纳会话内容。", evidenceIds: ["session:codex:codex-relative"] },
              { id: "future", kind: "validation-window", title: "未来验证", body: "若下次材料拥有完整捕获，它应该出现并可复核。", evidenceIds: ["session:codex:codex-relative"] }
            ],
            question: { prompt: "是否需要保留这条材料路径作为后续复核入口？" }
          }
        }]
      });
      }
    }
  );
  assert.equal(review.evidence.some((item) => item.kind === "artifact"), false);
  assert.equal(prompt.includes("/workspace/research/results/run.json"), false);
  assert.match(review.warnings.join(" "), /artifact.*(?:hash|哈希)|材料.*哈希/i);
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

test("reload preserves a semantically incomplete legacy package while quality inspection remains derived", () => {
  const stored = legacyStoredPackage();

  const reloaded = normalizeDailyReviewPackage(stored, "2026-08-09");

  assert.deepEqual(reloaded, stored);
  assert.ok(reloaded);
  assert.match(inspectDailyReviewPackageQuality(reloaded).join(" "), /incomplete/i);
  assert.deepEqual(reloaded, stored);
});

test("reload preserves an atomic transcript capture without weakening legacy packages", () => {
  const stored = legacyStoredPackage();
  stored.evidence[0]!.path = "/tmp/legacy  session.jsonl ";
  stored.evidence[0]!.transcriptCapture = {
    canonicalPath: "/tmp/legacy  session.jsonl ",
    sha256: "7eb259ab4a8d18e582fe130bbe7c5eab409a7aad12f157fd63130c3c7d3b648d",
    byteLength: 20,
    coverage: { startByte: 0, endByte: 20 }
  };

  const reloaded = normalizeDailyReviewPackage(stored, "2026-08-09");

  assert.equal(reloaded?.evidence[0]?.path, stored.evidence[0]!.path);
  assert.deepEqual(reloaded?.evidence[0]?.transcriptCapture, stored.evidence[0]!.transcriptCapture);
  assert.deepEqual(normalizeDailyReviewPackage(legacyStoredPackage(), "2026-08-09"), legacyStoredPackage());
});

test("reload rejects a present partial capture instead of silently downgrading it to a legacy reference", () => {
  const stored = legacyStoredPackage();
  stored.evidence[0]!.transcriptCapture = {
    canonicalPath: "/tmp/legacy-session.jsonl",
    sha256: "7eb259ab4a8d18e582fe130bbe7c5eab409a7aad12f157fd63130c3c7d3b648d",
    byteLength: 20,
    coverage: { startByte: 0, endByte: 19 }
  };

  assert.equal(normalizeDailyReviewPackage(stored, "2026-08-09"), undefined);
});

test("reload rejects the whole package when any captured evidence row is malformed", () => {
  const stored = legacyStoredPackage();
  stored.evidence.push({
    ...structuredClone(stored.evidence[0]!),
    id: "session:claude:second",
    label: "Second Session",
    path: "/tmp/second-session.jsonl",
    platform: "claude",
    sessionId: "second",
    transcriptCapture: {
      canonicalPath: "/tmp/second-session.jsonl",
      sha256: "a".repeat(64),
      byteLength: 25,
      coverage: { startByte: 0, endByte: 24 }
    }
  });

  assert.equal(normalizeDailyReviewPackage(stored, "2026-08-09"), undefined);
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
      transcriptFreezer: passThroughTranscriptFreezer,
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
