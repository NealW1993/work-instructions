import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["ui-smoke.spec.ts", "*.ui.spec.ts"],
  workers: 1,
  timeout: 360_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
    // The header loop streams its video for ~20 s, which keeps "networkidle" from settling on every
    // page. Tests start with the header animation switched off for the device (the same setting as
    // the account menu); ui-smoke switches it on to cover the loop.
    storageState: {
      cookies: [],
      origins: [{ origin: "http://127.0.0.1:3100", localStorage: [{ name: "work-instructions:header-animation", value: "off" }] }],
    },
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: "list",
  webServer: {
    command: `"${process.execPath}" scripts/tests/ui-fixture-server.mjs`,
    url: "http://127.0.0.1:3100/login",
    timeout: 600_000,
    reuseExistingServer: false,
  },
});
