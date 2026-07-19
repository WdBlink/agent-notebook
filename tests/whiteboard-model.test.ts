import assert from "node:assert/strict";
import test from "node:test";
import {
  appendProjectFrame,
  containProjectFrame,
  createAgentPlaceholder,
  createEmptyGlobalBoardDocument,
  createNoteNode,
  createTerminalNode,
  deleteWhiteboardNode,
  moveProjectFrame,
  moveWhiteboardNode,
  normalizeGlobalBoardDocument,
  rebaseGlobalBoardDocument,
  reassignWhiteboardNode,
  removeProjectFrame,
  renameProjectFrame,
  resizeProjectFrame,
  WhiteboardMigrationError,
  WhiteboardRebaseError
} from "../src/whiteboard-model";

function schemaOneFixture(): unknown {
  return {
    projects: [
      { id: "project-alpha", name: "Alpha", rootPath: "/workspace/alpha", createdAt: "2026-07-15T00:00:00.000Z" },
      { id: "project-beta", name: "Beta", rootPath: "/workspace/beta", createdAt: "2026-07-15T00:00:00.000Z" }
    ],
    activeProjectId: "project-beta",
    boards: {
      "project-alpha": {
        schemaVersion: 1,
        projectId: "project-alpha",
        viewport: { x: 40, y: 20, zoom: 1.25 },
        nodes: [
          {
            id: "agent-alpha", kind: "agent", x: 100, y: 120, width: 520, height: 340, zIndex: 3,
            provider: "codex", workingDirectory: "/workspace/alpha", sessionId: undefined,
            sessionIdVerified: false, runtimeState: "running"
          },
          {
            id: "note-alpha", kind: "note", x: 680, y: 160, width: 320, height: 240, zIndex: 2,
            markdown: "# Alpha\n\n- keep bytes\n"
          },
          {
            id: "label-alpha", kind: "label", x: 80, y: 560, width: 560, height: 112, zIndex: 1,
            text: "Alpha lane", color: "#B13A32", fontSize: 56
          }
        ],
        edges: [{ id: "edge-alpha", source: "agent-alpha", target: "note-alpha" }]
      },
      "project-beta": {
        schemaVersion: 1,
        projectId: "project-beta",
        viewport: { x: -300, y: 90, zoom: 0.6 },
        nodes: [
          {
            id: "terminal-beta", kind: "terminal", x: -40, y: 60, width: 520, height: 320, zIndex: 1,
            workingDirectory: "/workspace/beta"
          },
          {
            id: "agent-beta", kind: "agent", x: 560, y: 80, width: 520, height: 340, zIndex: 2,
            provider: "claude-code", workingDirectory: "/workspace/beta", sessionId: "session-beta",
            sessionIdVerified: true, runtimeState: "waiting"
          },
          {
            id: "note-beta", kind: "note", x: 560, y: 500, width: 320, height: 240, zIndex: 3,
            markdown: "# Beta\n\n```ts\nconst n = 2;\n```\n"
          }
        ],
        edges: [{ id: "edge-beta", source: "agent-beta", target: "note-beta" }]
      }
    }
  };
}

test("schema one migrates deterministically into non-overlapping schema-two frames", () => {
  const migrated = normalizeGlobalBoardDocument(schemaOneFixture());

  assert.deepEqual(migrated, {
    schemaVersion: 2,
    viewport: { x: 80, y: 72, zoom: 1 },
    projects: [
      {
        id: "project-alpha", name: "Alpha", rootPath: "/workspace/alpha",
        position: { x: 120, y: 120 }, size: { width: 1320, height: 900 }, zIndex: 0
      },
      {
        id: "project-beta", name: "Beta", rootPath: "/workspace/beta",
        position: { x: 1600, y: 120 }, size: { width: 1320, height: 900 }, zIndex: 1
      }
    ],
    nodes: [
      {
        id: "agent-alpha", kind: "agent", projectId: "project-alpha",
        position: { x: 268, y: 344 }, size: { width: 520, height: 340 }, zIndex: 3,
        provider: "codex", workingDirectory: "/workspace/alpha", sessionId: null,
        sessionIdVerified: false, runtimeState: "exited"
      },
      {
        id: "note-alpha", kind: "note", projectId: "project-alpha",
        position: { x: 848, y: 384 }, size: { width: 320, height: 240 }, zIndex: 2,
        markdown: "# Alpha\n\n- keep bytes\n"
      },
      {
        id: "label-alpha", kind: "label", projectId: "project-alpha",
        position: { x: 248, y: 784 }, size: { width: 560, height: 112 }, zIndex: 1,
        text: "Alpha lane", color: "#B13A32", fontSize: 56
      },
      {
        id: "terminal-beta", kind: "terminal", projectId: "project-beta",
        position: { x: 1648, y: 284 }, size: { width: 520, height: 320 }, zIndex: 1,
        workingDirectory: "/workspace/beta", runtimeId: null
      },
      {
        id: "agent-beta", kind: "agent", projectId: "project-beta",
        position: { x: 2248, y: 304 }, size: { width: 520, height: 340 }, zIndex: 2,
        provider: "claude-code", workingDirectory: "/workspace/beta", sessionId: "session-beta",
        sessionIdVerified: true, runtimeState: "exited"
      },
      {
        id: "note-beta", kind: "note", projectId: "project-beta",
        position: { x: 2248, y: 724 }, size: { width: 320, height: 240 }, zIndex: 3,
        markdown: "# Beta\n\n```ts\nconst n = 2;\n```\n"
      }
    ],
    edges: [
      { id: "edge-alpha", sourceNodeId: "agent-alpha", targetNodeId: "note-alpha" },
      { id: "edge-beta", sourceNodeId: "agent-beta", targetNodeId: "note-beta" }
    ],
    console: { provider: "codex" }
  });
  assert.equal(JSON.stringify(normalizeGlobalBoardDocument(migrated)), JSON.stringify(migrated));
});

test("migration preserves ownership and provider while clearing stale runtime truth", () => {
  const migrated = normalizeGlobalBoardDocument(schemaOneFixture());
  const alphaAgent = migrated.nodes.find((node) => node.id === "agent-alpha");
  const betaAgent = migrated.nodes.find((node) => node.id === "agent-beta");
  const label = migrated.nodes.find((node) => node.id === "label-alpha");
  const terminal = migrated.nodes.find((node) => node.id === "terminal-beta");

  assert.equal(alphaAgent?.projectId, "project-alpha");
  assert.equal(alphaAgent?.kind === "agent" ? alphaAgent.sessionId : "bad", null);
  assert.equal(betaAgent?.kind === "agent" ? betaAgent.provider : "", "claude-code");
  assert.equal(betaAgent?.kind === "agent" ? betaAgent.runtimeState : "", "exited");
  assert.equal(label?.projectId, "project-alpha");
  assert.equal(label?.kind === "label" ? label.text : "", "Alpha lane");
  assert.equal(label?.kind === "label" ? label.color : "", "#B13A32");
  assert.equal(terminal?.kind === "terminal" ? terminal.runtimeId : "bad", null);
});

test("migration rejects duplicate identities, missing boards, invalid directories, and orphan edges", () => {
  const cases = [
    (fixture: any) => fixture.projects.push({ ...fixture.projects[0] }),
    (fixture: any) => fixture.boards["project-beta"].nodes[0].id = "agent-alpha",
    (fixture: any) => fixture.boards["project-beta"].edges[0].id = "edge-alpha",
    (fixture: any) => delete fixture.boards["project-beta"],
    (fixture: any) => fixture.boards["project-alpha"].nodes[0].workingDirectory = "/workspace/wrong",
    (fixture: any) => fixture.boards["project-alpha"].edges[0].target = "missing"
  ];

  for (const mutate of cases) {
    const fixture = schemaOneFixture();
    mutate(fixture);
    assert.throws(
      () => normalizeGlobalBoardDocument(fixture),
      (error: unknown) => error instanceof WhiteboardMigrationError && error.code === "WHITEBOARD_MIGRATION_FAILED"
    );
  }
});

test("schema-two validation is byte-idempotent for a complete valid document", () => {
  const document = normalizeGlobalBoardDocument({
    schemaVersion: 2,
    viewport: { x: 1, y: 2, zoom: 0.5 },
    projects: [{
      id: "project-a", name: "A", rootPath: "/workspace/a",
      position: { x: 120, y: 120 }, size: { width: 1320, height: 900 }, zIndex: 0
    }],
    nodes: [{
      id: "note-a", kind: "note", projectId: "project-a",
      position: { x: 160, y: 224 }, size: { width: 240, height: 160 }, zIndex: 1, markdown: " bytes \n"
    }],
    edges: [{ id: "loop", sourceNodeId: "note-a", targetNodeId: "note-a" }],
    console: { provider: "claude-code" }
  });

  assert.equal(document.nodes[0]?.kind === "note" ? document.nodes[0].markdown : "", " bytes \n");
  assert.equal(JSON.stringify(normalizeGlobalBoardDocument(document)), JSON.stringify(document));
});

test("present malformed schema-one and schema-two records fail closed", () => {
  const validTwo = normalizeGlobalBoardDocument(schemaOneFixture());
  const cases: unknown[] = [
    null,
    { ...validTwo, viewport: { ...validTwo.viewport, x: Number.NaN } },
    { ...validTwo, viewport: { ...validTwo.viewport, zoom: 9 } },
    { ...validTwo, projects: [...validTwo.projects, { ...validTwo.projects[0] }] },
    { ...validTwo, projects: [{ ...validTwo.projects[0], size: { width: 1, height: 1 } }, validTwo.projects[1]] },
    { ...validTwo, nodes: [...validTwo.nodes, { ...validTwo.nodes[0] }] },
    { ...validTwo, nodes: validTwo.nodes.map((node) => node.id === "note-alpha" ? { ...node, projectId: "missing" } : node) },
    { ...validTwo, nodes: validTwo.nodes.map((node) => node.id === "agent-alpha" ? { ...node, provider: "other" } : node) },
    { ...validTwo, edges: [...validTwo.edges, { id: "orphan", sourceNodeId: "missing", targetNodeId: "note-alpha" }] },
    { ...validTwo, console: { provider: "other" } }
  ];
  const schemaOneCases = [
    (fixture: any) => { fixture.boards["project-alpha"].nodes[0].x = Number.POSITIVE_INFINITY; },
    (fixture: any) => { fixture.boards["project-alpha"].nodes[1].width = 1; },
    (fixture: any) => { fixture.boards["project-alpha"].projectId = "project-beta"; },
    (fixture: any) => { fixture.boards.extra = fixture.boards["project-alpha"]; },
    (fixture: any) => { fixture.activeProjectId = "missing"; },
    (fixture: any) => { fixture.projects[1].rootPath = fixture.projects[0].rootPath; }
  ];
  for (const mutate of schemaOneCases) {
    const fixture = schemaOneFixture();
    mutate(fixture);
    cases.push(fixture);
  }
  for (const value of cases) {
    assert.throws(
      () => normalizeGlobalBoardDocument(value),
      (error: unknown) => error instanceof WhiteboardMigrationError && error.code === "WHITEBOARD_MIGRATION_FAILED"
    );
  }
});

test("frame movement applies one exact delta to every owned node without geometric reassignment", () => {
  const document = normalizeGlobalBoardDocument(schemaOneFixture());
  const before = document.nodes.filter((node) => node.projectId === "project-alpha");
  const moved = moveProjectFrame(document, "project-alpha", { x: 300, y: 240 });
  const after = moved.nodes.filter((node) => node.projectId === "project-alpha");

  assert.deepEqual(moved.projects[0]?.position, { x: 300, y: 240 });
  after.forEach((node, index) => {
    assert.equal(node.position.x - before[index]!.position.x, 180);
    assert.equal(node.position.y - before[index]!.position.y, 120);
  });

  const beta = moved.projects.find((frame) => frame.id === "project-beta")!;
  const overlapped = moveWhiteboardNode(moved, "agent-alpha", { x: beta.position.x + 100, y: beta.position.y + 150 });
  const agent = overlapped.nodes.find((node) => node.id === "agent-alpha");
  assert.equal(agent?.projectId, "project-alpha");
  assert.equal(agent?.kind === "agent" ? agent.workingDirectory : "", "/workspace/alpha");
});

test("containment expands frames and rejected resize returns the prior frame unchanged", () => {
  const document = normalizeGlobalBoardDocument(schemaOneFixture());
  const frame = document.projects[0]!;
  const escaped = moveWhiteboardNode(document, "note-alpha", {
    x: frame.position.x + frame.size.width + 100,
    y: frame.position.y + frame.size.height + 100
  });
  const expanded = containProjectFrame(frame, escaped.nodes);
  const note = escaped.nodes.find((node) => node.id === "note-alpha")!;
  assert.ok(expanded.position.x + expanded.size.width >= note.position.x + note.size.width + 48);
  assert.ok(expanded.position.y + expanded.size.height >= note.position.y + note.size.height + 48);

  const rejected = resizeProjectFrame(frame, {
    position: { x: frame.position.x + 200, y: frame.position.y },
    size: { width: frame.size.width, height: frame.size.height }
  }, document.nodes);
  assert.strictEqual(rejected, frame);
});

test("explicit reassignment updates ownership, root, deterministic position, and target containment", () => {
  const document = normalizeGlobalBoardDocument(schemaOneFixture());
  const target = document.projects.find((frame) => frame.id === "project-beta")!;
  const ownedCount = document.nodes.filter((node) => node.projectId === target.id).length;
  const reassigned = reassignWhiteboardNode(document, "agent-alpha", target.id);
  const node = reassigned.nodes.find((candidate) => candidate.id === "agent-alpha");

  assert.equal(node?.projectId, "project-beta");
  assert.equal(node?.kind === "agent" ? node.workingDirectory : "", "/workspace/beta");
  assert.deepEqual(node?.position, {
    x: target.position.x + 48 + (ownedCount % 2) * 560,
    y: target.position.y + 104 + Math.floor(ownedCount / 2) * 380
  });
  const nextTarget = reassigned.projects.find((frame) => frame.id === target.id)!;
  assert.ok(nextTarget.position.x + nextTarget.size.width >= node!.position.x + node!.size.width + 48);
});

test("placeholder creation is provider-free data with explicit project ownership", () => {
  let document = appendProjectFrame(createEmptyGlobalBoardDocument(), "/workspace/a", "A", "project-a");
  document = createAgentPlaceholder(document, "project-a", "codex", { x: -999, y: -999 }, "agent-codex");
  document = createAgentPlaceholder(document, "project-a", "claude-code", undefined, "agent-claude");

  assert.equal(document.nodes.length, 2);
  for (const node of document.nodes) {
    assert.equal(node.kind, "agent");
    assert.equal(node.projectId, "project-a");
    assert.equal(node.kind === "agent" ? node.workingDirectory : "", "/workspace/a");
    assert.equal(node.kind === "agent" ? node.sessionId : "bad", null);
    assert.equal(node.kind === "agent" ? node.runtimeState : "", "exited");
  }
  assert.deepEqual(document.nodes[0]?.position, { x: 168, y: 224 });
});

test("terminal creation uses the exact project root and persists no runtime identity", () => {
  let document = appendProjectFrame(createEmptyGlobalBoardDocument(), "/workspace/project α", "A", "project-a");
  document = createTerminalNode(document, "project-a", { x: -999, y: -999 }, "terminal-a");
  const terminal = document.nodes[0];
  assert.equal(terminal?.kind, "terminal");
  assert.equal(terminal?.projectId, "project-a");
  assert.equal(terminal?.kind === "terminal" ? terminal.workingDirectory : "", "/workspace/project α");
  assert.equal(terminal?.kind === "terminal" ? terminal.runtimeId : "missing", null);
  assert.deepEqual(terminal?.position, { x: 168, y: 224 });
});

test("rename, node deletion, and project removal keep incident edges consistent", () => {
  const document = normalizeGlobalBoardDocument(schemaOneFixture());
  const blankRename = renameProjectFrame(document, "project-alpha", "  ");
  assert.strictEqual(blankRename, document);
  const renamed = renameProjectFrame(document, "project-alpha", "Research");
  assert.equal(renamed.projects[0]?.name, "Research");

  const withoutNode = deleteWhiteboardNode(renamed, "note-alpha");
  assert.equal(withoutNode.nodes.some((node) => node.id === "note-alpha"), false);
  assert.equal(withoutNode.edges.some((edge) => edge.id === "edge-alpha"), false);

  const withoutProject = removeProjectFrame(document, "project-beta");
  assert.deepEqual(withoutProject.projects.map((frame) => frame.id), ["project-alpha"]);
  assert.equal(withoutProject.nodes.some((node) => node.projectId === "project-beta"), false);
  assert.equal(withoutProject.edges.some((edge) => edge.id === "edge-beta"), false);

  const local = createNoteNode(document, "project-alpha", undefined, "note-local");
  const remote = appendProjectFrame(document, "/workspace/gamma", "Gamma", "project-gamma");
  const merged = rebaseGlobalBoardDocument(document, local, remote);
  assert.deepEqual(merged.projects.map((project) => project.id), ["project-alpha", "project-beta", "project-gamma"]);
  assert.equal(merged.nodes.some((node) => node.id === "note-local" && node.projectId === "project-alpha"), true);

  const edit = (markdown: string) => ({
    ...document,
    nodes: document.nodes.map((node) => node.id === "note-alpha" && node.kind === "note" ? { ...node, markdown } : node)
  });
  assert.throws(
    () => rebaseGlobalBoardDocument(document, edit("local"), edit("remote")),
    (error: unknown) => error instanceof WhiteboardRebaseError && error.code === "WHITEBOARD_REBASE_CONFLICT"
  );
});

test("only an absent whiteboard produces the exact empty schema-two document", () => {
  const empty = normalizeGlobalBoardDocument(undefined);
  assert.deepEqual(empty, createEmptyGlobalBoardDocument());
  assert.deepEqual(Object.keys(empty), ["schemaVersion", "viewport", "projects", "nodes", "edges", "console"]);
  assert.equal("boards" in empty, false);
  assert.equal("activeProjectId" in empty, false);
});
