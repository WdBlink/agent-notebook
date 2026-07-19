import { MarkdownRenderer, type App, type Component } from "obsidian";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  NodeResizer,
  Position,
  ReactFlow,
  applyEdgeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
  type ResizeParams,
  type Viewport
} from "@xyflow/react";
import {
  Bot,
  FileText,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Square,
  TerminalSquare,
  Trash2
} from "lucide-react";
import { createRoot } from "react-dom/client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from "react";
import {
  createAgentPlaceholder,
  createGlobalLabel,
  createNoteNode,
  createTerminalNode,
  deleteWhiteboardNode,
  isActiveAgent,
  moveProjectFrame,
  moveWhiteboardNode,
  rebaseGlobalBoardDocument,
  reassignWhiteboardNode,
  resolveGlobalBoardConflict,
  removeProjectFrame,
  renameProjectFrame,
  resizeProjectFrame,
  WhiteboardRebaseError,
  type GlobalBoardDocument,
  type ProjectFrame,
  type WhiteboardAgentNode,
  type WhiteboardLabelNode,
  type WhiteboardNode,
  type WhiteboardNoteNode,
  type WhiteboardProvider,
  type WhiteboardCommitResult,
  type WhiteboardTerminalNode
} from "./whiteboard-model";
import type { AgentRuntimeGatewayContract } from "./runtime-gateway";
import type { RuntimeErrorShape, RuntimeState } from "./runtime-contract";
import { RuntimeTerminalSurface } from "./terminal-surface";

export interface WhiteboardActions {
  requestProject(): void;
  saveDocument(document: GlobalBoardDocument, expectedRevision: number): Promise<WhiteboardCommitResult>;
  retryMigration(): Promise<void>;
}

interface WhiteboardProps {
  sourceDocument: GlobalBoardDocument;
  sourceRevision: number;
  app: App;
  owner: Component;
  actions: WhiteboardActions;
  runtimeGateway: AgentRuntimeGatewayContract;
  migrationError: { message: string } | undefined;
  bridge: WhiteboardBridge;
}

interface WhiteboardBridge {
  flush(): Promise<void>;
  shutdown(): Promise<void>;
  focusProject(projectId: string): void;
}

interface FlowNodeData extends Record<string, unknown> {
  frame?: ProjectFrame;
  model?: WhiteboardNode;
  app: App;
  owner: Component;
  zoom: number;
  editingFrameId: string | null;
  autoFocusId: string | null;
  ownedNodes: WhiteboardNode[];
  updateNote(nodeId: string, markdown: string): void;
  updateLabel(nodeId: string, patch: Partial<Pick<WhiteboardLabelNode, "text" | "color">>): void;
  startRename(projectId: string): void;
  commitRename(projectId: string, name: string): void;
  removeFrame(projectId: string): void;
  addNote(projectId: string): void;
  openAgentMenu(projectId: string, invoker: HTMLElement): void;
  resizeFrame(projectId: string, params: ResizeParams): void;
  openReassignment(nodeId: string, invoker: HTMLElement): void;
  runtimeGateway: AgentRuntimeGatewayContract;
  runtimeViews: ReadonlyMap<string, RuntimeNodeView>;
  runtimeOwnerId(nodeId: string): string;
  launchRuntime(node: WhiteboardAgentNode | WhiteboardTerminalNode): void;
  stopRuntime(ownerId: string): void;
  deleteNode(nodeId: string): void;
  setRuntimeError(ownerId: string, message: string): void;
}

interface RuntimeNodeView {
  runtimeId: string | null;
  state: RuntimeState;
  error: RuntimeErrorShape | null;
  generation: number;
}

interface RuntimeOwnership {
  nodeId: string;
  generation: number;
  runtimeId: string | null;
  acceptingProvisional: boolean;
}

type FlowNodeKind = WhiteboardNode["kind"] | "frame";
type WhiteboardFlowNode = Node<FlowNodeData, FlowNodeKind>;

interface AgentMenuState {
  projectId: string;
  clientX: number;
  clientY: number;
  flowPosition: { x: number; y: number };
  invoker: HTMLElement | null;
}

interface ReassignmentState {
  nodeId: string;
  invoker: HTMLElement;
}

interface WhiteboardConflictState {
  error: WhiteboardRebaseError;
  base: GlobalBoardDocument;
  local: GlobalBoardDocument;
  remote: GlobalBoardDocument;
  remoteRevision: number;
}

export interface WhiteboardController {
  update(document: GlobalBoardDocument, migrationError?: { message: string }, revision?: number): void;
  focusProject(projectId: string): void;
  destroy(): Promise<void>;
}

const NODE_TYPES: NodeTypes = {
  frame: ProjectFrameNode,
  agent: AgentNodeCard,
  terminal: TerminalNodeCard,
  note: NoteNodeCard,
  label: LabelNodeCard
};

const LABEL_COLOR_PRESETS = [
  { label: "墨黑", value: "#202825" },
  { label: "松绿", value: "#2f6f5e" },
  { label: "靛蓝", value: "#315f82" },
  { label: "砖红", value: "#b13a32" },
  { label: "赭金", value: "#9a6a17" }
] as const;

export function renderWhiteboard(
  rootElement: HTMLElement,
  document: GlobalBoardDocument,
  app: App,
  owner: Component,
  actions: WhiteboardActions,
  runtimeGateway: AgentRuntimeGatewayContract,
  migrationError?: { message: string },
  revision = 0
): WhiteboardController {
  const root = createRoot(rootElement);
  const bridge: WhiteboardBridge = {
    flush: async () => undefined,
    shutdown: async () => undefined,
    focusProject: () => undefined
  };
  rootElement.classList.add("agent-whiteboard-root");
  const render = (
    nextDocument: GlobalBoardDocument,
    nextError?: { message: string },
    nextRevision = revision
  ) => {
    root.render(
      <WhiteboardApp
        sourceDocument={nextDocument}
        sourceRevision={nextRevision}
        app={app}
        owner={owner}
        actions={actions}
        runtimeGateway={runtimeGateway}
        migrationError={nextError}
        bridge={bridge}
      />
    );
  };
  render(document, migrationError);
  return {
    update: render,
    focusProject(projectId: string): void {
      bridge.focusProject(projectId);
    },
    async destroy(): Promise<void> {
      let failure: unknown;
      try {
        await withBoundedWait(bridge.flush(), 500, "白板保存超时，已继续关闭运行时。");
      } catch (error) {
        failure = error;
      } finally {
        try {
          await withBoundedWait(bridge.shutdown(), 4_500, "运行时关闭超时。");
        } catch (error) {
          failure ??= error;
        } finally {
          root.unmount();
          rootElement.replaceChildren();
          rootElement.classList.remove("agent-whiteboard-root");
        }
      }
      if (failure) throw failure;
    }
  };
}

function WhiteboardApp({ sourceDocument, sourceRevision, app, owner, actions, runtimeGateway, migrationError, bridge }: WhiteboardProps) {
  const [document, setDocument] = useState(sourceDocument);
  const [liveViewport, setLiveViewport] = useState<Viewport>(sourceDocument.viewport);
  const [saveState, setSaveState] = useState({ revision: 0, persistedRevision: 0, saving: false, error: "" });
  const [retryingMigration, setRetryingMigration] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingFrameId, setEditingFrameId] = useState<string | null>(null);
  const [autoFocusId, setAutoFocusId] = useState<string | null>(null);
  const [agentMenu, setAgentMenu] = useState<AgentMenuState | null>(null);
  const [reassignment, setReassignment] = useState<ReassignmentState | null>(null);
  const [conflict, setConflict] = useState<WhiteboardConflictState | null>(null);
  const [runtimeViews, setRuntimeViews] = useState<ReadonlyMap<string, RuntimeNodeView>>(() => new Map());
  const viewLease = useRef(createViewLease());
  const ownedRuntimeOwners = useRef(new Map<string, string>());
  const runtimeOwnership = useRef(new Map<string, RuntimeOwnership>());
  const runtimeGeneration = useRef(new Map<string, number>());
  const flowInstance = useRef<ReactFlowInstance<WhiteboardFlowNode, Edge> | null>(null);
  const canvasRef = useRef<HTMLElement | null>(null);
  const latestDocument = useRef(document);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revision = useRef(0);
  const persistedRevision = useRef(0);
  const inFlightSave = useRef<Promise<void> | null>(null);
  const lastSourceFingerprint = useRef(`${sourceRevision}:${JSON.stringify(sourceDocument)}`);
  const baseDocument = useRef(sourceDocument);
  const committedRevision = useRef(sourceRevision);
  const pendingExternalDocument = useRef<{ document: GlobalBoardDocument; revision: number } | null>(null);
  const conflictRef = useRef<WhiteboardConflictState | null>(null);
  const activeLaunches = useRef(new Set<Promise<void>>());
  const shuttingDown = useRef(false);

  useEffect(() => {
    const fingerprint = `${sourceRevision}:${JSON.stringify(sourceDocument)}`;
    if (fingerprint === lastSourceFingerprint.current) return;
    lastSourceFingerprint.current = fingerprint;
    if (sourceRevision < committedRevision.current) return;
    if (revision.current > persistedRevision.current) {
      if (!pendingExternalDocument.current || sourceRevision >= pendingExternalDocument.current.revision) {
        pendingExternalDocument.current = { document: sourceDocument, revision: sourceRevision };
      }
      return;
    }
    pendingExternalDocument.current = null;
    baseDocument.current = sourceDocument;
    committedRevision.current = sourceRevision;
    latestDocument.current = sourceDocument;
    setDocument(sourceDocument);
    setLiveViewport(sourceDocument.viewport);
  }, [sourceDocument, sourceRevision]);

  const commitDocument = (next: GlobalBoardDocument | ((current: GlobalBoardDocument) => GlobalBoardDocument)) => {
    setDocument((current) => {
      const value = typeof next === "function" ? next(current) : next;
      if (value === current) return current;
      latestDocument.current = value;
      revision.current += 1;
      setSaveState((state) => ({
        ...state,
        revision: revision.current,
        persistedRevision: persistedRevision.current,
        error: ""
      }));
      return value;
    });
  };

  const scheduleRetry = () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      void persistPendingRevision().catch(() => undefined);
    }, 1200);
  };

  const persistPendingRevision = async (): Promise<void> => {
    if (conflictRef.current) throw conflictRef.current.error;
    if (inFlightSave.current) {
      await inFlightSave.current;
      if (persistedRevision.current < revision.current) return persistPendingRevision();
      return;
    }
    if (persistedRevision.current >= revision.current) return;
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    setSaveState((state) => ({ ...state, saving: true, error: "" }));
    const save = (async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const pending = pendingExternalDocument.current;
        if (pending && pending.revision > committedRevision.current) {
          const rebaseBase = baseDocument.current;
          const rebaseLocal = latestDocument.current;
          let rebased: GlobalBoardDocument;
          try {
            rebased = rebaseGlobalBoardDocument(rebaseBase, rebaseLocal, pending.document);
          } catch (error) {
            if (!(error instanceof WhiteboardRebaseError)) throw error;
            const nextConflict = {
              error,
              base: rebaseBase,
              local: rebaseLocal,
              remote: pending.document,
              remoteRevision: pending.revision
            };
            conflictRef.current = nextConflict;
            setConflict(nextConflict);
            throw error;
          }
          baseDocument.current = pending.document;
          committedRevision.current = pending.revision;
          if (pendingExternalDocument.current === pending) pendingExternalDocument.current = null;
          latestDocument.current = rebased;
          setDocument(rebased);
        }

        const targetRevision = revision.current;
        const snapshot = latestDocument.current;
        const result = await actions.saveDocument(snapshot, committedRevision.current);
        if (!result.ok) {
          const rebaseBase = baseDocument.current;
          const rebaseLocal = latestDocument.current;
          let rebased: GlobalBoardDocument;
          try {
            rebased = rebaseGlobalBoardDocument(rebaseBase, rebaseLocal, result.document);
          } catch (error) {
            if (!(error instanceof WhiteboardRebaseError)) throw error;
            const nextConflict = {
              error,
              base: rebaseBase,
              local: rebaseLocal,
              remote: result.document,
              remoteRevision: result.revision
            };
            conflictRef.current = nextConflict;
            setConflict(nextConflict);
            throw error;
          }
          baseDocument.current = result.document;
          committedRevision.current = result.revision;
          if (pendingExternalDocument.current?.revision === result.revision) pendingExternalDocument.current = null;
          latestDocument.current = rebased;
          setDocument(rebased);
          continue;
        }

        baseDocument.current = result.document;
        committedRevision.current = result.revision;
        conflictRef.current = null;
        setConflict(null);
        persistedRevision.current = Math.max(persistedRevision.current, targetRevision);
        if (pendingExternalDocument.current && pendingExternalDocument.current.revision <= result.revision) {
          pendingExternalDocument.current = null;
        }
        setSaveState((state) => ({
          ...state,
          persistedRevision: persistedRevision.current,
          error: ""
        }));
        return;
      }
      throw new Error("白板并发修改过于频繁，请保留当前编辑后重试。");
    })().catch((error: unknown) => {
      const message = error instanceof Error && error.message ? error.message : "保存失败，请重试。";
      setSaveState((state) => ({ ...state, error: message }));
      if (!(error instanceof WhiteboardRebaseError)) scheduleRetry();
      throw error;
    }).finally(() => {
      inFlightSave.current = null;
      setSaveState((state) => ({ ...state, saving: false }));
    });
    inFlightSave.current = save;
    await save;
    if (persistedRevision.current < revision.current) await persistPendingRevision();
  };

  useEffect(() => {
    if (persistedRevision.current >= revision.current) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null;
      void persistPendingRevision().catch(() => undefined);
    }, 400);
  }, [actions, document]);

  useEffect(() => {
    bridge.flush = async () => {
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
        persistTimer.current = null;
      }
      try {
        await persistPendingRevision();
      } catch {
        await persistPendingRevision();
      }
    };
    bridge.shutdown = async () => {
      shuttingDown.current = true;
      const owners = Array.from(ownedRuntimeOwners.current.values());
      const cleanup = Promise.allSettled(owners.map((ownerId) => runtimeGateway.terminateOwner(ownerId)));
      const completed = await settlesWithin(cleanup, 3_500);
      const results = completed ? await cleanup : [];
      const rejected = results.some((result) => result.status === "rejected");
      if (!completed || rejected) {
        await runtimeGateway.abort?.("Whiteboard view runtime cleanup timed out.");
        await Promise.allSettled(Array.from(activeLaunches.current));
      }
      if (!completed || rejected) {
        const retryResults = await Promise.allSettled(owners.map((ownerId) => runtimeGateway.terminateOwner(ownerId)));
        if (retryResults.some((result) => result.status === "rejected")) {
          throw new Error("Whiteboard runtime ownership could not be released.");
        }
      }
      ownedRuntimeOwners.current.clear();
      runtimeOwnership.current.clear();
    };
    bridge.focusProject = (projectId: string) => {
      const frame = latestDocument.current.projects.find((candidate) => candidate.id === projectId);
      if (!frame) return;
      setSelectedId(projectId);
      void flowInstance.current?.setCenter(
        frame.position.x + frame.size.width / 2,
        frame.position.y + frame.size.height / 2,
        { zoom: latestDocument.current.viewport.zoom, duration: 250 }
      );
      setTimeout(() => globalThis.document.querySelector<HTMLElement>(`[data-id="${cssEscape(projectId)}"]`)?.focus(), 0);
    };
  }, [actions, bridge, runtimeGateway]);

  useEffect(() => () => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    if (retryTimer.current) clearTimeout(retryTimer.current);
  }, []);

  useEffect(() => {
    if (!agentMenu && !reassignment) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".agent-whiteboard-menu")) return;
      setAgentMenu(null);
      setReassignment(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [agentMenu, reassignment]);

  useEffect(() => runtimeGateway.subscribe((event) => {
    const ownership = runtimeOwnership.current.get(event.ownerId);
    if (!ownership) return;
    if (ownership.runtimeId !== event.runtimeId) {
      if (
        ownership.acceptingProvisional
        && ownership.runtimeId === null
        && event.type === "state"
        && (event.state === "starting" || event.state === "running")
      ) {
        ownership.runtimeId = event.runtimeId;
      } else {
        return;
      }
    }
    const nodeId = ownership.nodeId;
    const generation = ownership.generation;
    setRuntimeViews((current) => {
      const next = new Map(current);
      const previous = next.get(nodeId) ?? { runtimeId: null, state: "exited" as const, error: null, generation };
      if (previous.generation > generation) return current;
      if (event.type === "state") {
        next.set(nodeId, { ...previous, runtimeId: event.runtimeId, state: event.state, error: event.state === "failed" ? previous.error : null, generation });
      } else if (event.type === "exit") {
        ownership.runtimeId = null;
        ownership.acceptingProvisional = false;
        next.set(nodeId, { runtimeId: null, state: "exited", error: null, generation });
      } else if (event.type === "error") {
        next.set(nodeId, { ...previous, state: "failed", error: event.error, generation });
      }
      return next;
    });
  }), [runtimeGateway]);

  const setRuntimeError = (ownerId: string, message: string) => {
    setRuntimeViews((current) => {
      const next = new Map(current);
      const generation = runtimeGeneration.current.get(ownerId) ?? 0;
      const previous = next.get(ownerId) ?? { runtimeId: null, state: "failed" as const, error: null, generation };
      next.set(ownerId, { ...previous, state: "failed", error: { code: "runtime_unavailable", message } });
      return next;
    });
  };

  const launchRuntime = (node: WhiteboardAgentNode | WhiteboardTerminalNode) => {
    if (shuttingDown.current) return;
    if (node.kind === "agent" && node.provider === "claude-code") {
      setRuntimeViews((current) => new Map(current).set(node.id, {
        runtimeId: null,
        state: "failed",
        error: { code: "provider_unavailable", message: "Claude Code 运行时尚未提供。" },
        generation: runtimeGeneration.current.get(node.id) ?? 0
      }));
      return;
    }
    const gatewayOwnerId = `${viewLease.current}:${node.id}`;
    const generation = (runtimeGeneration.current.get(node.id) ?? 0) + 1;
    runtimeGeneration.current.set(node.id, generation);
    ownedRuntimeOwners.current.set(node.id, gatewayOwnerId);
    runtimeOwnership.current.set(gatewayOwnerId, {
      nodeId: node.id,
      generation,
      runtimeId: null,
      acceptingProvisional: false
    });
    const task = (async () => {
      await runtimeGateway.terminateOwner(gatewayOwnerId);
      const ownership = runtimeOwnership.current.get(gatewayOwnerId);
      if (!ownership || ownership.generation !== generation || shuttingDown.current) return;
      ownership.acceptingProvisional = true;
      setRuntimeViews((current) => new Map(current).set(node.id, { runtimeId: null, state: "starting", error: null, generation }));
      try {
        const result = await runtimeGateway.launch({
          ownerId: gatewayOwnerId,
          kind: node.kind,
          ...(node.kind === "agent" ? { provider: "codex" as const } : {}),
          workingDirectory: node.workingDirectory,
          cols: 80,
          rows: 24
        });
        const currentOwnership = runtimeOwnership.current.get(gatewayOwnerId);
        if (shuttingDown.current || !currentOwnership || currentOwnership.generation !== generation) {
          await runtimeGateway.terminate(result.runtimeId);
          return;
        }
        currentOwnership.runtimeId = result.runtimeId;
        currentOwnership.acceptingProvisional = false;
        setRuntimeViews((current) => new Map(current).set(node.id, { runtimeId: result.runtimeId, state: "running", error: null, generation }));
      } catch (error) {
        setRuntimeError(node.id, error instanceof Error ? error.message : "运行时启动失败。");
      }
    })();
    activeLaunches.current.add(task);
    void task.finally(() => activeLaunches.current.delete(task));
  };

  const stopRuntime = (ownerId: string) => {
    void (async () => {
      try {
        const generation = (runtimeGeneration.current.get(ownerId) ?? 0) + 1;
        runtimeGeneration.current.set(ownerId, generation);
        const gatewayOwnerId = ownedRuntimeOwners.current.get(ownerId);
        const ownership = gatewayOwnerId ? runtimeOwnership.current.get(gatewayOwnerId) : undefined;
        if (ownership) {
          ownership.generation = generation;
          ownership.acceptingProvisional = false;
        }
        if (gatewayOwnerId) await runtimeGateway.terminateOwner(gatewayOwnerId);
        setRuntimeViews((current) => new Map(current).set(ownerId, { runtimeId: null, state: "exited", error: null, generation }));
      } catch (error) {
        setRuntimeError(ownerId, error instanceof Error ? error.message : "运行时停止失败。");
      }
    })();
  };

  const deleteNode = (nodeId: string) => {
    void (async () => {
      try {
        await Promise.allSettled(Array.from(activeLaunches.current));
        const gatewayOwnerId = ownedRuntimeOwners.current.get(nodeId);
        if (gatewayOwnerId) await runtimeGateway.terminateOwner(gatewayOwnerId);
        ownedRuntimeOwners.current.delete(nodeId);
        if (gatewayOwnerId) runtimeOwnership.current.delete(gatewayOwnerId);
        setRuntimeViews((current) => {
          const next = new Map(current);
          next.delete(nodeId);
          return next;
        });
        commitDocument((current) => deleteWhiteboardNode(current, nodeId));
        setSelectedId(null);
      } catch (error) {
        setRuntimeError(nodeId, error instanceof Error ? error.message : "停止失败，节点未删除。请重试。");
      }
    })();
  };

  const updateNote = (nodeId: string, markdown: string) => commitDocument((current) => ({
    ...current,
    nodes: current.nodes.map((node) => node.id === nodeId && node.kind === "note" ? { ...node, markdown } : node)
  }));
  const updateLabel = (nodeId: string, patch: Partial<Pick<WhiteboardLabelNode, "text" | "color">>) => commitDocument((current) => ({
    ...current,
    nodes: current.nodes.map((node) => node.id === nodeId && node.kind === "label" ? { ...node, ...patch } : node)
  }));
  const removeFrame = (projectId: string) => {
    const frame = document.projects.find((candidate) => candidate.id === projectId);
    if (!frame) return;
    const count = document.nodes.filter((node) => node.projectId === projectId).length;
    if (!window.confirm(`移除 ${frame.name} 及其 ${count} 个节点？`)) return;
    void (async () => {
      const ownerIds = document.nodes
        .filter((node): node is WhiteboardAgentNode | WhiteboardTerminalNode => node.projectId === projectId && (node.kind === "agent" || node.kind === "terminal"))
        .map((node) => node.id);
      try {
        await Promise.allSettled(Array.from(activeLaunches.current));
        for (const ownerId of ownerIds) {
          const gatewayOwnerId = ownedRuntimeOwners.current.get(ownerId);
          if (gatewayOwnerId) await runtimeGateway.terminateOwner(gatewayOwnerId);
        }
        for (const ownerId of ownerIds) {
          const gatewayOwnerId = ownedRuntimeOwners.current.get(ownerId);
          ownedRuntimeOwners.current.delete(ownerId);
          if (gatewayOwnerId) runtimeOwnership.current.delete(gatewayOwnerId);
        }
        commitDocument((current) => removeProjectFrame(current, projectId));
        setSelectedId(null);
      } catch (error) {
        for (const ownerId of ownerIds) setRuntimeError(ownerId, error instanceof Error ? error.message : "停止失败，项目未移除。请重试。");
      }
    })();
  };
  const openAgentMenu = (projectId: string, invoker: HTMLElement, clientX?: number, clientY?: number) => {
    const frame = document.projects.find((candidate) => candidate.id === projectId);
    const instance = flowInstance.current;
    const canvas = canvasRef.current;
    if (!frame || !instance || !canvas) return;
    const rect = invoker.getBoundingClientRect();
    const x = clientX ?? rect.left;
    const y = clientY ?? rect.bottom + 4;
    const bounds = canvas.getBoundingClientRect();
    const menuWidth = 224;
    const menuHeight = 116;
    const clampedX = clamp(x, bounds.left + 8, bounds.right - menuWidth - 8);
    const clampedY = clamp(y, bounds.top + 8, bounds.bottom - menuHeight - 8);
    setAgentMenu({
      projectId,
      clientX: clampedX,
      clientY: clampedY,
      flowPosition: instance.screenToFlowPosition({ x, y }),
      invoker
    });
    setReassignment(null);
  };
  const addPlaceholder = (target: WhiteboardProvider | "terminal") => {
    if (!agentMenu) return;
    const next = target === "terminal"
      ? createTerminalNode(document, agentMenu.projectId, agentMenu.flowPosition)
      : createAgentPlaceholder(document, agentMenu.projectId, target, agentMenu.flowPosition);
    const created = next.nodes.at(-1);
    commitDocument(next);
    if (created?.kind === "agent" || created?.kind === "terminal") requestAnimationFrame(() => launchRuntime(created));
    const invoker = agentMenu.invoker;
    setAgentMenu(null);
    requestAnimationFrame(() => invoker?.focus());
  };
  const confirmReassignment = (targetProjectId: string | null) => {
    if (!reassignment) return;
    const node = document.nodes.find((candidate) => candidate.id === reassignment.nodeId);
    const targetName = targetProjectId === null
      ? "全局"
      : document.projects.find((frame) => frame.id === targetProjectId)?.name;
    if (!node || !targetName || !window.confirm(`将 ${node.id} 移动到 ${targetName}？`)) return;
    const runtime = runtimeViews.get(node.id);
    if (runtime && (runtime.runtimeId !== null || runtime.state === "starting" || runtime.state === "running")) {
      setRuntimeError(node.id, "请先停止运行时，再移动到其他项目。");
      setReassignment(null);
      return;
    }
    commitDocument(reassignWhiteboardNode(document, node.id, targetProjectId));
    const invoker = reassignment.invoker;
    setReassignment(null);
    requestAnimationFrame(() => invoker.focus());
  };
  const requestProjectAfterFlush = () => {
    void persistPendingRevision().then(actions.requestProject).catch(() => undefined);
  };
  const resolveConflict = async (resolution: "local" | "remote") => {
    const current = conflictRef.current;
    if (!current) return;
    const resolved = resolveGlobalBoardConflict(
      current.base,
      current.local,
      current.remote,
      resolution
    );
    baseDocument.current = current.remote;
    committedRevision.current = current.remoteRevision;
    pendingExternalDocument.current = null;
    latestDocument.current = resolved;
    revision.current += 1;
    conflictRef.current = null;
    setConflict(null);
    setDocument(resolved);
    setSaveState((state) => ({
      ...state,
      revision: revision.current,
      error: ""
    }));
    await persistPendingRevision();
  };

  const flowNodes = useMemo(() => toFlowNodes({ ...document, viewport: liveViewport }, {
    app,
    owner,
    selectedId,
    editingFrameId,
    autoFocusId,
    updateNote,
    updateLabel,
    startRename: setEditingFrameId,
    commitRename: (projectId, name) => {
      commitDocument(renameProjectFrame(document, projectId, name));
      setEditingFrameId(null);
    },
    removeFrame,
    addNote: (projectId) => commitDocument(createNoteNode(document, projectId)),
    openAgentMenu,
    resizeFrame: (projectId, params) => {
      const frame = document.projects.find((candidate) => candidate.id === projectId);
      if (!frame) return;
      const resized = resizeProjectFrame(frame, {
        position: { x: params.x, y: params.y },
        size: { width: params.width, height: params.height }
      }, document.nodes);
      if (resized === frame) return;
      commitDocument({
        ...document,
        projects: document.projects.map((candidate) => candidate.id === projectId ? resized : candidate)
      });
    },
    openReassignment: (nodeId, invoker) => {
      setReassignment({ nodeId, invoker });
      setAgentMenu(null);
    },
    runtimeGateway,
    runtimeViews,
    runtimeOwnerId: (nodeId) => `${viewLease.current}:${nodeId}`,
    launchRuntime,
    stopRuntime,
    deleteNode,
    setRuntimeError
  }), [app, autoFocusId, document, editingFrameId, liveViewport, owner, runtimeGateway, runtimeViews, selectedId]);
  const flowEdges = useMemo(() => document.edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    type: "smoothstep"
  })), [document.edges]);

  const onNodesChange = (changes: NodeChange<WhiteboardFlowNode>[]) => {
    let next = document;
    for (const change of changes) {
      if (change.type === "position" && change.position) {
        const frame = next.projects.find((candidate) => candidate.id === change.id);
        next = frame
          ? moveProjectFrame(next, change.id, change.position)
          : moveWhiteboardNode(next, change.id, change.position);
      } else if (change.type === "dimensions" && change.dimensions && !next.projects.some((frame) => frame.id === change.id)) {
        const currentNode = next.nodes.find((node) => node.id === change.id);
        if (!currentNode || (
          currentNode.size.width === change.dimensions.width
          && currentNode.size.height === change.dimensions.height
        )) continue;
        next = {
          ...next,
          nodes: next.nodes.map((node) => node.id === change.id
            ? { ...node, size: { width: change.dimensions!.width, height: change.dimensions!.height } }
            : node)
        };
      }
    }
    if (next !== document) commitDocument(next);
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    const next = applyEdgeChanges(changes, flowEdges);
    commitDocument({
      ...document,
      edges: next.map((edge) => ({ id: edge.id, sourceNodeId: edge.source, targetNodeId: edge.target }))
    });
  };
  const onConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    commitDocument({
      ...document,
      edges: [...document.edges, {
        id: `edge-${globalThis.crypto.randomUUID()}`,
        sourceNodeId: connection.source,
        targetNodeId: connection.target
      }]
    });
  };
  const addHeading = (event: ReactMouseEvent<Element, MouseEvent>) => {
    if (!(event.target instanceof Element) || !event.target.classList.contains("react-flow__pane")) return;
    const position = flowInstance.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    if (!position) return;
    const next = createGlobalLabel(document, position);
    const id = next.nodes.at(-1)?.id ?? null;
    setAutoFocusId(id);
    setSelectedId(id);
    commitDocument(next);
  };
  const onNodeContextMenu = (event: ReactMouseEvent<Element, MouseEvent>, node: WhiteboardFlowNode) => {
    if (node.type !== "frame" || !(event.target instanceof Element)) return;
    if (!event.target.closest(".agent-whiteboard-frame-body") || event.target.closest("button, input, textarea")) return;
    event.preventDefault();
    openAgentMenu(node.id, event.currentTarget as HTMLElement, event.clientX, event.clientY);
  };
  const onCanvasKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const focusedElement = event.target instanceof Element
      ? event.target.closest<HTMLElement>(".react-flow__node[data-id]")
      : null;
    const activeId = focusedElement?.dataset.id ?? selectedId;
    if (!activeId) return;
    if (focusedElement && selectedId !== activeId) setSelectedId(activeId);
    const frame = document.projects.find((candidate) => candidate.id === activeId);
    const node = document.nodes.find((candidate) => candidate.id === activeId);
    if (event.shiftKey && event.key === "F10" && frame) {
      event.preventDefault();
      openAgentMenu(frame.id, focusedElement ?? event.currentTarget);
      return;
    }
    if (event.altKey && event.key.toLowerCase() === "r" && node) {
      event.preventDefault();
      setReassignment({ nodeId: node.id, invoker: focusedElement ?? event.currentTarget });
      return;
    }
    if (event.key === "Enter" && frame) {
      event.preventDefault();
      setEditingFrameId(frame.id);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      if (frame) removeFrame(frame.id);
      if (node) deleteNode(node.id);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    if (frame && event.altKey) {
      const amount = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -20 : 20;
      const proposed = {
        position: frame.position,
        size: {
          width: frame.size.width + (event.key === "ArrowLeft" || event.key === "ArrowRight" ? amount : 0),
          height: frame.size.height + (event.key === "ArrowUp" || event.key === "ArrowDown" ? amount : 0)
        }
      };
      const resized = resizeProjectFrame(frame, proposed, document.nodes);
      if (resized !== frame) commitDocument({
        ...document,
        projects: document.projects.map((candidate) => candidate.id === frame.id ? resized : candidate)
      });
      return;
    }
    const amount = event.shiftKey ? 1 : 10;
    const delta = {
      x: event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0,
      y: event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0
    };
    if (frame) commitDocument(moveProjectFrame(document, frame.id, {
      x: frame.position.x + delta.x,
      y: frame.position.y + delta.y
    }));
    if (node) commitDocument(moveWhiteboardNode(document, node.id, {
      x: node.position.x + delta.x,
      y: node.position.y + delta.y
    }));
  };

  if (migrationError) {
    return (
      <main className="agent-whiteboard-recovery" role="alert">
        <div>
          <h1>白板迁移失败</h1>
          <p>{migrationError.message}</p>
          <button
            type="button"
            className="mod-cta"
            disabled={retryingMigration}
            onClick={() => {
              setRetryingMigration(true);
              void actions.retryMigration().finally(() => setRetryingMigration(false));
            }}
          >{retryingMigration ? "正在重试…" : "重试迁移"}</button>
        </div>
      </main>
    );
  }

  return (
    <main className="agent-whiteboard-shell">
      <header className="agent-whiteboard-toolbar">
        <strong>Agent Whiteboard</strong>
        {conflict ? (
          <div className="agent-whiteboard-conflict" role="alert">
            <span>{conflict.error.message} 冲突项：{conflict.error.conflicts.join("、")}</span>
            <button type="button" onClick={() => void resolveConflict("local").catch(() => undefined)}>保留本地</button>
            <button type="button" onClick={() => void resolveConflict("remote").catch(() => undefined)}>采用外部</button>
          </div>
        ) : saveState.error ? (
          <button
            type="button"
            className="agent-whiteboard-save-error"
            aria-live="assertive"
            title={saveState.error}
            onClick={() => void persistPendingRevision().catch(() => undefined)}
          >保存失败，重试</button>
        ) : (
          <span className="agent-whiteboard-save-state" role="status" aria-live="polite">
            {saveState.saving
              ? "正在保存…"
              : saveState.revision > saveState.persistedRevision
                ? "等待保存…"
                : "已保存"}
          </span>
        )}
        <button type="button" className="clickable-icon" aria-label="添加项目" title="添加项目" onClick={requestProjectAfterFlush}>
          <FolderPlus aria-hidden="true" />
        </button>
      </header>
      {document.projects.length === 0 ? (
        <section className="agent-whiteboard-empty">
          <div>
            <FolderPlus aria-hidden="true" />
            <h1>Agent Whiteboard</h1>
            <p>添加第一个本地项目，开始建立全局工作空间。</p>
            <button type="button" className="mod-cta" onClick={requestProjectAfterFlush}><Plus aria-hidden="true" />添加项目</button>
          </div>
        </section>
      ) : (
        <section
          ref={canvasRef}
          className="agent-whiteboard-canvas"
          aria-label="全局 Agent 白板"
          tabIndex={0}
          onKeyDown={onCanvasKeyDown}
          onDoubleClickCapture={addHeading}
        >
          <ReactFlow<WhiteboardFlowNode, Edge>
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={NODE_TYPES}
            onInit={(instance) => { flowInstance.current = instance; }}
            minZoom={0.2}
            maxZoom={2}
            viewport={liveViewport}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onMove={(_event, viewport) => setLiveViewport(viewport)}
            onMoveEnd={(_event, viewport) => commitDocument((current) => (
              current.viewport.x === viewport.x
              && current.viewport.y === viewport.y
              && current.viewport.zoom === viewport.zoom
                ? current
                : { ...current, viewport }
            ))}
            onNodeClick={(_event, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            onNodeContextMenu={onNodeContextMenu}
            deleteKeyCode={null}
            multiSelectionKeyCode={null}
            selectionOnDrag
            panOnScroll
            zoomOnDoubleClick={false}
            nodesFocusable
            edgesFocusable
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} />
            <Controls showInteractive={false} />
          </ReactFlow>
          {agentMenu && (
            <AgentCreationMenu
              state={agentMenu}
              create={addPlaceholder}
              close={() => {
                const invoker = agentMenu.invoker;
                setAgentMenu(null);
                requestAnimationFrame(() => invoker?.focus());
              }}
            />
          )}
          {reassignment && (
            <ReassignmentMenu
              node={document.nodes.find((candidate) => candidate.id === reassignment.nodeId)}
              projects={document.projects}
              choose={confirmReassignment}
              close={() => {
                const invoker = reassignment.invoker;
                setReassignment(null);
                requestAnimationFrame(() => invoker.focus());
              }}
            />
          )}
        </section>
      )}
    </main>
  );
}

function ProjectFrameNode({ data, selected }: NodeProps<WhiteboardFlowNode>) {
  const frame = data.frame!;
  const editing = data.editingFrameId === frame.id;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(frame.name);
  const totalAgents = data.ownedNodes.filter((node) => node.kind === "agent").length;
  const activeAgents = data.ownedNodes.filter(isActiveAgent).length;

  useEffect(() => {
    if (!editing) return;
    setDraft(frame.name);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing, frame.name]);

  return (
    <article className={`agent-whiteboard-frame ${selected ? "is-selected" : ""} ${data.zoom <= 0.5 ? "is-overview" : ""}`}>
      <NodeResizer
        minWidth={1320}
        minHeight={900}
        isVisible={selected}
        onResizeEnd={(_event, params) => data.resizeFrame(frame.id, params)}
      />
      {data.zoom <= 0.5 && (
        <div
          className="agent-whiteboard-frame-summary"
          style={{ transform: `scale(${1 / data.zoom})` }}
        >
          {frame.name} · {totalAgents} Agents · {activeAgents} active
        </div>
      )}
      <header className="agent-whiteboard-frame-header">
        <Folder aria-hidden="true" />
        {editing ? (
          <input
            ref={inputRef}
            aria-label={`重命名 ${frame.name}`}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={() => data.commitRename(frame.id, draft)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setDraft(frame.name);
                event.currentTarget.blur();
              }
            }}
          />
        ) : <strong title={frame.rootPath}>{frame.name}</strong>}
        <div className="agent-whiteboard-frame-actions nodrag nowheel">
          <button type="button" className="clickable-icon" aria-label={`在 ${frame.name} 中添加便签`} title="添加便签" onClick={() => data.addNote(frame.id)}>
            <FileText aria-hidden="true" />
          </button>
          <button type="button" className="clickable-icon" aria-label={`在 ${frame.name} 中添加 Agent`} title="添加 Agent" onClick={(event) => data.openAgentMenu(frame.id, event.currentTarget)}>
            <Bot aria-hidden="true" />
          </button>
          <button type="button" className="clickable-icon" aria-label={`重命名 ${frame.name}`} title="重命名" onClick={() => data.startRename(frame.id)}>
            <Pencil aria-hidden="true" />
          </button>
          <button type="button" className="clickable-icon" aria-label={`移除 ${frame.name}`} title="移除" onClick={() => data.removeFrame(frame.id)}>
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="agent-whiteboard-frame-body" title={frame.rootPath} />
    </article>
  );
}

function AgentCreationMenu({ state, create, close }: {
  state: AgentMenuState;
  create(target: WhiteboardProvider | "terminal"): void;
  close(): void;
}) {
  const firstItem = useRef<HTMLButtonElement | null>(null);
  useEffect(() => firstItem.current?.focus(), []);
  return (
    <div
      className="agent-whiteboard-menu agent-whiteboard-agent-menu"
      role="menu"
      style={{ left: state.clientX, top: state.clientY }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
    >
      <button ref={firstItem} type="button" role="menuitem" onClick={() => create("codex")}><Bot aria-hidden="true" />新建 Codex 会话</button>
      <button type="button" role="menuitem" onClick={() => create("claude-code")}><Bot aria-hidden="true" />新建 Claude Code 会话</button>
      <button type="button" role="menuitem" onClick={() => create("terminal")}><TerminalSquare aria-hidden="true" />新建终端</button>
    </div>
  );
}

function ReassignmentMenu({ node, projects, choose, close }: {
  node: WhiteboardNode | undefined;
  projects: ProjectFrame[];
  choose(projectId: string | null): void;
  close(): void;
}) {
  const firstItem = useRef<HTMLButtonElement | null>(null);
  useEffect(() => firstItem.current?.focus(), []);
  if (!node) return null;
  const targets = projects.filter((frame) => frame.id !== node.projectId);
  return (
    <div
      className="agent-whiteboard-menu agent-whiteboard-reassignment-menu"
      role="menu"
      aria-label={`重新分配 ${node.id}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
    >
      {targets.map((frame, index) => (
        <button ref={index === 0 ? firstItem : undefined} key={frame.id} type="button" role="menuitem" onClick={() => choose(frame.id)}>
          <Folder aria-hidden="true" />{frame.name}
        </button>
      ))}
      {node.kind === "label" && node.projectId !== null && (
        <button ref={targets.length === 0 ? firstItem : undefined} type="button" role="menuitem" onClick={() => choose(null)}>全局</button>
      )}
    </div>
  );
}

function AgentNodeCard({ data, selected }: NodeProps<WhiteboardFlowNode>) {
  const node = data.model as WhiteboardAgentNode;
  const runtime = data.runtimeViews.get(node.id) ?? (node.provider === "claude-code"
    ? { runtimeId: null, state: "failed" as const, error: { code: "provider_unavailable" as const, message: "Claude Code 运行时尚未提供。" }, generation: 0 }
    : { runtimeId: null, state: "exited" as const, error: null, generation: 0 });
  return (
    <NodeFrame node={node} data={data} selected={selected} minWidth={360} minHeight={240}>
      <header className="agent-whiteboard-node-header" title={node.workingDirectory}>
        <span className={`agent-whiteboard-provider agent-whiteboard-provider-${node.provider}`} title={node.workingDirectory}>
          <Bot aria-hidden="true" /> {node.provider === "claude-code" ? "Claude Code" : "Codex"}
        </span>
        <RuntimeControls node={node} runtime={runtime} data={data} />
      </header>
      <RuntimeBody node={node} runtime={runtime} data={data} />
    </NodeFrame>
  );
}

function TerminalNodeCard({ data, selected }: NodeProps<WhiteboardFlowNode>) {
  const node = data.model as WhiteboardTerminalNode;
  const runtime = data.runtimeViews.get(node.id) ?? { runtimeId: null, state: "exited" as const, error: null, generation: 0 };
  return (
    <NodeFrame node={node} data={data} selected={selected} minWidth={360} minHeight={220}>
      <header className="agent-whiteboard-node-header" title={node.workingDirectory}>
        <span title={node.workingDirectory}><TerminalSquare aria-hidden="true" /> 终端</span>
        <RuntimeControls node={node} runtime={runtime} data={data} />
      </header>
      <RuntimeBody node={node} runtime={runtime} data={data} />
    </NodeFrame>
  );
}

function RuntimeControls({ node, runtime, data }: {
  node: WhiteboardAgentNode | WhiteboardTerminalNode;
  runtime: RuntimeNodeView;
  data: FlowNodeData;
}) {
  return (
    <div className="agent-whiteboard-runtime-controls nodrag nowheel">
      <span className={`agent-whiteboard-runtime agent-whiteboard-runtime-${runtime.state}`}>{runtimeLabel(runtime.state)}</span>
      <button type="button" aria-label={`重新启动 ${node.id}`} title="重新启动" onClick={() => data.launchRuntime(node)}>
        <RotateCcw aria-hidden="true" />
      </button>
      <button type="button" aria-label={`停止 ${node.id}`} title="停止" disabled={!runtime.runtimeId} onClick={() => data.stopRuntime(node.id)}>
        <Square aria-hidden="true" />
      </button>
    </div>
  );
}

function RuntimeBody({ node, runtime, data }: {
  node: WhiteboardAgentNode | WhiteboardTerminalNode;
  runtime: RuntimeNodeView;
  data: FlowNodeData;
}) {
  const unavailableProvider = node.kind === "agent" && node.provider === "claude-code";
  return (
    <div className="agent-whiteboard-agent-body">
      <div className="agent-whiteboard-runtime-stage">
        {!unavailableProvider && (
          <RuntimeTerminalSurface
            gateway={data.runtimeGateway}
            runtimeId={runtime.runtimeId}
            ownerId={data.runtimeOwnerId(node.id)}
            displayOwnerId={node.id}
            onError={(message) => data.setRuntimeError(node.id, message)}
          />
        )}
        {data.zoom <= 0.5 ? (
          <div className="agent-whiteboard-runtime-summary">{node.kind === "agent" ? node.provider : "terminal"} · {runtimeLabel(runtime.state)}</div>
        ) : runtime.error ? (
          <div className="agent-whiteboard-runtime-error" role="alert">
            <strong>{runtime.error.code}</strong>
            <p>{runtime.error.message}</p>
            <button type="button" onClick={() => data.launchRuntime(node)}>重试</button>
          </div>
        ) : null}
      </div>
      <footer title={node.workingDirectory}>{node.workingDirectory}</footer>
    </div>
  );
}

function NoteNodeCard({ data, selected }: NodeProps<WhiteboardFlowNode>) {
  const node = data.model as WhiteboardNoteNode;
  const [preview, setPreview] = useState(false);
  return (
    <NodeFrame node={node} data={data} selected={selected} minWidth={240} minHeight={160} className="agent-whiteboard-note-node">
      <header className="agent-whiteboard-node-header">
        <span><FileText aria-hidden="true" /> 便签</span>
        <button type="button" className="nodrag" onClick={() => setPreview((value) => !value)}>{preview ? "编辑" : "预览"}</button>
      </header>
      {preview
        ? <MarkdownPreview markdown={node.markdown} app={data.app} owner={data.owner} />
        : <textarea
            className="nodrag nowheel"
            aria-label="Markdown 便签"
            value={node.markdown}
            onChange={(event) => data.updateNote(node.id, event.currentTarget.value)}
          />}
    </NodeFrame>
  );
}

function LabelNodeCard({ data, selected }: NodeProps<WhiteboardFlowNode>) {
  const node = data.model as WhiteboardLabelNode;
  const [editing, setEditing] = useState(data.autoFocusId === node.id);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);
  const finishEditing = () => {
    if (!node.text.trim()) data.updateLabel(node.id, { text: "区域标题" });
    setEditing(false);
  };
  return (
    <article className={`agent-whiteboard-label-node ${selected ? "is-selected" : ""}`} style={{ color: node.color }}>
      <NodeResizer minWidth={240} minHeight={88} isVisible={selected} />
      {selected && (
        <div className="agent-whiteboard-label-tools nodrag nowheel" aria-label="标题颜色">
          {LABEL_COLOR_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              className="agent-whiteboard-label-swatch"
              style={{ backgroundColor: preset.value }}
              aria-label={`标题颜色：${preset.label}`}
              aria-pressed={node.color === preset.value}
              title={preset.label}
              onClick={() => data.updateLabel(node.id, { color: preset.value })}
            />
          ))}
          <ReassignButton node={node} data={data} />
        </div>
      )}
      {editing ? (
        <input
          ref={inputRef}
          className="agent-whiteboard-label-input nodrag nowheel"
          aria-label="区域标题"
          value={node.text}
          placeholder="区域标题"
          onChange={(event) => data.updateLabel(node.id, { text: event.currentTarget.value })}
          onBlur={finishEditing}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      ) : (
        <div className="agent-whiteboard-label-drag-area" onDoubleClick={(event) => {
          event.stopPropagation();
          setEditing(true);
        }}>{node.text || "区域标题"}</div>
      )}
    </article>
  );
}

function NodeFrame({ node, data, children, selected, minWidth, minHeight, className = "" }: {
  node: WhiteboardNode;
  data: FlowNodeData;
  children: ReactNode;
  selected: boolean;
  minWidth: number;
  minHeight: number;
  className?: string;
}) {
  return (
    <article className={`agent-whiteboard-node agent-whiteboard-${node.kind}-node ${selected ? "is-selected" : ""} ${className}`}>
      <NodeResizer minWidth={minWidth} minHeight={minHeight} isVisible={selected} />
      {selected && <ReassignButton node={node} data={data} />}
      <Handle type="target" position={Position.Left} />
      {children}
      <Handle type="source" position={Position.Right} />
    </article>
  );
}

function ReassignButton({ node, data }: { node: WhiteboardNode; data: FlowNodeData }) {
  return (
    <button
      type="button"
      className="agent-whiteboard-node-overflow nodrag nowheel"
      aria-label={`重新分配 ${node.id}`}
      title="重新分配"
      onClick={(event) => data.openReassignment(node.id, event.currentTarget)}
    ><MoreHorizontal aria-hidden="true" /></button>
  );
}

function MarkdownPreview({ markdown, app, owner }: { markdown: string; app: App; owner: Component }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.replaceChildren();
    void MarkdownRenderer.render(app, markdown, element, "", owner);
    return () => element.replaceChildren();
  }, [app, markdown, owner]);
  return <div ref={ref} className="agent-whiteboard-note-preview nodrag nowheel" />;
}

function toFlowNodes(document: GlobalBoardDocument, context: {
  app: App;
  owner: Component;
  selectedId: string | null;
  editingFrameId: string | null;
  autoFocusId: string | null;
  updateNote: FlowNodeData["updateNote"];
  updateLabel: FlowNodeData["updateLabel"];
  startRename: FlowNodeData["startRename"];
  commitRename: FlowNodeData["commitRename"];
  removeFrame: FlowNodeData["removeFrame"];
  addNote: FlowNodeData["addNote"];
  openAgentMenu: FlowNodeData["openAgentMenu"];
  resizeFrame: FlowNodeData["resizeFrame"];
  openReassignment: FlowNodeData["openReassignment"];
  runtimeGateway: AgentRuntimeGatewayContract;
  runtimeViews: ReadonlyMap<string, RuntimeNodeView>;
  runtimeOwnerId(nodeId: string): string;
  launchRuntime: FlowNodeData["launchRuntime"];
  stopRuntime: FlowNodeData["stopRuntime"];
  deleteNode: FlowNodeData["deleteNode"];
  setRuntimeError: FlowNodeData["setRuntimeError"];
}): WhiteboardFlowNode[] {
  const common = {
    app: context.app,
    owner: context.owner,
    zoom: document.viewport.zoom,
    editingFrameId: context.editingFrameId,
    autoFocusId: context.autoFocusId,
    updateNote: context.updateNote,
    updateLabel: context.updateLabel,
    startRename: context.startRename,
    commitRename: context.commitRename,
    removeFrame: context.removeFrame,
    addNote: context.addNote,
    openAgentMenu: context.openAgentMenu,
    resizeFrame: context.resizeFrame,
    openReassignment: context.openReassignment,
    runtimeGateway: context.runtimeGateway,
    runtimeViews: context.runtimeViews,
    runtimeOwnerId: context.runtimeOwnerId,
    launchRuntime: context.launchRuntime,
    stopRuntime: context.stopRuntime,
    deleteNode: context.deleteNode,
    setRuntimeError: context.setRuntimeError
  };
  const frames: WhiteboardFlowNode[] = document.projects.map((frame) => ({
    id: frame.id,
    type: "frame",
    position: frame.position,
    width: frame.size.width,
    height: frame.size.height,
    zIndex: frame.zIndex,
    selected: context.selectedId === frame.id,
    dragHandle: ".agent-whiteboard-frame-header",
    data: {
      ...common,
      frame,
      ownedNodes: document.nodes.filter((node) => node.projectId === frame.id)
    }
  }));
  const nodes: WhiteboardFlowNode[] = document.nodes.map((model) => ({
    id: model.id,
    type: model.kind,
    position: model.position,
    width: model.size.width,
    height: model.size.height,
    zIndex: 1000 + model.zIndex,
    selected: context.selectedId === model.id,
    dragHandle: model.kind === "label" ? ".agent-whiteboard-label-drag-area" : ".agent-whiteboard-node-header",
    data: {
      ...common,
      model,
      ownedNodes: document.nodes.filter((node) => node.projectId === model.projectId)
    }
  }));
  return [...frames, ...nodes];
}

function runtimeLabel(state: RuntimeState): string {
  if (state === "starting") return "启动中";
  if (state === "running") return "运行中";
  if (state === "failed") return "失败";
  return "未启动";
}

function cssEscape(value: string): string {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function createViewLease(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint32Array(4);
  globalThis.crypto?.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(8, "0")).join("");
}

async function withBoundedWait<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
