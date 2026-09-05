import { AlertTriangle, Bot, Check, ChevronRight, Clock3, Database, FileSearch, Info, Pencil, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import type { StructuredTodayReviewProjection } from "../../src/structured-today-review-state";
import type { StructuredTodayWorklineReviewState } from "../../src/structured-today-review-state";
import type { TodaySessionRefV1, TodayWorklineDossierV1, TodayWorklineV1 } from "../../src/structured-today-contracts";
import type { AgentWorkSession } from "../../src/types";
import type {
  StructuredTodayProgressState,
  DailyContinuationBookmark
} from "./api";
import {
  createStructuredTodayCitationTargets,
  EvidenceCitationList,
  InlineCitationText,
  type StructuredTodayCitationTarget,
  type StructuredTodayEvidenceTarget
} from "./structured-today-citations";

export type { StructuredTodayEvidenceTarget } from "./structured-today-citations";

interface StructuredTodayMemberSession {
  ref: TodaySessionRefV1;
  current: AgentWorkSession | undefined;
}

export function groupSessionFamilies(
  members: StructuredTodayMemberSession[],
  currentSessions: AgentWorkSession[]
): Array<{ id: string; title: string; members: StructuredTodayMemberSession[]; subagentCount: number }> {
  const currentById = new Map(currentSessions.map((session) => [session.id, session]));
  const groups = new Map<string, StructuredTodayMemberSession[]>();
  for (const member of members) {
    const lineage = member.current?.lineage ?? member.ref.lineage;
    let rootId = member.ref.sessionId;
    let parentId = lineage?.parentSessionId;
    const seen = new Set([rootId]);
    while (parentId && !seen.has(parentId)) {
      rootId = parentId;
      seen.add(parentId);
      parentId = currentById.get(parentId)?.lineage?.parentSessionId;
    }
    const group = groups.get(rootId) ?? [];
    group.push(member);
    groups.set(rootId, group);
  }
  for (const current of currentSessions) {
    if (current.lineage?.origin !== "subagent" || (current.platform !== "codex" && current.platform !== "claude")) continue;
    let rootId = current.lineage.parentSessionId;
    const seen = new Set([current.id]);
    while (rootId && !seen.has(rootId)) {
      seen.add(rootId);
      const parent = currentById.get(rootId);
      if (!parent || parent.lineage?.origin !== "subagent") break;
      rootId = parent.lineage.parentSessionId;
    }
    const group = rootId ? groups.get(rootId) : undefined;
    if (!group || group.some((member) => member.ref.sessionId === current.id)) continue;
    group.push({
      current,
      ref: {
        sessionId: current.id,
        provider: current.platform,
        sourcePath: current.transcriptCapture?.canonicalPath ?? current.path,
        title: current.title,
        startedAt: current.startedAt ?? current.updatedAt,
        endedAt: current.updatedAt,
        evidenceIds: [],
        lineage: current.lineage
      }
    });
  }
  return [...groups.entries()].map(([id, familyMembers]) => {
    const root = currentById.get(id);
    const primary = familyMembers.find((member) => (member.current?.lineage ?? member.ref.lineage)?.origin === "primary");
    return {
      id,
      title: root?.title ?? primary?.current?.title ?? primary?.ref.title ?? familyMembers[0]?.ref.title ?? id,
      members: familyMembers,
      subagentCount: familyMembers.filter((member) => (member.current?.lineage ?? member.ref.lineage)?.origin === "subagent").length
    };
  });
}

export function referencedEvidenceIds(
  workline: TodayWorklineV1,
  targets: StructuredTodayCitationTarget[]
): string[] {
  const aliases = new Set<string>();
  const text = [
    workline.summary,
    workline.currentStop,
    workline.possibleChange,
    participationLabel(workline)
  ].join("\n");
  for (const match of text.matchAll(/\[(E?\d+)\]/g)) aliases.add(match[1]!);
  return targets
    .filter((target) => target.aliases.some((alias) => aliases.has(alias)))
    .map((target) => target.evidenceId);
}

export function StructuredTodayIndexView({
  projection,
  progress,
  sessions,
  bookmarkCandidates,
  error,
  onEvidence
}: {
  projection: StructuredTodayReviewProjection;
  progress: StructuredTodayProgressState;
  sessions: AgentWorkSession[];
  bookmarkCandidates: DailyContinuationBookmark[];
  error?: string | null;
  onEvidence(target: StructuredTodayEvidenceTarget, returnFocus: HTMLElement): void;
}): ReactElement {
  const [selectedWorklineId, setSelectedWorklineId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sealBusy, setSealBusy] = useState(false);
  const [bookmarkIds, setBookmarkIds] = useState<string[]>([]);
  const [expandedFamilyIds, setExpandedFamilyIds] = useState<Set<string>>(() => new Set());
  const active = projection.activeIndex!;
  const sessionByTuple = useMemo(() => new Map(sessions.map((session) => [
    tuple(session.platform, session.id, session.transcriptCapture?.canonicalPath ?? session.path),
    session
  ])), [sessions]);

  useEffect(() => {
    setSelectedWorklineId(null);
    setActionError(null);
    setBookmarkIds([]);
    setExpandedFamilyIds(new Set());
  }, [active.artifactId, active.revision, active.contentHash]);

  async function requestDossier(workline: TodayWorklineV1): Promise<void> {
    setSelectedWorklineId(workline.worklineId);
    setActionError(null);
    if (projection.worklines.find((item) => item.workline.worklineId === workline.worklineId)?.dossier) return;
    try {
      await window.agentWhiteboard.prepareStructuredTodayDossier(
        active.logicalDate,
        {
          artifactId: active.artifactId,
          revision: active.revision,
          contentHash: active.contentHash
        },
        workline.worklineId
      );
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "证据档案没有开始准备。");
    }
  }

  async function sealPage(): Promise<void> {
    setSealBusy(true);
    setActionError(null);
    try {
      await window.agentWhiteboard.sealStructuredTodayPage(active.logicalDate, {
        index: { artifactId: active.artifactId, revision: active.revision, contentHash: active.contentHash },
        bookmarkIds
      });
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "结构化 Today 没有完成封页。");
    } finally {
      setSealBusy(false);
    }
  }

  const closeoutReady = projection.worklines.every((item) =>
    !item.reflection || Boolean(
      item.proposals &&
      item.proposalItems.length === item.proposals.proposals.length &&
      item.proposalItems.every((proposal) => proposal.latestDisposition)
    )
  );

  return (
    <section className="structured-today-index" aria-label="结构化工作脉络">
      <header className="structured-today-index-head">
        <div>
          <span>STRUCTURED REVIEW / V1</span>
          <h2>今日工作脉络</h2>
          <p>工作线、Session 归属和证据引用来自结构化资产；展开 Session 不会调用模型。</p>
        </div>
        <dl>
          <div><dt>版本</dt><dd>{active.revision}</dd></div>
          <div><dt>工作线</dt><dd>{active.worklines.length}</dd></div>
          <div><dt>覆盖</dt><dd>{active.coverage.assigned}/{active.coverage.admitted}</dd></div>
        </dl>
      </header>

      {actionError || error ? <div className="structured-today-alert" role="alert"><AlertTriangle size={16} />{actionError ?? error}</div> : null}

      <div className="structured-today-worklines">
        {projection.worklines.map(({ workline, dossier }) => {
          const dossierProgress = progress.dossierByWorklineId[workline.worklineId];
          const worklineCitationTargets = createStructuredTodayCitationTargets(active, workline.evidenceIds, "E");
          const citedEvidenceIds = referencedEvidenceIds(workline, worklineCitationTargets);
          const memberSessions = workline.sessionIds.flatMap((sessionId) => {
            const ref = active.sessions.find((session) => session.sessionId === sessionId);
            if (!ref) return [];
            return [{ ref, current: sessionByTuple.get(tuple(ref.provider, ref.sessionId, ref.sourcePath)) }];
          });
          const sessionFamilies = groupSessionFamilies(memberSessions, sessions);
          return (
            <article key={workline.worklineId} className="structured-today-workline">
              <details>
                <summary>
                  <span><strong>{workline.title}</strong><small>{timeRange(workline)} · {sessionFamilies.length} 个会话家族 · {sessionFamilies.reduce((total, family) => total + family.members.length, 0)} 条执行记录</small></span>
                  <em data-readiness={workline.evidenceReadiness}>{readinessLabel(workline.evidenceReadiness)}</em>
                </summary>
                <div className="structured-today-workline-body">
                  <p><InlineCitationText text={workline.summary} targets={worklineCitationTargets} onOpen={onEvidence} /></p>
                  {citedEvidenceIds.length ? (
                    <div className="structured-today-workline-citations">
                      <span>引用来源</span>
                      <EvidenceCitationList evidenceIds={citedEvidenceIds} targets={worklineCitationTargets} onOpen={onEvidence} />
                    </div>
                  ) : null}
                  <dl>
                    <div><dt>当前停点</dt><dd><InlineCitationText text={workline.currentStop} targets={worklineCitationTargets} onOpen={onEvidence} /></dd></div>
                    <div><dt>可能变化 · AI 整理</dt><dd><InlineCitationText text={workline.possibleChange} targets={worklineCitationTargets} onOpen={onEvidence} /></dd></div>
                    <div><dt>参与</dt><dd><InlineCitationText text={participationLabel(workline)} targets={worklineCitationTargets} onOpen={onEvidence} /></dd></div>
                  </dl>
                  <div className="structured-today-session-families" aria-label={`${workline.title} 的会话家族`}>
                    {sessionFamilies.map((family) => (
                      <section key={family.id} className="structured-today-session-family">
                        <button
                          type="button"
                          className="structured-today-session-family-toggle"
                          aria-expanded={family.members.length === 1 || expandedFamilyIds.has(family.id)}
                          onClick={() => setExpandedFamilyIds((current) => {
                            if (family.members.length === 1) return current;
                            const next = new Set(current);
                            if (next.has(family.id)) next.delete(family.id);
                            else next.add(family.id);
                            return next;
                          })}
                        >
                          <span><strong>{family.title}</strong><small>{family.members.length} 条执行记录{family.subagentCount ? ` · ${family.subagentCount} 个子 Agent` : ""}</small></span>
                          <ChevronRight size={14} aria-hidden="true" />
                        </button>
                        {family.members.length === 1 || expandedFamilyIds.has(family.id) ? <div className="structured-today-session-members" role="list">
                          {family.members.map(({ ref, current }) => {
                            const evidence = active.evidence.find((item) =>
                              item.sourceKind === "session" &&
                              item.provider === ref.provider &&
                              item.sessionId === ref.sessionId &&
                              item.sourcePath === ref.sourcePath
                            );
                            return (
                              <button
                                type="button"
                                role="listitem"
                                key={`${ref.provider}:${ref.sessionId}:${ref.sourcePath}`}
                                disabled={!evidence}
                                onClick={(event) => {
                                  if (!evidence) return;
                                  onEvidence({
                                    title: current?.title ?? ref.title,
                                    platform: ref.provider,
                                    request: {
                                      id: ref.sessionId,
                                      platform: ref.provider,
                                      path: ref.sourcePath,
                                      structuredTodayRef: {
                                        artifactId: active.artifactId,
                                        revision: active.revision,
                                        contentHash: active.contentHash,
                                        logicalDate: active.logicalDate,
                                        evidenceId: evidence.evidenceId
                                      }
                                    }
                                  }, event.currentTarget);
                                }}
                              >
                                <span>{ref.provider === "codex" ? <Bot size={14} /> : <UserRound size={14} />}{ref.title}</span>
                                <small>{current?.lineage?.origin === "subagent" ? `${current.lineage.agentPath ?? "子 Agent"} · ` : ""}{ref.provider} · {ref.sessionId}{current ? "" : " · 冻结版本"}</small>
                                <ChevronRight size={14} />
                              </button>
                            );
                          })}
                        </div> : null}
                      </section>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="structured-today-dossier-action"
                    disabled={dossierProgress?.status === "running" || dossierProgress?.status === "queued"}
                    onClick={() => void requestDossier(workline)}
                  >
                    <FileSearch size={15} />
                    {dossier
                      ? "打开深入分析"
                      : dossierProgress?.status === "running" || dossierProgress?.status === "queued"
                        ? `正在深入分析 · ${dossierProgress.stage}`
                        : dossierProgress?.status === "failed"
                          ? "重新深入分析"
                          : "深入分析这条工作线"}
                  </button>
                  {dossierProgress?.status === "failed" && dossierProgress.message
                    ? <small className="structured-today-dossier-error">{dossierProgress.message}</small>
                    : null}
                </div>
                {selectedWorklineId === workline.worklineId && dossier ? (
                  <section className="structured-today-review-workspace" aria-label={`${workline.title} 的深入分析与个人回顾`}>
                    <StructuredDossier dossier={dossier} index={active} onEvidence={onEvidence} />
                    <StructuredCloseoutWorkspace
                      review={projection.worklines.find((item) => item.workline.worklineId === workline.worklineId)!}
                      index={active}
                      progress={progress.proposalByWorklineId?.[workline.worklineId]}
                    />
                  </section>
                ) : null}
              </details>
            </article>
          );
        })}
      </div>

      {active.dispositions.some((item) => item.kind !== "assigned") ? (
        <details className="structured-today-coverage">
          <summary>未进入工作线的 Session</summary>
          <ul>{active.dispositions.filter((item) => item.kind !== "assigned").map((item) => (
            <li key={item.sessionId}><strong>{item.sessionId}</strong><span>{item.kind} · {item.reason}</span></li>
          ))}</ul>
        </details>
      ) : null}
      <section className="structured-today-seal" aria-label="结构化今日收口">
        <header><span>END OF DAY</span><h3>今天到这里</h3><p>封页会固定当前结构化 index、实际查看的 dossier、你的原文、提案和明确选择。</p></header>
        {bookmarkCandidates.length ? (
          <div className="structured-today-bookmarks" aria-label="明天从哪里继续">
            {bookmarkCandidates.map((bookmark) => (
              <button
                type="button"
                key={bookmark.id}
                aria-pressed={bookmarkIds.includes(bookmark.id)}
                onClick={() => setBookmarkIds((current) => current.includes(bookmark.id)
                  ? current.filter((id) => id !== bookmark.id)
                  : current.length < 3 ? [...current, bookmark.id] : current)}
              >{bookmark.title}</button>
            ))}
          </div>
        ) : null}
        <button type="button" disabled={sealBusy || !closeoutReady} onClick={() => void sealPage()}>
          {sealBusy ? "正在封页…" : closeoutReady ? "收笔并封存" : "还有提案尚未处理"}
        </button>
      </section>
    </section>
  );
}

function StructuredCloseoutWorkspace({
  review,
  index,
  progress
}: {
  review: StructuredTodayWorklineReviewState;
  index: StructuredTodayReviewProjection["activeIndex"] & {};
  progress?: StructuredTodayProgressState["index"];
}): ReactElement {
  const [reflectionText, setReflectionText] = useState(review.reflection?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [rewriteId, setRewriteId] = useState<string | null>(null);
  const [rewriteText, setRewriteText] = useState("");
  const reflectionUnchanged = review.reflection?.text === reflectionText;

  useEffect(() => {
    setReflectionText(review.reflection?.text ?? "");
  }, [review.reflection?.contentHash]);

  async function saveReflection(): Promise<void> {
    if (!reflectionText.trim()) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      await window.agentWhiteboard.saveStructuredTodayReflection(
        index.logicalDate,
        { artifactId: index.artifactId, revision: index.revision, contentHash: index.contentHash },
        review.workline.worklineId,
        reflectionText
      );
      setFeedback("你的原文已保存在 Agent Notebook 本地数据中，并绑定当前深入分析；没有写入 Wiki、CTX 或项目文件。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "你的回顾没有保存成功。");
    } finally {
      setBusy(false);
    }
  }

  async function arrangeProposals(): Promise<void> {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      await window.agentWhiteboard.prepareStructuredTodayProposals(
        index.logicalDate,
        { artifactId: index.artifactId, revision: index.revision, contentHash: index.contentHash },
        review.workline.worklineId
      );
      setFeedback("AI 已把你的原文整理成五类待选提案；目前没有执行、发送或写入任何外部位置。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "五类回顾提案没有开始准备。");
    } finally {
      setBusy(false);
    }
  }

  async function dispose(
    proposalId: string,
    action: "accept" | "dismiss" | "defer" | "rewrite"
  ): Promise<void> {
    if (!review.proposals) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      await window.agentWhiteboard.disposeStructuredTodayProposal(
        index.logicalDate,
        {
          artifactId: review.proposals.artifactId,
          revision: review.proposals.revision,
          contentHash: review.proposals.contentHash
        },
        proposalId,
        { action, ...(action === "rewrite" ? { rewriteText } : {}) }
      );
      setFeedback(dispositionFeedback(action));
      setRewriteId(null);
      setRewriteText("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "这项选择没有保存成功。");
    } finally {
      setBusy(false);
    }
  }

  const dispositionByProposal = new Map(
    review.proposalItems.flatMap((item) => item.latestDisposition
      ? [[item.proposal.proposalId, item.latestDisposition] as const]
      : [])
  );
  return (
    <section className="structured-today-closeout" aria-label="结构化个人回顾与提案">
      <header><span>YOUR REFLECTION</span><h3>先写下你自己的理解</h3><p>这里始终从空白开始；AI 只能在保存之后整理你的原话。</p></header>
      <div className="structured-today-reflection-destination">
        <Database size={17} aria-hidden="true" />
        <p><strong>保存在本地，绑定当前工作线</strong><span>原文会成为 Agent Notebook 的独立用户资产；不会自动写入 Wiki、CTX、项目文件或 Codex 报告。</span></p>
        <em>LOCAL ONLY</em>
      </div>
      <textarea
        value={reflectionText}
        onChange={(event) => setReflectionText(event.target.value)}
        placeholder="写下你的理解、保留意见或下一步判断…"
      />
      <div className="structured-today-closeout-actions">
        <small>{review.reflection ? `已保存版本 ${review.reflection.revision}` : "尚未保存"}</small>
        <button type="button" disabled={busy || !reflectionText.trim() || reflectionUnchanged} onClick={() => void saveReflection()}>
          {reflectionUnchanged ? "回顾已保存" : "保存我的回顾"}
        </button>
      </div>
      {feedback ? <div className="structured-today-action-feedback" role="status"><Check size={15} aria-hidden="true" />{feedback}</div> : null}
      {review.reflection && !review.proposals ? (
        <div className="structured-today-arrange">
          <p>保存后的原文不会被改写；整理只会生成五类待选提案。</p>
          <button type="button" disabled={busy || progress?.status === "running" || progress?.status === "queued"} onClick={() => void arrangeProposals()}>
            {progress?.status === "running" || progress?.status === "queued" ? "正在整理我的文字…" : "整理我的文字"}
          </button>
        </div>
      ) : null}
      {error || progress?.status === "failed" ? <div className="structured-today-alert" role="alert">{error ?? progress?.message}</div> : null}
      {review.proposals ? (
        <>
          <section className="structured-today-proposal-impact" aria-label="提案选择的实际影响">
            <header><Info size={17} aria-hidden="true" /><p><strong>这些按钮现在只记录你的选择</strong><span>接受不会生成报告，延后不会进入明日清单，CTX 候选不会写入 CTX，后台候选也不会启动 Agent。</span></p></header>
            <dl>
              <div><dt>会改变什么</dt><dd>当前 Today 页会新增一条可追溯的选择记录；改写会另外保存你的新文本。</dd></div>
              <div><dt>不会改变什么</dt><dd>项目文件、Wiki、CTX、明日任务和后台进程都保持不变。</dd></div>
              <div><dt>什么时候才会外送</dt><dd>未来必须提供单独的目的地按钮，并再次由你明确确认。</dd></div>
            </dl>
          </section>
          <div className="structured-today-proposal-groups">
          {PROPOSAL_CATEGORIES.map(({ id, label, description }) => (
            <section key={id} aria-label={label}>
              <header className="structured-today-proposal-group-head"><h4>{label}</h4><p>{description}</p></header>
              {review.proposalItems.filter((item) => item.proposal.category === id).map(({ proposal }) => {
                const disposition = dispositionByProposal.get(proposal.proposalId);
                return (
                  <article key={proposal.proposalId} className="structured-today-proposal-item">
                    <div><p>{proposal.proposalText}</p><blockquote>{proposal.sourceQuote}</blockquote>{disposition ? <small><Check size={12} aria-hidden="true" />已记录：{dispositionOutcome(disposition.action)}</small> : null}</div>
                    {rewriteId === proposal.proposalId ? (
                      <div className="structured-today-proposal-rewrite">
                        <textarea value={rewriteText} onChange={(event) => setRewriteText(event.target.value)} />
                        <button type="button" disabled={busy || !rewriteText.trim()} onClick={() => void dispose(proposal.proposalId, "rewrite")}>保存改写</button>
                        <button type="button" onClick={() => setRewriteId(null)}>取消</button>
                      </div>
                    ) : (
                      <div className="structured-today-proposal-actions">
                        <button type="button" data-action="accept" aria-pressed={disposition?.action === "accept"} disabled={busy} onClick={() => void dispose(proposal.proposalId, "accept")}><Check size={14} />接受</button>
                        <button type="button" data-action="dismiss" aria-pressed={disposition?.action === "dismiss"} disabled={busy} onClick={() => void dispose(proposal.proposalId, "dismiss")}><X size={14} />驳回</button>
                        <button type="button" data-action="defer" aria-pressed={disposition?.action === "defer"} disabled={busy} onClick={() => void dispose(proposal.proposalId, "defer")}><Clock3 size={14} />延后</button>
                        <button type="button" data-action="rewrite" aria-pressed={disposition?.action === "rewrite"} disabled={busy} onClick={() => { setRewriteId(proposal.proposalId); setRewriteText(proposal.proposalText); }}><Pencil size={14} />改写</button>
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

const PROPOSAL_CATEGORIES = [
  { id: "judgment", label: "形成的判断", description: "可作为今日判断记录；接受不等于执行。" },
  { id: "tomorrow", label: "明日候选", description: "可供明天继续考虑；当前不会自动进入明日清单。" },
  { id: "ctx", label: "CTX 候选", description: "可能值得沉淀进项目上下文；当前不会写入 CTX。" },
  { id: "background", label: "后台候选", description: "可能适合交给 Agent；当前不会启动任何后台工作。" },
  { id: "today-only", label: "只留在今天", description: "只作为今天的思考痕迹，不准备外送。" }
] as const;

function dispositionOutcome(action: "accept" | "dismiss" | "defer" | "rewrite"): string {
  return action === "accept"
    ? "接受，仅保存在今日页"
    : action === "dismiss"
      ? "驳回，不再采用"
      : action === "defer"
        ? "延后，但尚未进入明日清单"
        : "改写，保存你的版本";
}

function dispositionFeedback(action: "accept" | "dismiss" | "defer" | "rewrite"): string {
  return action === "accept"
    ? "已记录为接受。它只成为当前 Today 页的选择记录，没有生成报告或改动项目。"
    : action === "dismiss"
      ? "已记录为驳回。原提案仍保留用于追溯，没有删除你的原文。"
      : action === "defer"
        ? "已记录为延后。它尚未进入明日清单，也没有启动提醒或后台任务。"
        : "你的改写已单独保存；没有发送到 Wiki、CTX 或项目文件。";
}

export function StructuredDossier({
  dossier,
  index,
  onEvidence
}: {
  dossier: TodayWorklineDossierV1;
  index?: NonNullable<StructuredTodayReviewProjection["activeIndex"]>;
  onEvidence?(target: StructuredTodayEvidenceTarget, returnFocus: HTMLElement): void;
}): ReactElement {
  const citationTargets = index
    ? createStructuredTodayCitationTargets(index, dossier.evidence.map((item) => item.evidenceId), "")
    : [];
  return (
    <aside className="structured-today-dossier" aria-label="所选工作线的深入分析">
      <header><span>EVIDENCE DOSSIER</span><h3>{dossier.content.title}</h3></header>
      <section><h4>此前判断或起点</h4><p><InlineCitationText text={dossier.content.priorContext} targets={citationTargets} onOpen={onEvidence} /></p></section>
      <section><h4>发生了什么</h4><p><InlineCitationText text={dossier.content.whatHappened} targets={citationTargets} onOpen={onEvidence} /></p></section>
      <section><h4>可能产生的变化 · 尚未采纳</h4><p><InlineCitationText text={dossier.content.possibleChange} targets={citationTargets} onOpen={onEvidence} /></p></section>
      <EvidenceClaims title="支持证据" claims={dossier.content.supportingEvidence} targets={citationTargets} onEvidence={onEvidence} />
      <EvidenceClaims title="反向证据" claims={dossier.content.opposingEvidence} targets={citationTargets} onEvidence={onEvidence} />
      <section><h4>可证伪观察</h4><p><InlineCitationText text={dossier.content.falsifiableObservation} targets={citationTargets} onOpen={onEvidence} /></p></section>
      {dossier.content.gaps.length ? <section><h4>证据缺口</h4><ul>{dossier.content.gaps.map((gap) => <li key={gap}><InlineCitationText text={gap} targets={citationTargets} onOpen={onEvidence} /></li>)}</ul></section> : null}
      <section className="structured-today-human-question"><h4>需要你的判断</h4><p><InlineCitationText text={dossier.content.humanQuestion} targets={citationTargets} onOpen={onEvidence} /></p></section>
      {citationTargets.length ? (
        <footer className="structured-today-citation-scope">
          <FileSearch size={15} aria-hidden="true" />
          <p><strong>引用可直接打开对应会话</strong><span>当前证据精度是完整 Session；后端提供消息级位置后，才会启用段落跳转与高亮。</span></p>
        </footer>
      ) : null}
    </aside>
  );
}

function EvidenceClaims({ title, claims, targets, onEvidence }: {
  title: string;
  claims: TodayWorklineDossierV1["content"]["supportingEvidence"];
  targets: StructuredTodayCitationTarget[];
  onEvidence: ((target: StructuredTodayEvidenceTarget, returnFocus: HTMLElement) => void) | undefined;
}): ReactElement {
  return (
    <section><h4>{title}</h4>{claims.length
      ? <ul className="structured-today-evidence-claims">{claims.map((claim) => (
        <li key={`${claim.claim}:${claim.evidenceIds.join(",")}`}>
          <span><InlineCitationText text={claim.claim} targets={targets} onOpen={onEvidence} /></span>
          <EvidenceCitationList evidenceIds={claim.evidenceIds} targets={targets} onOpen={onEvidence} />
        </li>
      ))}</ul>
      : <p>当前没有可确认的材料。</p>}</section>
  );
}

function participationLabel(workline: TodayWorklineV1): string {
  if (workline.participation.status === "undetermined") return `无法确定：${workline.participation.reason}`;
  return [
    workline.participation.human ? `你参与：${workline.participation.human}` : "",
    workline.participation.agent ? `Agent：${workline.participation.agent}` : "",
    workline.participation.joint ? `共同：${workline.participation.joint}` : ""
  ].filter(Boolean).join(" · ");
}

function timeRange(workline: TodayWorklineV1): string {
  const startDate = new Date(workline.startedAt);
  const endDate = workline.endedAt ? new Date(workline.endedAt) : undefined;
  const time = (value: Date) => value.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (!endDate) return `${time(startDate)}–现在`;
  if (startDate.toLocaleDateString("zh-CN") === endDate.toLocaleDateString("zh-CN")) {
    return `${time(startDate)}–${time(endDate)}`;
  }
  const dateTime = (value: Date) => value.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
  return `${dateTime(startDate)}–${dateTime(endDate)}`;
}

function readinessLabel(value: TodayWorklineV1["evidenceReadiness"]): string {
  return value === "ready" ? "证据可展开" : value === "partial" ? "部分证据" : "证据受阻";
}

function tuple(provider: string, sessionId: string, sourcePath: string): string {
  return `${provider}:${sessionId}:${sourcePath}`;
}
