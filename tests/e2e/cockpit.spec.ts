import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { GlobalBoardDocument } from "../../src/whiteboard-model";

const harnessUrl = pathToFileURL(path.resolve("tests/e2e/harness.html")).toString();
const longHarnessUrl = `${harnessUrl}?fixture=long`;
const whiteboardHarnessUrl = `${harnessUrl}?view=whiteboard`;

async function terminalGlyphEvidence(screen: Locator, marker: string): Promise<{ contrast: number; clipped: boolean }> {
  return screen.evaluate((element, expectedMarker) => {
    const rows = Array.from(element.querySelectorAll<HTMLElement>(".xterm-rows > div"));
    const row = rows.find((candidate) => candidate.textContent?.includes(expectedMarker));
    if (!row) return { contrast: 0, clipped: true };
    const foreground = parseRgb(window.getComputedStyle(row).color).slice(0, 3) as [number, number, number];
    let backgroundElement: Element | null = element;
    let background = parseRgb("rgba(0, 0, 0, 0)");
    while (backgroundElement && background[3] === 0) {
      background = parseRgb(window.getComputedStyle(backgroundElement).backgroundColor);
      backgroundElement = backgroundElement.parentElement;
    }
    const contrast = contrastRatio(foreground, background.slice(0, 3) as [number, number, number]);
    const rowBounds = row.getBoundingClientRect();
    const screenBounds = element.getBoundingClientRect();
    return {
      contrast,
      clipped: rowBounds.left < screenBounds.left - 1 || rowBounds.right > screenBounds.right + 1
        || rowBounds.top < screenBounds.top - 1 || rowBounds.bottom > screenBounds.bottom + 1
    };

    function parseRgb(value: string): [number, number, number, number] {
      const numbers = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
      return [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0, numbers[3] ?? 1];
    }

    function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
      const luminance = (rgb: [number, number, number]) => {
        const channels = rgb.map((value) => {
          const normalized = value / 255;
          return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
      };
      const first = luminance(a);
      const second = luminance(b);
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    }
  }, marker);
}

for (const width of [320, 768, 1024, 1440]) {
  test(`renders without horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(harnessUrl);
    await expect(page.getByRole("heading", { name: "昨日工作", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "昨日项目" })).toBeVisible();
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasOverflow).toBe(false);
  });
}

test("shows and refreshes yesterday agent work sessions", async ({ page }) => {
  await page.goto(harnessUrl);
  await expect(page.getByText("实现每日看板连续性原型")).toBeVisible();
  await expect(page.getByRole("button", { name: "续上会话：实现每日看板连续性原型" })).toBeVisible();

  await page.getByRole("button", { name: "刷新昨日工作会话" }).click();
  await expect(page.getByText("Playwright 刷新出来的昨日会话")).toBeVisible();
  await expect(page.getByRole("button", { name: "续上会话：Playwright 刷新出来的昨日会话" })).toBeVisible();
});

test("copies a project-aware resume command", async ({ page }) => {
  await page.goto(harnessUrl);
  const session = page.locator(".daily-cockpit-session").filter({ hasText: "实现每日看板连续性原型" });
  const button = session.locator(".daily-cockpit-resume");

  await button.click();
  await expect(button).toHaveText("已复制");
  const command = await page.evaluate(
    () => (window as Window & { dailyCockpitCopiedResumeCommand?: string }).dailyCockpitCopiedResumeCommand
  );
  expect(command).toBe('cd "$HOME/Documents/new day board" && codex resume seed-codex-session');
});

test("decomposes intent into ordinary completable tasks", async ({ page }) => {
  await page.goto(harnessUrl);
  await page.getByLabel("待拆解的自然语言意图").fill("明天研究一个项目，先查概念，如果可以就跑 demo。");
  await page.getByRole("button", { name: "拆成待办" }).click();

  await expect(page.locator(".daily-cockpit-task").filter({ hasText: "查清项目核心概念" })).toBeVisible();
  await expect(page.locator(".daily-cockpit-task").filter({ hasText: "尝试跑 demo" })).toBeVisible();
  const task = page.locator(".daily-cockpit-task").filter({ hasText: "尝试跑 demo" });
  await page.getByLabel("完成待办：尝试跑 demo").check();
  await expect(task).toHaveAttribute("data-completed", "true");
});

test("long todo lists use internal scroll containers", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 620 });
  await page.goto(longHarnessUrl);

  const taskList = page.locator(".daily-cockpit-task-list");
  await expect(taskList).toBeVisible();
  const metrics = await taskList.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    const styles = window.getComputedStyle(element);
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      overflowY: styles.overflowY
    };
  });
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  expect(metrics.scrollTop).toBeGreaterThan(0);
  expect(["auto", "scroll"]).toContain(metrics.overflowY);

  const pageMetrics = await page.evaluate(() => ({
    documentHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight
  }));
  expect(pageMetrics.documentHeight).toBeLessThanOrEqual(pageMetrics.viewportHeight + 1);
});

test("task updates preserve list scroll, focused draft, and selection", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 620 });
  await page.goto(longHarnessUrl);
  const textarea = page.getByLabel("待拆解的自然语言意图");
  await textarea.fill("保留这段尚未提交的输入");
  await textarea.evaluate((element) => {
    const field = element as HTMLTextAreaElement;
    field.focus();
    field.setSelectionRange(2, 7);
  });
  const taskList = page.locator(".daily-cockpit-task-list");
  await taskList.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.getByLabel("完成待办：长待办 18", { exact: false }).evaluate((element) => (element as HTMLInputElement).click());

  await expect(textarea).toHaveValue("保留这段尚未提交的输入");
  const state = await page.evaluate(() => {
    const list = document.querySelector(".daily-cockpit-task-list");
    const field = document.querySelector('[data-field-key="intent-draft"]') as HTMLTextAreaElement | null;
    return {
      scrollTop: list?.scrollTop ?? 0,
      focused: document.activeElement === field,
      selectionStart: field?.selectionStart,
      selectionEnd: field?.selectionEnd
    };
  });
  expect(state.scrollTop).toBeGreaterThan(0);
  expect(state.focused).toBe(true);
  expect(state.selectionStart).toBe(2);
  expect(state.selectionEnd).toBe(7);
});

test("long todo copy stays horizontally contained on narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(longHarnessUrl);

  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasOverflow).toBe(false);
});

test("export panel reports path", async ({ page }) => {
  await page.goto(harnessUrl);
  await page.getByRole("button", { name: "写入 Markdown" }).click();
  await expect(page.getByText("Daily Cockpit/2026-07-04.md")).toBeVisible();
});

test("keyboard focus is visible on intent controls", async ({ page }) => {
  await page.goto(harnessUrl);
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return "";
    return window.getComputedStyle(active).outlineStyle;
  });
  expect(outline).not.toBe("none");
});

test("global whiteboard renders both project frames with no project selector", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(whiteboardHarnessUrl);

  await expect(page.locator(".react-flow__node-frame")).toHaveCount(2);
  await expect(page.getByText("Alpha · 1 Agents · 0 active", { exact: true })).toBeVisible();
  await expect(page.getByText("Beta · 1 Agents · 0 active", { exact: true })).toBeVisible();
  await expect(page.getByLabel("当前项目")).toHaveCount(0);
  await expect(page.locator("select")).toHaveCount(0);
  const ownership = await page.evaluate(() => {
    const value = (window as unknown as Window & { whiteboardSavedDocument: GlobalBoardDocument }).whiteboardSavedDocument;
    return value.nodes.map((node) => `${node.id}:${node.projectId}`);
  });
  expect(ownership).toEqual([
    "agent-alpha:project-alpha",
    "note-alpha:project-alpha",
    "label-alpha:project-alpha",
    "terminal-beta:project-beta",
    "agent-beta:project-beta",
    "note-beta:project-beta"
  ]);
});

test("frame menu creates Codex, unavailable Claude, and shell nodes at the project cwd", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(whiteboardHarnessUrl);
  const alphaBody = page.locator('.react-flow__node-frame[data-id="project-alpha"] .agent-whiteboard-frame-body');

  await alphaBody.click({ button: "right", position: { x: 500, y: 300 } });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveCount(3);
  await expect(menu.getByRole("menuitem", { name: "新建 Codex 会话" })).toHaveCount(1);
  await expect(menu.getByRole("menuitem", { name: "新建 Claude Code 会话" })).toHaveCount(1);
  await expect(menu.getByRole("menuitem", { name: "新建终端" })).toHaveCount(1);
  await menu.getByRole("menuitem", { name: "新建 Codex 会话" }).click();

  await alphaBody.click({ button: "right", position: { x: 30, y: 300 } });
  await page.getByRole("menuitem", { name: "新建 Claude Code 会话" }).click();
  await alphaBody.dispatchEvent("contextmenu", { button: 2, clientX: 820, clientY: 560 });
  await page.getByRole("menuitem", { name: "新建终端" }).click();
  await expect.poll(async () => page.evaluate(() => (
    window as unknown as Window & { whiteboardSavedDocument: GlobalBoardDocument }
  ).whiteboardSavedDocument.nodes.filter((node) => node.kind === "agent" && node.projectId === "project-alpha").length)).toBe(3);
  const result = await page.evaluate(() => {
    const runtime = window as unknown as Window & {
      whiteboardSavedDocument: GlobalBoardDocument;
      whiteboardProcessLaunchCount: number;
    };
    return {
      count: runtime.whiteboardProcessLaunchCount,
      placeholders: runtime.whiteboardSavedDocument.nodes
        .filter((node) => node.kind === "agent" && node.projectId === "project-alpha" && node.id !== "agent-alpha")
        .map((node) => node.kind === "agent" ? `${node.provider}|${node.projectId}|${node.workingDirectory}|${node.sessionId}|${node.runtimeState}` : "")
    };
  });
  expect(result.count).toBe(2);
  expect(result.placeholders).toEqual([
    "codex|project-alpha|/workspace/alpha|null|exited",
    "claude-code|project-alpha|/workspace/alpha|null|exited"
  ]);
});

test("focused frame opens its context menu with Shift+F10 without prior selection", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(whiteboardHarnessUrl);
  const frame = page.locator('.react-flow__node-frame[data-id="project-alpha"]');
  await frame.focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menuitem", { name: "新建 Codex 会话" })).toBeFocused();
});

test("fake runtime keeps two xterm nodes isolated, acknowledges resize, and cleans up deletion", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(whiteboardHarnessUrl);
  const alphaBody = page.locator('.react-flow__node-frame[data-id="project-alpha"] .agent-whiteboard-frame-body');
  const create = async (name: "新建 Codex 会话" | "新建终端", x: number) => {
    await alphaBody.dispatchEvent("contextmenu", { button: 2, clientX: x, clientY: 520 });
    await page.getByRole("menuitem", { name }).click();
  };
  await create("新建 Codex 会话", 240);
  await create("新建终端", 820);

  const ids = await expect.poll(async () => page.evaluate(() => {
    const document = (window as unknown as Window & { whiteboardSavedDocument: GlobalBoardDocument }).whiteboardSavedDocument;
    return document.nodes
      .filter((node) => node.projectId === "project-alpha" && ((node.kind === "agent" && node.id !== "agent-alpha") || node.kind === "terminal"))
      .map((node) => node.id);
  })).toHaveLength(2).then(async () => page.evaluate(() => {
    const document = (window as unknown as Window & { whiteboardSavedDocument: GlobalBoardDocument }).whiteboardSavedDocument;
    return document.nodes
      .filter((node) => node.projectId === "project-alpha" && ((node.kind === "agent" && node.id !== "agent-alpha") || node.kind === "terminal"))
      .map((node) => node.id);
  }));
  const [agentId, terminalId] = ids;
  expect(agentId).toBeTruthy();
  expect(terminalId).toBeTruthy();
  const agentNode = page.locator(`.react-flow__node[data-id="${agentId}"]`);
  const terminalNode = page.locator(`.react-flow__node[data-id="${terminalId}"]`);
  await expect(agentNode.getByText("运行中", { exact: true })).toBeVisible();
  await expect(terminalNode.getByText("运行中", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Zoom In" }).click();
  await expect(agentNode.locator(".agent-whiteboard-terminal-surface")).toHaveCount(1);
  await expect(terminalNode.locator(".agent-whiteboard-terminal-surface")).toHaveCount(1);
  await expect.poll(async () => page.evaluate(() => (
    window as unknown as Window & { whiteboardRuntimeResizes: unknown[] }
  ).whiteboardRuntimeResizes.length)).toBeGreaterThanOrEqual(2);

  await page.evaluate(([agent, terminal]) => {
    const runtime = window as unknown as Window & { whiteboardRuntimeOutput(ownerId: string, data: string, sequence: number): void };
    runtime.whiteboardRuntimeOutput(agent!, "AGENT-ONLY\r\n", 1);
    runtime.whiteboardRuntimeOutput(terminal!, "TERMINAL-ONLY\r\n", 1);
  }, [agentId, terminalId] as const);
  await expect.poll(() => page.evaluate(() => (
    window as unknown as Window & { whiteboardRuntimeEvents: Array<{ type: string }> }
  ).whiteboardRuntimeEvents.filter((event) => event.type === "output").length)).toBe(2);
  const routes = await page.evaluate(() => ({
    events: (window as unknown as Window & { whiteboardRuntimeEvents: Array<{ type: string; ownerId: string; runtimeId: string }> })
      .whiteboardRuntimeEvents.filter((event) => event.type === "output"),
    surfaces: Array.from(document.querySelectorAll<HTMLElement>(".agent-whiteboard-terminal-surface")).map((element) => ({
      ownerId: element.dataset.ownerId,
      runtimeId: element.dataset.runtimeId,
      label: element.getAttribute("aria-label")
    }))
  }));
  expect(routes.events.map((event) => `${event.ownerId}|${event.runtimeId}`).sort()).toEqual(
    routes.surfaces.filter((surface) => surface.label?.includes(agentId!) || surface.label?.includes(terminalId!))
      .map((surface) => `${surface.ownerId}|${surface.runtimeId}`).sort()
  );
  const readTerminal = (ownerId: string) => page.evaluate((id) => (
    window as unknown as Window & { whiteboardReadTerminal(ownerId: string): string }
  ).whiteboardReadTerminal(id), ownerId);
  await expect.poll(() => readTerminal(agentId!)).toContain("AGENT-ONLY");
  expect(await readTerminal(agentId!)).not.toContain("TERMINAL-ONLY");
  await expect.poll(() => readTerminal(terminalId!)).toContain("TERMINAL-ONLY");
  expect(await readTerminal(terminalId!)).not.toContain("AGENT-ONLY");

  await terminalNode.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("echo isolated");
  await expect.poll(async () => page.evaluate(() => {
    const runtime = window as unknown as Window & {
      whiteboardRuntimeInputs: Array<{ runtimeId: string; data: string }>;
      whiteboardRuntimeResizes: Array<{ runtimeId: string; cols: number; rows: number }>;
    };
    return { input: runtime.whiteboardRuntimeInputs.map((entry) => entry.data).join(""), resizeCount: runtime.whiteboardRuntimeResizes.length };
  })).toMatchObject({ input: "echo isolated" });
  expect(await page.evaluate(() => (window as unknown as Window & { whiteboardRuntimeResizes: unknown[] }).whiteboardRuntimeResizes.length)).toBeGreaterThan(0);

  await terminalNode.focus();
  await page.keyboard.press("Delete");
  await expect(terminalNode).toHaveCount(0);
  await expect.poll(async () => page.evaluate((ownerId) => (
    window as unknown as Window & { whiteboardRuntimeTerminatedOwners: string[] }
  ).whiteboardRuntimeTerminatedOwners.includes(ownerId!), terminalId)).toBe(true);
  const persisted = await page.evaluate(() => JSON.stringify((window as unknown as Window & { whiteboardSavedDocument: GlobalBoardDocument }).whiteboardSavedDocument));
  expect(persisted).not.toContain("AGENT-ONLY");
  expect(persisted).not.toContain("TERMINAL-ONLY");
  expect(persisted).not.toContain("fake-runtime");
});

test("fake runtime exposes a structured recoverable failure", async ({ page }) => {
  await page.goto(whiteboardHarnessUrl);
  const node = page.locator('.react-flow__node-agent[data-id="agent-alpha"]');
  await page.getByRole("button", { name: "重新启动 agent-alpha" }).click();
  await expect(node.getByText("运行中", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Zoom In" }).click();
  await expect(node.locator(".agent-whiteboard-terminal-surface")).toHaveCount(1);
  await page.evaluate((ownerId) => (
    window as unknown as Window & { whiteboardRuntimeFail(ownerId: string, message: string): void }
  ).whiteboardRuntimeFail(ownerId, "fixture runtime failed"), "agent-alpha");
  await expect(node.getByRole("alert")).toContainText("runtime_unavailable");
  await expect(node.getByRole("alert")).toContainText("fixture runtime failed");
  const retry = node.getByRole("button", { name: "重试" });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(node.getByText("运行中", { exact: true })).toBeVisible();
});

test("external viewport updates synchronize the controlled React Flow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(whiteboardHarnessUrl);
  await page.evaluate(async () => {
    const runtime = window as unknown as Window & {
      whiteboardSavedDocument: GlobalBoardDocument;
      whiteboardExternalUpdate(nextDocument: GlobalBoardDocument): Promise<void>;
    };
    await runtime.whiteboardExternalUpdate({
      ...runtime.whiteboardSavedDocument,
      viewport: { x: 137, y: 91, zoom: 0.7 }
    });
  });
  await expect.poll(async () => page.locator(".react-flow__viewport").evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(window.getComputedStyle(element).transform);
    return { x: Math.round(matrix.e), y: Math.round(matrix.f), zoom: Number(matrix.a.toFixed(2)) };
  })).toEqual({ x: 137, y: 91, zoom: 0.7 });
});

test("moving a frame moves owned children by the same canvas delta and persists", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(whiteboardHarnessUrl);
  await page.getByRole("button", { name: "Zoom In" }).click();
  const frame = page.locator('.react-flow__node-frame[data-id="project-alpha"]');
  const header = frame.locator(".agent-whiteboard-frame-header");
  const handle = await header.boundingBox();
  expect(handle).not.toBeNull();
  if (!handle) return;
  const before = await page.evaluate(() => structuredClone((window as unknown as Window & {
    whiteboardSavedDocument: GlobalBoardDocument;
  }).whiteboardSavedDocument));

  await page.mouse.move(handle.x + 220, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    handle.x + 220 + 108 * 12 / 11,
    handle.y + handle.height / 2 + 72 * 12 / 11,
    { steps: 12 }
  );
  await page.mouse.up();

  await expect.poll(async () => page.evaluate(() => (
    window as unknown as Window & { whiteboardSaveCount: number }
  ).whiteboardSaveCount)).toBeGreaterThan(0);
  const after = await page.evaluate(() => (window as unknown as Window & {
    whiteboardSavedDocument: GlobalBoardDocument;
  }).whiteboardSavedDocument);
  const beforeFrame = before.projects.find((candidate) => candidate.id === "project-alpha")!;
  const afterFrame = after.projects.find((candidate) => candidate.id === "project-alpha")!;
  const delta = {
    x: afterFrame.position.x - beforeFrame.position.x,
    y: afterFrame.position.y - beforeFrame.position.y
  };
  expect(Math.abs(delta.x - 180)).toBeLessThanOrEqual(4);
  expect(Math.abs(delta.y - 120)).toBeLessThanOrEqual(4);
  for (const beforeNode of before.nodes.filter((node) => node.projectId === "project-alpha")) {
    const afterNode = after.nodes.find((node) => node.id === beforeNode.id)!;
    expect(Math.abs((afterNode.position.x - beforeNode.position.x) - delta.x)).toBeLessThanOrEqual(4);
    expect(Math.abs((afterNode.position.y - beforeNode.position.y) - delta.y)).toBeLessThanOrEqual(4);
  }
  await page.evaluate(() => (window as unknown as Window & { whiteboardRerender(): void }).whiteboardRerender());
  await expect.poll(async () => page.locator('.react-flow__node-frame[data-id="project-alpha"]').getAttribute("style")).toContain(`${afterFrame.position.x}px`);
});

test("dragging a real frame resize handle persists accepted dimensions", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(whiteboardHarnessUrl);
  const frame = page.locator('.react-flow__node-frame[data-id="project-alpha"]');
  await frame.focus();
  await page.keyboard.press("Shift+F10");
  await page.keyboard.press("Escape");
  const handle = frame.locator(".react-flow__resize-control.handle.bottom.right");
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const before = await page.evaluate(() => structuredClone((window as unknown as Window & {
    whiteboardSavedDocument: GlobalBoardDocument;
  }).whiteboardSavedDocument.projects.find((project) => project.id === "project-alpha")!));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 80, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => page.evaluate(() => {
    const document = (window as unknown as Window & { whiteboardSavedDocument: GlobalBoardDocument }).whiteboardSavedDocument;
    const project = document.projects.find((candidate) => candidate.id === "project-alpha")!;
    return { width: project.size.width, height: project.size.height };
  })).toEqual({ width: before.size.width + 200, height: before.size.height + 160 });
});

test("dirty saves rebase a concurrent project registration and flush the latest revision", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(whiteboardHarnessUrl);
  const note = page.getByLabel("Markdown 便签").first();
  await note.fill("local first revision");
  await page.evaluate(async () => {
    const runtime = window as unknown as Window & {
      whiteboardExternalRegister(rootPath: string, name: string): Promise<void>;
    };
    await runtime.whiteboardExternalRegister("/workspace/gamma", "Gamma");
  });
  await expect(note).toHaveValue("local first revision");
  await page.evaluate(() => (window as unknown as Window & {
    whiteboardSetSaveMode(mode: "deferred"): void;
  }).whiteboardSetSaveMode("deferred"));
  await note.fill("local latest revision");
  await expect(page.getByRole("status")).toHaveText("正在保存…");
  await page.evaluate(() => (window as unknown as Window & { whiteboardReleaseSaves(): void }).whiteboardReleaseSaves());
  await expect.poll(async () => page.evaluate(() => {
    const document = (window as unknown as Window & { whiteboardSavedDocument: GlobalBoardDocument }).whiteboardSavedDocument;
    const saved = document.nodes.find((node) => node.id === "note-alpha");
    return {
      markdown: saved?.kind === "note" ? saved.markdown : "",
      projects: document.projects.map((project) => project.name)
    };
  })).toEqual({ markdown: "local latest revision", projects: ["Alpha", "Beta", "Gamma"] });
  await expect(page.getByRole("status")).toHaveText("已保存");
});

for (const resolution of ["保留本地", "采用外部"] as const) {
  test(`same-record conflict resolves with ${resolution} and closes cleanly`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(whiteboardHarnessUrl);
    const note = page.getByLabel("Markdown 便签").first();
    await note.fill("local conflict value");
    await page.evaluate(async () => {
      const runtime = window as unknown as Window & {
        whiteboardSavedDocument: GlobalBoardDocument;
        whiteboardExternalUpdate(nextDocument: GlobalBoardDocument): Promise<void>;
      };
      const remote = structuredClone(runtime.whiteboardSavedDocument);
      remote.projects = remote.projects.map((project) => project.id === "project-beta"
        ? { ...project, name: "Beta external" }
        : project);
      remote.nodes = remote.nodes.map((node) => node.id === "note-alpha" && node.kind === "note"
        ? { ...node, markdown: "external conflict value" }
        : node);
      await runtime.whiteboardExternalUpdate(remote);
    });

    const conflict = page.getByRole("alert").filter({ hasText: "节点 note-alpha" });
    await expect(conflict).toBeVisible();
    await conflict.getByRole("button", { name: resolution }).click();
    await expect(page.getByRole("status")).toHaveText("已保存");
    await expect.poll(async () => page.evaluate(() => {
      const saved = (window as unknown as Window & { whiteboardSavedDocument: GlobalBoardDocument }).whiteboardSavedDocument;
      const savedNote = saved.nodes.find((node) => node.id === "note-alpha");
      return {
        markdown: savedNote?.kind === "note" ? savedNote.markdown : "",
        betaName: saved.projects.find((project) => project.id === "project-beta")?.name
      };
    })).toEqual({
      markdown: resolution === "保留本地" ? "local conflict value" : "external conflict value",
      betaName: "Beta external"
    });
    await page.evaluate(() => (window as unknown as Window & { whiteboardBeginDestroy(): void }).whiteboardBeginDestroy());
    await expect.poll(() => page.evaluate(() => (
      window as unknown as Window & { whiteboardDestroyed: boolean }
    ).whiteboardDestroyed)).toBe(true);
  });
}

test("two controllers receive idle commits and dirty peers enter typed conflict", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(whiteboardHarnessUrl);
  await page.evaluate(() => (window as unknown as Window & {
    whiteboardOpenSecondController(): void;
  }).whiteboardOpenSecondController());
  const primary = page.locator("#root");
  const secondary = page.locator('[data-controller="secondary"]');
  const primaryNote = primary.getByLabel("Markdown 便签").first();
  const secondaryNote = secondary.getByLabel("Markdown 便签").first();

  await primaryNote.fill("controller A idle broadcast");
  await expect(secondaryNote).toHaveValue("controller A idle broadcast");
  await expect(primary.getByRole("status")).toHaveText("已保存");

  await primaryNote.fill("controller A conflict");
  await secondaryNote.fill("controller B conflict");
  await expect(secondary.getByRole("alert").filter({ hasText: "节点 note-alpha" })).toBeVisible();
  await secondary.getByRole("button", { name: "采用外部" }).click();
  await expect(secondaryNote).toHaveValue("controller A conflict");
  await expect(secondary.getByRole("status")).toHaveText("已保存");
});

test("rejected saves stay dirty and recover through the visible retry control", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(whiteboardHarnessUrl);
  await page.evaluate(() => (window as unknown as Window & {
    whiteboardSetSaveMode(mode: "reject"): void;
  }).whiteboardSetSaveMode("reject"));
  await page.getByLabel("Markdown 便签").first().fill("retry this exact revision");
  const retry = page.getByRole("button", { name: "保存失败，重试" });
  await expect(retry).toBeVisible();
  await page.evaluate(() => (window as unknown as Window & {
    whiteboardSetSaveMode(mode: "normal"): void;
  }).whiteboardSetSaveMode("normal"));
  await retry.click();
  await expect.poll(async () => page.evaluate(() => {
    const document = (window as unknown as Window & { whiteboardSavedDocument: GlobalBoardDocument }).whiteboardSavedDocument;
    const saved = document.nodes.find((node) => node.id === "note-alpha");
    return saved?.kind === "note" ? saved.markdown : "";
  })).toBe("retry this exact revision");
  await expect(page.getByRole("status")).toHaveText("已保存");
});

test("controller destroy cleans live runtimes even when the latest save never resolves", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(whiteboardHarnessUrl);
  await page.getByRole("button", { name: "重新启动 agent-alpha" }).click();
  await expect(page.locator('.react-flow__node-agent[data-id="agent-alpha"]').getByText("运行中", { exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as Window & {
    whiteboardSetSaveMode(mode: "deferred"): void;
  }).whiteboardSetSaveMode("deferred"));
  await page.getByLabel("Markdown 便签").first().fill("flush this revision on close");
  await expect(page.getByRole("status")).toHaveText("正在保存…");
  await page.evaluate(() => (window as unknown as Window & { whiteboardBeginDestroy(): void }).whiteboardBeginDestroy());
  await expect.poll(async () => page.evaluate(() => {
    const runtime = window as unknown as Window & {
      whiteboardDestroyed: boolean;
      whiteboardRuntimeTerminatedOwners: string[];
    };
    return { destroyed: runtime.whiteboardDestroyed, terminated: runtime.whiteboardRuntimeTerminatedOwners.includes("agent-alpha") };
  }), { timeout: 2_000 }).toEqual({ destroyed: true, terminated: true });
  await page.evaluate(() => (window as unknown as Window & { whiteboardReleaseSaves(): void }).whiteboardReleaseSaves());
});

test("controller destroy cleans live runtimes after a rejected save", async ({ page }) => {
  await page.goto(whiteboardHarnessUrl);
  await page.getByRole("button", { name: "重新启动 agent-alpha" }).click();
  await page.evaluate(() => (window as unknown as Window & { whiteboardSetSaveMode(mode: "reject"): void }).whiteboardSetSaveMode("reject"));
  await page.getByLabel("Markdown 便签").first().fill("rejected save must not block runtime cleanup");
  await expect(page.getByRole("button", { name: "保存失败，重试" })).toBeVisible();
  await page.evaluate(() => (window as unknown as Window & { whiteboardBeginDestroy(): void }).whiteboardBeginDestroy());
  await expect.poll(() => page.evaluate(() => {
    const runtime = window as unknown as Window & { whiteboardDestroyed: boolean; whiteboardRuntimeTerminatedOwners: string[] };
    return runtime.whiteboardDestroyed && runtime.whiteboardRuntimeTerminatedOwners.includes("agent-alpha");
  })).toBe(true);
});

test("controller destroy escalates rejected targeted termination before clearing ownership", async ({ page }) => {
  await page.goto(whiteboardHarnessUrl);
  await page.getByRole("button", { name: "重新启动 agent-alpha" }).click();
  await expect(page.locator('.react-flow__node-agent[data-id="agent-alpha"]').getByText("运行中", { exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as Window & {
    whiteboardRuntimeRejectTermination(value: boolean): void;
  }).whiteboardRuntimeRejectTermination(true));
  await page.evaluate(() => (window as unknown as Window & { whiteboardBeginDestroy(): void }).whiteboardBeginDestroy());
  await expect.poll(() => page.evaluate(() => {
    const runtime = window as unknown as Window & {
      whiteboardDestroyed: boolean;
      whiteboardRuntimeAbortCalls(): number;
      whiteboardRuntimeTerminatedOwners: string[];
    };
    return {
      destroyed: runtime.whiteboardDestroyed,
      aborts: runtime.whiteboardRuntimeAbortCalls(),
      terminated: runtime.whiteboardRuntimeTerminatedOwners.includes("agent-alpha")
    };
  })).toEqual({ destroyed: true, aborts: 1, terminated: true });
});

test("overlap never reassigns ownership and live reassignment is blocked until stop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(whiteboardHarnessUrl);
  await page.getByRole("button", { name: "Zoom In" }).click();
  page.on("dialog", (dialog) => dialog.accept());
  const agent = page.locator('.react-flow__node-agent[data-id="agent-alpha"]');
  await agent.click();
  const header = agent.locator(".agent-whiteboard-node-header");
  const box = await header.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + 120, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 950, box.y + 100, { steps: 15 });
  await page.mouse.up();
  await expect.poll(async () => page.evaluate(() => {
    const doc = (window as unknown as Window & { whiteboardSavedDocument: GlobalBoardDocument }).whiteboardSavedDocument;
    return doc.nodes.find((node) => node.id === "agent-alpha")?.projectId;
  })).toBe("project-alpha");

  await page.getByRole("button", { name: "重新启动 agent-alpha" }).click();
  await expect(agent.getByText("运行中", { exact: true })).toBeVisible();
  await agent.click();
  await page.getByRole("button", { name: "重新分配 agent-alpha" }).click();
  await page.getByRole("menuitem", { name: "Beta" }).click();
  await expect(agent.getByRole("alert")).toContainText("请先停止运行时");
  await expect.poll(async () => page.evaluate(() => {
    const doc = (window as unknown as Window & { whiteboardSavedDocument: GlobalBoardDocument }).whiteboardSavedDocument;
    const node = doc.nodes.find((candidate) => candidate.id === "agent-alpha");
    return node?.kind === "agent" ? `${node.projectId}|${node.workingDirectory}` : "";
  })).toBe("project-alpha|/workspace/alpha");
  await page.getByRole("button", { name: "停止 agent-alpha" }).click();
  await expect(agent.getByText("未启动", { exact: true })).toBeVisible();
  await agent.click();
  await page.getByRole("button", { name: "重新分配 agent-alpha" }).click();
  await page.getByRole("menuitem", { name: "Beta" }).click();
  await expect.poll(async () => page.evaluate(() => {
    const doc = (window as unknown as Window & { whiteboardSavedDocument: GlobalBoardDocument }).whiteboardSavedDocument;
    const node = doc.nodes.find((candidate) => candidate.id === "agent-alpha");
    return node?.kind === "agent" ? `${node.projectId}|${node.workingDirectory}` : "";
  })).toBe("project-beta|/workspace/beta");
});

test("delayed exit from a superseded runtime cannot clobber its running replacement", async ({ page }) => {
  await page.goto(whiteboardHarnessUrl);
  const agent = page.locator('.react-flow__node-agent[data-id="agent-alpha"]');
  await page.getByRole("button", { name: "重新启动 agent-alpha" }).click();
  await expect(agent.getByText("运行中", { exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as Window & { whiteboardRuntimeDelayTermination(value: boolean): void }).whiteboardRuntimeDelayTermination(true));
  await page.getByRole("button", { name: "重新启动 agent-alpha" }).click();
  await expect(agent.getByText("运行中", { exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as Window & { whiteboardRuntimeReleaseDelayedExits(): void }).whiteboardRuntimeReleaseDelayedExits());
  await expect(agent.getByText("运行中", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "停止 agent-alpha" })).toBeEnabled();
});

test("two whiteboard views use distinct runtime leases and close only their own runtime", async ({ page }) => {
  await page.goto(whiteboardHarnessUrl);
  await page.evaluate(() => (window as unknown as Window & { whiteboardOpenSecondController(): void }).whiteboardOpenSecondController());
  const primary = page.locator("#root");
  const secondary = page.locator('[data-controller="secondary"]');
  await primary.getByRole("button", { name: "重新启动 agent-alpha" }).click();
  await secondary.getByRole("button", { name: "重新启动 agent-alpha" }).click();
  await expect(primary.locator('.react-flow__node-agent[data-id="agent-alpha"]').getByText("运行中", { exact: true })).toBeVisible();
  await expect(secondary.locator('.react-flow__node-agent[data-id="agent-alpha"]').getByText("运行中", { exact: true })).toBeVisible();
  const owners = await page.evaluate(() => (window as unknown as Window & { whiteboardRuntimeLaunchedGatewayOwners: string[] }).whiteboardRuntimeLaunchedGatewayOwners);
  expect(owners).toHaveLength(2);
  expect(new Set(owners).size).toBe(2);
  await page.evaluate(() => (window as unknown as Window & { whiteboardCloseSecondController(): void }).whiteboardCloseSecondController());
  await expect.poll(() => page.evaluate(() => (
    window as unknown as Window & { whiteboardRuntimeTerminatedGatewayOwners: string[] }
  ).whiteboardRuntimeTerminatedGatewayOwners.length)).toBe(1);
  await expect(primary.locator('.react-flow__node-agent[data-id="agent-alpha"]').getByText("运行中", { exact: true })).toBeVisible();
});

test("visible project removal deletes owned nodes and incident edges durably", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(whiteboardHarnessUrl);
  await page.getByRole("button", { name: "Zoom In" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "移除 Beta" }).click();
  await expect.poll(async () => page.evaluate(() => {
    const document = (window as unknown as Window & { whiteboardSavedDocument: GlobalBoardDocument }).whiteboardSavedDocument;
    return {
      projects: document.projects.map((project) => project.id),
      betaNodes: document.nodes.filter((node) => node.projectId === "project-beta").length,
      betaEdge: document.edges.some((edge) => edge.id === "edge-beta")
    };
  })).toEqual({ projects: ["project-alpha"], betaNodes: 0, betaEdge: false });
});

test("semantic summaries keep exact counts and at least 12px screen text", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(whiteboardHarnessUrl);
  const summaries = page.locator(".agent-whiteboard-frame-summary");
  await expect(summaries).toHaveCount(2);
  await expect(summaries.nth(0)).toHaveText("Alpha · 1 Agents · 0 active");
  await expect(summaries.nth(1)).toHaveText("Beta · 1 Agents · 0 active");
  for (const summary of await summaries.all()) {
    const screenSize = await summary.evaluate((element) => {
      const style = window.getComputedStyle(element);
      const transform = new DOMMatrixReadOnly(style.transform);
      const flowTransform = new DOMMatrixReadOnly(window.getComputedStyle(element.closest(".react-flow__viewport")!).transform);
      return Number.parseFloat(style.fontSize) * transform.a * flowTransform.a;
    });
    expect(screenSize).toBeGreaterThanOrEqual(12);
  }
});

test("semantic summaries derive out-of-sample provider and runtime distributions", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(whiteboardHarnessUrl);
  await page.evaluate(async () => {
    const runtime = window as unknown as Window & {
      whiteboardSavedDocument: GlobalBoardDocument;
      whiteboardExternalUpdate(nextDocument: GlobalBoardDocument): Promise<void>;
    };
    const source = runtime.whiteboardSavedDocument;
    const alpha = source.nodes.find((node) => node.id === "agent-alpha");
    if (!alpha || alpha.kind !== "agent") throw new Error("missing alpha agent");
    await runtime.whiteboardExternalUpdate({
      ...source,
      nodes: [
        ...source.nodes.map((node) => node.id === "agent-beta" && node.kind === "agent"
          ? { ...node, runtimeState: "failed" as const }
          : node),
        { ...alpha, id: "agent-alpha-waiting", provider: "claude-code", runtimeState: "waiting", position: { x: 760, y: 720 } },
        { ...alpha, id: "agent-alpha-exited", runtimeState: "exited", position: { x: 1200, y: 720 } }
      ]
    });
  });
  await expect(page.getByText("Alpha · 3 Agents · 0 active", { exact: true })).toBeVisible();
  await expect(page.getByText("Beta · 1 Agents · 0 active", { exact: true })).toBeVisible();
});

test("double-clicking the global pane preserves large heading behavior", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(whiteboardHarnessUrl);
  const pane = page.locator(".react-flow__pane");
  await pane.dblclick({ position: { x: 700, y: 740 } });
  const editor = page.getByLabel("区域标题");
  await expect(editor).toBeFocused();
  await page.keyboard.type("Agent staging");
  await editor.press("Enter");
  const title = page.locator(".agent-whiteboard-label-drag-area").filter({ hasText: "Agent staging" });
  await expect(title).toBeVisible();
  await expect(page.locator('input[type="color"]')).toHaveCount(0);
  await page.getByRole("button", { name: "标题颜色：砖红" }).click();
  const typography = await title.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight };
  });
  expect(typography.fontSize).toBe("56px");
  expect(Number(typography.fontWeight)).toBeGreaterThanOrEqual(700);
  expect(Number.parseFloat(typography.lineHeight)).toBeGreaterThanOrEqual(56 * 1.15);
  await expect.poll(async () => page.evaluate(() => {
    const doc = (window as unknown as Window & { whiteboardSavedDocument: GlobalBoardDocument }).whiteboardSavedDocument;
    const label = doc.nodes.find((node) => node.kind === "label" && node.projectId === null);
    return label?.kind === "label" ? `${label.text}|${label.color}|${label.fontSize}` : "";
  })).toBe("Agent staging|#b13a32|56");
});

test("empty, invalid-path, and migration-error fixtures are actionable", async ({ page }) => {
  await page.goto(`${whiteboardHarnessUrl}&fixture=empty`);
  await expect(page.getByText("添加第一个本地项目，开始建立全局工作空间。")).toBeVisible();
  const submitProject = async (rootPath: string, name: string) => {
    const dialog = page.getByRole("dialog", { name: "添加项目" });
    await dialog.getByLabel("项目路径").fill(rootPath);
    await dialog.getByLabel("显示名称").fill(name);
    await dialog.getByRole("button", { name: "添加项目", exact: true }).click();
    return dialog;
  };
  await page.getByRole("button", { name: "添加项目" }).last().click();
  await submitProject("/workspace/alpha", "Alpha");
  await expect(page.locator(".react-flow__node-frame")).toHaveCount(1);
  await page.getByRole("button", { name: "添加项目" }).click();
  await submitProject("/workspace/beta", "Beta");
  await expect(page.locator(".react-flow__node-frame")).toHaveCount(2);

  await page.getByRole("button", { name: "添加项目" }).click();
  const duplicateDialog = await submitProject("/workspace/beta-alias", "Beta alias");
  await expect(duplicateDialog.getByRole("alert")).toHaveText("这个项目路径已经添加。");
  await duplicateDialog.getByRole("button", { name: "取消" }).click();

  await page.getByRole("button", { name: "添加项目" }).click();
  await page.getByRole("dialog", { name: "添加项目" }).getByRole("button", { name: "取消" }).click();

  await page.getByRole("button", { name: "添加项目" }).click();
  const invalidDialog = await submitProject("/workspace/not-a-directory", "Invalid");
  await expect(invalidDialog.getByRole("alert")).toHaveText("项目路径不存在，或不是可读取的文件夹。");
  await invalidDialog.getByRole("button", { name: "取消" }).click();

  await page.evaluate(() => (window as unknown as Window & {
    whiteboardSetSaveMode(mode: "deferred"): void;
  }).whiteboardSetSaveMode("deferred"));
  await page.getByRole("button", { name: "添加项目" }).click();
  const savingDialog = await submitProject("/workspace/gamma", "Gamma");
  await savingDialog.getByRole("button", { name: "取消" }).click();
  await expect(savingDialog.getByRole("alert")).toHaveText("正在保存项目，完成后将自动关闭。");
  await expect(savingDialog).toBeVisible();
  await page.evaluate(() => (window as unknown as Window & { whiteboardReleaseSaves(): void }).whiteboardReleaseSaves());
  await expect(savingDialog).toBeHidden();
  await expect(page.locator(".react-flow__node-frame")).toHaveCount(3);
  await page.evaluate(() => (window as unknown as Window & { whiteboardRerender(): void }).whiteboardRerender());
  await expect(page.locator(".react-flow__node-frame")).toHaveCount(3);
  await expect.poll(async () => page.evaluate(() => (
    window as unknown as Window & { whiteboardProjectActionResults: string[] }
  ).whiteboardProjectActionResults)).toEqual([
    "created Alpha",
    "created Beta",
    "duplicate Beta alias",
    "cancelled",
    "cancelled",
    "cancelled",
    "created Gamma"
  ]);

  await page.goto(`${whiteboardHarnessUrl}&fixture=invalid-path`);
  await page.getByRole("button", { name: "添加项目" }).last().click();
  const invalidFixtureDialog = await submitProject("/workspace/unreadable", "Unreadable");
  await expect(invalidFixtureDialog.getByRole("alert")).toHaveText("项目路径不存在，或不是可读取的文件夹。");
  await page.goto(`${whiteboardHarnessUrl}&fixture=migration-error`);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await expect(page.getByRole("heading", { name: "白板迁移失败" })).toBeVisible();
  await expect(page.getByText("节点 ID 重复：duplicate-node")).toBeVisible();
  await expect(page.getByRole("button", { name: "重试迁移" })).toBeVisible();
  await page.getByRole("button", { name: "重试迁移" }).click();
  await expect(page.locator(".react-flow__node-frame")).toHaveCount(2);
  expect(pageErrors).toEqual([]);
});

test("shipped project modal presenter owns cancellation, commit focus, removal, and durable rerender", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${whiteboardHarnessUrl}&fixture=empty`);
  const openAndSubmit = async (rootPath: string, name: string) => {
    await page.getByRole("button", { name: "添加项目" }).last().click();
    const dialog = page.getByRole("dialog", { name: "添加项目" });
    await dialog.getByLabel("项目路径").fill(rootPath);
    await dialog.getByLabel("显示名称").fill(name);
    await dialog.getByRole("button", { name: "添加项目", exact: true }).click();
    return dialog;
  };

  await page.evaluate(() => (window as unknown as Window & {
    whiteboardDeferProjectValidation(): void;
  }).whiteboardDeferProjectValidation());
  const validatingDialog = await openAndSubmit("/workspace/slow-validation", "Slow validation");
  await validatingDialog.getByRole("button", { name: "取消" }).click();
  await expect(validatingDialog).toBeHidden();
  await page.evaluate(() => (window as unknown as Window & {
    whiteboardReleaseProjectValidation(): void;
  }).whiteboardReleaseProjectValidation());
  await expect(page.locator(".react-flow__node-frame")).toHaveCount(0);

  await page.evaluate(async () => (window as unknown as Window & {
    whiteboardBlockProjectQueue(): Promise<void>;
  }).whiteboardBlockProjectQueue());
  const queuedDialog = await openAndSubmit("/workspace/queued", "Queued");
  await page.waitForTimeout(20);
  await queuedDialog.getByRole("button", { name: "取消" }).click();
  await expect(queuedDialog).toBeHidden();
  await page.evaluate(() => (window as unknown as Window & {
    whiteboardReleaseProjectQueue(): void;
  }).whiteboardReleaseProjectQueue());
  await expect(page.locator(".react-flow__node-frame")).toHaveCount(0);

  for (const [rootPath, name] of [
    ["/workspace/missing", "Missing"],
    ["/workspace/not-a-directory", "File"],
    ["/workspace/unreadable", "Unreadable"]
  ] as const) {
    const dialog = await openAndSubmit(rootPath, name);
    await expect(dialog.getByRole("alert")).toHaveText("项目路径不存在，或不是可读取的文件夹。");
    await expect(dialog.getByLabel("项目路径")).toBeFocused();
    await dialog.getByRole("button", { name: "取消" }).click();
  }

  const committedDialog = await openAndSubmit("/workspace/alpha", "Alpha");
  await expect(committedDialog).toBeHidden();
  const alphaFrame = page.locator(".react-flow__node-frame").filter({ hasText: "Alpha" });
  await expect(alphaFrame).toHaveCount(1);
  await expect(alphaFrame).toBeFocused();
  await expect.poll(async () => page.evaluate(() => (
    window as unknown as Window & { whiteboardSavedDocument: GlobalBoardDocument }
  ).whiteboardSavedDocument.projects.map((project) => project.name))).toEqual(["Alpha"]);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "移除 Alpha" }).click();
  await expect.poll(async () => page.evaluate(() => (
    window as unknown as Window & { whiteboardSavedDocument: GlobalBoardDocument }
  ).whiteboardSavedDocument.projects.length)).toBe(0);
  await page.evaluate(() => (window as unknown as Window & { whiteboardRerender(): void }).whiteboardRerender());
  await expect(page.locator(".react-flow__node-frame")).toHaveCount(0);
});

for (const width of [320, 768, 1024, 1440]) {
  test(`global whiteboard has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(whiteboardHarnessUrl);
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      root: document.querySelector("#root")!.scrollWidth - document.querySelector("#root")!.clientWidth
    }));
    expect(overflow.document).toBeLessThanOrEqual(0);
    expect(overflow.root).toBeLessThanOrEqual(0);
  });
}

test("terminal remains visible, clickable, and routes input at semantic zoom 0.5 and 0.2", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(whiteboardHarnessUrl);
  const alphaBody = page.locator('.react-flow__node-frame[data-id="project-alpha"] .agent-whiteboard-frame-body');
  await alphaBody.dispatchEvent("contextmenu", { button: 2, clientX: 600, clientY: 500 });
  await page.getByRole("menuitem", { name: "新建终端" }).click();
  const terminal = page.locator('.react-flow__node-terminal[data-id]:not([data-id="terminal-beta"])').first();
  await expect(terminal.getByText("运行中", { exact: true })).toBeVisible();
  const surface = terminal.locator(".agent-whiteboard-terminal-surface");
  const runtimeId = await surface.getAttribute("data-runtime-id");
  const ownerId = await terminal.getAttribute("data-id");
  await page.evaluate((id) => (
    window as unknown as Window & { whiteboardRuntimeOutput(ownerId: string, data: string, sequence: number): void }
  ).whiteboardRuntimeOutput(id!, "LOW-ZOOM-VISIBLE-GLYPH", 1), ownerId);
  await expect.poll(() => terminalGlyphEvidence(terminal.locator(".xterm-screen").first(), "LOW-ZOOM-VISIBLE-GLYPH"))
    .toMatchObject({ clipped: false });
  await expect.poll(async () => (await terminalGlyphEvidence(terminal.locator(".xterm-screen").first(), "LOW-ZOOM-VISIBLE-GLYPH")).contrast)
    .toBeGreaterThan(4.5);
  await surface.click({ position: { x: 40, y: 40 } });
  await expect(terminal.locator(".xterm-helper-textarea")).toBeFocused();
  await page.keyboard.type("low zoom input");
  await expect.poll(() => page.evaluate((expectedRuntimeId) => (
    window as unknown as Window & { whiteboardRuntimeInputs: Array<{ runtimeId: string; data: string }> }
  ).whiteboardRuntimeInputs.filter((entry) => entry.runtimeId === expectedRuntimeId).map((entry) => entry.data).join(""), runtimeId)).toBe("low zoom input");
  await page.evaluate(async () => {
    const runtime = window as unknown as Window & {
      whiteboardSavedDocument: GlobalBoardDocument;
      whiteboardExternalUpdate(nextDocument: GlobalBoardDocument): Promise<void>;
    };
    await runtime.whiteboardExternalUpdate({
      ...runtime.whiteboardSavedDocument,
      viewport: { ...runtime.whiteboardSavedDocument.viewport, zoom: 0.2 }
    });
  });
  await surface.click({ position: { x: 40, y: 40 } });
  await expect(terminal.locator(".xterm-helper-textarea")).toBeFocused();
  await page.keyboard.type(" at point two");
  await expect.poll(() => page.evaluate((expectedRuntimeId) => (
    window as unknown as Window & { whiteboardRuntimeInputs: Array<{ runtimeId: string; data: string }> }
  ).whiteboardRuntimeInputs.filter((entry) => entry.runtimeId === expectedRuntimeId).map((entry) => entry.data).join(""), runtimeId)).toBe("low zoom input at point two");
  await expect(terminal.locator(".xterm-screen").first()).toBeVisible();
  await expect.poll(() => terminalGlyphEvidence(terminal.locator(".xterm-screen").first(), "LOW-ZOOM-VISIBLE-GLYPH"))
    .toMatchObject({ clipped: false });
  await expect.poll(async () => (await terminalGlyphEvidence(terminal.locator(".xterm-screen").first(), "LOW-ZOOM-VISIBLE-GLYPH")).contrast)
    .toBeGreaterThan(4.5);
});

test("whiteboard supports light and dark themes with visible keyboard focus", async ({ page }) => {
  await page.goto(whiteboardHarnessUrl);
  await page.getByRole("button", { name: "重新启动 terminal-beta" }).click();
  await page.getByRole("button", { name: "Zoom In" }).click();
  const terminal = page.locator('.react-flow__node-terminal[data-id="terminal-beta"]');
  await expect(terminal.getByText("运行中", { exact: true })).toBeVisible();
  const ownerId = await terminal.getAttribute("data-id");
  await page.evaluate((id) => (
    window as unknown as Window & { whiteboardRuntimeOutput(ownerId: string, data: string, sequence: number): void }
  ).whiteboardRuntimeOutput(id!, "VISIBLE-XTERM-GLYPH", 1), ownerId);
  await expect.poll(() => page.evaluate((id) => (
    window as unknown as Window & { whiteboardReadTerminal(ownerId: string): string }
  ).whiteboardReadTerminal(id!), ownerId)).toContain("VISIBLE-XTERM-GLYPH");
  const terminalScreenshots: Buffer[] = [];
  for (const theme of ["theme-light", "theme-dark"]) {
    await page.evaluate((name) => {
      document.body.className = name;
      const dark = name === "theme-dark";
      document.body.style.setProperty("--background-primary", dark ? "#171a19" : "#ffffff");
      document.body.style.setProperty("--background-secondary", dark ? "#252a28" : "#edf1ef");
      document.body.style.setProperty("--text-normal", dark ? "#e7ebe9" : "#17201d");
      document.body.style.setProperty("--text-muted", dark ? "#a9b3af" : "#66726d");
      document.body.style.setProperty("--interactive-accent", dark ? "#72a894" : "#337565");
    }, theme);
    await page.waitForTimeout(50);
    const colors = await page.locator(".agent-whiteboard-toolbar").evaluate((element) => {
      const style = window.getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor };
    });
    expect(colors.color).not.toBe(colors.background);
    const screen = terminal.locator(".xterm-screen").first();
    await expect(screen).toBeVisible();
    const bounds = await screen.boundingBox();
    expect(bounds?.width ?? 0).toBeGreaterThan(20);
    expect(bounds?.height ?? 0).toBeGreaterThan(20);
    await expect.poll(async () => (await terminalGlyphEvidence(screen, "VISIBLE-XTERM-GLYPH")).contrast).toBeGreaterThan(4.5);
    await expect.poll(() => terminalGlyphEvidence(screen, "VISIBLE-XTERM-GLYPH")).toMatchObject({ clipped: false });
    terminalScreenshots.push(await screen.screenshot());
  }
  expect(terminalScreenshots[0]?.equals(terminalScreenshots[1]!)).toBe(false);
  await page.getByRole("button", { name: "添加项目" }).focus();
  const outline = await page.getByRole("button", { name: "添加项目" }).evaluate((element) => window.getComputedStyle(element).outlineWidth);
  expect(Number.parseFloat(outline)).toBeGreaterThanOrEqual(3);
});
