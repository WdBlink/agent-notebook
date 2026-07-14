import { ERROR_MESSAGES } from "./constants";
import type { CockpitError, CockpitResult, ModelDecomposition, ModelTask } from "./types";

export function buildUserPrompt(intent: string): string {
  return [
    "把下面这段自然语言意图拆成明天可执行的待办候选。",
    "",
    "拆解规则：",
    "- 不要做通用任务管理，不要创造 inbox/today/now 等状态。",
    "- 每条待办必须能独立执行。",
    "- warmStart 写成睡前可让 AI 先做的准备动作。",
    "- selectedForHotStart 只有在非常适合后台预研/跑实验/读资料时才设为 true。",
    "- P0 表示明天必须接上的关键任务，P1 表示重要但可调整，P2 表示可选。",
    "",
    "用户意图：",
    intent
  ].join("\n");
}

export function parseDecompositionContent(content: string, model?: string): CockpitResult<ModelDecomposition> {
  try {
    const payload = JSON.parse(extractJson(content)) as Partial<ModelDecomposition>;
    const tasks = Array.isArray(payload.tasks) ? payload.tasks.filter(isModelTask) : [];
    if (tasks.length === 0) {
      return failure("NO_TASKS", ERROR_MESSAGES.noTasks);
    }
    return {
      ok: true,
      data: {
        tasks,
        ...(typeof payload.model === "string" ? { model: payload.model } : model ? { model } : {})
      }
    };
  } catch {
    return failure("LLM_PARSE_FAILED", ERROR_MESSAGES.llmParseFailed);
  }
}

export function extractModelContent(payload: unknown): string {
  const data = payload as {
    choices?: Array<{ message?: { content?: string }; text?: string }>;
    message?: { content?: string };
    response?: string;
  };

  return (
    data.choices?.[0]?.message?.content ??
    data.choices?.[0]?.text ??
    data.message?.content ??
    data.response ??
    JSON.stringify(payload)
  );
}

function extractJson(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  if (candidate.startsWith("{") && candidate.endsWith("}")) return candidate;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return candidate.slice(start, end + 1);
  }
  return candidate;
}

function isModelTask(task: unknown): task is ModelTask {
  if (!task || typeof task !== "object") return false;
  const candidate = task as Partial<ModelTask>;
  return typeof candidate.title === "string" || typeof candidate.detail === "string";
}

function failure(code: CockpitError["code"], message: string): CockpitResult<never> {
  return { ok: false, error: { code, message } };
}
