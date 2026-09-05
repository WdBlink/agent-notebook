import { AlertTriangle, FileSearch, FlaskConical, Quote } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";
import type { DesktopState, StructuredTodaySpanRequest } from "./api";
import { StructuredTodaySpanDialog } from "./structured-today-span-dialog";
import type { CitedStatementV1 } from "../../src/structured-today-evidence-spans";
import type { TodayWorklineDossierV2, TodayWorklineIndexV2 } from "../../src/structured-today-v2-contracts";

export function StructuredTodayV2Preview({ state }: { state: DesktopState }): ReactElement | null {
  const candidate = state.structuredTodayV2Candidate;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{
    title: string;
    requests: StructuredTodaySpanRequest[];
    initialIndex: number;
    basisRelation: "source-span" | "inference-basis";
    returnFocus: HTMLElement;
  } | null>(null);
  if (!candidate?.enabled) return null;

  async function generateIndex(): Promise<void> {
    setBusy("index");
    setError(null);
    try {
      await window.agentWhiteboard.prepareStructuredTodayV2Candidate(state.activeDate);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "V2 index candidate 没有生成成功。");
    } finally {
      setBusy(null);
    }
  }

  async function generateDossier(index: TodayWorklineIndexV2, worklineId: string): Promise<void> {
    setBusy(worklineId);
    setError(null);
    try {
      await window.agentWhiteboard.prepareStructuredTodayV2DossierCandidate(
        index.logicalDate,
        { artifactId: index.artifactId, revision: index.revision, contentHash: index.contentHash },
        worklineId
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "V2 dossier candidate 没有生成成功。");
    } finally {
      setBusy(null);
    }
  }

  const index = candidate.index;
  function closeDialog(): void {
    const returnFocus = dialog?.returnFocus;
    setDialog(null);
    if (returnFocus) requestAnimationFrame(() => returnFocus.focus());
  }
  return (
    <section className="structured-v2-preview" aria-label="消息级 evidence span 候选预览">
      <header>
        <div><span>V2 CANDIDATE / UNMERGED</span><h2>消息级证据候选</h2><p>这里只展示未合并候选；不会替换当前 Today、写入 Wiki，或绕过真实 Gate。</p></div>
        <FlaskConical size={22} aria-hidden="true" />
      </header>
      {error ? <div className="structured-today-alert" role="alert"><AlertTriangle size={16} />{error}</div> : null}
      {!index ? (
        <button type="button" className="structured-v2-primary" disabled={Boolean(busy)} onClick={() => void generateIndex()}>
          {busy === "index" ? "正在生成 V2 候选…" : "生成消息级证据候选"}
        </button>
      ) : (
        <div className="structured-v2-worklines">
          <div className="structured-v2-meta"><strong>{candidate.status === "complete" ? "完整候选" : candidate.status === "partial" ? "部分候选" : "失败候选"} · revision {index.revision}</strong><span>{index.coverage.assigned} assigned · {index.coverage.failed} failed · {index.coverage.unresolved} unresolved · {index.messageLocators.length} messages · {index.spans.length} spans</span></div>
          {candidate.issues.length ? <div className="structured-today-alert" role="status"><AlertTriangle size={16} />{candidate.issues.join(" ")} 该候选不可晋升或发布。</div> : null}
          {index.worklines.map((workline) => {
            const dossier = candidate.dossiers.find((item) => item.worklineId === workline.worklineId &&
              item.sourceIndex.contentHash === index.contentHash);
            return (
              <article key={workline.worklineId}>
                <header><div><h3>{workline.title}</h3><p>{workline.summary.text}</p></div><StatementCitations owner={index} statement={workline.summary} onOpen={(requests, initialIndex, basisRelation, returnFocus) => setDialog({ title: workline.title, requests, initialIndex, basisRelation, returnFocus })} /></header>
                <dl>
                  <div><dt>当前停点</dt><dd>{workline.currentStop.text}<StatementCitations owner={index} statement={workline.currentStop} onOpen={(requests, initialIndex, basisRelation, returnFocus) => setDialog({ title: workline.title, requests, initialIndex, basisRelation, returnFocus })} /></dd></div>
                  <div><dt>可能变化</dt><dd>{workline.possibleChange.text}<StatementCitations owner={index} statement={workline.possibleChange} onOpen={(requests, initialIndex, basisRelation, returnFocus) => setDialog({ title: workline.title, requests, initialIndex, basisRelation, returnFocus })} /></dd></div>
                  <div><dt>参与归因</dt><dd>{workline.participation.statement.text}<StatementCitations owner={index} statement={workline.participation.statement} onOpen={(requests, initialIndex, basisRelation, returnFocus) => setDialog({ title: workline.title, requests, initialIndex, basisRelation, returnFocus })} /></dd></div>
                </dl>
                <button type="button" disabled={busy === workline.worklineId || Boolean(dossier)} onClick={() => void generateDossier(index, workline.worklineId)}>
                  <FileSearch size={15} />{dossier ? "深入分析候选已生成" : busy === workline.worklineId ? "正在生成深入分析…" : "生成深入分析候选"}
                </button>
                {dossier ? <DossierPreview dossier={dossier} onOpen={(title, requests, initialIndex, basisRelation, returnFocus) => setDialog({ title, requests, initialIndex, basisRelation, returnFocus })} /> : null}
              </article>
            );
          })}
        </div>
      )}
      {dialog ? <StructuredTodaySpanDialog title={dialog.title} requests={dialog.requests} initialIndex={dialog.initialIndex} basisRelation={dialog.basisRelation} onClose={closeDialog} /> : null}
    </section>
  );
}

function DossierPreview({ dossier, onOpen }: {
  dossier: TodayWorklineDossierV2;
  onOpen(title: string, requests: StructuredTodaySpanRequest[], initialIndex: number, basisRelation: "source-span" | "inference-basis", returnFocus: HTMLElement): void;
}): ReactElement {
  const statements: Array<{ label: string; statement: CitedStatementV1 }> = [
    { label: "此前判断或起点", statement: dossier.content.priorContext },
    { label: "发生了什么", statement: dossier.content.whatHappened },
    { label: "可能变化", statement: dossier.content.possibleChange },
    ...dossier.content.supportingEvidence.map((statement, index) => ({ label: `支持证据 ${index + 1}`, statement })),
    ...dossier.content.opposingEvidence.map((statement, index) => ({ label: `反向证据 ${index + 1}`, statement })),
    { label: "可证伪观察", statement: dossier.content.falsifiableObservation },
    ...dossier.content.gaps.map((statement, index) => ({ label: `信息缺口 ${index + 1}`, statement })),
    { label: "需要你的判断", statement: dossier.content.humanQuestion }
  ];
  return (
    <section className="structured-v2-dossier" aria-label={`${dossier.content.title} 候选深入分析`}>
      <h4>{dossier.content.title}</h4>
      {statements.map(({ label, statement }) => (
        <div key={statement.statementId}><strong>{label}</strong><p>{statement.text}<StatementCitations owner={dossier} statement={statement} onOpen={(requests, initialIndex, basisRelation, returnFocus) => onOpen(dossier.content.title, requests, initialIndex, basisRelation, returnFocus)} /></p></div>
      ))}
    </section>
  );
}

function StatementCitations({ owner, statement, onOpen }: {
  owner: TodayWorklineIndexV2 | TodayWorklineDossierV2;
  statement: CitedStatementV1;
  onOpen(requests: StructuredTodaySpanRequest[], initialIndex: number, basisRelation: "source-span" | "inference-basis", returnFocus: HTMLElement): void;
}): ReactElement | null {
  if (!statement.spanIds.length) return null;
  const kind = owner.schema === "today-workline-index/v2" ? "index-v2-candidate" : "dossier-v2-candidate";
  const requests = statement.spanIds.map((spanId): StructuredTodaySpanRequest => ({
    owner: {
      kind,
      logicalDate: owner.logicalDate,
      artifactId: owner.artifactId,
      revision: owner.revision,
      contentHash: owner.contentHash
    },
    statementId: statement.statementId,
    spanId
  }));
  const basisRelation = statement.relation === "inference-basis" ? "inference-basis" : "source-span";
  const relationLabel = basisRelation === "source-span" ? "原文证据" : "事实依据";
  return (
    <span className="structured-v2-citations" data-relation={basisRelation} aria-label={`${relationLabel}引用`}>
      <small>{relationLabel}</small>
      {requests.map((request, index) => (
        <button type="button" key={request.spanId} aria-label={`打开${relationLabel}引用 ${index + 1}/${requests.length}`} onClick={(event) => onOpen(requests, index, basisRelation, event.currentTarget)}>
          <Quote size={12} />{index + 1}
        </button>
      ))}
    </span>
  );
}
