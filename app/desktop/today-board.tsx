import {
  Activity,
  Bot,
  ChevronDown,
  FileText,
  Filter,
  LockKeyhole,
  RefreshCw,
  Sparkles,
  UserRound
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import type { ReactElement } from "react";
import type { DailySessionActivity, SessionActivityLane } from "../../src/session-activity";
import type { DailyReviewPreparationState } from "../../src/daily-review-schedule";
import type { AgentPlatform, AgentWorkSession, SessionProvider } from "../../src/types";
import type { TraceinkEvidenceRefV1, TraceinkIndexArtifactV1 } from "../../src/traceink-review-assets";
import type { TodayBoardPackageGeneration } from "../../src/today-board";
import type { DailyReviewEvidence, DailyReviewPackage, DailyWorklineReview } from "../../src/workline-review";
import type { DesktopNotebookState, DesktopState, SessionTranscriptRequest } from "./api";
import { TraceinkIndexView } from "./traceink-index-view";

export interface TodayTranscriptTarget {
  title: string;
  platform: AgentPlatform;
  request: SessionTranscriptRequest;
}

export type TodayReviewEntry =
  | { stage: "dossier"; worklineId: string }
  | { stage: "seal" };

interface TodayBoardProject {
  key: string;
  name: string;
  sessions: AgentWorkSession[];
}

export interface TodayBoardProps {
  state: DesktopState;
  projects: TodayBoardProject[];
  sessions: AgentWorkSession[];
  selectedProjectKey: string;
  loading: boolean;
  error: string | null;
  onProject(key: string): void;
  onNotebook(notebook: DesktopNotebookState): void;
  onOpenReview(entry: TodayReviewEntry, returnFocus: HTMLElement): void;
  onTranscript(target: TodayTranscriptTarget, returnFocus: HTMLElement): void;
  onRetry(): void;
}

type ProviderFilter = "all" | SessionProvider;

interface WorklineSourceTopology {
  sources: DailyReviewEvidence[];
  ambiguousSessionKeys: string[];
}

export function TodayBoard({
  state,
  projects,
  sessions,
  selectedProjectKey,
  loading,
  error,
  onProject,
  onNotebook,
  onOpenReview,
  onTranscript,
  onRetry
}: TodayBoardProps): ReactElement {
  const [provider, setProvider] = useState<ProviderFilter>("all");
  const [expandedWorklines, setExpandedWorklines] = useState<Set<string>>(() => new Set());
  const [requestingPreparation, setRequestingPreparation] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const board = state.notebook.todayBoard;
  const traceinkReview = state.traceinkReview;
  const hasCanonicalIndex = Boolean(traceinkReview.activeIndex);
  const legacySealed = board.mode === "sealed" && !hasCanonicalIndex;
  const surfaceMode = legacySealed
    ? "sealed"
    : hasCanonicalIndex
      ? traceinkReview.mode
      : "raw";
  const preparation = state.reviewPreparation;
  const preparing = preparation.status === "preparing" || requestingPreparation;
  const generation = legacySealed ? board.activeGeneration : undefined;
  const review = generation?.package;
  const activeReflections = generation
    ? state.notebook.page.worklineReflections.filter((reflection) => reflection.packageGenerationId === generation.id)
    : [];

  useEffect(() => {
    setExpandedWorklines(new Set());
    setProvider("all");
    setActionError(null);
  }, [state.activeDate, generation?.id]);

  const sessionByIdentity = useMemo(
    () => new Map(sessions.map((session) => [sessionIdentity(session.platform, session.id, session.path), session])),
    [sessions]
  );
  const laneByIdentity = useMemo(
    () => new Map(state.activity.lanes.map((lane) => [lane.identity, lane])),
    [state.activity.lanes]
  );
  const rawSessions = useMemo(
    () => sessions.filter((session) => matchesSessionFilters(session, selectedProjectKey, provider)),
    [sessions, selectedProjectKey, provider]
  );
  const worklineTopology = useMemo(() => review
    ? new Map(review.worklines.map((workline) => [workline.id, sourcesForWorkline(review, workline)]))
    : new Map<string, WorklineSourceTopology>(), [review]);
  const visibleWorklines = useMemo(() => review?.worklines.filter((workline) => {
    const sources = worklineTopology.get(workline.id)?.sources ?? [];
    if (provider !== "all" && !sources.some((source) => source.platform === provider)) return false;
    if (surfaceMode === "sealed" || selectedProjectKey === "all") return true;
    return sources.some((source) => {
      const session = sessionByIdentity.get(sessionIdentity(source.platform, source.sessionId, source.path));
      return session ? projectKey(session) === selectedProjectKey : false;
    });
  }) ?? [], [provider, review, selectedProjectKey, sessionByIdentity, surfaceMode, worklineTopology]);
  const uncompiledSessions = board.uncompiledEvidence
    .map((revision) => sessionByIdentity.get(revision.identity))
    .filter((session): session is AgentWorkSession => Boolean(session))
    .filter((session) => matchesSessionFilters(session, selectedProjectKey, provider));
  const displayedError = actionError ?? state.traceinkReviewError ?? preparation.message ?? (legacySealed ? board.compilationError : undefined) ?? error;

  async function prepare(mode: "compile" | "refresh"): Promise<void> {
    setRequestingPreparation(true);
    setActionError(null);
    try {
      onNotebook(await window.agentWhiteboard.prepareDailyReview(state.activeDate, mode));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "工作脉络整理没有完成；上一版仍然可读。");
    } finally {
      setRequestingPreparation(false);
    }
  }

  function toggleWorkline(worklineId: string): void {
    setExpandedWorklines((current) => {
      const next = new Set(current);
      if (next.has(worklineId)) next.delete(worklineId);
      else next.add(worklineId);
      return next;
    });
  }

  if (loading && !review && !traceinkReview.activeIndex) return <TodayBoardSkeleton />;
  if (error && !review && !traceinkReview.activeIndex && sessions.length === 0) {
    return <section className="today-board-state" role="alert"><Activity size={22} /><h2>本地证据暂时无法读取</h2><p>{error}</p><button type="button" onClick={onRetry}>重新扫描</button></section>;
  }

  return (
    <section className={`today-board mode-${surfaceMode}`} aria-labelledby="today-board-title" tabIndex={-1}>
      <header className="today-board-head">
        <div className="today-date-clip" aria-hidden="true"><strong>{formatDay(state.activeDate)}</strong><span>{formatMonth(state.activeDate)}</span></div>
        <div className="today-title-block">
          <span className="today-kicker">TODAY / LOCAL EVIDENCE</span>
          <h1 id="today-board-title">今天的工作现场</h1>
          <p>{modeDescription(surfaceMode, generation, preparation)}</p>
        </div>
        <div className="today-board-state-line" aria-live="polite">
          <span data-mode={surfaceMode}>{modeLabel(surfaceMode)}</span>
          {generation
            ? <small>材料截止 {formatDateTime(generation.evidenceCutoff)}</small>
            : traceinkReview.activeIndex
              ? <small>材料截止 {formatDateTime(traceinkReview.activeIndex.producer.scope?.evidenceCutoff ?? traceinkReview.activeIndex.producer.completedAt)}</small>
              : preparation.status === "scheduled"
                ? <small>{preparation.time} 自动准备</small>
                : <small>{sessions.length} 条独立 Session</small>}
        </div>
        {surfaceMode === "raw" ? (
          <button type="button" className="today-primary-action" disabled={preparing || sessions.length === 0} onClick={() => void prepare("compile")}>
            <Sparkles size={16} />{preparing ? "正在准备工作脉络…" : preparation.status === "failed" ? "重新整理" : "现在整理"}
          </button>
        ) : surfaceMode === "sealed" ? (
          <div className="today-seal-mark" aria-label="本日已封存"><LockKeyhole size={15} />封</div>
        ) : hasCanonicalIndex ? null : surfaceMode === "stale" ? (
          <button type="button" className="today-primary-action" disabled={preparing} onClick={() => void prepare("refresh")}>
            <RefreshCw size={16} />{preparing ? "正在更新工作脉络…" : "更新工作脉络"}
          </button>
        ) : (
          <button type="button" className="today-primary-action" onClick={(event) => onOpenReview({ stage: "seal" }, event.currentTarget)}>
            今日收口
          </button>
        )}
      </header>

      {surfaceMode === "sealed" ? null : <ActivitySummary activity={state.activity} />}

      {hasCanonicalIndex && !legacySealed ? null : (
        <div className="today-board-toolbar">
          {surfaceMode === "sealed" ? null : <ProjectFilters projects={projects} selected={selectedProjectKey} onProject={onProject} />}
          <div className="today-board-filters" aria-label="来源筛选">
            <Filter size={14} aria-hidden="true" />
            {(["all", "codex", "claude"] as ProviderFilter[]).map((value) => (
              <button key={value} type="button" aria-pressed={provider === value} onClick={() => setProvider(value)}>
                {value === "all" ? "全部来源" : platformLabel(value)}
              </button>
            ))}
          </div>
        </div>
      )}

      {displayedError && !hasCanonicalIndex ? <div className="today-board-alert" role="alert"><strong>{generation ? "整理没有替换现有材料" : "没有生成工作脉络"}</strong><span>{displayedError}</span></div> : null}

      <div className="today-board-scroll">
        {surfaceMode === "sealed" ? <SealedPageDetails notebook={state.notebook} /> : null}
        {hasCanonicalIndex && !legacySealed ? (
          <>
            <CanonicalActivityMap
              activeIndex={traceinkReview.activeIndex!}
              worklines={traceinkReview.worklines ?? []}
              sessions={sessions}
              laneByIdentity={laneByIdentity}
              onTranscript={onTranscript}
            />
            <TraceinkIndexView
              projection={traceinkReview}
              preparation={preparation}
              error={displayedError}
              onCompile={() => prepare("compile")}
              onRefresh={() => prepare("refresh")}
              onEvidence={onTranscript}
            />
          </>
        ) : surfaceMode === "raw" ? (
          <SessionLaneList
            sessions={rawSessions}
            laneByIdentity={laneByIdentity}
            label="今日会话"
            onTranscript={onTranscript}
          />
        ) : review && generation ? (
          <>
            <section className="today-worklines" aria-label="工作脉络">
              {visibleWorklines.map((workline) => (
                <WorklineRow
                  key={workline.id}
                  workline={workline}
                  sources={worklineTopology.get(workline.id)?.sources ?? []}
                  ambiguousSessionKeys={worklineTopology.get(workline.id)?.ambiguousSessionKeys ?? []}
                  generation={generation}
                  laneByIdentity={surfaceMode === "sealed" ? new Map() : laneByIdentity}
                  expanded={expandedWorklines.has(workline.id)}
                  sealed={surfaceMode === "sealed"}
                  reflections={activeReflections}
                  onToggle={() => toggleWorkline(workline.id)}
                  onReview={(returnFocus) => onOpenReview({ stage: "dossier", worklineId: workline.id }, returnFocus)}
                  onTranscript={onTranscript}
                />
              ))}
              {visibleWorklines.length === 0 ? <CompactEmpty text="当前筛选没有匹配的工作脉络。" /> : null}
            </section>
            {surfaceMode === "stale" ? (
              <section className="today-uncompiled" aria-labelledby="uncompiled-title">
                <header><div><span>NEW EVIDENCE</span><h2 id="uncompiled-title">尚未整理</h2></div><p>这些活动晚于上方材料截止点；上一版没有被改写。</p></header>
                <SessionLaneList
                  sessions={uncompiledSessions}
                  laneByIdentity={laneByIdentity}
                  label="尚未整理的会话"
                  className="today-uncompiled-lanes"
                  laneClassName="today-uncompiled-lane"
                  onTranscript={onTranscript}
                />
              </section>
            ) : null}
          </>
        ) : <CompactEmpty text="这一天还没有可读取的工作材料。" />}
      </div>
    </section>
  );
}

interface CanonicalActivityGroup {
  id: string;
  title: string;
  participation: string[];
  sessions: AgentWorkSession[];
  evidenceBySessionIdentity: Map<string, TraceinkEvidenceRefV1>;
  timeText?: string;
  statusText?: string;
  currentStop?: string;
  changeSignal?: string;
  result?: string;
  evidenceReadiness?: string;
}

export function canonicalActivityGroups(
  rawMarkdown: string,
  worklines: NonNullable<DesktopState["traceinkReview"]["worklines"]>,
  sessions: AgentWorkSession[],
  evidence: TraceinkEvidenceRefV1[] = []
): { groups: CanonicalActivityGroup[]; ungrouped: AgentWorkSession[] } {
  const claimed = new Set<string>();
  const groups = worklines.map((workline, index): CanonicalActivityGroup => {
    const presentation = workline.presentation;
    const start = rawMarkdown.indexOf(workline.selection.title);
    const nextTitle = worklines[index + 1]?.selection.title;
    const end = start >= 0 && nextTitle ? rawMarkdown.indexOf(nextTitle, start + workline.selection.title.length) : -1;
    const section = presentation?.rawMarkdown ?? (start >= 0 ? rawMarkdown.slice(start, end >= 0 ? end : undefined) : "");
    const referencedEvidence = new Set(presentation?.evidenceIds ?? []);
    const matched = sessions.filter((session) => {
      if (sectionReferencesSession(section, session.id)) return true;
      const canonicalPath = session.transcriptCapture?.canonicalPath ?? session.path;
      return evidence.some((item) =>
        referencedEvidence.has(item.id) &&
        item.kind === "session" &&
        item.provider === session.platform &&
        item.sessionId === session.id &&
        item.path === canonicalPath
      );
    });
    const evidenceBySessionIdentity = new Map<string, TraceinkEvidenceRefV1>();
    for (const session of matched) {
      const canonicalPath = session.transcriptCapture?.canonicalPath ?? session.path;
      const candidates = evidence.filter((item) =>
        item.kind === "session" &&
        item.provider === session.platform &&
        item.sessionId === session.id &&
        item.path === canonicalPath &&
        (sectionReferencesSession(section, session.id) || referencedEvidence.has(item.id))
      );
      if (candidates.length === 1) {
        evidenceBySessionIdentity.set(sessionIdentity(session.platform, session.id, session.path), candidates[0]!);
      }
    }
    matched.forEach((session) => claimed.add(sessionIdentity(session.platform, session.id, session.path)));
    const participationSource = presentation?.participationText ?? section;
    const participation = ["你参与", "Agent 独立推进", "共同推进", "无法确定"].filter((label) => participationSource.includes(label));
    return {
      id: workline.selection.worklineId,
      title: workline.selection.title,
      participation: participation.length ? participation : ["无法确定"],
      sessions: matched,
      evidenceBySessionIdentity,
      ...optionalActivityField("timeText", presentation?.timeText),
      ...optionalActivityField("statusText", presentation?.statusText),
      ...optionalActivityField("currentStop", presentation?.currentStopMarkdown),
      ...optionalActivityField("changeSignal", presentation?.changeSignalMarkdown),
      ...optionalActivityField("result", presentation?.resultMarkdown),
      ...optionalActivityField("evidenceReadiness", presentation?.evidenceReadinessText)
    };
  });
  return {
    groups,
    ungrouped: sessions.filter((session) => !claimed.has(sessionIdentity(session.platform, session.id, session.path)))
  };
}

function sectionReferencesSession(section: string, sessionId: string): boolean {
  if (!sessionId) return false;
  if (section.includes(`\`${sessionId}\``)) return true;
  const escaped = sessionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[\\s,，、;；:：()（）])${escaped}(?=$|[\\s,，、;；:：()（）])`, "m").test(section);
}

function CanonicalActivityMap({ activeIndex, worklines, sessions, laneByIdentity, onTranscript }: {
  activeIndex: TraceinkIndexArtifactV1;
  worklines: NonNullable<DesktopState["traceinkReview"]["worklines"]>;
  sessions: AgentWorkSession[];
  laneByIdentity: Map<string, SessionActivityLane>;
  onTranscript(target: TodayTranscriptTarget, returnFocus: HTMLElement): void;
}): ReactElement {
  const projection = useMemo(
    () => canonicalActivityGroups(activeIndex.rawMarkdown, worklines, sessions, activeIndex.evidence),
    [activeIndex.evidence, activeIndex.rawMarkdown, sessions, worklines]
  );
  return (
    <section className="traceink-activity-map" aria-labelledby="traceink-activity-title">
      <header><div><span>ACTIVITY / PARTICIPATION</span><h2 id="traceink-activity-title">工作活动与参与</h2></div><p>语义归组来自 Traceink；时间轨迹来自本地消息时间戳。两者不会互相冒充。</p></header>
      <div className="traceink-activity-groups">
        {projection.groups.map((group) => (
          <details key={group.id}>
            <summary>
              <span>
                <strong>{group.title}</strong>
                <small>{[group.timeText, group.statusText, `${group.sessions.length} 个 Session`].filter(Boolean).join(" · ")}</small>
              </span>
              <em>{group.participation.join(" · ")}</em>
            </summary>
            {group.currentStop || group.changeSignal || group.result || group.evidenceReadiness ? (
              <div className="traceink-activity-context">
                {group.currentStop ? <p><span>当前停点</span>{traceinkFieldExcerpt(group.currentStop)}</p> : null}
                {group.changeSignal ? <p><span>可能变化 · AI 整理</span>{traceinkFieldExcerpt(group.changeSignal)}</p> : null}
                {group.result ? <p><span>阶段结果 · AI 整理</span>{traceinkFieldExcerpt(group.result)}</p> : null}
                {group.evidenceReadiness ? <p><span>证据</span>{traceinkFieldExcerpt(group.evidenceReadiness)}</p> : null}
              </div>
            ) : null}
            <SessionLaneList
              sessions={group.sessions}
              laneByIdentity={laneByIdentity}
              label={`${group.title} 的活动会话`}
              laneClassName="traceink-grouped-lane"
              transcriptTarget={(session) => canonicalTraceinkTranscriptTarget(session, group.evidenceBySessionIdentity, activeIndex)}
              onTranscript={onTranscript}
            />
          </details>
        ))}
        {projection.ungrouped.length ? (
          <details>
            <summary><span><strong>Traceink 未明确归属</strong><small>{projection.ungrouped.length} 个 Session</small></span><em>不猜测归类 · 可展开核对</em></summary>
            <SessionLaneList sessions={projection.ungrouped} laneByIdentity={laneByIdentity} label="尚未归组的活动会话" laneClassName="traceink-grouped-lane" onTranscript={onTranscript} />
          </details>
        ) : null}
      </div>
    </section>
  );
}

function optionalActivityField<Key extends string>(key: Key, value: string | undefined): Partial<Record<Key, string>> {
  return value ? { [key]: value } as Record<Key, string> : {};
}

function traceinkFieldExcerpt(value: string): string {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*(?:[-*>]|\d+[.)])\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ActivitySummary({ activity }: { activity: DailySessionActivity }): ReactElement {
  const facts = activity.facts;
  return (
    <section className="today-activity-summary" aria-label="可观察活动摘要">
      <div><Bot size={15} /><span><strong>{formatObservedMinutes(facts.observedAgentActivityMs)}</strong><small>观测到的 Agent 活动</small></span></div>
      <div><UserRound size={15} /><span><strong>{facts.userInterventionCount} 次</strong><small>明确的用户交互</small></span></div>
      <div><Activity size={15} /><span><strong>{facts.peakObservedAgentConcurrency} 路</strong><small>峰值并行活动</small></span></div>
      <div className="attention-cue"><span><strong>注意力负荷线索</strong><small>{facts.contextSwitchCount} 次跨 Session 切换 · 置信度：{facts.confidence === "observed" ? "已观测" : "证据不足"}</small></span><em>依据：带时间戳的用户消息与 Agent 响应窗口</em></div>
    </section>
  );
}

function ProjectFilters({ projects, selected, onProject }: { projects: TodayBoardProject[]; selected: string; onProject(key: string): void }): ReactElement {
  return (
    <div className="project-strip" aria-label="项目筛选">
      <button type="button" aria-pressed={selected === "all"} onClick={() => onProject("all")}>全部项目 <span>{String(projects.length).padStart(2, "0")}</span></button>
      {projects.map((project) => <button key={project.key} type="button" aria-pressed={selected === project.key} onClick={() => onProject(project.key)}>{project.name} <span>{String(project.sessions.length).padStart(2, "0")}</span></button>)}
    </div>
  );
}

function SessionLaneList({ sessions, laneByIdentity, label, className = "", laneClassName = "", transcriptTarget, onTranscript }: {
  sessions: AgentWorkSession[];
  laneByIdentity: Map<string, SessionActivityLane>;
  label: string;
  className?: string;
  laneClassName?: string;
  transcriptTarget?: (session: AgentWorkSession) => TodayTranscriptTarget | undefined;
  onTranscript(target: TodayTranscriptTarget, returnFocus: HTMLElement): void;
}): ReactElement {
  return (
    <div className={`today-session-lanes ${className}`.trim()} role="list" aria-label={label}>
      {sessions.map((session) => {
        const target = transcriptTarget?.(session);
        return <SessionLane
          key={sessionIdentity(session.platform, session.id, session.path)}
          session={session}
          lane={laneByIdentity.get(sessionIdentity(session.platform, session.id, session.path))}
          className={laneClassName}
          {...(target ? { transcriptTarget: target } : {})}
          onTranscript={onTranscript}
        />;
      })}
      {sessions.length === 0 ? <CompactEmpty text="当前筛选没有匹配的 Session。" /> : null}
    </div>
  );
}

function SessionLane({ session, lane, className, transcriptTarget, onTranscript }: {
  session: AgentWorkSession;
  lane?: SessionActivityLane | undefined;
  className: string;
  transcriptTarget?: TodayTranscriptTarget;
  onTranscript(target: TodayTranscriptTarget, returnFocus: HTMLElement): void;
}): ReactElement {
  return (
    <article className={`today-session-lane ${className}`.trim()} role="listitem">
      <div className="session-lane-time"><time>{formatTime(lane?.timeRange?.start ?? session.startedAt)}</time><i /><time>{formatTime(lane?.timeRange?.end ?? session.updatedAt)}</time></div>
      <div className="session-lane-copy"><span>{platformLabel(session.platform)} · {statusLabel(session.status)}</span><h2>{session.title}</h2><code>{session.id}</code><small>{session.projectPath ?? session.worktreePath ?? session.path}</small></div>
      <SessionActivityTrack lane={lane} />
      <button type="button" className="session-transcript-action" aria-label={`打开 ${session.title} 的会话记录`} onClick={(event) => onTranscript(transcriptTarget ?? {
        title: session.title,
        platform: session.platform,
        request: { id: session.id, platform: session.platform, path: session.path }
      }, event.currentTarget)}><FileText size={14} />打开记录</button>
    </article>
  );
}

function canonicalTraceinkTranscriptTarget(
  session: AgentWorkSession,
  evidenceBySessionIdentity: ReadonlyMap<string, TraceinkEvidenceRefV1>,
  activeIndex: TraceinkIndexArtifactV1
): TodayTranscriptTarget | undefined {
  const evidence = evidenceBySessionIdentity.get(sessionIdentity(session.platform, session.id, session.path));
  if (!evidence || evidence.kind !== "session" || !evidence.provider || !evidence.sessionId) return undefined;
  return {
    title: session.title,
    platform: evidence.provider,
    request: {
      id: evidence.sessionId,
      platform: evidence.provider,
      path: evidence.path,
      traceinkRef: {
        logicalDate: activeIndex.logicalDate,
        artifactId: activeIndex.id,
        stage: "index",
        revision: activeIndex.revision,
        outputHash: activeIndex.outputHash,
        evidenceId: evidence.id
      }
    }
  };
}

function SessionActivityTrack({ lane }: { lane?: SessionActivityLane | undefined }): ReactElement {
  const uncertain = !lane || lane.confidence === "uncertain";
  const running = lane?.operationalState === "running";
  return (
    <div className="session-activity-track" aria-label="参与活动轨迹">
      <div className="activity-rail" aria-hidden="true">
        {uncertain ? <i data-kind="uncertain" /> : (
          <>
            {lane.userInterventions.map((event) => <i key={event.id} data-kind="user" />)}
            {lane.agentActivityWindows.map((window) => <i key={`${window.start}:${window.end}`} data-kind="agent" />)}
          </>
        )}
        {running ? <i data-kind="running" /> : null}
      </div>
      <div className="activity-labels">
        {lane?.userInterventions.length ? <span data-kind="user">你参与</span> : null}
        {lane?.agentActivityWindows.length ? <span data-kind="agent">Agent 独立推进</span> : null}
        {uncertain ? <span data-kind="uncertain">无法确定</span> : null}
        {running ? <span data-kind="running">仍在运行</span> : null}
      </div>
    </div>
  );
}

function WorklineRow({ workline, sources, ambiguousSessionKeys, generation, laneByIdentity, expanded, sealed, reflections, onToggle, onReview, onTranscript }: {
  workline: DailyWorklineReview;
  sources: DailyReviewEvidence[];
  ambiguousSessionKeys: string[];
  generation: TodayBoardPackageGeneration;
  laneByIdentity: Map<string, SessionActivityLane>;
  expanded: boolean;
  sealed: boolean;
  reflections: DesktopNotebookState["page"]["worklineReflections"];
  onToggle(): void;
  onReview(returnFocus: HTMLElement): void;
  onTranscript(target: TodayTranscriptTarget, returnFocus: HTMLElement): void;
}): ReactElement {
  const reflection = reflections.find((item) => item.packageGenerationId === generation.id && item.worklineId === workline.id);
  const change = workline.dossier.blocks.find((block) => /(^|[-_:])(change|transition)([-_:]|$)/i.test(block.kind));
  const sourcePanelId = `workline-sources-${useId().replace(/:/g, "")}`;
  return (
    <article className="today-workline">
      <header>
        <div><span>{worklineStatusLabel(workline.status)}</span><h2>{workline.title}</h2><p>{workline.summary}</p></div>
        <div className="workline-counts"><strong>{sources.filter((source) => source.kind === "session").length}</strong><span>Sessions</span><strong>{workline.dossier.blocks.length}</strong><span>Evidence blocks</span></div>
      </header>
      {change ? <section className="workline-change-signal"><span>AI 整理 / 可能变化</span><strong>{change.title}</strong><p>{change.body}</p></section> : null}
      <WorklineParticipation workline={workline} />
      {reflection ? <blockquote>{reflection.text}</blockquote> : null}
      <footer>
        <button type="button" className="workline-disclosure" aria-expanded={expanded} aria-controls={sourcePanelId} onClick={onToggle}><ChevronDown size={15} />{expanded ? "收起来源会话" : "展开来源会话"}</button>
        <button type="button" className="workline-open" onClick={(event) => onReview(event.currentTarget)}>{sealed ? "打开封存材料" : "打开材料"}</button>
      </footer>
      {expanded ? (
        <div className="workline-sessions" id={sourcePanelId} role="list" aria-label={`${workline.title} 的来源会话`}>
          {ambiguousSessionKeys.length ? <p className="workline-source-ambiguity" role="note">以下 Session ID 对应多条路径，但材料没有可唯一定位的证据引用，因此未自动附加：{ambiguousSessionKeys.join("、")}</p> : null}
          {sources.filter((source) => source.kind === "session").map((source) => (
            <article key={source.id} role="listitem">
              <div><span>{platformLabel(source.platform)}</span><strong>{source.label}</strong><code>{source.sessionId}</code><small>{formatRange(source.startedAt, source.updatedAt)}</small></div>
              <SessionActivityTrack lane={laneByIdentity.get(sessionIdentity(source.platform, source.sessionId, source.path))} />
              <button type="button" aria-label={`打开 ${source.label} 的会话记录`} onClick={(event) => onTranscript({
                title: source.label,
                platform: source.platform,
                request: {
                  id: source.sessionId,
                  platform: source.platform,
                  path: source.path,
                  packageRef: {
                    logicalDate: generation.package.logicalDate,
                    generationId: generation.id,
                    evidenceId: source.id
                  }
                }
              }, event.currentTarget)}><FileText size={13} />打开记录</button>
            </article>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function SealedPageDetails({ notebook }: { notebook: DesktopNotebookState }): ReactElement {
  const reflection = notebook.page.reflection.trim();
  return <>
    {reflection ? <section className="sealed-page-reflection personal-ink" aria-label="整页墨迹"><span>整页墨迹</span><blockquote>{reflection}</blockquote></section> : null}
    {notebook.page.bookmarks.length ? <section className="sealed-continuation sealed-bookmarks" aria-label="封存续上"><span>明天从这里继续</span>{notebook.page.bookmarks.map((bookmark) => <button
      type="button"
      key={bookmark.id}
      aria-label={`复制续上命令：${bookmark.title}`}
      disabled={!bookmark.resumeCommand}
      onClick={() => { if (bookmark.resumeCommand) void window.agentWhiteboard.copyText(bookmark.resumeCommand); }}
    ><strong>{bookmark.title}</strong><small>{bookmark.projectName} · {platformLabel(bookmark.provider)}</small>{bookmark.resumeCommand ? <code>{bookmark.resumeCommand}</code> : <em>没有可复制的续上命令</em>}</button>)}</section> : null}
  </>;
}

function WorklineParticipation({ workline }: { workline: DailyWorklineReview }): ReactElement {
  const spans = workline.participation.length ? workline.participation : [{ id: "uncertain", kind: "uncertain" as const, label: "无法确定" }];
  return <div className="workline-participation"><div>{spans.map((span) => <i key={span.id} data-kind={span.kind} title={span.label} />)}</div><p>{Array.from(new Set(spans.map((span) => span.label))).map((label) => <span key={label}>{label}</span>)}</p></div>;
}

function TodayBoardSkeleton(): ReactElement {
  return <section className="today-board-skeleton" aria-label="正在读取今日工作现场"><header><i /><i /></header><div><i /><i /><i /><i /></div></section>;
}

function CompactEmpty({ text }: { text: string }): ReactElement {
  return <div className="today-compact-empty"><Activity size={17} /><span>{text}</span></div>;
}

function sourcesForWorkline(review: DailyReviewPackage, workline: DailyWorklineReview): WorklineSourceTopology {
  const citedEvidenceIds = new Set(workline.dossier.blocks.flatMap((block) => block.evidenceIds));
  const sources: DailyReviewEvidence[] = [];
  const ambiguousSessionKeys: string[] = [];

  for (const sourceSessionId of new Set(workline.sourceSessionIds)) {
    const candidates = review.evidence.filter((evidence) => evidence.kind === "session" && `${evidence.platform}:${evidence.sessionId}` === sourceSessionId);
    if (candidates.length <= 1) {
      if (candidates[0]) sources.push(candidates[0]);
      continue;
    }

    const citedCandidates = candidates.filter((candidate) => citedEvidenceIds.has(candidate.id));
    const citedIdCounts = new Map<string, number>();
    for (const candidate of citedCandidates) citedIdCounts.set(candidate.id, (citedIdCounts.get(candidate.id) ?? 0) + 1);
    const exactlyCited = citedCandidates.filter((candidate) => citedIdCounts.get(candidate.id) === 1);
    if (exactlyCited.length === 0) {
      ambiguousSessionKeys.push(sourceSessionId);
      continue;
    }
    sources.push(...exactlyCited);
  }

  return { sources, ambiguousSessionKeys };
}

function matchesSessionFilters(session: AgentWorkSession, selectedProjectKey: string, provider: ProviderFilter): boolean {
  return (provider === "all" || session.platform === provider) && (selectedProjectKey === "all" || projectKey(session) === selectedProjectKey);
}

function projectKey(session: AgentWorkSession): string {
  return session.worktreePath ?? session.projectPath ?? session.repositoryPath ?? `unresolved:${session.platform}`;
}

function sessionIdentity(platform: string, id: string, path: string): string {
  return `${platform}:${id}:${path}`;
}

function modeLabel(mode: DesktopNotebookState["todayBoard"]["mode"]): string {
  return mode === "raw" ? "原始会话" : mode === "compiled" ? "已整理" : mode === "stale" ? "有新证据" : "已封存";
}

function modeDescription(
  mode: DesktopNotebookState["todayBoard"]["mode"],
  generation: TodayBoardPackageGeneration | undefined,
  preparation: DailyReviewPreparationState
): string {
  if (mode === "raw" && preparation.status === "preparing") return "工作现场仍可阅读；工作脉络会在后台准备好后自动出现。";
  if (mode === "raw" && preparation.status === "scheduled") return `每条 Session 保持独立；今天 ${preparation.time} 会自动准备工作脉络。`;
  if (mode === "raw" && preparation.status === "failed") return "原始 Session 仍然完整可读；你可以稍后重新整理。";
  if (mode === "raw") return "每条 Session 保持独立；需要时可以把它们整理成跨会话工作脉络。";
  if (mode === "stale") return "上一版工作脉络保持可读，新到达的证据单独列在下方。";
  if (mode === "sealed") return "这份材料与人的原始墨迹已经固定；打开历史日期不会再次调用模型。";
  return generation ? "跨 Session 工作脉络已经生成，原始来源仍可逐条展开。" : "工作脉络材料已准备。";
}

function platformLabel(platform: string): string {
  return platform === "codex" ? "Codex" : platform === "claude" ? "Claude Code" : platform === "minimax" ? "MiniMax" : "Other";
}

function statusLabel(status: AgentWorkSession["status"]): string {
  return status === "active" ? "进行中" : status === "blocked" ? "受阻" : status === "completed" ? "已完成" : "状态待确认";
}

function worklineStatusLabel(status: string): string {
  return status === "needs-judgment" ? "需要人的判断" : status === "running" ? "仍在运行" : status === "ready" || status === "complete" ? "已有阶段结果" : "等待回看";
}

function formatObservedMinutes(value: number): string {
  if (value <= 0) return "无可测时长";
  return `${Math.round(value / 60_000)} 分钟`;
}

function formatTime(value?: string): string {
  if (!value) return "待定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "待定";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function formatRange(start?: string, end?: string): string {
  if (!start && !end) return "时间范围无法确定";
  return `${formatTime(start)} — ${formatTime(end)}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function formatDay(value: string): string {
  return value.slice(8, 10);
}

function formatMonth(value: string): string {
  return `${value.slice(0, 4)} / ${value.slice(5, 7)}`;
}
