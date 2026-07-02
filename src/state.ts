import { DEFAULT_SETTINGS, ERROR_MESSAGES } from "./constants";
import type {
  CaptureInput,
  CockpitData,
  CockpitError,
  CockpitItem,
  CockpitItemState,
  CockpitResult,
  CockpitSettings
} from "./types";

const VALID_STATES: CockpitItemState[] = ["inbox", "hold", "soon", "today", "now", "done", "archive"];

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(prefix = "item"): string {
  const random = Math.random().toString(36).slice(2, 9);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function createEmptyData(settings: Partial<CockpitSettings> = {}): CockpitData {
  return {
    schemaVersion: 1,
    settings: normalizeSettings(settings),
    items: []
  };
}

export function normalizeData(input: unknown): CockpitData {
  if (!input || typeof input !== "object") {
    return createEmptyData();
  }

  const source = input as Partial<CockpitData>;
  const settings = normalizeSettings(source.settings);

  const items = Array.isArray(source.items)
    ? source.items
        .filter(isPartialItem)
        .map((item) => ({
          id: item.id,
          title: item.title.trim() || "未命名想法",
          body: item.body ?? "",
          state: VALID_STATES.includes(item.state) ? item.state : "inbox",
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          ...(item.completedAt ? { completedAt: item.completedAt } : {}),
          ...(item.source ? { source: item.source } : {}),
          ...(item.context ? { context: item.context } : {}),
          ...(Array.isArray(item.tags) ? { tags: item.tags.filter((tag): tag is string => typeof tag === "string") } : {})
        }))
    : [];

  return {
    schemaVersion: 1,
    settings,
    items,
    ...(source.lastOpenedAt ? { lastOpenedAt: source.lastOpenedAt } : {}),
    ...(source.lastExportPath ? { lastExportPath: source.lastExportPath } : {})
  };
}

function isPartialItem(item: unknown): item is CockpitItem {
  if (!item || typeof item !== "object") return false;
  const candidate = item as Partial<CockpitItem>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.body === "string" &&
    typeof candidate.state === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

export function createSeedData(): CockpitData {
  const timestamp = "2026-07-02T08:00:00.000Z";
  return {
    ...createEmptyData(),
    items: [
      {
        id: "seed-a",
        title: "早上 3 分钟接上昨天的自己",
        body: "把昨天散落在 Codeian 和 Codex 里的进展先收拢，不急着开新坑。",
        state: "today",
        createdAt: timestamp,
        updatedAt: timestamp,
        context: "LLM-Wiki/raw/notes/2026-07-02 每日看板的idea.md"
      },
      {
        id: "seed-b",
        title: "研究 Obsidian 全窗口 View API",
        body: "先确认 custom view、ribbon、commands 三件事能独立工作。",
        state: "now",
        createdAt: timestamp,
        updatedAt: timestamp,
        context: "Daily Cockpit"
      },
      {
        id: "seed-c",
        title: "想到一个语音捕捉入口",
        body: "先放着，V1 不做语音，避免变成另一个收件箱压力源。",
        state: "hold",
        createdAt: timestamp,
        updatedAt: timestamp,
        context: "灵感"
      },
      {
        id: "seed-d",
        title: "很长的灵感文本",
        body:
          "这是一段超过 160 个中文字符的长文本，用来验证卡片摘要、换行、按钮布局和移动端宽度不会互相挤压。内容继续描述：有时候想法会带着很多背景、担心和路径，如果 UI 逼迫我立刻分类，就会增加压力，所以它应该先被安全接住。",
        state: "inbox",
        createdAt: timestamp,
        updatedAt: timestamp,
        context: "移动端测试"
      },
      {
        id: "seed-e",
        title: "完成 README 第一屏",
        body: "公开页面必须让陌生人 10 秒内知道这是本地优先的 ADHD 工作记忆。",
        state: "done",
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: "2026-07-02T10:30:00.000Z",
        context: "发布"
      }
    ]
  };
}

export function countByState(data: CockpitData, state: CockpitItemState): number {
  return data.items.filter((item) => item.state === state).length;
}

export function captureItem(data: CockpitData, input: CaptureInput, timestamp = nowIso()): CockpitResult<CockpitData> {
  const body = input.body.trim();
  const title = (input.title ?? firstLine(body)).trim();

  if (!body && !title) {
    return failure("EMPTY_CAPTURE", ERROR_MESSAGES.emptyCapture);
  }

  const item: CockpitItem = {
    id: createId("capture"),
    title: title || "未命名想法",
    body,
    state: "inbox",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(input.context?.trim() ? { context: input.context.trim() } : {}),
    ...(input.source?.trim() ? { source: input.source.trim() } : {}),
    ...(input.tags?.length ? { tags: input.tags } : {})
  };

  return success({
    ...data,
    items: [item, ...data.items]
  });
}

export function moveItem(
  data: CockpitData,
  id: string,
  state: CockpitItemState,
  timestamp = nowIso()
): CockpitResult<CockpitData> {
  if (!VALID_STATES.includes(state)) {
    return failure("INVALID_STATE", ERROR_MESSAGES.invalidState);
  }

  const item = data.items.find((candidate) => candidate.id === id);
  if (!item) {
    return failure("ITEM_NOT_FOUND", ERROR_MESSAGES.itemNotFound);
  }

  const nextItems = data.items.map((candidate) => {
    if (state === "now" && candidate.state === "now" && candidate.id !== id) {
      return {
        ...candidate,
        state: "today" as const,
        updatedAt: timestamp
      };
    }

    if (candidate.id !== id) return candidate;

    const moved = {
      ...candidate,
      state,
      updatedAt: timestamp
    };

    if (state === "done") {
      return {
        ...moved,
        completedAt: timestamp
      };
    }

    const { completedAt: _completedAt, ...withoutCompletedAt } = moved;
    return withoutCompletedAt;
  });

  const projectedTodayCount = nextItems.filter((candidate) => candidate.state === "today").length;
  if (projectedTodayCount > data.settings.todayLimit) {
    return failure("TODAY_LIMIT_REACHED", ERROR_MESSAGES.todayLimitReached);
  }

  return success({
    ...data,
    items: nextItems
  });
}

export function completeItem(data: CockpitData, id: string, timestamp = nowIso()): CockpitResult<CockpitData> {
  return moveItem(data, id, "done", timestamp);
}

export function archiveItem(data: CockpitData, id: string, timestamp = nowIso()): CockpitResult<CockpitData> {
  return moveItem(data, id, "archive", timestamp);
}

export function touchOpened(data: CockpitData, timestamp = nowIso()): CockpitData {
  return {
    ...data,
    lastOpenedAt: timestamp
  };
}

export function setLastExportPath(data: CockpitData, path: string): CockpitData {
  return {
    ...data,
    lastExportPath: path
  };
}

export function itemsForState(data: CockpitData, state: CockpitItemState): CockpitItem[] {
  return data.items
    .filter((item) => item.state === state)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0]?.slice(0, 48) ?? "";
}

function normalizeSettings(input: unknown): CockpitSettings {
  if (!input || typeof input !== "object") {
    return { ...DEFAULT_SETTINGS };
  }

  const settings = input as Partial<CockpitSettings>;
  const dailyNoteFolder =
    typeof settings.dailyNoteFolder === "string" && settings.dailyNoteFolder.trim()
      ? settings.dailyNoteFolder.trim().replace(/^\/+|\/+$/g, "")
      : DEFAULT_SETTINGS.dailyNoteFolder;

  const todayLimit =
    typeof settings.todayLimit === "number" && Number.isInteger(settings.todayLimit)
      ? Math.min(Math.max(settings.todayLimit, 1), 12)
      : DEFAULT_SETTINGS.todayLimit;

  return {
    dailyNoteFolder,
    todayLimit
  };
}

function success<T>(data: T): CockpitResult<T> {
  return { ok: true, data };
}

function failure(code: CockpitError["code"], message: string): CockpitResult<never> {
  return { ok: false, error: { code, message } };
}
