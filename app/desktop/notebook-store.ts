import path from "node:path";
import { buildResumeCommand } from "../../src/resume";
import type { AgentSessionStatus, AgentWorkSession } from "../../src/types";
import { normalizeDailyReviewPackage, type DailyReviewPackage } from "../../src/workline-review";
import type {
  DailyContinuationBookmark,
  DailyDraftInput,
  DailyNotebookPage,
  DailyWorklineReflection,
  DailyWorkRecord,
  DesktopNotebookState,
  NotebookNote,
  NotebookNoteDelivery,
  NotebookNoteInput
} from "./api";

export interface NotebookDocument {
  schemaVersion: 1;
  knowledgeRoot: string;
  notes: NotebookNote[];
  pages: Record<string, DailyNotebookPage>;
}

export const DEFAULT_KNOWLEDGE_ROOT = "~/Knowledge/Obsidian/LLM-Wiki";

export function createEmptyNotebookDocument(knowledgeRoot = DEFAULT_KNOWLEDGE_ROOT): NotebookDocument {
  return { schemaVersion: 1, knowledgeRoot, notes: [], pages: {} };
}

export function normalizeNotebookDocument(value: unknown): NotebookDocument {
  const fallback = createEmptyNotebookDocument();
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Partial<NotebookDocument>;
  const knowledgeRoot = cleanText(raw.knowledgeRoot, 2_000) || fallback.knowledgeRoot;
  const notes = uniqueNotes(Array.isArray(raw.notes) ? raw.notes.map(normalizeNote).filter((note): note is NotebookNote => Boolean(note)) : []);
  const pages: Record<string, DailyNotebookPage> = {};
  if (raw.pages && typeof raw.pages === "object") {
    for (const [date, page] of Object.entries(raw.pages)) {
      if (!isDate(date)) continue;
      const normalized = normalizePage(page, date);
      if (normalized.status !== "unformed") pages[date] = normalized;
    }
  }
  return { schemaVersion: 1, knowledgeRoot, notes, pages };
}

export function notebookStateForDate(document: NotebookDocument, date: string, sessions: AgentWorkSession[]): DesktopNotebookState {
  const logicalDate = isDate(date) ? date : localDate();
  const previewRecords = compileWorkRecords(sessions);
  const stored = document.pages[logicalDate];
  const page = stored ? clonePage(stored) : emptyPage(logicalDate);
  const candidates = uniqueBookmarks([...page.bookmarks, ...continuationCandidates(sessions)]);
  const pendingPreviousDates = Object.values(document.pages)
    .filter((item) => item.logicalDate < logicalDate && item.status === "draft")
    .map((item) => item.logicalDate)
    .sort((a, b) => b.localeCompare(a));
  const latestSealedDate = Object.values(document.pages)
    .filter((item) => item.status === "sealed")
    .map((item) => item.logicalDate)
    .sort((a, b) => b.localeCompare(a))[0];
  return {
    notes: document.notes.filter((note) => note.logicalDate === logicalDate).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(cloneNote),
    page,
    previewRecords,
    continuationCandidates: candidates,
    knowledgeRoot: document.knowledgeRoot,
    knowledgeRawPath: path.join(document.knowledgeRoot, "raw"),
    pendingPreviousDates,
    ...(latestSealedDate ? { latestSealedDate } : {})
  };
}

export function setKnowledgeRoot(document: NotebookDocument, knowledgeRoot: string): NotebookDocument {
  const clean = cleanText(knowledgeRoot, 2_000);
  if (!clean || /[\r\n\0]/.test(clean)) throw new Error("知识库根目录无效。");
  return { ...document, knowledgeRoot: clean };
}

export function createNotebookNote(
  document: NotebookDocument,
  logicalDate: string,
  input: NotebookNoteInput,
  now = new Date(),
  id = `note-${now.getTime().toString(36)}`
): NotebookDocument {
  if (!isDate(logicalDate)) throw new Error("便签日期无效。");
  const body = cleanText(input.body, 24_000);
  if (!body) throw new Error("便签不能为空。");
  const title = cleanText(input.title, 160) || inferTitle(body);
  const source = inferSource(body);
  const timestamp = now.toISOString();
  const note: NotebookNote = {
    id,
    logicalDate,
    createdAt: timestamp,
    updatedAt: timestamp,
    title,
    body,
    kind: source.kind,
    sourceLabel: source.label,
    favorite: false,
    deliveries: []
  };
  return { ...document, notes: [...document.notes, note] };
}

export function updateNotebookNote(
  document: NotebookDocument,
  noteId: string,
  patch: Partial<Pick<NotebookNote, "title" | "body" | "favorite">>,
  now = new Date()
): NotebookDocument {
  let found = false;
  const notes = document.notes.map((note) => {
    if (note.id !== noteId) return note;
    found = true;
    const body = patch.body === undefined ? note.body : cleanText(patch.body, 24_000);
    if (!body) throw new Error("便签不能为空。");
    const source = inferSource(body);
    return {
      ...note,
      title: patch.title === undefined ? note.title : cleanText(patch.title, 160) || inferTitle(body),
      body,
      kind: source.kind,
      sourceLabel: source.label,
      favorite: patch.favorite ?? note.favorite,
      updatedAt: now.toISOString()
    };
  });
  if (!found) throw new Error("没有找到这条便签。");
  return { ...document, notes };
}

export function deleteNotebookNote(document: NotebookDocument, noteId: string): NotebookDocument {
  const notes = document.notes.filter((note) => note.id !== noteId);
  if (notes.length === document.notes.length) throw new Error("没有找到这条便签。");
  return { ...document, notes };
}

export function markNotebookDelivery(
  document: NotebookDocument,
  noteId: string,
  delivery: NotebookNoteDelivery
): NotebookDocument {
  let found = false;
  const notes = document.notes.map((note) => {
    if (note.id !== noteId) return note;
    found = true;
    return { ...note, deliveries: [...note.deliveries, delivery], updatedAt: delivery.deliveredAt };
  });
  if (!found) throw new Error("没有找到这条便签。");
  return { ...document, notes };
}

export function composeDailyPage(
  document: NotebookDocument,
  logicalDate: string,
  sessions: AgentWorkSession[],
  now = new Date(),
  reviewPackage?: DailyReviewPackage
): NotebookDocument {
  if (!isDate(logicalDate)) throw new Error("手帐日期无效。");
  const existing = document.pages[logicalDate];
  if (existing?.status === "sealed") throw new Error("这一天已经封页，不能重新整理。");
  const timestamp = now.toISOString();
  const exactReviewPackage = existing?.reviewPackage ?? (reviewPackage ? structuredClone(reviewPackage) : undefined);
  const page: DailyNotebookPage = {
    schemaVersion: exactReviewPackage ? 2 : 1,
    logicalDate,
    status: "draft",
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    evidenceCutoff: timestamp,
    workRecords: existing?.workRecords.length ? existing.workRecords : compileWorkRecords(sessions),
    reflection: existing?.reflection ?? "",
    ...(exactReviewPackage ? { reviewPackage: exactReviewPackage } : {}),
    worklineReflections: existing?.worklineReflections ?? [],
    bookmarks: existing?.bookmarks ?? []
  };
  return { ...document, pages: { ...document.pages, [logicalDate]: page } };
}

export function saveDailyDraft(
  document: NotebookDocument,
  logicalDate: string,
  input: DailyDraftInput,
  candidates: DailyContinuationBookmark[],
  now = new Date()
): NotebookDocument {
  const existing = document.pages[logicalDate];
  if (!existing || existing.status !== "draft") throw new Error("请先开始整理今天。");
  const bookmarks = selectBookmarks(input.bookmarkIds, uniqueBookmarks([...existing.bookmarks, ...candidates]));
  const worklineReflections = input.worklineReflections === undefined
    ? existing.worklineReflections
    : selectWorklineReflections(input.worklineReflections, existing.reviewPackage, now);
  const page: DailyNotebookPage = {
    ...existing,
    reflection: cleanText(input.reflection, 12_000),
    worklineReflections,
    bookmarks,
    updatedAt: now.toISOString()
  };
  return { ...document, pages: { ...document.pages, [logicalDate]: page } };
}

export function sealDailyPage(
  document: NotebookDocument,
  logicalDate: string,
  input: DailyDraftInput,
  candidates: DailyContinuationBookmark[],
  now = new Date()
): NotebookDocument {
  const saved = saveDailyDraft(document, logicalDate, input, candidates, now);
  const page = saved.pages[logicalDate];
  if (!page) throw new Error("今天的页面不存在。");
  const timestamp = now.toISOString();
  return {
    ...saved,
    pages: {
      ...saved.pages,
      [logicalDate]: { ...page, status: "sealed", sealedAt: timestamp, updatedAt: timestamp }
    }
  };
}

export function findNotebookNote(document: NotebookDocument, noteId: string): NotebookNote {
  const note = document.notes.find((item) => item.id === noteId);
  if (!note) throw new Error("没有找到这条便签。");
  return cloneNote(note);
}

export function compileWorkRecords(sessions: AgentWorkSession[]): DailyWorkRecord[] {
  const groups = new Map<string, AgentWorkSession[]>();
  for (const session of sessions) {
    const projectKey = session.worktreePath ?? session.projectPath ?? session.repositoryPath ?? `unresolved:${session.platform}`;
    const group = groups.get(projectKey) ?? [];
    group.push(session);
    groups.set(projectKey, group);
  }
  return [...groups.entries()]
    .map(([projectKey, records]) => {
      const sorted = [...records].sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
      const latest = sorted.at(-1)!;
      const statuses = statusCounts(sorted);
      const summaries = Array.from(new Set(sorted.map((session) => session.summary.trim()).filter(Boolean))).slice(-3);
      const titles = Array.from(new Set(sorted.map((session) => session.title.trim()).filter(Boolean)));
      const projectName = projectKey.startsWith("unresolved:") ? `${platformLabel(latest.platform)} 未识别项目` : basename(projectKey);
      const title = titles.length > 1 ? `${titles[0]}，并推进 ${titles.length - 1} 条相关工作` : titles[0] || projectName;
      return {
        id: `record-${stableHash(`${projectKey}:${sorted.map(sessionKey).join("|")}`)}`,
        projectKey,
        projectName,
        title,
        summary: summaries.join(" ") || "这组会话留下了活动记录，但暂时没有可靠摘要。",
        changed: `${sorted.length} 条会话被归并为一条项目脉络；${statuses.completed} 条已收口，${statuses.open} 条仍可继续。`,
        uncertainty: statuses.blocked ? `${statuses.blocked} 条工作仍受边界或外部条件阻塞。` : statuses.unknown ? `${statuses.unknown} 条工作的完成状态仍需人工确认。` : "当前没有额外的未确认边界。",
        occurredAt: latest.updatedAt,
        sessions: sorted.map((session) => ({ id: session.id, platform: session.platform, path: session.path, title: session.title }))
      } satisfies DailyWorkRecord;
    })
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
    .slice(0, 7);
}

export function continuationCandidates(sessions: AgentWorkSession[]): DailyContinuationBookmark[] {
  const weight: Record<AgentSessionStatus, number> = { blocked: 0, active: 1, unknown: 2, completed: 3 };
  return [...sessions]
    .filter((session) => session.status !== "completed" && Boolean(buildResumeCommand(session)))
    .sort((a, b) => weight[a.status] - weight[b.status] || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 3)
    .map((session) => {
      const cwd = session.worktreePath ?? session.projectPath ?? session.repositoryPath;
      const resumeCommand = buildResumeCommand(session);
      return {
        id: sessionKey(session),
        title: session.title,
        projectName: basename(cwd ?? platformLabel(session.platform)),
        provider: session.platform,
        sessionId: session.id,
        sessionPath: session.path,
        ...(cwd ? { cwd } : {}),
        ...(resumeCommand ? { resumeCommand } : {})
      };
    });
}

function normalizeNote(value: unknown): NotebookNote | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<NotebookNote>;
  if (!cleanText(raw.id, 240) || !isDate(raw.logicalDate) || !cleanText(raw.body, 24_000)) return undefined;
  const body = cleanText(raw.body, 24_000);
  const source = inferSource(body);
  return {
    id: cleanText(raw.id, 240),
    logicalDate: raw.logicalDate!,
    createdAt: cleanTimestamp(raw.createdAt),
    updatedAt: cleanTimestamp(raw.updatedAt),
    title: cleanText(raw.title, 160) || inferTitle(body),
    body,
    kind: raw.kind === "web" || raw.kind === "note" || raw.kind === "thought" ? raw.kind : source.kind,
    sourceLabel: cleanText(raw.sourceLabel, 200) || source.label,
    favorite: raw.favorite === true,
    deliveries: Array.isArray(raw.deliveries) ? raw.deliveries.map(normalizeDelivery).filter((item): item is NotebookNoteDelivery => Boolean(item)) : []
  };
}

function normalizeDelivery(value: unknown): NotebookNoteDelivery | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<NotebookNoteDelivery>;
  if (!raw.kind || !["card", "wiki", "project"].includes(raw.kind)) return undefined;
  return { kind: raw.kind, deliveredAt: cleanTimestamp(raw.deliveredAt), target: cleanText(raw.target, 2_000), status: raw.status === "queued" ? "queued" : "delivered" };
}

function normalizePage(value: unknown, logicalDate: string): DailyNotebookPage {
  if (!value || typeof value !== "object") return emptyPage(logicalDate);
  const raw = value as Partial<DailyNotebookPage>;
  const status = raw.status === "sealed" ? "sealed" : raw.status === "draft" ? "draft" : "unformed";
  const reviewPackage = normalizeDailyReviewPackage(raw.reviewPackage, logicalDate);
  return {
    schemaVersion: reviewPackage ? 2 : 1,
    logicalDate,
    status,
    ...(raw.createdAt ? { createdAt: cleanTimestamp(raw.createdAt) } : {}),
    ...(raw.updatedAt ? { updatedAt: cleanTimestamp(raw.updatedAt) } : {}),
    ...(raw.evidenceCutoff ? { evidenceCutoff: cleanTimestamp(raw.evidenceCutoff) } : {}),
    ...(status === "sealed" && raw.sealedAt ? { sealedAt: cleanTimestamp(raw.sealedAt) } : {}),
    workRecords: Array.isArray(raw.workRecords) ? raw.workRecords.map(normalizeWorkRecord).filter((item): item is DailyWorkRecord => Boolean(item)) : [],
    reflection: cleanText(raw.reflection, 12_000),
    ...(reviewPackage ? { reviewPackage } : {}),
    worklineReflections: reviewPackage && Array.isArray(raw.worklineReflections)
      ? normalizeWorklineReflections(raw.worklineReflections, reviewPackage)
      : [],
    bookmarks: Array.isArray(raw.bookmarks) ? raw.bookmarks.map(normalizeBookmark).filter((item): item is DailyContinuationBookmark => Boolean(item)).slice(0, 3) : []
  };
}

function selectWorklineReflections(
  values: Array<Pick<DailyWorklineReflection, "worklineId" | "text">>,
  reviewPackage: DailyReviewPackage | undefined,
  now: Date
): DailyWorklineReflection[] {
  if (!reviewPackage) return [];
  const allowed = new Set(reviewPackage.worklines.map((workline) => workline.id));
  const seen = new Set<string>();
  const updatedAt = now.toISOString();
  return values.flatMap((value) => {
    const worklineId = cleanText(value?.worklineId, 240);
    const text = cleanText(value?.text, 12_000);
    if (!worklineId || !text || !allowed.has(worklineId) || seen.has(worklineId)) return [];
    seen.add(worklineId);
    return [{ worklineId, text, updatedAt }];
  });
}

function normalizeWorklineReflections(value: unknown[], reviewPackage: DailyReviewPackage): DailyWorklineReflection[] {
  const allowed = new Set(reviewPackage.worklines.map((workline) => workline.id));
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Partial<DailyWorklineReflection>;
    const worklineId = cleanText(raw.worklineId, 240);
    const text = cleanText(raw.text, 12_000);
    if (!worklineId || !text || !allowed.has(worklineId) || seen.has(worklineId)) return [];
    seen.add(worklineId);
    return [{ worklineId, text, updatedAt: cleanTimestamp(raw.updatedAt) }];
  });
}

function selectBookmarks(ids: string[], candidates: DailyContinuationBookmark[]): DailyContinuationBookmark[] {
  const wanted = new Set(Array.isArray(ids) ? ids.slice(0, 3) : []);
  return candidates.filter((candidate) => wanted.has(candidate.id)).slice(0, 3).map((item) => structuredClone(item));
}

function uniqueBookmarks(bookmarks: DailyContinuationBookmark[]): DailyContinuationBookmark[] {
  const seen = new Set<string>();
  return bookmarks.filter((bookmark) => !seen.has(bookmark.id) && Boolean(seen.add(bookmark.id)));
}

function normalizeWorkRecord(value: unknown): DailyWorkRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<DailyWorkRecord>;
  const id = cleanText(raw.id, 240);
  const projectKey = cleanText(raw.projectKey, 2_000);
  const title = cleanText(raw.title, 300);
  if (!id || !projectKey || !title || !Array.isArray(raw.sessions)) return undefined;
  const sessions = raw.sessions.map((session) => {
    if (!session || typeof session !== "object") return undefined;
    const id = cleanText(session.id, 2_000);
    const path = cleanText(session.path, 4_000);
    const title = cleanText(session.title, 300);
    const platform = ["codex", "claude", "minimax", "other"].includes(session.platform) ? session.platform : "other";
    return id && path && title ? { id, path, title, platform } : undefined;
  }).filter((session): session is DailyWorkRecord["sessions"][number] => Boolean(session));
  if (sessions.length === 0) return undefined;
  return {
    id,
    projectKey,
    projectName: cleanText(raw.projectName, 240) || basename(projectKey),
    title,
    summary: cleanText(raw.summary, 8_000),
    changed: cleanText(raw.changed, 4_000),
    uncertainty: cleanText(raw.uncertainty, 4_000),
    occurredAt: cleanTimestamp(raw.occurredAt),
    sessions
  };
}

function normalizeBookmark(value: unknown): DailyContinuationBookmark | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<DailyContinuationBookmark>;
  const id = cleanText(raw.id, 2_000);
  const sessionId = cleanText(raw.sessionId, 2_000);
  const sessionPath = cleanText(raw.sessionPath, 4_000);
  const title = cleanText(raw.title, 300);
  if (!id || !sessionId || !sessionPath || !title) return undefined;
  const provider = ["codex", "claude", "minimax", "other"].includes(raw.provider ?? "") ? raw.provider! : "other";
  return {
    id,
    title,
    projectName: cleanText(raw.projectName, 240) || "未识别项目",
    provider,
    sessionId,
    sessionPath,
    ...(cleanText(raw.cwd, 4_000) ? { cwd: cleanText(raw.cwd, 4_000) } : {}),
    ...(cleanText(raw.resumeCommand, 8_000) ? { resumeCommand: cleanText(raw.resumeCommand, 8_000) } : {})
  };
}

function inferSource(body: string): { kind: NotebookNote["kind"]; label: string } {
  const match = body.match(/https?:\/\/([^/\s]+)/i);
  if (match?.[1]) return { kind: "web", label: match[1].replace(/^www\./, "") };
  return { kind: body.length > 480 ? "note" : "thought", label: "个人记录" };
}

function inferTitle(body: string): string {
  const first = body.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "未命名便签";
  return first.replace(/^#+\s*/, "").slice(0, 38);
}

function statusCounts(sessions: AgentWorkSession[]): { completed: number; open: number; blocked: number; unknown: number } {
  return {
    completed: sessions.filter((session) => session.status === "completed").length,
    open: sessions.filter((session) => session.status !== "completed").length,
    blocked: sessions.filter((session) => session.status === "blocked").length,
    unknown: sessions.filter((session) => session.status === "unknown").length
  };
}

function sessionKey(session: AgentWorkSession): string {
  return `${session.platform}:${session.id}:${session.path}`;
}

function clonePage(page: DailyNotebookPage): DailyNotebookPage { return structuredClone(page); }
function cloneNote(note: NotebookNote): NotebookNote { return structuredClone(note); }
function uniqueNotes(notes: NotebookNote[]): NotebookNote[] { const seen = new Set<string>(); return notes.filter((note) => { if (seen.has(note.id)) return false; seen.add(note.id); return true; }); }
function emptyPage(logicalDate: string): DailyNotebookPage { return { schemaVersion: 1, logicalDate, status: "unformed", workRecords: [], reflection: "", worklineReflections: [], bookmarks: [] }; }
function cleanText(value: unknown, limit: number): string { return typeof value === "string" ? value.replace(/\0/g, "").trim().slice(0, limit) : ""; }
function cleanTimestamp(value: unknown): string { const date = new Date(typeof value === "string" ? value : 0); return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString(); }
function isDate(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value); }
function localDate(date = new Date()): string { const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 10); }
function basename(value: string): string { return value.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || value; }
function platformLabel(platform: string): string { return platform === "codex" ? "Codex" : platform === "claude" ? "Claude Code" : platform; }
function stableHash(value: string): string { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(36); }
