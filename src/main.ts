import {
  App,
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
import {
  COMMAND_EXPORT_DAILY_NOTE,
  COMMAND_OPEN_COCKPIT,
  COMMAND_QUICK_CAPTURE,
  COMMAND_REFRESH_WORK_SESSIONS,
  PLUGIN_ID,
  VIEW_TYPE_DAILY_COCKPIT
} from "./constants";
import { loadAgentWorkSnapshot } from "./agent-sessions";
import { createCliSessionSummarizer } from "./agent-summary";
import { buildDailyMarkdown, dailyNotePath, isDailyCockpitMarkdown } from "./export";
import { requestTaskDecomposition } from "./llm";
import {
  addPlanFromModelTasks,
  normalizeData,
  setLastExportPath,
  setWorkSessionSnapshot,
  toggleTaskCompletion,
  touchOpened
} from "./state";
import { renderCockpit } from "./render";
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
  private writeQueue: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
    this.data = touchOpened(normalizeData(await this.loadData()));
    await this.saveCockpitData(this.data);

    this.registerView(VIEW_TYPE_DAILY_COCKPIT, (leaf) => new DailyCockpitView(leaf, this));
    this.addSettingTab(new DailyCockpitSettingTab(this.app, this));

    this.addRibbonIcon("list-checks", "打开 Daily Cockpit", () => {
      void this.activateView();
    });

    this.addCommand({
      id: COMMAND_OPEN_COCKPIT,
      name: "打开 Daily Cockpit",
      callback: () => {
        void this.activateView();
      }
    });

    this.addCommand({
      id: COMMAND_QUICK_CAPTURE,
      name: "快速拆解待办",
      callback: () => {
        new IntentModal(this).open();
      }
    });

    this.addCommand({
      id: COMMAND_EXPORT_DAILY_NOTE,
      name: "导出每日简报",
      callback: () => {
        void this.exportDailyNote();
      }
    });

    this.addCommand({
      id: COMMAND_REFRESH_WORK_SESSIONS,
      name: "刷新昨日工作会话",
      callback: () => {
        void this.refreshWorkSessions();
      }
    });

  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_DAILY_COCKPIT);
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

  async decomposeIntent(input: IntentInput): Promise<CockpitResult<CockpitData>> {
    return this.enqueueWrite(async () => {
      const decomposition = await requestTaskDecomposition(this.data.settings, input.text);
      if (!decomposition.ok) return decomposition;
      return this.commit(
        addPlanFromModelTasks(
          this.data,
          input.text,
          decomposition.data.tasks,
          decomposition.data.model ?? this.data.settings.llmModel,
          input.source
        )
      );
    });
  }

  async toggleTaskCompletion(taskId: string, completed: boolean): Promise<CockpitResult<CockpitData>> {
    return this.enqueueWrite(() => this.commit(toggleTaskCompletion(this.data, taskId, completed)));
  }

  async updateSettings(settings: Partial<CockpitSettings>): Promise<void> {
    const nextData = normalizeData({
      ...this.data,
      settings: {
        ...this.data.settings,
        ...settings
      }
    });
    await this.saveCockpitData(nextData);
    this.data = nextData;
    this.refreshViews();
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
        const result = await this.commit({ ok: true, data: setWorkSessionSnapshot(this.data, snapshot) });
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

      const nextData = setLastExportPath(this.data, path);
      await this.saveCockpitData(nextData);
      this.data = nextData;
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

  private async commit(result: CockpitResult<CockpitData>): Promise<CockpitResult<CockpitData>> {
    if (!result.ok) return result;
    try {
      const nextData = result.data;
      await this.saveCockpitData(nextData);
      this.data = nextData;
      this.refreshViews();
      return result;
    } catch (error) {
      console.error(`[${PLUGIN_ID}] save failed`, error);
      return { ok: false, error: { code: "SAVE_FAILED", message: "保存失败，请稍后重试，当前界面内容仍保留。" } };
    }
  }

  private async saveCockpitData(data: CockpitData): Promise<void> {
    await this.saveData(normalizeData(data));
  }

  private async enqueueWrite<T>(operation: () => Promise<CockpitResult<T>>): Promise<CockpitResult<T>> {
    const run = this.writeQueue.then(operation, operation);
    this.writeQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DAILY_COCKPIT)) {
      const view = leaf.view;
      if (view instanceof DailyCockpitView) {
        view.refresh();
      }
    }
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
