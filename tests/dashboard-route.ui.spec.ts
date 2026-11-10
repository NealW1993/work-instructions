import { expect, test, type APIRequestContext } from "@playwright/test";
import { getDefaultDashboardLayout, type DashboardWidgetId, type DashboardWidgetLayoutItem } from "../src/lib/dashboard-layout";

const endpoint = "/api/dashboard/layout";
const fixtureEndpoint = "http://127.0.0.1:3900/__fixture/dashboard";
const headers = { Authorization: "Bearer fixture-session-token" };

interface LayoutResponse {
  dashboardLayout: DashboardWidgetLayoutItem[];
  dashboardDefaultLayout: DashboardWidgetLayoutItem[];
  layoutVersion: string;
  updatedAt: string;
}

function focusedLayout(id: DashboardWidgetId) {
  const layout = getDefaultDashboardLayout().map((widget) => ({ ...widget, visible: widget.id === id }));
  return [...layout.filter((widget) => widget.id === id), ...layout.filter((widget) => widget.id !== id)];
}

async function fixture(request: APIRequestContext, settings: unknown) {
  const response = await request.post(fixtureEndpoint, { data: settings });
  expect(response.ok(), "The isolated dashboard fixture must accept its test controls").toBe(true);
}

async function readLayout(request: APIRequestContext): Promise<LayoutResponse> {
  const response = await request.get(endpoint, { headers });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const payload = await response.json() as LayoutResponse;
  expect(payload.layoutVersion).toMatch(/^[a-f0-9]{64}$/);
  expect(typeof payload.updatedAt).toBe("string");
  expect(Number.isFinite(Date.parse(payload.updatedAt))).toBe(true);
  return payload;
}

test.beforeEach(async ({ request }) => { await fixture(request, { reset: true }); });
test.afterEach(async ({ request }) => { await fixture(request, { reset: true }); });

test("homepage layout routes require authentication for reads and writes", async ({ request }) => {
  expect((await request.get(endpoint)).status()).toBe(401);
  const response = await request.patch(endpoint, { data: { dashboardLayout: focusedLayout("finder") } });
  expect(response.status()).toBe(401);
  expect((await readLayout(request)).dashboardLayout).toEqual(getDefaultDashboardLayout());
});

test("malformed homepage requests return 400 and preserve the previously saved setup", async ({ request }) => {
  const before = await readLayout(request);
  const widget = { id: "finder", visible: true, size: "full" };
  for (const data of [
    null, [], {}, { dashboardLayout: null },
    { dashboardLayout: [widget, widget] },
    { dashboardLayout: [{ ...widget, visible: "false" }] },
    { dashboardLayout: [{ ...widget, size: "oversized" }] },
    { dashboardLayout: [{ ...widget, id: "unknown_widget" }] },
    { dashboardLayout: [widget], saveAsDefault: "true" },
    { dashboardLayout: [widget], expectedLayoutVersion: null },
    { dashboardLayout: [widget], expectedLayoutVersion: "invalid-version" },
  ]) {
    const response = await request.patch(endpoint, { headers, data });
    expect(response.status(), JSON.stringify(data)).toBe(400);
    expect((await response.json()).error).toBeTruthy();
  }
  const malformedJson = await request.patch(endpoint, { headers: { ...headers, "Content-Type": "application/json" }, data: "{ invalid json" });
  expect(malformedJson.status()).toBe(400);
  expect(await readLayout(request)).toEqual(before);
});

test("ordinary saves, personal defaults, and loading the default retain distinct persisted values", async ({ request }) => {
  const original = await readLayout(request);
  const personalDefault = focusedLayout("pinned");
  const workingLayout = focusedLayout("newest");
  const first = await request.patch(endpoint, { headers, data: {
    dashboardLayout: personalDefault, saveAsDefault: true, expectedLayoutVersion: original.layoutVersion,
  } });
  expect(first.status()).toBe(200);
  const savedDefault = await first.json() as LayoutResponse;
  expect(savedDefault.dashboardLayout).toEqual(personalDefault);
  expect(savedDefault.dashboardDefaultLayout).toEqual(personalDefault);
  expect(savedDefault.layoutVersion).not.toBe(original.layoutVersion);
  expect(savedDefault.updatedAt).not.toBe(original.updatedAt);

  const second = await request.patch(endpoint, { headers, data: {
    dashboardLayout: workingLayout, saveAsDefault: false, expectedLayoutVersion: savedDefault.layoutVersion,
  } });
  expect(second.status()).toBe(200);
  const savedWork = await second.json() as LayoutResponse;
  expect(savedWork.dashboardLayout).toEqual(workingLayout);
  expect(savedWork.dashboardDefaultLayout).toEqual(personalDefault);

  const restored = await request.patch(endpoint, { headers, data: {
    dashboardLayout: savedWork.dashboardDefaultLayout, expectedLayoutVersion: savedWork.layoutVersion,
  } });
  expect(restored.status()).toBe(200);
  const latest = await readLayout(request);
  expect(latest.dashboardLayout).toEqual(personalDefault);
  expect(latest.dashboardDefaultLayout).toEqual(personalDefault);
});

test("explicitly hiding every widget stays empty while older save clients remain compatible", async ({ request }) => {
  const hidden = getDefaultDashboardLayout().map((widget) => ({ ...widget, visible: false }));
  // Existing clients did not send an expected version; they can still save a complete layout.
  const response = await request.patch(endpoint, { headers, data: { dashboardLayout: hidden } });
  expect(response.status()).toBe(200);
  const latest = await readLayout(request);
  expect(latest.dashboardLayout).toEqual(hidden);
  expect(latest.dashboardLayout.every((widget) => !widget.visible)).toBe(true);
  expect(latest.dashboardDefaultLayout).toEqual(getDefaultDashboardLayout());
});

test("a stale editor cannot overwrite a setup saved by another tab", async ({ request }) => {
  const old = await readLayout(request);
  const newerLayout = focusedLayout("pinned");
  const first = await request.patch(endpoint, { headers, data: { dashboardLayout: newerLayout, expectedLayoutVersion: old.layoutVersion } });
  expect(first.status()).toBe(200);
  const newer = await readLayout(request);

  const stale = await request.patch(endpoint, { headers, data: {
    dashboardLayout: focusedLayout("finder"), saveAsDefault: true, expectedLayoutVersion: old.layoutVersion,
  } });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).error).toContain("another tab or device");
  expect(await readLayout(request)).toEqual(newer);
});

test("a missing profile during layout access returns 404 instead of a false successful save", async ({ request }) => {
  const old = await readLayout(request);
  await fixture(request, { missingLayoutProfile: true });
  expect((await request.get(endpoint, { headers })).status()).toBe(404);
  const response = await request.patch(endpoint, { headers, data: { dashboardLayout: focusedLayout("finder"), expectedLayoutVersion: old.layoutVersion } });
  expect(response.status()).toBe(404);
  expect((await response.json()).error).toContain("active profile");
  await fixture(request, { missingLayoutProfile: false });
  expect(await readLayout(request)).toEqual(old);
});

test("an update racing after the version check cannot overwrite the newer layout", async ({ request }) => {
  const old = await readLayout(request);
  const concurrentLayout = focusedLayout("newest");
  await fixture(request, { raceNextWrite: { dashboardLayout: concurrentLayout } });
  const response = await request.patch(endpoint, { headers, data: {
    dashboardLayout: focusedLayout("finder"), expectedLayoutVersion: old.layoutVersion,
  } });
  expect(response.status()).toBe(409);
  expect((await response.json()).error).toContain("while saving");
  expect((await readLayout(request)).dashboardLayout).toEqual(concurrentLayout);
});

test("atomic layout saves also protect a personal default changed during the request", async ({ request }) => {
  const old = await readLayout(request);
  const concurrentDefault = focusedLayout("pinned");
  await fixture(request, { raceNextWrite: { dashboardDefaultLayout: concurrentDefault } });
  const response = await request.patch(endpoint, { headers, data: {
    dashboardLayout: focusedLayout("finder"), saveAsDefault: true, expectedLayoutVersion: old.layoutVersion,
  } });
  expect(response.status()).toBe(409);
  expect((await response.json()).error).toContain("while saving");
  const latest = await readLayout(request);
  expect(latest.dashboardLayout).toEqual(old.dashboardLayout);
  expect(latest.dashboardDefaultLayout).toEqual(concurrentDefault);
});
