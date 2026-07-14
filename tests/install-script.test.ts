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

test("install-local migrates existing plugin data to the continuity schema", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "daily-cockpit-install-"));
  const vault = path.join(temp, "vault");
  const pluginDir = path.join(vault, ".obsidian", "plugins", "daily-cockpit");
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(
    path.join(pluginDir, "data.json"),
    JSON.stringify({
      schemaVersion: 2,
      settings: {
        dailyNoteFolder: "Daily Cockpit",
        llmEndpoint: "http://127.0.0.1:11434/v1/chat/completions",
        llmModel: "qwen2.5:7b",
        llmApiKey: "",
        sessionScanRoots: ["~/.claude/tasks", "~/.minimax/plans"]
      },
      plans: []
    })
  );

  await execFileAsync("node", ["scripts/install-local.mjs", "--vault", vault], { cwd: process.cwd() });

  const data = JSON.parse(await fs.readFile(path.join(pluginDir, "data.json"), "utf8"));
  assert.ok(data.settings.sessionScanRoots.includes("~/.codex/sessions"));
  assert.ok(data.settings.sessionScanRoots.includes("~/.claude/projects"));
  assert.equal(data.settings.sessionScanRoots.includes("~/.claude/tasks"), false);
  assert.equal(data.settings.sessionScanRoots.includes("~/.minimax/plans"), false);
  assert.equal(data.schemaVersion, 3);
  assert.equal(data.settings.sessionSummaryMode, "native");
  assert.equal(data.settings.codexCliPath, "codex");
  assert.equal(data.settings.claudeCliPath, "claude");
  assert.equal(Array.isArray(data.workSessionSnapshot.sessions), true);
});
