import { AlertTriangle, ChevronLeft, ChevronRight, FileText, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import type { StructuredTodaySpanRequest, StructuredTodaySpanState } from "./api";

export function StructuredTodaySpanDialog({
  title,
  requests,
  initialIndex = 0,
  basisRelation,
  onClose
}: {
  title: string;
  requests: StructuredTodaySpanRequest[];
  initialIndex?: number;
  basisRelation: "source-span" | "inference-basis";
  onClose(): void;
}): ReactElement {
  const [active, setActive] = useState(() => Math.min(Math.max(0, initialIndex), Math.max(0, requests.length - 1)));
  const [state, setState] = useState<StructuredTodaySpanState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const request = requests[active];

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setError(null);
    if (!request) {
      setError("这条陈述没有可读取的消息级引用。");
      return () => { cancelled = true; };
    }
    void window.agentWhiteboard.getStructuredTodaySpan(request)
      .then((next) => { if (!cancelled) setState(next); })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "消息级引用暂时无法读取。");
      });
    return () => { cancelled = true; };
  }, [request?.owner.artifactId, request?.owner.revision, request?.owner.contentHash, request?.statementId, request?.spanId]);

  useEffect(() => {
    if (!state || !targetRef.current) return;
    const target = targetRef.current;
    target.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    target.focus({ preventScroll: true });
  }, [state]);

  return (
    <div className="transcript-layer" role="dialog" aria-modal="true" aria-label={`${title} 消息级证据`} onKeyDown={(event) => trapSpanDialogFocus(event, onClose)}>
      <button className="transcript-backdrop" type="button" tabIndex={-1} aria-label="关闭消息级证据" onClick={onClose} />
      <section className="transcript-reader structured-span-reader">
        <header>
          <div><span className="kicker">Exact evidence / read only</span><h2>{title}</h2><p>消息级证据 · {active + 1}/{Math.max(1, requests.length)}</p></div>
          <button type="button" autoFocus aria-label="关闭消息级证据" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="transcript-scroll">
          {!state && !error ? <div className="transcript-skeleton" aria-label="正在验证消息级引用"><i /><i /><i /><i /></div> : null}
          {error ? <div className="structured-today-alert" role="alert"><AlertTriangle size={16} />{error}</div> : null}
          {state ? (
            <>
              <div className="transcript-citation-context" role="status" aria-live="polite">
                <FileText size={16} aria-hidden="true" />
                <p><strong>已验证{basisRelation === "source-span" ? "原文证据" : "事实依据"} {active + 1}/{requests.length} · {state.provider} · {authorLabel(state.authorKind, state.provider)}</strong><span>已从冻结 record 重新校验 message、quote、context 和 Unicode position；{basisRelation === "source-span" ? "高亮片段是当前陈述的直接原文证据" : "高亮片段只支持这条推断的事实基础，不直接证明推断结论"}，周边消息仅供阅读上下文。</span></p>
              </div>
              {state.omittedBefore ? <p className="structured-span-window-note">此前还有 {state.omittedBefore} 条消息未展开</p> : null}
              {state.messages.map((message) => {
                const selected = message.messageKey === state.messageKey;
                return (
                  <article
                    key={message.messageKey}
                    ref={selected ? targetRef : undefined}
                    className="structured-span-message"
                    data-role={message.role}
                    data-target={selected || undefined}
                    tabIndex={selected ? -1 : undefined}
                    aria-current={selected ? "location" : undefined}
                  >
                    <aside><strong>{authorLabel(message.authorKind, state.provider)}</strong></aside>
                    <div className="transcript-copy">
                      {selected
                        ? <HighlightedExactText content={message.content} start={state.utf16Start} end={state.utf16End} />
                        : <div className="structured-span-plain-text">{message.content}</div>}
                    </div>
                  </article>
                );
              })}
              {state.omittedAfter ? <p className="structured-span-window-note">此后还有 {state.omittedAfter} 条消息未展开</p> : null}
            </>
          ) : null}
        </div>
        <footer>
          <div><strong>{state?.messages.length ?? 0}</strong><span>verified context messages</span></div>
          <nav aria-label="消息级引用导航">
            <button type="button" disabled={active === 0} aria-label={`上一条引用，当前 ${active + 1}/${requests.length}`} onClick={() => setActive((value) => Math.max(0, value - 1))}><ChevronLeft size={15} />上一处</button>
            <button type="button" disabled={active >= requests.length - 1} aria-label={`下一条引用，当前 ${active + 1}/${requests.length}`} onClick={() => setActive((value) => Math.min(requests.length - 1, value + 1))}>下一处<ChevronRight size={15} /></button>
          </nav>
          <button type="button" onClick={onClose}>回到结论</button>
        </footer>
      </section>
    </div>
  );
}

export function HighlightedExactText({ content, start, end }: {
  content: string;
  start: number;
  end: number;
}): ReactElement {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > content.length) {
    return <div className="structured-span-plain-text">{content}</div>;
  }
  return (
    <div className="structured-span-plain-text">
      {content.slice(0, start)}
      <mark data-evidence-highlight>{content.slice(start, end)}</mark>
      {content.slice(end)}
    </div>
  );
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function trapSpanDialogFocus(event: KeyboardEvent<HTMLDivElement>, onClose: () => void): void {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((element) => element.tabIndex >= 0 && !element.hasAttribute("aria-hidden"));
  if (!focusable.length) return;
  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function authorLabel(
  kind: StructuredTodaySpanState["authorKind"],
  provider: StructuredTodaySpanState["provider"]
): string {
  if (kind === "human") return "You";
  if (kind === "agent") return provider === "codex" ? "Codex" : "Claude Code";
  if (kind === "automation") return "自动任务";
  if (kind === "host-notification") return "系统通知";
  return "User-role · 作者未验证";
}
