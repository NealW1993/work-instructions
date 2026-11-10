import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  anonClient,
  closeRoleContexts,
  createDisposableUser,
  pageFor,
  serviceClient,
  sessionFor,
  signIn,
  TINY_PNG,
  uniqueId,
} from "./helpers";

test.afterEach(closeRoleContexts);

// Each test uses its own client address so the per-device sign-in limiter does not leak between runs.
const address = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function api(request: APIRequestContext, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, token: string | null, data?: unknown) {
  const response = await request.fetch(path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", "x-forwarded-for": address() },
    data: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status(), body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

async function pinLogin(request: APIRequestContext, employeeId: string, pin: string, ip: string) {
  const response = await request.post("/api/auth/pin-login", {
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    data: JSON.stringify({ employeeId, pin }),
  });
  return {
    status: response.status(),
    body: await response.json().catch(() => ({})) as Record<string, unknown>,
    retryAfter: response.headers()["retry-after"],
  };
}

test.describe("sign-in and PIN security", () => {
  test("ten wrong PINs lock the employee ID for a minute, even for the right PIN, and a system admin's reset clears it", async ({ request }) => {
    const user = await createDisposableUser("user", "482916");
    const ip = address();
    try {
      expect((await pinLogin(request, user.employeeId, "482916", ip)).status).toBe(200);
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        const failed = await pinLogin(request, user.employeeId, "000001", ip);
        expect(failed.status, `attempt ${attempt}`).toBe(401);
        expect(failed.body.error).toBe("Invalid credentials.");
      }
      const locked = await pinLogin(request, user.employeeId, "482916", ip);
      expect(locked.status).toBe(429);
      expect(String(locked.body.error)).toContain("Too many failed sign-in attempts. Try again in a minute");
      expect(locked.retryAfter).toBe("60");

      const systemAdmin = await sessionFor("systemAdmin");
      const reset = await api(request, "PATCH", `/api/users/${user.id}/pin`, systemAdmin.token, { pin: "593017" });
      expect(reset.status).toBe(200);
      expect((await pinLogin(request, user.employeeId, "593017", ip)).status).toBe(200);
    } finally {
      await serviceClient().auth.admin.deleteUser(user.id);
    }
  });

  test("unknown employee IDs fail exactly like wrong PINs", async ({ request }) => {
    const result = await pinLogin(request, "799999", "482916", address());
    expect(result.status).toBe(401);
    expect(result.body.error).toBe("Invalid credentials.");
  });

  test("one device trying many employee IDs is paused for a minute after 20 failures", async ({ request }) => {
    const ip = address();
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const failed = await pinLogin(request, String(780000 + attempt), "482916", ip);
      expect(failed.status, `attempt ${attempt}`).toBe(401);
    }
    const paused = await pinLogin(request, "780099", "482916", ip);
    expect(paused.status).toBe(429);
    expect(String(paused.body.error)).toContain("Wait a minute");
    expect(paused.retryAfter).toBe("60");
    // Other devices are unaffected.
    expect((await pinLogin(request, "780099", "482916", address())).status).toBe(401);
  });

  test("browsers cannot verify PINs, read PIN hashes, or rewrite profiles and formulas directly", async () => {
    const anonymous = anonClient();
    const anonymousPin = await anonymous.rpc("verify_pin_login", { login_identifier: "900001", submitted_pin: "314159" });
    expect(anonymousPin.data).toBeNull();
    expect(anonymousPin.error?.message).toContain("permission denied");

    const operator = await sessionFor("operator");
    const pinCheck = await operator.client.rpc("verify_pin_login", { login_identifier: "900001", submitted_pin: "314159" });
    expect(pinCheck.error?.message).toContain("permission denied");
    const hashes = await operator.client.from("user_security").select("*");
    expect(hashes.data ?? []).toHaveLength(0);
    for (const change of [{ role: "system_admin" }, { is_active: false }, { employee_id: "900001" }, { email: "takeover@example.test" }, { inactivity_timeout_minutes: 10080 }]) {
      const attempt = await operator.client.from("profiles").update(change).eq("id", operator.userId).select("id");
      expect(attempt.error?.message, JSON.stringify(change)).toContain("permission denied");
    }
    const selfApproved = await operator.client.from("process_map_formulas").insert({
      owner_user_id: operator.userId, name: "Self-approved", formula_type: "custom",
      payload: { customFormula: { approvalStatus: "approved" } },
    });
    expect(selfApproved.error?.message).toContain("permission denied");
    const setOther = await operator.client.rpc("set_user_pin", { target_user_id: operator.userId, new_pin: "593017" });
    expect(setOther.error?.message).toContain("permission denied");
  });

  test("changing your own PIN requires the current PIN and rejects guessable PINs", async ({ page, request }) => {
    const user = await createDisposableUser("user", "482916");
    try {
      await page.goto("/login");
      await page.getByLabel("Employee ID").first().fill(user.employeeId);
      await page.getByLabel("6-Digit PIN").first().fill("482916");
      await page.getByRole("button", { name: /Login with PIN/ }).click();
      await page.waitForURL(/\/dashboard/, { timeout: 120_000 });
      await page.goto("/account");
      await page.getByRole("button", { name: "Change PIN" }).click();
      const save = page.getByRole("button", { name: /^Save/ }).first();
      await page.getByLabel("Current PIN").fill("111111");
      await page.getByLabel("New 6-Digit PIN").fill("123456");
      await page.getByLabel("Confirm New PIN").fill("123456");
      await save.click();
      await expect(page.getByText("Choose a PIN that is harder to guess").first()).toBeVisible();
      await page.getByLabel("New 6-Digit PIN").fill("730518");
      await page.getByLabel("Confirm New PIN").fill("730518");
      await save.click();
      await expect(page.getByText("Your current PIN is incorrect.").first()).toBeVisible();
      await page.getByLabel("Current PIN").fill("482916");
      await save.click();
      await expect(page.getByText("PIN updated.").first()).toBeVisible();
      const ip = address();
      expect((await pinLogin(request, user.employeeId, "482916", ip)).status).toBe(401);
      expect((await pinLogin(request, user.employeeId, "730518", ip)).status).toBe(200);
    } finally {
      await serviceClient().auth.admin.deleteUser(user.id);
    }
  });
});

test.describe("self-registration", () => {
  test("creates an operator account only, ignores a requested role, and rejects weak PINs and duplicate employee IDs", async ({ request }) => {
    const email = `e2e.register.${Date.now()}@example.test`;
    const employeeId = String(700000 + Math.floor(Math.random() * 99999));
    const post = (data: Record<string, unknown>) => request.post("/api/auth/register", { headers: { "Content-Type": "application/json", "x-forwarded-for": address() }, data: JSON.stringify(data) });
    const weak = await post({ fullName: "Reggie Register", email, employeeId, pin: "123456" });
    expect(weak.status()).toBe(400);
    const created = await post({ fullName: "Reggie Register", email, employeeId, pin: "604917", role: "system_admin" });
    expect(created.status()).toBe(200);
    const admin = serviceClient();
    const { data: profile } = await admin.from("profiles").select("id, role, employee_id").eq("email", email).single();
    try {
      expect(profile?.role).toBe("user");
      expect(profile?.employee_id).toBe(employeeId);
      const duplicate = await post({ fullName: "Copy Cat", email: `copy.${email}`, employeeId, pin: "604917" });
      expect(duplicate.status()).toBe(409);
    } finally {
      if (profile?.id) await admin.auth.admin.deleteUser(profile.id);
    }
  });
});

test.describe("role permissions", () => {
  test("operators cannot reach administration pages or APIs", async ({ page, request }) => {
    await signIn(page, "operator");
    for (const path of ["/admin/users", "/admin/kpis", "/admin/export", "/instructions/archived"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/dashboard$/);
    }
    const operator = await sessionFor("operator");
    for (const [method, path, data] of [
      ["GET", "/api/users", undefined],
      ["POST", "/api/users", { fullName: "X", email: "x@example.test", employeeId: "123", pin: "604917", role: "user" }],
      ["PATCH", `/api/users/${operator.userId}/role`, { role: "system_admin" }],
      ["PATCH", `/api/users/${operator.userId}/pin`, { pin: "604917" }],
      ["PATCH", `/api/users/${operator.userId}/status`, { isActive: true }],
      ["GET", "/api/kpis/system-usage", undefined],
      ["POST", "/api/admin/export-data", { format: "csv", datasets: ["profiles"] }],
      ["PATCH", "/api/instruction-review/settings", { reviewWindowDays: 1 }],
    ] as const) {
      const result = await api(request, method, path, operator.token, data);
      expect(result.status, `${method} ${path}`).toBe(403);
    }
    expect((await api(request, "GET", "/api/users", null)).status).toBe(401);
  });

  test("only system admins manage accounts; admins cannot list, create or change any account", async ({ request }) => {
    const admin = await sessionFor("admin");
    const systemAdmin = await sessionFor("systemAdmin");
    const operator = await sessionFor("operator");

    expect((await api(request, "GET", "/api/users", admin.token)).status).toBe(403);
    for (const role of ["user", "admin", "system_admin"]) {
      const denied = await api(request, "POST", "/api/users", admin.token, { fullName: "Not Allowed", email: `denied.${role}.${Date.now()}@example.test`, employeeId: String(600000 + Math.floor(Math.random() * 9999)), pin: "604917", role });
      expect(denied.status, `create ${role}`).toBe(403);
    }
    for (const [label, targetId] of [["operator", operator.userId], ["own", admin.userId], ["system admin", systemAdmin.userId]] as const) {
      for (const [method, path, data] of [
        ["PATCH", `/api/users/${targetId}/role`, { role: "system_admin" }],
        ["PATCH", `/api/users/${targetId}/pin`, { pin: "604917" }],
        ["PATCH", `/api/users/${targetId}/employee-id`, { employeeId: "123" }],
        ["PATCH", `/api/users/${targetId}/inactivity-timeout`, { inactivityTimeoutMinutes: 30 }],
        ["PATCH", `/api/users/${targetId}/status`, { isActive: false }],
        ["DELETE", `/api/users/${targetId}`, undefined],
      ] as const) {
        expect((await api(request, method, path, admin.token, data)).status, `${method} ${path} (${label} account)`).toBe(403);
      }
    }

    // A system admin can do all of it.
    const operatorEmail = `e2e.onboard.${Date.now()}@example.test`;
    const operatorEmployeeId = String(500000 + Math.floor(Math.random() * 99999));
    const created = await api(request, "POST", "/api/users", systemAdmin.token, { fullName: "Onboarded Operator", email: operatorEmail, employeeId: operatorEmployeeId, pin: "604917", role: "user" });
    expect(created.status).toBe(200);
    const newUserId = (created.body.user as { id: string }).id;
    try {
      expect((await api(request, "GET", "/api/users", systemAdmin.token)).status).toBe(200);
      expect((await api(request, "PATCH", `/api/users/${newUserId}/pin`, systemAdmin.token, { pin: "111111" })).status).toBe(400);
      expect((await api(request, "PATCH", `/api/users/${newUserId}/pin`, systemAdmin.token, { pin: "715204" })).status).toBe(200);
      expect((await api(request, "PATCH", `/api/users/${newUserId}/role`, systemAdmin.token, { role: "admin" })).status).toBe(200);
      expect((await api(request, "PATCH", `/api/users/${newUserId}/role`, systemAdmin.token, { role: "user" })).status).toBe(200);
      expect((await api(request, "PATCH", `/api/users/${newUserId}/inactivity-timeout`, systemAdmin.token, { inactivityTimeoutMinutes: 30 })).status).toBe(200);

      expect((await api(request, "PATCH", `/api/users/${newUserId}/status`, systemAdmin.token, { isActive: false })).status).toBe(200);
      const ip = address();
      expect((await pinLogin(request, operatorEmployeeId, "715204", ip)).status).toBe(401);
      expect((await api(request, "PATCH", `/api/users/${newUserId}/status`, systemAdmin.token, { isActive: true })).status).toBe(200);
      expect((await pinLogin(request, operatorEmployeeId, "715204", ip)).status).toBe(200);
      expect((await api(request, "DELETE", `/api/users/${newUserId}`, systemAdmin.token)).status).toBe(200);
    } finally {
      await serviceClient().auth.admin.deleteUser(newUserId).catch(() => undefined);
    }
  });

  test("admins keep the administration page for departments, but only system admins see user management", async ({ browser }) => {
    const adminPage = await pageFor(browser, "admin");
    await adminPage.goto("/admin/users");
    await expect(adminPage.getByText("Only system administrators create and change user accounts.")).toBeVisible();
    await expect(adminPage.getByRole("button", { name: "User Management" })).toHaveCount(0);

    const systemAdminPage = await pageFor(browser, "systemAdmin");
    await systemAdminPage.goto("/admin/users");
    // The section starts collapsed; a click before hydration is lost, so retry until it opens.
    const toggle = systemAdminPage.getByRole("button", { name: "User Management" });
    await expect(async () => {
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await expect(systemAdminPage.getByRole("heading", { name: "Create User" })).toBeVisible();
    await expect(systemAdminPage.getByText("Only system administrators create and change user accounts.")).toHaveCount(0);
  });

  test("a deactivated user with an open session is signed out instead of looping between pages", async ({ page }) => {
    const user = await createDisposableUser("user", "482916");
    try {
      await page.goto("/login");
      await page.getByLabel("Employee ID").first().fill(user.employeeId);
      await page.getByLabel("6-Digit PIN").first().fill("482916");
      await page.getByRole("button", { name: /Login with PIN/ }).click();
      await page.waitForURL(/\/dashboard/, { timeout: 120_000 });
      await serviceClient().from("profiles").update({ is_active: false }).eq("id", user.id);
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByRole("alert").filter({ hasText: "This account is not active." }).first()).toBeVisible();
    } finally {
      await serviceClient().auth.admin.deleteUser(user.id);
    }
  });
});

test.describe("features that were rejecting every request", () => {
  test("importing a work instruction stores the retained source file, which can be downloaded", async ({ page, request }) => {
    const admin = await sessionFor("admin");
    const { data: department } = await serviceClient().from("departments").select("id").eq("name", "Quality").single();
    const partId = uniqueId("IMP");
    const imported = await api(request, "POST", "/api/instructions/import", admin.token, {
      departmentId: department!.id, partId, itemTitle: "Imported gauge procedure", revision: 1,
      fileName: "gauge.png", contentType: "image/png", contentBase64: TINY_PNG.toString("base64"), fileSize: TINY_PNG.length,
    });
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);
    const fileId = String(imported.body.fileId);
    await signIn(page, "admin");
    const download = await page.request.get(`/api/instructions/import-files/${fileId}`);
    expect(download.status()).toBe(200);
    expect(Buffer.from(await download.body()).equals(TINY_PNG)).toBe(true);
  });

  test("system admins can assign members to an access group, and submission notifications are accepted", async ({ request }) => {
    const systemAdmin = await sessionFor("systemAdmin");
    const operator = await sessionFor("operator");
    const group = await api(request, "POST", "/api/groups", systemAdmin.token, { name: uniqueId("Line crew"), description: "Integration test group" });
    expect(group.status, JSON.stringify(group.body)).toBe(200);
    const assigned = await api(request, "POST", `/api/groups/${group.body.groupId}/members`, systemAdmin.token, { userId: operator.userId });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);

    const { data: instruction } = await serviceClient().from("work_instructions").select("id").eq("created_by", (await sessionFor("admin")).userId).limit(1).single();
    const notified = await api(request, "POST", "/api/notifications/work-instruction-submitted", (await sessionFor("admin")).token, { instructionId: instruction!.id });
    expect(notified.status, JSON.stringify(notified.body)).toBe(200);
  });
});
