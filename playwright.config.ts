import { defineConfig } from "@playwright/test";

export default defineConfig({
  outputDir: ".tmp/unit-test-results",
  testDir: "./tests",
  testIgnore: ["ui-smoke.spec.ts", "*.ui.spec.ts", "integration/**"],
  fullyParallel: true,
  reporter: "list",
});
