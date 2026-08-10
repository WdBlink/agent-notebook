import { spawn } from "node:child_process";
import os from "node:os";
import type { CliRunner, CliRunRequest, CliRunResult } from "../../src/agent-summary";

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export const desktopCliRunner: CliRunner = (request) => runDesktopCli(request);

export function runDesktopCli(request: CliRunRequest): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: desktopCliEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    };
    const append = (target: "stdout" | "stderr", chunk: Buffer | string): void => {
      if (target === "stdout") stdout += String(chunk);
      else stderr += String(chunk);
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
        child.kill("SIGTERM");
        finish(new Error("CLI 输出超过 4 MB 限制"));
      }
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error(`CLI 总结超过 ${Math.round(request.timeoutMs / 1000)} 秒`));
    }, request.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.on("error", (error) => finish(error));
    child.on("close", (code, signal) => {
      if (code === 0) finish();
      else {
        const detail = structuredStdoutError(stdout) || tail(stderr, 500);
        finish(new Error(`CLI 退出码 ${code ?? signal ?? "unknown"}${detail ? `：${detail}` : ""}`));
      }
    });
    child.stdin.end(request.stdin);
  });
}

function desktopCliEnvironment(): NodeJS.ProcessEnv {
  const homeDir = os.homedir();
  const defaults = [`${homeDir}/.local/bin`, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  return {
    ...process.env,
    HOME: process.env.HOME || homeDir,
    PATH: Array.from(new Set([...defaults, ...(process.env.PATH ?? "").split(":").filter(Boolean)])).join(":")
  };
}

function tail(value: string, length: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > length ? compact.slice(-length) : compact;
}

function structuredStdoutError(value: string): string {
  let result = "";
  for (const line of value.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const error = asRecord(event.error);
      const item = asRecord(event.item);
      const candidate =
        (event.type === "turn.failed" && typeof error?.message === "string" ? error.message : "") ||
        (event.type === "error" && typeof event.message === "string" ? event.message : "") ||
        (item?.type === "error" && typeof item.message === "string" ? item.message : "");
      if (candidate) result = nestedErrorMessage(candidate);
    } catch {
      // Provider stdout can contain ordinary progress lines; only structured errors are admitted.
    }
  }
  return tail(result, 500);
}

function nestedErrorMessage(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const record = asRecord(JSON.parse(trimmed));
    const nested = asRecord(record?.error);
    if (typeof nested?.message === "string") return nested.message;
    if (typeof record?.message === "string") return record.message;
  } catch {
    // Preserve the outer provider message when its payload is not valid JSON.
  }
  return trimmed;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
