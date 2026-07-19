export const RUNTIME_PROTOCOL_VERSION = 1 as const;
export const MAX_RUNTIME_WRITE_BYTES = 1024 * 1024;

export type RuntimeKind = "agent" | "terminal";
export type RuntimeProvider = "codex";
export type RuntimeState = "starting" | "running" | "exited" | "failed";
export type RuntimeErrorCode =
  | "runtime_unavailable"
  | "provider_unavailable"
  | "invalid_request"
  | "unknown_runtime"
  | "host_protocol_mismatch"
  | "host_timeout"
  | "host_exited"
  | "spawn_failed"
  | "write_failed"
  | "resize_failed"
  | "terminate_failed";

export interface RuntimeErrorShape {
  code: RuntimeErrorCode;
  message: string;
}

export class RuntimeGatewayError extends Error implements RuntimeErrorShape {
  constructor(readonly code: RuntimeErrorCode, message: string) {
    super(message);
    this.name = "RuntimeGatewayError";
  }
}

export interface TerminalGeometry {
  cols: number;
  rows: number;
}

export interface LaunchRuntimeRequest extends TerminalGeometry {
  ownerId: string;
  kind: RuntimeKind;
  provider?: RuntimeProvider;
  workingDirectory: string;
}

interface HostRequestBase {
  protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
  requestId: string;
}

export interface HostSpawnRequest extends HostRequestBase, TerminalGeometry {
  type: "spawn";
  ownerId: string;
  kind: RuntimeKind;
  provider?: RuntimeProvider;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface HostWriteRequest extends HostRequestBase {
  type: "write";
  runtimeId: string;
  data: string;
}

export interface HostResizeRequest extends HostRequestBase, TerminalGeometry {
  type: "resize";
  runtimeId: string;
}

export interface HostTerminateRequest extends HostRequestBase {
  type: "terminate";
  runtimeId: string;
}

export interface HostShutdownRequest extends HostRequestBase {
  type: "shutdown";
}

export type HostRequest = HostSpawnRequest | HostWriteRequest | HostResizeRequest | HostTerminateRequest | HostShutdownRequest;

export type HostResponse = {
  protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
  type: "response";
  requestId: string;
} & (
  | { ok: true; result: unknown }
  | { ok: false; error: RuntimeErrorShape }
);

export interface HostReadyEvent {
  protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
  type: "ready";
  pid: number;
}

export interface HostOutputEvent {
  protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
  type: "output";
  runtimeId: string;
  ownerId: string;
  sequence: number;
  data: string;
}

export interface HostStateEvent {
  protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
  type: "state";
  runtimeId: string;
  ownerId: string;
  state: RuntimeState;
}

export interface HostExitEvent {
  protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
  type: "exit";
  runtimeId: string;
  ownerId: string;
  exitCode: number | null;
  signal: number | null;
}

export type HostEvent = HostOutputEvent | HostStateEvent | HostExitEvent;
export type HostMessage = HostReadyEvent | HostResponse | HostEvent;

export type RuntimeEvent = HostEvent | {
  type: "error";
  runtimeId: string | null;
  ownerId: string;
  error: RuntimeErrorShape;
};

export interface LaunchRuntimeResult {
  runtimeId: string;
  ownerId: string;
  pid: number;
}

export interface ResizeRuntimeResult extends TerminalGeometry {
  runtimeId: string;
}

export function validateTerminalGeometry(cols: unknown, rows: unknown): TerminalGeometry {
  if (!Number.isInteger(cols) || typeof cols !== "number" || cols < 2 || cols > 500) {
    throw new RuntimeGatewayError("invalid_request", "Terminal columns must be an integer from 2 through 500.");
  }
  if (!Number.isInteger(rows) || typeof rows !== "number" || rows < 1 || rows > 200) {
    throw new RuntimeGatewayError("invalid_request", "Terminal rows must be an integer from 1 through 200.");
  }
  return { cols, rows };
}

export function validateWriteData(data: unknown): string {
  if (typeof data !== "string") throw new RuntimeGatewayError("invalid_request", "Terminal input must be a string.");
  if (new TextEncoder().encode(data).byteLength > MAX_RUNTIME_WRITE_BYTES) {
    throw new RuntimeGatewayError("invalid_request", "Terminal input exceeds the 1 MiB request limit.");
  }
  return data;
}

export function parseHostMessage(value: unknown): HostMessage {
  const source = requiredRecord(value, "Host message must be an object.");
  if (source.protocolVersion !== RUNTIME_PROTOCOL_VERSION) {
    throw new RuntimeGatewayError("host_protocol_mismatch", "Runtime host protocol version does not match version 1.");
  }
  const type = requiredString(source.type, "Host message type is missing.");
  if (type === "ready") {
    if (!Number.isInteger(source.pid) || typeof source.pid !== "number" || source.pid <= 0) invalidHostMessage("Host ready PID is invalid.");
    return { protocolVersion: 1, type, pid: source.pid };
  }
  if (type === "response") return parseResponse(source);
  if (type === "output") {
    return {
      protocolVersion: 1,
      type,
      runtimeId: requiredString(source.runtimeId, "Output runtime ID is missing."),
      ownerId: requiredString(source.ownerId, "Output owner ID is missing."),
      sequence: requiredPositiveInteger(source.sequence, "Output sequence is invalid."),
      data: validateWriteData(source.data)
    };
  }
  if (type === "state") {
    const state = source.state;
    if (state !== "starting" && state !== "running" && state !== "exited" && state !== "failed") {
      invalidHostMessage("Runtime state is invalid.");
    }
    return {
      protocolVersion: 1,
      type,
      runtimeId: requiredString(source.runtimeId, "State runtime ID is missing."),
      ownerId: requiredString(source.ownerId, "State owner ID is missing."),
      state
    };
  }
  if (type === "exit") {
    return {
      protocolVersion: 1,
      type,
      runtimeId: requiredString(source.runtimeId, "Exit runtime ID is missing."),
      ownerId: requiredString(source.ownerId, "Exit owner ID is missing."),
      exitCode: nullableInteger(source.exitCode, "Exit code is invalid."),
      signal: nullableInteger(source.signal, "Exit signal is invalid.")
    };
  }
  return invalidHostMessage(`Unknown host message type: ${type}`);
}

export function parseLaunchResult(value: unknown): LaunchRuntimeResult {
  const source = requiredRecord(value, "Spawn response is invalid.");
  if (!Number.isInteger(source.pid) || typeof source.pid !== "number" || source.pid <= 0) invalidHostMessage("Spawn response PID is invalid.");
  return {
    runtimeId: requiredString(source.runtimeId, "Spawn response runtime ID is missing."),
    ownerId: requiredString(source.ownerId, "Spawn response owner ID is missing."),
    pid: source.pid
  };
}

export function parseResizeResult(value: unknown): ResizeRuntimeResult {
  const source = requiredRecord(value, "Resize response is invalid.");
  return {
    runtimeId: requiredString(source.runtimeId, "Resize response runtime ID is missing."),
    ...validateTerminalGeometry(source.cols, source.rows)
  };
}

export function toRuntimeError(error: unknown, fallbackCode: RuntimeErrorCode = "runtime_unavailable"): RuntimeGatewayError {
  if (error instanceof RuntimeGatewayError) return error;
  return new RuntimeGatewayError(fallbackCode, error instanceof Error && error.message ? error.message : "Runtime operation failed.");
}

function parseResponse(source: Record<string, unknown>): HostResponse {
  const requestId = requiredString(source.requestId, "Response request ID is missing.");
  if (source.ok === true) return { protocolVersion: 1, type: "response", requestId, ok: true, result: source.result };
  if (source.ok !== false) return invalidHostMessage("Response status is invalid.");
  const error = requiredRecord(source.error, "Response error is missing.");
  const code = requiredString(error.code, "Response error code is missing.");
  if (!RUNTIME_ERROR_CODES.has(code as RuntimeErrorCode)) return invalidHostMessage("Response error code is invalid.");
  return {
    protocolVersion: 1,
    type: "response",
    requestId,
    ok: false,
    error: { code: code as RuntimeErrorCode, message: requiredString(error.message, "Response error message is missing.") }
  };
}

const RUNTIME_ERROR_CODES = new Set<RuntimeErrorCode>([
  "runtime_unavailable", "provider_unavailable", "invalid_request", "unknown_runtime",
  "host_protocol_mismatch", "host_timeout", "host_exited", "spawn_failed",
  "write_failed", "resize_failed", "terminate_failed"
]);

function requiredRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalidHostMessage(message);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.length === 0) return invalidHostMessage(message);
  return value;
}

function requiredPositiveInteger(value: unknown, message: string): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 1) return invalidHostMessage(message);
  return value;
}

function nullableInteger(value: unknown, message: string): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || typeof value !== "number") return invalidHostMessage(message);
  return value;
}

function invalidHostMessage(message: string): never {
  throw new RuntimeGatewayError("host_protocol_mismatch", message);
}
