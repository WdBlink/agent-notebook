import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readStructuredTodaySpanTarget } from "../app/desktop/structured-today-span-access";
import { parseEvidenceJsonl, resolveEvidenceSpan } from "../src/structured-today-evidence-spans";
import { canonicalContentHash } from "../src/structured-today-contracts";
import { TodayWorklineIndexV2Schema } from "../src/structured-today-v2-contracts";

test("main-process span replay ignores live append and returns exact UTF-16 highlight coordinates", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "structured-span-access-"));
  try {
    const sourcePath = path.join(directory, "session.jsonl");
    const record = JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        id: "assistant-1",
        role: "assistant",
        content: [{ type: "output_text", text: "前缀😀精确证据后缀" }]
      }
    });
    const captured = Buffer.from(`${record}\n`, "utf8");
    await fs.writeFile(sourcePath, Buffer.concat([captured, Buffer.from("APPENDED_SECRET\n")]));
    const parsed = parseEvidenceJsonl({
      source: captured,
      provider: "codex",
      sessionId: "session-1",
      evidenceId: "evidence-1"
    });
    const message = parsed.messages[0]!;
    const resolved = resolveEvidenceSpan({
      messageKey: message.locator.messageKey,
      exactQuote: "😀精确证据"
    }, parsed.messages);
    assert.equal(resolved.status, "resolved");
    if (resolved.status !== "resolved") return;
    const owner = indexArtifact(sourcePath, message.locator, resolved.span);

    const target = await readStructuredTodaySpanTarget({
      owner,
      statementId: "statement-summary",
      spanId: resolved.span.spanId
    });
    assert.equal(target.content, "前缀😀精确证据后缀");
    assert.equal(target.content.slice(target.utf16Start, target.utf16End), "😀精确证据");
    assert.equal(target.sourcePath, sourcePath);
    assert.equal(target.messages.find((message) => message.messageKey === target.messageKey)?.content, target.content);
    assert.equal(target.omittedBefore, 0);
    assert.equal(target.omittedAfter, 0);

    await assert.rejects(readStructuredTodaySpanTarget({
      owner,
      statementId: "statement-summary",
      spanId: `span-v2-${"f".repeat(64)}`
    }), /不属于指定陈述/u);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

function indexArtifact(
  sourcePath: string,
  locator: ReturnType<typeof parseEvidenceJsonl>["messages"][number]["locator"],
  span: Extract<ReturnType<typeof resolveEvidenceSpan>, { status: "resolved" }>["span"]
) {
  const statement = (statementId: string, text: string, relation: "source-span" | "inference-basis" = "source-span") => ({
    statementId,
    text,
    relation,
    findingIds: ["finding-1"],
    spanIds: [span.spanId]
  });
  const withoutHash = {
    schema: "today-workline-index/v2" as const,
    artifactId: "structured-today-index-2026-08-30",
    revision: 1,
    logicalDate: "2026-08-30",
    workflowRunId: "span-access-run",
    evidenceManifestId: "span-access-manifest",
    sessions: [{
      sessionId: "session-1",
      provider: "codex" as const,
      sourcePath,
      title: "Span Session",
      startedAt: "2026-08-30T01:00:00.000Z",
      evidenceIds: ["evidence-1"]
    }],
    evidence: [{
      evidenceId: "evidence-1",
      sourceKind: "session" as const,
      provider: "codex" as const,
      sessionId: "session-1",
      sourcePath,
      range: `bytes 0-${locator.frozenSourcePrefix.byteLength}`,
      contentHash: locator.frozenSourcePrefix.contentHash
    }],
    messageLocators: [locator],
    spans: [span],
    findings: [{ findingId: "finding-1", text: "精确证据", claimKind: "fact" as const, relation: "source-span" as const, spanIds: [span.spanId] }],
    dispositions: [{ sessionId: "session-1", kind: "assigned" as const, worklineIds: ["workline-1"], nodeOutputId: "node-1" }],
    worklines: [{
      worklineId: "workline-1",
      title: "Span Workline",
      summary: statement("statement-summary", "精确证据"),
      startedAt: "2026-08-30T01:00:00.000Z",
      currentStop: statement("statement-stop", "精确证据"),
      possibleChange: statement("statement-change", "可能更精确", "inference-basis"),
      possibleChangeAdopted: false as const,
      participation: {
        account: { status: "described" as const, agent: "Agent 完成。" },
        statement: statement("statement-participation", "精确证据")
      },
      evidenceReadiness: "ready" as const,
      sessionIds: ["session-1"],
      evidenceIds: ["evidence-1"],
      extensions: []
    }],
    coverage: { admitted: 1, assigned: 1, excluded: 0, failed: 0, unresolved: 0, complete: true },
    provenance: {
      workflowVersion: "structured-today-workflow-v5-message-spans",
      editorialContract: { packageId: "traceink" as const, version: "v2", editorialContractHash: "a".repeat(64) },
      modelFunctionVersions: {},
      providerInvocations: []
    }
  };
  return TodayWorklineIndexV2Schema.parse({
    ...withoutHash,
    contentHash: canonicalContentHash(withoutHash)
  });
}
