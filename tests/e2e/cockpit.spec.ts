import { expect, test } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const harnessUrl = pathToFileURL(path.resolve("tests/e2e/harness.html")).toString();

for (const width of [320, 768, 1024, 1440]) {
  test(`renders without horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(harnessUrl);
    await expect(page.getByRole("heading", { name: "早上 3 分钟，接上昨天的自己" })).toBeVisible();
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasOverflow).toBe(false);
  });
}

test("capture defaults to inbox and export panel reports path", async ({ page }) => {
  await page.goto(harnessUrl);
  await page.getByLabel("随手捕捉内容").fill("测试一个新的灵感，先不要变成今天的任务。");
  await page.getByLabel("上下文").fill("Playwright");
  await page.getByRole("button", { name: "先替我记着" }).click();

  await expect(page.getByRole("heading", { name: "灵感收纳箱" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "测试一个新的灵感，先不要变成今天的任务。" })).toBeVisible();

  await page.getByRole("button", { name: "导出" }).click();
  await page.getByRole("button", { name: "写入今日 Markdown" }).click();
  await expect(page.getByText("Daily Cockpit/2026-07-02.md")).toBeVisible();
});

test("done lane is reachable from persistent navigation", async ({ page }) => {
  await page.goto(harnessUrl);
  await page.getByRole("button", { name: "已完成 完成记录" }).click();
  await expect(page.getByRole("heading", { name: "已完成" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "完成 README 第一屏" })).toBeVisible();
});

test("keyboard focus is visible on nav and capture controls", async ({ page }) => {
  await page.goto(harnessUrl);
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return "";
    return window.getComputedStyle(active).outlineStyle;
  });
  expect(outline).not.toBe("none");
});
