import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DailyReviewPreparationState } from "../src/daily-review-schedule";
import type { TraceinkIndexArtifactV1 } from "../src/traceink-review-assets";
import type { TraceinkReviewProjection } from "../src/traceink-review-state";
import { TraceinkIndexView } from "../app/desktop/traceink-index-view";

const HASH = "a".repeat(64);

function artifact(rawMarkdown: string): TraceinkIndexArtifactV1 {
  return {
    schemaVersion: 1,
    id: "traceink-index-2026-08-14",
    logicalDate: "2026-08-14",
    stage: "index",
    revision: 2,
    producer: {
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningConfiguration: "ultra",
      startedAt: "2026-08-14T10:00:00.000Z",
      completedAt: "2026-08-14T10:06:00.000Z",
      skill: {
        packageId: "traceink",
        version: "traceink-skill-bundle-v1",
        skillHash: HASH,
        editorialContractHash: HASH
      },
      scope: {
        timeZone: "Asia/Shanghai",
        startInclusive: "2026-08-13T16:00:00.000Z",
        endExclusive: "2026-08-14T16:00:00.000Z",
        evidenceCutoff: "2026-08-14T10:00:00.000Z"
      }
    },
    inputEvidenceHash: HASH,
    rawMarkdown,
    outputHash: HASH,
    coverage: [],
    evidence: [{
      id: "session-1",
      kind: "session",
      provider: "codex",
      sessionId: "019-session",
      path: "/Users/wdblink/session.jsonl",
      locator: "bytes 0-240",
      contentHash: HASH
    }],
    navigation: [],
    warnings: ["Coverage sidecar is not available;正文仍为权威内容。"]
  };
}

function preparation(status: DailyReviewPreparationState["status"]): DailyReviewPreparationState {
  return {
    enabled: true,
    time: "18:30",
    logicalDate: "2026-08-14",
    status,
    ...(status === "preparing" ? { trigger: "manual" as const, startedAt: "2026-08-14T10:00:00.000Z" } : {}),
    ...(status === "failed" ? { message: "本地整理进程提前结束。" } : {})
  };
}

function render(projection: TraceinkReviewProjection, status: DailyReviewPreparationState["status"] = "ready", error?: string): string {
  return renderToStaticMarkup(createElement(TraceinkIndexView, {
    projection,
    preparation: preparation(status),
    error,
    onCompile() {},
    onRefresh() {}
  }));
}

function renderWithEvidenceHandler(projection: TraceinkReviewProjection): string {
  return renderToStaticMarkup(createElement(TraceinkIndexView, {
    projection,
    preparation: preparation("ready"),
    onCompile() {},
    onRefresh() {},
    onEvidence() {}
  }));
}

test("renders the canonical Markdown exactly once and makes every generated resource inert", () => {
  const rawMarkdown = [
    "# 唯一脉络标题",
    "",
    "这是只应出现一次的权威句子。",
    "",
    "[查看本地证据](file:///Users/wdblink/session.jsonl)",
    "",
    "![远程图像](https://example.com/private.png)",
    "",
    "<script>window.__shouldNeverRun = true</script>",
    "",
    "| 原判断 | 证据 |",
    "| --- | --- |",
    "| A | B |"
  ].join("\n");
  const projection: TraceinkReviewProjection = {
    mode: "compiled",
    activeIndex: artifact(rawMarkdown),
    uncompiledEvidence: []
  };

  const html = render(projection);

  assert.equal(html.split("这是只应出现一次的权威句子。").length - 1, 1);
  assert.match(html, /data-traceink-inert-link="true"/);
  assert.match(html, /file:\/\/\/Users\/wdblink\/session\.jsonl/);
  assert.match(html, /data-traceink-inert-media="true"/);
  assert.match(html, /https:\/\/example\.com\/private\.png/);
  assert.doesNotMatch(html, /<a\b/i);
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /<script\b/i);
  assert.doesNotMatch(html, /window\.__shouldNeverRun/);
  assert.doesNotMatch(html, /今日收口|开始思考|打开材料/);
  assert.match(html, /gpt-5\.6-sol/);
  assert.match(html, /1 条整理说明/);
});

test("only exact frozen Session evidence becomes interactive; mutable file paths remain visibly inert", () => {
  const index = artifact([
    "# 证据边界",
    "",
    "[冻结 Session](file:///Users/wdblink/session.jsonl)",
    "",
    "[当前文件](file:///Users/wdblink/current-report.md)"
  ].join("\n"));
  index.evidence.push({
    id: "document-1",
    kind: "document",
    path: "/Users/wdblink/current-report.md",
    locator: "bytes 0-120",
    contentHash: HASH
  });

  const html = renderWithEvidenceHandler({ mode: "compiled", activeIndex: index, uncompiledEvidence: [] });

  assert.equal(html.split("traceink-evidence-inline").length - 1, 1);
  assert.match(html, /data-traceink-inert-link="true"[^>]*>.*当前文件/s);
});

test("keeps the current document readable while marking later evidence stale", () => {
  const projection: TraceinkReviewProjection = {
    mode: "stale",
    activeIndex: artifact("# 当前版本\n\n当前版本不会在更新前消失。"),
    uncompiledEvidence: [
      { identity: "codex:session-2:/tmp/2.jsonl", revision: `sha256:${HASH}:120` },
      { identity: "claude:session-3:/tmp/3.jsonl", revision: `sha256:${HASH}:360` }
    ],
    diagnostic: "发现晚于当前版本的 Session 证据。"
  };

  const html = render(projection);

  assert.match(html, /当前版本不会在更新前消失。/);
  assert.match(html, /2 条证据尚未进入当前版本/);
  assert.match(html, /更新工作脉络/);
  assert.doesNotMatch(html, /今日收口|开始思考/);
});

test("offers one dossier entry per canonical workline without pre-writing human reflection", () => {
  const index = artifact("1. **第一条工作线**\n\n2. **第二条工作线**\n");
  const projection: TraceinkReviewProjection = {
    mode: "compiled",
    activeIndex: index,
    uncompiledEvidence: [],
    worklines: [1, 2].map((ordinal) => ({
      proposalItems: [],
      selection: {
        worklineId: `workline-${ordinal}`,
        ordinal,
        title: ordinal === 1 ? "第一条工作线" : "第二条工作线",
        sourceIndex: { artifactId: index.id, stage: "index", revision: index.revision, outputHash: index.outputHash }
      }
    }))
  };
  const html = render(projection);
  assert.equal(html.split("展开证据档案").length - 1, 2);
  assert.doesNotMatch(html, /保存我的回顾|AI.*替你写/);
});

test("provides matched loading, error, and no-evidence states", () => {
  const rawWithEvidence: TraceinkReviewProjection = {
    mode: "raw",
    uncompiledEvidence: [{ identity: "codex:session-1:/tmp/1.jsonl", revision: `sha256:${HASH}:80` }]
  };
  const loading = render(rawWithEvidence, "preparing");
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /正在整理工作脉络/);
  assert.match(loading, /traceink-index-skeleton/);

  const failed = render(rawWithEvidence, "failed", "整理器没有返回完整结果。");
  assert.match(failed, /role="alert"/);
  assert.match(failed, /整理器没有返回完整结果。/);
  assert.match(failed, /重新整理/);

  const empty = render({ mode: "raw", uncompiledEvidence: [] }, "off");
  assert.match(empty, /今天还没有可整理的 Session 证据/);
  assert.match(empty, /disabled=""/);
});
