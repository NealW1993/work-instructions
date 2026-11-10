// PostgREST-style profile writes for isolated UI/API regression tests only.
import { isDeepStrictEqual } from "node:util";
import { readBody } from "./media-fixture.mjs";

const layoutControls = {};
const settingsControls = {};

function touch(profile) {
  profile.updated_at = new Date(Math.max(Date.now(), Date.parse(profile.updated_at) + 1)).toISOString();
}

function matches(profile, searchParams) {
  for (const [field, filter] of searchParams) {
    if (["select", "order", "offset", "limit"].includes(field)) continue;
    if (filter === "is.null" && profile[field] != null) return false;
    if (filter.startsWith("eq.")) {
      const expected = filter.slice(3);
      if (["user_settings", "dashboard_layout", "dashboard_default_layout"].includes(field)) {
        try { if (!isDeepStrictEqual(profile[field], JSON.parse(expected))) return false; }
        catch { return false; }
      } else if (String(profile[field]) !== expected) return false;
    }
    if (filter.startsWith("neq.") && String(profile[field]) === filter.slice(4)) return false;
    if (filter.startsWith("in.(") && !filter.slice(4, -1).split(",").includes(String(profile[field]))) return false;
  }
  return true;
}

export async function handleProfileFixture(request, response, url, send, profile) {
  const isLayoutControl = url.pathname === "/__fixture/dashboard";
  const isSettingsControl = url.pathname === "/__fixture/user-settings";
  if (isLayoutControl || isSettingsControl) {
    const controls = isLayoutControl ? layoutControls : settingsControls;
    if (request.method === "POST") {
      const body = JSON.parse((await readBody(request)).toString());
      if (body.reset) {
        for (const group of [layoutControls, settingsControls]) {
          for (const key of Object.keys(group)) delete group[key];
        }
        profile.is_active = true;
        profile.user_settings = {};
        profile.dashboard_layout = null;
        profile.dashboard_default_layout = null;
        touch(profile);
      }
      for (const key of ["missingLayoutProfile", "missingSettingsProfile", "failReads", "failWrites", "deactivateBeforeWrite", "raceNextWrites", "raceNextWrite"]) {
        if (Object.hasOwn(body, key)) controls[key] = structuredClone(body[key]);
      }
      if (Object.hasOwn(body, "active")) { profile.is_active = body.active === true; touch(profile); }
      if (Object.hasOwn(body, "settings")) { profile.user_settings = structuredClone(body.settings); touch(profile); }
      if (Object.hasOwn(body, "dashboardLayout")) { profile.dashboard_layout = structuredClone(body.dashboardLayout); touch(profile); }
      if (Object.hasOwn(body, "dashboardDefaultLayout")) { profile.dashboard_default_layout = structuredClone(body.dashboardDefaultLayout); touch(profile); }
    } else if (request.method !== "GET") {
      send({ message: "Use GET or POST for fixture controls" }, 405);
      return true;
    }
    send({ ok: true, dashboardLayout: profile.dashboard_layout, dashboardDefaultLayout: profile.dashboard_default_layout, settings: profile.user_settings, active: profile.is_active, updatedAt: profile.updated_at });
    return true;
  }
  if (url.pathname !== "/rest/v1/profiles") return false;
  const selection = url.searchParams.get("select") ?? "*";
  const isLayoutRead = selection.includes("dashboard_layout");
  const isSettingsRead = selection.includes("user_settings");
  const selectedControls = isLayoutRead ? layoutControls : isSettingsRead ? settingsControls : null;
  const sendRows = (rows) => {
    response.setHeader("Content-Range", rows.length ? "0-0/1" : "*/0");
    send(request.headers.accept?.includes("application/vnd.pgrst.object+json") ? rows[0] ?? null : rows);
  };

  if (["GET", "HEAD"].includes(request.method)) {
    if (selectedControls?.failReads) { send({ message: "Fixture profile read failed", code: "XX000" }, 500); return true; }
    const missing = isLayoutRead && layoutControls.missingLayoutProfile || isSettingsRead && settingsControls.missingSettingsProfile;
    const rows = !missing && matches(profile, url.searchParams) ? [structuredClone(profile)] : [];
    // Honour PostgREST paging like the real backend, so batched readers reach their final empty page.
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : rows.length;
    sendRows(rows.slice(offset, offset + limit));
    return true;
  }
  if (request.method === "PATCH") {
    const body = JSON.parse((await readBody(request)).toString());
    const isLayoutWrite = Object.hasOwn(body, "dashboard_layout") || Object.hasOwn(body, "dashboard_default_layout");
    const isSettingsWrite = Object.hasOwn(body, "user_settings");
    const controls = isLayoutWrite ? layoutControls : isSettingsWrite ? settingsControls : {};
    if (controls.failWrites) { send({ message: "Fixture profile write failed", code: "XX000" }, 500); return true; }
    if (controls.deactivateBeforeWrite) { profile.is_active = false; controls.deactivateBeforeWrite = false; touch(profile); }
    if (isLayoutWrite && layoutControls.raceNextWrite) {
      const concurrent = layoutControls.raceNextWrite;
      if (Object.hasOwn(concurrent, "dashboardLayout")) profile.dashboard_layout = structuredClone(concurrent.dashboardLayout);
      if (Object.hasOwn(concurrent, "dashboardDefaultLayout")) profile.dashboard_default_layout = structuredClone(concurrent.dashboardDefaultLayout);
      layoutControls.raceNextWrite = null;
      touch(profile);
    }
    if (isSettingsWrite && settingsControls.raceNextWrites > 0) {
      const previous = profile.user_settings ?? {};
      profile.user_settings = { ...previous, concurrent: { counter: Number(previous.concurrent?.counter ?? 0) + 1 } };
      settingsControls.raceNextWrites--;
      touch(profile);
    }
    const missing = isLayoutWrite && layoutControls.missingLayoutProfile || isSettingsWrite && settingsControls.missingSettingsProfile;
    if (missing || !matches(profile, url.searchParams)) { sendRows([]); return true; }
    for (const [key, value] of Object.entries(body)) {
      if (key !== "id" && Object.hasOwn(profile, key)) profile[key] = structuredClone(value);
    }
    touch(profile);
    sendRows([structuredClone(profile)]);
    return true;
  }
  send({ message: "Profile fixture accepts only GET, HEAD and PATCH" }, 405);
  return true;
}
