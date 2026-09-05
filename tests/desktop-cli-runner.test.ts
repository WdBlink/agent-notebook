import assert from "node:assert/strict";
import test from "node:test";
import { runDesktopCli } from "../app/desktop/cli-runner";

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
