import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  reporter: [["list"]],
  use: {
    channel: "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  }
});
