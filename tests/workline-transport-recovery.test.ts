import assert from "node:assert/strict";
import test from "node:test";
import { recoverWorklineTransport } from "../src/workline-transport-recovery";
import { WORKLINE_REVIEW_TRANSPORT_SCHEMA } from "../src/workline-review";

test("exact and fenced JSON stay authoritative and are not marked as recovered", () => {
  const value = validTransport();

  const exact = recoverWorklineTransport(JSON.stringify(value), WORKLINE_REVIEW_TRANSPORT_SCHEMA);
  const fenced = recoverWorklineTransport(`\`\`\`json\n${JSON.stringify(value)}\n\`\`\``, WORKLINE_REVIEW_TRANSPORT_SCHEMA);

  assert.deepEqual(exact, { value, recovered: false, format: "json" });
  assert.deepEqual(fenced, { value, recovered: false, format: "json" });
});

test("recovers a brace-free YAML mapping without changing scalar values", () => {
  const result = recoverWorklineTransport(BRACE_FREE_YAML, WORKLINE_REVIEW_TRANSPORT_SCHEMA);

  assert.equal(result.recovered, true);
  assert.equal(result.format, "yaml");
  assert.deepEqual(result.value, validTransport());
});

test("rejects malformed braced JSON instead of applying broad repair", () => {
  const unquotedKeys = JSON.stringify(validTransport()).replace(/"([A-Za-z][A-Za-z0-9]*)":/g, "$1:");

  assert.throws(
    () => recoverWorklineTransport(unquotedKeys, WORKLINE_REVIEW_TRANSPORT_SCHEMA),
    /无法安全恢复/
  );
});

test("requires an explicit final completion sentinel before accepting recovery", () => {
  const incomplete = BRACE_FREE_YAML.replace(/\ntransportComplete: true$/, "");

  assert.throws(
    () => recoverWorklineTransport(incomplete, WORKLINE_REVIEW_TRANSPORT_SCHEMA),
    /transportComplete|无法安全恢复/
  );
});

test("rejects ambiguous, multi-document, duplicate, truncated, and YAML-specific recovery input", () => {
  const cases = [
    "Here is the requested workline summary.",
    `notes: not the transport root\n${BRACE_FREE_YAML}`,
    `${BRACE_FREE_YAML}\nwarnings: []`,
    BRACE_FREE_YAML.replace("title: Research IR", 'title: "Research IR'),
    BRACE_FREE_YAML.replace("warnings: []", "warnings: ..."),
    `${BRACE_FREE_YAML}\n---\nworklines: []`,
    BRACE_FREE_YAML.replace("startedAt: null", "startedAt: .inf"),
    BRACE_FREE_YAML.replace("body: Three experiments failed.", "body: |\n            Three experiments failed."),
    BRACE_FREE_YAML.replace("title: Research IR", "title: &shared Research IR"),
    BRACE_FREE_YAML.replace("title: Research IR", "title: Research IR # comment"),
    BRACE_FREE_YAML.replace("title: Research IR", "title:\tResearch IR")
  ];

  for (const input of cases) {
    assert.throws(
      () => recoverWorklineTransport(input, WORKLINE_REVIEW_TRANSPORT_SCHEMA),
      /无法安全恢复|duplicated mapping key|unexpected end|schema|合同|类型|transportComplete/
    );
  }
});

const BRACE_FREE_YAML = `worklines:
  - id: workline-1
    title: Research IR
    summary: Evidence changed the likely direction.
    status: needs-judgment
    sourceSessionIds:
      - codex:session-1
    startedAt: null
    endedAt: null
    participation:
      - id: span-1
        kind: agent
        startAt: null
        endAt: null
        label: Agent independent
    dossier:
      title: Research IR review
      dek: A compact evidence dossier.
      blocks:
        - id: block-1
          kind: possible-change
          label: null
          title: Direction may need to change
          body: Three experiments failed.
          evidenceIds:
            - session:codex:session-1
          extensions: []
      question:
        prompt: Should this direction change?
        context: null
    extensions: []
warnings: []
transportComplete: true`;

function validTransport(): Record<string, unknown> {
  return {
    worklines: [{
      id: "workline-1",
      title: "Research IR",
      summary: "Evidence changed the likely direction.",
      status: "needs-judgment",
      sourceSessionIds: ["codex:session-1"],
      startedAt: null,
      endedAt: null,
      participation: [{ id: "span-1", kind: "agent", startAt: null, endAt: null, label: "Agent independent" }],
      dossier: {
        title: "Research IR review",
        dek: "A compact evidence dossier.",
        blocks: [{
          id: "block-1",
          kind: "possible-change",
          label: null,
          title: "Direction may need to change",
          body: "Three experiments failed.",
          evidenceIds: ["session:codex:session-1"],
          extensions: []
        }],
        question: { prompt: "Should this direction change?", context: null }
      },
      extensions: []
    }],
    warnings: [],
    transportComplete: true
  };
}
