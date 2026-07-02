import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("install-local fails closed on malformed community-plugins.json", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "daily-cockpit-install-"));
  const vault = path.join(temp, "vault");
  const obsidianDir = path.join(vault, ".obsidian");
  await fs.mkdir(obsidianDir, { recursive: true });
  const configPath = path.join(obsidianDir, "community-plugins.json");
  await fs.writeFile(configPath, "{not json");

  await assert.rejects(
    execFileAsync("node", ["scripts/install-local.mjs", "--vault", vault], { cwd: process.cwd() }),
    /Refusing to rewrite malformed community-plugins\.json/
  );

  assert.equal(await fs.readFile(configPath, "utf8"), "{not json");
});
