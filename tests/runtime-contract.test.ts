import assert from "node:assert/strict";
import test from "node:test";
import {
  RuntimeGatewayError,
  parseHostMessage,
  parseResizeResult,
  validateTerminalGeometry,
  validateWriteData
} from "../src/runtime-contract";
import { createRuntimeEnvironment, resolveArgvCommand, resolveHostCommand } from "../src/runtime-gateway";
import { normalizeGlobalBoardDocument } from "../src/whiteboard-model";

test("terminal geometry accepts contract boundaries and rejects out-of-range values", () => {
  assert.deepEqual(validateTerminalGeometry(2, 1), { cols: 2, rows: 1 });
  assert.deepEqual(validateTerminalGeometry(500, 200), { cols: 500, rows: 200 });
  for (const [cols, rows] of [[1, 24], [501, 24], [80, 0], [80, 201], [80.5, 24]]) {
    assert.throws(() => validateTerminalGeometry(cols, rows), RuntimeGatewayError);
  }
});

test("terminal input has a one MiB UTF-8 contract limit", () => {
  assert.equal(validateWriteData("project α; $(touch nope)"), "project α; $(touch nope)");
  assert.throws(() => validateWriteData("x".repeat(1024 * 1024 + 1)), /1 MiB/);
  assert.throws(() => validateWriteData(42), /string/);
});

test("host protocol parser validates versions, structured errors, and resize acknowledgements", () => {
  assert.deepEqual(parseHostMessage({ protocolVersion: 1, type: "ready", pid: 123 }), {
    protocolVersion: 1,
    type: "ready",
    pid: 123
  });
  assert.deepEqual(parseResizeResult({ runtimeId: "runtime-a", cols: 100, rows: 30 }), {
    runtimeId: "runtime-a",
    cols: 100,
    rows: 30
  });
  const failure = parseHostMessage({
    protocolVersion: 1,
    type: "response",
    requestId: "request-a",
    ok: false,
    error: { code: "spawn_failed", message: "Executable could not be started." }
  });
  assert.equal(failure.type, "response");
  assert.throws(
    () => parseHostMessage({ protocolVersion: 2, type: "ready", pid: 123 }),
    (error: unknown) => error instanceof RuntimeGatewayError && error.code === "host_protocol_mismatch"
  );
  assert.throws(() => parseHostMessage({ protocolVersion: 1, type: "output", runtimeId: "x", ownerId: "y", sequence: 0, data: "x" }));
});

test("argv resolution preserves spaces, unicode, and metacharacters as data", () => {
  const executable = "/tmp/cockpit project α/codex;not-a-command";
  assert.deepEqual(resolveArgvCommand(executable), { command: executable, args: [] });
  assert.deepEqual(resolveArgvCommand("codex;echo injected"), {
    command: "/usr/bin/env",
    args: ["codex;echo injected"]
  });
  assert.deepEqual(resolveHostCommand("node", "/tmp/plugin path/runtime/pty-host.mjs"), {
    command: "/usr/bin/env",
    args: ["node", "/tmp/plugin path/runtime/pty-host.mjs"]
  });
});

test("runtime environment uses an explicit allowlist and extends PATH without forwarding unknown credentials", () => {
  const environment = createRuntimeEnvironment({
    HOME: "/Users/tester",
    PATH: "/custom/bin:/usr/bin",
    SAFE_VALUE: "drop",
    GITHUB_PAT: "drop",
    AWS_SHARED_CREDENTIALS_FILE: "/tmp/drop",
    SESSION_COOKIE: "drop",
    PRIVATE_KEY_FILE: "/tmp/drop",
    HTTPS_PROXY: "http://proxy.test",
    CODEX_TOKEN: "drop",
    CLIENT_SECRET: "drop",
    DB_PASSWORD: "drop",
    SERVICE_API_KEY: "drop",
    AUTH_HEADER: "drop"
  });
  assert.equal(environment.SAFE_VALUE, undefined);
  assert.equal(environment.GITHUB_PAT, undefined);
  assert.equal(environment.AWS_SHARED_CREDENTIALS_FILE, undefined);
  assert.equal(environment.SESSION_COOKIE, undefined);
  assert.equal(environment.PRIVATE_KEY_FILE, undefined);
  assert.equal(environment.HTTPS_PROXY, "http://proxy.test");
  assert.equal(environment.CODEX_TOKEN, undefined);
  assert.equal(environment.CLIENT_SECRET, undefined);
  assert.equal(environment.TERM, "xterm-256color");
  assert.equal(environment.COLORTERM, "truecolor");
  assert.ok(environment.PATH?.includes("/Users/tester/.local/bin"));
  assert.equal(environment.PATH?.split(":").filter((entry) => entry === "/usr/bin").length, 1);
});

test("schema-two normalization removes stale runtime truth and keeps no scrollback field", () => {
  const document = normalizeGlobalBoardDocument({
    schemaVersion: 2,
    viewport: { x: 0, y: 0, zoom: 1 },
    projects: [{ id: "project-a", name: "A", rootPath: "/tmp/a", position: { x: 0, y: 0 }, size: { width: 1320, height: 900 }, zIndex: 0 }],
    nodes: [
      { id: "agent-a", kind: "agent", projectId: "project-a", position: { x: 48, y: 104 }, size: { width: 520, height: 340 }, zIndex: 1, provider: "codex", workingDirectory: "/tmp/a", sessionId: null, sessionIdVerified: false, runtimeState: "running" },
      { id: "terminal-a", kind: "terminal", projectId: "project-a", position: { x: 600, y: 104 }, size: { width: 520, height: 320 }, zIndex: 2, workingDirectory: "/tmp/a", runtimeId: "stale-runtime" }
    ],
    edges: [],
    console: { provider: "codex" }
  });
  const agent = document.nodes.find((node) => node.id === "agent-a");
  const terminal = document.nodes.find((node) => node.id === "terminal-a");
  assert.equal(agent?.kind === "agent" ? agent.runtimeState : null, "exited");
  assert.equal(terminal?.kind === "terminal" ? terminal.runtimeId : "missing", null);
  assert.equal(JSON.stringify(document).includes("scrollback"), false);
});
