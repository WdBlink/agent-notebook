import { renderCockpit } from "../../src/render";
import {
  addPlanFromModelTasks,
  createEmptyData,
  createSeedData,
  setLastExportPath,
  setWorkSessionSnapshot,
  toggleTaskCompletion
} from "../../src/state";
import type { CockpitData, ModelTask, RendererState } from "../../src/types";

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

const controller = renderCockpit(root, state, {
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
    (window as Window & { dailyCockpitCopiedResumeCommand?: string }).dailyCockpitCopiedResumeCommand = command;
    return true;
  },
  async openLocalPath(path, reveal) {
    (window as Window & { dailyCockpitOpenedPath?: string }).dailyCockpitOpenedPath = `${reveal ? "reveal" : "open"}:${path}`;
    return true;
  },
  async exportDailyNote() {
    const path = "Daily Cockpit/2026-07-04.md";
    data = setLastExportPath(data, path);
    update({ data, processing: false, exportPath: path });
    return { ok: true, data: { path } };
  },
  clearError() {
    const { error: _error, ...withoutError } = state;
    update(withoutError);
  }
});

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
