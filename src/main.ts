import {
  App,
  FileSystemAdapter,
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  WorkspaceLeaf,
  normalizePath
} from "obsidian";
import fs from "node:fs/promises";
import {
  COMMAND_EXPORT_DAILY_NOTE,
  COMMAND_OPEN_AGENT_WHITEBOARD,
  COMMAND_OPEN_COCKPIT,
  COMMAND_QUICK_CAPTURE,
  COMMAND_REFRESH_WORK_SESSIONS,
  PLUGIN_ID,
  SESSION_PROVIDER_DEFINITIONS,
  VIEW_TYPE_AGENT_WHITEBOARD,
  VIEW_TYPE_DAILY_COCKPIT
} from "./constants";
import { loadAgentWorkSnapshot } from "./agent-sessions";
import { createCliSessionSummarizer } from "./agent-summary";
import { buildDailyMarkdown, dailyNotePath, isDailyCockpitMarkdown } from "./export";
import { requestTaskDecomposition } from "./llm";
import {
  addPlanFromModelTasks,
  CockpitPersistenceCoordinator,
  normalizeData,
  resolveCanonicalProjectDirectory,
  SerialTransactionQueue,
  setLastExportPath,
  setWorkSessionSnapshot,
  toggleTaskCompletion,
  touchOpened,
  WhiteboardCommitChannel,
  WhiteboardProjectRegistrationWorkflow,
  type ProjectRegistrationPhase,
  type WhiteboardCommitListener
} from "./state";
import { renderCockpit } from "./render";
import { registerPluginSurface } from "./plugin-boundary";
import { WhiteboardProjectConsumer, WhiteboardProjectModalPresenter } from "./project-modal";
import { renderWhiteboard, type WhiteboardController } from "./whiteboard";
import { AgentRuntimeGateway } from "./runtime-gateway";
import { createNodeProcessAdapter } from "./runtime-process-adapter";
import {
  WhiteboardMigrationError,
  type GlobalBoardDocument,
  type WhiteboardCommitResult
} from "./whiteboard-model";
import type {
  CockpitData,
  CockpitResult,
  CockpitSettings,
  IntentInput,
  RenderController,
  RendererState
} from "./types";

export default class DailyCockpitPlugin extends Plugin {
  data: CockpitData = normalizeData(null);
  whiteboardMigrationError: WhiteboardMigrationError | undefined;
  private readonly writeQueue = new SerialTransactionQueue();
  private persistence!: CockpitPersistenceCoordinator;
  private projectRegistration!: WhiteboardProjectRegistrationWorkflow;
  readonly whiteboardCommits = new WhiteboardCommitChannel();
  runtimeGateway!: AgentRuntimeGateway;
  private runtimeHostPath = "";

  async onload(): Promise<void> {
    const loaded = await this.loadData();
    try {
      this.data = touchOpened(normalizeData(loaded));
      await this.saveData(this.data);
    } catch (error) {
      if (!(error instanceof WhiteboardMigrationError)) throw error;
      this.whiteboardMigrationError = error;
      const source = loaded && typeof loaded === "object" ? loaded as Record<string, unknown> : {};
      this.data = touchOpened(normalizeData({ ...source, whiteboard: undefined, whiteboardRevision: undefined }));
    }
    this.persistence = new CockpitPersistenceCoordinator(
      this.data,
      (candidate) => this.saveData(candidate),
      (candidate) => { this.data = candidate; }
    );
    this.projectRegistration = new WhiteboardProjectRegistrationWorkflow(
      resolveProjectDirectory,
      (rootPath, name, signal, onPhase) => this.persistence.registerProject(rootPath, name, signal, onPhase)
    );
    if (this.whiteboardMigrationError) this.persistence.block(this.whiteboardMigrationError);
    if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
      throw new Error("Agent terminal runtime requires a desktop filesystem vault.");
    }
    const vaultRoot = this.app.vault.adapter.getBasePath().replace(/\/$/, "");
    const runtimeRoot = `${vaultRoot}/${this.app.vault.configDir}/plugins/${PLUGIN_ID}/runtime`;
    this.runtimeHostPath = await resolveInstalledRuntimeHost(runtimeRoot);
    this.runtimeGateway = this.createRuntimeGateway();

    registerPluginSurface(this, {
      createDailyView: (leaf) => new DailyCockpitView(leaf, this),
      createWhiteboardView: (leaf) => new AgentWhiteboardView(leaf, this),
      settingTab: new DailyCockpitSettingTab(this.app, this),
      openDaily: () => { void this.activateView(); },
      openWhiteboard: () => { void this.activateWhiteboard(); },
      quickCapture: () => new IntentModal(this).open(),
      exportDaily: () => { void this.exportDailyNote(); },
      refreshSessions: () => { void this.refreshWorkSessions(); }
    });

  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_DAILY_COCKPIT);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_AGENT_WHITEBOARD);
    // beginDispose synchronously marks the gateway unavailable and sends host shutdown before returning.
    void this.runtimeGateway?.beginDispose();
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_DAILY_COCKPIT)[0];
    if (existing) {
      this.app.workspace.revealLeaf(existing);
      return;
    }

    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_DAILY_COCKPIT, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async activateWhiteboard(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_WHITEBOARD)[0];
    if (existing) {
      this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_AGENT_WHITEBOARD, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async registerWhiteboardProject(
    rootPath: string,
    name: string,
    signal?: AbortSignal,
    onPhase?: (phase: ProjectRegistrationPhase) => void
  ): Promise<{ ok: true; projectId: string } | { ok: false; message: string }> {
    try {
      const registration = await this.projectRegistration.run(rootPath, name, signal, onPhase);
      if (registration.ok) {
        this.whiteboardCommits.publish(this.data.whiteboard, this.data.whiteboardRevision);
      }
      return registration.ok
        ? { ok: true, projectId: registration.projectId }
        : registration;
    } catch (error) {
      console.error(`[${PLUGIN_ID}] project registration failed`, error);
      return { ok: false, message: "无法读取项目路径，请检查权限。" };
    }
  }

  async saveWhiteboardDocument(
    document: GlobalBoardDocument,
    expectedRevision: number,
    origin?: WhiteboardCommitListener
  ): Promise<WhiteboardCommitResult> {
    const result = await this.persistence.saveWhiteboard(document, expectedRevision);
    if (result.ok) this.whiteboardCommits.publish(result.document, result.revision, origin);
    return result;
  }

  async retryWhiteboardMigration(): Promise<void> {
    await this.enqueueWrite(async () => {
      const loaded = await this.loadData();
      try {
        await this.persistence.recover(async () => touchOpened(normalizeData(loaded)));
        this.whiteboardMigrationError = undefined;
        this.refreshViews();
      } catch (error) {
        this.whiteboardMigrationError = error instanceof WhiteboardMigrationError
          ? error
          : new WhiteboardMigrationError("白板迁移已验证，但持久化失败；原始数据未被覆盖，请重试。");
        this.persistence.block(this.whiteboardMigrationError);
        this.refreshWhiteboardViews();
      }
    });
  }

  async decomposeIntent(input: IntentInput): Promise<CockpitResult<CockpitData>> {
    return this.enqueueWrite(async () => {
      const decomposition = await requestTaskDecomposition(this.data.settings, input.text);
      if (!decomposition.ok) return decomposition;
      return this.commit((current) => addPlanFromModelTasks(
          current,
          input.text,
          decomposition.data.tasks,
          decomposition.data.model ?? current.settings.llmModel,
          input.source
        ));
    });
  }

  async toggleTaskCompletion(taskId: string, completed: boolean): Promise<CockpitResult<CockpitData>> {
    return this.enqueueWrite(() => this.commit((current) => toggleTaskCompletion(current, taskId, completed)));
  }

  async updateSettings(settings: Partial<CockpitSettings>): Promise<void> {
    const runtimeChanged = (
      (settings.runtimeNodePath !== undefined && settings.runtimeNodePath !== this.data.settings.runtimeNodePath)
      || (settings.codexCliPath !== undefined && settings.codexCliPath !== this.data.settings.codexCliPath)
    );
    await this.enqueueWrite(async () => {
      await this.commit((current) => ({
        ok: true,
        data: normalizeData({
          ...current,
          settings: {
            ...current.settings,
            ...settings
          }
        })
      }));
    });
    if (runtimeChanged) await this.reconfigureRuntimeGateway();
  }

  async exportDailyNote(): Promise<CockpitResult<{ path: string }>> {
    return this.enqueueWrite(() => this.exportDailyNoteLocked());
  }

  async refreshWorkSessions(showNotice = true): Promise<CockpitResult<CockpitData>> {
    try {
      const settings = this.data.settings;
      const snapshot = await loadAgentWorkSnapshot(settings, {
        summarizer: createCliSessionSummarizer()
      });
      return this.enqueueWrite(async () => {
        const result = await this.commit((current) => ({ ok: true, data: setWorkSessionSnapshot(current, snapshot) }));
        if (result.ok && showNotice) {
          const warningSuffix = snapshot.warnings.length > 0 ? `，${snapshot.warnings.length} 个总结警告` : "";
          new Notice(`已刷新昨日工作会话：${snapshot.sessions.length} 条${warningSuffix}`);
        }
        return result;
      });
    } catch (error) {
      console.error(`[${PLUGIN_ID}] session scan failed`, error);
      return {
        ok: false,
        error: { code: "SESSION_SCAN_FAILED", message: "读取昨日工作会话失败。请检查扫描目录和 Agent CLI 设置。" }
      };
    }
  }

  private async exportDailyNoteLocked(): Promise<CockpitResult<{ path: string }>> {
    try {
      let path = normalizePath(dailyNotePath(this.data));
      const markdown = buildDailyMarkdown(this.data);
      await this.ensureFolder(this.data.settings.dailyNoteFolder);
      const existing = this.app.vault.getAbstractFileByPath(path);

      if (existing instanceof TFile) {
        const current = await this.app.vault.read(existing);
        if (isDailyCockpitMarkdown(current)) {
          await this.app.vault.modify(existing, markdown);
        } else {
          path = await this.nextAvailableExportPath(path);
          await this.app.vault.create(path, markdown);
        }
      } else if (existing) {
        path = await this.nextAvailableExportPath(path);
        await this.app.vault.create(path, markdown);
      } else {
        await this.app.vault.create(path, markdown);
      }

      const saved = await this.commit((current) => ({ ok: true, data: setLastExportPath(current, path) }), false);
      if (!saved.ok) return { ok: false, error: saved.error };
      this.refreshViews();
      new Notice(`已导出每日简报：${path}`);
      return { ok: true, data: { path } };
    } catch (error) {
      console.error(`[${PLUGIN_ID}] export failed`, error);
      return { ok: false, error: { code: "EXPORT_FAILED", message: "导出失败，请检查目标文件夹权限后重试。" } };
    }
  }

  rendererState(processing: boolean, error?: RendererState["error"]): RendererState {
    return {
      data: this.data,
      processing,
      ...(error ? { error } : {}),
      ...(this.data.lastExportPath ? { exportPath: this.data.lastExportPath } : {})
    };
  }

  private async commit(
    produce: (current: CockpitData) => CockpitResult<CockpitData>,
    refresh = true
  ): Promise<CockpitResult<CockpitData>> {
    try {
      const result = await this.persistence.transact<CockpitResult<CockpitData>>((current) => {
        const candidate = produce(current);
        return candidate.ok
          ? { write: true, data: candidate.data, value: candidate }
          : { write: false, value: candidate };
      });
      if (refresh) this.refreshViews();
      return result;
    } catch (error) {
      console.error(`[${PLUGIN_ID}] save failed`, error);
      return { ok: false, error: { code: "SAVE_FAILED", message: "保存失败，请稍后重试，当前界面内容仍保留。" } };
    }
  }

  private async enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    return this.writeQueue.run(operation);
  }

  private refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DAILY_COCKPIT)) {
      const view = leaf.view;
      if (view instanceof DailyCockpitView) {
        view.refresh();
      }
    }
    this.refreshWhiteboardViews();
  }

  private refreshWhiteboardViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_WHITEBOARD)) {
      const view = leaf.view;
      if (view instanceof AgentWhiteboardView) view.refresh();
    }
  }

  private createRuntimeGateway(): AgentRuntimeGateway {
    return new AgentRuntimeGateway({
      runtimeNodePath: this.data.settings.runtimeNodePath,
      hostPath: this.runtimeHostPath,
      codexCliPath: this.data.settings.codexCliPath,
      processAdapter: createNodeProcessAdapter(),
      environment: process.env
    });
  }

  private async reconfigureRuntimeGateway(): Promise<void> {
    const previous = this.runtimeGateway;
    await previous.beginDispose();
    this.runtimeGateway = this.createRuntimeGateway();
    const views = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_WHITEBOARD)
      .map((leaf) => leaf.view)
      .filter((view): view is AgentWhiteboardView => view instanceof AgentWhiteboardView);
    await Promise.allSettled(views.map((view) => view.rebindRuntimeGateway()));
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    const normalized = normalizePath(folderPath);
    if (!normalized) return;
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFolder) return;

    const parts = normalized.split("/");
    let cursor = "";
    for (const part of parts) {
      cursor = cursor ? `${cursor}/${part}` : part;
      const folder = this.app.vault.getAbstractFileByPath(cursor);
      if (!folder) {
        await this.app.vault.createFolder(cursor);
      }
    }
  }

  private async nextAvailableExportPath(basePath: string): Promise<string> {
    const dotIndex = basePath.lastIndexOf(".");
    const stem = dotIndex > 0 ? basePath.slice(0, dotIndex) : basePath;
    const extension = dotIndex > 0 ? basePath.slice(dotIndex) : ".md";
    let counter = 1;

    while (counter < 100) {
      const suffix = counter === 1 ? "daily-cockpit" : `daily-cockpit-${counter}`;
      const candidate = normalizePath(`${stem}-${suffix}${extension}`);
      if (!this.app.vault.getAbstractFileByPath(candidate)) {
        return candidate;
      }
      counter += 1;
    }

    throw new Error("Could not find an available Daily Cockpit export path");
  }
}

async function resolveInstalledRuntimeHost(runtimeRoot: string): Promise<string> {
  const pointer = JSON.parse(await fs.readFile(`${runtimeRoot}/active.json`, "utf8")) as { version?: unknown };
  if (typeof pointer.version !== "string" || !/^runtime-[a-f0-9]{24}$/.test(pointer.version)) {
    throw new Error("Installed runtime active pointer is invalid.");
  }
  return `${runtimeRoot}/versions/${pointer.version}/pty-host.mjs`;
}

class DailyCockpitView extends ItemView {
  private controller?: RenderController;
  private processing = false;
  private refreshingSessions = false;
  private error?: RendererState["error"];

  constructor(leaf: WorkspaceLeaf, private readonly plugin: DailyCockpitPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_DAILY_COCKPIT;
  }

  getDisplayText(): string {
    return "Daily Cockpit";
  }

  getIcon(): string {
    return "list-checks";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.controller?.destroy();
  }

  refresh(): void {
    this.render();
  }

  private render(): void {
    const state: RendererState = {
      ...this.plugin.rendererState(this.processing, this.error),
      refreshingSessions: this.refreshingSessions
    };
    const actions = {
      decompose: async (input: IntentInput) => {
        this.processing = true;
        this.error = undefined;
        this.render();
        const result = await this.plugin.decomposeIntent(input);
        this.processing = false;
        return this.handleResult(result);
      },
      toggleTaskCompletion: async (taskId: string, completed: boolean) =>
        this.handleResult(await this.plugin.toggleTaskCompletion(taskId, completed)),
      refreshWorkSessions: async () => {
        this.refreshingSessions = true;
        this.error = undefined;
        this.render();
        const result = await this.plugin.refreshWorkSessions();
        this.refreshingSessions = false;
        return this.handleResult(result);
      },
      copyResumeCommand: async (command: string) => copyTextToClipboard(command),
      openLocalPath: async (path: string, reveal = false) => openLocalPath(path, reveal),
      exportDailyNote: async () => {
        const result = await this.plugin.exportDailyNote();
        if (result.ok) {
          this.error = undefined;
          this.render();
        } else {
          this.error = result.error;
          this.render();
        }
        return result;
      },
      clearError: () => {
        this.error = undefined;
        this.render();
      }
    };

    if (!this.controller) {
      this.controller = renderCockpit(this.containerEl, state, actions);
    } else {
      this.controller.update(state);
    }
  }

  private handleResult(result: CockpitResult<CockpitData>): CockpitResult<CockpitData> {
    if (result.ok) {
      this.error = undefined;
    } else {
      this.error = result.error;
    }
    this.render();
    return result;
  }
}

class AgentWhiteboardView extends ItemView implements WhiteboardCommitListener {
  private controller: WhiteboardController | undefined;
  private unsubscribeWhiteboard: (() => void) | undefined;
  private readonly actions = {
    requestProject: () => new WhiteboardProjectModal(this.plugin).open(),
    saveDocument: async (document: GlobalBoardDocument, expectedRevision: number) => (
      this.plugin.saveWhiteboardDocument(document, expectedRevision, this)
    ),
    retryMigration: async () => this.plugin.retryWhiteboardMigration()
  };

  constructor(leaf: WorkspaceLeaf, private readonly plugin: DailyCockpitPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_AGENT_WHITEBOARD;
  }

  getDisplayText(): string {
    return "Agent Whiteboard";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  async onOpen(): Promise<void> {
    this.unsubscribeWhiteboard = this.plugin.whiteboardCommits.subscribe(this);
    this.refresh();
  }

  async onClose(): Promise<void> {
    this.unsubscribeWhiteboard?.();
    this.unsubscribeWhiteboard = undefined;
    await this.controller?.destroy();
    this.controller = undefined;
  }

  async rebindRuntimeGateway(): Promise<void> {
    try {
      await this.controller?.destroy();
    } finally {
      this.controller = undefined;
      this.refresh();
    }
  }

  refresh(): void {
    if (!this.controller) {
      this.controller = renderWhiteboard(
        this.containerEl,
        this.plugin.data.whiteboard,
        this.app,
        this.plugin,
        this.actions,
        this.plugin.runtimeGateway,
        this.plugin.whiteboardMigrationError,
        this.plugin.data.whiteboardRevision
      );
      return;
    }
    this.controller.update(
      this.plugin.data.whiteboard,
      this.plugin.whiteboardMigrationError,
      this.plugin.data.whiteboardRevision
    );
  }

  receiveWhiteboardCommit(document: GlobalBoardDocument, revision: number): void {
    this.controller?.update(document, undefined, revision);
  }

  focusProject(projectId: string): void {
    this.controller?.focusProject(projectId);
  }
}

class WhiteboardProjectModal extends Modal {
  private readonly presenter: WhiteboardProjectModalPresenter;

  constructor(private readonly plugin: DailyCockpitPlugin) {
    super(plugin.app);
    this.presenter = new WhiteboardProjectModalPresenter(new WhiteboardProjectConsumer({
      register: (rootPath, name, signal, onPhase) => plugin.registerWhiteboardProject(rootPath, name, signal, onPhase),
      async publishCommitted(projectId) {
        await plugin.activateWhiteboard();
        for (const leaf of plugin.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_WHITEBOARD)) {
          if (leaf.view instanceof AgentWhiteboardView) leaf.view.focusProject(projectId);
        }
      }
    }));
  }

  onOpen(): void {
    this.presenter.mount(this.contentEl, {
      setTitle: (title) => this.setTitle(title),
      requestClose: () => this.close()
    });
  }

  close(): void {
    if (!this.presenter.requestClose().close) return;
    super.close();
  }

  onClose(): void {
    this.presenter.destroy();
  }
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard?.writeText) {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    // Obsidian desktop may expose Electron clipboard even when the web API is unavailable.
  }

  try {
    const runtimeWindow = globalThis.window as Window & {
      require?: (id: string) => { clipboard?: { writeText(value: string): void } };
    };
    const electron = runtimeWindow.require?.("electron");
    const clipboard = electron?.clipboard;
    if (clipboard) {
      clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the DOM copy path.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

async function openLocalPath(path: string, reveal: boolean): Promise<boolean> {
  try {
    const runtimeWindow = globalThis.window as Window & {
      require?: (id: string) => {
        homedir?: () => string;
        shell?: {
          openPath(value: string): Promise<string>;
          showItemInFolder(value: string): void;
        };
      };
    };
    const os = runtimeWindow.require?.("os");
    const resolved = path === "~" || path.startsWith("~/") ? `${os?.homedir?.() ?? ""}${path.slice(1)}` : path;
    const shell = runtimeWindow.require?.("electron")?.shell;
    if (!shell || !resolved || /[\r\n\0]/.test(resolved)) return false;
    if (reveal) {
      shell.showItemInFolder(resolved);
      return true;
    }
    return (await shell.openPath(resolved)) === "";
  } catch {
    return false;
  }
}

async function resolveProjectDirectory(input: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const runtimeWindow = globalThis.window as Window & {
      require?: (id: string) => unknown;
    };
    const os = runtimeWindow.require?.("os") as { homedir(): string } | undefined;
    const path = runtimeWindow.require?.("path") as { resolve(value: string): string } | undefined;
    const fs = runtimeWindow.require?.("fs") as {
      constants?: { R_OK: number; X_OK: number };
      promises?: {
        realpath(value: string): Promise<string>;
        stat(value: string): Promise<{ isDirectory(): boolean }>;
        access(value: string, mode: number): Promise<void>;
        readdir(value: string): Promise<unknown[]>;
      };
    } | undefined;
    if (!os || !path || !fs?.promises || !fs.constants) return null;
    return resolveCanonicalProjectDirectory(input, {
      homeDirectory: os.homedir(),
      readableSearchableMode: fs.constants.R_OK | fs.constants.X_OK,
      resolve: (value) => path.resolve(value),
      realpath: (value) => fs.promises!.realpath(value),
      stat: (value) => fs.promises!.stat(value),
      access: (value, mode) => fs.promises!.access(value, mode),
      readdir: (value) => fs.promises!.readdir(value)
    }, signal);
  } catch {
    return null;
  }
}

class IntentModal extends Modal {
  private text = "";

  constructor(private readonly plugin: DailyCockpitPlugin) {
    super(plugin.app);
  }

  onOpen(): void {
    this.setTitle("快速拆解待办");

    new Setting(this.contentEl).setName("你想推进什么").addTextArea((text) => {
      text.inputEl.rows = 6;
      text.setPlaceholder("随口说一段目标，本地模型会拆成待办候选。");
      text.onChange((value) => {
        this.text = value;
      });
    });

    new Setting(this.contentEl).addButton((button) => {
      button
        .setButtonText("拆成待办")
        .setCta()
        .onClick(async () => {
          const result = await this.plugin.decomposeIntent({ text: this.text, source: "quick-capture" });
          if (result.ok) {
            new Notice("已拆成待办候选");
            this.close();
            await this.plugin.activateView();
          } else {
            new Notice(result.error.message);
          }
        });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class DailyCockpitSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: DailyCockpitPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Daily Cockpit" });

    new Setting(containerEl)
      .setName("本地模型 endpoint")
      .setDesc("OpenAI-compatible chat completions endpoint。默认指向本机 Ollama 兼容接口。")
      .addText((text) => {
        text.setValue(this.plugin.data.settings.llmEndpoint);
        text.onChange((value) => {
          void this.plugin.updateSettings({ llmEndpoint: value });
        });
      });

    new Setting(containerEl)
      .setName("模型名")
      .setDesc("例如 qwen2.5:7b、qwen3:8b，或你本地服务暴露的模型名。")
      .addText((text) => {
        text.setValue(this.plugin.data.settings.llmModel);
        text.onChange((value) => {
          void this.plugin.updateSettings({ llmModel: value });
        });
      });

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("本地服务通常不需要。若 endpoint 需要鉴权，会以 Bearer token 发送。")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(this.plugin.data.settings.llmApiKey ?? "");
        text.onChange((value) => {
          void this.plugin.updateSettings({ llmApiKey: value });
        });
      });

    new Setting(containerEl)
      .setName("导出文件夹")
      .setDesc("每日简报写入的 vault 内文件夹。")
      .addText((text) => {
        text.setValue(this.plugin.data.settings.dailyNoteFolder);
        text.onChange((value) => {
          void this.plugin.updateSettings({ dailyNoteFolder: value });
        });
      });

    containerEl.createEl("h3", { text: "会话读取来源" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "各平台独立只读，可以同时启用、只启用一个，或全部关闭。"
    });
    for (const provider of SESSION_PROVIDER_DEFINITIONS) {
      new Setting(containerEl)
        .setName(provider.label)
        .setDesc(provider.description)
        .addToggle((toggle) => {
          toggle
            .setValue(this.plugin.data.settings.enabledSessionProviders.includes(provider.id))
            .onChange(async (enabled) => {
              const selected = new Set(this.plugin.data.settings.enabledSessionProviders);
              if (enabled) selected.add(provider.id);
              else selected.delete(provider.id);
              await this.plugin.updateSettings({
                enabledSessionProviders: SESSION_PROVIDER_DEFINITIONS
                  .map(({ id }) => id)
                  .filter((id) => selected.has(id))
              });
            });
        });
    }

    new Setting(containerEl)
      .setName("工作会话扫描目录")
      .setDesc("一行一个本机路径。这里只读取 ID、时间、工作目录和会话文件位置，正文总结交给对应 Agent。")
      .addTextArea((text) => {
        text.inputEl.rows = 5;
        text.setValue(this.plugin.data.settings.sessionScanRoots.join("\n"));
        text.onChange((value) => {
          void this.plugin.updateSettings({
            sessionScanRoots: value
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean)
          });
        });
      });

    new Setting(containerEl)
      .setName("昨日会话总结")
      .setDesc("平台 CLI 模式会在点击刷新时，让 Codex 总结 Codex 会话、Claude Code 总结 Claude 会话；不会在启动时自动调用。")
      .addDropdown((dropdown) => {
        dropdown.addOption("native", "平台 CLI 总结");
        dropdown.addOption("metadata", "仅显示元数据");
        dropdown.setValue(this.plugin.data.settings.sessionSummaryMode);
        dropdown.onChange((value) => {
          void this.plugin.updateSettings({ sessionSummaryMode: value === "metadata" ? "metadata" : "native" });
        });
      });

    new Setting(containerEl)
      .setName("System Node")
      .setDesc("用于独立 PTY companion 的 Node 可执行文件名或绝对路径。Electron 不会加载原生 PTY 模块。")
      .addText((text) => {
        text.setValue(this.plugin.data.settings.runtimeNodePath);
        text.onChange((value) => {
          void this.plugin.updateSettings({ runtimeNodePath: value });
        });
      });

    new Setting(containerEl)
      .setName("Codex CLI")
      .setDesc("可执行文件名或绝对路径。macOS GUI 会自动补充 ~/.local/bin、Homebrew 和系统 PATH。")
      .addText((text) => {
        text.setValue(this.plugin.data.settings.codexCliPath);
        text.onChange((value) => {
          void this.plugin.updateSettings({ codexCliPath: value });
        });
      });

    new Setting(containerEl)
      .setName("Claude Code CLI")
      .setDesc("可执行文件名或绝对路径。留作对应 Claude Code 会话的只读总结。")
      .addText((text) => {
        text.setValue(this.plugin.data.settings.claudeCliPath);
        text.onChange((value) => {
          void this.plugin.updateSettings({ claudeCliPath: value });
        });
      });
  }
}
