import { execFile } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pty from "node-pty";

const execFileAsync = promisify(execFile);
const PROTOCOL_VERSION = 1;
const MAX_WRITE_BYTES = 1024 * 1024;
const MAX_OUTPUT_BUFFER_BYTES = 1024 * 1024;
const OUTPUT_RESUME_BYTES = 64 * 1024;
const OUTPUT_BACKPRESSURE_MS = 2_000;
const TREE_POLL_MS = 25;
const CLEANUP_BUDGET_MS = 4_900;
const RUNTIME_TOKEN_KEY = "DAILY_COCKPIT_RUNTIME_TOKEN";
const HOST_TOKEN_KEY = "DAILY_COCKPIT_HOST_TOKEN";
const membershipHelper = path.join(path.dirname(fileURLToPath(import.meta.url)), "process-membership");
const runtimes = new Map();
let runtimeCounter = 0;
let closing = false;
let shutdownPromise;

class HostFailure extends Error {
  constructor(code, message, requestId) {
    super(message);
    this.runtimeCode = code;
    this.requestId = requestId;
  }
}

function send(message) {
  if (!process.connected || !process.send) return false;
  try {
    return process.send({ protocolVersion: PROTOCOL_VERSION, ...message });
  } catch {
    return false;
  }
}

function successResponse(requestId, result) {
  send({ type: "response", requestId, ok: true, result });
}

function errorResponse(requestId, code, message) {
  send({ type: "response", requestId, ok: false, error: { code, message } });
}

function fail(requestId, code, message) {
  throw new HostFailure(code, message, requestId);
}

function validateRequest(value) {
  if (!value || typeof value !== "object" || value.protocolVersion !== PROTOCOL_VERSION) {
    fail(value?.requestId ?? "unknown", "invalid_request", "Runtime request protocol is invalid.");
  }
  if (typeof value.requestId !== "string" || !value.requestId || typeof value.type !== "string") {
    fail(value?.requestId ?? "unknown", "invalid_request", "Runtime request envelope is invalid.");
  }
  return value;
}

function geometry(request) {
  if (!Number.isInteger(request.cols) || request.cols < 2 || request.cols > 500 || !Number.isInteger(request.rows) || request.rows < 1 || request.rows > 200) {
    fail(request.requestId, "invalid_request", "Terminal geometry is outside the supported range.");
  }
  return { cols: request.cols, rows: request.rows };
}

function stringRecord(value, requestId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(requestId, "invalid_request", "Runtime environment is invalid.");
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string" || key.includes("\0") || entry.includes("\0")) fail(requestId, "invalid_request", "Runtime environment contains an invalid value.");
    result[key] = entry;
  }
  return result;
}

function runtimeFor(request) {
  if (typeof request.runtimeId !== "string") fail(request.requestId, "invalid_request", "Runtime id is required.");
  const runtime = runtimes.get(request.runtimeId);
  if (!runtime) fail(request.requestId, "unknown_runtime", "The requested runtime does not exist.");
  return runtime;
}

function spawnRuntime(request) {
  if (typeof request.ownerId !== "string" || !request.ownerId || !["agent", "terminal"].includes(request.kind)) {
    fail(request.requestId, "invalid_request", "Runtime owner or kind is invalid.");
  }
  if (request.kind === "agent" && request.provider !== "codex") fail(request.requestId, "provider_unavailable", "Only Codex is available.");
  if (typeof request.command !== "string" || !request.command || !Array.isArray(request.args) || request.args.some((arg) => typeof arg !== "string")) {
    fail(request.requestId, "invalid_request", "Runtime argv is invalid.");
  }
  if (typeof request.cwd !== "string" || !request.cwd.startsWith("/") || request.cwd.includes("\0")) fail(request.requestId, "invalid_request", "Runtime cwd is invalid.");
  const { cols, rows } = geometry(request);
  const env = stringRecord(request.env, request.requestId);
  const membershipToken = crypto.randomBytes(24).toString("hex");
  env[RUNTIME_TOKEN_KEY] = membershipToken;
  const hostToken = process.env[HOST_TOKEN_KEY];
  if (typeof hostToken === "string" && hostToken) env[HOST_TOKEN_KEY] = hostToken;
  const runtimeId = `runtime-${process.pid}-${++runtimeCounter}`;
  send({ type: "state", runtimeId, ownerId: request.ownerId, state: "starting" });
  let terminal;
  try {
    terminal = pty.spawn(request.command, request.args, { name: "xterm-256color", cwd: request.cwd, env, cols, rows });
  } catch {
    send({ type: "state", runtimeId, ownerId: request.ownerId, state: "failed" });
    fail(request.requestId, "spawn_failed", "The runtime executable could not be started.");
  }
  let resolveDirectExit;
  const record = {
    runtimeId,
    ownerId: request.ownerId,
    terminal,
    pid: terminal.pid,
    sequence: 0,
    outputQueue: [],
    outputBytes: 0,
    outputSending: false,
    outputPaused: false,
    outputTimer: undefined,
    trackedPids: new Set([terminal.pid]),
    currentMembershipPids: new Set(),
    membershipToken,
    directExited: false,
    tokenAbsenceSince: undefined,
    exitInfo: undefined,
    directExit: new Promise((resolve) => { resolveDirectExit = resolve; }),
    resolveDirectExit,
    termination: undefined,
    exitPublished: false,
    auditTimer: undefined
  };
  runtimes.set(runtimeId, record);
  record.auditTimer = setInterval(() => { void refreshTrackedPids(record); }, 200);
  record.auditTimer.unref();
  terminal.onData((data) => enqueueOutput(record, data));
  terminal.onExit(({ exitCode, signal }) => {
    record.directExited = true;
    record.exitInfo = {
      exitCode: Number.isInteger(exitCode) ? exitCode : null,
      signal: Number.isInteger(signal) ? signal : null
    };
    record.resolveDirectExit();
    void terminateTree(record, Date.now() + CLEANUP_BUDGET_MS).catch(() => {
      send({ type: "state", runtimeId, ownerId: request.ownerId, state: "failed" });
    });
  });
  send({ type: "state", runtimeId, ownerId: request.ownerId, state: "running" });
  successResponse(request.requestId, { runtimeId, ownerId: request.ownerId, pid: terminal.pid });
}

function enqueueOutput(record, data) {
  if (record.termination || !runtimes.has(record.runtimeId)) return;
  const bytes = Buffer.byteLength(data, "utf8");
  if (bytes > MAX_OUTPUT_BUFFER_BYTES || record.outputBytes + bytes > MAX_OUTPUT_BUFFER_BYTES) {
    pauseOutput(record);
    void terminateTree(record).catch(() => undefined);
    return;
  }
  record.outputQueue.push({ data, bytes });
  record.outputBytes += bytes;
  flushOutput(record);
}

function flushOutput(record) {
  if (record.outputSending || record.termination) return;
  const chunk = record.outputQueue[0];
  if (!chunk) {
    resumeOutput(record);
    return;
  }
  if (!process.connected || !process.send) {
    void terminateTree(record).catch(() => undefined);
    return;
  }
  record.outputSending = true;
  record.sequence += 1;
  let accepted = true;
  try {
    accepted = process.send({
      protocolVersion: PROTOCOL_VERSION,
      type: "output",
      runtimeId: record.runtimeId,
      ownerId: record.ownerId,
      sequence: record.sequence,
      data: chunk.data
    }, (error) => {
      record.outputSending = false;
      if (record.outputTimer) clearTimeout(record.outputTimer);
      record.outputTimer = undefined;
      if (error) {
        void terminateTree(record).catch(() => undefined);
        return;
      }
      record.outputQueue.shift();
      record.outputBytes -= chunk.bytes;
      if (record.outputBytes <= OUTPUT_RESUME_BYTES) resumeOutput(record);
      flushOutput(record);
    });
  } catch {
    record.outputSending = false;
    void terminateTree(record).catch(() => undefined);
    return;
  }
  if (!accepted) {
    pauseOutput(record);
    record.outputTimer = setTimeout(() => {
      record.outputTimer = undefined;
      void terminateTree(record).catch(() => undefined);
    }, OUTPUT_BACKPRESSURE_MS);
  }
}

function pauseOutput(record) {
  if (record.outputPaused) return;
  record.outputPaused = true;
  try { record.terminal.pause(); } catch { /* termination remains authoritative */ }
}

function resumeOutput(record) {
  if (!record.outputPaused || record.termination) return;
  record.outputPaused = false;
  try { record.terminal.resume(); } catch { void terminateTree(record).catch(() => undefined); }
}

function writeRuntime(request) {
  const runtime = runtimeFor(request);
  if (runtime.termination) fail(request.requestId, "unknown_runtime", "The requested runtime is terminating.");
  if (typeof request.data !== "string" || Buffer.byteLength(request.data, "utf8") > MAX_WRITE_BYTES) {
    fail(request.requestId, "invalid_request", "Terminal input must be a string no larger than 1 MiB.");
  }
  try {
    runtime.terminal.write(request.data);
  } catch {
    fail(request.requestId, "write_failed", "Terminal input could not be written.");
  }
  successResponse(request.requestId, { runtimeId: runtime.runtimeId });
}

function resizeRuntime(request) {
  const runtime = runtimeFor(request);
  if (runtime.termination) fail(request.requestId, "unknown_runtime", "The requested runtime is terminating.");
  const accepted = geometry(request);
  try {
    runtime.terminal.resize(accepted.cols, accepted.rows);
  } catch {
    fail(request.requestId, "resize_failed", "Terminal could not be resized.");
  }
  successResponse(request.requestId, { runtimeId: runtime.runtimeId, ...accepted });
}

async function terminateRuntime(request) {
  const runtime = runtimeFor(request);
  try {
    await terminateTree(runtime, Date.now() + CLEANUP_BUDGET_MS);
  } catch {
    fail(request.requestId, "terminate_failed", "Terminal process tree could not be terminated.");
  }
  successResponse(request.requestId, { runtimeId: runtime.runtimeId });
}

async function terminateTree(record, deadline = Date.now() + CLEANUP_BUDGET_MS) {
  if (record.termination) return record.termination;
  record.cleanupDeadline = deadline;
  record.termination = (async () => {
    pauseOutput(record);
    record.outputQueue.length = 0;
    record.outputBytes = 0;
    if (record.outputTimer) clearTimeout(record.outputTimer);
    record.outputTimer = undefined;
    await refreshTrackedPids(record);
    for (const [signal, offsetMs] of [["SIGHUP", 0], ["SIGTERM", 250], ["SIGKILL", 1_000]]) {
      if (await waitUntilOffsetOrExit(record, deadline, offsetMs)) {
        publishExit(record);
        return;
      }
      signalTrackedTree(record, signal);
      const nextOffset = signal === "SIGHUP" ? 250 : signal === "SIGTERM" ? 1_000 : CLEANUP_BUDGET_MS;
      if (await waitUntilOffsetOrExit(record, deadline, nextOffset)) {
        publishExit(record);
        return;
      }
    }
    if (!await waitForTreeExit(record, deadline)) throw new Error("Runtime process tree cleanup could not be confirmed.");
    publishExit(record);
  })();
  return record.termination;
}

function publishExit(record) {
  if (record.exitPublished) return;
  record.exitPublished = true;
  if (record.auditTimer) clearInterval(record.auditTimer);
  runtimes.delete(record.runtimeId);
  const info = record.exitInfo ?? { exitCode: null, signal: null };
  send({ type: "state", runtimeId: record.runtimeId, ownerId: record.ownerId, state: "exited" });
  send({ type: "exit", runtimeId: record.runtimeId, ownerId: record.ownerId, ...info });
}

async function refreshTrackedPids(record) {
  const members = new Set(await membershipPids(RUNTIME_TOKEN_KEY, record.membershipToken, record.cleanupDeadline));
  record.currentMembershipPids = members;
  for (const pid of record.trackedPids) {
    if (isProcessAlive(pid)) members.add(pid);
  }
  if (!record.directExited && isProcessAlive(record.pid)) members.add(record.pid);
  record.trackedPids = members;
}

async function membershipPids(key, token, deadline = Date.now() + 750) {
  const timeout = Math.min(750, deadline - Date.now());
  if (timeout <= 0) throw new Error("Runtime membership census deadline elapsed.");
  let stdout;
  try {
    ({ stdout } = await execFileAsync(membershipHelper, [], {
      env: { DAILY_COCKPIT_AUDIT_KEY: key, DAILY_COCKPIT_AUDIT_VALUE: token },
      timeout,
      maxBuffer: 1024 * 1024
    }));
  } catch {
    throw new Error("Runtime membership census failed.");
  }
  const pids = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    if (!/^\d+$/.test(line)) throw new Error("Runtime membership census returned invalid data.");
    const pid = Number(line);
    if (pid > 1) pids.push(pid);
  }
  return pids;
}

function signalTrackedTree(record, signal) {
  if (!record.directExited) {
    try { process.kill(-record.pid, signal); } catch { /* individual PID signals follow */ }
  }
  for (const pid of Array.from(record.trackedPids).sort((a, b) => b - a)) {
    try { process.kill(pid, signal); } catch { /* already gone */ }
  }
  if (!record.directExited) {
    try { record.terminal.kill(signal); } catch { /* process signals remain authoritative */ }
  }
}

async function waitForTreeExit(record, deadline) {
  if (Date.now() >= deadline) return false;
  do {
    await refreshTrackedPids(record);
    for (const pid of Array.from(record.trackedPids)) {
      if (!isProcessAlive(pid)) record.trackedPids.delete(pid);
    }
    if (record.trackedPids.size === 0 && record.currentMembershipPids.size === 0 && record.directExited) {
      record.tokenAbsenceSince ??= Date.now();
      if (Date.now() - record.tokenAbsenceSince >= 100) return true;
    } else {
      record.tokenAbsenceSince = undefined;
    }
    await delay(TREE_POLL_MS);
  } while (Date.now() < deadline);
  return false;
}

async function waitUntilOffsetOrExit(record, deadline, offsetMs) {
  const target = Math.min(deadline, deadline - CLEANUP_BUDGET_MS + offsetMs);
  while (Date.now() < target) {
    if (await waitForTreeExit(record, Math.min(target, Date.now() + 50))) return true;
  }
  return waitForTreeExit(record, Math.min(deadline, Date.now() + 25));
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shutdown(requestId) {
  if (shutdownPromise) return shutdownPromise;
  closing = true;
  shutdownPromise = (async () => {
    const deadline = Date.now() + CLEANUP_BUDGET_MS;
    const results = await Promise.allSettled(Array.from(runtimes.values(), (runtime) => terminateTree(runtime, deadline)));
    const failed = results.some((result) => result.status === "rejected");
    if (requestId) {
      if (failed) errorResponse(requestId, "terminate_failed", "One or more runtime process trees could not be terminated.");
      else successResponse(requestId, { stopped: true });
    }
    setTimeout(() => process.exit(failed ? 1 : 0), 10).unref();
  })();
  return shutdownPromise;
}

process.on("message", (value) => {
  void (async () => {
    let requestId = "unknown";
    try {
      const request = validateRequest(value);
      requestId = request.requestId;
      if (closing && request.type !== "shutdown") fail(requestId, "host_exited", "Runtime host is shutting down.");
      if (request.type === "spawn") spawnRuntime(request);
      else if (request.type === "write") writeRuntime(request);
      else if (request.type === "resize") resizeRuntime(request);
      else if (request.type === "terminate") await terminateRuntime(request);
      else if (request.type === "shutdown") await shutdown(requestId);
      else fail(requestId, "invalid_request", `Unknown request type: ${request.type}`);
    } catch (error) {
      errorResponse(error?.requestId ?? requestId, error?.runtimeCode ?? "invalid_request", error?.message || "Invalid runtime request.");
    }
  })();
});

process.on("disconnect", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
process.on("uncaughtException", () => { void shutdown(); });

if (!process.send) process.exit(1);
send({ type: "ready", pid: process.pid });
