import { renderCockpit } from "../../src/render";
import { addPlanFromModelTasks, createSeedData, setLastExportPath, toggleHotStartTask } from "../../src/state";
import type { CockpitData, RendererState } from "../../src/types";

let data: CockpitData = createSeedData();
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
          priority: "P0",
          warmStart: "提前读取项目文档并生成概念表。",
          selectedForHotStart: true
        },
        {
          title: "尝试跑 demo",
          detail: "安装依赖，记录能否启动和失败原因。",
          category: "build",
          priority: "P1",
          warmStart: "准备运行命令和失败日志。",
          selectedForHotStart: false
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
  async toggleHotStart(taskId, selected) {
    const result = toggleHotStartTask(data, taskId, selected, "2026-07-03T08:05:00.000Z");
    if (result.ok) {
      data = result.data;
      update({ data, processing: false });
    }
    return result;
  },
  async exportDailyNote() {
    const path = "Daily Cockpit/2026-07-03.md";
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
