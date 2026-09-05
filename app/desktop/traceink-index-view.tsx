import { useEffect, useId, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DailyReviewPreparationState } from "../../src/daily-review-schedule";
import type { TraceinkReviewProjection } from "../../src/traceink-review-state";
import type { TraceinkProposalItemReviewState, TraceinkWorklineReviewState } from "../../src/traceink-review-state";
import type { TraceinkProposalDispositionActionV1 } from "../../src/traceink-review-assets";
import type { TraceinkArtifactV1, TraceinkEvidenceRefV1 } from "../../src/traceink-review-assets";
import type { AgentPlatform } from "../../src/types";
import type { SessionTranscriptRequest } from "./api";

export interface TraceinkIndexViewProps {
  projection: TraceinkReviewProjection;
  preparation: DailyReviewPreparationState;
  error?: string | null | undefined;
  onCompile(): void | Promise<void>;
  onRefresh(): void | Promise<void>;
  onEvidence?(target: TraceinkEvidenceTarget, returnFocus: HTMLElement): void;
}

export interface TraceinkEvidenceTarget {
  title: string;
  platform: AgentPlatform;
  request: SessionTranscriptRequest;
}

type TraceinkRequestMode = "compile" | "refresh";

const INERT_MARKDOWN_COMPONENTS: Components = {
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
 * The document is rendered once in source order. Only exact frozen Session
 * references gain an action; every other generated link remains inert.
 */
export function TraceinkIndexView({
  projection,
  preparation,
  error,
  onCompile,
  onRefresh,
  onEvidence
}: TraceinkIndexViewProps): ReactElement {
  const headingId = useId();
  const [requestedMode, setRequestedMode] = useState<TraceinkRequestMode | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedWorklineId, setSelectedWorklineId] = useState<string | null>(null);
  const [dossierOverride, setDossierOverride] = useState<TraceinkWorklineReviewState | null>(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [reflectionText, setReflectionText] = useState("");
  const [reflectionSaving, setReflectionSaving] = useState(false);
  const [proposalPreparing, setProposalPreparing] = useState(false);
  const [disposingProposalId, setDisposingProposalId] = useState<string | null>(null);
  const [rewritingProposalId, setRewritingProposalId] = useState<string | null>(null);
  const [rewriteText, setRewriteText] = useState("");
  const activeIndex = projection.activeIndex;
  const activeIndexIdentity = activeIndex
    ? `${activeIndex.id}:${activeIndex.revision}:${activeIndex.outputHash}`
    : "none";
  const worklines = projection.worklines ?? [];
  const preparing = preparation.status === "preparing" || requestedMode !== null;
  const displayedError = actionError ?? error ?? (preparation.status === "failed" ? preparation.message : undefined);
  const selected = dossierOverride?.selection.worklineId === selectedWorklineId
    ? dossierOverride
    : worklines.find((item) => item.selection.worklineId === selectedWorklineId);

  useEffect(() => {
    if (selected?.reflection) setReflectionText(selected.reflection.text);
  }, [selected?.reflection?.contentHash]);

  useEffect(() => {
    setSelectedWorklineId(null);
    setDossierOverride(null);
    setDossierLoading(false);
    setReflectionText("");
    setReflectionSaving(false);
    setProposalPreparing(false);
    setDisposingProposalId(null);
    setRewritingProposalId(null);
    setRewriteText("");
  }, [activeIndexIdentity]);

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

  async function prepareProposals(): Promise<void> {
    if (!selected?.reflection) return;
    setProposalPreparing(true);
    setActionError(null);
    try {
      const state = await window.agentWhiteboard.prepareTraceinkProposals(
        selected.reflection.logicalDate,
        {
          reflectionId: selected.reflection.id,
          revision: selected.reflection.revision,
          contentHash: selected.reflection.contentHash
        }
      );
      const next = state.traceinkReview.worklines?.find((item) => item.selection.worklineId === selected.selection.worklineId);
      if (!next?.proposals) throw new Error("五类回顾提案没有完成。");
      setDossierOverride(next);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "五类回顾提案没有完成。");
    } finally {
      setProposalPreparing(false);
    }
  }

  async function disposeProposal(
    proposal: TraceinkProposalItemReviewState,
    action: TraceinkProposalDispositionActionV1,
    rewritten?: string
  ): Promise<void> {
    if (!selected?.proposals) return;
    setDisposingProposalId(proposal.proposalId);
    setActionError(null);
    try {
      const state = await window.agentWhiteboard.disposeTraceinkProposal(
        selected.proposals.logicalDate,
        {
          artifactId: selected.proposals.id,
          stage: "proposals",
          revision: selected.proposals.revision,
          outputHash: selected.proposals.outputHash
        },
        proposal.proposalId,
        { action, ...(action === "rewrite" && rewritten ? { rewriteText: rewritten } : {}) }
      );
      const next = state.traceinkReview.worklines?.find((item) => item.selection.worklineId === selected.selection.worklineId);
      if (next) setDossierOverride(next);
      setRewritingProposalId(null);
      setRewriteText("");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "这项选择没有保存成功。");
    } finally {
      setDisposingProposalId(null);
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
  const indexMarkdown = evidenceMarkdownPresentation(activeIndex, onEvidence);

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
            components={indexMarkdown.components}
            urlTransform={preserveInertDestination}
          >
            {indexMarkdown.markdown}
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
            {actionError ? <div className="traceink-dossier-error" role="alert"><strong>这一步没有完成</strong><span>{actionError}</span></div> : null}
            {dossierLoading ? <div className="traceink-dossier-loading" role="status">正在沿证据链重建这条工作线…</div> : null}
            {!dossierLoading && selected?.dossier ? (
              <>
                <article className="traceink-index-document traceink-dossier-document">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={evidenceMarkdownPresentation(selected.dossier, onEvidence).components} urlTransform={preserveInertDestination}>
                    {evidenceMarkdownPresentation(selected.dossier, onEvidence).markdown}
                  </ReactMarkdown>
                </article>
                <TraceinkEvidenceRegister artifact={selected.dossier} preferredEvidenceIds={selected.presentation?.evidenceIds ?? []} onEvidence={onEvidence} />
                <section className="traceink-reflection-editor">
                  <div><span className="traceink-margin-label">你的回顾</span><h3>读完以后，你怎么理解这件事？</h3><p>这里保持空白。AI 不替你写第一人称结论。</p></div>
                  <textarea value={reflectionText} onChange={(event) => setReflectionText(event.target.value)} placeholder="写下你的理解、保留意见或下一步判断…" />
                  <div className="traceink-reflection-actions">
                    {selected.reflection ? <small>已保存版本 {selected.reflection.revision}</small> : <small>尚未保存</small>}
                    <button type="button" disabled={!reflectionText.trim() || reflectionSaving} onClick={() => void saveReflection()}>{reflectionSaving ? "正在保存…" : "保存我的回顾"}</button>
                  </div>
                </section>
                {selected.reflection ? (
                  <TraceinkProposalWorkspace
                    workline={selected}
                    preparing={proposalPreparing}
                    disposingProposalId={disposingProposalId}
                    rewritingProposalId={rewritingProposalId}
                    rewriteText={rewriteText}
                    onPrepare={() => void prepareProposals()}
                    onDisposition={(proposal, action) => void disposeProposal(proposal, action)}
                    onStartRewrite={(proposal) => {
                      setRewritingProposalId(proposal.proposalId);
                      setRewriteText(proposal.latestDisposition?.rewriteText ?? proposal.proposalText);
                    }}
                    onRewriteText={setRewriteText}
                    onCommitRewrite={(proposal) => void disposeProposal(proposal, "rewrite", rewriteText)}
                    onCancelRewrite={() => { setRewritingProposalId(null); setRewriteText(""); }}
                  />
                ) : null}
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}

function TraceinkProposalWorkspace({
  workline,
  preparing,
  disposingProposalId,
  rewritingProposalId,
  rewriteText,
  onPrepare,
  onDisposition,
  onStartRewrite,
  onRewriteText,
  onCommitRewrite,
  onCancelRewrite
}: {
  workline: TraceinkWorklineReviewState;
  preparing: boolean;
  disposingProposalId: string | null;
  rewritingProposalId: string | null;
  rewriteText: string;
  onPrepare(): void;
  onDisposition(proposal: TraceinkProposalItemReviewState, action: Exclude<TraceinkProposalDispositionActionV1, "rewrite">): void;
  onStartRewrite(proposal: TraceinkProposalItemReviewState): void;
  onRewriteText(value: string): void;
  onCommitRewrite(proposal: TraceinkProposalItemReviewState): void;
  onCancelRewrite(): void;
}): ReactElement {
  if (!workline.proposals) {
    return (
      <section className="traceink-proposal-workspace is-empty">
        <div>
          <span className="traceink-margin-label">AI 整理 · 尚未采纳</span>
          <h3>把你的原文排成五类提案</h3>
          <p>只整理，不写入明天、CTX 或后台，也不会封页。每一项仍由你单独决定。</p>
        </div>
        <button type="button" disabled={preparing} onClick={onPrepare}>{preparing ? "正在整理…" : "整理我的文字"}</button>
      </section>
    );
  }

  const categoryOrder = ["judgment", "tomorrow", "ctx", "background", "today-only"] as const;
  return (
    <section className="traceink-proposal-workspace">
      <header>
        <div><span className="traceink-margin-label">PROPOSALS / USER CONTROL</span><h3>五类提案</h3></div>
        <p>接受只记录你的选择，不会自动执行迁移、后台工作或封页。</p>
      </header>
      <details className="traceink-proposal-source">
        <summary>查看 Traceink 原始整理文本</summary>
        <article className="traceink-index-document">
          <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={evidenceMarkdownPresentation(workline.proposals, undefined).components} urlTransform={preserveInertDestination}>
            {workline.proposals.rawMarkdown}
          </ReactMarkdown>
        </article>
      </details>
      <div className="traceink-proposal-groups">
        {categoryOrder.map((category) => {
          const items = workline.proposalItems.filter((item) => item.category === category);
          return (
            <section key={category} aria-label={proposalCategoryLabel(category)}>
              <h4>{proposalCategoryLabel(category)}</h4>
              {items.map((proposal) => {
                const busy = disposingProposalId === proposal.proposalId;
                const rewriting = rewritingProposalId === proposal.proposalId;
                return (
                  <article key={proposal.proposalId} className="traceink-proposal-item">
                    <div className="traceink-proposal-copy">
                      <span>{proposal.proposalId}</span>
                      <p>{proposal.proposalText}</p>
                      <blockquote>原文：{proposal.sourceQuote}</blockquote>
                      {proposal.latestDisposition ? <small>当前选择：{proposalDispositionLabel(proposal.latestDisposition.action)}{proposal.latestDisposition.rewriteText ? ` · ${proposal.latestDisposition.rewriteText}` : ""}</small> : <small>待你处理</small>}
                    </div>
                    {rewriting ? (
                      <div className="traceink-proposal-rewrite">
                        <textarea value={rewriteText} onChange={(event) => onRewriteText(event.target.value)} aria-label={`改写 ${proposal.proposalId}`} />
                        <div><button type="button" onClick={onCancelRewrite}>取消</button><button type="button" disabled={!rewriteText.trim() || busy} onClick={() => onCommitRewrite(proposal)}>保存改写</button></div>
                      </div>
                    ) : (
                      <div className="traceink-proposal-actions" aria-label={`${proposal.proposalId} 处置`}>
                        <button type="button" disabled={busy} onClick={() => onDisposition(proposal, "accept")}>接受</button>
                        <button type="button" disabled={busy} onClick={() => onDisposition(proposal, "dismiss")}>驳回</button>
                        <button type="button" disabled={busy} onClick={() => onDisposition(proposal, "defer")}>延后</button>
                        <button type="button" disabled={busy} onClick={() => onStartRewrite(proposal)}>改写</button>
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function TraceinkEvidenceRegister({ artifact, preferredEvidenceIds, onEvidence }: {
  artifact: TraceinkArtifactV1;
  preferredEvidenceIds: string[];
  onEvidence?: ((target: TraceinkEvidenceTarget, returnFocus: HTMLElement) => void) | undefined;
}): ReactElement | null {
  const preferred = new Set(preferredEvidenceIds);
  const referenced = artifact.evidence.filter((item) =>
    preferred.has(item.id) || artifact.rawMarkdown.includes(item.path) || Boolean(item.sessionId && artifact.rawMarkdown.includes(item.sessionId))
  );
  if (referenced.length === 0) return null;
  return (
    <section className="traceink-evidence-register" aria-label="证据登记">
      <header><span className="traceink-margin-label">EVIDENCE REGISTER</span><h3>证据登记</h3><p>Session 可按冻结版本重开；其他类型只显示当时记录的路径。</p></header>
      <div>
        {referenced.map((item) => item.kind === "session" && item.provider && item.sessionId && onEvidence ? (
          <button key={item.id} type="button" onClick={(event) => openEvidence(item, artifact, onEvidence, event.currentTarget)}>
            <span>{evidenceKindLabel(item)} · 精确冻结</span>
            <strong>{item.sessionId}</strong>
            <small>{item.locator}</small>
          </button>
        ) : (
          <div key={item.id} className="traceink-evidence-path-reference" title="这条材料只保存了当时记录的路径，没有冻结文件正文，因此不能冒充精确证据。">
            <span>{evidenceKindLabel(item)} · 路径引用</span>
            <strong>{item.path.split("/").filter(Boolean).at(-1) ?? item.id}</strong>
            <small>未冻结 · 不直接打开</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function evidenceMarkdownPresentation(
  artifact: TraceinkArtifactV1,
  onEvidence?: ((target: TraceinkEvidenceTarget, returnFocus: HTMLElement) => void) | undefined
): { markdown: string; components: Components } {
  const markerMap = evidenceMarkerMap(artifact.rawMarkdown, artifact.evidence);
  const markdown = artifact.rawMarkdown.replace(/\[(E\d+)\](?!\()/g, (source, marker: string) =>
    markerMap.has(marker) ? `[${marker}](traceink-evidence:${marker})` : source
  );
  return {
    markdown,
    components: {
      ...INERT_MARKDOWN_COMPONENTS,
      a({ children, href }) {
        const marker = href?.match(/^traceink-evidence:(E\d+)$/)?.[1];
        const exactPath = evidencePathFromDestination(href);
        const evidence = marker
          ? markerMap.get(marker)
          : exactPath
            ? artifact.evidence.find((item) => item.path === exactPath)
            : undefined;
        if (!evidence || evidence.kind !== "session" || !onEvidence) {
          return <InertReference destination={href}>{children}</InertReference>;
        }
        return (
          <button type="button" className="traceink-evidence-inline" onClick={(event) => openEvidence(evidence, artifact, onEvidence, event.currentTarget)}>
            {children}
          </button>
        );
      }
    }
  };
}

function evidenceMarkerMap(markdown: string, evidence: TraceinkEvidenceRefV1[]): Map<string, TraceinkEvidenceRefV1> {
  const result = new Map<string, TraceinkEvidenceRefV1>();
  for (const line of markdown.split(/\r?\n/)) {
    const markers = [...line.matchAll(/\[(E\d+)\]/g)].map((match) => match[1]).filter(Boolean) as string[];
    if (markers.length === 0) continue;
    const matches = evidence.filter((item) => line.includes(item.path) || Boolean(item.sessionId && line.includes(item.sessionId)));
    if (matches.length !== 1) continue;
    for (const marker of markers) result.set(marker, matches[0]!);
  }
  return result;
}

function evidencePathFromDestination(destination: string | undefined): string | undefined {
  if (!destination) return undefined;
  if (destination.startsWith("file://")) {
    try { return decodeURIComponent(new URL(destination).pathname); } catch { return undefined; }
  }
  return destination.startsWith("/") ? destination : undefined;
}

function openEvidence(
  evidence: TraceinkEvidenceRefV1,
  artifact: TraceinkArtifactV1,
  onEvidence: ((target: TraceinkEvidenceTarget, returnFocus: HTMLElement) => void) | undefined,
  returnFocus: HTMLElement
): void {
  if (evidence.kind === "session" && evidence.provider && evidence.sessionId && onEvidence) {
    onEvidence({
      title: `${evidence.provider === "codex" ? "Codex" : "Claude Code"} · ${evidence.sessionId}`,
      platform: evidence.provider,
      request: {
        id: evidence.sessionId,
        platform: evidence.provider,
        path: evidence.path,
        traceinkRef: {
          logicalDate: artifact.logicalDate,
          artifactId: artifact.id,
          stage: artifact.stage,
          revision: artifact.revision,
          outputHash: artifact.outputHash,
          evidenceId: evidence.id
        }
      }
    }, returnFocus);
  }
}

function evidenceKindLabel(evidence: TraceinkEvidenceRefV1): string {
  if (evidence.kind === "session") return evidence.provider === "claude" ? "CLAUDE CODE" : "CODEX";
  return evidence.kind.toUpperCase();
}

function proposalCategoryLabel(category: TraceinkProposalItemReviewState["category"]): string {
  switch (category) {
    case "judgment": return "形成的判断";
    case "tomorrow": return "明日候选";
    case "ctx": return "CTX 候选";
    case "background": return "后台候选";
    case "today-only": return "只留在今天";
  }
}

function proposalDispositionLabel(action: TraceinkProposalDispositionActionV1): string {
  switch (action) {
    case "accept": return "接受";
    case "dismiss": return "驳回";
    case "defer": return "延后";
    case "rewrite": return "改写";
  }
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
