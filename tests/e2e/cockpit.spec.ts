import { expect, test } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const harnessUrl = pathToFileURL(path.resolve("tests/e2e/harness.html")).toString();
const longHarnessUrl = `${harnessUrl}?fixture=long`;

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
