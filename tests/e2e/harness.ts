import { renderCockpit } from "../../src/render";
import { addPlanFromModelTasks, createEmptyData, createSeedData, setLastExportPath, toggleHotStartTask } from "../../src/state";
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

function createLongListData(): CockpitData {
  const longPhrase =
    "这是一个非常长的待办描述，用来模拟用户把复杂任务、背景、约束、验证标准和热启动建议全部说在一起，必须换行且不能撑破屏幕范围。";
  const tasks: ModelTask[] = Array.from({ length: 18 }, (_, index) => ({
    title: `长待办 ${index + 1}：${longPhrase} keep-this-unbroken-token-wrapping-without-horizontal-overflow-${index}`,
    detail: `${longPhrase} 需要继续补充上下文、明确交付物、列出验收方式，并保留足够多的文字来触发滚动区域。${longPhrase}`,
    category: index % 2 === 0 ? "analysis" : "build",
    priority: index < 3 ? "P0" : "P1",
    warmStart: `热启动建议 ${index + 1}：${longPhrase} 明天打开时应该先准备资料、链接、命令和失败日志。${longPhrase}`,
    selectedForHotStart: index < 12
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
