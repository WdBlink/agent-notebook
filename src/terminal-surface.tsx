import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import type { AgentRuntimeGatewayContract } from "./runtime-gateway";
import { createTerminalOperationQueue } from "./terminal-operation-queue";

export interface RuntimeTerminalSurfaceProps {
  gateway: AgentRuntimeGatewayContract;
  runtimeId: string | null;
  ownerId: string;
  displayOwnerId?: string;
  onError(message: string): void;
}

interface TerminalTestHook {
  register(ownerId: string, readBuffer: () => string): () => void;
}

function readActiveBuffer(terminal: Terminal): string {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let index = 0; index < buffer.length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
  }
  return lines.join("\n");
}

export function RuntimeTerminalSurface({ gateway, runtimeId, ownerId, displayOwnerId = ownerId, onError }: RuntimeTerminalSurfaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeIdRef = useRef(runtimeId);
  const onErrorRef = useRef(onError);
  const resizeRef = useRef<() => void>(() => undefined);

  runtimeIdRef.current = runtimeId;
  onErrorRef.current = onError;

  useEffect(() => resizeRef.current(), [runtimeId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const style = getComputedStyle(container);
    const readTheme = () => {
      const current = getComputedStyle(container);
      return {
        background: current.backgroundColor,
        foreground: current.color,
        cursor: current.color,
        selectionBackground: current.getPropertyValue("--interactive-accent") || "#315f82"
      };
    };
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      fontFamily: style.fontFamily,
      fontSize: 13,
      lineHeight: 1.35,
      letterSpacing: 0,
      screenReaderMode: true,
      scrollback: 2_000,
      theme: readTheme()
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    const testHook = (globalThis as typeof globalThis & { __agentNotebookTerminalTestHook?: TerminalTestHook })
      .__agentNotebookTerminalTestHook;
    const unregisterTestReader = testHook?.register(displayOwnerId, () => readActiveBuffer(terminal));

    let disposed = false;
    let geometry = { runtimeId: "", cols: 0, rows: 0 };
    const operations = createTerminalOperationQueue((error) => {
      onErrorRef.current(error instanceof Error ? error.message : "终端操作失败。");
    });
    const resize = () => {
      if (disposed || container.clientWidth < 1 || container.clientHeight < 1) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      const activeRuntimeId = runtimeIdRef.current;
      if (!activeRuntimeId) return;
      if (activeRuntimeId === geometry.runtimeId && terminal.cols === geometry.cols && terminal.rows === geometry.rows) return;
      geometry = { runtimeId: activeRuntimeId, cols: terminal.cols, rows: terminal.rows };
      const accepted = geometry;
      void operations.enqueueResize(() => gateway.resize(activeRuntimeId, accepted.cols, accepted.rows)).catch(() => undefined);
    };
    resizeRef.current = resize;
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = readTheme();
      requestAnimationFrame(resize);
    });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    requestAnimationFrame(resize);

    const input = terminal.onData((data) => {
      const activeRuntimeId = runtimeIdRef.current;
      if (!activeRuntimeId) return;
      void operations.enqueueWrite(() => gateway.write(activeRuntimeId, data)).catch(() => undefined);
    });
    const unsubscribe = gateway.subscribe((event) => {
      if (event.ownerId !== ownerId) return;
      if (runtimeIdRef.current && event.runtimeId !== runtimeIdRef.current) return;
      if (event.type === "output") terminal.write(event.data);
      if (event.type === "error") onErrorRef.current(event.error.message);
    });

    return () => {
      disposed = true;
      unsubscribe();
      input.dispose();
      observer.disconnect();
      themeObserver.disconnect();
      operations.reset();
      resizeRef.current = () => undefined;
      unregisterTestReader?.();
      terminal.dispose();
    };
  }, [displayOwnerId, gateway, ownerId]);

  const stopPropagation = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <div
      ref={containerRef}
      className="agent-whiteboard-terminal-surface nodrag nowheel"
      data-runtime-id={runtimeId ?? ""}
      data-owner-id={ownerId}
      aria-label={`终端 ${displayOwnerId}`}
      onKeyDownCapture={stopPropagation}
      onKeyUpCapture={stopPropagation}
      onPointerDown={stopPropagation}
      onPointerMove={stopPropagation}
      onPointerUp={stopPropagation}
      onWheel={stopPropagation}
      onDoubleClick={stopPropagation}
    />
  );
}
