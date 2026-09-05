import { randomBytes } from "node:crypto";
import {
  RUNTIME_PROTOCOL_VERSION,
  RuntimeGatewayError,
  parseHostMessage,
  parseLaunchResult,
  parseResizeResult,
  toRuntimeError,
  validateTerminalGeometry,
  validateWriteData,
  type HostEvent,
  type HostMessage,
  type HostRequest,
  type LaunchRuntimeRequest,
  type LaunchRuntimeResult,
  type ResizeRuntimeResult,
  type RuntimeErrorCode,
  type RuntimeEvent
} from "./runtime-contract";

export interface CompanionProcess {
  readonly pid?: number;
  readonly connected: boolean;
  send(message: unknown, callback?: (error: Error | null) => void): boolean;
  kill(signal?: NodeJS.Signals): boolean;
  disconnect(): void;
  on(event: "message", listener: (message: unknown) => void): this;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "disconnect", listener: () => void): this;
}

export interface ProcessAdapter {
  spawn(command: string, args: readonly string[], options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: ["ignore", "ignore", "ignore", "ipc"];
  }): CompanionProcess;
  membershipPids(hostPath: string, key: string, token: string, deadline: number): Promise<number[]>;
  signalPid(pid: number, signal: NodeJS.Signals): void;
}

export interface AgentRuntimeGatewayOptions {
  runtimeNodePath: string;
  hostPath: string;
  codexCliPath: string;
  processAdapter: ProcessAdapter;
  environment: NodeJS.ProcessEnv;
  readyTimeoutMs?: number;
  requestTimeoutMs?: number;
  gracefulTerminationMs?: number;
  hostTerminateMs?: number;
  hostKillMs?: number;
  hostJoinMs?: number;
}

export interface AgentRuntimeGatewayContract {
  launch(request: LaunchRuntimeRequest): Promise<LaunchRuntimeResult>;
  write(runtimeId: string, data: string): Promise<void>;
  resize(runtimeId: string, cols: number, rows: number): Promise<ResizeRuntimeResult>;
  terminate(runtimeId: string): Promise<void>;
  terminateOwner(ownerId: string): Promise<void>;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  abort?(message?: string): Promise<void>;
  beginDispose?(): Promise<void>;
  dispose(): Promise<void>;
}

interface PendingRequest {
  generation: number;
  requestType: HostRequest["type"];
  resolve(value: unknown): void;
  reject(error: RuntimeGatewayError): void;
  timer: ReturnType<typeof setTimeout>;
}

interface RuntimeRecord {
  ownerId: string;
  sequence: number;
  exitPromise: Promise<void>;
  resolveExit(): void;
}

interface HostGeneration {
  id: number;
  child: CompanionProcess;
  readyPromise: Promise<void>;
  resolveReady(): void;
  rejectReady(error: RuntimeGatewayError): void;
  readySettled: boolean;
  readyTimer: ReturnType<typeof setTimeout> | undefined;
  exitPromise: Promise<void>;
  resolveExit(): void;
  membershipToken: string;
  cleanupPromise?: Promise<void>;
  stopping: boolean;
  failureReported: boolean;
}

const HOST_TOKEN_KEY = "AGENT_NOTEBOOK_HOST_TOKEN";

export class AgentRuntimeGateway implements AgentRuntimeGatewayContract {
  private readonly supervisor: PtyHostSupervisor;
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private readonly runtimes = new Map<string, RuntimeRecord>();
  private readonly runtimeByOwner = new Map<string, string>();
  private readonly launchingOwners = new Set<string>();
  private readonly cancelledLaunchingOwners = new Set<string>();
  private disposed = false;
  private disposePromise: Promise<void> | undefined;

  constructor(private readonly options: AgentRuntimeGatewayOptions) {
    this.supervisor = new PtyHostSupervisor(
      options,
      (message) => this.receiveHostEvent(message),
      (error) => this.receiveHostFailure(error),
      () => this.clearRuntimeRecords()
    );
  }

  async launch(request: LaunchRuntimeRequest): Promise<LaunchRuntimeResult> {
    this.assertAvailable();
    validateLaunchRequest(request);
    if (request.kind === "agent" && request.provider !== "codex") {
      throw new RuntimeGatewayError("provider_unavailable", "Only the Codex provider is available in this runtime slice.");
    }
    if (this.runtimeByOwner.has(request.ownerId) || this.launchingOwners.has(request.ownerId)) {
      throw new RuntimeGatewayError("invalid_request", `Owner already has a runtime: ${request.ownerId}`);
    }
    this.launchingOwners.add(request.ownerId);
    try {
      const command = request.kind === "agent"
        ? resolveArgvCommand(this.options.codexCliPath)
        : resolveShellCommand(this.options.environment);
      const result = parseLaunchResult(await this.supervisor.request({
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        type: "spawn",
        requestId: this.supervisor.nextRequestId(),
        ownerId: request.ownerId,
        kind: request.kind,
        ...(request.kind === "agent" ? { provider: "codex" as const } : {}),
        command: command.command,
        args: command.args,
        cwd: request.workingDirectory,
        env: createRuntimeEnvironment(this.options.environment),
        ...validateTerminalGeometry(request.cols, request.rows)
      }));
      if (result.ownerId !== request.ownerId) return this.protocolFailure(`Spawn owner mismatch for ${request.ownerId}.`);
      if (this.cancelledLaunchingOwners.has(request.ownerId)) {
        const provisionalRuntime = this.runtimes.get(result.runtimeId);
        if (provisionalRuntime) await this.terminate(result.runtimeId).catch(() => undefined);
        throw new RuntimeGatewayError("host_exited", "Runtime launch was cancelled before it completed.");
      }
      const provisional = this.runtimes.get(result.runtimeId);
      if (provisional && provisional.ownerId !== request.ownerId) {
        return this.protocolFailure(`Runtime ${result.runtimeId} changed owners during launch.`);
      }
      this.runtimes.set(result.runtimeId, provisional ?? createRuntimeRecord(result.ownerId));
      this.runtimeByOwner.set(result.ownerId, result.runtimeId);
      return result;
    } finally {
      this.launchingOwners.delete(request.ownerId);
      this.cancelledLaunchingOwners.delete(request.ownerId);
    }
  }

  async write(runtimeId: string, data: string): Promise<void> {
    this.assertRuntime(runtimeId);
    await this.supervisor.request({
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      type: "write",
      requestId: this.supervisor.nextRequestId(),
      runtimeId,
      data: validateWriteData(data)
    });
  }

  async resize(runtimeId: string, cols: number, rows: number): Promise<ResizeRuntimeResult> {
    this.assertRuntime(runtimeId);
    const geometry = validateTerminalGeometry(cols, rows);
    const result = parseResizeResult(await this.supervisor.request({
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      type: "resize",
      requestId: this.supervisor.nextRequestId(),
      runtimeId,
      ...geometry
    }));
    if (result.runtimeId !== runtimeId) return this.protocolFailure(`Resize response was routed to ${result.runtimeId}.`);
    return result;
  }

  async terminate(runtimeId: string): Promise<void> {
    const record = this.assertRuntime(runtimeId);
    try {
      await this.supervisor.request({
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        type: "terminate",
        requestId: this.supervisor.nextRequestId(),
        runtimeId
      });
      await withDeadline(
        record.exitPromise,
        this.options.gracefulTerminationMs ?? 3_000,
        "terminate_failed",
        "Runtime exit confirmation timed out."
      );
    } catch (error) {
      const failure = toRuntimeError(error, "terminate_failed");
      this.emit({ type: "error", runtimeId, ownerId: record.ownerId, error: failure });
      await this.supervisor.abort(failure);
      throw failure;
    }
  }

  async terminateOwner(ownerId: string): Promise<void> {
    if (this.launchingOwners.has(ownerId)) this.cancelledLaunchingOwners.add(ownerId);
    const runtimeId = this.runtimeByOwner.get(ownerId);
    if (!runtimeId) return;
    await this.terminate(runtimeId);
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  abort(message = "Runtime ownership could not be proven."): Promise<void> {
    return this.supervisor.abort(new RuntimeGatewayError("host_timeout", message));
  }

  beginDispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.disposePromise = this.supervisor.beginDispose();
    return this.disposePromise;
  }

  dispose(): Promise<void> {
    return this.beginDispose();
  }

  private receiveHostEvent(event: HostEvent): void {
    let record = this.runtimes.get(event.runtimeId);
    if (!record) {
      if (!this.launchingOwners.has(event.ownerId)) {
        void this.protocolFailure(`Host emitted an event for unknown runtime ${event.runtimeId}.`).catch(() => undefined);
        return;
      }
      record = createRuntimeRecord(event.ownerId);
      this.runtimes.set(event.runtimeId, record);
      if (event.type === "state" && (event.state === "starting" || event.state === "running")) {
        this.runtimeByOwner.set(event.ownerId, event.runtimeId);
      }
    }
    if (record.ownerId !== event.ownerId) {
      void this.protocolFailure(`Host event owner mismatch for runtime ${event.runtimeId}.`).catch(() => undefined);
      return;
    }
    if (event.type === "output") {
      if (event.sequence !== record.sequence + 1) {
        void this.protocolFailure(`Host output sequence mismatch for runtime ${event.runtimeId}.`).catch(() => undefined);
        return;
      }
      record.sequence = event.sequence;
    }
    if (event.type === "exit") {
      record.resolveExit();
      this.runtimes.delete(event.runtimeId);
      if (this.runtimeByOwner.get(event.ownerId) === event.runtimeId) this.runtimeByOwner.delete(event.ownerId);
    }
    this.emit(event);
  }

  private emit(event: RuntimeEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private receiveHostFailure(error: RuntimeGatewayError): void {
    for (const [runtimeId, record] of this.runtimes) {
      this.emit({ type: "error", runtimeId, ownerId: record.ownerId, error });
    }
  }

  private clearRuntimeRecords(): void {
    for (const record of this.runtimes.values()) record.resolveExit();
    this.runtimes.clear();
    this.runtimeByOwner.clear();
    this.launchingOwners.clear();
    this.cancelledLaunchingOwners.clear();
  }

  private assertAvailable(): void {
    if (this.disposed) throw new RuntimeGatewayError("runtime_unavailable", "Runtime gateway has been disposed.");
  }

  private assertRuntime(runtimeId: string): RuntimeRecord {
    this.assertAvailable();
    const record = this.runtimes.get(runtimeId);
    if (!record) throw new RuntimeGatewayError("unknown_runtime", `Unknown runtime: ${runtimeId}`);
    return record;
  }

  private async protocolFailure<T>(message: string): Promise<T> {
    const error = new RuntimeGatewayError("host_protocol_mismatch", message);
    await this.supervisor.abort(error);
    throw error;
  }
}

class PtyHostSupervisor {
  private current: HostGeneration | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private requestSequence = 0;
  private generationSequence = 0;
  private disposed = false;
  private disposePromise: Promise<void> | undefined;

  constructor(
    private readonly options: AgentRuntimeGatewayOptions,
    private readonly receiveEvent: (event: HostEvent) => void,
    private readonly receiveFailure: (error: RuntimeGatewayError) => void,
    private readonly releaseGeneration: () => void
  ) {}

  nextRequestId(): string {
    this.requestSequence += 1;
    return `request-${this.requestSequence}`;
  }

  async request(request: HostRequest): Promise<unknown> {
    if (this.disposed) throw new RuntimeGatewayError("runtime_unavailable", "Runtime host is unavailable.");
    const generation = await this.ensureStarted();
    if (!generation.child.connected || this.current !== generation || generation.stopping) {
      throw new RuntimeGatewayError("host_exited", "Runtime host IPC is disconnected.");
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(request.requestId);
        if (!pending || pending.generation !== generation.id) return;
        this.pending.delete(request.requestId);
        const failure = new RuntimeGatewayError("host_timeout", `Runtime host request timed out: ${request.type}`);
        void this.abortGeneration(generation, failure).then(() => reject(failure), () => reject(failure));
      }, this.options.requestTimeoutMs ?? 10_000);
      this.pending.set(request.requestId, { generation: generation.id, requestType: request.type, resolve, reject, timer });
      try {
        // false means queued IPC backpressure; the callback remains the delivery oracle.
        generation.child.send(request, (error) => {
          if (!error) return;
          const pending = this.pending.get(request.requestId);
          if (!pending || pending.generation !== generation.id) return;
          clearTimeout(pending.timer);
          this.pending.delete(request.requestId);
          const failure = new RuntimeGatewayError("host_exited", "Runtime host rejected the IPC request.");
          void this.abortGeneration(generation, failure).then(() => reject(failure), () => reject(failure));
        });
      } catch {
        clearTimeout(timer);
        this.pending.delete(request.requestId);
        const failure = new RuntimeGatewayError("host_exited", "Runtime host IPC is unavailable.");
        void this.abortGeneration(generation, failure).then(() => reject(failure), () => reject(failure));
      }
    });
  }

  abort(error: RuntimeGatewayError): Promise<void> {
    const generation = this.current;
    return generation ? this.abortGeneration(generation, error) : Promise.resolve();
  }

  beginDispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    const generation = this.current;
    if (!generation) return Promise.resolve();
    generation.stopping = true;
    this.disposePromise = this.disposeGeneration(generation);
    return this.disposePromise;
  }

  private async ensureStarted(): Promise<HostGeneration> {
    if (this.current) {
      await this.current.readyPromise;
      return this.current;
    }
    if (this.disposed) throw new RuntimeGatewayError("runtime_unavailable", "Runtime host is unavailable.");
    const node = resolveHostCommand(this.options.runtimeNodePath, this.options.hostPath);
    const id = ++this.generationSequence;
    let resolveReady!: () => void;
    let rejectReady!: (error: RuntimeGatewayError) => void;
    let resolveExit!: () => void;
    const readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const exitPromise = new Promise<void>((resolve) => { resolveExit = resolve; });
    const membershipToken = randomBytes(24).toString("hex");
    let child: CompanionProcess;
    try {
      child = this.options.processAdapter.spawn(node.command, node.args, {
        cwd: dirname(this.options.hostPath),
        env: {
          ...createCompanionEnvironment(this.options.environment),
          [HOST_TOKEN_KEY]: membershipToken
        },
        stdio: ["ignore", "ignore", "ignore", "ipc"]
      });
    } catch {
      throw new RuntimeGatewayError("runtime_unavailable", "System Node runtime companion could not be started.");
    }
    const generation: HostGeneration = {
      id,
      child,
      readyPromise,
      resolveReady,
      rejectReady,
      readySettled: false,
      readyTimer: undefined,
      exitPromise,
      resolveExit,
      membershipToken,
      stopping: false,
      failureReported: false
    };
    this.current = generation;
    child.on("message", (value) => this.receiveMessage(generation, value));
    child.on("exit", () => { void this.handleExit(generation); });
    child.on("disconnect", () => {
      if (!generation.stopping) void this.abortGeneration(generation, new RuntimeGatewayError("host_exited", "Runtime host IPC disconnected."));
    });
    child.on("error", () => {
      if (!generation.stopping) void this.abortGeneration(generation, new RuntimeGatewayError("host_exited", "Runtime host process failed."));
    });
    generation.readyTimer = setTimeout(() => {
      void this.abortGeneration(generation, new RuntimeGatewayError("host_timeout", "Runtime host did not become ready within five seconds."));
    }, this.options.readyTimeoutMs ?? 5_000);
    await readyPromise;
    return generation;
  }

  private receiveMessage(generation: HostGeneration, value: unknown): void {
    if (this.current !== generation || generation.stopping) return;
    let message: HostMessage;
    try {
      message = parseHostMessage(value);
    } catch (error) {
      void this.abortGeneration(generation, toRuntimeError(error, "host_protocol_mismatch"));
      return;
    }
    if (message.type === "ready") {
      if (generation.readySettled) {
        void this.abortGeneration(generation, new RuntimeGatewayError("host_protocol_mismatch", "Runtime host sent duplicate ready events."));
        return;
      }
      generation.readySettled = true;
      if (generation.readyTimer) clearTimeout(generation.readyTimer);
      generation.readyTimer = undefined;
      generation.resolveReady();
      return;
    }
    if (!generation.readySettled) {
      void this.abortGeneration(generation, new RuntimeGatewayError("host_protocol_mismatch", "Runtime host sent data before ready."));
      return;
    }
    if (message.type === "response") {
      const pending = this.pending.get(message.requestId);
      if (!pending || pending.generation !== generation.id) {
        void this.abortGeneration(generation, new RuntimeGatewayError("host_protocol_mismatch", `Unexpected response: ${message.requestId}`));
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(message.requestId);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new RuntimeGatewayError(message.error.code, message.error.message));
      return;
    }
    this.receiveEvent(message);
  }

  private async handleExit(generation: HostGeneration): Promise<void> {
    if (generation.readyTimer) clearTimeout(generation.readyTimer);
    generation.readyTimer = undefined;
    if (!generation.readySettled) {
      generation.readySettled = true;
      generation.rejectReady(new RuntimeGatewayError("host_exited", "Runtime host exited before ready."));
    }
    const unexpected = !generation.stopping;
    const failure = new RuntimeGatewayError("host_exited", "Runtime host exited.");
    this.failGeneration(generation, failure);
    if (unexpected) this.reportFailure(generation, failure);
    try {
      if (await this.generationAbsent(generation)) this.completeGeneration(generation);
      else await this.abortGeneration(generation, failure);
    } catch {
      await this.abortGeneration(generation, failure);
    }
  }

  private async abortGeneration(generation: HostGeneration, error: RuntimeGatewayError): Promise<void> {
    if (generation.cleanupPromise) return generation.cleanupPromise;
    generation.stopping = true;
    if (generation.readyTimer) clearTimeout(generation.readyTimer);
    generation.readyTimer = undefined;
    if (!generation.readySettled) {
      generation.readySettled = true;
      generation.rejectReady(error);
    }
    this.failGeneration(generation, error);
    this.reportFailure(generation, error);
    try { generation.child.disconnect(); } catch { /* signal escalation follows */ }
    generation.cleanupPromise ??= this.cleanupGeneration(generation);
    return generation.cleanupPromise;
  }

  private async disposeGeneration(generation: HostGeneration): Promise<void> {
    const requestId = this.nextRequestId();
    let shutdownResponse!: Promise<void>;
    try {
      shutdownResponse = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(requestId);
          reject(new RuntimeGatewayError("host_timeout", "Runtime host shutdown timed out."));
        }, this.options.hostTerminateMs ?? 2_000);
        this.pending.set(requestId, { generation: generation.id, requestType: "shutdown", resolve: () => resolve(), reject, timer });
        generation.child.send({ protocolVersion: RUNTIME_PROTOCOL_VERSION, type: "shutdown", requestId }, (error) => {
          if (!error) return;
          const pending = this.pending.get(requestId);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(requestId);
          reject(new RuntimeGatewayError("host_exited", "Runtime host rejected shutdown."));
        });
      });
    } catch {
      shutdownResponse = Promise.reject(new RuntimeGatewayError("host_exited", "Runtime host IPC is unavailable."));
    }
    void shutdownResponse.catch(() => undefined);
    generation.cleanupPromise ??= this.cleanupGeneration(generation);
    await generation.cleanupPromise;
    this.failGeneration(generation, new RuntimeGatewayError("runtime_unavailable", "Runtime gateway disposed."));
  }

  private async cleanupGeneration(generation: HostGeneration): Promise<void> {
    const startedAt = Date.now();
    const deadline = startedAt + (this.options.hostKillMs ?? 5_000);
    const terminateAt = Math.min(deadline, startedAt + (this.options.hostTerminateMs ?? 2_000));
    const killAt = Math.max(terminateAt, deadline - (this.options.hostJoinMs ?? 500));
    if (await this.waitForAbsence(generation, terminateAt)) return;
    await this.signalGeneration(generation, "SIGTERM", deadline);
    if (await this.waitForAbsence(generation, killAt)) return;
    await this.signalGeneration(generation, "SIGKILL", deadline);
    if (await this.waitForAbsence(generation, deadline)) return;
    throw new RuntimeGatewayError("host_timeout", "Runtime host cleanup could not be confirmed within five seconds.");
  }

  private async waitForAbsence(generation: HostGeneration, deadline: number): Promise<boolean> {
    do {
      if (await this.generationAbsent(generation, deadline)) {
        this.completeGeneration(generation);
        return true;
      }
      await delay(Math.min(25, Math.max(0, deadline - Date.now())));
    } while (Date.now() < deadline);
    return false;
  }

  private async generationAbsent(generation: HostGeneration, deadline = Date.now() + 500): Promise<boolean> {
    const pids = await this.options.processAdapter.membershipPids(
      this.options.hostPath,
      HOST_TOKEN_KEY,
      generation.membershipToken,
      deadline
    );
    return pids.length === 0;
  }

  private async signalGeneration(generation: HostGeneration, signal: NodeJS.Signals, deadline: number): Promise<void> {
    try { generation.child.kill(signal); } catch { /* membership signals follow */ }
    const pids = await this.options.processAdapter.membershipPids(
      this.options.hostPath,
      HOST_TOKEN_KEY,
      generation.membershipToken,
      deadline
    );
    for (const pid of pids.sort((a, b) => b - a)) {
      if (pid !== generation.child.pid) this.options.processAdapter.signalPid(pid, signal);
    }
  }

  private completeGeneration(generation: HostGeneration): void {
    generation.resolveExit();
    if (this.current === generation) {
      this.current = undefined;
      this.releaseGeneration();
    }
  }

  private failGeneration(generation: HostGeneration, error: RuntimeGatewayError): void {
    for (const [requestId, pending] of this.pending) {
      if (pending.generation !== generation.id) continue;
      clearTimeout(pending.timer);
      this.pending.delete(requestId);
      pending.reject(error);
    }
  }

  private reportFailure(generation: HostGeneration, error: RuntimeGatewayError): void {
    if (generation.failureReported || this.disposed) return;
    generation.failureReported = true;
    this.receiveFailure(error);
  }
}

const COMMON_ENVIRONMENT_KEYS = [
  "HOME", "USER", "LOGNAME", "SHELL", "PATH", "LANG", "LC_ALL", "LC_CTYPE",
  "TMPDIR", "TMP", "TEMP"
] as const;
const PROXY_ENVIRONMENT_KEYS = [
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY",
  "http_proxy", "https_proxy", "no_proxy", "all_proxy"
] as const;

export function createCompanionEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  return buildAllowedEnvironment(source, COMMON_ENVIRONMENT_KEYS, false);
}

export function createRuntimeEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const result = buildAllowedEnvironment(source, [...COMMON_ENVIRONMENT_KEYS, ...PROXY_ENVIRONMENT_KEYS], true);
  result.TERM = "xterm-256color";
  result.COLORTERM = "truecolor";
  return result;
}

function buildAllowedEnvironment(source: NodeJS.ProcessEnv, keys: readonly string[], includeTerminalPath: boolean): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && !value.includes("\0")) result[key] = value;
  }
  const home = source.HOME;
  const additions = [
    home ? `${home.replace(/\/$/, "")}/.local/bin` : "",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin"
  ];
  result.PATH = uniquePathEntries([result.PATH ?? "", ...additions]).join(":");
  if (!includeTerminalPath) delete result.COLORTERM;
  return result;
}

export function resolveArgvCommand(executable: string): { command: string; args: string[] } {
  if (!executable.trim()) throw new RuntimeGatewayError("provider_unavailable", "Codex executable is not configured.");
  return isAbsolutePath(executable)
    ? { command: executable, args: [] }
    : { command: "/usr/bin/env", args: [executable] };
}

export function resolveHostCommand(nodePath: string, hostPath: string): { command: string; args: string[] } {
  if (!nodePath.trim()) throw new RuntimeGatewayError("runtime_unavailable", "System Node executable is not configured.");
  return isAbsolutePath(nodePath)
    ? { command: nodePath, args: [hostPath] }
    : { command: "/usr/bin/env", args: [nodePath, hostPath] };
}

function resolveShellCommand(environment: NodeJS.ProcessEnv): { command: string; args: string[] } {
  const shell = environment.SHELL;
  return { command: shell && isAbsolutePath(shell) ? shell : "/bin/zsh", args: ["-l"] };
}

function createRuntimeRecord(ownerId: string): RuntimeRecord {
  let resolveExit!: () => void;
  const exitPromise = new Promise<void>((resolve) => { resolveExit = resolve; });
  return { ownerId, sequence: 0, exitPromise, resolveExit };
}

function validateLaunchRequest(request: LaunchRuntimeRequest): void {
  if (!request.ownerId || !request.workingDirectory || !isAbsolutePath(request.workingDirectory)) {
    throw new RuntimeGatewayError("invalid_request", "Runtime owner and absolute working directory are required.");
  }
  if (request.kind !== "agent" && request.kind !== "terminal") {
    throw new RuntimeGatewayError("invalid_request", "Runtime kind is invalid.");
  }
  validateTerminalGeometry(request.cols, request.rows);
}

function uniquePathEntries(values: readonly string[]): string[] {
  return Array.from(new Set(values.flatMap((value) => value.split(":")).filter(Boolean)));
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/");
}

function dirname(value: string): string {
  const index = value.lastIndexOf("/");
  return index > 0 ? value.slice(0, index) : "/";
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, code: RuntimeErrorCode, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new RuntimeGatewayError(code, message)), timeoutMs); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function settlesWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
