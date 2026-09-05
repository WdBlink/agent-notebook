import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("install-local fails closed on malformed community-plugins.json", async (t) => {
  const temp = await createTempRoot(t, "agent-notebook-install-");
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

test("install-local migrates existing plugin data to the continuity schema", async (t) => {
  const temp = await createTempRoot(t, "agent-notebook-install-");
  const vault = path.join(temp, "vault");
  const pluginDir = path.join(vault, ".obsidian", "plugins", "agent-notebook");
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(
    path.join(pluginDir, "data.json"),
    JSON.stringify({
      schemaVersion: 2,
      settings: {
        dailyNoteFolder: "Agent Notebook",
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
  assert.equal(data.schemaVersion, 4);
  assert.equal(data.settings.sessionSummaryMode, "native");
  assert.deepEqual(data.settings.enabledSessionProviders, ["codex", "claude"]);
  assert.equal(data.settings.codexCliPath, "codex");
  assert.equal(data.settings.claudeCliPath, "claude");
  assert.equal(data.whiteboardRevision, 0);
  assert.equal(Array.isArray(data.workSessionSnapshot.sessions), true);
  assert.deepEqual(data.whiteboard, {
    schemaVersion: 2,
    viewport: { x: 80, y: 72, zoom: 1 },
    projects: [],
    nodes: [],
    edges: [],
    console: { provider: "codex" }
  });
});

test("install-local preserves a schema-one whiteboard for plugin-load migration", async (t) => {
  const temp = await createTempRoot(t, "agent-notebook-install-");
  const vault = path.join(temp, "vault");
  const pluginDir = path.join(vault, ".obsidian", "plugins", "agent-notebook");
  await fs.mkdir(pluginDir, { recursive: true });
  const whiteboard = {
    projects: [{ id: "project-a", name: "A", rootPath: "/workspace/a" }],
    activeProjectId: "project-a",
    boards: {
      "project-a": {
        schemaVersion: 1,
        projectId: "project-a",
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [],
        edges: []
      }
    }
  };
  await fs.writeFile(path.join(pluginDir, "data.json"), JSON.stringify({
    schemaVersion: 4,
    settings: {},
    plans: [],
    whiteboard
  }));

  await execFileAsync("node", ["scripts/install-local.mjs", "--vault", vault], { cwd: process.cwd() });
  const data = JSON.parse(await fs.readFile(path.join(pluginDir, "data.json"), "utf8"));
  assert.deepEqual(data.whiteboard, whiteboard);
});

test("install-local refuses to replace malformed whiteboard input", async (t) => {
  const temp = await createTempRoot(t, "agent-notebook-install-");
  const vault = path.join(temp, "vault");
  const pluginDir = path.join(vault, ".obsidian", "plugins", "agent-notebook");
  await fs.mkdir(pluginDir, { recursive: true });
  const dataPath = path.join(pluginDir, "data.json");
  const original = JSON.stringify({ schemaVersion: 4, settings: {}, plans: [], whiteboard: { projects: "bad" } });
  await fs.writeFile(dataPath, original);

  await assert.rejects(
    execFileAsync("node", ["scripts/install-local.mjs", "--vault", vault], { cwd: process.cwd() }),
    /malformed whiteboard input/
  );
  assert.equal(await fs.readFile(dataPath, "utf8"), original);
});

test("install-local fails closed before asset writes when outer data is malformed around valid schema one", async (t) => {
  const temp = await createTempRoot(t, "agent-notebook-install-");
  const vault = path.join(temp, "vault");
  const pluginDir = path.join(vault, ".obsidian", "plugins", "agent-notebook");
  await fs.mkdir(pluginDir, { recursive: true });
  const whiteboard = {
    projects: [{ id: "project-a", name: "A", rootPath: "/workspace/a" }],
    activeProjectId: "project-a",
    boards: {
      "project-a": {
        schemaVersion: 1,
        projectId: "project-a",
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [],
        edges: []
      }
    }
  };
  const dataPath = path.join(pluginDir, "data.json");
  const original = JSON.stringify({ schemaVersion: 4, settings: {}, plans: "invalid", whiteboard });
  await fs.writeFile(dataPath, original);
  await fs.writeFile(path.join(pluginDir, "main.js"), "existing-plugin-bytes");

  await assert.rejects(
    execFileAsync("node", ["scripts/install-local.mjs", "--vault", vault], { cwd: process.cwd() }),
    /Refusing to repair malformed outer data\.json/
  );
  assert.equal(await fs.readFile(dataPath, "utf8"), original);
  assert.equal(await fs.readFile(path.join(pluginDir, "main.js"), "utf8"), "existing-plugin-bytes");
});

test("install-local rejects symlinks at plugin, runtime, package, release, and asset destinations", async (t) => {
  const cases = ["plugin", "runtime", "package", "release", "asset"] as const;
  for (const kind of cases) {
    await t.test(kind, async (t) => {
      const temp = await createTempRoot(t, `agent-notebook-symlink-${kind}-`);
      const vault = path.join(temp, "vault");
      const pluginsDir = path.join(vault, ".obsidian", "plugins");
      const pluginDir = path.join(pluginsDir, "agent-notebook");
      const outside = path.join(temp, "outside");
      const sentinel = path.join(outside, "sentinel.txt");
      await fs.mkdir(pluginsDir, { recursive: true });
      await fs.mkdir(outside);
      await fs.writeFile(sentinel, "outside-must-remain");

      if (kind === "plugin") {
        await fs.symlink(outside, pluginDir);
      } else {
        await fs.mkdir(pluginDir);
        if (kind === "runtime") {
          await fs.symlink(outside, path.join(pluginDir, "runtime"));
        } else if (kind === "package") {
          await fs.mkdir(path.join(pluginDir, "runtime", "node_modules"), { recursive: true });
          await fs.symlink(outside, path.join(pluginDir, "runtime", "node_modules", "node-pty"));
        } else if (kind === "release") {
          await fs.mkdir(path.join(pluginDir, "runtime", "node_modules", "node-pty", "build"), { recursive: true });
          await fs.symlink(outside, path.join(pluginDir, "runtime", "node_modules", "node-pty", "build", "Release"));
        } else {
          await fs.symlink(sentinel, path.join(pluginDir, "main.js"));
        }
      }

      await assert.rejects(
        execFileAsync("node", ["scripts/install-local.mjs", "--vault", vault], { cwd: process.cwd() }),
        /symlink/i
      );
      assert.equal(await fs.readFile(sentinel, "utf8"), "outside-must-remain");
    });
  }
});

test("verify-local strictly rejects malformed schema two without changing data", async (t) => {
  const temp = await createTempRoot(t, "agent-notebook-verify-");
  const vault = path.join(temp, "vault");
  await execFileAsync("node", ["scripts/install-local.mjs", "--vault", vault], { cwd: process.cwd() });
  const dataPath = path.join(vault, ".obsidian", "plugins", "agent-notebook", "data.json");
  const data = JSON.parse(await fs.readFile(dataPath, "utf8"));
  data.whiteboard.edges = [{ id: "orphan", sourceNodeId: "missing", targetNodeId: "missing" }];
  const malformed = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(dataPath, malformed);

  await assert.rejects(
    execFileAsync("node", ["scripts/verify-local.mjs", "--vault", vault], { cwd: process.cwd() }),
    /孤立端点/
  );
  assert.equal(await fs.readFile(dataPath, "utf8"), malformed);

  const invalidRevision = { ...data, whiteboard: createEmptySchemaTwo(), whiteboardRevision: -1 };
  const invalidRevisionBytes = `${JSON.stringify(invalidRevision, null, 2)}\n`;
  await fs.writeFile(dataPath, invalidRevisionBytes);
  await assert.rejects(
    execFileAsync("node", ["scripts/verify-local.mjs", "--vault", vault], { cwd: process.cwd() }),
    /no valid whiteboardRevision/
  );
  assert.equal(await fs.readFile(dataPath, "utf8"), invalidRevisionBytes);
});

test("verify-local rejects unexpected, symlinked, and mode-tampered runtime entries", async (t) => {
  const temp = await createTempRoot(t, "agent-notebook-verify-runtime-");
  const vault = path.join(temp, "vault");
  await execFileAsync("node", ["scripts/install-local.mjs", "--vault", vault], { cwd: process.cwd() });
  const runtimeRoot = path.join(vault, ".obsidian", "plugins", "agent-notebook", "runtime");
  const pointer = JSON.parse(await fs.readFile(path.join(runtimeRoot, "active.json"), "utf8"));
  const runtimeDir = path.join(runtimeRoot, "versions", pointer.version);
  const unexpected = path.join(runtimeDir, "unexpected.js");
  await fs.writeFile(unexpected, "unexpected");
  await assert.rejects(
    execFileAsync("node", ["scripts/verify-local.mjs", "--vault", vault], { cwd: process.cwd() }),
    /missing or unexpected entries/
  );
  await fs.rm(unexpected);

  const manifest = JSON.parse(await fs.readFile(path.join(runtimeDir, "runtime-manifest.json"), "utf8"));
  const regularEntry = manifest.files.find((entry: { path: string }) => entry.path.endsWith(".js"));
  assert.ok(regularEntry);
  const regularPath = path.join(runtimeDir, regularEntry.path);
  const saved = await fs.readFile(regularPath);
  await fs.rm(regularPath);
  await fs.symlink(path.join(runtimeDir, "pty-host.mjs"), regularPath);
  await assert.rejects(
    execFileAsync("node", ["scripts/verify-local.mjs", "--vault", vault], { cwd: process.cwd() }),
    /contains symlink/
  );
  await fs.rm(regularPath);
  await fs.writeFile(regularPath, saved);
  await fs.chmod(regularPath, 0o777);
  await assert.rejects(
    execFileAsync("node", ["scripts/verify-local.mjs", "--vault", vault], { cwd: process.cwd() }),
    /manifest mismatch/
  );
});

test("real-runner full lifecycle restores every forced failure and detects wrapped providers", async () => {
  const { stdout } = await execFileAsync("node", ["scripts/e2e-whiteboard-obsidian.mjs", "--contract-self-test"], {
    cwd: process.cwd()
  });
  const result = JSON.parse(stdout) as {
    ok: boolean;
    waitedForLateProcessWrite: boolean;
    undeliveredQuitRejected: boolean;
    hungQuitRejectedWithinMs: number;
    spawnEaccesRejected: boolean;
    lifecycleCases: Array<{
      failAfter: string | null;
      failure: string | null;
      status: string;
      restored: boolean;
      monitorStopped: boolean;
      evidenceWritten: boolean;
    }>;
    neverSettlingCases: Array<{
      failure: string;
      status: string;
      restored: boolean;
      monitorStopped: boolean;
      evidenceWritten: boolean;
      elapsedMs: number;
    }>;
    delayedCancellation: {
      delayedWrite: { restored: boolean; lateMutations: number };
      delayedLaunch: { restored: boolean; lateLaunches: number };
      ignoredCancellation: { restored: boolean; quiescenceReason: string };
    };
    cleanupStarvation: { restored: boolean; evidenceWritten: boolean; tempCleaned: boolean };
    providerPollRejection: {
      ok: boolean;
      status: string;
      restored: boolean;
      evidenceWritten: boolean;
      tempCleaned: boolean;
    };
    runCommandKilledDelayedWrite: boolean;
    realScenarioRelaunch: { launchPids: number[]; actions: string[]; serialized: boolean };
    providerMonitorTransitionPids: number[];
    providerProcesses: Array<{
      pid: number;
      ppid: number;
      executable: string;
      fullCommand: string;
      provider: string;
      relation: string;
    }>;
  };
  assert.equal(result.ok, true);
  assert.equal(result.waitedForLateProcessWrite, true);
  assert.equal(result.undeliveredQuitRejected, true);
  assert.equal(result.spawnEaccesRejected, true);
  assert.ok(result.hungQuitRejectedWithinMs < 500);
  assert.equal(result.lifecycleCases.length, 9);
  assert.deepEqual(result.lifecycleCases.map((entry) => entry.failAfter), [
    null,
    "install",
    "fixture",
    "first-launch",
    "migration",
    "placeholders",
    "relaunch",
    null,
    null
  ]);
  assert.equal(result.lifecycleCases[0]?.status, "passed");
  for (const entry of result.lifecycleCases.slice(1)) {
    assert.equal(entry.status, "failed");
    assert.equal(entry.restored, true);
    assert.equal(entry.monitorStopped, true);
    assert.equal(entry.evidenceWritten, true);
  }
  assert.deepEqual(result.neverSettlingCases.map((entry) => entry.failure), [
    "never-stage",
    "never-closeCdp",
    "never-listProcesses",
    "never-isCdpOpen",
    "never-monitorStop"
  ]);
  for (const entry of result.neverSettlingCases) {
    assert.equal(entry.status, "failed");
    assert.equal(entry.monitorStopped, true);
    assert.equal(entry.evidenceWritten, true);
    assert.ok(entry.elapsedMs < 500);
  }
  assert.deepEqual(result.neverSettlingCases.map((entry) => entry.restored), [false, false, false, false, true]);
  assert.equal(result.delayedCancellation.delayedWrite.restored, true);
  assert.equal(result.delayedCancellation.delayedWrite.lateMutations, 0);
  assert.equal(result.delayedCancellation.delayedLaunch.restored, true);
  assert.equal(result.delayedCancellation.delayedLaunch.lateLaunches, 0);
  assert.equal(result.delayedCancellation.ignoredCancellation.restored, false);
  assert.match(result.delayedCancellation.ignoredCancellation.quiescenceReason, /did not quiesce/);
  assert.equal(result.cleanupStarvation.restored, true);
  assert.equal(result.cleanupStarvation.evidenceWritten, true);
  assert.equal(result.cleanupStarvation.tempCleaned, true);
  assert.equal(result.providerPollRejection.ok, true);
  assert.equal(result.providerPollRejection.status, "failed");
  assert.equal(result.providerPollRejection.restored, true);
  assert.equal(result.providerPollRejection.evidenceWritten, true);
  assert.equal(result.providerPollRejection.tempCleaned, true);
  assert.equal(result.runCommandKilledDelayedWrite, true);
  assert.deepEqual(result.realScenarioRelaunch, {
    launchPids: [701, 702],
    actions: ["controlled-relaunch"],
    serialized: true
  });
  assert.deepEqual(result.providerMonitorTransitionPids, [501, 502, 503, 504, 505]);
  assert.deepEqual(result.providerProcesses.map((entry) => `${entry.pid}:${entry.provider}:${entry.relation}`), [
    "301:claude-code:direct",
    "302:claude-code:direct",
    "303:codex:direct",
    "305:codex:direct",
    "306:claude-code:direct",
    "307:codex:direct",
    "308:claude-code:direct",
    "309:codex:direct",
    "310:claude-code:direct",
    "311:codex:direct",
    "312:codex:direct",
    "313:codex:direct",
    "314:codex:direct",
    "315:codex:direct",
    "316:codex:direct",
    "317:codex:direct",
    "318:codex:direct",
    "319:codex:direct",
    "320:claude-code:direct",
    "321:codex:direct",
    "322:codex:direct",
    "323:codex:direct",
    "324:codex:direct",
    "325:claude-code:direct",
    "304:codex:descendant"
  ]);
  for (const entry of result.providerProcesses) {
    assert.equal(typeof entry.ppid, "number");
    assert.equal(typeof entry.executable, "string");
    assert.equal(typeof entry.fullCommand, "string");
  }
});

async function createTempRoot(t: TestContext, prefix: string): Promise<string> {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  return temp;
}

function createEmptySchemaTwo() {
  return {
    schemaVersion: 2,
    viewport: { x: 80, y: 72, zoom: 1 },
    projects: [],
    nodes: [],
    edges: [],
    console: { provider: "codex" }
  };
}
