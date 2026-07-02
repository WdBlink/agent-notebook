import {
  ItemView,
  Modal,
  Notice,
  Plugin,
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
  PLUGIN_ID,
  VIEW_TYPE_DAILY_COCKPIT
} from "./constants";
import { buildDailyMarkdown, dailyNotePath, isDailyCockpitMarkdown } from "./export";
import { archiveItem, captureItem, completeItem, moveItem, normalizeData, setLastExportPath, touchOpened } from "./state";
import { renderCockpit } from "./render";
import type {
  CaptureInput,
  CockpitData,
  CockpitItemState,
  CockpitResult,
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

    this.addRibbonIcon("layout-dashboard", "打开每日启动台", () => {
      void this.activateView();
    });

    this.addCommand({
      id: COMMAND_OPEN_COCKPIT,
      name: "打开每日启动台",
      callback: () => {
        void this.activateView();
      }
    });

    this.addCommand({
      id: COMMAND_QUICK_CAPTURE,
      name: "快速捕捉到灵感收纳箱",
      callback: () => {
        new QuickCaptureModal(this).open();
      }
    });

    this.addCommand({
      id: COMMAND_EXPORT_DAILY_NOTE,
      name: "导出今日启动台笔记",
      callback: () => {
        void this.exportDailyNote();
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

  async capture(input: CaptureInput): Promise<CockpitResult<CockpitData>> {
    return this.enqueueWrite(() => this.commit(captureItem(this.data, input)));
  }

  async move(id: string, state: CockpitItemState): Promise<CockpitResult<CockpitData>> {
    return this.enqueueWrite(() => this.commit(moveItem(this.data, id, state)));
  }

  async complete(id: string): Promise<CockpitResult<CockpitData>> {
    return this.enqueueWrite(() => this.commit(completeItem(this.data, id)));
  }

  async archive(id: string): Promise<CockpitResult<CockpitData>> {
    return this.enqueueWrite(() => this.commit(archiveItem(this.data, id)));
  }

  async exportDailyNote(): Promise<CockpitResult<{ path: string }>> {
    return this.enqueueWrite(() => this.exportDailyNoteLocked());
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
      new Notice(`已导出每日启动台：${path}`);
      return { ok: true, data: { path } };
    } catch (error) {
      console.error(`[${PLUGIN_ID}] export failed`, error);
      return { ok: false, error: { code: "EXPORT_FAILED", message: "导出失败，请检查目标文件夹权限后重试。" } };
    }
  }

  rendererState(activeSection: RendererState["activeSection"], error?: RendererState["error"]): RendererState {
    return {
      data: this.data,
      activeSection,
      loading: false,
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
  private activeSection: RendererState["activeSection"] = "today";
  private error?: RendererState["error"];

  constructor(leaf: WorkspaceLeaf, private readonly plugin: DailyCockpitPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_DAILY_COCKPIT;
  }

  getDisplayText(): string {
    return "每日启动台";
  }

  getIcon(): string {
    return "layout-dashboard";
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
    const state = this.plugin.rendererState(this.activeSection, this.error);
    const actions = {
      capture: async (input: CaptureInput) => this.handleResult(await this.plugin.capture(input), "inbox"),
      move: async (id: string, target: CockpitItemState) => this.handleResult(await this.plugin.move(id, target), target),
      complete: async (id: string) => this.handleResult(await this.plugin.complete(id), "done"),
      archive: async (id: string) => this.handleResult(await this.plugin.archive(id), "archive"),
      exportDailyNote: async () => {
        const result = await this.plugin.exportDailyNote();
        if (result.ok) {
          this.error = undefined;
          this.activeSection = "export";
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

  private handleResult(result: CockpitResult<CockpitData>, section: RendererState["activeSection"]): CockpitResult<CockpitData> {
    if (result.ok) {
      this.error = undefined;
      this.activeSection = section;
    } else {
      this.error = result.error;
    }
    this.render();
    return result;
  }
}

class QuickCaptureModal extends Modal {
  private body = "";
  private context = "";

  constructor(private readonly plugin: DailyCockpitPlugin) {
    super(plugin.app);
  }

  onOpen(): void {
    this.setTitle("快速捕捉到灵感收纳箱");

    new Setting(this.contentEl).setName("内容").addTextArea((text) => {
      text.inputEl.rows = 5;
      text.setPlaceholder("先写下来，今天不一定要处理。");
      text.onChange((value) => {
        this.body = value;
      });
    });

    new Setting(this.contentEl).setName("上下文").addText((text) => {
      text.setPlaceholder("项目、文件或会话线索");
      text.onChange((value) => {
        this.context = value;
      });
    });

    new Setting(this.contentEl).addButton((button) => {
      button
        .setButtonText("先替我记着")
        .setCta()
        .onClick(async () => {
          const result = await this.plugin.capture({ body: this.body, context: this.context });
          if (result.ok) {
            new Notice("已放入灵感收纳箱");
            this.close();
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
