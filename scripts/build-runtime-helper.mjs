import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const source = path.resolve("runtime/process-membership.c");
const output = path.resolve("runtime/process-membership");

await execFileAsync(process.env.CC || "/usr/bin/cc", ["-O2", "-Wall", "-Wextra", "-o", output, source], {
  timeout: 30_000,
  maxBuffer: 1024 * 1024
});
await fs.chmod(output, 0o755);
