import {
  WhiteboardProjectModalSession,
  type ProjectRegistrationOutcome,
  type ProjectRegistrationPhase
} from "./state";

export interface WhiteboardProjectConsumerAdapter {
  register(
    rootPath: string,
    name: string,
    signal: AbortSignal,
    onPhase: (phase: ProjectRegistrationPhase) => void
  ): Promise<ProjectRegistrationOutcome>;
  publishCommitted(projectId: string): Promise<void> | void;
}

export class WhiteboardProjectConsumer {
  constructor(private readonly adapter: WhiteboardProjectConsumerAdapter) {}

  createSession(): WhiteboardProjectModalSession {
    return new WhiteboardProjectModalSession((rootPath, name, signal, onPhase) => (
      this.adapter.register(rootPath, name, signal, onPhase)
    ));
  }

  publishCommitted(projectId: string): Promise<void> {
    return Promise.resolve(this.adapter.publishCommitted(projectId));
  }
}

export interface WhiteboardProjectModalHost {
  setTitle(title: string): void;
  requestClose(): void;
}

let presenterSequence = 0;

export class WhiteboardProjectModalPresenter {
  private readonly session: WhiteboardProjectModalSession;
  private errorElement: HTMLElement | undefined;
  private container: HTMLElement | undefined;

  constructor(private readonly consumer: WhiteboardProjectConsumer) {
    this.session = consumer.createSession();
  }

  get completed(): boolean {
    return this.session.completed;
  }

  mount(container: HTMLElement, host: WhiteboardProjectModalHost): void {
    this.container = container;
    host.setTitle("添加项目");
    const sequence = ++presenterSequence;
    const rootInput = this.createTextSetting(
      container,
      `whiteboard-project-root-${sequence}`,
      "项目路径",
      "输入本机项目文件夹的绝对路径，也可以使用 ~/ 开头的路径。",
      "~/Documents/project"
    );
    const nameInput = this.createTextSetting(
      container,
      `whiteboard-project-name-${sequence}`,
      "显示名称",
      "留空时使用文件夹名称。"
    );
    const errorElement = document.createElement("div");
    errorElement.className = "agent-whiteboard-project-error";
    errorElement.setAttribute("role", "alert");
    errorElement.hidden = true;
    this.errorElement = errorElement;

    const actions = document.createElement("div");
    actions.className = "setting-item agent-whiteboard-project-actions";
    const submitButton = document.createElement("button");
    submitButton.className = "mod-cta";
    submitButton.type = "button";
    submitButton.textContent = "添加项目";
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "取消";
    cancelButton.addEventListener("click", () => host.requestClose());
    submitButton.addEventListener("click", () => {
      if (this.session.pending) return;
      rootInput.disabled = true;
      nameInput.disabled = true;
      submitButton.disabled = true;
      submitButton.textContent = "正在验证…";
      errorElement.hidden = true;
      void this.session.submit(rootInput.value, nameInput.value).then(async (result) => {
        if (!container.isConnected) return;
        if (!result.ok) {
          rootInput.disabled = false;
          nameInput.disabled = false;
          submitButton.disabled = false;
          submitButton.textContent = "添加项目";
          errorElement.textContent = result.message;
          errorElement.hidden = false;
          rootInput.focus();
          return;
        }
        host.requestClose();
        await this.consumer.publishCommitted(result.projectId);
      });
    });
    actions.append(submitButton, cancelButton);
    container.append(errorElement, actions);
    rootInput.focus();
  }

  requestClose(): { close: boolean; message?: string } {
    const decision = this.session.requestClose();
    if (!decision.close) {
      if (this.errorElement) {
        this.errorElement.textContent = decision.message ?? "正在保存项目，完成后将自动关闭。";
        this.errorElement.hidden = false;
      }
    }
    return decision;
  }

  destroy(): void {
    this.session.requestClose();
    this.container?.replaceChildren();
    this.container = undefined;
    this.errorElement = undefined;
  }

  private createTextSetting(
    container: HTMLElement,
    id: string,
    name: string,
    description: string,
    placeholder = ""
  ): HTMLInputElement {
    const setting = document.createElement("div");
    setting.className = "setting-item";
    const info = document.createElement("div");
    info.className = "setting-item-info";
    const label = document.createElement("label");
    label.className = "setting-item-name";
    label.htmlFor = id;
    label.textContent = name;
    const descriptionElement = document.createElement("div");
    descriptionElement.className = "setting-item-description";
    descriptionElement.textContent = description;
    info.append(label, descriptionElement);
    const control = document.createElement("div");
    control.className = "setting-item-control";
    const input = document.createElement("input");
    input.id = id;
    input.type = "text";
    input.placeholder = placeholder;
    control.append(input);
    setting.append(info, control);
    container.append(setting);
    return input;
  }
}
