import { expect, test, type APIRequestContext } from "@playwright/test";
import { closeRoleContexts, pageFor, serviceClient, sessionFor, USERS } from "./helpers";

test.afterEach(closeRoleContexts);

// The integration server sends every AI request to this local stand-in (scripts/tests/ai-provider-mock.mjs).
const MOCK_PROVIDER = `http://127.0.0.1:${process.env.INTEGRATION_AI_MOCK_PORT || "3911"}`;
const SETTINGS = "/api/admin/ai-settings";

async function call(request: APIRequestContext, method: "GET" | "PUT" | "POST" | "DELETE", path: string, token: string | null, data?: unknown) {
  const response = await request.fetch(path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    data: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: response.status(), text, body, headers: response.headers() };
}

async function lastProviderRequest(request: APIRequestContext) {
  return (await (await request.get(`${MOCK_PROVIDER}/__last`)).json()) as {
    path?: string;
    apiKey?: string;
    model?: string;
    anthropicVersion?: string | null;
  };
}

test.describe.serial("AI provider key", () => {
  const pin = USERS.systemAdmin.pin;
  const claudeKey = `sk-ant-e2e-${Date.now()}-ClaudeSecretValue`;
  const openAiKey = `sk-proj-e2e-${Date.now()}-OpenAiSecretValue`;

  test.beforeAll(async () => {
    // Start without a saved key. Activity records are permanent, so they are not cleared.
    await serviceClient().from("ai_provider_settings").delete().eq("id", 1);
  });

  test.afterAll(async () => {
    await serviceClient().from("ai_provider_settings").delete().eq("id", 1);
  });

  test("only system admins can see, change, view or test the key", async ({ request }) => {
    const admin = await sessionFor("admin");
    const operator = await sessionFor("operator");
    for (const [label, token] of [["admin", admin.token], ["operator", operator.token]] as const) {
      for (const [method, path, data] of [
        ["GET", SETTINGS, undefined],
        ["PUT", SETTINGS, { provider: "anthropic", model: "claude-opus-5-5", apiKey: claudeKey, pin: "604917" }],
        ["DELETE", SETTINGS, { pin: "604917" }],
        ["POST", `${SETTINGS}/reveal`, { pin: "604917" }],
        ["POST", `${SETTINGS}/test`, undefined],
      ] as const) {
        expect((await call(request, method, path, token, data)).status, `${label}: ${method} ${path}`).toBe(403);
      }
    }
    expect((await call(request, "GET", SETTINGS, null)).status).toBe(401);

    // No browser session can read the stored settings or the activity log directly, whatever its role.
    for (const role of ["operator", "admin", "systemAdmin"] as const) {
      const { client } = await sessionFor(role);
      for (const table of ["ai_provider_settings", "ai_settings_audit_events"]) {
        const { error } = await client.from(table).select("*");
        expect(error?.message, `${role} reading ${table}`).toContain("permission denied");
      }
    }
  });

  test("saving needs the system admin's PIN, stores only ciphertext, and never returns the key", async ({ request }) => {
    const systemAdmin = await sessionFor("systemAdmin");
    const initial = await call(request, "GET", SETTINGS, systemAdmin.token);
    expect(initial.status).toBe(200);
    expect(initial.body).toMatchObject({ source: "none", encryption: "ready", available: true });
    expect(initial.headers["cache-control"]).toContain("no-store");

    const wrongPin = await call(request, "PUT", SETTINGS, systemAdmin.token, { provider: "anthropic", model: "claude-opus-5-5", apiKey: claudeKey, pin: "000001" });
    expect(wrongPin.status).toBe(401);
    expect((await serviceClient().from("ai_provider_settings").select("id").eq("id", 1).maybeSingle()).data).toBeNull();

    // A key the provider refuses is not saved, and the refused key is not echoed back.
    const rejected = await call(request, "PUT", SETTINGS, systemAdmin.token, { provider: "anthropic", model: "claude-opus-5-5", apiKey: "reject-this-key-1234567890", pin });
    expect(rejected.status).toBe(400);
    expect(String(rejected.body.error)).toContain("rejected this key");
    expect(rejected.text).not.toContain("reject-this-key");

    const saved = await call(request, "PUT", SETTINGS, systemAdmin.token, { provider: "anthropic", model: "claude-opus-5-5", apiKey: claudeKey, pin });
    expect(saved.status, saved.text).toBe(200);
    expect(saved.text).not.toContain(claudeKey);
    expect(saved.body).toMatchObject({ source: "app", provider: "anthropic", model: "claude-opus-5-5", keyHint: `…${claudeKey.slice(-4)}`, keyReadable: true });
    // The check before saving used Claude's API format with the new key.
    expect(await lastProviderRequest(request)).toMatchObject({ path: "/v1/messages", apiKey: claudeKey, model: "claude-opus-5-5", anthropicVersion: "2023-06-01" });
    expect((await call(request, "GET", SETTINGS, systemAdmin.token)).text).not.toContain(claudeKey);

    const { data: row } = await serviceClient().from("ai_provider_settings").select("*").eq("id", 1).single();
    expect(JSON.stringify(row)).not.toContain(claudeKey);
    expect(Buffer.from(String(row?.key_ciphertext), "base64").toString("latin1")).not.toContain("ClaudeSecretValue");
    expect(String(row?.key_iv).length).toBeGreaterThan(0);
    expect(String(row?.key_tag).length).toBeGreaterThan(0);
  });

  test("AI features use the saved provider, model and key", async ({ request }) => {
    const admin = await sessionFor("admin");
    const systemAdmin = await sessionFor("systemAdmin");
    const explain = () => call(request, "POST", "/api/page-explain", admin.token, { pageType: "process_map", context: "Mold change map" });

    const viaClaude = await explain();
    expect(viaClaude.status, viaClaude.text).toBe(200);
    expect(viaClaude.body.mode).toBe("ai");
    expect(await lastProviderRequest(request)).toMatchObject({ path: "/v1/messages", apiKey: claudeKey, model: "claude-opus-5-5" });

    // Switching to OpenAI with its own key changes where requests go.
    const switched = await call(request, "PUT", SETTINGS, systemAdmin.token, { provider: "openai", model: "gpt-4.1-mini", apiKey: openAiKey, pin });
    expect(switched.status, switched.text).toBe(200);
    expect((await explain()).body.mode).toBe("ai");
    expect(await lastProviderRequest(request)).toMatchObject({ path: "/v1/chat/completions", apiKey: openAiKey, model: "gpt-4.1-mini" });

    // Changing only the model keeps the saved key.
    const modelOnly = await call(request, "PUT", SETTINGS, systemAdmin.token, { provider: "openai", model: "gpt-4.1", apiKey: "", pin });
    expect(modelOnly.status, modelOnly.text).toBe(200);
    await explain();
    expect(await lastProviderRequest(request)).toMatchObject({ apiKey: openAiKey, model: "gpt-4.1" });
  });

  test("viewing the key needs the PIN, is never cached, and every action is recorded permanently", async ({ request }) => {
    const systemAdmin = await sessionFor("systemAdmin");
    const wrong = await call(request, "POST", `${SETTINGS}/reveal`, systemAdmin.token, { pin: "000001" });
    expect(wrong.status).toBe(401);
    expect(wrong.text).not.toContain(openAiKey);

    const shown = await call(request, "POST", `${SETTINGS}/reveal`, systemAdmin.token, { pin });
    expect(shown.status).toBe(200);
    expect(shown.body.apiKey).toBe(openAiKey);
    expect(shown.headers["cache-control"]).toContain("no-store");

    const tested = await call(request, "POST", `${SETTINGS}/test`, systemAdmin.token);
    expect(tested.status, tested.text).toBe(200);
    expect(tested.text).not.toContain(openAiKey);

    const status = await call(request, "GET", SETTINGS, systemAdmin.token);
    const events = status.body.events as Array<{ action: string; actorName: string }>;
    for (const action of ["saved", "model_changed", "revealed", "pin_failed", "tested"]) {
      expect(events.map((event) => event.action), action).toContain(action);
    }
    expect(events[0]).toMatchObject({ action: "tested", actorName: USERS.systemAdmin.name });

    const tamper = await serviceClient().from("ai_settings_audit_events").delete().gt("id", 0);
    expect(tamper.error?.message ?? "").toContain("cannot be changed or deleted");
  });

  test("removing the key needs the PIN and turns AI features off", async ({ request }) => {
    const systemAdmin = await sessionFor("systemAdmin");
    expect((await call(request, "DELETE", SETTINGS, systemAdmin.token, { pin: "000001" })).status).toBe(401);
    const removed = await call(request, "DELETE", SETTINGS, systemAdmin.token, { pin });
    expect(removed.status, removed.text).toBe(200);
    expect(removed.body.source).toBe("none");
    const admin = await sessionFor("admin");
    const explained = await call(request, "POST", "/api/page-explain", admin.token, { pageType: "process_map", context: "Mold change map" });
    expect(explained.body.mode).toBe("rules");
  });

  test("a system admin adds and views the key on the System Administration page; admins don't see it", async ({ browser }) => {
    const uiKey = `sk-ant-e2e-ui-${Date.now()}-PanelSecret`;
    const page = await pageFor(browser, "systemAdmin");
    await page.goto("/admin/users");
    const panel = page.getByRole("region", { name: "AI provider" });
    await panel.getByRole("button", { name: "Add an API key" }).click();
    await expect(panel.getByRole("radio", { name: /^Claude/ })).toBeChecked();
    await panel.getByLabel("API key").fill(uiKey);
    await panel.getByLabel("Your PIN").fill(pin);
    await panel.getByRole("button", { name: "Check and save" }).click();
    await expect(panel.getByRole("status")).toContainText("encrypted and saved");
    await expect(panel.getByText(`•••• ${uiKey.slice(-4)}`)).toBeVisible();
    await expect(panel.getByLabel("API key")).toHaveCount(0);

    await panel.getByRole("button", { name: "View key" }).click();
    await panel.getByLabel("Your PIN").fill(pin);
    await panel.getByRole("button", { name: "Show key" }).click();
    const revealed = panel.getByLabel(/Saved API key/);
    await expect(revealed).toHaveValue(uiKey);
    await panel.getByRole("button", { name: "Hide now" }).click();
    await expect(revealed).toHaveCount(0);

    const adminPage = await pageFor(browser, "admin");
    await adminPage.goto("/admin/users");
    await expect(adminPage.getByText("Only system administrators create and change user accounts.")).toBeVisible();
    await expect(adminPage.getByRole("region", { name: "AI provider" })).toHaveCount(0);
  });
});
