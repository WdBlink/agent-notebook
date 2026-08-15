import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { CliRunRequest } from "../src/agent-summary";
import { createEmptyData } from "../src/state";
import {
  TRACEINK_CONTRACT_BEGIN_MARKER,
  TRACEINK_CONTRACT_END_MARKER,
  TRACEINK_INDEX_MODEL,
  TRACEINK_INDEX_REASONING,
  TRACEINK_INDEX_TRANSPORT_SCHEMA,
  TRACEINK_SKILL_BEGIN_MARKER,
  TRACEINK_SKILL_END_MARKER,
  buildTraceinkIndexPrompt,
  compileTraceinkIndex
} from "../src/traceink-review";
import { loadTraceinkSkillBundle } from "../src/traceink-skill-bundle";
import type { AgentWorkSession } from "../src/types";
import type { WorklineTranscriptFreezer } from "../src/workline-review";

const passThroughFreezer: WorklineTranscriptFreezer = async (sessions, use) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "traceink-index-test-"));
  try {
    const frozen = await Promise.all(sessions.map(async (item, index) => {
      const frozenPath = path.join(root, `${index + 1}-${path.basename(item.path)}`);
      const bytes = Buffer.alloc(item.transcriptCapture?.byteLength ?? 1, "a");
      await writeFile(frozenPath, bytes);
      await chmod(frozenPath, 0o400);
      return { ...item, path: frozenPath };
    }));
    return await use(frozen, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("canonical index run embeds the complete Skill, returns exact Markdown, and uses the capable Codex pair", async () => {
  const settings = createEmptyData().settings;
  settings.enabledSessionProviders = ["codex", "claude"];
  const bundle = await loadTraceinkSkillBundle();
  const markdown = "  ## 今日工作线\r\n\r\n1. **跨 Session 主线**  \r\n\r\n你想先展开哪一条？\r\n  ";
  const requests: CliRunRequest[] = [];
  const featureRequests: CliRunRequest[] = [];
  const times = [new Date("2026-08-15T10:00:00.000Z"), new Date("2026-08-15T10:03:00.000Z")];

  const draft = await compileTraceinkIndex(settings, "2026-08-15", [session()], {
    transcriptFreezer: passThroughFreezer,
    bundleLoader: async () => bundle,
    scope: reviewScope(),
    now: () => times.shift()!,
    runner: async (request) => {
      if (request.args[0] === "features") {
        featureRequests.push(request);
        return featureResult();
      }
      requests.push(request);
      const schemaIndex = request.args.indexOf("--output-schema");
      assert.ok(schemaIndex >= 0);
      const schemaPath = request.args[schemaIndex + 1];
      assert.ok(schemaPath);
      assert.deepEqual(JSON.parse(await readFile(schemaPath, "utf8")), TRACEINK_INDEX_TRANSPORT_SCHEMA);
      assert.equal(sliceBetween(request.stdin, TRACEINK_SKILL_BEGIN_MARKER, TRACEINK_SKILL_END_MARKER), bundle.skillText);
      assert.equal(sliceBetween(request.stdin, TRACEINK_CONTRACT_BEGIN_MARKER, TRACEINK_CONTRACT_END_MARKER), bundle.editorialContractText);
      assert.match(request.stdin, /Execute only Traceink workflow steps 1–3/);
      assert.match(request.stdin, /Do not open a selected workline/);
      assert.match(request.stdin, /rawMarkdown is the semantic authority/);
      assert.match(request.stdin, /app-owned Traceink evidence MCP tools/);
      assert.doesNotMatch(request.stdin, /"readPath"/);
      assert.equal(request.stdin.includes(request.cwd), false);
      return codexResult({ rawMarkdown: markdown, transportComplete: true });
    }
  });

  assert.equal(requests.length, 1);
  assert.equal(featureRequests.length, 1);
  assert.deepEqual(featureRequests[0]?.args, ["features", "list"]);
  assert.equal(featureRequests[0]?.stdoutMode, "buffered");
  assert.equal(requests[0]?.command, settings.codexCliPath.replace("~", os.homedir()));
  assert.deepEqual(requests[0]?.args.slice(0, 4), [
    "exec",
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config"
  ]);
  assert.equal(hasDisabledFeature(requests[0]!.args, "shell_tool"), true);
  assert.equal(hasDisabledFeature(requests[0]!.args, "unified_exec"), true);
  assert.equal(hasDisabledFeature(requests[0]!.args, "code_mode_host"), true);
  assert.equal(hasDisabledFeature(requests[0]!.args, "workspace_dependencies"), true);
  assert.equal(hasDisabledFeature(requests[0]!.args, "apps"), true);
  assert.equal(hasDisabledFeature(requests[0]!.args, "plugins"), true);
  assert.equal(hasDisabledFeature(requests[0]!.args, "view_image"), true);
  assert.equal(hasDisabledFeature(requests[0]!.args, "skill_search"), true);
  assert.deepEqual(
    configValues(requests[0]!.args).filter((value) => value.startsWith("mcp_servers.")).map((value) => value.split("=")[0]),
    [
      "mcp_servers.traceink_evidence.command",
      "mcp_servers.traceink_evidence.args",
      "mcp_servers.traceink_evidence.env.ELECTRON_RUN_AS_NODE",
      "mcp_servers.traceink_evidence.startup_timeout_sec",
      "mcp_servers.traceink_evidence.tool_timeout_sec"
    ]
  );
  assert.equal(requests[0]?.stdoutMode, "codex-jsonl");
  assert.equal(requests[0]?.timeoutMs, 30 * 60 * 1_000);
  assert.equal(draft.rawMarkdown, markdown);
  assert.equal(draft.stage, "index");
  assert.equal(draft.logicalDate, "2026-08-15");
  assert.equal(draft.producer.model, TRACEINK_INDEX_MODEL);
  assert.equal(draft.producer.reasoningConfiguration, TRACEINK_INDEX_REASONING);
  assert.equal(draft.producer.startedAt, "2026-08-15T10:00:00.000Z");
  assert.equal(draft.producer.completedAt, "2026-08-15T10:03:00.000Z");
  assert.deepEqual(draft.producer.scope, {
    timeZone: "Asia/Shanghai",
    startInclusive: "2026-08-14T16:00:00.000Z",
    endExclusive: "2026-08-15T16:00:00.000Z",
    evidenceCutoff: "2026-08-15T10:00:00.000Z"
  });
  assert.equal(draft.producer.skill.skillHash, bundle.skillHash);
  assert.equal(draft.evidence[0]?.path, "/tmp/codex-one.jsonl");
  assert.equal(draft.evidence[0]?.contentHash, "a".repeat(64));
  assert.match(draft.inputEvidenceHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(draft.coverage, [{
    sourceId: draft.evidence[0]!.id,
    disposition: "read",
    detail: "已冻结并交给受限证据读取器；未提供完整发现范围。"
  }]);
  assert.match(draft.warnings.join("\n"), /未提供完整发现范围/);
  assert.equal("id" in draft, false);
  assert.equal("revision" in draft, false);
  assert.equal("outputHash" in draft, false);
  assert.equal("worklineId" in draft, false);
  assert.equal("sourceReflection" in draft, false);
});

test("index prompt preserves the canonical bundle byte slices without trimming", async () => {
  const bundle = await loadTraceinkSkillBundle();
  const prompt = buildTraceinkIndexPrompt({
    bundle,
    logicalDate: "2026-08-15",
    scope: {
      timeZone: "Asia/Shanghai",
      startInclusive: "2026-08-14T16:00:00.000Z",
      endExclusive: "2026-08-15T16:00:00.000Z",
      evidenceCutoff: "2026-08-15T10:00:00.000Z"
    },
    evidence: [],
    coverage: []
  });

  assert.equal(sliceBetween(prompt, TRACEINK_SKILL_BEGIN_MARKER, TRACEINK_SKILL_END_MARKER), bundle.skillText);
  assert.equal(sliceBetween(prompt, TRACEINK_CONTRACT_BEGIN_MARKER, TRACEINK_CONTRACT_END_MARKER), bundle.editorialContractText);
});

test("canonical index run is Codex-only and never spends a hidden fallback call", async () => {
  const settings = createEmptyData().settings;
  settings.enabledSessionProviders = ["codex", "claude"];
  let calls = 0;
  let probes = 0;
  let providerArgs: string[] = [];

  await assert.rejects(
    compileTraceinkIndex(settings, "2026-08-15", [session()], {
      transcriptFreezer: passThroughFreezer,
      scope: reviewScope(),
      runner: async (request) => {
        if (request.args[0] === "features") {
          probes += 1;
          return featureResult();
        }
        calls += 1;
        providerArgs = request.args;
        throw new Error("capacity");
      }
    }),
    /capacity/
  );
  assert.equal(calls, 1);
  assert.equal(probes, 1);
  assert.equal(hasDisabledFeature(providerArgs, "view_image"), true);
  assert.equal(hasDisabledFeature(providerArgs, "skill_search"), true);
});

test("scope and factual discovery coverage are bound into provenance and the input hash", async () => {
  const settings = createEmptyData().settings;
  settings.enabledSessionProviders = ["codex"];
  const runner = async (request: CliRunRequest) => request.args[0] === "features"
    ? featureResult()
    : codexResult({ rawMarkdown: "## 工作线\n\n你想先展开哪一条？", transportComplete: true });
  const factualCoverage = [{
    sourceId: "scan:missing-copy",
    disposition: "failed" as const,
    detail: "发现候选，但扫描时已经不存在。"
  }];
  const common = {
    transcriptFreezer: passThroughFreezer,
    runner,
    now: () => new Date("2026-08-15T10:00:00.000Z"),
    coverage: factualCoverage
  };

  const shanghai = await compileTraceinkIndex(settings, "2026-08-15", [session()], {
    ...common,
    scope: reviewScope({ evidenceCutoff: "2026-08-15T09:59:00.000Z" })
  });
  const losAngeles = await compileTraceinkIndex(settings, "2026-08-15", [session()], {
    ...common,
    scope: {
      timeZone: "America/Los_Angeles",
      startInclusive: "2026-08-15T07:00:00.000Z",
      endExclusive: "2026-08-16T07:00:00.000Z",
      evidenceCutoff: "2026-08-15T09:59:00.000Z"
    }
  });
  const laterCutoff = await compileTraceinkIndex(settings, "2026-08-15", [session()], {
    ...common,
    scope: reviewScope()
  });
  const changedCoverage = await compileTraceinkIndex(settings, "2026-08-15", [session()], {
    ...common,
    scope: reviewScope({ evidenceCutoff: "2026-08-15T09:59:00.000Z" }),
    coverage: [{
      sourceId: "scan:missing-copy",
      disposition: "failed",
      detail: "同一来源出现了不同的事实扫描结果。"
    }]
  });
  const explicitlyEmptyCoverage = await compileTraceinkIndex(settings, "2026-08-15", [session()], {
    ...common,
    scope: reviewScope(),
    coverage: []
  });

  assert.deepEqual(shanghai.coverage, factualCoverage);
  assert.deepEqual(shanghai.warnings, []);
  assert.notEqual(shanghai.inputEvidenceHash, losAngeles.inputEvidenceHash);
  assert.notEqual(shanghai.inputEvidenceHash, laterCutoff.inputEvidenceHash);
  assert.notEqual(shanghai.inputEvidenceHash, changedCoverage.inputEvidenceHash);
  assert.notDeepEqual(shanghai.producer.scope, losAngeles.producer.scope);
  assert.equal(laterCutoff.producer.scope?.evidenceCutoff, "2026-08-15T10:00:00.000Z");
  assert.deepEqual(explicitlyEmptyCoverage.coverage, []);
  assert.deepEqual(explicitlyEmptyCoverage.warnings, []);
});

test("the runner safely rejects the Codex 0.144.6-era surface before any provider call", async () => {
  const settings = createEmptyData().settings;
  settings.enabledSessionProviders = ["codex"];
  let calls = 0;
  await assert.rejects(
    compileTraceinkIndex(settings, "2026-08-15", [session()], {
      transcriptFreezer: passThroughFreezer,
      scope: reviewScope(),
      runner: async (request) => {
        calls += 1;
        assert.equal(request.args[0], "features");
        return featureResult({ includeConditionalFeatures: false });
      }
    }),
    /缺少可关闭的本地读取安全开关；请更新 Codex CLI/
  );
  assert.equal(calls, 1);
});

function sliceBetween(value: string, begin: string, end: string): string {
  const beginIndex = value.indexOf(begin);
  const contentStart = beginIndex + begin.length + 1;
  const endIndex = value.indexOf(end, contentStart);
  assert.ok(beginIndex >= 0 && endIndex >= contentStart);
  return value.slice(contentStart, endIndex);
}

function codexResult(value: unknown): { stdout: string; stderr: string } {
  return {
    stdout: `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(value) } })}\n`,
    stderr: ""
  };
}

function featureResult(options: { includeConditionalFeatures?: boolean } = {}): { stdout: string; stderr: string } {
  const conditional = options.includeConditionalFeatures === false
    ? []
    : ["view_image stable true", "skill_search stable true", "code_mode_buffered_exec under-development false"];
  return {
    stdout: ["shell_tool stable true", "unified_exec stable true", ...conditional].join("\n") + "\n",
    stderr: ""
  };
}

function hasDisabledFeature(args: string[], feature: string): boolean {
  return args.some((value, index) => value === "--disable" && args[index + 1] === feature);
}

function configValues(args: string[]): string[] {
  return args.flatMap((value, index) => value === "-c" && args[index + 1] ? [args[index + 1]!] : []);
}

function session(overrides: Partial<AgentWorkSession> = {}): AgentWorkSession {
  return {
    id: "codex-one",
    platform: "codex",
    title: "弱元数据标题",
    summary: "",
    path: "/tmp/codex-one.jsonl",
    startedAt: "2026-08-15T01:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
    projectPath: "/tmp/project",
    artifacts: [],
    status: "completed",
    transcriptCapture: {
      canonicalPath: "/tmp/codex-one.jsonl",
      sha256: "a".repeat(64),
      byteLength: 123,
      coverage: { startByte: 0, endByte: 123 }
    },
    ...overrides
  };
}

function reviewScope(overrides: Partial<{
  timeZone: string;
  startInclusive: string;
  endExclusive: string;
  evidenceCutoff: string;
}> = {}) {
  return {
    timeZone: "Asia/Shanghai",
    startInclusive: "2026-08-14T16:00:00.000Z",
    endExclusive: "2026-08-15T16:00:00.000Z",
    evidenceCutoff: "2026-08-15T10:00:00.000Z",
    ...overrides
  };
}
