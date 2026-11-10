import { defineConfig } from "@playwright/test";

// Real-backend workflows: requires a disposable local Supabase stack (see docs/VALIDATION.md).
const port = process.env.INTEGRATION_APP_PORT || "3200";

export default defineConfig({
  testDir: "./tests/integration",
  testMatch: ["*.int.spec.ts"],
  outputDir: ".tmp/integration-results",
  workers: 1,
  fullyParallel: false,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    viewport: { width: 1280, height: 900 },
    actionTimeout: 20_000,
    navigationTimeout: 120_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: "list",
  webServer: {
    command: `"${process.execPath}" scripts/tests/integration-server.mjs`,
    url: `http://127.0.0.1:${port}/login`,
    timeout: 300_000,
    reuseExistingServer: true,
  },
});
