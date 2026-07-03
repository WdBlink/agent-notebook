import { expect, test } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const harnessUrl = pathToFileURL(path.resolve("tests/e2e/harness.html")).toString();

for (const width of [320, 768, 1024, 1440]) {
  test(`renders without horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(harnessUrl);
    await expect(page.getByRole("heading", { name: "把一句话拆成明天可启动的待办" })).toBeVisible();
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasOverflow).toBe(false);
  });
}

test("decomposes intent into tasks and selected hot starts", async ({ page }) => {
  await page.goto(harnessUrl);
  await page.getByLabel("待拆解的自然语言意图").fill("明天研究一个项目，先查概念，如果可以就跑 demo。");
  await page.getByRole("button", { name: "拆成待办" }).click();

  await expect(page.locator(".daily-cockpit-task").filter({ hasText: "查清项目核心概念" })).toBeVisible();
  await expect(page.locator(".daily-cockpit-task").filter({ hasText: "尝试跑 demo" })).toBeVisible();
  await expect(page.locator(".daily-cockpit-hot-list").getByText("提前读取项目文档并生成概念表。")).toBeVisible();

  await page.getByLabel("选择热启动：尝试跑 demo").check();
  await expect(page.locator(".daily-cockpit-hot-list").getByText("准备运行命令和失败日志。")).toBeVisible();
});

test("export panel reports path", async ({ page }) => {
  await page.goto(harnessUrl);
  await page.getByRole("button", { name: "写入今日 Markdown" }).click();
  await expect(page.getByText("Daily Cockpit/2026-07-03.md")).toBeVisible();
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
