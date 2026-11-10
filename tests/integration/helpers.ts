import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isDevHotReloadError } from "../page-errors";

// Mirrors scripts/tests/integration-seed.mjs, which creates these accounts before the suite starts.
export const USERS = {
  systemAdmin: { employeeId: "900001", pin: "314159", name: "Sam Systems" },
  admin: { employeeId: "900002", pin: "271828", name: "Avery Admin" },
  operator: { employeeId: "900003", pin: "161803", name: "Olive Operator" },
} as const;

export type Role = keyof typeof USERS;

/** A 1×1 PNG used to exercise real storage uploads. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export function uniqueId(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1296).toString(36).toUpperCase()}`;
}

export const INTEGRATION_PASSWORD = "Integration-Test-Passw0rd!";
export const EMAILS: Record<Role, string> = {
  systemAdmin: "e2e.sysadmin@example.test",
  admin: "e2e.admin@example.test",
  operator: "e2e.operator@example.test",
};

export function anonClient(): SupabaseClient {
  const url = process.env.INTEGRATION_SUPABASE_URL;
  const key = process.env.INTEGRATION_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("INTEGRATION_SUPABASE_URL and INTEGRATION_SUPABASE_ANON_KEY are required.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** A signed-in REST client and bearer token for a seeded role. */
export async function sessionFor(role: Role) {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email: EMAILS[role], password: INTEGRATION_PASSWORD });
  if (error || !data.session) throw error ?? new Error(`No session for ${role}`);
  return { client, token: data.session.access_token, userId: data.user.id };
}

/** Creates a disposable account directly (bypassing the API under test) and returns its id. */
export async function createDisposableUser(role: "user" | "admin" | "system_admin", pin: string) {
  const admin = serviceClient();
  const employeeId = String(800000 + Math.floor(Math.random() * 99999));
  const email = `e2e.disposable.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: INTEGRATION_PASSWORD, email_confirm: true, user_metadata: { full_name: "Disposable Tester" } });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  await expect.poll(async () => (await admin.from("profiles").select("id").eq("id", data.user.id).maybeSingle()).data?.id).toBe(data.user.id);
  const { error: profileError } = await admin.from("profiles").update({ role, employee_id: employeeId, full_name: "Disposable Tester" }).eq("id", data.user.id);
  if (profileError) throw profileError;
  const { error: pinError } = await admin.rpc("set_user_pin", { target_user_id: data.user.id, new_pin: pin });
  if (pinError) throw pinError;
  return { id: data.user.id, email, employeeId };
}

/**
 * Creates an instruction through the real save function and releases it through the real approval
 * API, so a test does not depend on data left behind by earlier runs.
 */
export async function createReleasedInstruction(request: APIRequestContext, options: { department: string; title: string }) {
  const author = await sessionFor("admin");
  const approver = await sessionFor("systemAdmin");
  const { data: department, error: departmentError } = await author.client.from("departments").select("id").eq("name", options.department).single();
  if (departmentError || !department) throw departmentError ?? new Error(`No ${options.department} department`);
  const partId = uniqueId("REL");
  const { data, error } = await author.client.rpc("save_work_instruction_controlled", {
    p_payload: {
      mode: "create", departmentId: department.id, partId, itemTitle: options.title, revision: 1,
      bodyMarkdown: "1. Follow the released steps.", processScope: "Production cells",
      acceptanceCriteria: "Meets the released drawing.", verificationRecords: "Traveler sign-off.",
      isoClauseRefs: ["7.5 Documented information"], suggestedToolIds: [], changeSummary: "Initial release.",
    },
  });
  if (error) throw error;
  const instructionId = (data as { instructionId: string }).instructionId;
  const { data: saved, error: readError } = await serviceClient().from("work_instructions").select("updated_at").eq("id", instructionId).single();
  if (readError || !saved) throw readError ?? new Error("Saved instruction not found");
  const response = await request.patch(`/api/instructions/${instructionId}/approval`, {
    headers: { Authorization: `Bearer ${approver.token}` },
    data: { status: "approved", note: "Released for integration tests", expectedUpdatedAt: saved.updated_at },
  });
  expect(response.status(), await response.text()).toBe(200);
  return { instructionId, partId };
}

export function serviceClient(): SupabaseClient {
  const url = process.env.INTEGRATION_SUPABASE_URL;
  const key = process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("INTEGRATION_SUPABASE_URL and INTEGRATION_SUPABASE_SERVICE_ROLE_KEY are required.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function signIn(page: Page, role: Role) {
  const user = USERS[role];
  await page.goto("/login");
  await page.getByLabel("Employee ID").first().fill(user.employeeId);
  await page.getByLabel("6-Digit PIN").first().fill(user.pin);
  await page.getByRole("button", { name: /Login with PIN/ }).click();
  await page.waitForURL(/\/(dashboard|instructions|account)/, { timeout: 120_000 });
}

const openRoleContexts = new Set<BrowserContext>();

/** Each role gets its own browser context so sessions never leak between steps. */
export async function pageFor(browser: Browser, role: Role) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  openRoleContexts.add(context);
  const page = await context.newPage();
  await signIn(page, role);
  return page;
}

/** Register with `test.afterEach(closeRoleContexts)` in specs that call pageFor. */
export async function closeRoleContexts() {
  await Promise.all([...openRoleContexts].map((context) => context.close().catch(() => undefined)));
  openRoleContexts.clear();
}

export function captureRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => { if (!isDevHotReloadError(error)) errors.push(error.message); });
  return errors;
}

/** The homepage is server-rendered; interact only once it has hydrated. */
export async function waitForDashboard(page: Page) {
  await expect(page.locator('section[aria-label="Find work instructions"][data-hydrated="true"]')).toBeVisible({ timeout: 60_000 });
}

export async function searchDashboard(page: Page, query: string) {
  await page.goto("/dashboard");
  await waitForDashboard(page);
  const search = page.getByRole("searchbox", { name: "Search for anything" });
  await search.fill(query);
  return search;
}

export async function openActionMenu(page: Page) {
  await page.getByRole("button", { name: "Open instruction action menu" }).click();
}
