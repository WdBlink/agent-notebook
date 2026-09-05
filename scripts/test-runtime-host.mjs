import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const hostArgumentIndex = process.argv.indexOf("--host");
const hostPath = path.resolve(hostArgumentIndex >= 0 ? process.argv[hostArgumentIndex + 1] : "runtime/pty-host.mjs");
const localSpawnHelper = path.join(path.dirname(hostPath), "node_modules", "node-pty", "build", "Release", "spawn-helper");
const sourceSpawnHelper = path.resolve("node_modules/node-pty", "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
const spawnHelper = await exists(localSpawnHelper) ? localSpawnHelper : sourceSpawnHelper;
const spawnHelperMode = (await fs.stat(spawnHelper)).mode;
if ((spawnHelperMode & 0o111) === 0) await fs.chmod(spawnHelper, 0o755);
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-notebook-runtime-"));
const cwdA = path.join(tempRoot, "cockpit project α");
const cwdB = path.join(tempRoot, "cockpit project β");
await fs.mkdir(cwdA);
await fs.mkdir(cwdB);

const child = spawn(process.execPath, [hostPath], {
  cwd: path.dirname(hostPath),
  env: process.env,
  stdio: ["ignore", "ignore", "ignore", "ipc"]
});
const recordedPids = new Set([child.pid]);
const pending = new Map();
const output = new Map();
const exits = new Map();
let requestSequence = 0;
let readyPid;

const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("PTY host ready timeout")), 5_000);
  child.on("message", (message) => {
    if (!message || message.protocolVersion !== 1) return;
    if (message.type === "ready") {
      readyPid = message.pid;
      clearTimeout(timer);
      resolve();
      return;
    }
    if (message.type === "response") {
      const operation = pending.get(message.requestId);
      if (!operation) return;
      clearTimeout(operation.timer);
      pending.delete(message.requestId);
      if (message.ok) operation.resolve(message.result);
      else operation.reject(new Error(`${message.error.code}: ${message.error.message}`));
      return;
    }
    if (message.type === "output") {
      const entries = output.get(message.runtimeId) ?? [];
      entries.push({ sequence: message.sequence, data: message.data });
      output.set(message.runtimeId, entries);
      return;
    }
    if (message.type === "exit") exits.set(message.runtimeId, message);
  });
});

function request(type, fields = {}) {
  const requestId = `integration-${++requestSequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`PTY host request timeout: ${type}`));
    }, 10_000);
    pending.set(requestId, {
      resolve: (result) => {
        if (type === "spawn" && Number.isInteger(result?.pid)) recordedPids.add(result.pid);
        resolve(result);
      },
      reject,
      timer
    });
    child.send({ protocolVersion: 1, type, requestId, ...fields });
  });
}

async function waitFor(predicate, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function pidExited(pid, marker = "") {
  try {
    process.kill(pid, 0);
    const { stdout } = await execFileAsync("/bin/ps", ["-p", String(pid), "-o", "pid=,pgid=,stat=,command="], { timeout: 500 });
    const match = stdout.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    return !match || match[3].startsWith("Z") || Number(match[2]) !== pid || (marker !== "" && !match[4].includes(marker));
  } catch (error) {
    if (error?.code === "ESRCH") return true;
    throw error;
  }
}

async function exists(file) {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function outputPid(runtimeId, prefix) {
  await waitFor(() => (output.get(runtimeId) ?? []).some((entry) => entry.data.includes(prefix)), `${prefix} output`);
  const text = (output.get(runtimeId) ?? []).map((entry) => entry.data).join("");
  const match = text.match(new RegExp(`${prefix}(\\d+)`));
  if (!match) throw new Error(`Missing PID marker: ${prefix}`);
  const pid = Number(match[1]);
  recordedPids.add(pid);
  return pid;
}

try {
  await ready;
  const environment = {
    HOME: process.env.HOME ?? tempRoot,
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    SHELL: "/bin/zsh",
    TERM: "xterm-256color",
    COLORTERM: "truecolor"
  };
  const [runtimeA, runtimeB] = await Promise.all([
    request("spawn", { ownerId: "agent-a", kind: "agent", provider: "codex", command: "/bin/zsh", args: ["-f"], cwd: cwdA, env: environment, cols: 80, rows: 24 }),
    request("spawn", { ownerId: "terminal-b", kind: "terminal", command: "/bin/zsh", args: ["-f"], cwd: cwdB, env: environment, cols: 100, rows: 30 })
  ]);
  await Promise.all([
    request("write", { runtimeId: runtimeA.runtimeId, data: "printf 'MARKER-A:%s\\n' \"$PWD\"\r" }),
    request("write", { runtimeId: runtimeB.runtimeId, data: "printf 'MARKER-B:%s\\n' \"$PWD\"\r" })
  ]);
  await waitFor(
    () => (output.get(runtimeA.runtimeId) ?? []).some((entry) => entry.data.includes(`MARKER-A:${cwdA}`)),
    "runtime A cwd marker"
  );
  await waitFor(
    () => (output.get(runtimeB.runtimeId) ?? []).some((entry) => entry.data.includes(`MARKER-B:${cwdB}`)),
    "runtime B cwd marker"
  );
  const textA = (output.get(runtimeA.runtimeId) ?? []).map((entry) => entry.data).join("");
  const textB = (output.get(runtimeB.runtimeId) ?? []).map((entry) => entry.data).join("");
  if (textA.includes("MARKER-B") || textB.includes("MARKER-A")) throw new Error("PTY output crossed runtime boundaries");
  for (const entries of output.values()) {
    entries.forEach((entry, index) => {
      if (entry.sequence !== index + 1) throw new Error("PTY output sequence is not monotonic");
    });
  }
  const resized = await Promise.all([
    request("resize", { runtimeId: runtimeA.runtimeId, cols: 120, rows: 40 }),
    request("resize", { runtimeId: runtimeB.runtimeId, cols: 90, rows: 28 })
  ]);
  if (resized[0].cols !== 120 || resized[0].rows !== 40 || resized[1].cols !== 90 || resized[1].rows !== 28) {
    throw new Error("PTY resize acknowledgement mismatch");
  }
  await Promise.all([
    request("terminate", { runtimeId: runtimeA.runtimeId }),
    request("terminate", { runtimeId: runtimeB.runtimeId })
  ]);
  await waitFor(() => exits.has(runtimeA.runtimeId) && exits.has(runtimeB.runtimeId), "runtime exits");

  const resistantScript = [
    "process.on('SIGHUP', () => {});",
    "process.on('SIGTERM', () => {});",
    "console.log('RESISTANT:' + process.pid);",
    "setInterval(() => {}, 1000);"
  ].join("");
  const resistant = await request("spawn", {
    ownerId: "resistant",
    kind: "terminal",
    command: process.execPath,
    args: ["-e", resistantScript],
    cwd: cwdA,
    env: environment,
    cols: 80,
    rows: 24
  });
  const resistantPid = await outputPid(resistant.runtimeId, "RESISTANT:");
  await request("terminate", { runtimeId: resistant.runtimeId });

  const descendantScript = [
    "const {spawn}=require('node:child_process');",
    `const child=spawn(${JSON.stringify(process.execPath)},['-e',${JSON.stringify("const marker='agent-notebook-descendant-probe';process.on('SIGHUP',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>void marker,1000);")}],{stdio:'ignore'});`,
    "process.on('SIGHUP',()=>{});process.on('SIGTERM',()=>{});",
    "console.log('DESCENDANT:' + child.pid);",
    "setInterval(()=>{},1000);"
  ].join("");
  const descendantRuntime = await request("spawn", {
    ownerId: "descendant",
    kind: "terminal",
    command: process.execPath,
    args: ["-e", descendantScript],
    cwd: cwdA,
    env: environment,
    cols: 80,
    rows: 24
  });
  const descendantPid = await outputPid(descendantRuntime.runtimeId, "DESCENDANT:");
  await new Promise((resolve) => setTimeout(resolve, 250));
  await request("terminate", { runtimeId: descendantRuntime.runtimeId });

  const detachedScript = [
    "const {spawn}=require('node:child_process');",
    `const child=spawn(${JSON.stringify(process.execPath)},['-e',${JSON.stringify("const marker='agent-notebook-zero-detach-probe';process.on('SIGHUP',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>void marker,1000);")}],{stdio:'ignore',detached:true});`,
    "child.unref();console.log('DETACHED:' + child.pid);",
    "setImmediate(()=>process.exit(0));"
  ].join("");
  const detachedRuntime = await request("spawn", {
    ownerId: "detached",
    kind: "terminal",
    command: process.execPath,
    args: ["-e", detachedScript],
    cwd: cwdA,
    env: environment,
    cols: 80,
    rows: 24
  });
  const detachedPid = await outputPid(detachedRuntime.runtimeId, "DETACHED:");
  await waitFor(() => exits.has(detachedRuntime.runtimeId), "natural detached runtime cleanup", 5_000);
  await waitFor(() => pidExited(detachedPid, "agent-notebook-zero-detach-probe"), "detached descendant exit");

  const hostExit = new Promise((resolve) => child.once("exit", resolve));
  const shutdownRuntime = await request("spawn", {
    ownerId: "shutdown-resistant",
    kind: "terminal",
    command: process.execPath,
    args: ["-e", resistantScript.replace("RESISTANT:", "SHUTDOWN:")],
    cwd: cwdB,
    env: environment,
    cols: 80,
    rows: 24
  });
  const shutdownPid = await outputPid(shutdownRuntime.runtimeId, "SHUTDOWN:");
  await request("shutdown");
  await Promise.race([
    hostExit,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error("PTY host shutdown timeout")), 5_000))
  ]);
  const disconnectProbe = await runDisconnectProbe(environment, cwdA);
  console.log(JSON.stringify({
    ok: true,
    node: process.version,
    hostPid: readyPid,
    runtimes: [runtimeA.runtimeId, runtimeB.runtimeId],
    cwd: [cwdA, cwdB],
    resize: resized,
    adversarialCleanup: {
      resistantPid,
      descendantPid,
      detachedPid,
      shutdownPid,
      disconnectPid: disconnectProbe.runtimePid,
      disconnectHostPid: disconnectProbe.hostPid
    }
  }, null, 2));
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await cleanupRecordedProcesses();
  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function runDisconnectProbe(environment, cwd) {
  const probe = spawn(process.execPath, [hostPath], {
    cwd: path.dirname(hostPath),
    env: process.env,
    stdio: ["ignore", "ignore", "ignore", "ipc"]
  });
  let hostPid;
  let runtime;
  const probeReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("disconnect probe ready timeout")), 5_000);
    probe.on("message", (message) => {
      if (message?.type === "ready") {
        hostPid = message.pid;
        recordedPids.add(hostPid);
        probe.send({
          protocolVersion: 1,
          type: "spawn",
          requestId: "disconnect-spawn",
          ownerId: "disconnect-resistant",
          kind: "terminal",
          command: process.execPath,
            args: ["-e", "const marker='agent-notebook-disconnect-probe';process.on('SIGHUP',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>void marker,1000);"],
          cwd,
          env: environment,
          cols: 80,
          rows: 24
        });
      }
      if (message?.type === "response" && message.requestId === "disconnect-spawn" && message.ok) {
        clearTimeout(timer);
        runtime = message.result;
        recordedPids.add(runtime.pid);
        resolve();
      }
    });
  });
  try {
    await probeReady;
    const hostExit = new Promise((resolve) => probe.once("exit", resolve));
    probe.disconnect();
    await Promise.race([hostExit, new Promise((_resolve, reject) => setTimeout(() => reject(new Error("disconnect cleanup timeout")), 5_000))]);
    return { hostPid, runtimePid: runtime.pid };
  } finally {
    if (probe.exitCode === null && probe.signalCode === null) probe.kill("SIGKILL");
  }
}

async function cleanupRecordedProcesses() {
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    for (const pid of Array.from(recordedPids).sort((a, b) => b - a)) {
      try { process.kill(pid, signal); } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const survivors = [];
  for (const pid of recordedPids) {
    if (!await pidExited(pid)) survivors.push(pid);
  }
  if (survivors.length > 0) throw new Error(`Runtime probe cleanup left process identities: ${survivors.join(",")}`);
}
