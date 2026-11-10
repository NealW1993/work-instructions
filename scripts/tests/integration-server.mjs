// Runs the application against a disposable local Supabase stack for the integration suite.
// Email delivery and analytics are disabled and AI providers are replaced by a local stand-in, so tests never reach real services.
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { startAiProviderMock } from "./ai-provider-mock.mjs";
import { readIntegrationEnv, seedIntegrationStack } from "./integration-seed.mjs";

const port = process.env.INTEGRATION_APP_PORT || "3200";
const { url, anonKey, serviceRoleKey } = readIntegrationEnv();
await seedIntegrationStack();

// AI requests go to a local stand-in provider, never a real one.
const aiMockPort = Number(process.env.INTEGRATION_AI_MOCK_PORT || "3911");
const aiMock = startAiProviderMock(aiMockPort);

const args = [path.resolve("node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", port];
if (process.env.INTEGRATION_WEBPACK === "1") args.splice(2, 0, "--webpack");

const nextProcess = spawn(process.execPath, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_BUILD_DIR: ".next-integration",
    NEXT_PUBLIC_SUPABASE_URL: url,
    SUPABASE_URL_INTERNAL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
    NEXT_PUBLIC_POSTHOG_KEY: "",
    OPENAI_API_KEY: "",
    AI_PROVIDER_TEST_BASE_URL: `http://127.0.0.1:${aiMockPort}`,
    // A fresh encryption key per run; saved AI keys from earlier runs are deliberately unreadable.
    AI_KEY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    SYSTEM_ADMIN_EMAIL: "",
    // Nothing listens on port 1, so best-effort notification email fails fast instead of being delivered.
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "1",
    NEXT_TELEMETRY_DISABLED: "1",
  },
});

function stop() {
  aiMock.close();
  nextProcess.kill();
}
nextProcess.on("exit", (code) => {
  process.exitCode = code || 0;
});
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
