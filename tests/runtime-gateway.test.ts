import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { AgentRuntimeGateway, type CompanionProcess, type ProcessAdapter } from "../src/runtime-gateway";
import { RuntimeGatewayError, type HostRequest, type RuntimeEvent } from "../src/runtime-contract";

class FakeCompanion extends EventEmitter implements CompanionProcess {
  readonly pid = 4321;
  connected = true;
  present = true;
  readonly requests: HostRequest[] = [];
  readonly signals: Array<NodeJS.Signals | undefined> = [];
  private runtimeSequence = 0;
  private readonly owners = new Map<string, string>();
  private readonly deferredSpawnResponses: Array<() => void> = [];

  constructor(private readonly options: {
    respondToShutdown?: boolean;
    emitExitOnKill?: boolean;
    sendAccepted?: boolean;
    respondToSpawn?: boolean;
    emitTerminateExit?: boolean;
    becomeAbsentOnKill?: boolean;
    deferSpawnResponse?: boolean;
  } = {}) {
    super();
    queueMicrotask(() => this.emit("message", { protocolVersion: 1, type: "ready", pid: this.pid }));
  }

  send(value: unknown, callback?: (error: Error | null) => void): boolean {
    const request = value as HostRequest;
    this.requests.push(request);
    callback?.(null);
    queueMicrotask(() => this.respond(request));
    return this.options.sendAccepted !== false;
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal);
    if (this.options.becomeAbsentOnKill) this.present = false;
    if (this.options.emitExitOnKill !== false) {
      this.connected = false;
      this.present = false;
      queueMicrotask(() => this.emit("exit", null, signal ?? "SIGTERM"));
    }
    return true;
  }

  disconnect(): void {
    this.connected = false;
  }

  hostMessage(value: unknown): void {
    this.emit("message", value);
  }

  releaseSpawnResponses(): void {
    for (const respond of this.deferredSpawnResponses.splice(0)) respond();
  }

  private respond(request: HostRequest): void {
    if (request.type === "spawn") {
      const runtimeId = `runtime-${++this.runtimeSequence}`;
      this.owners.set(runtimeId, request.ownerId);
      this.emit("message", { protocolVersion: 1, type: "state", runtimeId, ownerId: request.ownerId, state: "starting" });
      this.emit("message", { protocolVersion: 1, type: "state", runtimeId, ownerId: request.ownerId, state: "running" });
      if (this.options.respondToSpawn === false) return;
      const respond = () => this.emit("message", { protocolVersion: 1, type: "response", requestId: request.requestId, ok: true, result: { runtimeId, ownerId: request.ownerId, pid: 5000 + this.runtimeSequence } });
      if (this.options.deferSpawnResponse) this.deferredSpawnResponses.push(respond);
      else respond();
      return;
    }
    if (request.type === "resize") {
      this.emit("message", { protocolVersion: 1, type: "response", requestId: request.requestId, ok: true, result: { runtimeId: request.runtimeId, cols: request.cols, rows: request.rows } });
      return;
    }
    if (request.type === "shutdown" && this.options.respondToShutdown === false) return;
    if (request.type === "terminate" && this.options.emitTerminateExit !== false) {
      const ownerId = this.owners.get(request.runtimeId) ?? "unknown";
      this.emit("message", { protocolVersion: 1, type: "state", runtimeId: request.runtimeId, ownerId, state: "exited" });
      this.emit("message", { protocolVersion: 1, type: "exit", runtimeId: request.runtimeId, ownerId, exitCode: 0, signal: null });
      this.owners.delete(request.runtimeId);
    }
    this.emit("message", { protocolVersion: 1, type: "response", requestId: request.requestId, ok: true, result: {} });
    if (request.type === "shutdown") {
      this.connected = false;
      this.present = false;
      queueMicrotask(() => this.emit("exit", 0, null));
    }
  }
}

function createGateway(child: FakeCompanion, overrides = {}) {
  const launches: Array<{ command: string; args: readonly string[] }> = [];
  const adapter: ProcessAdapter = {
    spawn(command, args) {
      launches.push({ command, args });
      return child;
    },
    membershipPids: async () => child.present ? [child.pid] : [],
    signalPid: () => undefined
  };
  return {
    launches,
    gateway: new AgentRuntimeGateway({
      runtimeNodePath: "node",
      hostPath: "/tmp/plugin path/runtime/pty-host.mjs",
      codexCliPath: "/Users/test/.local/bin/codex",
      processAdapter: adapter,
      environment: { HOME: "/Users/test", PATH: "/usr/bin", SHELL: "/bin/zsh" },
      readyTimeoutMs: 50,
      requestTimeoutMs: 20,
      gracefulTerminationMs: 20,
      hostTerminateMs: 10,
      hostKillMs: 30,
      hostJoinMs: 5,
      ...overrides
    })
  };
}

test("gateway launches argv-only commands at exact cwd and keeps two runtimes isolated", async () => {
  const child = new FakeCompanion();
  const { gateway, launches } = createGateway(child);
  const events: RuntimeEvent[] = [];
  gateway.subscribe((event) => events.push(event));
  const [agent, terminal] = await Promise.all([
    gateway.launch({ ownerId: "agent-a", kind: "agent", provider: "codex", workingDirectory: "/tmp/cockpit project α", cols: 80, rows: 24 }),
    gateway.launch({ ownerId: "terminal-b", kind: "terminal", workingDirectory: "/tmp/cockpit project β", cols: 100, rows: 30 })
  ]);
  assert.notEqual(agent.runtimeId, terminal.runtimeId);
  assert.deepEqual(launches, [{ command: "/usr/bin/env", args: ["node", "/tmp/plugin path/runtime/pty-host.mjs"] }]);
  const spawns = child.requests.filter((request) => request.type === "spawn");
  assert.equal(spawns[0]?.type === "spawn" ? spawns[0].cwd : "", "/tmp/cockpit project α");
  assert.deepEqual(spawns[0]?.type === "spawn" ? [spawns[0].command, spawns[0].args] : [], ["/Users/test/.local/bin/codex", []]);
  assert.equal(spawns[1]?.type === "spawn" ? spawns[1].cwd : "", "/tmp/cockpit project β");

  child.hostMessage({ protocolVersion: 1, type: "output", runtimeId: agent.runtimeId, ownerId: "agent-a", sequence: 1, data: "agent-only" });
  child.hostMessage({ protocolVersion: 1, type: "output", runtimeId: terminal.runtimeId, ownerId: "terminal-b", sequence: 1, data: "terminal-only" });
  assert.deepEqual(events.filter((event) => event.type === "output").map((event) => event.type === "output" ? `${event.ownerId}:${event.data}` : ""), ["agent-a:agent-only", "terminal-b:terminal-only"]);
  await gateway.dispose();
});

test("resize resolves only after the host acknowledgement and input routes by runtime ID", async () => {
  const child = new FakeCompanion();
  const { gateway } = createGateway(child);
  const runtime = await gateway.launch({ ownerId: "terminal-a", kind: "terminal", workingDirectory: "/tmp/a", cols: 80, rows: 24 });
  assert.deepEqual(await gateway.resize(runtime.runtimeId, 120, 40), { runtimeId: runtime.runtimeId, cols: 120, rows: 40 });
  await gateway.write(runtime.runtimeId, "printf marker\r");
  const routed = child.requests.slice(-2);
  assert.equal(routed[0]?.type, "resize");
  assert.equal(routed[1]?.type === "write" ? routed[1].runtimeId : "", runtime.runtimeId);
  await gateway.dispose();
});

test("owner mismatch fails closed and protocol abort is bounded when child never exits", async () => {
  const child = new FakeCompanion({ emitExitOnKill: false });
  const { gateway } = createGateway(child);
  const runtime = await gateway.launch({ ownerId: "agent-a", kind: "agent", provider: "codex", workingDirectory: "/tmp/a", cols: 80, rows: 24 });
  child.hostMessage({ protocolVersion: 1, type: "output", runtimeId: runtime.runtimeId, ownerId: "wrong-owner", sequence: 1, data: "bad" });
  await new Promise((resolve) => setTimeout(resolve, 45));
  await assert.rejects(() => gateway.write(runtime.runtimeId, "x"), (error: unknown) => error instanceof RuntimeGatewayError);
  assert.ok(child.signals.includes("SIGKILL"));
  await assert.rejects(
    gateway.launch({ ownerId: "terminal-b", kind: "terminal", workingDirectory: "/tmp/b", cols: 80, rows: 24 }),
    (error: unknown) => error instanceof RuntimeGatewayError && error.code === "host_exited"
  );
});

test("dispose rejects and quarantines a companion that remains present after SIGKILL", async () => {
  const child = new FakeCompanion({ respondToShutdown: false, emitExitOnKill: false });
  const { gateway } = createGateway(child);
  await gateway.launch({ ownerId: "terminal-a", kind: "terminal", workingDirectory: "/tmp/a", cols: 80, rows: 24 });
  await assert.rejects(gateway.dispose(), (error: unknown) => error instanceof RuntimeGatewayError && error.code === "host_timeout");
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  await assert.rejects(gateway.dispose(), (error: unknown) => error instanceof RuntimeGatewayError && error.code === "host_timeout");
});

test("positive OS absence completes cleanup without a child exit event", async () => {
  const child = new FakeCompanion({ respondToShutdown: false, emitExitOnKill: false, becomeAbsentOnKill: true });
  let audits = 0;
  const launches: Array<{ command: string; args: readonly string[] }> = [];
  const adapter: ProcessAdapter = {
    spawn(command, args) {
      launches.push({ command, args });
      return child;
    },
    membershipPids: async () => {
      audits += 1;
      return child.present ? [child.pid] : [];
    },
    signalPid: () => undefined
  };
  const gateway = new AgentRuntimeGateway({
    runtimeNodePath: "node",
    hostPath: "/tmp/plugin/runtime/pty-host.mjs",
    codexCliPath: "codex",
    processAdapter: adapter,
    environment: { HOME: "/Users/test", PATH: "/usr/bin", SHELL: "/bin/zsh" },
    hostTerminateMs: 10,
    hostKillMs: 30,
    hostJoinMs: 5
  });
  await gateway.launch({ ownerId: "terminal-a", kind: "terminal", workingDirectory: "/tmp/a", cols: 80, rows: 24 });
  await gateway.dispose();
  assert.deepEqual(child.signals, ["SIGTERM"]);
  assert.ok(audits >= 2);
  assert.equal(launches.length, 1);
});

test("one absolute cleanup deadline bounds signal escalation", async () => {
  const child = new FakeCompanion({ respondToShutdown: false, emitExitOnKill: false });
  const signalTimes: Array<{ signal: NodeJS.Signals | undefined; at: number }> = [];
  const originalKill = child.kill.bind(child);
  child.kill = (signal?: NodeJS.Signals) => {
    signalTimes.push({ signal, at: Date.now() });
    return originalKill(signal);
  };
  const { gateway } = createGateway(child, { hostTerminateMs: 20, hostKillMs: 60, hostJoinMs: 10 });
  await gateway.launch({ ownerId: "terminal-a", kind: "terminal", workingDirectory: "/tmp/a", cols: 80, rows: 24 });
  const startedAt = Date.now();
  await assert.rejects(gateway.dispose(), /cleanup could not be confirmed/i);
  const elapsed = Date.now() - startedAt;
  assert.ok((signalTimes.find((entry) => entry.signal === "SIGTERM")?.at ?? Infinity) - startedAt <= 35);
  assert.ok((signalTimes.find((entry) => entry.signal === "SIGKILL")?.at ?? Infinity) - startedAt <= 60);
  assert.ok(elapsed <= 85);
});

test("spontaneous companion exit marks every active runtime with host_exited", async () => {
  const child = new FakeCompanion();
  const { gateway } = createGateway(child);
  const events: RuntimeEvent[] = [];
  gateway.subscribe((event) => events.push(event));
  await gateway.launch({ ownerId: "agent-a", kind: "agent", provider: "codex", workingDirectory: "/tmp/a", cols: 80, rows: 24 });
  child.connected = false;
  child.present = false;
  child.emit("exit", 1, null);
  assert.equal(events.some((event) => event.type === "error" && event.ownerId === "agent-a" && event.error.code === "host_exited"), true);
});

test("queued IPC send false remains pending and resolves through its callback response", async () => {
  const child = new FakeCompanion({ sendAccepted: false });
  const { gateway } = createGateway(child);
  const runtime = await gateway.launch({ ownerId: "terminal-a", kind: "terminal", workingDirectory: "/tmp/a", cols: 80, rows: 24 });
  assert.equal(runtime.ownerId, "terminal-a");
  await gateway.dispose();
});

test("ambiguous spawn timeout aborts its host generation and a fresh generation can relaunch", async () => {
  const first = new FakeCompanion({ respondToSpawn: false });
  let spawnCount = 0;
  const adapter: ProcessAdapter = {
    membershipPids: async () => first.present ? [first.pid] : [],
    signalPid: () => undefined,
    spawn() {
      spawnCount += 1;
      if (spawnCount === 1) return first;
      if (spawnCount === 2) return new FakeCompanion();
      throw new Error("unexpected companion spawn");
    }
  };
  const gateway = new AgentRuntimeGateway({
    runtimeNodePath: "node",
    hostPath: "/tmp/plugin/runtime/pty-host.mjs",
    codexCliPath: "codex",
    processAdapter: adapter,
    environment: { HOME: "/Users/test", PATH: "/usr/bin", SHELL: "/bin/zsh" },
    readyTimeoutMs: 50,
    requestTimeoutMs: 10,
    hostTerminateMs: 10,
    hostKillMs: 30,
    hostJoinMs: 5
  });
  await assert.rejects(
    gateway.launch({ ownerId: "terminal-a", kind: "terminal", workingDirectory: "/tmp/a", cols: 80, rows: 24 }),
    (error: unknown) => error instanceof RuntimeGatewayError && error.code === "host_timeout"
  );
  assert.ok(first.signals.includes("SIGTERM"));
  first.hostMessage({ protocolVersion: 1, type: "response", requestId: "request-1", ok: true, result: { runtimeId: "late", ownerId: "terminal-a", pid: 999 } });
  const replacement = await gateway.launch({ ownerId: "terminal-a", kind: "terminal", workingDirectory: "/tmp/a", cols: 80, rows: 24 });
  assert.equal(replacement.ownerId, "terminal-a");
  await gateway.dispose();
});

test("terminate retains owner until matching exit and aborts when exit is never confirmed", async () => {
  const child = new FakeCompanion({ emitTerminateExit: false });
  const { gateway } = createGateway(child, { gracefulTerminationMs: 8 });
  const runtime = await gateway.launch({ ownerId: "terminal-a", kind: "terminal", workingDirectory: "/tmp/a", cols: 80, rows: 24 });
  await assert.rejects(gateway.terminate(runtime.runtimeId), /exit confirmation timed out/i);
  assert.ok(child.signals.includes("SIGTERM"));
});

test("Stop during provisional starting cancels launch before the spawn response", async () => {
  const child = new FakeCompanion({ deferSpawnResponse: true });
  const { gateway } = createGateway(child);
  const launchOutcome = gateway.launch({ ownerId: "terminal-a", kind: "terminal", workingDirectory: "/tmp/a", cols: 80, rows: 24 })
    .then(() => "resolved", (error: unknown) => error);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await gateway.terminateOwner("terminal-a");
  child.releaseSpawnResponses();
  const outcome = await launchOutcome;
  assert.ok(outcome instanceof RuntimeGatewayError);
  assert.match(outcome.message, /cancelled/i);
  await assert.rejects(gateway.write("runtime-1", "x"), (error: unknown) => error instanceof RuntimeGatewayError && error.code === "unknown_runtime");
  await gateway.dispose();
});

test("companion and runtime environments do not forward arbitrary secret-shaped values", async () => {
  const child = new FakeCompanion();
  let companionEnvironment: NodeJS.ProcessEnv | undefined;
  const adapter: ProcessAdapter = {
    spawn(_command, _args, options) {
      companionEnvironment = options.env;
      return child;
    },
    membershipPids: async () => child.present ? [child.pid] : [],
    signalPid: () => undefined
  };
  const gateway = new AgentRuntimeGateway({
    runtimeNodePath: "node",
    hostPath: "/tmp/plugin/runtime/pty-host.mjs",
    codexCliPath: "codex",
    processAdapter: adapter,
    environment: { HOME: "/Users/test", PATH: "/gui/bin", SHELL: "/bin/zsh", GITHUB_PAT: "drop", COOKIE: "drop" }
  });
  await gateway.launch({ ownerId: "terminal-a", kind: "terminal", workingDirectory: "/tmp/a", cols: 80, rows: 24 });
  assert.equal(companionEnvironment?.GITHUB_PAT, undefined);
  assert.equal(companionEnvironment?.COOKIE, undefined);
  assert.match(companionEnvironment?.PATH ?? "", /\/opt\/homebrew\/bin/);
  const spawn = child.requests.find((request) => request.type === "spawn");
  assert.equal(spawn?.type === "spawn" ? spawn.env.GITHUB_PAT : "bad", undefined);
  await gateway.dispose();
});

test("beginDispose synchronously makes the gateway unavailable and sends shutdown", async () => {
  const child = new FakeCompanion({ respondToShutdown: false });
  const { gateway } = createGateway(child);
  await gateway.launch({ ownerId: "terminal-a", kind: "terminal", workingDirectory: "/tmp/a", cols: 80, rows: 24 });
  const disposal = gateway.beginDispose();
  assert.equal(child.requests.at(-1)?.type, "shutdown");
  await assert.rejects(
    gateway.launch({ ownerId: "terminal-b", kind: "terminal", workingDirectory: "/tmp/b", cols: 80, rows: 24 }),
    (error: unknown) => error instanceof RuntimeGatewayError && error.code === "runtime_unavailable"
  );
  await disposal;
});
