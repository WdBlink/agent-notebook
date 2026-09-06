import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { desktopCliRunner, runDesktopCli } from "../app/desktop/cli-runner";

test("desktop CLI runner works in an ESM process and forwards stdin", async () => {
  const result = await runDesktopCli({
    command: process.execPath,
    args: ["-e", "process.stdin.setEncoding('utf8'); let s=''; process.stdin.on('data', c => s += c); process.stdin.on('end', () => process.stdout.write(s.toUpperCase()))"],
    stdin: "agent notebook",
    cwd: process.cwd(),
    timeoutMs: 5_000
  });
  assert.equal(result.stdout, "AGENT NOTEBOOK");
  assert.equal(result.stderr, "");
});

test("desktop CLI calls share three slots and skip cancelled queued requests", async () => {
  const controller = new AbortController();
  const calls = Array.from({ length: 8 }, (_, index) => desktopCliRunner({
    command: process.execPath,
    args: ["-e", "const start=Date.now(); setTimeout(()=>process.stdout.write(JSON.stringify([start,Date.now()])),200)"],
    stdin: "", cwd: process.cwd(), timeoutMs: 5_000,
    ...(index === 3 ? { signal: controller.signal } : {})
  }));
  const completed = Promise.allSettled(calls);
  controller.abort();
  const results = await completed;
  assert.equal(results[3]?.status, "rejected");
  const intervals = results.flatMap((result) => result.status === "fulfilled"
    ? [JSON.parse(result.value.stdout) as [number, number]] : []);
  assert.equal(intervals.length, 7);
  const events = intervals.flatMap(([start, end]) => [[start, 1], [end, -1]])
    .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  let active = 0;
  let peak = 0;
  for (const [, delta] of events) { active += delta!; peak = Math.max(peak, active); }
  assert.equal(peak, 3);
});

test("desktop CLI cancellation terminates a running child", async () => {
  const controller = new AbortController();
  const call = desktopCliRunner({ command: process.execPath,
    args: ["-e", "setInterval(()=>{},1000)"], stdin: "x".repeat(1_000_000), cwd: process.cwd(),
    timeoutMs: 5_000, signal: controller.signal });
  const rejected = assert.rejects(call, /CLI 任务已取消/);
  controller.abort();
  await rejected;
});

test("desktop CLI runner includes provider install locations in PATH", async () => {
  const result = await runDesktopCli({
    command: process.execPath,
    args: ["-e", "process.stdout.write(process.env.PATH || '')"],
    stdin: "",
    cwd: process.cwd(),
    timeoutMs: 5_000
  });
  assert.match(result.stdout, /\.local\/bin/);
  assert.match(result.stdout, /\/opt\/homebrew\/bin/);
});

test("desktop CLI runner surfaces a structured stdout error when the provider exits nonzero", async () => {
  await assert.rejects(
    () => runDesktopCli({
      command: process.execPath,
      args: [
        "-e",
        `process.stdout.write(JSON.stringify({type:"turn.failed",error:{message:"Unsupported value: 'max' for reasoning.effort"}}) + "\\n"); process.exitCode = 1;`
      ],
      stdin: "",
      cwd: process.cwd(),
      timeoutMs: 5_000
    }),
    /Unsupported value: 'max'.*reasoning\.effort/
  );
});

test("desktop CLI runner streams past verbose Codex tool events and keeps only the final answer", async () => {
  const result = await runDesktopCli({
    command: process.execPath,
    args: [
      "-e",
      `const noisy = JSON.stringify({type:"item.completed",item:{type:"command_execution",aggregated_output:"NOISE".repeat(1024 * 1024)}}); const answer = JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"{\\\"worklines\\\":[]}"}}); process.stdout.write(noisy + "\\n" + answer + "\\n");`
    ],
    stdin: "",
    cwd: process.cwd(),
    timeoutMs: 5_000,
    stdoutMode: "codex-jsonl"
  });

  assert.equal(result.stdout.includes("NOISE"), false);
  assert.match(result.stdout, /agent_message/);
  assert.ok(Buffer.byteLength(result.stdout) < 2_048);
});

test("desktop CLI runner surfaces Claude result errors written only to stdout", async () => {
  await assert.rejects(
    () => runDesktopCli({
      command: process.execPath,
      args: [
        "-e",
        `process.stdout.write(JSON.stringify({type:"result",subtype:"error_during_execution",is_error:true,result:"Review material exceeded the provider context window"})); process.exitCode = 1;`
      ],
      stdin: "",
      cwd: process.cwd(),
      timeoutMs: 5_000
    }),
    /Review material exceeded the provider context window/
  );
});

test("desktop CLI runner surfaces Claude errors-array envelopes written only to stdout", async () => {
  await assert.rejects(
    () => runDesktopCli({
      command: process.execPath,
      args: [
        "-e",
        `process.stdout.write(JSON.stringify({type:"result",subtype:"error_during_execution",is_error:true,errors:["Frozen evidence could not be read","Second diagnostic"]})); process.exitCode = 1;`
      ],
      stdin: "",
      cwd: process.cwd(),
      timeoutMs: 5_000,
      stdoutMode: "single-json"
    }),
    /Frozen evidence could not be read.*Second diagnostic/
  );
});

test("desktop CLI runner force-kills a provider that ignores graceful timeout shutdown", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-notebook-cli-kill-"));
  const survivorMarker = path.join(tempDir, "survived.txt");
  try {
    await assert.rejects(
      () => runDesktopCli({
        command: process.execPath,
        args: [
          "-e",
          `const fs=require("node:fs"); process.on("SIGTERM",()=>{}); setTimeout(()=>fs.writeFileSync(${JSON.stringify(survivorMarker)},"alive"),850); setInterval(()=>{},1000);`
        ],
        stdin: "",
        cwd: process.cwd(),
        timeoutMs: 100
      }),
      /CLI 总结超过 0 秒/
    );

    await new Promise((resolve) => setTimeout(resolve, 900));
    await assert.rejects(access(survivorMarker), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
