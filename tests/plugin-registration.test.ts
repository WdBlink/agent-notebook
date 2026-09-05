import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  COMMAND_EXPORT_DAILY_NOTE,
  COMMAND_OPEN_AGENT_WHITEBOARD,
  COMMAND_OPEN_COCKPIT,
  COMMAND_QUICK_CAPTURE,
  COMMAND_REFRESH_WORK_SESSIONS,
  VIEW_TYPE_AGENT_WHITEBOARD,
  VIEW_TYPE_AGENT_NOTEBOOK
} from "../src/constants";
import { registerPluginSurface } from "../src/plugin-boundary";
import { WhiteboardProjectConsumer } from "../src/project-modal";
import {
  CockpitPersistenceCoordinator,
  createEmptyData,
  WhiteboardProjectRegistrationWorkflow
} from "../src/state";

const source = fs.readFileSync("src/main.ts", "utf8");

test("plugin registers Agent Notebook and Agent Whiteboard views", () => {
  assert.equal(VIEW_TYPE_AGENT_NOTEBOOK, "agent-notebook-view");
  assert.equal(VIEW_TYPE_AGENT_WHITEBOARD, "agent-whiteboard-view");
  assert.equal(COMMAND_OPEN_COCKPIT, "open-agent-notebook");
  assert.equal(COMMAND_OPEN_AGENT_WHITEBOARD, "open-agent-whiteboard");
  assert.equal(COMMAND_QUICK_CAPTURE, "quick-capture");
  assert.equal(COMMAND_EXPORT_DAILY_NOTE, "export-daily-note");
  assert.equal(COMMAND_REFRESH_WORK_SESSIONS, "refresh-work-sessions");
  const views: string[] = [];
  const commands: string[] = [];
  const ribbons: string[] = [];
  const callbacks: string[] = [];
  registerPluginSurface<{ kind: string }, { kind: string }, string>({
    registerView: (type, creator) => {
      views.push(type);
      assert.equal(creator({ kind: type }).kind, type);
    },
    addSettingTab: (tab) => assert.equal(tab, "settings"),
    addRibbonIcon: (_icon, title, callback) => {
      ribbons.push(title);
      callback();
    },
    addCommand: (command) => {
      commands.push(command.id);
      command.callback();
    }
  }, {
    createDailyView: (leaf) => leaf,
    createWhiteboardView: (leaf) => leaf,
    settingTab: "settings",
    openDaily: () => callbacks.push("daily"),
    openWhiteboard: () => callbacks.push("whiteboard"),
    quickCapture: () => callbacks.push("capture"),
    exportDaily: () => callbacks.push("export"),
    refreshSessions: () => callbacks.push("refresh")
  });
  assert.deepEqual(views, [VIEW_TYPE_AGENT_NOTEBOOK, VIEW_TYPE_AGENT_WHITEBOARD]);
  assert.deepEqual(commands, [
    COMMAND_OPEN_COCKPIT,
    COMMAND_OPEN_AGENT_WHITEBOARD,
    COMMAND_QUICK_CAPTURE,
    COMMAND_EXPORT_DAILY_NOTE,
    COMMAND_REFRESH_WORK_SESSIONS
  ]);
  assert.deepEqual(ribbons, ["打开 Agent Notebook", "打开 Agent Whiteboard"]);
  assert.deepEqual(callbacks, ["daily", "whiteboard", "daily", "whiteboard", "capture", "export", "refresh"]);
});

test("plugin runtime avoids browser network primitives and uses Obsidian requestUrl", () => {
  assert.equal(/fetch\s*\(/.test(source), false);
  assert.equal(/XMLHttpRequest/.test(source), false);
  assert.equal(/WebSocket/.test(source), false);
  const llm = fs.readFileSync("src/llm.ts", "utf8");
  assert.ok(llm.includes("requestUrl"));
});

test("plugin owns one injected runtime gateway and launch paths remain argv-only", () => {
  const model = fs.readFileSync("src/whiteboard-model.ts", "utf8");
  const view = fs.readFileSync("src/whiteboard.tsx", "utf8");
  const gateway = fs.readFileSync("src/runtime-gateway.ts", "utf8");
  const adapter = fs.readFileSync("src/runtime-process-adapter.ts", "utf8");
  const host = fs.readFileSync("runtime/pty-host.mjs", "utf8");
  for (const forbidden of ["child_process", "node-pty", "pty.node"]) {
    assert.equal(`${model}\n${view}\n${gateway}`.includes(forbidden), false, `renderer/gateway loads forbidden native primitive: ${forbidden}`);
  }
  assert.ok(adapter.includes('from "node:child_process"'));
  assert.ok(host.includes('from "node-pty"'));
  assert.equal((source.match(/new AgentRuntimeGateway\(/g) ?? []).length, 1);
  assert.ok(source.includes("processAdapter: createNodeProcessAdapter()"));
  assert.ok(source.includes("runtimeGateway?.beginDispose()"));
  assert.equal(`${source}\n${gateway}\n${adapter}`.includes("exec("), false);
  assert.equal(`${source}\n${gateway}\n${adapter}`.includes("shell: true"), false);
  assert.ok(gateway.includes("args: [executable]"));
  const bundle = fs.readFileSync("main.js", "utf8");
  assert.ok(bundle.includes('require("node:child_process")'));
  assert.equal(bundle.includes('require("node-pty")'), false);
  assert.equal(bundle.includes("pty.node"), false);
});

test("project workflow and whiteboard saves execute the shared production coordinator", async () => {
  const durableSnapshots: string[] = [];
  const coordinator = new CockpitPersistenceCoordinator(createEmptyData(), async (candidate) => {
    durableSnapshots.push(JSON.stringify(candidate));
  });
  const workflow = new WhiteboardProjectRegistrationWorkflow(
    async (value) => value === "/alias" ? "/canonical/project" : value,
    (...values) => coordinator.registerProject(...values)
  );
  const publishedProjects: string[] = [];
  const consumer = new WhiteboardProjectConsumer({
    async register(rootPath, name, signal, onPhase) {
      const result = await workflow.run(rootPath, name, signal, onPhase);
      return result.ok ? { ok: true, projectId: result.projectId } : result;
    },
    publishCommitted(projectId) {
      publishedProjects.push(projectId);
    }
  });
  const first = await consumer.createSession().submit("/canonical/project", "Project");
  if (first.ok) await consumer.publishCommitted(first.projectId);
  const duplicate = await consumer.createSession().submit("/alias", "Alias");
  assert.equal(first.ok, true);
  assert.deepEqual(duplicate, { ok: false, message: "这个项目路径已经添加。" });
  const board = { ...coordinator.snapshot().whiteboard, viewport: { x: 14, y: 9, zoom: 0.75 } };
  const saved = await coordinator.saveWhiteboard(board, coordinator.snapshot().whiteboardRevision);
  assert.equal(saved.ok, true);
  assert.equal(coordinator.snapshot().whiteboard.viewport.zoom, 0.75);
  assert.equal(durableSnapshots.length, 2);
  assert.equal(publishedProjects.length, 1);
});
