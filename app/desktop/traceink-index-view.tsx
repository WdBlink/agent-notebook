import { useEffect, useId, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DailyReviewPreparationState } from "../../src/daily-review-schedule";
import type { TraceinkReviewProjection } from "../../src/traceink-review-state";
import type { TraceinkWorklineReviewState } from "../../src/traceink-review-state";

export interface TraceinkIndexViewProps {
  projection: TraceinkReviewProjection;
  preparation: DailyReviewPreparationState;
  error?: string | null | undefined;
  onCompile(): void | Promise<void>;
  onRefresh(): void | Promise<void>;
}

type TraceinkRequestMode = "compile" | "refresh";

const MARKDOWN_COMPONENTS: Components = {
  a({ children, href }) {
    return <InertReference destination={href}>{children}</InertReference>;
  },
  img({ alt, src }) {
    return (
      <span className="traceink-markdown-media" data-traceink-inert-media="true">
        <span>{alt?.trim() || "图像引用"}</span>
        {src ? <code>{src}</code> : null}
      </span>
    );
  }
};

/**
 * Presents the canonical Traceink index without interpreting its Markdown.
 * The document is rendered once, in source order, and every generated link is inert.
 */
export function TraceinkIndexView({
  projection,
  preparation,
  error,
  onCompile,
  onRefresh
}: TraceinkIndexViewProps): ReactElement {
  const headingId = useId();
  const [requestedMode, setRequestedMode] = useState<TraceinkRequestMode | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedWorklineId, setSelectedWorklineId] = useState<string | null>(null);
  const [dossierOverride, setDossierOverride] = useState<TraceinkWorklineReviewState | null>(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [reflectionText, setReflectionText] = useState("");
  const [reflectionSaving, setReflectionSaving] = useState(false);
  const activeIndex = projection.activeIndex;
  const worklines = projection.worklines ?? [];
  const preparing = preparation.status === "preparing" || requestedMode !== null;
  const displayedError = actionError ?? error ?? (preparation.status === "failed" ? preparation.message : undefined);
  const selected = dossierOverride?.selection.worklineId === selectedWorklineId
    ? dossierOverride
    : worklines.find((item) => item.selection.worklineId === selectedWorklineId);

  useEffect(() => {
    if (selected?.reflection) setReflectionText(selected.reflection.text);
  }, [selected?.reflection?.contentHash]);

  async function request(mode: TraceinkRequestMode): Promise<void> {
    setRequestedMode(mode);
    setActionError(null);
    try {
      await (mode === "compile" ? onCompile() : onRefresh());
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "工作脉络整理没有完成；已有材料没有被替换。");
    } finally {
      setRequestedMode(null);
    }
  }

  async function openWorkline(workline: TraceinkWorklineReviewState): Promise<void> {
    setSelectedWorklineId(workline.selection.worklineId);
    setDossierOverride(workline);
    setReflectionText(workline.reflection?.text ?? "");
    setActionError(null);
    if (workline.dossier) return;
    setDossierLoading(true);
    try {
      const state = await window.agentWhiteboard.prepareTraceinkDossier(activeIndex!.logicalDate, workline.selection);
      const next = state.traceinkReview.worklines?.find((item) => item.selection.worklineId === workline.selection.worklineId);
      if (!next?.dossier) throw new Error("证据档案没有完成。");
      setDossierOverride(next);
      setReflectionText(next.reflection?.text ?? "");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "这条工作线的证据档案没有完成。");
    } finally {
      setDossierLoading(false);
    }
  }

  async function saveReflection(): Promise<void> {
    if (!selected?.dossier || !reflectionText.trim()) return;
    setReflectionSaving(true);
    setActionError(null);
    try {
      const state = await window.agentWhiteboard.saveTraceinkReflection(
        selected.dossier.logicalDate,
        {
          artifactId: selected.dossier.id,
          stage: "dossier",
          revision: selected.dossier.revision,
          outputHash: selected.dossier.outputHash
        },
        reflectionText
      );
      const next = state.traceinkReview.worklines?.find((item) => item.selection.worklineId === selected.selection.worklineId);
      if (next) setDossierOverride(next);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "你的回顾没有保存成功。");
    } finally {
      setReflectionSaving(false);
    }
  }

  if (preparing && !activeIndex) {
    return <TraceinkIndexSkeleton headingId={headingId} />;
  }

  if (!activeIndex) {
    return (
      <TraceinkRawState
        headingId={headingId}
        evidenceCount={projection.uncompiledEvidence.length}
        diagnostic={projection.diagnostic}
        preparation={preparation}
        error={displayedError}
        preparing={preparing}
        onCompile={() => void request("compile")}
      />
    );
  }

  const staleEvidenceCount = projection.uncompiledEvidence.length;
  const warnings = uniqueMessages([
    ...(projection.diagnostic ? [projection.diagnostic] : []),
    ...activeIndex.warnings
  ]);

  return (
    <section
      className={`traceink-index-view is-${projection.mode}`}
      aria-labelledby={headingId}
      aria-busy={preparing}
    >
      <header className="traceink-index-head">
        <div className="traceink-index-title">
          <span className="traceink-index-kicker">TRACEINK / CANONICAL REVIEW</span>
          <h1 id={headingId}>今日工作脉络</h1>
          <p>按原始 Session 证据整理；正文是本次回看的完整权威版本。</p>
        </div>
        <div className="traceink-index-status" role="status" aria-live="polite">
          <span data-state={projection.mode}>{projection.mode === "stale" ? "有新证据" : "已整理"}</span>
          <small>
            {projection.mode === "stale"
              ? staleEvidenceCount > 0
                ? `${staleEvidenceCount} 条证据尚未进入当前版本`
                : "来源集合或证据完整性发生变化"
              : `版本 ${activeIndex.revision} · ${formatDateTime(activeIndex.producer.completedAt, activeIndex.producer.scope?.timeZone)}`}
          </small>
        </div>
        {projection.mode === "stale" ? (
          <button
            type="button"
            className="traceink-index-action"
            disabled={preparing}
            onClick={() => void request("refresh")}
          >
            {preparing ? "正在更新…" : "更新工作脉络"}
          </button>
        ) : null}
      </header>

      {preparing ? (
        <div className="traceink-index-progress" role="status">
          <i aria-hidden="true" />
          <span>新版本正在后台整理，当前版本仍可阅读。</span>
        </div>
      ) : null}
      {displayedError ? (
        <div className="traceink-index-alert" role="alert">
          <strong>更新没有替换当前版本</strong>
          <span>{displayedError}</span>
        </div>
      ) : null}

      <div className="traceink-index-reading-grid">
        <article className="traceink-index-document" aria-label="Traceink 工作脉络正文">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={MARKDOWN_COMPONENTS}
            urlTransform={preserveInertDestination}
          >
            {activeIndex.rawMarkdown}
          </ReactMarkdown>
        </article>

        <aside className="traceink-index-margin" aria-label="本次整理信息">
          <section>
            <span className="traceink-margin-label">整理来源</span>
            <dl className="traceink-index-facts">
              <div><dt>执行器</dt><dd>{producerLabel(activeIndex.producer.provider)}</dd></div>
              <div><dt>模型</dt><dd>{activeIndex.producer.model}</dd></div>
              {activeIndex.producer.reasoningConfiguration
                ? <div><dt>推理</dt><dd>{activeIndex.producer.reasoningConfiguration}</dd></div>
                : null}
              <div><dt>证据</dt><dd>{activeIndex.evidence.length} 条</dd></div>
            </dl>
          </section>

          {activeIndex.producer.scope ? (
            <section>
              <span className="traceink-margin-label">材料范围</span>
              <p className="traceink-index-scope">
                <time dateTime={activeIndex.producer.scope.startInclusive}>{formatDateTime(activeIndex.producer.scope.startInclusive, activeIndex.producer.scope.timeZone)}</time>
                <span aria-hidden="true">—</span>
                <time dateTime={activeIndex.producer.scope.endExclusive}>{formatDateTime(activeIndex.producer.scope.endExclusive, activeIndex.producer.scope.timeZone)}</time>
              </p>
              <small>{activeIndex.producer.scope.timeZone} · 截止 {formatDateTime(activeIndex.producer.scope.evidenceCutoff, activeIndex.producer.scope.timeZone)}</small>
            </section>
          ) : null}

          {projection.mode === "stale" ? (
            <section className="traceink-index-freshness">
              <span className="traceink-margin-label">版本边界</span>
              <strong>{staleEvidenceCount > 0 ? `${staleEvidenceCount} 条新证据` : "来源边界变化"}</strong>
              <p>
                {staleEvidenceCount > 0
                  ? "新证据保留在原始工作现场中，更新完成前不会改写这份正文。"
                  : "当前正文继续可读；重新整理前，系统不会推测缺失或变化的来源。"}
              </p>
            </section>
          ) : null}

          {warnings.length > 0 ? (
            <details className="traceink-index-warnings">
              <summary>{warnings.length} 条整理说明</summary>
              <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </details>
          ) : null}

          {worklines.length > 0 ? (
            <section className="traceink-workline-actions" aria-label="展开工作线">
              <span className="traceink-margin-label">逐条展开</span>
              {worklines.map((workline) => (
                <button key={workline.selection.worklineId} type="button" onClick={() => void openWorkline(workline)}>
                  <strong>{workline.selection.ordinal}</strong>
                  <span>{workline.selection.title}</span>
                  <small>{workline.dossier ? "证据档案已保存" : "展开证据档案"}</small>
                </button>
              ))}
            </section>
          ) : null}
        </aside>
      </div>

      {selectedWorklineId ? (
        <div className="traceink-dossier-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedWorklineId(null);
        }}>
          <section className="traceink-dossier-reader" role="dialog" aria-modal="true" aria-label={selected?.selection.title ?? "工作线证据档案"}>
            <header>
              <div><span className="traceink-index-kicker">SELECTED WORKLINE / EVIDENCE DOSSIER</span><h2>{selected?.selection.title ?? "正在展开工作线"}</h2></div>
              <button type="button" onClick={() => setSelectedWorklineId(null)}>关闭</button>
            </header>
            {dossierLoading ? <div className="traceink-dossier-loading" role="status">正在沿证据链重建这条工作线…</div> : null}
            {!dossierLoading && selected?.dossier ? (
              <>
                <article className="traceink-index-document traceink-dossier-document">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={MARKDOWN_COMPONENTS} urlTransform={preserveInertDestination}>
                    {selected.dossier.rawMarkdown}
                  </ReactMarkdown>
                </article>
                <section className="traceink-reflection-editor">
                  <div><span className="traceink-margin-label">你的回顾</span><h3>读完以后，你怎么理解这件事？</h3><p>这里保持空白。AI 不替你写第一人称结论。</p></div>
                  <textarea value={reflectionText} onChange={(event) => setReflectionText(event.target.value)} placeholder="写下你的理解、保留意见或下一步判断…" />
                  <div className="traceink-reflection-actions">
                    {selected.reflection ? <small>已保存版本 {selected.reflection.revision}</small> : <small>尚未保存</small>}
                    <button type="button" disabled={!reflectionText.trim() || reflectionSaving} onClick={() => void saveReflection()}>{reflectionSaving ? "正在保存…" : "保存我的回顾"}</button>
                  </div>
                </section>
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}

function InertReference({ destination, children }: { destination?: string | undefined; children: ReactNode }): ReactElement {
  return (
    <span className="traceink-markdown-link" data-traceink-inert-link="true">
      <span>{children}</span>
      {destination ? <code>({destination})</code> : null}
    </span>
  );
}

function TraceinkRawState({
  headingId,
  evidenceCount,
  diagnostic,
  preparation,
  error,
  preparing,
  onCompile
}: {
  headingId: string;
  evidenceCount: number;
  diagnostic?: string | undefined;
  preparation: DailyReviewPreparationState;
  error?: string | null | undefined;
  preparing: boolean;
  onCompile(): void;
}): ReactElement {
  const hasEvidence = evidenceCount > 0;
  return (
    <section className="traceink-index-view is-raw" aria-labelledby={headingId}>
      <header className="traceink-index-head traceink-index-head-raw">
        <div className="traceink-index-title">
          <span className="traceink-index-kicker">TRACEINK / LOCAL EVIDENCE</span>
          <h1 id={headingId}>今日工作脉络</h1>
          <p>整理只在你明确启动或预定时间发生；原始 Session 始终保留。</p>
        </div>
      </header>
      <div className="traceink-index-empty">
        <span className="traceink-empty-rule" aria-hidden="true" />
        <div>
          <div role={error ? "alert" : "status"}>
            <span className="traceink-margin-label">{error ? "整理未完成" : hasEvidence ? "等待整理" : "暂无材料"}</span>
            <h2>{error ? "工作脉络尚未生成" : hasEvidence ? "工作现场仍是独立 Session" : "今天还没有可整理的 Session 证据"}</h2>
            <p>
              {error
                ? error
                : hasEvidence
                  ? `已发现 ${evidenceCount} 条证据。整理后会在这里呈现一份不经二次改写的完整工作脉络。`
                  : "开始工作后，Agent 与你的参与记录会先以原始时间线出现。"}
            </p>
            {diagnostic && diagnostic !== error ? <small>{diagnostic}</small> : null}
            {preparation.status === "scheduled" && preparation.scheduledFor ? (
              <small>已安排在 {formatDateTime(preparation.scheduledFor)} 自动整理</small>
            ) : null}
          </div>
          <button type="button" disabled={!hasEvidence || preparing} onClick={onCompile}>
            {error ? "重新整理" : "整理工作脉络"}
          </button>
        </div>
      </div>
    </section>
  );
}

function TraceinkIndexSkeleton({ headingId }: { headingId: string }): ReactElement {
  return (
    <section className="traceink-index-view is-loading" aria-labelledby={headingId} aria-busy="true">
      <header className="traceink-index-head">
        <div className="traceink-index-title">
          <span className="traceink-index-kicker">TRACEINK / PREPARING</span>
          <h1 id={headingId}>正在整理工作脉络</h1>
          <p>正在读取冻结的 Session 证据；原始记录不会被修改。</p>
        </div>
      </header>
      <div className="traceink-index-skeleton" aria-hidden="true">
        <main>
          <i className="traceink-skeleton-title" />
          <i />
          <i />
          <i className="traceink-skeleton-short" />
          <i className="traceink-skeleton-heading" />
          <i />
          <i className="traceink-skeleton-short" />
        </main>
        <aside><i /><i /><i /></aside>
      </div>
      <span className="sr-only" role="status">正在整理工作脉络</span>
    </section>
  );
}

function producerLabel(provider: "codex" | "claude"): string {
  return provider === "codex" ? "Codex" : "Claude Code";
}

/** Destinations stay visible as evidence text but never reach an active URL-bearing element. */
function preserveInertDestination(url: string): string {
  return url;
}

function uniqueMessages(messages: string[]): string[] {
  return [...new Set(messages.map((message) => message.trim()).filter(Boolean))];
}

function formatDateTime(value: string, timeZone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      ...(timeZone ? { timeZone } : {})
    }).format(date);
  } catch {
    return value;
  }
}
