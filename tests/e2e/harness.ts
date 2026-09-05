import { renderCockpit } from "../../src/render";
import { renderWhiteboard } from "../../src/whiteboard";
import {
  createEmptyGlobalBoardDocument,
  normalizeGlobalBoardDocument,
  type GlobalBoardDocument
} from "../../src/whiteboard-model";
import {
  addPlanFromModelTasks,
  CockpitPersistenceCoordinator,
  createEmptyData,
  createSeedData,
  resolveCanonicalProjectDirectory,
  setLastExportPath,
  setWorkSessionSnapshot,
  toggleTaskCompletion,
  WhiteboardCommitChannel,
  WhiteboardProjectRegistrationWorkflow
} from "../../src/state";
import { WhiteboardProjectConsumer, WhiteboardProjectModalPresenter } from "../../src/project-modal";
import type { CockpitData, ModelTask, RendererState } from "../../src/types";
import type { AgentRuntimeGatewayContract } from "../../src/runtime-gateway";
import type { LaunchRuntimeRequest, LaunchRuntimeResult, ResizeRuntimeResult, RuntimeEvent } from "../../src/runtime-contract";

class FakeRuntimeGateway implements AgentRuntimeGatewayContract {
  readonly inputs: Array<{ runtimeId: string; data: string }> = [];
  readonly resizes: Array<{ runtimeId: string; cols: number; rows: number }> = [];
  readonly terminatedOwners: string[] = [];
  readonly terminatedGatewayOwners: string[] = [];
  readonly launchedGatewayOwners: string[] = [];
  readonly events: RuntimeEvent[] = [];
  abortCalls = 0;
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private readonly runtimes = new Map<string, { runtimeId: string; ownerId: string }>();
  private sequence = 0;
  private delayTermination = false;
  private rejectTermination = false;
  private readonly delayedExits: Array<{ runtimeId: string; ownerId: string }> = [];

  constructor(private readonly onLaunch: () => void) {}

  async launch(request: LaunchRuntimeRequest): Promise<LaunchRuntimeResult> {
    await this.terminateOwner(request.ownerId);
    this.onLaunch();
    const runtimeId = `fake-runtime-${++this.sequence}`;
    this.launchedGatewayOwners.push(request.ownerId);
    this.runtimes.set(request.ownerId, { runtimeId, ownerId: request.ownerId });
    this.emit({ protocolVersion: 1, type: "state", runtimeId, ownerId: request.ownerId, state: "starting" });
    await Promise.resolve();
    this.emit({ protocolVersion: 1, type: "state", runtimeId, ownerId: request.ownerId, state: "running" });
    return { runtimeId, ownerId: request.ownerId, pid: 10_000 + this.sequence };
  }

  async write(runtimeId: string, data: string): Promise<void> {
    this.inputs.push({ runtimeId, data });
  }

  async resize(runtimeId: string, cols: number, rows: number): Promise<ResizeRuntimeResult> {
    this.resizes.push({ runtimeId, cols, rows });
    return { runtimeId, cols, rows };
  }

  async terminate(runtimeId: string): Promise<void> {
    const runtime = Array.from(this.runtimes.values()).find((candidate) => candidate.runtimeId === runtimeId);
    if (!runtime) return;
    this.runtimes.delete(runtime.ownerId);
    this.terminatedOwners.push(publicOwnerId(runtime.ownerId));
    this.terminatedGatewayOwners.push(runtime.ownerId);
    if (this.delayTermination) {
      this.delayedExits.push(runtime);
      return;
    }
    this.emit({ protocolVersion: 1, type: "state", runtimeId, ownerId: runtime.ownerId, state: "exited" });
    this.emit({ protocolVersion: 1, type: "exit", runtimeId, ownerId: runtime.ownerId, exitCode: 0, signal: null });
  }

  async terminateOwner(ownerId: string): Promise<void> {
    const runtime = this.runtimes.get(ownerId);
    if (runtime && this.rejectTermination) throw new Error("fixture termination rejected");
    if (runtime) await this.terminate(runtime.runtimeId);
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async dispose(): Promise<void> {
    for (const ownerId of Array.from(this.runtimes.keys())) await this.terminateOwner(ownerId);
  }

  async abort(): Promise<void> {
    this.abortCalls += 1;
    const rejectTermination = this.rejectTermination;
    this.rejectTermination = false;
    try { await this.dispose(); } finally { this.rejectTermination = rejectTermination; }
  }

  output(ownerId: string, data: string, sequence: number): void {
    const runtime = this.findRuntime(ownerId);
    if (!runtime) return;
    this.emit({ protocolVersion: 1, type: "output", runtimeId: runtime.runtimeId, ownerId: runtime.ownerId, sequence, data });
  }

  fail(ownerId: string, message: string): void {
    const runtime = this.findRuntime(ownerId);
    this.emit({
      type: "error",
      runtimeId: runtime?.runtimeId ?? null,
      ownerId: runtime?.ownerId ?? ownerId,
      error: { code: "runtime_unavailable", message }
    });
  }

  setDelayTermination(value: boolean): void {
    this.delayTermination = value;
  }

  setRejectTermination(value: boolean): void {
    this.rejectTermination = value;
  }

  releaseDelayedExits(): void {
    for (const runtime of this.delayedExits.splice(0)) {
      this.emit({ protocolVersion: 1, type: "state", runtimeId: runtime.runtimeId, ownerId: runtime.ownerId, state: "exited" });
      this.emit({ protocolVersion: 1, type: "exit", runtimeId: runtime.runtimeId, ownerId: runtime.ownerId, exitCode: 0, signal: null });
    }
  }

  private findRuntime(ownerId: string) {
    return this.runtimes.get(ownerId)
      ?? Array.from(this.runtimes.values()).find((runtime) => publicOwnerId(runtime.ownerId) === ownerId);
  }

  private emit(event: RuntimeEvent): void {
    this.events.push(event);
    for (const listener of this.listeners) listener(event);
  }
}

function publicOwnerId(ownerId: string): string {
  return ownerId.slice(ownerId.indexOf(":") + 1);
}

let data: CockpitData = new URLSearchParams(window.location.search).get("fixture") === "long"
  ? createLongListData()
  : createSeedData();
let state: RendererState = {
  data,
  processing: false
};

const root = document.querySelector("#root");
if (!(root instanceof HTMLElement)) {
  throw new Error("Missing #root");
}

if (new URLSearchParams(window.location.search).get("view") === "whiteboard") {
  renderWhiteboardFixture(root);
} else {
  renderCockpitFixture(root);
}

let controller: ReturnType<typeof renderCockpit>;

function renderCockpitFixture(rootElement: HTMLElement): void {
  controller = renderCockpit(rootElement, state, {
  async decompose(input) {
    const result = addPlanFromModelTasks(
      data,
      input.text,
      [
        {
          title: "查清项目核心概念",
          detail: "先读 README、论文和 docs，把关键词列出来。",
          category: "research",
          priority: "P0"
        },
        {
          title: "尝试跑 demo",
          detail: "安装依赖，记录能否启动和失败原因。",
          category: "build",
          priority: "P1"
        }
      ],
      "harness-model",
      "playwright",
      "2026-07-03T08:00:00.000Z"
    );
    if (result.ok) {
      data = result.data;
      update({ data, processing: false });
    } else {
      update({ ...state, error: result.error });
    }
    return result;
  },
  async toggleTaskCompletion(taskId, completed) {
    const result = toggleTaskCompletion(data, taskId, completed, "2026-07-03T08:05:00.000Z");
    if (result.ok) {
      data = result.data;
      update({ data, processing: false });
    }
    return result;
  },
  async refreshWorkSessions() {
    data = setWorkSessionSnapshot(data, {
      date: "2026-07-02",
      generatedAt: "2026-07-03T08:06:00.000Z",
      sources: ["playwright"],
      warnings: [],
      sessions: [
        {
          id: "playwright-codex-session",
          platform: "codex",
          title: "Playwright 刷新出来的昨日会话",
          summary: "测试刷新按钮会更新本地 agent 工作会话。",
          path: "~/.codex/archived_sessions/playwright.jsonl",
          updatedAt: "2026-07-02T18:30:00.000Z",
          resumeHint: "codex resume playwright-codex-session",
          resumable: true,
          artifacts: [],
          status: "completed"
        }
      ]
    });
    update({ data, processing: false });
    return { ok: true, data };
  },
  async copyResumeCommand(command) {
    (window as Window & { agentNotebookCopiedResumeCommand?: string }).agentNotebookCopiedResumeCommand = command;
    return true;
  },
  async openLocalPath(path, reveal) {
    (window as Window & { agentNotebookOpenedPath?: string }).agentNotebookOpenedPath = `${reveal ? "reveal" : "open"}:${path}`;
    return true;
  },
  async exportDailyNote() {
    const path = "Agent Notebook/2026-07-04.md";
    data = setLastExportPath(data, path);
    update({ data, processing: false, exportPath: path });
    return { ok: true, data: { path } };
  },
  clearError() {
    const { error: _error, ...withoutError } = state;
    update(withoutError);
  }
  });
}

function renderWhiteboardFixture(rootElement: HTMLElement): void {
  const fixture = new URLSearchParams(window.location.search).get("fixture");
  let document = fixture === "empty" || fixture === "invalid-path"
    ? createEmptyGlobalBoardDocument()
    : createTwoProjectDocument();
  const actionResults: string[] = [];
  const runtimeWindow = window as unknown as Window & {
    whiteboardSavedDocument?: GlobalBoardDocument;
    whiteboardSaveCount: number;
    whiteboardProcessLaunchCount: number;
    whiteboardProjectActionResults: string[];
    whiteboardProjectPending: boolean;
    whiteboardRerender(): void;
    whiteboardSetSaveMode(mode: "normal" | "deferred" | "reject"): void;
    whiteboardReleaseSaves(): void;
    whiteboardExternalUpdate(nextDocument: GlobalBoardDocument): Promise<void>;
    whiteboardExternalRegister(rootPath: string, name: string): Promise<void>;
    whiteboardDestroyed: boolean;
    whiteboardBeginDestroy(): void;
    whiteboardOpenSecondController(): void;
    whiteboardCloseSecondController(): void;
    whiteboardDeferProjectValidation(): void;
    whiteboardReleaseProjectValidation(): void;
    whiteboardBlockProjectQueue(): Promise<void>;
    whiteboardReleaseProjectQueue(): void;
    whiteboardRuntimeInputs: Array<{ runtimeId: string; data: string }>;
    whiteboardRuntimeResizes: Array<{ runtimeId: string; cols: number; rows: number }>;
    whiteboardRuntimeTerminatedOwners: string[];
    whiteboardRuntimeTerminatedGatewayOwners: string[];
    whiteboardRuntimeLaunchedGatewayOwners: string[];
    whiteboardRuntimeEvents: RuntimeEvent[];
    whiteboardRuntimeDelayTermination(value: boolean): void;
    whiteboardRuntimeReleaseDelayedExits(): void;
    whiteboardRuntimeRejectTermination(value: boolean): void;
    whiteboardRuntimeAbortCalls(): number;
    whiteboardRuntimeOutput(ownerId: string, data: string, sequence: number): void;
    whiteboardRuntimeFail(ownerId: string, message: string): void;
    whiteboardReadTerminal(ownerId: string): string;
  };
  const terminalReaders = new Map<string, () => string>();
  (globalThis as typeof globalThis & {
    __agentNotebookTerminalTestHook?: { register(ownerId: string, readBuffer: () => string): () => void };
  }).__agentNotebookTerminalTestHook = {
    register(ownerId, readBuffer) {
      terminalReaders.set(ownerId, readBuffer);
      return () => {
        if (terminalReaders.get(ownerId) === readBuffer) terminalReaders.delete(ownerId);
      };
    }
  };
  runtimeWindow.whiteboardReadTerminal = (ownerId) => terminalReaders.get(ownerId)?.() ?? "";
  runtimeWindow.whiteboardSaveCount = 0;
  runtimeWindow.whiteboardProcessLaunchCount = 0;
  runtimeWindow.whiteboardProjectActionResults = actionResults;
  runtimeWindow.whiteboardProjectPending = false;
  runtimeWindow.whiteboardSavedDocument = document;
  runtimeWindow.whiteboardDestroyed = false;
  const fakeRuntimeGateway = new FakeRuntimeGateway(() => { runtimeWindow.whiteboardProcessLaunchCount += 1; });
  runtimeWindow.whiteboardRuntimeInputs = fakeRuntimeGateway.inputs;
  runtimeWindow.whiteboardRuntimeResizes = fakeRuntimeGateway.resizes;
  runtimeWindow.whiteboardRuntimeTerminatedOwners = fakeRuntimeGateway.terminatedOwners;
  runtimeWindow.whiteboardRuntimeTerminatedGatewayOwners = fakeRuntimeGateway.terminatedGatewayOwners;
  runtimeWindow.whiteboardRuntimeLaunchedGatewayOwners = fakeRuntimeGateway.launchedGatewayOwners;
  runtimeWindow.whiteboardRuntimeEvents = fakeRuntimeGateway.events;
  runtimeWindow.whiteboardRuntimeDelayTermination = (value) => fakeRuntimeGateway.setDelayTermination(value);
  runtimeWindow.whiteboardRuntimeReleaseDelayedExits = () => fakeRuntimeGateway.releaseDelayedExits();
  runtimeWindow.whiteboardRuntimeRejectTermination = (value) => fakeRuntimeGateway.setRejectTermination(value);
  runtimeWindow.whiteboardRuntimeAbortCalls = () => fakeRuntimeGateway.abortCalls;
  runtimeWindow.whiteboardRuntimeOutput = (ownerId, output, sequence) => fakeRuntimeGateway.output(ownerId, output, sequence);
  runtimeWindow.whiteboardRuntimeFail = (ownerId, message) => fakeRuntimeGateway.fail(ownerId, message);
  let saveMode: "normal" | "deferred" | "reject" = "normal";
  const deferredSaves: Array<{ resolve(): void }> = [];
  let cockpitData = { ...createEmptyData(), whiteboard: document };
  const commitChannel = new WhiteboardCommitChannel();
  const coordinator = new CockpitPersistenceCoordinator(
    cockpitData,
    async (candidate) => {
      const validated = normalizeGlobalBoardDocument(candidate.whiteboard);
      if (saveMode === "reject") throw new Error("fixture durable save failed");
      if (saveMode === "deferred") {
        await new Promise<void>((resolve) => deferredSaves.push({ resolve }));
      }
      runtimeWindow.whiteboardSavedDocument = validated;
      runtimeWindow.whiteboardSaveCount += 1;
    },
    (candidate) => {
      cockpitData = candidate;
      document = candidate.whiteboard;
    }
  );

  let whiteboardController: ReturnType<typeof renderWhiteboard>;
  let secondController: ReturnType<typeof renderWhiteboard> | undefined;
  const primaryListener = {
    receiveWhiteboardCommit(nextDocument: GlobalBoardDocument, revision: number) {
      whiteboardController.update(nextDocument, undefined, revision);
    }
  };
  const secondaryListener = {
    receiveWhiteboardCommit(nextDocument: GlobalBoardDocument, revision: number) {
      secondController?.update(nextDocument, undefined, revision);
    }
  };
  const fakePaths = new Map([
    ["/workspace/alpha", "/workspace/alpha"],
    ["/workspace/beta", "/workspace/beta"],
    ["/workspace/beta-alias", "/workspace/beta"],
    ["/workspace/gamma", "/workspace/gamma"],
    ["/workspace/slow-validation", "/workspace/slow-validation"],
    ["/workspace/queued", "/workspace/queued"],
    ["/workspace/unreadable", "/workspace/unreadable"],
    ["/workspace/not-a-directory", "/workspace/not-a-directory"]
  ]);
  let validationDeferred: Promise<void> | undefined;
  let releaseValidation: (() => void) | undefined;
  let releaseQueue: (() => void) | undefined;
  const projectWorkflow = new WhiteboardProjectRegistrationWorkflow(
    (input, signal) => resolveCanonicalProjectDirectory(input, {
      homeDirectory: "/home/test",
      readableSearchableMode: 5,
      resolve: (value) => value,
      realpath: async (value) => {
        if (value === "/workspace/slow-validation" && validationDeferred) await validationDeferred;
        const resolved = fakePaths.get(value);
        if (!resolved) throw new Error("ENOENT");
        return resolved;
      },
      stat: async (value) => ({ isDirectory: () => value !== "/workspace/not-a-directory" }),
      access: async (value) => {
        if (value === "/workspace/unreadable") throw new Error("EACCES");
      },
      readdir: async () => []
    }, signal),
    (...values) => coordinator.registerProject(...values)
  );

  const projectConsumer = new WhiteboardProjectConsumer({
    async register(rootPath, name, signal, onPhase) {
      const result = await projectWorkflow.run(rootPath, name, signal, onPhase);
      if (!result.ok && result.message === "这个项目路径已经添加。") actionResults.push(`duplicate ${name}`);
      if (result.ok) commitChannel.publish(result.data.whiteboard, result.data.whiteboardRevision);
      return result.ok ? { ok: true, projectId: result.projectId } : result;
    },
    publishCommitted(projectId) {
      const project = coordinator.snapshot().whiteboard.projects.find((candidate) => candidate.id === projectId);
      actionResults.push(`created ${project?.name ?? projectId}`);
      whiteboardController.focusProject(projectId);
    }
  });

  const openProjectModal = () => {
    if (globalThis.document.querySelector('[role="dialog"][aria-label="添加项目"]')) return;
    const dialog = globalThis.document.createElement("section");
    dialog.setAttribute("role", "dialog");
    const presenter = new WhiteboardProjectModalPresenter(projectConsumer);
    const requestClose = () => {
      const decision = presenter.requestClose();
      if (decision.close) {
        if (!presenter.completed) actionResults.push("cancelled");
        presenter.destroy();
        dialog.remove();
      }
    };
    globalThis.document.body.append(dialog);
    presenter.mount(dialog, {
      setTitle(title) { dialog.setAttribute("aria-label", title); },
      requestClose
    });
  };
  const actions = {
    requestProject() {
      openProjectModal();
    },
    async saveDocument(nextDocument: GlobalBoardDocument, expectedRevision: number) {
      const result = await coordinator.saveWhiteboard(nextDocument, expectedRevision);
      if (result.ok) commitChannel.publish(result.document, result.revision, primaryListener);
      return result;
    },
    async retryMigration() {
      if (fixture === "migration-error") {
        whiteboardController.update(document, undefined, cockpitData.whiteboardRevision);
      }
    }
  };
  const migrationError = fixture === "migration-error"
    ? { message: "节点 ID 重复：duplicate-node" }
    : undefined;
  whiteboardController = renderWhiteboard(
    rootElement,
    document,
    {} as never,
    {} as never,
    actions,
    fakeRuntimeGateway,
    migrationError,
    cockpitData.whiteboardRevision
  );
  commitChannel.subscribe(primaryListener);
  runtimeWindow.whiteboardRerender = () => whiteboardController.update(
    runtimeWindow.whiteboardSavedDocument ?? document,
    undefined,
    cockpitData.whiteboardRevision
  );
  runtimeWindow.whiteboardSetSaveMode = (mode) => { saveMode = mode; };
  runtimeWindow.whiteboardReleaseSaves = () => {
    saveMode = "normal";
    for (const pending of deferredSaves.splice(0)) pending.resolve();
  };
  runtimeWindow.whiteboardDeferProjectValidation = () => {
    validationDeferred = new Promise<void>((resolve) => { releaseValidation = resolve; });
  };
  runtimeWindow.whiteboardReleaseProjectValidation = () => {
    releaseValidation?.();
    releaseValidation = undefined;
    validationDeferred = undefined;
  };
  runtimeWindow.whiteboardBlockProjectQueue = async () => {
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseQueue = resolve; });
    void coordinator.transact(async () => {
      markStarted?.();
      await blocked;
      return { write: false, value: undefined };
    });
    await started;
  };
  runtimeWindow.whiteboardReleaseProjectQueue = () => {
    releaseQueue?.();
    releaseQueue = undefined;
  };
  runtimeWindow.whiteboardExternalUpdate = async (nextDocument) => {
    const result = await coordinator.saveWhiteboard(nextDocument, cockpitData.whiteboardRevision);
    if (!result.ok) throw new Error("fixture external update conflicted");
    commitChannel.publish(result.document, result.revision);
  };
  runtimeWindow.whiteboardExternalRegister = async (rootPath, name) => {
    const result = await coordinator.registerProject(rootPath, name);
    if (!result.ok) throw new Error(result.message);
    commitChannel.publish(result.data.whiteboard, result.data.whiteboardRevision);
  };
  runtimeWindow.whiteboardBeginDestroy = () => {
    void whiteboardController.destroy().catch(() => undefined).finally(() => { runtimeWindow.whiteboardDestroyed = true; });
  };
  runtimeWindow.whiteboardOpenSecondController = () => {
    if (secondController) return;
    const secondRoot = globalThis.document.createElement("div");
    secondRoot.dataset.controller = "secondary";
    secondRoot.style.height = "900px";
    globalThis.document.body.append(secondRoot);
    secondController = renderWhiteboard(
      secondRoot,
      cockpitData.whiteboard,
      {} as never,
      {} as never,
      {
        ...actions,
        async saveDocument(nextDocument: GlobalBoardDocument, expectedRevision: number) {
          const result = await coordinator.saveWhiteboard(nextDocument, expectedRevision);
          if (result.ok) commitChannel.publish(result.document, result.revision, secondaryListener);
          return result;
        }
      },
      fakeRuntimeGateway,
      undefined,
      cockpitData.whiteboardRevision
    );
    commitChannel.subscribe(secondaryListener);
  };
  runtimeWindow.whiteboardCloseSecondController = () => {
    if (!secondController) return;
    const closing = secondController;
    secondController = undefined;
    void closing.destroy().catch(() => undefined);
  };

}

function createTwoProjectDocument(): GlobalBoardDocument {
  const migrated = normalizeGlobalBoardDocument({
    projects: [
      { id: "project-alpha", name: "Alpha", rootPath: "/workspace/alpha" },
      { id: "project-beta", name: "Beta", rootPath: "/workspace/beta" }
    ],
    boards: {
      "project-alpha": {
        schemaVersion: 1,
        projectId: "project-alpha",
        viewport: { x: 40, y: 20, zoom: 1.25 },
        nodes: [
          {
            id: "agent-alpha", kind: "agent", x: 100, y: 120, width: 520, height: 340, zIndex: 3,
            provider: "codex", workingDirectory: "/workspace/alpha", sessionIdVerified: false, runtimeState: "running"
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
            workingDirectory: "/workspace/beta"
          },
          {
            id: "agent-beta", kind: "agent", x: 560, y: 80, width: 520, height: 340, zIndex: 2,
            provider: "claude-code", workingDirectory: "/workspace/beta", sessionIdVerified: false, runtimeState: "waiting"
          },
          {
            id: "note-beta", kind: "note", x: 560, y: 500, width: 320, height: 240, zIndex: 3,
            markdown: "# Beta\n\n```ts\nconst n = 2;\n```\n"
          }
        ],
        edges: [{ id: "edge-beta", source: "agent-beta", target: "note-beta" }]
      }
    }
  });
  return { ...migrated, viewport: { x: -20, y: 80, zoom: 0.5 } };
}

function showFixtureAlert(rootElement: HTMLElement, message: string): void {
  if (document.querySelector(".agent-whiteboard-fixture-alert")) return;
  const alert = document.createElement("p");
  alert.className = "agent-whiteboard-fixture-alert";
  alert.setAttribute("role", "alert");
  alert.textContent = message;
  document.body.append(alert);
}

function update(next: RendererState): void {
  state = next;
  controller.update(state);
}

function createLongListData(): CockpitData {
  const longPhrase =
    "这是一个非常长的待办描述，用来模拟用户把复杂任务、背景、约束和验证标准全部说在一起，必须换行且不能撑破屏幕范围。";
  const tasks: ModelTask[] = Array.from({ length: 18 }, (_, index) => ({
    title: `长待办 ${index + 1}：${longPhrase} keep-this-unbroken-token-wrapping-without-horizontal-overflow-${index}`,
    detail: `${longPhrase} 需要继续补充上下文、明确交付物、列出验收方式，并保留足够多的文字来触发滚动区域。${longPhrase}`,
    category: index % 2 === 0 ? "analysis" : "build",
    priority: index < 3 ? "P0" : "P1"
  }));
  const result = addPlanFromModelTasks(
    createEmptyData(),
    `${longPhrase} ${longPhrase}`,
    tasks,
    "long-fixture-model",
    "playwright",
    "2026-07-03T08:00:00.000Z"
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}
