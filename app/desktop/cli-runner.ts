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
      else finish(new Error(`CLI 退出码 ${code ?? signal ?? "unknown"}${stderr.trim() ? `：${tail(stderr, 220)}` : ""}`));
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
