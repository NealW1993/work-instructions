import { expect, test, type APIRequestContext } from "@playwright/test";

const endpoint = "/api/user-settings";
const fixtureEndpoint = "http://127.0.0.1:3900/__fixture/user-settings";
const headers = { Authorization: "Bearer fixture-session-token" };

async function fixture(request: APIRequestContext, controls: Record<string, unknown>) {
  const response = await request.post(fixtureEndpoint, { data: controls });
  expect(response.ok(), "The settings fixture must accept its isolated test controls").toBe(true);
}

async function readSettings(request: APIRequestContext): Promise<Record<string, unknown>> {
  const response = await request.get(endpoint, { headers });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  return (await response.json()).settings as Record<string, unknown>;
}

test.beforeEach(async ({ request }) => { await fixture(request, { reset: true }); });
test.afterEach(async ({ request }) => { await fixture(request, { reset: true }); });

test("user settings require authentication for reads and writes", async ({ request }) => {
  expect((await request.get(endpoint)).status()).toBe(401);
  expect((await request.patch(endpoint, { data: { path: "dashboard.widgetTitles.finder", value: "Production search" } })).status()).toBe(401);
  expect(await readSettings(request)).toEqual({});
});

test("malformed settings updates and prototype paths return 400 without changing preferences", async ({ request }) => {
  const original = { notifications: { email: true } };
  await fixture(request, { settings: original });
  for (const data of [
    null, [], "invalid", 42, {}, { path: "dashboard.title" },
    { path: null, value: true }, { path: "", value: true },
    { path: "__proto__.polluted", value: true },
    { path: "dashboard.constructor.prototype.polluted", value: true },
    { path: "dashboard..title", value: true },
  ]) {
    const response = await request.patch(endpoint, { headers, data });
    expect(response.status(), JSON.stringify(data)).toBe(400);
    expect((await response.json()).error).toBeTruthy();
  }
  const malformedJson = await request.patch(endpoint, {
    headers: { ...headers, "Content-Type": "application/json" }, data: "{ invalid json",
  });
  expect(malformedJson.status()).toBe(400);
  expect((await request.get(`${endpoint}?path=constructor.prototype`, { headers })).status()).toBe(400);
  expect(await readSettings(request)).toEqual(original);
});

test("nested settings retain sibling preferences and preserve false, zero and null values", async ({ request }) => {
  await fixture(request, { settings: {
    notifications: { email: true },
    dashboard: { widgetTitles: { pinned: "Shift priorities" }, timeRange: 30 },
  } });
  for (const [path, value] of [
    ["dashboard.widgetTitles.finder", "Production search"],
    ["notifications.email", false],
    ["dashboard.count", 0],
    ["dashboard.optional", null],
  ] as const) {
    const response = await request.patch(endpoint, { headers, data: { path, value } });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.json()).toEqual({ path, value });
  }
  expect(await readSettings(request)).toEqual({
    notifications: { email: false },
    dashboard: { widgetTitles: { pinned: "Shift priorities", finder: "Production search" }, timeRange: 30, count: 0, optional: null },
  });
  const nested = await request.get(`${endpoint}?path=dashboard.widgetTitles.finder`, { headers });
  expect(await nested.json()).toEqual({ path: "dashboard.widgetTitles.finder", value: "Production search" });
});

test("a sibling change racing a title save survives the compare-and-swap retry", async ({ request }) => {
  await fixture(request, { settings: { notifications: { email: true } }, raceNextWrites: 1 });
  const response = await request.patch(endpoint, { headers, data: { path: "dashboard.widgetTitles.finder", value: "Line setup search" } });
  expect(response.status()).toBe(200);
  expect(await readSettings(request)).toEqual({
    notifications: { email: true },
    concurrent: { counter: 1 },
    dashboard: { widgetTitles: { finder: "Line setup search" } },
  });
});

test("overlapping preference requests retain every separately saved path", async ({ request }) => {
  await fixture(request, { settings: { dashboard: { widgetTitles: { pinned: "Pinned work" } } } });
  const updates = [
    { path: "dashboard.widgetTitles.finder", value: "Production search" },
    { path: "dashboard.timeRange", value: 90 },
    { path: "notifications.email", value: false },
  ];
  const responses = await Promise.all(updates.map((data) => request.patch(endpoint, { headers, data })));
  for (const response of responses) expect(response.status()).toBe(200);
  expect(await readSettings(request)).toEqual({
    dashboard: { widgetTitles: { pinned: "Pinned work", finder: "Production search" }, timeRange: 90 },
    notifications: { email: false },
  });
});

test("persistent contention returns a failed save instead of overwriting another preference", async ({ request }) => {
  await fixture(request, { settings: { notifications: { email: true } }, raceNextWrites: 10 });
  const response = await request.patch(endpoint, { headers, data: { path: "dashboard.widgetTitles.finder", value: "Unsaved title" } });
  expect(response.status()).toBe(409);
  expect((await response.json()).error).toContain("not saved");
  await fixture(request, { raceNextWrites: 0 });
  const settings = await readSettings(request);
  expect(settings.notifications).toEqual({ email: true });
  expect(settings.dashboard).toBeUndefined();
  expect((settings.concurrent as { counter: number }).counter).toBeGreaterThan(0);
  expect((settings.concurrent as { counter: number }).counter).toBeLessThan(10);
});

test("a profile disappearing after authentication cannot produce a successful settings read or save", async ({ request }) => {
  await fixture(request, { settings: { keep: "existing" }, missingSettingsProfile: true });
  expect((await request.get(endpoint, { headers })).status()).toBe(404);
  const response = await request.patch(endpoint, { headers, data: { path: "dashboard.title", value: "Not saved" } });
  expect(response.status()).toBe(404);
  expect((await response.json()).error).toContain("active profile");
  await fixture(request, { missingSettingsProfile: false });
  expect(await readSettings(request)).toEqual({ keep: "existing" });
});

test("deactivation during a settings write prevents the pending update", async ({ request }) => {
  await fixture(request, { settings: { keep: "existing" }, deactivateBeforeWrite: true });
  const response = await request.patch(endpoint, { headers, data: { path: "dashboard.title", value: "Not saved" } });
  expect(response.status()).toBe(404);
  await fixture(request, { active: true, deactivateBeforeWrite: false });
  expect(await readSettings(request)).toEqual({ keep: "existing" });
});

test("backend read and write failures return errors while retaining the previous settings", async ({ request }) => {
  await fixture(request, { settings: { keep: "existing" }, failReads: true });
  expect((await request.get(endpoint, { headers })).status()).toBe(500);
  expect((await request.patch(endpoint, { headers, data: { path: "dashboard.title", value: "Not saved" } })).status()).toBe(500);
  await fixture(request, { failReads: false, failWrites: true });
  expect((await request.patch(endpoint, { headers, data: { path: "dashboard.title", value: "Not saved" } })).status()).toBe(500);
  await fixture(request, { failWrites: false });
  expect(await readSettings(request)).toEqual({ keep: "existing" });
});
