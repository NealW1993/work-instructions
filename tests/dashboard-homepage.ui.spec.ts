import { expect, test, type APIRequestContext, type Page, type Route } from "@playwright/test";
import { isDevHotReloadError } from "./page-errors";
import { DASHBOARD_LAYOUT_PRESETS, getDefaultDashboardLayout, type DashboardWidgetLayoutItem } from "../src/lib/dashboard-layout";

const userId = "a1000000-0000-0000-0000-000000000001";
const stamp = "2026-11-01T12:00:00Z";
const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", aud: "authenticated", exp: 2_000_000_000 })).toString("base64url")}.fixture-signature`;
const session = { access_token: token, refresh_token: "fixture-refresh", expires_in: 3600, expires_at: 2_000_000_000, token_type: "bearer", user: { id: userId, aud: "authenticated", role: "authenticated", email: "reviewer@example.invalid", created_at: stamp, app_metadata: { provider: "email" }, user_metadata: { full_name: "Quality Reviewer" } } };
const headers = { Authorization: "Bearer fixture-session-token" };
const endpoint = "/api/dashboard/layout";
const errors = new WeakMap<Page, string[]>();
const studio = (page: Page) => page.locator('[data-dashboard-layout-studio="true"]');
const widgets = (page: Page) => page.locator("[data-dashboard-widget-id]");
const arranged = (page: Page) => studio(page).locator("[data-studio-widget-id]");
// The search console is always shown above the grid, so it is never a grid or studio widget.
const visibleIds = (layout: DashboardWidgetLayoutItem[]) => layout.filter((widget) => widget.visible && widget.id !== "finder").map((widget) => widget.id);

async function fixture(request: APIRequestContext, settings: unknown) {
  expect((await request.post("http://127.0.0.1:3900/__fixture/dashboard", { data: settings })).ok()).toBe(true);
}

async function remoteLayout(request: APIRequestContext) {
  const response = await request.get(endpoint, { headers });
  expect(response.status()).toBe(200);
  return await response.json() as { dashboardLayout: DashboardWidgetLayoutItem[]; dashboardDefaultLayout: DashboardWidgetLayoutItem[]; layoutVersion: string };
}

async function ids(page: Page, inStudio = false) {
  return (inStudio ? arranged(page) : widgets(page)).evaluateAll((elements, attribute) => elements.map((element) => element.getAttribute(attribute)), inStudio ? "data-studio-widget-id" : "data-dashboard-widget-id");
}

async function visit(page: Page) {
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: /^(Good (morning|afternoon|evening)|Welcome), Quality$/ })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search for anything" })).toBeVisible();
  // The heading is server-rendered; wait for hydration before using interactive controls.
  await expect(page.locator('section[aria-label="Find work instructions"][data-hydrated="true"]')).toBeVisible({ timeout: 30_000 });
}

async function openStudio(page: Page) {
  // Also called right after reloads, so wait for hydration before using the button.
  await expect(page.locator('section[aria-label="Find work instructions"][data-hydrated="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Customize homepage", exact: true }).click();
  await expect(studio(page)).toBeVisible();
  await expect(studio(page)).toHaveAttribute("aria-busy", "false");
}

async function choosePreset(page: Page, label: string) {
  const button = studio(page).getByRole("button", { name: `Use ${label} layout`, exact: true });
  if (!(await button.isVisible())) await studio(page).locator("summary").filter({ hasText: "Start with a layout" }).click();
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

test.beforeEach(async ({ page, request, context }) => {
  await fixture(request, { reset: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await context.addCookies([{ name: "work-instructions-auth-token", value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`, url: "http://127.0.0.1:3100", sameSite: "Lax" }]);
  const observed: string[] = [];
  errors.set(page, observed);
  page.on("pageerror", (error) => { if (!isDevHotReloadError(error)) observed.push(error.message); });
});

test.afterEach(async ({ page, request }) => {
  if (!page.isClosed()) await page.close();
  await fixture(request, { reset: true });
  expect(errors.get(page) ?? []).toEqual([]);
});

test("widget search, categories, availability, add/remove, Undo and Redo stay synchronized", async ({ page }) => {
  await visit(page);
  await openStudio(page);
  const library = studio(page).getByRole("region", { name: "Widget library", exact: true });
  await library.getByRole("searchbox", { name: "Search widgets", exact: true }).fill("Formula Library");
  await expect(library.getByRole("article")).toHaveCount(1);
  const categories = library.getByRole("group", { name: "Widget category", exact: true });
  await categories.getByRole("button", { name: /^Insights/ }).click();
  await expect(categories.getByRole("button", { name: /^Insights/ })).toHaveAttribute("aria-pressed", "true");
  await expect(categories.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "false");
  await expect(library.getByText("No widgets match these filters", { exact: true })).toBeVisible();
  await library.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(categories.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
  await library.getByRole("searchbox", { name: "Search widgets", exact: true }).fill("Formula Library");
  await library.getByRole("combobox", { name: "Widget availability", exact: true }).selectOption("available");
  await library.getByRole("button", { name: "Add Formula Library", exact: true }).click();
  await expect(page.locator('[data-dashboard-widget-id="formula_library"]')).toHaveCount(1);
  await expect(library.getByText("No widgets match these filters", { exact: true })).toBeVisible();
  await library.getByRole("combobox", { name: "Widget availability", exact: true }).selectOption("all");
  await library.getByRole("button", { name: "Remove Formula Library", exact: true }).click();
  await expect(page.locator('[data-dashboard-widget-id="formula_library"]')).toHaveCount(0);
  await studio(page).getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator('[data-dashboard-widget-id="formula_library"]')).toHaveCount(1);
  await expect(library.getByRole("button", { name: "Remove Formula Library", exact: true })).toBeVisible();
  await studio(page).getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator('[data-dashboard-widget-id="formula_library"]')).toHaveCount(0);
  await expect(library.getByRole("button", { name: "Add Formula Library", exact: true })).toBeVisible();
});

test("keyboard order and width controls update the preview, while Reset and Cancel preserve saved data", async ({ page, request }) => {
  await visit(page);
  const before = await remoteLayout(request);
  await openStudio(page);
  const move = studio(page).getByRole("button", { name: "Move Pinned instructions to top", exact: true });
  await move.focus();
  await move.press("Enter");
  await expect(arranged(page).first()).toHaveAttribute("data-studio-widget-id", "pinned");
  await expect(widgets(page).first()).toHaveAttribute("data-dashboard-widget-id", "pinned");
  const width = studio(page).getByRole("combobox", { name: "Width of Pinned instructions", exact: true });
  const originalSize = before.dashboardLayout.find((widget) => widget.id === "pinned")!.size;
  await width.selectOption("full");
  await expect(width).toHaveValue("full");
  await expect.poll(async () => {
    const card = await page.locator('[data-dashboard-widget-id="pinned"]').boundingBox();
    const grid = await page.locator('[aria-label="Homepage widgets"]').boundingBox();
    return card!.width / grid!.width;
  }).toBeGreaterThan(0.95);
  await studio(page).getByRole("button", { name: "Undo", exact: true }).click();
  await expect(width).toHaveValue(originalSize);
  await studio(page).getByRole("button", { name: "Redo", exact: true }).click();
  await expect(width).toHaveValue("full");
  await choosePreset(page, "Audit Review");
  await studio(page).getByRole("button", { name: "Reset layout", exact: true }).click();
  await expect.poll(() => ids(page, true)).toEqual(visibleIds(getDefaultDashboardLayout()));
  expect((await remoteLayout(request)).layoutVersion).toBe(before.layoutVersion);
  await studio(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(studio(page)).toHaveCount(0);
  await expect.poll(() => ids(page)).toEqual(visibleIds(before.dashboardLayout));
  expect((await remoteLayout(request)).layoutVersion).toBe(before.layoutVersion);
});

test("presets, saved personal defaults, loading a default, and reload use the same persisted layout", async ({ page, request }) => {
  const compact = DASHBOARD_LAYOUT_PRESETS.find((preset) => preset.id === "compact_grid")!.layout;
  const audit = DASHBOARD_LAYOUT_PRESETS.find((preset) => preset.id === "audit_review")!.layout;
  await visit(page);
  await openStudio(page);
  await choosePreset(page, "Compact Grid");
  await studio(page).getByRole("button", { name: "Save as my default", exact: true }).click();
  await expect(studio(page)).toHaveCount(0);
  expect((await remoteLayout(request)).dashboardDefaultLayout).toEqual(compact);
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => ids(page)).toEqual(visibleIds(compact));
  await openStudio(page);
  await choosePreset(page, "Audit Review");
  await studio(page).getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(studio(page)).toHaveCount(0);
  const changed = await remoteLayout(request);
  expect(changed.dashboardLayout).toEqual(audit);
  expect(changed.dashboardDefaultLayout).toEqual(compact);
  await openStudio(page);
  await studio(page).getByRole("button", { name: "Load my default", exact: true }).click();
  await expect.poll(() => ids(page, true)).toEqual(visibleIds(compact));
  expect((await remoteLayout(request)).dashboardLayout).toEqual(audit);
  await studio(page).getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(studio(page)).toHaveCount(0);
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => ids(page)).toEqual(visibleIds(compact));
  expect((await remoteLayout(request)).dashboardDefaultLayout).toEqual(compact);
});

test("a server save failure keeps the draft editable and a successful retry survives reload", async ({ page, request }) => {
  await visit(page);
  const before = await remoteLayout(request);
  await openStudio(page);
  await studio(page).getByRole("button", { name: "Remove Pinned instructions from layout", exact: true }).click();
  const draft = await ids(page, true);
  await fixture(request, { failWrites: true });
  await studio(page).getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(studio(page).getByRole("alert")).toContainText("Fixture profile write failed");
  await expect(studio(page).getByRole("button", { name: "Save layout", exact: true })).toBeEnabled();
  expect(await ids(page, true)).toEqual(draft);
  expect((await remoteLayout(request)).layoutVersion).toBe(before.layoutVersion);
  await fixture(request, { failWrites: false });
  await studio(page).getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(studio(page)).toHaveCount(0);
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => ids(page)).toEqual(draft);
});

test("a real stale-version response preserves the draft and reopening loads the other device's saved layout", async ({ page, request }) => {
  await visit(page);
  await openStudio(page);
  await studio(page).getByRole("button", { name: "Remove Pinned instructions from layout", exact: true }).click();
  const draft = await ids(page, true);
  const remote = await remoteLayout(request);
  const otherDevice = getDefaultDashboardLayout().map((widget) => ({ ...widget, visible: widget.id === "newest" }));
  const saved = await request.patch(endpoint, { headers, data: { dashboardLayout: otherDevice, expectedLayoutVersion: remote.layoutVersion } });
  expect(saved.status()).toBe(200);
  await studio(page).getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(studio(page).getByRole("alert")).toContainText("Your draft is preserved");
  expect(await ids(page, true)).toEqual(draft);
  expect((await remoteLayout(request)).dashboardLayout).toEqual(otherDevice);
  await studio(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await openStudio(page);
  await expect.poll(() => ids(page, true)).toEqual(["newest"]);
  await expect.poll(() => ids(page)).toEqual(["newest"]);
});

test("a homepage editor load deadline restores its retry action without enabling stale editing", async ({ page }) => {
  await visit(page);
  await page.clock.install();
  let held: Route | undefined;
  const handler = async (route: Route) => { if (route.request().method() === "GET") held = route; else await route.continue(); };
  await page.route("**/api/dashboard/layout", handler);
  await page.getByRole("button", { name: "Customize homepage", exact: true }).click();
  await expect.poll(() => Boolean(held)).toBe(true);
  await page.clock.fastForward(20_100);
  await expect(page.getByRole("alert").filter({ hasText: /timed out/i })).toBeVisible();
  await expect(studio(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry loading editor", exact: true })).toBeEnabled();
  await held!.abort().catch(() => undefined);
  await page.unroute("**/api/dashboard/layout", handler);
  await page.getByRole("button", { name: "Retry loading editor", exact: true }).click();
  await expect(studio(page)).toBeVisible();
});

test("an unconfirmed save deadline preserves the draft and allows checking the saved setup", async ({ page, request }) => {
  await visit(page);
  await openStudio(page);
  await studio(page).getByRole("button", { name: "Remove Pinned instructions from layout", exact: true }).click();
  const draft = await ids(page, true);
  const before = await remoteLayout(request);
  await page.clock.install();
  let held: Route | undefined;
  const handler = async (route: Route) => { if (route.request().method() === "PATCH") held = route; else await route.continue(); };
  await page.route("**/api/dashboard/layout", handler);
  await studio(page).getByRole("button", { name: "Save layout", exact: true }).click();
  await expect.poll(() => Boolean(held)).toBe(true);
  await page.clock.fastForward(30_100);
  await expect(studio(page).getByRole("alert")).toContainText("did not confirm the save in time");
  await expect(studio(page).getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
  expect(await ids(page, true)).toEqual(draft);
  expect((await remoteLayout(request)).layoutVersion).toBe(before.layoutVersion);
  await held!.abort().catch(() => undefined);
  await page.unroute("**/api/dashboard/layout", handler);
  await studio(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await openStudio(page);
  await expect.poll(() => ids(page, true)).toEqual(visibleIds(before.dashboardLayout));
});

test("an explicitly empty homepage offers setup and saves the first selected widget", async ({ page, request }) => {
  const hidden = getDefaultDashboardLayout().map((widget) => ({ ...widget, visible: false }));
  expect((await request.patch(endpoint, { headers, data: { dashboardLayout: hidden } })).status()).toBe(200);
  await visit(page);
  await expect(page.getByRole("heading", { name: "Make this homepage yours", exact: true })).toBeVisible();
  await expect(widgets(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Choose widgets", exact: true }).click();
  await expect(studio(page)).toBeVisible();
  await studio(page).getByRole("button", { name: "Add Pinned instructions", exact: true }).click();
  await studio(page).getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(studio(page)).toHaveCount(0);
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => ids(page)).toEqual(["pinned"]);
});

test("dirty navigation keeps the draft on cancel and completes the requested link after confirmation", async ({ page }) => {
  await visit(page);
  await openStudio(page);
  await studio(page).getByRole("button", { name: "Remove Pinned instructions from layout", exact: true }).click();
  const draft = await ids(page, true);
  await page.getByRole("navigation", { name: "Quick actions" }).getByRole("link", { name: /^Document center/ }).click();
  const dialog = page.getByRole("dialog", { name: "Discard unsaved homepage changes?", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(await ids(page, true)).toEqual(draft);
  await page.getByRole("navigation", { name: "Quick actions" }).getByRole("link", { name: /^Document center/ }).click();
  await dialog.getByRole("button", { name: "Discard and leave", exact: true }).click();
  await expect(page).toHaveURL(/\/doc-center$/);
  await expect(page.getByRole("heading", { name: "Doc Center", exact: true })).toBeVisible();
});

for (const viewport of [{ width: 1920, height: 1080 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
  test(`homepage editor fits light and dark screens at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await visit(page);
    await openStudio(page);
    for (const dark of [false, true]) {
      await page.evaluate((enabled) => document.documentElement.classList.toggle("dark", enabled), dark);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      const clipped = await studio(page).locator("button, input, select, textarea").evaluateAll((elements) => elements.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 2 && rect.height > 2 && (rect.left < -1 || rect.right > window.innerWidth + 1);
      }).map((element) => element.getAttribute("aria-label") || element.textContent?.trim()));
      expect(clipped).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`homepage-editor-${viewport.width}-${dark ? "dark" : "light"}.png`), fullPage: true });
    }
  });
}
