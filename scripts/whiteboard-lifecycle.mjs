export const WHITEBOARD_FAILURE_STAGES = [
  "install",
  "fixture",
  "first-launch",
  "migration",
  "placeholders",
  "relaunch"
];

const DEFAULT_LIFECYCLE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_CLEANUP_TIMEOUT_MS = 2 * 60 * 1000;

function createDeadline(adapters, timeoutMs, label) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error(`${label} timeout must be positive`);
  return { at: adapters.now() + timeoutMs, label };
}

function remainingMs(adapters, deadline, capMs = Number.POSITIVE_INFINITY) {
  return Math.max(0, Math.min(deadline.at - adapters.now(), capMs));
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function delayResult(milliseconds, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), Math.max(1, milliseconds)));
}

export function withDeadline(adapters, deadline, label, operation, capMs, controls = {}) {
  const timeoutMs = remainingMs(adapters, deadline, capMs);
  if (timeoutMs <= 0) return Promise.reject(new Error(`${label} skipped: ${deadline.label} deadline elapsed`));

  const controller = new AbortController();
  const record = controls.mutating ? { label, controller, settled: null } : null;
  const operationOutcome = Promise.resolve()
    .then(() => operation(timeoutMs, controller.signal))
    .then(
      (value) => ({ status: "fulfilled", value }),
      (error) => ({ status: "rejected", error })
    );
  if (record) {
    record.settled = operationOutcome;
    controls.inFlightMutators.add(record);
    operationOutcome.finally(() => controls.inFlightMutators.delete(record));
  }

  return (async () => {
    const outcome = await Promise.race([
      operationOutcome,
      delayResult(timeoutMs, { status: "timed-out" })
    ]);
    if (outcome.status === "fulfilled") return outcome.value;
    if (outcome.status === "rejected") {
      if (controls.mutating && outcome.error?.unsafeMutation) controls.unsafeMutators.add(label);
      throw outcome.error;
    }

    controller.abort(new Error(`${label} timed out`));
    if (!controls.mutating) throw new Error(`${label} timed out after ${Math.ceil(timeoutMs)}ms`);

    const quiescenceTimeoutMs = Math.max(1, controls.quiescenceTimeoutMs ?? 5000);
    const settlement = await Promise.race([
      operationOutcome,
      delayResult(quiescenceTimeoutMs, { status: "not-quiescent" })
    ]);
    if (settlement.status === "not-quiescent") {
      controls.unsafeMutators.add(label);
      throw new Error(`${label} timed out and did not quiesce after abort within ${quiescenceTimeoutMs}ms`);
    }
    throw new Error(`${label} timed out after ${Math.ceil(timeoutMs)}ms; aborted operation quiesced`);
  })();
}

export async function runWhiteboardLifecycle(options, adapters) {
  const lifecycleDeadline = createDeadline(
    adapters,
    options.lifecycleTimeoutMs ?? DEFAULT_LIFECYCLE_TIMEOUT_MS,
    "scenario lifecycle"
  );
  const inFlightMutators = new Set();
  const unsafeMutators = new Set();
  const quiescenceTimeoutMs = options.mutatorQuiescenceTimeoutMs ?? 5000;
  const evidence = {
    status: "running",
    startedAt: new Date(adapters.now()).toISOString(),
    failAfter: options.failAfter ?? null,
    lifecycle: [],
    providerProcessesBefore: [],
    providerProcessesObserved: [],
    providerProcessesAfter: [],
    runtimeProcessesBefore: [],
    transcriptHashesBefore: [],
    transcriptHashesAfter: [],
    quiescence: null,
    restoration: null,
    cleanupErrors: []
  };
  const operationControls = (mutating = false) => ({
    mutating,
    inFlightMutators,
    unsafeMutators,
    quiescenceTimeoutMs
  });
  const runScenario = (label, operation, capMs, mutating = false) => withDeadline(
    adapters,
    lifecycleDeadline,
    label,
    operation,
    capMs,
    operationControls(mutating)
  );
  const independent = async (label, timeoutMs, operation, { mutating = false } = {}) => {
    const deadline = createDeadline(adapters, timeoutMs, label);
    try {
      return {
        ok: true,
        value: await withDeadline(
          adapters,
          deadline,
          label,
          operation,
          timeoutMs,
          operationControls(mutating)
        )
      };
    } catch (error) {
      evidence.cleanupErrors.push(`${label}: ${messageOf(error)}`);
      return { ok: false, error };
    }
  };

  let scenarioError;
  let backup;
  let monitor;
  try {
    evidence.transcriptHashesBefore = await runScenario(
      "pre-shutdown transcript hashing",
      (timeoutMs, signal) => adapters.hashTranscripts(timeoutMs, signal)
    );
    evidence.providerProcessesBefore = await runScenario(
      "pre-shutdown provider process probe",
      (timeoutMs, signal) => adapters.providerProcesses(timeoutMs, signal)
    );
    evidence.runtimeProcessesBefore = adapters.preflightRuntimeProcesses
      ? await runScenario(
          "pre-shutdown runtime process probe",
          (timeoutMs, signal) => adapters.preflightRuntimeProcesses(timeoutMs, signal)
        )
      : [];
    if (evidence.runtimeProcessesBefore.length > 0) {
      throw new Error("Refusing acceptance run with pre-existing app-owned runtime/provider processes");
    }
    monitor = adapters.startProviderMonitor(evidence.providerProcessesBefore);
    await runScenario(
      "shutdown before backup",
      (timeoutMs, signal) => adapters.shutdown("before-backup", timeoutMs, signal),
      undefined,
      true
    );
    evidence.lifecycle.push({ action: "shutdown-before-backup", at: new Date(adapters.now()).toISOString() });
    backup = await runScenario(
      "managed-file backup",
      (timeoutMs, signal) => adapters.snapshotManaged(timeoutMs, signal)
    );
    evidence.lifecycle.push({ action: "backup", files: adapters.publicSnapshot(backup), at: new Date(adapters.now()).toISOString() });
    for (const stage of WHITEBOARD_FAILURE_STAGES) {
      await runScenario(
        `scenario stage ${stage}`,
        (timeoutMs, signal) => adapters.runStage(stage, timeoutMs, signal),
        undefined,
        true
      );
      evidence.lifecycle.push({ action: stage, at: new Date(adapters.now()).toISOString() });
      if (options.failAfter === stage) throw new Error(`Injected failure after ${stage}`);
    }
    evidence.status = "passed";
  } catch (error) {
    scenarioError = error;
    evidence.status = "failed";
    evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    await independent(
      "CDP disconnect",
      options.cdpCloseTimeoutMs ?? 5000,
      (timeoutMs, signal) => adapters.closeCdp(timeoutMs, signal),
      { mutating: true }
    );

    let processExited = false;
    const shutdownResult = await independent(
      "Obsidian quit",
      options.shutdownTimeoutMs ?? 45000,
      (timeoutMs, signal) => adapters.shutdown("before-restore", timeoutMs, signal),
      { mutating: true }
    );
    if (shutdownResult.ok && shutdownResult.value?.processTreeExited !== false) {
      processExited = true;
      evidence.lifecycle.push({ action: "shutdown-before-restore", at: new Date(adapters.now()).toISOString() });
    }

    if (monitor) {
      const observed = await independent(
        "provider monitor stop",
        options.monitorStopTimeoutMs ?? 5000,
        (timeoutMs, signal) => monitor.stop(timeoutMs, signal)
      );
      if (observed.ok) evidence.providerProcessesObserved = observed.value;
    }

    const checks = await independent(
      "provider and transcript checks",
      options.providerChecksTimeoutMs ?? options.cleanupProbeTimeoutMs ?? 30000,
      async (timeoutMs, signal) => {
        evidence.providerProcessesAfter = await adapters.providerProcesses(timeoutMs, signal);
        evidence.transcriptHashesAfter = await adapters.hashTranscripts(timeoutMs, signal);
        await adapters.assertTranscriptEquality(
          evidence.transcriptHashesBefore,
          evidence.transcriptHashesAfter,
          signal
        );
        await adapters.assertProviderEquality(
          evidence.providerProcessesBefore,
          evidence.providerProcessesAfter,
          evidence.providerProcessesObserved,
          signal
        );
      }
    );
    if (!checks.ok && evidence.transcriptHashesAfter.length === 0) {
      evidence.transcriptHashesAfter = [];
    }

    const currentQuiescence = () => {
      const unresolved = [...inFlightMutators].map((record) => record.label);
      const unsafe = [...new Set([...unsafeMutators, ...unresolved])];
      return {
        ok: unsafe.length === 0,
        unsafeMutators: unsafe,
        reason: unsafe.length === 0
          ? "All mutating lifecycle operations settled before restoration"
          : `Restoration refused because mutating operations did not quiesce: ${unsafe.join(", ")}`,
        at: new Date(adapters.now()).toISOString()
      };
    };
    evidence.quiescence = currentQuiescence();

    if (backup && processExited && evidence.quiescence.ok) {
      const restoreResult = await independent(
        "managed-file restoration and stability",
        options.restorationTimeoutMs
          ?? options.cleanupTimeoutMs
          ?? Math.max(DEFAULT_CLEANUP_TIMEOUT_MS, (options.restoreStabilityMs ?? 0) + 5000),
        async (timeoutMs, signal) => {
          await adapters.restoreManaged(backup, timeoutMs, signal);
          const restored = await adapters.snapshotManaged(timeoutMs, signal);
          adapters.assertManaged(backup, restored);
          await adapters.sleep(options.restoreStabilityMs, signal);
          const stable = await adapters.snapshotManaged(timeoutMs, signal);
          adapters.assertManaged(backup, stable);
          return stable;
        },
        { mutating: true }
      );
      if (restoreResult.ok) {
        evidence.restoration = {
          ok: true,
          files: adapters.publicSnapshot(restoreResult.value),
          stableForMs: options.restoreStabilityMs,
          at: new Date(adapters.now()).toISOString()
        };
      } else {
        evidence.restoration = { ok: false, error: messageOf(restoreResult.error), at: new Date(adapters.now()).toISOString() };
      }
    } else if (backup) {
      const reason = !processExited
        ? "Restoration refused because the process tree did not exit"
        : evidence.quiescence.reason;
      evidence.restoration = { ok: false, error: reason, at: new Date(adapters.now()).toISOString() };
      evidence.cleanupErrors.push(`restore: ${reason}`);
    }

    await independent(
      "temp cleanup",
      options.tempCleanupTimeoutMs ?? 10000,
      (timeoutMs, signal) => adapters.cleanupTemp(timeoutMs, signal),
      { mutating: true }
    );
    evidence.quiescence = currentQuiescence();
    evidence.finishedAt = new Date(adapters.now()).toISOString();
    if (evidence.cleanupErrors.length > 0 && evidence.status === "passed") evidence.status = "failed";
    await independent(
      "evidence write",
      options.evidenceWriteTimeoutMs ?? 10000,
      (timeoutMs, signal) => adapters.writeEvidence(evidence, timeoutMs, signal),
      { mutating: true }
    );
  }
  return { ok: evidence.status === "passed", evidence, error: scenarioError };
}
