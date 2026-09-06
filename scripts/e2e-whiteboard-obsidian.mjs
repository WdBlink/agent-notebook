import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { tsImport } from "tsx/esm/api";
import { runWhiteboardLifecycle, WHITEBOARD_FAILURE_STAGES } from "./whiteboard-lifecycle.mjs";

const execFileAsync = promisify(execFile);
const { normalizeGlobalBoardDocument, validateSchemaTwoDocument } = await tsImport("../src/whiteboard-model.ts", import.meta.url);
const pluginId = "agent-notebook";
const args = process.argv.slice(2);
const trackedChildren = new Set();
let failAfter;

function abortMessage(signal, fallback = "Operation aborted") {
  return signal?.reason instanceof Error ? signal.reason : new Error(String(signal?.reason ?? fallback));
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortMessage(signal);
}

function abortableSleep(milliseconds, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, Math.max(0, milliseconds));
    const onAbort = () => finish(abortMessage(signal));
    function finish(error) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error instanceof Error) reject(error);
      else resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function runAbortableOperation(operation, timeoutMs, label, parentSignal) {
  throwIfAborted(parentSignal);
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(abortMessage(parentSignal));
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error(`${label} timed out`)),
    Math.max(1, timeoutMs)
  );
  const outcome = Promise.resolve()
    .then(() => operation(controller.signal))
    .then(
      (value) => ({ status: "fulfilled", value }),
      (error) => ({ status: "rejected", error })
    );
  const aborted = new Promise((resolve) => {
    if (controller.signal.aborted) resolve(true);
    else controller.signal.addEventListener("abort", () => resolve(true), { once: true });
  });
  try {
    const first = await Promise.race([outcome, aborted]);
    if (first !== true) {
      if (first.status === "rejected") throw first.error;
      return first.value;
    }
    const settled = await Promise.race([
      outcome,
      abortableSleep(250).then(() => ({ status: "not-quiescent" }))
    ]);
    if (settled.status === "not-quiescent") {
      const error = new Error(`${label} aborted but did not quiesce`);
      error.unsafeMutation = true;
      throw error;
    }
    if (settled.status === "rejected" && !controller.signal.aborted) throw settled.error;
    throw abortMessage(controller.signal, `${label} aborted`);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onParentAbort);
  }
}

if (isMainModule()) {
if (args.includes("--contract-self-test")) {
  await runLifecycleContractSelfTest();
} else if (args.includes("--provider-monitor-rejection-probe")) {
  process.stdout.write(`${JSON.stringify(await runProviderMonitorRejectionProbe())}\n`);
} else {
const vault = resolveVault(args);
const port = Number(readArg(args, "--port") ?? "9222");
const obsidianBin = readArg(args, "--obsidian-bin")
  ?? "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
failAfter = readArg(args, "--fail-after");
const evidencePath = path.resolve(
  readArg(args, "--evidence")
    ?? path.join("test-results", `obsidian-whiteboard-evidence-${Date.now()}.json`)
);
const pluginDir = path.join(vault, ".obsidian", "plugins", pluginId);
const pluginDataPath = path.join(pluginDir, "data.json");
const communityConfigPath = path.join(vault, ".obsidian", "community-plugins.json");
const managedPaths = [
  path.join(pluginDir, "main.js"),
  path.join(pluginDir, "styles.css"),
  path.join(pluginDir, "manifest.json"),
  pluginDataPath,
  `${pluginDataPath}.pre-agent-sessions.bak`,
  communityConfigPath,
  `${communityConfigPath}.bak`
];
const transcriptRoots = [
  path.join(os.homedir(), ".codex", "sessions"),
  path.join(os.homedir(), ".codex", "archived_sessions"),
  path.join(os.homedir(), ".claude", "projects")
];

let browser;
let tempRoot;
let currentStageSignal;
const activeLaunchPids = new Set();
let providerBaseline = [];
const evidence = {
  vault,
  port,
  obsidianBin,
  launches: [],
  shutdowns: [],
  actions: []
};

const scenario = (async function* () {
  await runCommand("npm", ["run", "build"], { timeoutMs: 120000, signal: currentStageSignal });
  throwIfAborted(currentStageSignal);
  await runCommand("node", ["scripts/install-local.mjs", "--vault", vault], { timeoutMs: 120000, signal: currentStageSignal });
  throwIfAborted(currentStageSignal);
  yield "install";

  throwIfAborted(currentStageSignal);
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-notebook-whiteboard-"));
  const alphaRoot = path.join(tempRoot, "alpha");
  const betaRoot = path.join(tempRoot, "beta");
  const gammaRoot = path.join(tempRoot, "gamma");
  const deltaRoot = path.join(tempRoot, "delta");
  const gammaAlias = path.join(tempRoot, "gamma-alias");
  const unreadableRoot = path.join(tempRoot, "unreadable");
  const nonDirectoryPath = path.join(tempRoot, "not-a-directory.txt");
  await Promise.all([
    fs.mkdir(alphaRoot),
    fs.mkdir(betaRoot),
    fs.mkdir(gammaRoot),
    fs.mkdir(deltaRoot),
    fs.mkdir(unreadableRoot),
    fs.writeFile(nonDirectoryPath, "not a directory")
  ]);
  throwIfAborted(currentStageSignal);
  await fs.symlink(gammaRoot, gammaAlias);
  const installedData = JSON.parse(await fs.readFile(pluginDataPath, "utf8"));
  const fixture = {
    ...installedData,
    schemaVersion: 4,
    whiteboard: schemaOneFixture(alphaRoot, betaRoot)
  };
  await writeJsonAtomic(pluginDataPath, fixture, currentStageSignal);
  throwIfAborted(currentStageSignal);
  evidence.actions.push({
    action: "schema-one-fixture",
    hash: await fileHash(pluginDataPath, currentStageSignal),
    at: new Date().toISOString()
  });
  yield "fixture";

  const firstLaunch = await launchObsidian(obsidianBin, vault, port, 60000, currentStageSignal);
  evidence.launches.push(firstLaunch);
  activeLaunchPids.add(firstLaunch.pid);
  ({ browser } = await connectToObsidian(port, vault, currentStageSignal));
  const page = await currentObsidianPage(browser, vault, currentStageSignal);
  await waitForPlugin(page, currentStageSignal);
  throwIfAborted(currentStageSignal);
  yield "first-launch";

  const migrated = validateSchemaTwoDocument(await readPluginWhiteboard(page));
  throwIfAborted(currentStageSignal);
  assertMigratedDocument(migrated, alphaRoot, betaRoot);
  evidence.actions.push({ action: "migration", document: documentEvidence(migrated), at: new Date().toISOString() });
  yield "migration";

  await openWhiteboardFromRibbon(page);
  throwIfAborted(currentStageSignal);
  await page.locator(".react-flow__node-frame").first().waitFor({ state: "visible", timeout: 30000 });
  if (await page.locator(".react-flow__node-frame").count() !== 2) throw new Error("Expected two global project frames");

  await addProjectThroughModal(page, gammaRoot, "Gamma");
  throwIfAborted(currentStageSignal);
  await addProjectThroughModal(page, deltaRoot, "Delta");
  if (await page.locator(".react-flow__node-frame").count() !== 4) throw new Error("Two modal registrations did not create two frames");
  await expectProjectRegistrationError(page, gammaAlias, "Gamma alias");
  throwIfAborted(currentStageSignal);
  await expectProjectRegistrationError(page, nonDirectoryPath, "Not a directory");
  await fs.chmod(unreadableRoot, 0o000);
  try {
    await expectProjectRegistrationError(page, unreadableRoot, "Unreadable");
  } finally {
    await fs.chmod(unreadableRoot, 0o700);
  }
  await cancelProjectRegistration(page, deltaRoot, "Cancelled");
  throwIfAborted(currentStageSignal);
  if (await page.locator(".react-flow__node-frame").count() !== 4) throw new Error("Duplicate, invalid, unreadable, or cancelled registration changed frame count");
  for (const name of ["Gamma", "Delta"]) {
    page.once("dialog", (dialog) => dialog.accept());
    const temporaryFrame = page.locator(".react-flow__node-frame").filter({ hasText: name });
    await temporaryFrame.focus();
    await page.keyboard.press("Delete");
  }
  await waitForWhiteboardSaved(page);
  throwIfAborted(currentStageSignal);
  if (await page.locator(".react-flow__node-frame").count() !== 2) throw new Error("Visible project removal did not restore two migrated frames");
  await page.getByRole("button", { name: "Fit View" }).click();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const fitted = validateSchemaTwoDocument(await readPluginWhiteboard(page));
    if (fitted.viewport.zoom > 0.5) break;
    await page.getByRole("button", { name: "Zoom In" }).click();
    await page.waitForTimeout(180);
    throwIfAborted(currentStageSignal);
  }
  await waitForWhiteboardSaved(page);
  throwIfAborted(currentStageSignal);
  evidence.actions.push({
    action: "project-modal-registration",
    validRoots: [gammaRoot, deltaRoot],
    duplicateRoot: gammaAlias,
    rejectedRoots: [nonDirectoryPath, unreadableRoot],
    cancelled: true,
    removed: true,
    at: new Date().toISOString()
  });

  const alphaBody = page.locator('[data-id="project-alpha"] .agent-whiteboard-frame-body');
  await rightClickEmptyFrame(page, alphaBody);
  await page.getByRole("menuitem", { name: "新建终端" }).click();
  await rightClickEmptyFrame(page, alphaBody);
  await page.getByRole("menuitem", { name: "新建 Codex 会话" }).click();
  await waitForWhiteboardSaved(page);
  throwIfAborted(currentStageSignal);
  const afterPlaceholders = validateSchemaTwoDocument(await readPluginWhiteboard(page));
  const terminal = afterPlaceholders.nodes.find((node) => node.kind === "terminal" && node.projectId === "project-alpha");
  const codex = afterPlaceholders.nodes.find((node) => node.kind === "agent" && node.provider === "codex" && node.projectId === "project-alpha" && node.id !== "agent-alpha");
  if (!terminal || !codex || terminal.workingDirectory !== alphaRoot || codex.workingDirectory !== alphaRoot) {
    throw new Error("Current runtime controls did not create project-scoped terminal and Codex nodes");
  }
  const terminalNode = page.locator(`.react-flow__node[data-id="${terminal.id}"]`);
  const codexNode = page.locator(`.react-flow__node[data-id="${codex.id}"]`);
  await terminalNode.getByText("运行中", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await codexNode.getByText("运行中", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await typeInRuntimeNode(page, terminalNode, "pwd");
  await waitForRuntimeText(terminalNode, alphaRoot, 10000);
  const codexMarker = `OPC_RUNTIME_MARKER_${Date.now()}`;
  await typeInRuntimeNode(page, codexNode, `Reply with exactly ${codexMarker}`);
  await waitForRuntimeText(codexNode, codexMarker, 60000);
  const runtimeScreenshot = `${evidencePath}.runtime.png`;
  await fs.mkdir(path.dirname(runtimeScreenshot), { recursive: true });
  await page.locator(".agent-whiteboard-canvas").screenshot({ path: runtimeScreenshot });
  evidence.actions.push({
    action: "live-terminal-and-codex",
    terminalId: terminal.id,
    codexId: codex.id,
    cwd: alphaRoot,
    marker: codexMarker,
    screenshot: runtimeScreenshot,
    at: new Date().toISOString()
  });
  const runtimeAudit = await captureRuntimeMembership(pluginDir, currentStageSignal);
  for (const runtimeNode of [terminalNode, codexNode]) {
    await runtimeNode.focus();
    await page.keyboard.press("Delete");
  }
  await waitForWhiteboardSaved(page);
  await assertNoRuntimeDescendants(pluginDir, runtimeAudit, currentStageSignal);
  evidence.actions.push({ action: "live-runtime-deletion-cleanup", terminalId: terminal.id, codexId: codex.id, at: new Date().toISOString() });
  yield "placeholders";

  const beforeFrame = structuredClone(afterPlaceholders.projects.find((frame) => frame.id === "project-alpha"));
  const beforeNodes = afterPlaceholders.nodes.filter((node) => node.projectId === "project-alpha").map((node) => structuredClone(node));
  const header = page.locator('[data-id="project-alpha"] .agent-whiteboard-frame-header');
  const headerBox = await header.boundingBox();
  if (!headerBox || !beforeFrame) throw new Error("Alpha frame is not visible for drag verification");
  const interactionZoom = afterPlaceholders.viewport.zoom;
  await page.mouse.move(headerBox.x + Math.min(260, headerBox.width / 2), headerBox.y + headerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    headerBox.x + Math.min(260, headerBox.width / 2) + 180 * interactionZoom,
    headerBox.y + headerBox.height / 2 + 120 * interactionZoom,
    { steps: 12 }
  );
  await page.mouse.up();
  await waitForWhiteboardSaved(page);
  throwIfAborted(currentStageSignal);
  const moved = validateSchemaTwoDocument(await readPluginWhiteboard(page));
  const movedFrame = moved.projects.find((frame) => frame.id === "project-alpha");
  if (!movedFrame) throw new Error("Moved frame is missing");
  const delta = { x: movedFrame.position.x - beforeFrame.position.x, y: movedFrame.position.y - beforeFrame.position.y };
  assertClose(delta.x, 180, 4, "frame x delta");
  assertClose(delta.y, 120, 4, "frame y delta");
  for (const beforeNode of beforeNodes) {
    const afterNode = moved.nodes.find((node) => node.id === beforeNode.id);
    if (!afterNode) throw new Error(`Moved node is missing: ${beforeNode.id}`);
    assertClose(afterNode.position.x - beforeNode.position.x, delta.x, 4, `${beforeNode.id} x delta`);
    assertClose(afterNode.position.y - beforeNode.position.y, delta.y, 4, `${beforeNode.id} y delta`);
  }
  evidence.actions.push({ action: "frame-drag", delta, at: new Date().toISOString() });

  const zoomOut = page.getByRole("button", { name: "Zoom Out" });
  for (let attempt = 0; attempt < 8 && await page.locator(".agent-whiteboard-frame-summary").count() === 0; attempt += 1) {
    await zoomOut.click();
    await page.waitForTimeout(180);
    throwIfAborted(currentStageSignal);
  }
  await page.locator(".agent-whiteboard-frame-summary").first().waitFor({ state: "visible", timeout: 10000 });
  await waitForWhiteboardSaved(page);
  throwIfAborted(currentStageSignal);
  const beforeRelaunch = validateSchemaTwoDocument(await readPluginWhiteboard(page));
  if (beforeRelaunch.viewport.zoom > 0.5) throw new Error(`Visible zoom control did not reach semantic zoom: ${beforeRelaunch.viewport.zoom}`);
  const summaryText = await page.locator(".agent-whiteboard-frame-summary").allTextContents();
  evidence.actions.push({
    action: "visible-semantic-zoom",
    summaryText,
    dataFileHash: await fileHash(pluginDataPath, currentStageSignal),
    document: documentEvidence(beforeRelaunch),
    at: new Date().toISOString()
  });

  const relaunch = await executeControlledRelaunch({
    evidence,
    activeLaunchPids,
    expectedDocument: beforeRelaunch,
    expectedFrame: movedFrame,
    frameId: "project-alpha",
    timeoutMs: 120000,
    signal: currentStageSignal
  }, {
    async closeCdp(_timeoutMs, signal) {
      throwIfAborted(signal);
      await browser.close().catch(() => undefined);
      browser = undefined;
    },
    shutdown: (timeoutMs, signal) => quitObsidian(port, activeLaunchPids, "before-relaunch", timeoutMs, signal),
    launch: (timeoutMs, signal) => launchObsidian(obsidianBin, vault, port, timeoutMs, signal),
    async connectAndReadDocument(_launch, _timeoutMs, signal) {
      const connected = await connectToObsidian(port, vault, signal);
      const onAbort = () => void connected.browser.close().catch(() => undefined);
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        const relaunchedPage = await currentObsidianPage(connected.browser, vault, signal);
        await waitForPlugin(relaunchedPage, signal);
        throwIfAborted(signal);
        await openWhiteboardFromRibbon(relaunchedPage);
        throwIfAborted(signal);
        return { browser: connected.browser, document: await readPluginWhiteboard(relaunchedPage) };
      } catch (error) {
        await connected.browser.close().catch(() => undefined);
        throw error;
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    },
    async readPersistedWhiteboard(_timeoutMs, signal) {
      throwIfAborted(signal);
      return JSON.parse(await fs.readFile(pluginDataPath, "utf8")).whiteboard;
    },
    dataFileHash: (_timeoutMs, signal) => fileHash(pluginDataPath, signal),
    now: () => Date.now()
  });
  browser = relaunch.browser;
  yield "relaunch";
})();

const lifecycle = await runWhiteboardLifecycle({ failAfter, restoreStabilityMs: 1000 }, {
  now: () => Date.now(),
  sleep: abortableSleep,
  async shutdown(label, timeoutMs, signal) {
    const result = await quitObsidian(port, activeLaunchPids, label, timeoutMs, signal);
    evidence.shutdowns.push(result);
    return result;
  },
  snapshotManaged: (_timeoutMs, signal) => snapshotFiles(managedPaths, signal),
  publicSnapshot,
  hashTranscripts: (_timeoutMs, signal) => hashTrees(transcriptRoots, signal),
  providerProcesses,
  async preflightRuntimeProcesses(timeoutMs, signal) {
    const processes = await systemProcesses(timeoutMs, signal);
    const tree = obsidianProcessTree(processes, activeLaunchPids);
    const treePids = new Set(tree.map((entry) => entry.pid));
    const providers = new Set(detectProviderProcesses(processes).map((entry) => entry.pid));
    return tree.filter((entry) => (
      entry.fullCommand.includes(path.join(pluginDir, "runtime"))
      || (treePids.has(entry.pid) && providers.has(entry.pid))
    ));
  },
  startProviderMonitor(baseline) {
    providerBaseline = baseline;
    return startProviderMonitor(baseline);
  },
  async runStage(stage, _timeoutMs, signal) {
    currentStageSignal = signal;
    const abortResources = () => {
      void Promise.allSettled([
        browser?.close(),
        terminateTrackedChildren(),
        terminatePidGroups(activeLaunchPids)
      ]);
    };
    signal.addEventListener("abort", abortResources, { once: true });
    try {
      throwIfAborted(signal);
      const result = await scenario.next();
      throwIfAborted(signal);
      if (result.done || result.value !== stage) {
        throw new Error(`Real scenario stage mismatch: expected ${stage}, received ${String(result.value)}`);
      }
    } finally {
      signal.removeEventListener("abort", abortResources);
      currentStageSignal = undefined;
    }
  },
  async closeCdp(_timeoutMs, signal) {
    throwIfAborted(signal);
    await browser?.close();
    browser = undefined;
  },
  assertTranscriptEquality(before, after) {
    assertDisposableCodexTranscriptDelta(before, after);
  },
  async assertProviderEquality(before, after, observed) {
    await assertNoNewProviderProcesses(before, after);
    const beforePids = new Set(before.map((entry) => entry.pid));
    const launched = observed.filter((entry) => !beforePids.has(entry.pid));
    if (!launched.some((entry) => entry.provider === "codex") || launched.some((entry) => entry.provider !== "codex")) {
      throw new Error(`Expected one disposable Codex process family and no other provider: ${JSON.stringify(launched)}`);
    }
  },
  restoreManaged: (snapshot, _timeoutMs, signal) => restoreFiles(snapshot, signal),
  assertManaged: assertSnapshotEqual,
  async cleanupTemp(_timeoutMs, signal) {
    throwIfAborted(signal);
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  },
  async writeEvidence(lifecycleEvidence, _timeoutMs, signal) {
    throwIfAborted(signal);
    const completeEvidence = serializeWhiteboardEvidence(lifecycleEvidence, {
      vault,
      port,
      obsidianBin,
      launches: evidence.launches,
      shutdowns: evidence.shutdowns,
      actions: evidence.actions
    });
    await fs.mkdir(path.dirname(evidencePath), { recursive: true });
    throwIfAborted(signal);
    await fs.writeFile(evidencePath, `${JSON.stringify(completeEvidence, null, 2)}\n`);
  }
});

process.stdout.write(`${JSON.stringify({ ok: lifecycle.ok, evidencePath, status: lifecycle.evidence.status }, null, 2)}\n`);
if (lifecycle.error) throw lifecycle.error;
if (!lifecycle.ok) throw new Error(lifecycle.evidence.cleanupErrors.join("; ") || "Whiteboard lifecycle failed");
}
}

export async function executeControlledRelaunch(context, adapters) {
  const deadline = adapters.now() + (context.timeoutMs ?? 120000);
  const run = (label, operation, capMs = Number.POSITIVE_INFINITY) => {
    const timeoutMs = Math.max(0, Math.min(deadline - adapters.now(), capMs));
    if (timeoutMs <= 0) return Promise.reject(new Error(`${label} skipped: controlled relaunch deadline elapsed`));
    return runAbortableOperation(
      (signal) => operation(timeoutMs, signal),
      timeoutMs,
      label,
      context.signal
    );
  };
  await run("first-launch CDP close", (timeoutMs, signal) => adapters.closeCdp(timeoutMs, signal), 5000);
  const shutdown = await run(
    "first-launch process shutdown",
    (timeoutMs, signal) => adapters.shutdown(timeoutMs, signal),
    45000
  );
  context.evidence.shutdowns.push(shutdown);
  const secondLaunch = await run("second launch", (timeoutMs, signal) => adapters.launch(timeoutMs, signal), 60000);
  context.evidence.launches.push(secondLaunch);
  context.activeLaunchPids.add(secondLaunch.pid);
  const connected = await run(
    "second-launch document verification",
    (timeoutMs, signal) => adapters.connectAndReadDocument(secondLaunch, timeoutMs, signal),
    60000
  );
  const restored = validateSchemaTwoDocument(connected.document);
  const restoredFrame = restored.projects.find((frame) => frame.id === context.frameId);
  if (!restoredFrame) throw new Error(`Relaunched frame is missing: ${context.frameId}`);
  assertClose(restored.viewport.zoom, context.expectedDocument.viewport.zoom, 0.01, "restored zoom");
  assertClose(restoredFrame.position.x, context.expectedFrame.position.x, 4, "restored frame x");
  assertClose(restoredFrame.position.y, context.expectedFrame.position.y, 4, "restored frame y");
  if (objectHash(restored) !== objectHash(context.expectedDocument)) {
    throw new Error("Relaunch did not preserve the exact schema-two document");
  }
  validateSchemaTwoDocument(await run(
    "persisted whiteboard verification",
    (timeoutMs, signal) => adapters.readPersistedWhiteboard(timeoutMs, signal),
    10000
  ));
  context.evidence.actions.push({
    action: "controlled-relaunch",
    dataFileHash: await run(
      "persisted data hashing",
      (timeoutMs, signal) => adapters.dataFileHash(timeoutMs, signal),
      10000
    ),
    document: documentEvidence(restored),
    at: new Date(adapters.now()).toISOString()
  });
  return { browser: connected.browser, document: restored, secondLaunch };
}

export function serializeWhiteboardEvidence(lifecycleEvidence, scenarioEvidence) {
  return { ...lifecycleEvidence, ...scenarioEvidence };
}

function schemaOneFixture(projectAlphaRoot, projectBetaRoot) {
  return {
    projects: [
      { id: "project-alpha", name: "Alpha", rootPath: projectAlphaRoot },
      { id: "project-beta", name: "Beta", rootPath: projectBetaRoot }
    ],
    activeProjectId: "project-beta",
    boards: {
      "project-alpha": {
        schemaVersion: 1,
        projectId: "project-alpha",
        viewport: { x: 40, y: 20, zoom: 1.25 },
        nodes: [
          {
            id: "agent-alpha", kind: "agent", x: 100, y: 120, width: 520, height: 340, zIndex: 3,
            provider: "codex", workingDirectory: projectAlphaRoot, sessionIdVerified: false, runtimeState: "exited"
          },
          {
            id: "note-alpha", kind: "note", x: 680, y: 160, width: 320, height: 240, zIndex: 2,
            markdown: "# Alpha\n\n- keep bytes\n"
          },
          {
            id: "label-alpha", kind: "label", x: 80, y: 560, width: 560, height: 112, zIndex: 1,
            text: "Alpha lane", color: "#b13a32", fontSize: 56
          }
        ],
        edges: [{ id: "edge-alpha", source: "agent-alpha", target: "note-alpha" }]
      },
      "project-beta": {
        schemaVersion: 1,
        projectId: "project-beta",
        viewport: { x: -300, y: 90, zoom: 0.6 },
        nodes: [
          {
            id: "terminal-beta", kind: "terminal", x: -40, y: 60, width: 520, height: 320, zIndex: 1,
            workingDirectory: projectBetaRoot
          },
          {
            id: "agent-beta", kind: "agent", x: 560, y: 80, width: 520, height: 340, zIndex: 2,
            provider: "claude-code", workingDirectory: projectBetaRoot, sessionIdVerified: false, runtimeState: "exited"
          },
          {
            id: "note-beta", kind: "note", x: 560, y: 500, width: 320, height: 240, zIndex: 3,
            markdown: "# Beta\n\n```ts\nconst n = 2;\n```\n"
          }
        ],
        edges: [{ id: "edge-beta", source: "agent-beta", target: "note-beta" }]
      }
    }
  };
}

function assertMigratedDocument(document, projectAlphaRoot, projectBetaRoot) {
  if (document.projects.length !== 2 || document.nodes.length !== 6) throw new Error("Unexpected migrated document shape");
  if (document.projects[0]?.rootPath !== projectAlphaRoot || document.projects[1]?.rootPath !== projectBetaRoot) {
    throw new Error("Migrated project roots do not match temporary readable directories");
  }
  if (document.nodes.find((node) => node.id === "note-alpha")?.markdown !== "# Alpha\n\n- keep bytes\n") {
    throw new Error("Alpha note bytes changed during migration");
  }
  if (document.nodes.find((node) => node.id === "note-beta")?.markdown !== "# Beta\n\n```ts\nconst n = 2;\n```\n") {
    throw new Error("Beta note bytes changed during migration");
  }
}

async function readPluginWhiteboard(page) {
  return page.evaluate((id) => structuredClone(globalThis.app.plugins.plugins[id].data.whiteboard), pluginId);
}

async function waitForPlugin(page, signal) {
  throwIfAborted(signal);
  await page.waitForFunction((id) => Boolean(globalThis.app?.plugins?.plugins?.[id]), pluginId, { timeout: 60000 });
  throwIfAborted(signal);
}

async function openWhiteboardFromRibbon(page) {
  const ribbon = page.getByLabel("打开 Agent Whiteboard").first();
  await ribbon.waitFor({ state: "visible", timeout: 30000 });
  await ribbon.click();
  await page.getByText("Agent Whiteboard", { exact: true }).first().waitFor({ state: "visible", timeout: 30000 });
}

async function openProjectModal(page, rootPath, name) {
  await page.getByRole("button", { name: "添加项目" }).first().click();
  const modal = page.locator(".modal-container").last();
  await modal.waitFor({ state: "visible", timeout: 10000 });
  const inputs = modal.locator("input");
  await inputs.nth(0).fill(rootPath);
  await inputs.nth(1).fill(name);
  return modal;
}

async function addProjectThroughModal(page, rootPath, name) {
  const modal = await openProjectModal(page, rootPath, name);
  await modal.getByRole("button", { name: "添加项目", exact: true }).click();
  await modal.waitFor({ state: "detached", timeout: 30000 });
}

async function expectProjectRegistrationError(page, rootPath, name) {
  const modal = await openProjectModal(page, rootPath, name);
  await modal.getByRole("button", { name: "添加项目", exact: true }).click();
  await modal.getByRole("alert").waitFor({ state: "visible", timeout: 30000 });
  await modal.locator(".modal-close-button").click();
  await modal.waitFor({ state: "detached", timeout: 10000 });
}

async function cancelProjectRegistration(page, rootPath, name) {
  const modal = await openProjectModal(page, rootPath, name);
  await modal.locator(".modal-close-button").click();
  await modal.waitFor({ state: "detached", timeout: 10000 });
}

async function rightClickEmptyFrame(page, body) {
  const box = await body.boundingBox();
  if (!box) throw new Error("Frame body is not visible for context-menu verification");
  await page.mouse.click(box.x + box.width - 80, box.y + Math.min(120, box.height / 3), { button: "right" });
}

async function waitForWhiteboardSaved(page) {
  await page.getByRole("status").filter({ hasText: "已保存" }).waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(100);
}

async function typeInRuntimeNode(page, node, command) {
  const input = node.locator(".xterm-helper-textarea");
  await input.focus();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

async function waitForRuntimeText(node, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await node.locator(".xterm-accessibility-tree, .xterm-rows").allTextContents();
    if (text.join("\n").includes(expected)) return;
    await abortableSleep(200);
  }
  throw new Error(`Runtime node did not visibly render expected text: ${expected}`);
}

async function captureRuntimeMembership(pluginDirectory, signal) {
  throwIfAborted(signal);
  const runtimeRoot = path.join(pluginDirectory, "runtime");
  const pointer = JSON.parse(await fs.readFile(path.join(runtimeRoot, "active.json"), "utf8"));
  if (typeof pointer?.version !== "string" || !/^runtime-[a-f0-9]{24}$/.test(pointer.version)) {
    throw new Error("Runtime active pointer is invalid during process capture");
  }
  const runtimeDirectory = path.join(runtimeRoot, "versions", pointer.version);
  const helperPath = path.join(runtimeDirectory, "process-membership");
  const hostPath = path.join(runtimeDirectory, "pty-host.mjs");
  const processes = await systemProcesses(5_000, signal);
  const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
  const memberPids = await membershipPidsByKey(helperPath, "AGENT_NOTEBOOK_HOST_TOKEN", signal);
  const identities = memberPids.map((pid) => byPid.get(pid)).filter(Boolean);
  if (identities.length === 0 || !identities.some((entry) => entry.fullCommand.includes(hostPath))) {
    throw new Error("Live runtime membership capture did not include the companion host");
  }
  return { helperPath, hostPath, identities };
}

async function assertNoRuntimeDescendants(pluginDirectory, audit, signal) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const processes = await systemProcesses(5_000, signal);
    const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
    const capturedSurvivors = audit.identities.filter((identity) => {
      const current = byPid.get(identity.pid);
      return current && current.executable === identity.executable && current.fullCommand === identity.fullCommand;
    });
    const tokenMembers = await membershipPidsByKey(audit.helperPath, "AGENT_NOTEBOOK_HOST_TOKEN", signal);
    const hosts = processes.filter((entry) => entry.fullCommand.includes(audit.hostPath));
    if (capturedSurvivors.length === 0 && tokenMembers.length === 0 && hosts.length === 0) return;
    await abortableSleep(100, signal);
  }
  throw new Error(`Runtime membership remained after deleting live terminal/Codex nodes in ${pluginDirectory}`);
}

async function membershipPidsByKey(helperPath, key, signal) {
  throwIfAborted(signal);
  const { stdout } = await execFileAsync(helperPath, [], {
    env: { AGENT_NOTEBOOK_AUDIT_KEY: key, AGENT_NOTEBOOK_AUDIT_VALUE: "*" },
    timeout: 1_000,
    maxBuffer: 1024 * 1024,
    signal
  });
  return stdout.split("\n").filter(Boolean).map((line) => {
    if (!/^\d+$/.test(line)) throw new Error("Runtime membership helper returned invalid PID data");
    return Number(line);
  });
}

function assertDisposableCodexTranscriptDelta(before, after) {
  const beforeByPath = new Map(before.map((entry) => [entry.path, entry.hash]));
  const afterByPath = new Map(after.map((entry) => [entry.path, entry.hash]));
  for (const [entryPath, hash] of beforeByPath) {
    if (afterByPath.get(entryPath) !== hash) throw new Error(`Pre-existing provider transcript changed: ${entryPath}`);
  }
  const added = after.filter((entry) => !beforeByPath.has(entry.path));
  if (added.length === 0 || added.some((entry) => !entry.path.includes("/.codex/sessions:"))) {
    throw new Error(`Expected only a disposable Codex session addition: ${JSON.stringify(added)}`);
  }
}

function signalProcessGroup(pid, signalName) {
  if (!pid) return;
  try {
    if (process.platform === "win32") process.kill(pid, signalName);
    else process.kill(-pid, signalName);
  } catch (error) {
    if (error?.code !== "ESRCH") {
      try {
        process.kill(pid, signalName);
      } catch (fallbackError) {
        if (fallbackError?.code !== "ESRCH") throw fallbackError;
      }
    }
  }
}

async function terminatePidGroup(pid) {
  signalProcessGroup(pid, "SIGTERM");
  try {
    await waitForPid(pid, false, 1000);
  } catch {
    signalProcessGroup(pid, "SIGKILL");
    await waitForPid(pid, false, 3000).catch(() => undefined);
  }
}

async function terminatePidGroups(pids) {
  await Promise.allSettled([...pids].map((pid) => terminatePidGroup(pid)));
}

async function terminateChild(child) {
  if (!child?.pid) return;
  signalProcessGroup(child.pid, "SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    abortableSleep(1000)
  ]);
  if (child.exitCode === null && child.signalCode === null) signalProcessGroup(child.pid, "SIGKILL");
}

async function terminateTrackedChildren() {
  await Promise.allSettled([...trackedChildren].map((child) => terminateChild(child)));
}

async function launchObsidian(binary, vaultPath, debugPort, timeoutMs = 60000, signal) {
  throwIfAborted(signal);
  await fs.access(binary);
  throwIfAborted(signal);
  const child = spawn(binary, [`--remote-debugging-port=${debugPort}`], {
    detached: true,
    stdio: "ignore"
  });
  let pid;
  try {
    pid = await waitForSpawn(child, "Obsidian", signal);
    child.unref();
    await waitForPid(pid, true, Math.min(5000, timeoutMs), signal);
    await waitForCdp(debugPort, true, timeoutMs, signal);
    throwIfAborted(signal);
    await execFileAsync("open", [`obsidian://open?vault=${encodeURIComponent(path.basename(vaultPath))}`], {
      timeout: Math.max(1, Math.min(10000, timeoutMs)),
      killSignal: "SIGKILL",
      signal
    });
    await waitForPid(pid, true, Math.min(5000, timeoutMs), signal);
    return { pid, alive: true, at: new Date().toISOString() };
  } catch (error) {
    if (pid) await terminatePidGroup(pid);
    else await terminateChild(child);
    throw error;
  }
}

export function waitForSpawn(child, label = "process", signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      child.removeListener("spawn", onSpawn);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onSpawn = () => {
      if (!child.pid) {
        finish(reject, new Error(`${label} launch did not return a PID`));
        return;
      }
      finish(resolve, child.pid);
    };
    const onError = (error) => finish(reject, error);
    const onAbort = () => finish(reject, abortMessage(signal));
    const onExit = (code, signal) => finish(
      reject,
      new Error(`${label} exited before launch completed (code=${code}, signal=${signal})`)
    );
    child.once("spawn", onSpawn);
    child.once("error", onError);
    child.once("exit", onExit);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function quitObsidian(debugPort, knownLaunchPids, label, timeoutMs = 30000, signal) {
  const shutdown = await shutdownObsidianLifecycle({
    debugPort,
    knownLaunchPids: [...knownLaunchPids],
    timeoutMs: Math.max(1, Math.min(30000, timeoutMs)),
    stabilityMs: 750,
    label,
    signal
  }, {
    now: () => Date.now(),
    sleep: abortableSleep,
    listProcesses: systemProcesses,
    isCdpOpen: (probeTimeoutMs, probeSignal) => cdpAvailable(debugPort, probeTimeoutMs, probeSignal),
    async deliverQuit(timeoutMs, quitSignal) {
      await execFileAsync("osascript", ["-e", 'tell application "Obsidian" to quit'], {
        timeout: Math.max(1, timeoutMs),
        killSignal: "SIGKILL",
        signal: quitSignal
      });
      return true;
    }
  });
  for (const pid of shutdown.exitedLaunchPids) knownLaunchPids.delete(pid);
  return shutdown;
}

export async function shutdownObsidianLifecycle(options, adapters) {
  const startedAt = adapters.now();
  const deadline = startedAt + options.timeoutMs;
  const runOperation = (label, operation, capMs = Number.POSITIVE_INFINITY) => {
    const timeoutMs = Math.max(0, Math.min(deadline - adapters.now(), capMs));
    if (timeoutMs <= 0) return Promise.reject(new Error(`${label} skipped: Obsidian lifecycle deadline elapsed`));
    return runAbortableOperation(
      (signal) => operation(timeoutMs, signal),
      timeoutMs,
      label,
      options.signal
    );
  };
  const probe = () => Promise.all([
    runOperation("Obsidian CDP probe", (timeoutMs, signal) => adapters.isCdpOpen(timeoutMs, signal)),
    runOperation("Obsidian process list", (timeoutMs, signal) => adapters.listProcesses(timeoutMs, signal))
  ]);
  const before = await runOperation(
    "initial Obsidian process list",
    (timeoutMs, signal) => adapters.listProcesses(timeoutMs, signal)
  );
  const initialTargets = obsidianProcessTree(before, options.knownLaunchPids);
  const targetPids = new Set([...initialTargets.map((entry) => entry.pid), ...options.knownLaunchPids]);
  const cdpInitiallyOpen = await runOperation(
    "initial Obsidian CDP probe",
    (timeoutMs, signal) => adapters.isCdpOpen(timeoutMs, signal)
  );
  let quitDelivered = false;
  if (targetPids.size > 0 || cdpInitiallyOpen) {
    const remainingMs = deadline - adapters.now();
    if (remainingMs <= 0) throw new Error("Obsidian lifecycle deadline elapsed before quit delivery");
    quitDelivered = await runOperation(
      "Obsidian quit delivery",
      (timeoutMs, signal) => adapters.deliverQuit(timeoutMs, signal)
    );
    if (!quitDelivered) throw new Error("Obsidian quit request was not delivered");
  }

  let lastProcesses = before;
  while (adapters.now() < deadline) {
    const [cdpOpen, processes] = await probe();
    lastProcesses = processes;
    const liveTargets = liveObsidianTargets(processes, targetPids, options.knownLaunchPids);
    if (!cdpOpen && liveTargets.length === 0) {
      if (deadline - adapters.now() < options.stabilityMs) break;
      await runOperation(
        "Obsidian stability wait",
        (_timeoutMs, signal) => adapters.sleep(options.stabilityMs, signal),
        options.stabilityMs + 1000
      );
      const [stableCdpOpen, stableProcesses] = await probe();
      const stableTargets = liveObsidianTargets(stableProcesses, targetPids, options.knownLaunchPids);
      if (!stableCdpOpen && stableTargets.length === 0) {
        return {
          label: options.label,
          quitDelivered,
          cdpInitiallyOpen,
          targetProcesses: initialTargets,
          exitedLaunchPids: options.knownLaunchPids,
          processTreeExited: true,
          stableForMs: options.stabilityMs,
          startedAt: new Date(startedAt).toISOString(),
          finishedAt: new Date(adapters.now()).toISOString()
        };
      }
      lastProcesses = stableProcesses;
    }
    await runOperation(
      "Obsidian shutdown poll wait",
      (_timeoutMs, signal) => adapters.sleep(Math.min(100, deadline - adapters.now()), signal),
      1100
    );
  }
  throw new Error(`Obsidian process tree did not exit: ${JSON.stringify(liveObsidianTargets(
    lastProcesses,
    targetPids,
    options.knownLaunchPids
  ))}`);
}

export async function restoreAfterObsidianShutdown(options, adapters) {
  const shutdown = await shutdownObsidianLifecycle(options.shutdown, adapters);
  const deadline = adapters.now() + (options.restoreTimeoutMs ?? Math.max(30000, options.restoreStabilityMs + 5000));
  const run = (label, operation, capMs = Number.POSITIVE_INFINITY) => {
    const timeoutMs = Math.max(0, Math.min(deadline - adapters.now(), capMs));
    if (timeoutMs <= 0) return Promise.reject(new Error(`${label} skipped: restoration deadline elapsed`));
    return runAbortableOperation(
      (signal) => operation(timeoutMs, signal),
      timeoutMs,
      label,
      options.signal
    );
  };
  await run("managed restoration", (timeoutMs, signal) => adapters.restore(timeoutMs, signal), 15000);
  const restored = await run("restored snapshot", (timeoutMs, signal) => adapters.snapshot(timeoutMs, signal), 5000);
  adapters.assertSnapshot(options.expectedSnapshot, restored);
  await run(
    "restoration stability wait",
    (_timeoutMs, signal) => adapters.sleep(options.restoreStabilityMs, signal),
    options.restoreStabilityMs + 1000
  );
  const stable = await run("stable restored snapshot", (timeoutMs, signal) => adapters.snapshot(timeoutMs, signal), 5000);
  adapters.assertSnapshot(options.expectedSnapshot, stable);
  return { shutdown, restored: stable, stableForMs: options.restoreStabilityMs };
}

async function connectToObsidian(debugPort, vaultPath, signal) {
  throwIfAborted(signal);
  const { chromium } = await importPlaywright();
  throwIfAborted(signal);
  const connected = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const onAbort = () => void connected.close().catch(() => undefined);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await currentObsidianPage(connected, vaultPath, signal);
  } catch (error) {
    await connected.close().catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  return { browser: connected };
}

async function currentObsidianPage(connectedBrowser, vaultPath, signal) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    throwIfAborted(signal);
    for (const candidate of connectedBrowser.contexts().flatMap((context) => context.pages())) {
      if (!candidate.url().startsWith("app://") && !candidate.url().includes("obsidian")) continue;
      const basePath = await candidate.evaluate(() => globalThis.app?.vault?.adapter?.basePath ?? "").catch(() => "");
      if (path.resolve(basePath) === vaultPath) return candidate;
    }
    await abortableSleep(500, signal);
  }
  throw new Error(`Could not find the requested Obsidian vault over CDP: ${vaultPath}`);
}

async function waitForCdp(debugPort, expectedOpen, timeout, signal) {
  const endpoint = `http://127.0.0.1:${debugPort}/json/version`;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    const available = await cdpAvailable(debugPort, Math.min(1000, deadline - Date.now()), signal);
    if (available === expectedOpen) return;
    await abortableSleep(300, signal);
  }
  throw new Error(`Obsidian CDP did not become ${expectedOpen ? "available" : "closed"} at ${endpoint}`);
}

async function cdpAvailable(debugPort, timeoutMs = 1000, signal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(abortMessage(signal));
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(1000, timeoutMs)));
  try {
    return await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: controller.signal })
      .then((response) => response.ok)
      .catch(() => false);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function waitForPid(pid, expectedAlive, timeout, signal) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (error) {
      alive = error?.code === "EPERM";
    }
    if (alive === expectedAlive) return;
    await abortableSleep(100, signal);
  }
  throw new Error(`PID ${pid} did not become ${expectedAlive ? "alive" : "dead"}`);
}

async function providerProcesses(timeoutMs, signal) {
  return detectProviderProcesses(await systemProcesses(timeoutMs, signal));
}

async function systemProcesses(timeoutMs = 5000, signal) {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,command="], {
    timeout: Math.max(1, Math.min(5000, timeoutMs)),
    killSignal: "SIGKILL",
    signal
  });
  return parseProcessTable(stdout);
}

export function parseProcessTable(stdout) {
  return stdout.split("\n").map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) return [];
    const fullCommand = match[3];
    return [{
      pid: Number(match[1]),
      ppid: Number(match[2]),
      executable: commandExecutable(fullCommand),
      fullCommand
    }];
  });
}

export function detectProviderProcesses(processes) {
  const detected = new Map();
  for (const entry of processes) {
    const provider = directProvider(entry);
    if (provider) detected.set(entry.pid, { ...entry, provider, relation: "direct" });
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of processes) {
      if (detected.has(entry.pid)) continue;
      const parent = detected.get(entry.ppid);
      if (!parent) continue;
      detected.set(entry.pid, { ...entry, provider: parent.provider, relation: "descendant" });
      changed = true;
    }
  }
  return [...detected.values()];
}

function directProvider(entry) {
  const basename = path.basename(entry.executable).toLowerCase();
  if (/^codex(?:-[a-z0-9._-]+)?$/.test(basename)) return "codex";
  if (/^(?:claude|claude-code)(?:-[a-z0-9._-]+)?$/.test(basename)) return "claude-code";
  return providerFromCommand(entry.fullCommand);
}

function providerFromCommand(fullCommand) {
  const tokens = shellTokens(fullCommand);
  return providerFromTokens(tokens, 0);
}

function providerFromTokens(tokens, depth) {
  if (depth > 4 || tokens.length === 0) return null;
  const executableIndex = nextExecutableIndex(tokens, 0);
  if (executableIndex >= tokens.length) return null;
  const executable = path.basename(tokens[executableIndex]).toLowerCase();
  const direct = providerFromBasename(executable);
  if (direct) return direct;

  if (/^(?:node|nodejs)$/.test(executable)) {
    const script = nodeScriptToken(tokens.slice(executableIndex + 1));
    if (!script) return null;
    const normalized = script.toLowerCase().replace(/\\/g, "/");
    if (normalized.includes("@anthropic-ai/claude-code") || providerFromBasename(path.basename(normalized)) === "claude-code") {
      return "claude-code";
    }
    if (
      /(?:^|\/)node_modules\/@openai\/codex\/bin\/codex\.js$/.test(normalized)
      || /(?:^|\/)@openai\/codex\/bin\/codex\.js$/.test(normalized)
      || providerFromBasename(path.basename(normalized)) === "codex"
    ) return "codex";
    return null;
  }

  if (/^(?:sh|bash|zsh|fish)$/.test(executable)) {
    const commandFlag = tokens.findIndex((token, index) => index > executableIndex && /^-[a-z]*c[a-z]*$/i.test(token));
    if (commandFlag < 0 || commandFlag + 1 >= tokens.length) return null;
    return providerFromTokens(shellTokens(tokens.slice(commandFlag + 1).join(" ")), depth + 1);
  }

  if (executable === "env") {
    const args = tokens.slice(executableIndex + 1);
    return providerFromTokens(envCommandTokens(args), depth + 1);
  }

  if (executable === "npx") {
    return providerFromTokens(npmExecCommandTokens(tokens.slice(executableIndex + 1)), depth + 1);
  }

  if (executable === "npm") {
    const args = npmExecArgs(tokens.slice(executableIndex + 1));
    if (!args) return null;
    return providerFromTokens(npmExecCommandTokens(args), depth + 1);
  }

  return null;
}

function envCommandTokens(args) {
  for (let index = 0; index < args.length;) {
    const token = args[index];
    if (token === "--") return args.slice(index + 1);
    if (token === "-S" || token === "--split-string") {
      if (index + 1 >= args.length) return [];
      return [...shellTokens(args[index + 1]), ...args.slice(index + 2)];
    }
    if (token.startsWith("--split-string=")) {
      return [...shellTokens(token.slice("--split-string=".length)), ...args.slice(index + 1)];
    }
    if (["-u", "--unset", "-C", "--chdir"].includes(token)) {
      index += 2;
      continue;
    }
    if (/^--(?:unset|chdir)=/.test(token) || /^-(?:u|C).+/.test(token)) {
      index += 1;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token) || token.startsWith("-")) {
      index += 1;
      continue;
    }
    return args.slice(index);
  }
  return [];
}

function npmExecArgs(args) {
  const optionsWithValues = new Set(["--package", "-p", "--call", "-c", "--workspace", "-w"]);
  for (let index = 0; index < args.length;) {
    const token = args[index];
    if (["exec", "x"].includes(token.toLowerCase())) return args.slice(index + 1);
    if (token === "--") return null;
    if (optionsWithValues.has(token)) {
      index += 2;
      continue;
    }
    if (/^--(?:package|call|workspace)=/.test(token) || /^-(?:p|c|w).+/.test(token) || token.startsWith("-")) {
      index += 1;
      continue;
    }
    return null;
  }
  return null;
}

function npmExecCommandTokens(args) {
  let callPayload;
  for (let index = 0; index < args.length;) {
    const token = args[index];
    if (token === "--") return args.slice(index + 1);
    if (token === "--package" || token === "-p") {
      index += 2;
      continue;
    }
    if (token === "--call" || token === "-c") {
      callPayload = args[index + 1];
      index += 2;
      continue;
    }
    if (/^--package=/.test(token) || /^-p.+/.test(token)) {
      index += 1;
      continue;
    }
    if (/^--call=/.test(token)) {
      callPayload = token.slice("--call=".length);
      index += 1;
      continue;
    }
    if (/^-c.+/.test(token)) {
      callPayload = token.slice(2);
      index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      index += 1;
      continue;
    }
    return args.slice(index);
  }
  return callPayload ? shellTokens(callPayload) : [];
}

function nextExecutableIndex(tokens, start) {
  let index = start;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === "--" || token === "exec" || /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token) || token.startsWith("-")) {
      index += 1;
      continue;
    }
    return index;
  }
  return index;
}

function nodeScriptToken(args) {
  const flagsWithValues = new Set([
    "-C", "--conditions", "-e", "--eval", "--experimental-loader", "--import", "-r", "--require"
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--") return args[index + 1] ?? null;
    if (!token.startsWith("-")) return token;
    if (flagsWithValues.has(token) && !token.includes("=")) index += 1;
  }
  return null;
}

function providerFromBasename(value) {
  if (/^codex(?:-[a-z0-9._-]+)?$/.test(value)) return "codex";
  if (/^(?:claude|claude-code)(?:-[a-z0-9._-]+)?$/.test(value)) return "claude-code";
  return null;
}

function shellTokens(command) {
  const tokens = [];
  let token = "";
  let quote = null;
  let started = false;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote === "'") {
      if (character === "'") quote = null;
      else token += character;
      started = true;
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = null;
      else if (character === "\\" && index + 1 < command.length) token += command[++index];
      else token += character;
      started = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      started = true;
      continue;
    }
    if (character === "\\" && index + 1 < command.length) {
      token += command[++index];
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) tokens.push(token);
      token = "";
      started = false;
      continue;
    }
    token += character;
    started = true;
  }
  if (started) tokens.push(token);
  return tokens;
}

function commandExecutable(fullCommand) {
  const command = fullCommand.trim();
  const quoted = command.match(/^(["'])(.*?)\1/);
  if (quoted) return quoted[2];
  const appExecutable = command.match(/^(.+?\.app\/Contents\/MacOS\/[^\s]+)/i);
  return appExecutable?.[1] ?? command.split(/\s+/, 1)[0] ?? "";
}

function obsidianProcessTree(processes, knownLaunchPids = []) {
  const roots = new Set(knownLaunchPids);
  for (const entry of processes) {
    const executable = path.basename(entry.executable).toLowerCase();
    if (executable === "obsidian" || entry.fullCommand.toLowerCase().includes("/obsidian.app/contents/macos/obsidian")) {
      roots.add(entry.pid);
    }
  }
  const selected = new Map();
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of processes) {
      if (selected.has(entry.pid)) continue;
      if (!roots.has(entry.pid) && !selected.has(entry.ppid)) continue;
      selected.set(entry.pid, entry);
      changed = true;
    }
  }
  return [...selected.values()];
}

function liveObsidianTargets(processes, targetPids, knownLaunchPids) {
  const tree = obsidianProcessTree(processes, knownLaunchPids);
  const liveIds = new Set(tree.map((entry) => entry.pid));
  return processes.filter((entry) => targetPids.has(entry.pid) || liveIds.has(entry.pid));
}

export function startProviderMonitor(baseline, adapters = {}, pollIntervalMs = 100) {
  const baselinePids = new Set(baseline.map((entry) => entry.pid));
  const observed = new Map();
  const controller = new AbortController();
  let active = true;
  let firstError;
  const readProcesses = adapters.providerProcesses ?? providerProcesses;
  const sleep = adapters.sleep ?? abortableSleep;
  const loop = (async () => {
    while (active) {
      for (const entry of await readProcesses(5000, controller.signal)) {
        if (!baselinePids.has(entry.pid)) observed.set(entry.pid, entry);
      }
      await sleep(pollIntervalMs, controller.signal);
    }
  })().catch((error) => {
    if (!controller.signal.aborted && firstError === undefined) firstError = error;
    active = false;
  });
  return {
    async stop(_timeoutMs, signal) {
      active = false;
      const onAbort = () => controller.abort(abortMessage(signal));
      signal?.addEventListener("abort", onAbort, { once: true });
      controller.abort(new Error("Provider monitor stopped"));
      try {
        await loop;
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
      if (firstError !== undefined) throw firstError;
      return [...observed.values()];
    }
  };
}

async function assertNoNewProviderProcesses(before, suppliedAfter, signal) {
  const after = suppliedAfter ?? await providerProcesses(5000, signal);
  const beforePids = new Set(before.map((entry) => entry.pid));
  const launched = after.filter((entry) => !beforePids.has(entry.pid));
  if (launched.length > 0) throw new Error(`Provider processes launched: ${JSON.stringify(launched)}`);
}

async function snapshotFiles(files, signal) {
  return Promise.all(files.map(async (file) => {
    throwIfAborted(signal);
    try {
      const bytes = await fs.readFile(file);
      return { path: file, exists: true, bytes, hash: bytesHash(bytes) };
    } catch (error) {
      if (error?.code === "ENOENT") return { path: file, exists: false, bytes: null, hash: null };
      throw error;
    }
  }));
}

function publicSnapshot(snapshot) {
  return snapshot.map(({ path: file, exists, hash }) => ({ path: file, exists, hash }));
}

async function restoreFiles(snapshot, signal) {
  for (const entry of snapshot) {
    throwIfAborted(signal);
    if (!entry.exists) {
      await fs.rm(entry.path, { force: true });
      continue;
    }
    await fs.mkdir(path.dirname(entry.path), { recursive: true });
    const temporary = `${entry.path}.opc-restore-${process.pid}`;
    try {
      await fs.writeFile(temporary, entry.bytes);
      throwIfAborted(signal);
      await fs.rename(temporary, entry.path);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
}

function assertSnapshotEqual(expected, actual) {
  if (JSON.stringify(publicSnapshot(expected)) !== JSON.stringify(publicSnapshot(actual))) {
    throw new Error(`Restored vault assets do not match backup: ${JSON.stringify(publicSnapshot(actual))}`);
  }
}

async function hashTrees(roots, signal) {
  const entries = [];
  for (const root of roots) {
    throwIfAborted(signal);
    await walk(root, root, entries, signal);
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function walk(root, current, entries, signal) {
  throwIfAborted(signal);
  let directoryEntries;
  try {
    directoryEntries = await fs.readdir(current, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of directoryEntries) {
    throwIfAborted(signal);
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) await walk(root, absolute, entries, signal);
    if (entry.isFile()) entries.push({ path: `${root}:${path.relative(root, absolute)}`, hash: await fileHash(absolute, signal) });
  }
}

async function writeJsonAtomic(file, value, signal) {
  throwIfAborted(signal);
  const temporary = `${file}.opc-fixture-${process.pid}`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
    throwIfAborted(signal);
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function runCommand(command, commandArgs, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120000;
  throwIfAborted(options.signal);
  await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd ?? process.cwd(),
      stdio: options.stdio ?? "inherit",
      detached: process.platform !== "win32"
    });
    trackedChildren.add(child);
    let cancellationError;
    let killTimer;
    const timeout = setTimeout(() => cancel(new Error(`${command} ${commandArgs.join(" ")} timed out after ${timeoutMs}ms`)), Math.max(1, timeoutMs));
    const onAbort = () => cancel(abortMessage(options.signal));
    const finish = (callback, value) => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", onAbort);
      trackedChildren.delete(child);
      callback(value);
    };
    function cancel(error) {
      if (cancellationError) return;
      cancellationError = error;
      if (child.pid) signalProcessGroup(child.pid, "SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null && child.pid) signalProcessGroup(child.pid, "SIGKILL");
      }, 500);
    }
    child.once("error", (error) => finish(reject, cancellationError ?? error));
    child.once("close", (code, signalName) => {
      if (cancellationError) finish(reject, cancellationError);
      else if (code === 0) finish(resolve);
      else finish(reject, new Error(`${command} ${commandArgs.join(" ")} exited with ${code ?? signalName}`));
    });
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function fileHash(file, signal) {
  throwIfAborted(signal);
  return bytesHash(await fs.readFile(file));
}

function bytesHash(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function objectHash(value) {
  return bytesHash(JSON.stringify(value));
}

function documentEvidence(document) {
  return {
    hash: objectHash(document),
    frameCount: document.projects.length,
    nodeCount: document.nodes.length,
    edgeCount: document.edges.length,
    viewport: document.viewport,
    frames: document.projects.map((frame) => ({
      id: frame.id,
      rootPath: frame.rootPath,
      position: frame.position,
      size: frame.size
    })),
    ownership: document.nodes.map((node) => ({ id: node.id, projectId: node.projectId }))
  };
}

async function importPlaywright() {
  try {
    return await import("playwright");
  } catch {
    return import("@playwright/test");
  }
}

function resolveVault(cliArgs) {
  const value = readArg(cliArgs, "--vault") ?? process.env.OBSIDIAN_VAULT;
  if (!value) throw new Error("Pass --vault /path/to/vault");
  return path.resolve(value);
}

function readArg(cliArgs, name) {
  const index = cliArgs.indexOf(name);
  return index >= 0 ? cliArgs[index + 1] : undefined;
}

function assertClose(actual, expected, tolerance, label) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected} +/- ${tolerance}, got ${actual}`);
  }
}

function isMainModule() {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

async function runLifecycleContractSelfTest() {
  let now = Date.UTC(2026, 6, 15);
  let processPoll = 0;
  let bytes = "user-before";
  let restored = false;
  const lateWriteEvents = [];
  const processRows = parseProcessTable([
    "100 1 /Applications/Obsidian.app/Contents/MacOS/Obsidian --remote-debugging-port=9222",
    "101 100 /Applications/Obsidian Helper.app/Contents/MacOS/Obsidian Helper --type=renderer"
  ].join("\n"));
  const result = await restoreAfterObsidianShutdown({
    shutdown: {
      debugPort: 9222,
      knownLaunchPids: [100],
      timeoutMs: 5000,
      stabilityMs: 200,
      label: "self-test-success"
    },
    expectedSnapshot: "user-before",
    restoreStabilityMs: 300
  }, {
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
    listProcesses: async () => {
      processPoll += 1;
      if (processPoll === 2) {
        bytes = "late-process-write";
        lateWriteEvents.push("late-write");
      }
      if (processPoll === 4) lateWriteEvents.push("process-exit");
      return processPoll < 4 ? processRows : [];
    },
    isCdpOpen: async () => {
      if (!lateWriteEvents.includes("cdp-close")) lateWriteEvents.push("cdp-close");
      return false;
    },
    deliverQuit: async () => true,
    restore: async () => { restored = true; lateWriteEvents.push("restore"); bytes = "user-before"; },
    snapshot: async () => bytes,
    assertSnapshot: (expected, actual) => {
      if (expected !== actual) throw new Error(`self-test snapshot mismatch: ${actual}`);
    }
  });
  if (
    !restored
    || bytes !== "user-before"
    || !result.shutdown.processTreeExited
    || lateWriteEvents.join(",") !== "cdp-close,late-write,process-exit,restore"
  ) {
    throw new Error("Lifecycle adapter did not wait for the process tree before restoration");
  }

  let forcedRestore = false;
  let forcedFailure = "";
  try {
    await restoreAfterObsidianShutdown({
      shutdown: {
        debugPort: 9222,
        knownLaunchPids: [200],
        timeoutMs: 500,
        stabilityMs: 10,
        label: "self-test-undelivered"
      },
      expectedSnapshot: "before",
      restoreStabilityMs: 10
    }, {
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds; },
      listProcesses: async () => parseProcessTable("200 1 /Applications/Obsidian.app/Contents/MacOS/Obsidian"),
      isCdpOpen: async () => true,
      deliverQuit: async () => false,
      restore: async () => { forcedRestore = true; },
      snapshot: async () => "before",
      assertSnapshot: () => undefined
    });
  } catch (error) {
    forcedFailure = error instanceof Error ? error.message : String(error);
  }
  if (forcedRestore || !forcedFailure.includes("not delivered")) {
    throw new Error("Undelivered quit did not fail before restoration");
  }

  const hungStartedAt = Date.now();
  await assertRejects(async () => shutdownObsidianLifecycle({
    debugPort: 9222,
    knownLaunchPids: [201],
    timeoutMs: 30,
    stabilityMs: 1,
    label: "self-test-hung-quit"
  }, {
    now: () => Date.now(),
    sleep: async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    listProcesses: async () => parseProcessTable("201 1 /Applications/Obsidian.app/Contents/MacOS/Obsidian"),
    isCdpOpen: async () => true,
    deliverQuit: async () => new Promise(() => undefined)
  }), /quit delivery (?:timed out|aborted but did not quiesce)/);
  const hungQuitElapsedMs = Date.now() - hungStartedAt;
  if (hungQuitElapsedMs > 500) throw new Error("Hung quit exceeded the lifecycle deadline");

  const deniedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "whiteboard-spawn-eacces-"));
  const deniedBinary = path.join(deniedRoot, "obsidian-denied");
  await fs.writeFile(deniedBinary, "#!/bin/sh\nexit 0\n", { mode: 0o000 });
  let spawnCode = "";
  try {
    await waitForSpawn(spawn(deniedBinary, []), "self-test Obsidian");
  } catch (error) {
    spawnCode = error?.code ?? "";
  } finally {
    await fs.rm(deniedRoot, { recursive: true, force: true });
  }
  if (spawnCode !== "EACCES") throw new Error(`Spawn EACCES was not rejected through the lifecycle helper: ${spawnCode}`);

  const commandProbeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "whiteboard-command-timeout-"));
  const commandProbeFile = path.join(commandProbeRoot, "late-write.txt");
  await assertRejects(
    () => runCommand("/bin/sh", ["-c", 'sleep 0.15; printf late > "$1"', "probe", commandProbeFile], { timeoutMs: 20 }),
    /timed out/
  );
  await abortableSleep(220);
  const commandLateWrite = await fs.access(commandProbeFile).then(() => true).catch(() => false);
  await fs.rm(commandProbeRoot, { recursive: true, force: true });
  if (commandLateWrite) throw new Error("Timed-out runCommand process group performed a delayed write");

  const lifecycleCases = [undefined, ...WHITEBOARD_FAILURE_STAGES];
  const lifecycleResults = [];
  for (const stage of lifecycleCases) {
    lifecycleResults.push(await runFakeLifecycleCase(stage));
  }
  lifecycleResults.push(await runFakeLifecycleCase(undefined, { launchEacces: true }));
  const monitorFailure = await runFakeLifecycleCase(undefined, { monitorFailure: true });
  lifecycleResults.push(monitorFailure);
  const delayedWrite = await runFakeLifecycleCase(undefined, { delayedMutation: "write" });
  const delayedLaunch = await runFakeLifecycleCase(undefined, { delayedMutation: "launch" });
  const cleanupStarvation = await runFakeLifecycleCase(undefined, { cleanupStarvation: true });
  const ignoredCancellation = await runFakeLifecycleCase(undefined, { ignoreCancellation: true });
  if (!delayedWrite.restored || delayedWrite.lateMutations !== 0 || !delayedLaunch.restored || delayedLaunch.lateLaunches !== 0) {
    throw new Error(`Abortable delayed mutation escaped restoration: ${JSON.stringify({ delayedWrite, delayedLaunch })}`);
  }
  if (!cleanupStarvation.restored || !cleanupStarvation.evidenceWritten || !cleanupStarvation.tempCleaned) {
    throw new Error(`Independent cleanup budgets were starved: ${JSON.stringify(cleanupStarvation)}`);
  }
  if (ignoredCancellation.restored || !ignoredCancellation.quiescenceReason.includes("did not quiesce")) {
    throw new Error(`Cancellation-ignoring mutator was falsely restored: ${JSON.stringify(ignoredCancellation)}`);
  }
  const { stdout: rejectionProbeOutput } = await execFileAsync(
    process.execPath,
    [process.argv[1], "--provider-monitor-rejection-probe"],
    { cwd: process.cwd(), timeout: 5000, killSignal: "SIGKILL" }
  );
  const providerPollRejection = JSON.parse(rejectionProbeOutput.trim());
  if (!providerPollRejection.ok) throw new Error(`Provider poll rejection probe failed: ${rejectionProbeOutput}`);
  const neverSettlingCases = [];
  for (const hang of ["stage", "closeCdp", "listProcesses", "isCdpOpen", "monitorStop"]) {
    const startedAt = Date.now();
    const result = await runFakeLifecycleCase(undefined, { hang });
    result.elapsedMs = Date.now() - startedAt;
    if (result.elapsedMs > 1000) throw new Error(`Never-settling ${hang} probe exceeded its deadline`);
    neverSettlingCases.push(result);
  }

  const expectedRelaunchDocument = normalizeGlobalBoardDocument(schemaOneFixture("/adapter/alpha", "/adapter/beta"));
  const expectedRelaunchFrame = expectedRelaunchDocument.projects.find((frame) => frame.id === "project-alpha");
  if (!expectedRelaunchFrame) throw new Error("Adapter relaunch fixture is missing project-alpha");
  const relaunchEvidence = { launches: [{ pid: 701 }], shutdowns: [], actions: [] };
  const relaunchEvents = [];
  const relaunchResult = await executeControlledRelaunch({
    evidence: relaunchEvidence,
    activeLaunchPids: new Set([701]),
    expectedDocument: expectedRelaunchDocument,
    expectedFrame: expectedRelaunchFrame,
    frameId: "project-alpha"
  }, {
    async closeCdp() { relaunchEvents.push("first-cdp-close"); },
    async shutdown() { relaunchEvents.push("first-process-exit"); return { label: "before-relaunch", processTreeExited: true }; },
    async launch() { relaunchEvents.push("second-launch"); return { pid: 702, alive: true }; },
    async connectAndReadDocument() {
      relaunchEvents.push("second-launch-verification");
      return { browser: { adapter: true }, document: structuredClone(expectedRelaunchDocument) };
    },
    async readPersistedWhiteboard() {
      relaunchEvents.push("persisted-verification");
      return structuredClone(expectedRelaunchDocument);
    },
    async dataFileHash() { return objectHash(expectedRelaunchDocument); },
    now: () => Date.UTC(2026, 6, 15, 12, 0, 0)
  });
  const serializedRelaunchEvidence = serializeWhiteboardEvidence({ status: "passed", lifecycle: [{ action: "relaunch" }] }, relaunchEvidence);
  const parsedRelaunchEvidence = JSON.parse(JSON.stringify(serializedRelaunchEvidence));
  if (
    relaunchResult.secondLaunch.pid !== 702
    || parsedRelaunchEvidence.launches.map((entry) => entry.pid).join(",") !== "701,702"
    || parsedRelaunchEvidence.actions.at(-1)?.action !== "controlled-relaunch"
    || relaunchEvents.join(",") !== "first-cdp-close,first-process-exit,second-launch,second-launch-verification,persisted-verification"
  ) throw new Error(`Real relaunch adapter path was not fully executed: ${JSON.stringify({ relaunchEvents, parsedRelaunchEvidence })}`);

  const providers = detectProviderProcesses(parseProcessTable([
    "301 1 /opt/homebrew/bin/node /opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js",
    "302 1 /usr/local/bin/claude-code --version",
    "303 1 /opt/bin/codex-macos-arm64 exec",
    "304 303 /bin/zsh -lc helper",
    "305 1 /bin/zsh -lc '/usr/local/bin/codex exec'",
    "306 1 /bin/bash -lc \"claude-code --version\"",
    "307 1 /usr/bin/env codex exec",
    "308 1 /usr/bin/env claude --version",
    "309 1 /usr/local/bin/npx codex exec",
    "310 1 /usr/local/bin/npm exec -- claude-code --version",
    "311 1 /usr/bin/node /opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js exec",
    "312 1 /bin/zsh -lc 'node /Users/test/.local/lib/node_modules/@openai/codex/bin/codex.js exec'",
    "313 1 /usr/bin/env -S \"codex exec\"",
    "314 1 /usr/bin/env --split-string \"node /opt/node_modules/@openai/codex/bin/codex.js exec\"",
    "315 1 /usr/bin/node /Users/wdblink/.local/lib/node_modules/@openai/codex/bin/codex.js exec",
    "316 1 /bin/sh -c \"env --split-string='node /opt/node_modules/@openai/codex/bin/codex.js exec'\"",
    "317 1 /bin/zsh -lc 'env --split-string=\"codex exec\"'",
    "318 1 /usr/bin/env --split-string=codex\\ exec",
    "319 1 /usr/bin/env -u TOKEN -C /tmp codex exec",
    "320 1 /usr/bin/env --unset=TOKEN --chdir /tmp claude-code --version",
    "321 1 /usr/local/bin/npx --package @openai/codex codex exec",
    "322 1 /usr/local/bin/npx -p @openai/codex -- codex exec",
    "323 1 /usr/local/bin/npx --call='codex exec'",
    "324 1 /usr/local/bin/npm exec --package @openai/codex -- codex exec",
    "325 1 /usr/local/bin/npm exec -p @anthropic-ai/claude-code -c 'claude-code --version'"
  ].join("\n")));
  const summary = providers.map(({ pid, ppid, executable, fullCommand, provider, relation }) => ({
    pid, ppid, executable, fullCommand, provider, relation
  }));
  const negativeProviders = detectProviderProcesses(parseProcessTable([
    "401 1 /bin/zsh -lc 'echo codex is documentation'",
    "402 1 /usr/bin/env REPORT=claude /usr/bin/python script.py",
    "403 1 /usr/local/bin/npm view codex version",
    "404 1 /usr/bin/node /tmp/my-codex-report.js",
    "405 1 /usr/bin/node /tmp/codex.js exec",
    "406 1 /usr/bin/node /tmp/node_modules/@openai/codex/docs/codex.js exec",
    "407 1 /usr/bin/env -S \"echo codex documentation\"",
    "408 1 /usr/bin/node /tmp/script.js /opt/node_modules/@openai/codex/bin/codex.js",
    "409 1 /usr/bin/env -u codex /usr/bin/python3 /tmp/job.py",
    "410 1 /usr/bin/env --unset claude /usr/bin/python3 /tmp/job.py",
    "411 1 /usr/bin/env -C codex /usr/bin/python3 /tmp/job.py",
    "412 1 /usr/bin/env --chdir=claude /usr/bin/python3 /tmp/job.py",
    "413 1 /bin/sh -c \"env --split-string='echo codex documentation'\"",
    "414 1 /usr/local/bin/npx --package codex echo documentation",
    "415 1 /usr/local/bin/npx -p codex",
    "416 1 /usr/local/bin/npm exec --package codex -- echo documentation",
    "417 1 /usr/local/bin/npm exec -p claude-code -c 'echo documentation'",
    "418 1 /usr/local/bin/npm run codex",
    "419 1 /usr/local/bin/npx --package=codex echo documentation"
  ].join("\n")));
  if (
    summary.length !== 25
    || !summary.some((entry) => entry.pid === 301 && entry.provider === "claude-code")
    || ![311, 312, 313, 314, 315, 316, 317, 318, 319, 321, 322, 323, 324]
      .every((pid) => summary.some((entry) => entry.pid === pid && entry.provider === "codex"))
    || negativeProviders.length !== 0
  ) {
    throw new Error(`Provider process parsing missed representative macOS forms: ${JSON.stringify(summary)}`);
  }
  let monitorPoll = 0;
  const transitionRows = [
    parseProcessTable("501 1 /usr/bin/node /opt/node_modules/@openai/codex/bin/codex.js exec"),
    parseProcessTable("502 1 /usr/bin/env -S \"codex exec\""),
    parseProcessTable("503 1 /bin/sh -c \"env --split-string='node /opt/node_modules/@openai/codex/bin/codex.js exec'\""),
    parseProcessTable("504 1 /usr/local/bin/npx --package @openai/codex codex exec"),
    parseProcessTable("505 1 /usr/local/bin/npm exec -- codex exec")
  ];
  const transitionMonitor = startProviderMonitor([], {
    async providerProcesses() {
      const rows = transitionRows[Math.min(monitorPoll, transitionRows.length - 1)];
      monitorPoll += 1;
      return detectProviderProcesses(rows);
    },
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  }, 1);
  while (monitorPoll < transitionRows.length) await new Promise((resolve) => setTimeout(resolve, 1));
  const transitionObserved = await transitionMonitor.stop();
  if (![501, 502, 503, 504, 505].every((pid) => transitionObserved.some((entry) => entry.pid === pid && entry.provider === "codex"))) {
    throw new Error(`Provider monitor missed wrapper transitions: ${JSON.stringify(transitionObserved)}`);
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    waitedForLateProcessWrite: processPoll >= 4,
    undeliveredQuitRejected: true,
    hungQuitRejectedWithinMs: hungQuitElapsedMs,
    spawnEaccesRejected: spawnCode === "EACCES",
    lifecycleCases: lifecycleResults,
    neverSettlingCases,
    delayedCancellation: { delayedWrite, delayedLaunch, ignoredCancellation },
    cleanupStarvation,
    providerPollRejection,
    runCommandKilledDelayedWrite: !commandLateWrite,
    realScenarioRelaunch: {
      launchPids: parsedRelaunchEvidence.launches.map((entry) => entry.pid),
      actions: parsedRelaunchEvidence.actions.map((entry) => entry.action),
      serialized: true
    },
    providerMonitorTransitionPids: transitionObserved.map((entry) => entry.pid),
    providerProcesses: summary
  })}\n`);
}

async function runFakeLifecycleCase(failAfter, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "whiteboard-lifecycle-"));
  const managedPresent = path.join(root, "managed-present.json");
  const managedAbsent = path.join(root, "managed-absent.json");
  const transcriptRoot = path.join(root, "transcripts");
  const transcript = path.join(transcriptRoot, "transcript.jsonl");
  const temporary = path.join(root, "temporary");
  const evidencePath = path.join(root, "evidence.json");
  const deniedBinary = path.join(root, "obsidian-denied");
  await fs.writeFile(managedPresent, "user-before");
  await fs.mkdir(transcriptRoot);
  await fs.writeFile(transcript, "provider-before");
  await fs.mkdir(temporary);
  if (options.launchEacces) await fs.writeFile(deniedBinary, "#!/bin/sh\nexit 0\n", { mode: 0o000 });
  const events = [];
  let processAlive = false;
  let monitorStopped = false;
  let evidenceWritten = false;
  let tempCleaned = false;
  let stageActive = false;
  let transcriptHashCalls = 0;
  let lateMutations = 0;
  let lateLaunches = 0;
  const managedPaths = [managedPresent, managedAbsent];
  try {
    const lifecycle = await runWhiteboardLifecycle({
      failAfter,
      restoreStabilityMs: 1,
      // Allow fixture IO to reach the injected hang before the lifecycle deadline expires.
      lifecycleTimeoutMs: options.hang === "stage" || options.delayedMutation || options.ignoreCancellation ? 250 : 1000,
      cleanupTimeoutMs: 250,
      mutatorQuiescenceTimeoutMs: 25,
      cdpCloseTimeoutMs: 25,
      shutdownTimeoutMs: 40,
      monitorStopTimeoutMs: 25,
      cleanupProbeTimeoutMs: 25,
      providerChecksTimeoutMs: 25,
      tempCleanupTimeoutMs: 25,
      evidenceWriteTimeoutMs: 25
    }, {
      now: () => Date.now(),
      sleep: async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      async shutdown(label) {
        events.push(`shutdown:${label}`);
        if (label === "before-restore" && (options.hang === "listProcesses" || options.hang === "isCdpOpen")) {
          const processRows = parseProcessTable("910 1 /Applications/Obsidian.app/Contents/MacOS/Obsidian");
          return shutdownObsidianLifecycle({
            knownLaunchPids: [910],
            timeoutMs: 25,
            stabilityMs: 1,
            label: `fake-${options.hang}`
          }, {
            now: () => Date.now(),
            sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
            listProcesses: options.hang === "listProcesses" ? async () => new Promise(() => undefined) : async () => processRows,
            isCdpOpen: options.hang === "isCdpOpen" ? async () => new Promise(() => undefined) : async () => true,
            deliverQuit: async () => true
          });
        }
        if (label === "before-restore" && processAlive) {
          if (!events.includes("cdp-close")) throw new Error("process cleanup began before CDP closure");
          await fs.writeFile(managedPresent, "late-process-write");
          events.push("late-write");
          processAlive = false;
          events.push("process-exit");
        }
      },
      snapshotManaged: () => snapshotFiles(managedPaths),
      publicSnapshot,
      hashTranscripts: () => {
        transcriptHashCalls += 1;
        if (options.cleanupStarvation && transcriptHashCalls > 1) return new Promise(() => undefined);
        return hashTrees([transcriptRoot]);
      },
      providerProcesses: async () => [],
      startProviderMonitor: () => {
        if (options.providerPollReject) {
          const ownedMonitor = startProviderMonitor([], {
            async providerProcesses(_timeoutMs, signal) {
              while (!stageActive) await abortableSleep(1, signal);
              throw new Error("provider process poll failed");
            },
            sleep: abortableSleep
          }, 1);
          return {
            async stop(timeoutMs, signal) {
              monitorStopped = true;
              return ownedMonitor.stop(timeoutMs, signal);
            }
          };
        }
        return {
          async stop() {
            monitorStopped = true;
            if (options.hang === "monitorStop") return new Promise(() => undefined);
            if (options.monitorFailure) throw new Error("provider monitor failed");
            return [];
          }
        };
      },
      async runStage(stage, _timeoutMs, signal) {
        stageActive = true;
        try {
          if (stage === "install") {
            await fs.writeFile(managedPresent, "installed");
            await fs.writeFile(managedAbsent, "created-by-runner");
            if (options.providerPollReject) await abortableSleep(20, signal);
          }
          if (stage === "fixture") await fs.writeFile(managedPresent, "fixture");
          if (stage === "fixture" && (options.hang === "stage" || options.ignoreCancellation)) {
            return new Promise(() => undefined);
          }
          if (stage === "fixture" && options.delayedMutation) {
            await new Promise((resolve, reject) => {
              const timer = setTimeout(async () => {
                signal.removeEventListener("abort", onAbort);
                if (options.delayedMutation === "write") {
                  lateMutations += 1;
                  await fs.writeFile(managedPresent, "late-stage-write");
                } else {
                  lateLaunches += 1;
                  processAlive = true;
                }
                resolve();
              }, 350);
              const onAbort = () => {
                clearTimeout(timer);
                signal.removeEventListener("abort", onAbort);
                reject(abortMessage(signal));
              };
              signal.addEventListener("abort", onAbort, { once: true });
            });
          }
          if (stage === "first-launch" && options.launchEacces) {
            await waitForSpawn(spawn(deniedBinary, []), "fake lifecycle Obsidian", signal);
          }
          if (stage === "first-launch" || stage === "relaunch") processAlive = true;
        } finally {
          stageActive = false;
        }
      },
      async closeCdp() {
        events.push("cdp-close");
        if (options.hang === "closeCdp") return new Promise(() => undefined);
      },
      assertTranscriptEquality(before, after) {
        if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("transcript mismatch");
      },
      assertProviderEquality(before, after, observed) {
        if (before.length || after.length || observed.length) throw new Error("provider mismatch");
      },
      async restoreManaged(snapshot) {
        events.push("restore");
        if (processAlive) throw new Error("restore occurred before process exit");
        await restoreFiles(snapshot);
      },
      assertManaged: assertSnapshotEqual,
      async cleanupTemp() {
        events.push("temp-cleanup");
        await fs.rm(temporary, { recursive: true, force: true });
        tempCleaned = true;
      },
      async writeEvidence(evidence) {
        evidenceWritten = true;
        await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
      }
    });
    if (options.delayedMutation) await abortableSleep(400);
    const evidence = JSON.parse(await fs.readFile(evidencePath, "utf8"));
    const presentBytes = await fs.readFile(managedPresent, "utf8");
    const absentExists = await fs.access(managedAbsent).then(() => true).catch(() => false);
    const temporaryExists = await fs.access(temporary).then(() => true).catch(() => false);
    const expectedPassed = failAfter === undefined
      && !options.monitorFailure
      && !options.providerPollReject
      && !options.cleanupStarvation
      && !options.launchEacces
      && !options.hang
      && !options.delayedMutation
      && !options.ignoreCancellation;
    const restorationSafe = !["stage", "closeCdp", "listProcesses", "isCdpOpen"].includes(options.hang)
      && !options.ignoreCancellation;
    if (
      lifecycle.ok !== expectedPassed
      || evidence.status !== (expectedPassed ? "passed" : "failed")
      || !evidenceWritten
      || !monitorStopped
      || (restorationSafe && presentBytes !== "user-before")
      || (restorationSafe && absentExists)
      || temporaryExists
      || evidence.restoration?.ok !== restorationSafe
      || (!options.cleanupStarvation && JSON.stringify(evidence.transcriptHashesBefore) !== JSON.stringify(evidence.transcriptHashesAfter))
    ) {
      throw new Error(`Full lifecycle case failed: ${JSON.stringify({ failAfter, lifecycle, events })}`);
    }
    const lateWriteIndex = events.indexOf("late-write");
    if (lateWriteIndex >= 0 && restorationSafe && !(
      events.indexOf("cdp-close") < lateWriteIndex
      && lateWriteIndex < events.indexOf("process-exit")
      && events.indexOf("process-exit") < events.indexOf("restore")
    )) {
      throw new Error(`Late-write ordering was not preserved: ${events.join(",")}`);
    }
    return {
      failAfter: failAfter ?? null,
      failure: options.launchEacces ? "spawn-EACCES" : options.monitorFailure ? "provider-monitor" : options.hang ? `never-${options.hang}` : null,
      status: evidence.status,
      restored: evidence.restoration.ok,
      monitorStopped,
      evidenceWritten,
      tempCleaned,
      lateMutations,
      lateLaunches,
      quiescenceReason: evidence.quiescence?.reason ?? "",
      cleanupErrors: evidence.cleanupErrors
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function runProviderMonitorRejectionProbe() {
  const result = await runFakeLifecycleCase(undefined, { providerPollReject: true });
  const ok = result.status === "failed"
    && result.restored
    && result.monitorStopped
    && result.evidenceWritten
    && result.tempCleaned
    && result.cleanupErrors.some((message) => message.includes("provider process poll failed"));
  return { ok, ...result };
}

async function assertRejects(operation, expected) {
  let message = "";
  try {
    await operation();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  if (!expected.test(message)) throw new Error(`Expected rejection ${expected}, received: ${message}`);
}
