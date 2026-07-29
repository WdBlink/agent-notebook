import {
  AlertTriangle,
  Archive,
  Bot,
  CalendarDays,
  Check,
  ChevronLeft,
  Clipboard,
  Clock3,
  Command,
  Database,
  ExternalLink,
  FileText,
  FolderOpen,
  GitBranch,
  Layers3,
  ListChecks,
  Map as MapIcon,
  Network,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  X
} from "lucide-react";
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { buildResumeCommand } from "../../src/resume";
import type { AgentSessionStatus, AgentWorkSession, SessionProvider } from "../../src/types";
import type { DesktopState, ProjectContextDocument, ProjectContextState, SessionTranscriptState } from "./api";

type ViewKey = "brief" | "sessions" | "timeline" | "map" | "sources";
type StatusFilter = "all" | AgentSessionStatus;
type MapRelation = "depends_on" | "continues" | "documents" | "related";

interface ProjectGroup {
  key: string;
  name: string;
  path?: string;
  sessions: AgentWorkSession[];
}

interface ContinuityItem {
  label: string;
  title: string;
  detail: string;
  session: AgentWorkSession;
}

interface ContextMapNode {
  id: string;
  parentId?: string;
  kind: "PROJECT" | "WORK" | "SESSION" | "DOCUMENT";
  label: string;
  summary: string;
  state: AgentSessionStatus;
  relation: MapRelation;
  sessionIds: string[];
  sourceLabel: string;
  confidence: "confirmed" | "inferred" | "unknown";
  document?: ProjectContextDocument;
  session?: AgentWorkSession;
}

interface DrawnEdge {
  id: string;
  d: string;
  x: number;
  y: number;
  relation: MapRelation;
  primary: boolean;
}

const viewLabels: Record<ViewKey, string> = {
  brief: "Brief",
  sessions: "Sessions",
  timeline: "Timeline",
  map: "Map",
  sources: "Sources"
};

const viewIcons = {
  brief: ListChecks,
  sessions: Archive,
  timeline: GitBranch,
  map: Network,
  sources: Database
} satisfies Record<ViewKey, typeof ListChecks>;

const relationLabels: Record<MapRelation, string> = {
  depends_on: "依赖",
  continues: "继续推进",
  documents: "文档",
  related: "相关"
};

function App(): ReactElement {
  const [state, setState] = useState<DesktopState | null>(null);
  const [view, setView] = useState<ViewKey>("brief");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [selectedProjectKey, setSelectedProjectKey] = useState("all");
  const [evidenceSession, setEvidenceSession] = useState<AgentWorkSession | null>(null);
  const [transcriptSession, setTranscriptSession] = useState<AgentWorkSession | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    return window.agentWhiteboard.subscribeState((next) => {
      setState(next);
      setEvidenceSession((current) => {
        if (!current) return null;
        return next.data.workSessionSnapshot.sessions.find((session) => session.id === current.id && session.platform === current.platform && session.path === current.path) ?? current;
      });
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === "Escape") {
        if (transcriptSession) {
          setTranscriptSession(null);
          return;
        }
        setCommandOpen(false);
        setCalendarOpen(false);
        setProviderOpen(false);
        setEvidenceSession(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [transcriptSession]);

  async function load(date?: string): Promise<void> {
    setLoading(true);
    setLoadError(null);
    try {
      setState(await window.agentWhiteboard.getState(date));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "无法读取本机 Agent 会话。 ");
    } finally {
      setLoading(false);
    }
  }

  async function refresh(date = state?.activeDate): Promise<void> {
    setLoading(true);
    setLoadError(null);
    try {
      setState(await window.agentWhiteboard.refreshSessions(date));
      showNotice("只读快照已经更新");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "本地证据暂时无法读取。 ");
    } finally {
      setLoading(false);
    }
  }

  async function toggleProvider(provider: SessionProvider): Promise<void> {
    if (!state) return;
    const current = state.data.settings.enabledSessionProviders;
    const enabledSessionProviders = current.includes(provider)
      ? current.filter((item) => item !== provider)
      : [...current, provider];
    setLoading(true);
    try {
      setState(await window.agentWhiteboard.updateSettings({ enabledSessionProviders }));
      showNotice(enabledSessionProviders.length ? `正在读取 ${enabledSessionProviders.map(platformLabel).join(" + ")}` : "所有会话来源均已关闭");
    } finally {
      setLoading(false);
    }
  }

  async function addRoot(): Promise<void> {
    if (!state) return;
    const directory = await window.agentWhiteboard.chooseDirectory();
    if (!directory) return;
    const roots = Array.from(new Set([directory, ...state.data.settings.sessionScanRoots]));
    setState(await window.agentWhiteboard.updateSettings({ sessionScanRoots: roots }));
    showNotice("读取目录已经加入");
  }

  async function copyResume(session: AgentWorkSession): Promise<void> {
    const command = buildResumeCommand(session);
    if (!command) {
      showNotice("这条会话没有可验证的恢复入口");
      return;
    }
    showNotice(await window.agentWhiteboard.copyText(command) ? "已复制续上命令" : "复制失败，命令仍可在详情中选择");
  }

  function showNotice(message: string): void {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 1900);
  }

  const sessions = state?.data.workSessionSnapshot.sessions ?? [];
  const projects = useMemo(() => groupSessionsByProject(sessions), [sessions]);
  const selectedSessions = useMemo(() => sessionsForProject(projects, sessions, selectedProjectKey), [projects, sessions, selectedProjectKey]);

  useEffect(() => {
    if (selectedProjectKey !== "all" && !projects.some((project) => project.key === selectedProjectKey)) setSelectedProjectKey("all");
  }, [projects, selectedProjectKey]);

  if (!state && loading) return <BootScreen />;
  if (!state) return <BootError message={loadError ?? "应用无法初始化。"} onRetry={() => void load()} />;

  return (
    <div className={`desktop-shell${loading ? " is-loading" : ""}`}>
      <Sidebar view={view} onView={(next) => { setView(next); setCalendarOpen(false); setProviderOpen(false); }} />
      <main className="workspace">
        <Topbar
          state={state}
          calendarOpen={calendarOpen}
          providerOpen={providerOpen}
          onCalendar={() => { setCalendarOpen(!calendarOpen); setProviderOpen(false); }}
          onProvider={() => { setProviderOpen(!providerOpen); setCalendarOpen(false); }}
          onDate={(date) => { setCalendarOpen(false); void load(date); }}
          onToggleProvider={(provider) => void toggleProvider(provider)}
          onCommand={() => setCommandOpen(true)}
          onRefresh={() => void refresh()}
        />
        {notice ? <div className="toast" role="status">{notice}</div> : null}
        <section className="content" onPointerDown={() => { if (calendarOpen) setCalendarOpen(false); if (providerOpen) setProviderOpen(false); }}>
          {view === "brief" ? (
            <Brief
              state={state}
              projects={projects}
              sessions={selectedSessions}
              selectedProjectKey={selectedProjectKey}
              loading={loading}
              error={loadError}
              onProject={setSelectedProjectKey}
              onEvidence={setEvidenceSession}
              onResume={(session) => void copyResume(session)}
              onRetry={() => void refresh()}
            />
          ) : null}
          {view === "sessions" ? (
            <SessionsPanel
              projects={projects}
              sessions={selectedSessions}
              selectedProjectKey={selectedProjectKey}
              onProject={setSelectedProjectKey}
              onEvidence={setEvidenceSession}
              onResume={(session) => void copyResume(session)}
            />
          ) : null}
          {view === "timeline" ? (
            <Timeline
              state={state}
              projects={projects}
              sessions={selectedSessions}
              selectedProjectKey={selectedProjectKey}
              onProject={setSelectedProjectKey}
              onDate={(date) => void load(date)}
              onEvidence={setEvidenceSession}
            />
          ) : null}
          {view === "map" ? (
            <MapPanel
              projects={projects}
              selectedProjectKey={selectedProjectKey}
              onProject={setSelectedProjectKey}
              onOpenPath={(target) => void window.agentWhiteboard.openPath(target)}
            />
          ) : null}
          {view === "sources" ? (
            <SourcesPanel
              state={state}
              onProvider={(provider) => void toggleProvider(provider)}
              onAddRoot={() => void addRoot()}
              onOpenPath={(target) => void window.agentWhiteboard.openPath(target)}
            />
          ) : null}
        </section>
      </main>
      {evidenceSession ? (
        <EvidenceDrawer
          session={evidenceSession}
          onClose={() => setEvidenceSession(null)}
          onCopy={() => void copyResume(evidenceSession)}
          onOpen={() => setTranscriptSession(evidenceSession)}
        />
      ) : null}
      {transcriptSession ? <TranscriptReader session={transcriptSession} onClose={() => setTranscriptSession(null)} /> : null}
      {commandOpen ? (
        <CommandPalette
          state={state}
          projects={projects}
          sessions={sessions}
          onClose={() => setCommandOpen(false)}
          onProject={(key) => { setSelectedProjectKey(key); setView("brief"); setCommandOpen(false); }}
          onSession={(session) => { setEvidenceSession(session); setCommandOpen(false); }}
          onDate={(date) => { setCommandOpen(false); void load(date); }}
        />
      ) : null}
    </div>
  );
}

function BootScreen(): ReactElement {
  return <div className="boot-screen"><img src="./app-icon.png" alt="" /><p>正在读取本机 Agent 会话</p></div>;
}

function BootError({ message, onRetry }: { message: string; onRetry(): void }): ReactElement {
  return <div className="boot-screen"><AlertTriangle size={28} /><strong>Work Continuity 无法启动</strong><p>{message}</p><button type="button" onClick={onRetry}>重新尝试</button></div>;
}

function Sidebar({ view, onView }: { view: ViewKey; onView(view: ViewKey): void }): ReactElement {
  return (
    <aside className="rail" aria-label="主导航">
      <img className="brand-mark" src="./app-icon.png" alt="Work Continuity" />
      <nav className="rail-nav" aria-label="产品视图">
        {(Object.keys(viewLabels) as ViewKey[]).map((key) => {
          const Icon = viewIcons[key];
          return <button key={key} type="button" aria-current={view === key ? "page" : undefined} onClick={() => onView(key)}><Icon size={20} strokeWidth={1.7} /><span>{viewLabels[key]}</span></button>;
        })}
      </nav>
      <div className="rail-bottom"><i />Local · Read only</div>
    </aside>
  );
}

function Topbar({
  state,
  calendarOpen,
  providerOpen,
  onCalendar,
  onProvider,
  onDate,
  onToggleProvider,
  onCommand,
  onRefresh
}: {
  state: DesktopState;
  calendarOpen: boolean;
  providerOpen: boolean;
  onCalendar(): void;
  onProvider(): void;
  onDate(date: string): void;
  onToggleProvider(provider: SessionProvider): void;
  onCommand(): void;
  onRefresh(): void;
}): ReactElement {
  const enabled = state.data.settings.enabledSessionProviders;
  return (
    <header className="topbar">
      <div className="date-control">
        <button type="button" className="icon-button" aria-label="查看前一天" onClick={() => onDate(shiftDate(state.activeDate, -1))}><ChevronLeft size={20} /></button>
        <div className="date-picker">
          <button type="button" className="date-stack" aria-expanded={calendarOpen} onClick={onCalendar}><strong>{formatDateTitle(state.activeDate)}</strong><span>{dateSubtitle(state.activeDate)}</span></button>
          {calendarOpen ? <CalendarPopover state={state} onDate={onDate} /> : null}
        </div>
        <button type="button" className="icon-button" aria-label="打开日期日历" aria-expanded={calendarOpen} onClick={onCalendar}><CalendarDays size={18} /></button>
      </div>
      <div className="top-actions">
        <button type="button" className="command-button" onClick={onCommand}><Search size={18} /><span>搜索项目、会话或证据</span><kbd>⌘ K</kbd></button>
        <div className="provider-switcher">
          <button type="button" className="provider-button" aria-expanded={providerOpen} onClick={onProvider}><span className="provider-dots"><i /><i /></span><span>{enabled.length ? `${enabled.length} 个来源` : "未读来源"}</span></button>
          {providerOpen ? <ProviderMenu enabled={enabled} onToggle={onToggleProvider} /> : null}
        </div>
        <div className="privacy-badge"><ShieldCheck size={16} />LOCAL / READ-ONLY</div>
        <button type="button" className="icon-button" aria-label="重新读取" onClick={onRefresh}><RefreshCw size={18} /></button>
      </div>
    </header>
  );
}

function CalendarPopover({ state, onDate }: { state: DesktopState; onDate(date: string): void }): ReactElement {
  const days = buildCalendarDays(state.activeDate);
  const active = new Set(state.activityDates);
  return (
    <div className="calendar-popover" role="dialog" aria-label="选择工作日期" onPointerDown={(event) => event.stopPropagation()}>
      <div className="calendar-head"><strong>{monthLabel(state.activeDate)}</strong><span>{active.size} 个活跃日期</span></div>
      <div className="calendar-weekdays">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">
        {days.map((day) => <button key={day.date} type="button" className={`${day.inMonth ? "" : "muted"}${day.date === state.activeDate ? " selected" : ""}${day.date === localDate() ? " today" : ""}`} onClick={() => onDate(day.date)}><span>{day.label}</span>{active.has(day.date) ? <i /> : null}</button>)}
      </div>
      <div className="calendar-foot"><span><i />有会话活动</span><button type="button" onClick={() => onDate(localDate())}>返回今天</button></div>
    </div>
  );
}

function ProviderMenu({ enabled, onToggle }: { enabled: SessionProvider[]; onToggle(provider: SessionProvider): void }): ReactElement {
  return (
    <div className="provider-menu" role="dialog" aria-label="选择读取来源" onPointerDown={(event) => event.stopPropagation()}>
      <div className="provider-menu-head"><strong>读取来源</strong><span>各平台独立只读，可同时启用</span></div>
      {(["codex", "claude"] as SessionProvider[]).map((provider) => {
        const checked = enabled.includes(provider);
        return <button type="button" className="provider-option" key={provider} onClick={() => onToggle(provider)}><span className={`provider-check${checked ? " checked" : ""}`}>{checked ? <Check size={11} /> : null}</span><span><strong>{platformLabel(provider)}</strong><small>{provider === "codex" ? "~/.codex/sessions/" : "~/.claude/projects/"}</small></span><em>{checked ? "读取" : "关闭"}</em></button>;
      })}
      <p>只改变简报范围；不会启动、修改或归档原始会话。</p>
    </div>
  );
}

function ProjectStrip({ projects, selected, onProject }: { projects: ProjectGroup[]; selected: string; onProject(key: string): void }): ReactElement {
  return (
    <div className="project-strip" aria-label="项目筛选">
      <button type="button" aria-pressed={selected === "all"} onClick={() => onProject("all")}>全部项目 <span>{String(projects.length).padStart(2, "0")}</span></button>
      {projects.map((project) => <button key={project.key} type="button" aria-pressed={selected === project.key} onClick={() => onProject(project.key)}>{project.name} <span>{String(project.sessions.length).padStart(2, "0")}</span></button>)}
    </div>
  );
}

function ViewHeading({ kicker, title, description }: { kicker: string; title: string; description?: string }): ReactElement {
  return <div className="view-heading"><div><span className="kicker">{kicker}</span><h1>{title}</h1></div>{description ? <p>{description}</p> : null}</div>;
}

function Brief({
  state,
  projects,
  sessions,
  selectedProjectKey,
  loading,
  error,
  onProject,
  onEvidence,
  onResume,
  onRetry
}: {
  state: DesktopState;
  projects: ProjectGroup[];
  sessions: AgentWorkSession[];
  selectedProjectKey: string;
  loading: boolean;
  error: string | null;
  onProject(key: string): void;
  onEvidence(session: AgentWorkSession): void;
  onResume(session: AgentWorkSession): void;
  onRetry(): void;
}): ReactElement {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const suggestions = buildSuggestions(sessions).filter((item) => filter === "all" || item.session.status === filter);
  const allSuggestions = buildSuggestions(sessions);
  const completed = sessions.filter((session) => session.status === "completed").length;
  const resumable = sessions.filter((session) => Boolean(buildResumeCommand(session))).length;
  const scopedProjects = selectedProjectKey === "all" ? projects : projects.filter((project) => project.key === selectedProjectKey);
  return (
    <section className="view brief-view">
      <h1 className="sr-only">今天从这里继续</h1>
      <ProjectStrip projects={projects} selected={selectedProjectKey} onProject={onProject} />
      {loading ? <BriefSkeleton /> : error ? <StateMessage kind="error" title="本地证据暂时无法读取" detail={error} action="重新扫描" onAction={onRetry} /> : sessions.length === 0 ? <StateMessage kind="empty" title="这一天没有确认的活动" detail="系统不会因为文件很新、会话被打开过，或只有初始化记录，就虚构你今天干过活。" /> : (
        <div className="brief-grid">
          <div className="primary-column">
            <section className="hero-brief">
              <div className="hero-copy"><span className="kicker">Across {scopedProjects.length} projects · {sessions.length} sessions</span><h2>{summaryLine(scopedProjects, sessions)}</h2><p>{summaryDetail(sessions)}</p></div>
              <div className="hero-metrics">
                <div><strong>{String(allSuggestions.length).padStart(2, "0")}</strong><span>open</span></div>
                <div><strong>{String(scopedProjects.length).padStart(2, "0")}</strong><span>projects</span></div>
                <div><strong>{String(sessions.length).padStart(2, "0")}</strong><span>sessions</span></div>
              </div>
            </section>
            <div className="section-bar">
              <div><span className="kicker">AI prioritized · 智能接续建议</span><h2>接着做 <small>{String(allSuggestions.length).padStart(2, "0")} suggestions</small></h2><p>最值得继续的工作，最多显示三项</p></div>
              <StatusFilters value={filter} onChange={setFilter} />
            </div>
            <div className="continuity-list">
              {suggestions.map((item, index) => (
                <article className="continuity-row" key={`${item.session.platform}:${item.session.id}:${item.session.path}`}>
                  <span className="work-index">{String(index + 1).padStart(2, "0")}</span>
                  <StatusBadge status={item.session.status} />
                  <div className="work-main"><small>{platformLabel(item.session.platform)} · {item.label}</small><strong>{item.title}</strong><p>{item.detail}</p></div>
                  <div className="row-actions"><button type="button" onClick={() => onEvidence(item.session)}>Evidence</button><button type="button" className="primary-action" onClick={() => onResume(item.session)} disabled={!buildResumeCommand(item.session)}>Continue</button></div>
                </article>
              ))}
              {suggestions.length === 0 ? <EmptyLine text="这个筛选范围里没有需要继续的工作。" /> : null}
            </div>
          </div>
          <aside className="brief-side">
            <section><h3>Execution order</h3><div className="execution-list">{allSuggestions.map((item, index) => <button key={item.session.id} type="button" onClick={() => onEvidence(item.session)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.title}</strong><small>{item.detail}</small></button>)}</div></section>
            <section><h3>Continuity pulse</h3><ActivityPulse sessions={sessions} /></section>
            <section><h3>Snapshot provenance</h3><div className="source-line"><span>Providers</span><code>{state.data.settings.enabledSessionProviders.length || "00"}</code></div><div className="source-line"><span>User sessions</span><code>{sessions.length}</code></div><div className="source-line"><span>Resumable</span><code>{resumable}</code></div><div className="source-line"><span>Completed</span><code>{completed}</code></div></section>
          </aside>
        </div>
      )}
    </section>
  );
}

function BriefSkeleton(): ReactElement {
  return <div className="skeleton-stage" aria-label="正在生成简报"><i className="hero" /><i /><i /><i /></div>;
}

function StateMessage({ kind, title, detail, action, onAction }: { kind: "error" | "empty"; title: string; detail: string; action?: string; onAction?(): void }): ReactElement {
  return <div className={`state-message ${kind}`}>{kind === "error" ? <AlertTriangle size={24} /> : <Layers3 size={24} />}<h2>{title}</h2><p>{detail}</p>{action && onAction ? <button type="button" onClick={onAction}>{action}</button> : null}</div>;
}

function StatusFilters({ value, onChange }: { value: StatusFilter; onChange(value: StatusFilter): void }): ReactElement {
  const values: Array<[StatusFilter, string]> = [["all", "全部"], ["active", "进行中"], ["blocked", "阻塞"], ["completed", "已完成"]];
  return <div className="filters">{values.map(([key, label]) => <button type="button" key={key} aria-pressed={value === key} onClick={() => onChange(key)}>{label}</button>)}</div>;
}

function ActivityPulse({ sessions }: { sessions: AgentWorkSession[] }): ReactElement {
  const hours = Array.from({ length: 24 }, () => 0);
  for (const session of sessions) {
    const hour = new Date(session.updatedAt).getHours();
    hours[hour] = (hours[hour] ?? 0) + 1;
  }
  const peak = Math.max(1, ...hours);
  return <><div className="pulse-chart" aria-label="24 小时会话活跃度">{hours.map((value, hour) => <i key={hour} className={value ? "hot" : ""} style={{ "--pulse": `${Math.max(8, (value / peak) * 100)}%` } as CSSProperties} />)}</div><div className="pulse-labels"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></>;
}

function SessionsPanel({ projects, sessions, selectedProjectKey, onProject, onEvidence, onResume }: { projects: ProjectGroup[]; sessions: AgentWorkSession[]; selectedProjectKey: string; onProject(key: string): void; onEvidence(session: AgentWorkSession): void; onResume(session: AgentWorkSession): void }): ReactElement {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const visible = useMemo(() => [...sessions].filter((session) => filter === "all" || session.status === filter).filter((session) => searchableSession(session).includes(query.trim().toLowerCase())).sort(sortByTimeDescending), [sessions, filter, query]);
  return (
    <section className="view sessions-view">
      <h1 className="sr-only">全部会话</h1>
      <ProjectStrip projects={projects} selected={selectedProjectKey} onProject={onProject} />
      <div className="session-toolbar">
        <div className="session-totals"><div><strong>{String(visible.length).padStart(2, "0")}</strong><span>visible</span></div><div><strong>{String(visible.filter((session) => session.status !== "completed").length).padStart(2, "0")}</strong><span>unfinished</span></div><div><strong>{String(new Set(visible.map((session) => session.platform)).size).padStart(2, "0")}</strong><span>sources</span></div></div>
        <div className="session-controls"><label>筛选会话<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="标题、项目、Session ID 或工作目录" /></label><StatusFilters value={filter} onChange={setFilter} /></div>
      </div>
      <div className="session-ledger-head"><span>Time</span><span>Status</span><span>Session</span><span>Source</span><span>Action</span></div>
      <div className="session-ledger">
        {visible.map((session) => <article key={`${session.platform}:${session.id}:${session.path}`}><time>{formatTime(session.updatedAt)}</time><StatusBadge status={session.status} /><div className="session-identity"><small>{projectNameForSession(projects, session)} · {summarySourceLabel(session)}</small><strong>{session.title}</strong><code>{session.id}</code></div><div className="session-provider"><strong>{platformLabel(session.platform)}</strong><span>{session.worktreePath ?? session.projectPath ?? session.path}</span></div><div className="row-actions"><button type="button" onClick={() => onEvidence(session)}>详情</button>{session.status !== "completed" ? <button type="button" className="primary-action" disabled={!buildResumeCommand(session)} onClick={() => onResume(session)}>继续</button> : null}</div></article>)}
        {visible.length === 0 ? <EmptyLine text="没有符合当前项目、状态和搜索条件的会话。" /> : null}
      </div>
    </section>
  );
}

function Timeline({ state, projects, sessions, selectedProjectKey, onProject, onDate, onEvidence }: { state: DesktopState; projects: ProjectGroup[]; sessions: AgentWorkSession[]; selectedProjectKey: string; onProject(key: string): void; onDate(date: string): void; onEvidence(session: AgentWorkSession): void }): ReactElement {
  const days = Array.from(new Set([state.activeDate, ...state.activityDates])).sort((a, b) => b.localeCompare(a)).slice(0, 12);
  return (
    <section className="view timeline-view">
      <h1 className="sr-only">Timeline</h1>
      <ProjectStrip projects={projects} selected={selectedProjectKey} onProject={onProject} />
      <div className="timeline-layout">
        <nav className="timeline-days" aria-label="活跃日期">{days.map((date) => <button key={date} type="button" aria-current={date === state.activeDate ? "date" : undefined} onClick={() => onDate(date)}><span>{date.slice(5)}</span><small>{date === localDate() ? "今天" : weekdayName(date)}</small></button>)}</nav>
        <div className="timeline-stream">
          {[...sessions].sort(sortByTime).map((session) => <button type="button" className={`timeline-event${session.status === "completed" ? " completed" : ""}`} key={`${session.platform}:${session.id}:${session.path}`} onClick={() => onEvidence(session)}><time>{formatTime(session.updatedAt)}</time><i /><div><small>{platformLabel(session.platform)} · {projectNameForSession(projects, session)} · {statusLabel(session.status)}</small><h3>{session.title}</h3><p>{session.summary}</p></div></button>)}
          {sessions.length === 0 ? <EmptyLine text="这个项目在所选日期没有确认的会话活动。" /> : null}
        </div>
      </div>
    </section>
  );
}

function MapPanel({ projects, selectedProjectKey, onProject, onOpenPath }: { projects: ProjectGroup[]; selectedProjectKey: string; onProject(key: string): void; onOpenPath(target: string): void }): ReactElement {
  const project = projects.find((item) => item.key === selectedProjectKey) ?? projects[0];
  const [context, setContext] = useState<ProjectContextState | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [focusId, setFocusId] = useState("");
  const [inspectorTab, setInspectorTab] = useState<"summary" | "sessions" | "document" | "relations">("summary");
  const [documentOpen, setDocumentOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setContext(null);
    setDocumentOpen(false);
    if (!project?.path) return;
    setContextLoading(true);
    void window.agentWhiteboard.getProjectContext(project.path).then((next) => { if (!cancelled) setContext(next); }).finally(() => { if (!cancelled) setContextLoading(false); });
    return () => { cancelled = true; };
  }, [project?.key, project?.path]);

  const nodes = useMemo(() => project ? buildMapNodes(project, context) : [], [project, context]);
  const rootId = nodes[0]?.id ?? "";
  const activeId = nodes.some((node) => node.id === focusId) ? focusId : rootId;
  const active = nodes.find((node) => node.id === activeId);
  const parent = active?.parentId ? nodes.find((node) => node.id === active.parentId) : undefined;
  const children = nodes.filter((node) => node.parentId === activeId);
  const visibleIds = new Set([activeId, parent?.id, ...children.map((node) => node.id)].filter(Boolean));
  const canvasRef = useRef<HTMLDivElement>(null);
  const [drawnEdges, setDrawnEdges] = useState<DrawnEdge[]>([]);

  useEffect(() => {
    if (!canvasRef.current || !active) return;
    const canvas = canvasRef.current;
    let frame = 0;
    const started = performance.now();
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 820;
    const draw = (): void => {
      const canvasRect = canvas.getBoundingClientRect();
      const elements = new Map<string, HTMLElement>();
      canvas.querySelectorAll<HTMLElement>("[data-map-node]").forEach((element) => elements.set(element.dataset.mapNode ?? "", element));
      const relations = [...(parent ? [{ from: parent, to: active, primary: false }] : []), ...children.map((child, index) => ({ from: active, to: child, primary: index === 0 }))];
      setDrawnEdges(relations.flatMap(({ from, to, primary }) => {
        const fromElement = elements.get(from.id);
        const toElement = elements.get(to.id);
        if (!fromElement || !toElement) return [];
        const a = fromElement.getBoundingClientRect();
        const b = toElement.getBoundingClientRect();
        const sx = a.left - canvasRect.left + a.width / 2;
        const sy = a.top - canvasRect.top + a.height / 2;
        const ex = b.left - canvasRect.left + b.width / 2;
        const ey = b.top - canvasRect.top + b.height / 2;
        const bend = (sy + ey) / 2;
        return [{ id: `${from.id}:${to.id}`, d: `M ${sx} ${sy} C ${sx} ${bend}, ${ex} ${bend}, ${ex} ${ey}`, x: (sx + ex) / 2, y: bend - 8, relation: to.relation, primary }];
      }));
    };
    const tick = (now: number): void => { draw(); if (now - started < duration) frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [activeId, active, parent, children.map((node) => node.id).join("|")]);

  if (!project) return <section className="view"><h1 className="sr-only">Project map</h1><StateMessage kind="empty" title="没有可以投影的项目" detail="Map 不会从其他日期借用项目。" /></section>;
  const positions = mapPositions(children.length);
  const trail = active ? mapTrail(nodes, active) : [];
  return (
    <section className="view map-view">
      <h1 className="sr-only">Project map</h1>
      <div className="project-strip map-project-strip">{projects.map((item) => <button key={item.key} type="button" aria-pressed={item.key === project.key} onClick={() => { onProject(item.key); setFocusId(""); }}>{item.name} <span>{String(item.sessions.length).padStart(2, "0")}</span></button>)}</div>
      <div className="map-workspace">
        <div className="map-canvas" ref={canvasRef}>
          <div className="map-breadcrumbs">{trail.map((node, index) => <button type="button" key={node.id} aria-current={index === trail.length - 1 ? "page" : undefined} onClick={() => { setFocusId(node.id); setInspectorTab("summary"); }}>{node.label}</button>)}</div>
          <div className="map-tools"><button type="button" onClick={() => setFocusId(rootId)}>返回总览</button></div>
          <svg className="map-lines" aria-hidden="true">{drawnEdges.map((edge) => <g key={edge.id}><path className={`${edge.primary ? "primary " : ""}${edge.relation}`} d={edge.d} /><text x={edge.x} y={edge.y} textAnchor="middle">{relationLabels[edge.relation]}</text></g>)}</svg>
          <div className="map-focus-ring" aria-hidden="true" />
          <div className="map-world">
            {nodes.map((node) => {
              const childIndex = children.findIndex((child) => child.id === node.id);
              const position = node.id === activeId ? { x: 50, y: 40, scale: 1.02 } : node.id === parent?.id ? { x: 50, y: 14, scale: .74 } : childIndex >= 0 ? { ...positions[childIndex], scale: .88 } : { x: 50, y: 40, scale: .68 };
              const style = { "--map-x": position.x, "--map-y": position.y, "--map-scale": position.scale, "--map-delay": `${Math.max(0, childIndex) * 55}ms` } as CSSProperties;
              return <button key={node.id} type="button" data-map-node={node.id} data-state={node.state} className={`map-node${visibleIds.has(node.id) ? " visible" : ""}${node.id === activeId ? " active" : ""}${node.id === parent?.id ? " parent" : ""}`} style={style} onClick={() => { setFocusId(node.id); setInspectorTab("summary"); }}><span className="map-node-head"><span>{node.kind}</span><i /></span><span className="map-node-body"><strong>{node.label}</strong><p>{node.summary}</p><small>{node.sessionIds.length} sessions <em>{node.confidence === "confirmed" ? "已确认" : "会话推断"}</em></small></span></button>;
            })}
          </div>
        </div>
        <aside className="map-inspector">
          {active ? <><header><div><span className="kicker">{active.kind} · {active.confidence}</span><h2>{active.label}</h2></div><StatusBadge status={active.state} /></header><nav>{(["summary", "sessions", "document", "relations"] as const).map((tab) => <button type="button" key={tab} aria-selected={inspectorTab === tab} onClick={() => setInspectorTab(tab)}>{({ summary: "摘要", sessions: "今日会话", document: "项目文档", relations: "关系" })[tab]}</button>)}</nav><div className="inspector-body">{inspectorTab === "summary" ? <MapSummary node={active} childCount={children.length} context={context} contextLoading={contextLoading} /> : inspectorTab === "sessions" ? <MapSessions node={active} project={project} /> : inspectorTab === "document" ? <MapDocument node={active} context={context} onRead={() => setDocumentOpen(true)} /> : <MapRelations node={active} nodes={nodes} onFocus={(id) => { setFocusId(id); setInspectorTab("summary"); }} />}</div><footer><button type="button" disabled={!active.document} onClick={() => setDocumentOpen(true)}>阅读原文</button>{active.document ? <button type="button" className="primary-action" onClick={() => onOpenPath(active.document?.path ?? "")}><ExternalLink size={14} />在默认应用中打开</button> : null}</footer></> : null}
        </aside>
      </div>
      {documentOpen && active?.document ? <DocumentDrawer document={active.document} onClose={() => setDocumentOpen(false)} onOpen={() => onOpenPath(active.document?.path ?? "")} /> : null}
    </section>
  );
}

function MapSummary({ node, childCount, context, contextLoading }: { node: ContextMapNode; childCount: number; context: ProjectContextState | null; contextLoading: boolean }): ReactElement {
  return <><h3>Current meaning</h3><p>{node.summary}</p><h3>Why this node exists</h3><div className="inspector-card"><strong>{node.sourceLabel}</strong><span>{node.confidence}</span><code>{node.document?.relativePath ?? node.session?.id ?? "daily session projection"}</code></div><h3>Canonical facts</h3><dl className="fact-list"><div><dt>状态</dt><dd>{statusLabel(node.state)}</dd></div><div><dt>直属分支</dt><dd>{childCount}</dd></div><div><dt>会话</dt><dd>{node.sessionIds.length}</dd></div><div><dt>项目文档</dt><dd>{contextLoading ? "读取中" : context?.documents.length ? `${context.documents.length} 条` : "未发现"}</dd></div></dl>{context?.warnings.map((warning) => <p className="context-warning" key={warning}><AlertTriangle size={14} />{warning}</p>)}</>;
}

function MapSessions({ node, project }: { node: ContextMapNode; project: ProjectGroup }): ReactElement {
  const records = project.sessions.filter((session) => node.sessionIds.includes(session.id));
  return records.length ? <div className="inspector-session-list">{records.map((session) => <article key={`${session.platform}:${session.id}`}><span>{platformLabel(session.platform)} · {formatTime(session.updatedAt)}</span><strong>{session.title}</strong><code>{session.id}</code></article>)}</div> : <EmptyLine text="这个节点没有直接绑定今日会话。" />;
}

function MapDocument({ node, context, onRead }: { node: ContextMapNode; context: ProjectContextState | null; onRead(): void }): ReactElement {
  if (node.document) return <><h3>{node.document.label}</h3><div className="document-preview"><code>{node.document.relativePath}</code><p>{markdownExcerpt(node.document.content)}</p><button type="button" onClick={onRead}>阅读完整原文</button></div></>;
  return <div className="context-empty"><FileText size={22} /><strong>这个节点没有直接项目文档</strong><p>{context?.storePath ? "可以沿关系回到有文档依据的上层节点。" : "项目仍由会话证据保留，Map 不会伪造文档关系。"}</p></div>;
}

function MapRelations({ node, nodes, onFocus }: { node: ContextMapNode; nodes: ContextMapNode[]; onFocus(id: string): void }): ReactElement {
  const parent = node.parentId ? nodes.find((item) => item.id === node.parentId) : undefined;
  const related = [...(parent ? [parent] : []), ...nodes.filter((item) => item.parentId === node.id)];
  return related.length ? <div className="relation-list">{related.map((item) => <button type="button" key={item.id} onClick={() => onFocus(item.id)}><span>{item.parentId === node.id ? "流向" : "来自"} · {relationLabels[item.parentId === node.id ? item.relation : node.relation]}</span><strong>{item.label}</strong><small>{item.sourceLabel}</small></button>)}</div> : <EmptyLine text="这是当前树中的末端节点。" />;
}

function DocumentDrawer({ document, onClose, onOpen }: { document: ProjectContextDocument; onClose(): void; onOpen(): void }): ReactElement {
  return <div className="drawer-layer"><button className="drawer-backdrop" type="button" aria-label="关闭项目文档" onClick={onClose} /><aside className="document-drawer"><header><div><span className="kicker">Project document / read only</span><h2>{document.label}</h2><code>{document.relativePath}</code></div><button type="button" aria-label="关闭" onClick={onClose}><X size={19} /></button></header><pre>{document.content}</pre><footer><button type="button" onClick={onOpen}><ExternalLink size={15} />在默认应用打开</button></footer></aside></div>;
}

function SourcesPanel({ state, onProvider, onAddRoot, onOpenPath }: { state: DesktopState; onProvider(provider: SessionProvider): void; onAddRoot(): void; onOpenPath(target: string): void }): ReactElement {
  const enabled = new Set(state.data.settings.enabledSessionProviders);
  return (
    <section className="view sources-view">
      <ViewHeading kicker="Trust surface / local evidence" title="Sources" />
      <div className="source-grid">
        <div className="source-main">
          {(["codex", "claude"] as SessionProvider[]).map((provider) => <button type="button" className="source-record" key={provider} onClick={() => onProvider(provider)}><Bot size={18} /><span><strong>{platformLabel(provider)} sessions</strong><code>{provider === "codex" ? "~/.codex/sessions/" : "~/.claude/projects/"}</code></span><em data-enabled={enabled.has(provider)}>{enabled.has(provider) ? "connected" : "disabled"}</em></button>)}
          <div className="source-record static"><Archive size={18} /><span><strong>Archived sessions</strong><code>provider-specific archives</code></span><em>read only</em></div>
          <div className="source-record static"><FileText size={18} /><span><strong>Project context</strong><code>&lt;project&gt;/ctx → current overview, progress, spec, decisions</code></span><em>on demand</em></div>
          <div className="source-record static"><Bot size={18} /><span><strong>Smart session titles</strong><code>Codex: {state.summaryJob?.models.codex ?? "provider default"} · Claude: {state.summaryJob?.models.claude ?? "provider default"}</code></span><em>{summaryJobLabel(state)}</em></div>
          {state.data.settings.sessionScanRoots.map((root) => <button type="button" className="source-record root" key={root} onClick={() => onOpenPath(root)}><FolderOpen size={18} /><span><strong>Scan root</strong><code>{root}</code></span><em>local</em></button>)}
          <button type="button" className="add-root" onClick={onAddRoot}>添加读取目录</button>
        </div>
        <aside>
          <div className="policy-list"><div><strong>Provider files</strong><span>read-only</span></div><div><strong>Smart titles</strong><span>provider CLI · ephemeral</span></div><div><strong>Summary cache</strong><span>local only</span></div><div><strong>Resume action</strong><span>copy only</span></div></div>
          <section><span className="kicker">Snapshot diagnostics</span><p>{state.data.workSessionSnapshot.generatedAt ? `生成于 ${formatTime(state.data.workSessionSnapshot.generatedAt)}` : "尚未生成"}</p>{state.summaryJob?.message ? <div className={`diagnostic ${state.summaryJob.status === "complete" ? "ok" : ""}`}><Bot size={14} />{state.summaryJob.message}</div> : null}{state.data.workSessionSnapshot.warnings.length ? state.data.workSessionSnapshot.warnings.map((warning) => <div className="diagnostic" key={warning}><AlertTriangle size={14} />{warning}</div>) : <div className="diagnostic ok"><Check size={14} />没有读取警告</div>}</section>
          <button type="button" className="storage-button" onClick={() => onOpenPath(state.userDataPath)}><Settings size={17} />打开应用数据目录</button>
        </aside>
      </div>
    </section>
  );
}

function EvidenceDrawer({ session, onClose, onCopy, onOpen }: { session: AgentWorkSession; onClose(): void; onCopy(): void; onOpen(): void }): ReactElement {
  const resume = buildResumeCommand(session);
  return <div className="drawer-layer"><button className="drawer-backdrop" type="button" aria-label="关闭会话详情" onClick={onClose} /><aside className="evidence-drawer"><header><div><span className="kicker">Evidence / continuation</span><h2>{session.title}</h2></div><button type="button" aria-label="关闭" onClick={onClose}><X size={19} /></button></header><div className="drawer-content"><section><h3>Current stop</h3><p>{session.summary}</p></section><section><h3>Why this status</h3><p>{statusReason(session)}</p></section><section><h3>Canonical handles</h3><dl><div><dt>Provider</dt><dd>{platformLabel(session.platform)}</dd></div>{isArchivedSession(session) ? <div><dt>Storage state</dt><dd><span className="archive-state"><Archive size={13} />已归档</span></dd></div> : null}<div><dt>Session ID</dt><dd><code>{session.id}</code></dd></div><div><dt>Working directory</dt><dd><code>{session.worktreePath ?? session.projectPath ?? session.repositoryPath ?? "未识别"}</code></dd></div><div><dt>Rollout path</dt><dd><code>{session.path}</code></dd></div><div><dt>Updated</dt><dd><code>{session.updatedAt}</code></dd></div></dl></section>{session.artifacts.length ? <section><h3>Artifacts</h3>{session.artifacts.map((artifact) => <code className="artifact" key={artifact}>{artifact}</code>)}</section> : null}</div><footer><button type="button" onClick={onOpen}><FileText size={14} />打开记录</button><code>{resume ?? "No verified resume handle"}</code><button type="button" className="primary-action" disabled={!resume} onClick={onCopy}><Clipboard size={14} />Copy resume</button></footer></aside></div>;
}

function TranscriptReader({ session, onClose }: { session: AgentWorkSession; onClose(): void }): ReactElement {
  const [transcript, setTranscript] = useState<SessionTranscriptState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTranscript(null);
    setError(null);
    void window.agentWhiteboard.getSessionTranscript({ id: session.id, platform: session.platform, path: session.path })
      .then((next) => { if (!cancelled) setTranscript(next); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "会话记录暂时无法读取。 "); });
    return () => { cancelled = true; };
  }, [session.id, session.path, session.platform]);

  return (
    <div className="transcript-layer" role="dialog" aria-modal="true" aria-label={`${session.title} 会话记录`}>
      <button className="transcript-backdrop" type="button" aria-label="关闭会话记录" onClick={onClose} />
      <section className="transcript-reader">
        <header>
          <div><span className="kicker">Conversation archive / read only</span><h2>{session.title}</h2><p>{platformLabel(session.platform)} · <code>{session.id}</code></p></div>
          <button type="button" aria-label="关闭会话记录" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="transcript-scroll">
          {!transcript && !error ? <TranscriptSkeleton /> : null}
          {error ? <StateMessage kind="error" title="会话记录暂时无法读取" detail={error} /> : null}
          {transcript?.warning ? <div className="transcript-warning"><AlertTriangle size={15} />{transcript.warning}</div> : null}
          {transcript && transcript.messages.length === 0 ? <StateMessage kind="empty" title="没有可显示的对话正文" detail="文件存在，但没有识别到用户或助手消息；系统指令和工具事件不会作为正文铺开。" /> : null}
          {transcript?.messages.map((message, index) => {
            const previous = transcript.messages[index - 1];
            const day = transcriptDay(message.timestamp);
            const previousDay = transcriptDay(previous?.timestamp);
            return <div className="transcript-entry" key={message.id}>{day && day !== previousDay ? <div className="transcript-day"><span>{day}</span></div> : null}<article data-role={message.role}><aside><strong>{message.role === "user" ? "You" : platformLabel(session.platform)}</strong><time>{message.timestamp ? transcriptTime(message.timestamp) : ""}</time></aside><div className="transcript-copy"><ReadableTranscriptText content={message.content} /></div></article></div>;
          })}
        </div>
        <footer><div><strong>{transcript?.messages.length ?? 0}</strong><span>messages</span>{transcript?.omittedToolEvents ? <><strong>{transcript.omittedToolEvents}</strong><span>tool events folded</span></> : null}</div><button type="button" onClick={onClose}>回到证据</button></footer>
      </section>
    </div>
  );
}

function ReadableTranscriptText({ content }: { content: string }): ReactElement {
  const segments = content.split(/```/);
  return <>{segments.map((segment, index) => index % 2 === 1 ? <pre key={index}><code>{segment.replace(/^\w+\n/, "")}</code></pre> : <div key={index}>{segment.split(/\n{2,}/).filter(Boolean).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}</div>)}</>;
}

function TranscriptSkeleton(): ReactElement {
  return <div className="transcript-skeleton" aria-label="正在整理会话内容"><i /><i /><i /><i /></div>;
}

function CommandPalette({ state, projects, sessions, onClose, onProject, onSession, onDate }: { state: DesktopState; projects: ProjectGroup[]; sessions: AgentWorkSession[]; onClose(): void; onProject(key: string): void; onSession(session: AgentWorkSession): void; onDate(date: string): void }): ReactElement {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const needle = query.trim().toLowerCase();
  const matchingProjects = projects.filter((project) => `${project.name} ${project.path}`.toLowerCase().includes(needle)).slice(0, 5);
  const matchingSessions = sessions.filter((session) => searchableSession(session).includes(needle)).slice(0, 7);
  const matchingDates = Array.from(new Set([state.activeDate, ...state.activityDates])).filter((date) => date.includes(needle)).slice(0, 5);
  return <div className="command-layer" role="dialog" aria-modal="true"><button type="button" className="command-backdrop" aria-label="关闭搜索" onClick={onClose} /><div className="command-modal"><label><Search size={19} /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目、会话或日期" /><kbd>Esc</kbd></label><div className="command-results">{matchingProjects.map((project) => <button type="button" key={project.key} onClick={() => onProject(project.key)}><FolderOpen size={16} /><span><strong>{project.name}</strong><small>{project.sessions.length} sessions · {project.path}</small></span></button>)}{matchingSessions.map((session) => <button type="button" key={`${session.platform}:${session.id}:${session.path}`} onClick={() => onSession(session)}><Clock3 size={16} /><span><strong>{session.title}</strong><small>{platformLabel(session.platform)} · {session.id}</small></span></button>)}{matchingDates.map((date) => <button type="button" key={date} onClick={() => onDate(date)}><CalendarDays size={16} /><span><strong>{formatDateTitle(date)}</strong><small>{date === state.activeDate ? "当前简报" : "历史简报"}</small></span></button>)}{matchingProjects.length + matchingSessions.length + matchingDates.length === 0 ? <EmptyLine text="没有匹配的项目、会话或日期。" /> : null}</div></div></div>;
}

function StatusBadge({ status }: { status: AgentSessionStatus }): ReactElement {
  return <span className="status-badge" data-status={status}>{statusLabel(status)}</span>;
}

function EmptyLine({ text }: { text: string }): ReactElement {
  return <div className="empty-line"><Layers3 size={18} />{text}</div>;
}

function groupSessionsByProject(sessions: AgentWorkSession[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const session of sessions) {
    const projectPath = session.worktreePath ?? session.projectPath ?? session.repositoryPath;
    const key = projectPath || `unresolved:${session.platform}`;
    const existing = groups.get(key);
    if (existing) existing.sessions.push(session);
    else {
      const group: ProjectGroup = { key, name: projectPath ? basename(projectPath) : `${platformLabel(session.platform)} 未识别项目`, sessions: [session] };
      if (projectPath) group.path = projectPath;
      groups.set(key, group);
    }
  }
  return [...groups.values()].sort((a, b) => Math.max(...b.sessions.map((item) => Date.parse(item.updatedAt))) - Math.max(...a.sessions.map((item) => Date.parse(item.updatedAt))));
}

function sessionsForProject(projects: ProjectGroup[], sessions: AgentWorkSession[], key: string): AgentWorkSession[] {
  return key === "all" ? sessions : projects.find((project) => project.key === key)?.sessions ?? [];
}

function buildSuggestions(sessions: AgentWorkSession[]): ContinuityItem[] {
  const weights: Record<AgentSessionStatus, number> = { blocked: 0, active: 1, unknown: 2, completed: 3 };
  return [...sessions].filter((session) => session.status !== "completed" || Boolean(buildResumeCommand(session))).sort((a, b) => weights[a.status] - weights[b.status] || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 3).map((session) => ({ label: session.status === "blocked" ? "Decision boundary" : session.status === "active" ? "Continue here" : "Needs review", title: session.title, detail: session.summary, session }));
}

function buildMapNodes(project: ProjectGroup, context: ProjectContextState | null): ContextMapNode[] {
  const rootId = `project:${project.key}`;
  const sessions = project.sessions;
  const rootState = aggregateStatus(sessions);
  const nodes: ContextMapNode[] = [{ id: rootId, kind: "PROJECT", label: project.name, summary: projectSummary(project), state: rootState, relation: "related", sessionIds: sessions.map((session) => session.id), sourceLabel: "会话快照", confidence: "confirmed" }];
  const sessionGroupId = `${rootId}:sessions`;
  nodes.push({ id: sessionGroupId, parentId: rootId, kind: "WORK", label: "今日会话", summary: `${sessions.length} 条会话构成今天的项目活动。`, state: rootState, relation: "continues", sessionIds: sessions.map((session) => session.id), sourceLabel: "Provider 会话记录", confidence: "confirmed" });
  for (const session of sessions) nodes.push({ id: `${sessionGroupId}:${session.platform}:${session.id}:${encodeURIComponent(session.path)}`, parentId: sessionGroupId, kind: "SESSION", label: session.title, summary: session.summary, state: session.status, relation: "continues", sessionIds: [session.id], sourceLabel: `${platformLabel(session.platform)} 会话`, confidence: session.summarySource === "metadata" ? "inferred" : "confirmed", session });
  if (!context?.documents.length) return nodes;
  const directKinds: Array<ProjectContextDocument["kind"]> = ["overview", "progress"];
  for (const kind of directKinds) {
    for (const document of context.documents.filter((item) => item.kind === kind)) nodes.push(documentNode(document, rootId, project, kind === "overview" ? "项目总览" : "当前进度"));
  }
  for (const [kind, label, summary] of [["spec", "产品说明", "当前生效的产品范围与要求。"], ["decision", "关键决定", "已经确认的产品与架构选择。"]] as const) {
    const documents = context.documents.filter((item) => item.kind === kind);
    if (!documents.length) continue;
    const groupId = `${rootId}:${kind}`;
    nodes.push({ id: groupId, parentId: rootId, kind: "WORK", label, summary, state: "active", relation: "documents", sessionIds: [], sourceLabel: "项目文档索引", confidence: "confirmed" });
    for (const document of documents) nodes.push(documentNode(document, groupId, project));
  }
  return nodes;
}

function documentNode(document: ProjectContextDocument, parentId: string, project: ProjectGroup, label?: string): ContextMapNode {
  return { id: `document:${project.key}:${document.relativePath}`, parentId, kind: "DOCUMENT", label: label ?? document.label, summary: markdownExcerpt(document.content), state: document.kind === "decision" ? "completed" : "active", relation: "documents", sessionIds: project.sessions.map((session) => session.id), sourceLabel: "项目文档", confidence: "confirmed", document };
}

function mapPositions(count: number): Array<{ x: number; y: number }> {
  const sets: Record<number, Array<{ x: number; y: number }>> = { 0: [], 1: [{ x: 50, y: 72 }], 2: [{ x: 27, y: 70 }, { x: 73, y: 70 }], 3: [{ x: 18, y: 68 }, { x: 50, y: 74 }, { x: 82, y: 68 }], 4: [{ x: 13, y: 67 }, { x: 38, y: 74 }, { x: 62, y: 74 }, { x: 87, y: 67 }], 5: [{ x: 10, y: 65 }, { x: 30, y: 74 }, { x: 50, y: 78 }, { x: 70, y: 74 }, { x: 90, y: 65 }] };
  return sets[Math.min(5, count)] ?? [];
}

function mapTrail(nodes: ContextMapNode[], node: ContextMapNode): ContextMapNode[] {
  const trail: ContextMapNode[] = [];
  let current: ContextMapNode | undefined = node;
  while (current) { trail.unshift(current); current = current.parentId ? nodes.find((item) => item.id === current?.parentId) : undefined; }
  return trail;
}

function aggregateStatus(sessions: AgentWorkSession[]): AgentSessionStatus {
  if (sessions.some((session) => session.status === "blocked")) return "blocked";
  if (sessions.some((session) => session.status === "active")) return "active";
  if (sessions.length && sessions.every((session) => session.status === "completed")) return "completed";
  return "unknown";
}

function summaryLine(projects: ProjectGroup[], sessions: AgentWorkSession[]): string {
  const unfinished = sessions.filter((session) => session.status !== "completed");
  if (!unfinished.length) return `今天的 ${sessions.length} 条会话已经收口，可以安心回顾。`;
  const lead = projects[0]?.name ?? "当前项目";
  return `今天主要推进 ${lead}；${unfinished.length} 条工作线仍值得接着做。`;
}

function summaryDetail(sessions: AgentWorkSession[]): string {
  const blocked = sessions.filter((session) => session.status === "blocked").length;
  const active = sessions.filter((session) => session.status === "active").length;
  if (blocked) return `${blocked} 条工作被明确边界阻塞，${active} 条仍在推进。先解决阻塞，再从保留的恢复入口继续。`;
  if (active) return `${active} 条工作仍在推进。会话身份、停点和恢复入口都来自本机只读记录。`;
  return "当前没有明确阻塞；所有结论都保留来源路径和不确定性。";
}

function projectSummary(project: ProjectGroup): string {
  const unfinished = project.sessions.filter((session) => session.status !== "completed").length;
  return unfinished ? `${project.sessions.length} 条会话中有 ${unfinished} 条仍未收口。` : `${project.sessions.length} 条会话已经完成。`;
}

function markdownExcerpt(content: string): string {
  const clean = content.replace(/^---[\s\S]*?---\s*/m, "").replace(/^#{1,6}\s+.*$/gm, "").replace(/```[\s\S]*?```/g, "").replace(/\[[^\]]+\]\([^\)]+\)/g, (match) => match.replace(/\]\([^)]+\)/, "")).replace(/[*_>`|]/g, "").replace(/\s+/g, " ").trim();
  return clean.slice(0, 180) || "项目文档没有可显示的摘要。";
}

function projectNameForSession(projects: ProjectGroup[], session: AgentWorkSession): string {
  return projects.find((project) => project.sessions.includes(session))?.name ?? "未识别项目";
}

function searchableSession(session: AgentWorkSession): string {
  return `${session.title} ${session.summary} ${session.id} ${session.path} ${session.projectPath ?? ""} ${session.worktreePath ?? ""} ${platformLabel(session.platform)}`.toLowerCase();
}

function statusReason(session: AgentWorkSession): string {
  if (isArchivedSession(session)) return "Codex 已将这条会话移入归档，因此按已完成显示；模型摘要不会覆盖这个事实。";
  if (session.status === "blocked") return "会话证据显示工作停在一个尚未解除的边界或外部条件上。";
  if (session.status === "completed") return "会话记录中出现了明确的完成或交付信号。";
  if (session.status === "active") return "会话仍包含可继续的工作停点，并保留了恢复入口。";
  return "现有证据不足以安全判断是否完成，因此保留为未知。";
}

function isArchivedSession(session: AgentWorkSession): boolean {
  return /(?:^|[\\/])archived_sessions(?:[\\/]|$)/i.test(session.path)
    || /(?:^|[\\/])archive(?:[\\/]|$)/i.test(session.path);
}

function statusLabel(status: AgentSessionStatus): string {
  return ({ active: "进行中", blocked: "阻塞", completed: "已完成", unknown: "待核对" })[status];
}

function platformLabel(platform: string): string {
  if (platform === "codex") return "Codex";
  if (platform === "claude") return "Claude Code";
  if (platform === "minimax") return "MiniMax";
  return "Other";
}

function summarySourceLabel(session: AgentWorkSession): string {
  if (session.summarySource === "codex") return "Codex AI 摘要";
  if (session.summarySource === "claude") return "Claude AI 摘要";
  return "元数据标题";
}

function summaryJobLabel(state: DesktopState): string {
  const job = state.summaryJob;
  if (!job) return "metadata";
  if (job.status === "running") return `${job.completed}/${job.total} summarizing`;
  if (job.status === "complete") return job.total ? `${job.completed}/${job.total} cached` : "cached";
  if (job.status === "unavailable") return "metadata fallback";
  return "disabled";
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function transcriptDay(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(date);
}

function transcriptTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function sortByTime(a: AgentWorkSession, b: AgentWorkSession): number { return Date.parse(a.updatedAt) - Date.parse(b.updatedAt); }
function sortByTimeDescending(a: AgentWorkSession, b: AgentWorkSession): number { return Date.parse(b.updatedAt) - Date.parse(a.updatedAt); }
function basename(value: string): string { return value.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || value; }

function formatDateTitle(value: string): string {
  const date = parseLocalDate(value);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 · ${weekdayName(value)}`;
}

function dateSubtitle(value: string): string {
  const difference = Math.round((parseLocalDate(value).getTime() - parseLocalDate(localDate()).getTime()) / 86_400_000);
  if (difference === 0) return "TODAY · 00:00—NOW";
  if (difference === -1) return "昨天 · ARCHIVED DAY";
  if (difference < 0) return `${Math.abs(difference)} 天前 · ARCHIVED DAY`;
  return `${difference} 天后`;
}

function weekdayName(value: string): string { return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(parseLocalDate(value)).replace("周", "周"); }
function monthLabel(value: string): string { const date = parseLocalDate(value); return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`; }
function localDate(date = new Date()): string { const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 10); }
function parseLocalDate(value: string): Date { const [year = 1970, month = 1, day = 1] = value.split("-").map(Number); return new Date(year, month - 1, day); }
function shiftDate(value: string, amount: number): string { const date = parseLocalDate(value); date.setDate(date.getDate() + amount); return localDate(date); }

function buildCalendarDays(value: string): Array<{ date: string; label: number; inMonth: boolean }> {
  const selected = parseLocalDate(value);
  const first = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return { date: localDate(date), label: date.getDate(), inMonth: date.getMonth() === selected.getMonth() }; });
}

createRoot(document.getElementById("root")!).render(<App />);
