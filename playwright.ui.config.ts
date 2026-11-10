import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["ui-smoke.spec.ts", "*.ui.spec.ts"],
  workers: 1,
  timeout: 360_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: "list",
  webServer: {
    command: `"${process.execPath}" scripts/tests/ui-fixture-server.mjs`,
    url: "http://127.0.0.1:3100/login",
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
