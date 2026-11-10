import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { normalizeDashboardLayout, parseDashboardLayout } from "@/lib/dashboard-layout";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface LayoutRecord {
  dashboard_layout: unknown;
  dashboard_default_layout: unknown;
  updated_at?: string | null;
}

function layoutVersion(record: LayoutRecord) {
  return createHash("sha256").update(JSON.stringify([
    record.dashboard_layout ?? null,
    record.dashboard_default_layout ?? null,
  ])).digest("hex");
}

function layoutResponse(record: LayoutRecord) {
  return {
    dashboardLayout: normalizeDashboardLayout(record.dashboard_layout),
    dashboardDefaultLayout: normalizeDashboardLayout(record.dashboard_default_layout),
    layoutVersion: layoutVersion(record),
    updatedAt: record.updated_at ?? null,
  };
}

function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) return json({ error: "Unauthorized." }, 401);

  const { data, error } = await getSupabaseAdminClient().from("profiles")
    .select("dashboard_layout, dashboard_default_layout, updated_at")
    .eq("id", requester.id).eq("is_active", true).maybeSingle<LayoutRecord>();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "Your active profile could not be found. Sign in again before changing the homepage." }, 404);
  return json(layoutResponse(data));
}

export async function PATCH(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) return json({ error: "Unauthorized." }, 401);

  const rawBody: unknown = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) return json({ error: "A homepage layout object is required." }, 400);
  const body = rawBody as Record<string, unknown>;
  const parsedLayout = parseDashboardLayout(body.dashboardLayout);
  if (!parsedLayout) return json({ error: "dashboardLayout must contain unique known widgets, valid sizes, and true or false visibility." }, 400);
  if (body.saveAsDefault !== undefined && typeof body.saveAsDefault !== "boolean") return json({ error: "saveAsDefault must be true or false." }, 400);
  if (body.expectedLayoutVersion !== undefined && (typeof body.expectedLayoutVersion !== "string" || !/^[a-f0-9]{64}$/.test(body.expectedLayoutVersion))) {
    return json({ error: "expectedLayoutVersion must be the version returned when the homepage editor was opened." }, 400);
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { data: current, error: readError } = await supabaseAdmin.from("profiles")
    .select("dashboard_layout, dashboard_default_layout, updated_at")
    .eq("id", requester.id).eq("is_active", true).maybeSingle<LayoutRecord>();
  if (readError) return json({ error: readError.message }, 500);
  if (!current) return json({ error: "Your active profile could not be found. Sign in again before changing the homepage." }, 404);
  if (body.expectedLayoutVersion !== undefined && body.expectedLayoutVersion !== layoutVersion(current)) {
    return json({ error: "Your homepage layout changed in another tab or device. Your draft is preserved. Reload the saved layout before saving again." }, 409);
  }

  const normalizedLayout = normalizeDashboardLayout(parsedLayout);
  const saveAsDefault = body.saveAsDefault === true;
  let update = supabaseAdmin.from("profiles").update({
    dashboard_layout: normalizedLayout,
    ...(saveAsDefault ? { dashboard_default_layout: normalizedLayout } : {}),
  }).eq("id", requester.id).eq("is_active", true);
  // Compare both raw JSON values within the update, closing the gap between reading and writing.
  // This also protects older clients when another save races their request.
  update = current.dashboard_layout === null ? update.is("dashboard_layout", null)
    : update.eq("dashboard_layout", JSON.stringify(current.dashboard_layout));
  update = current.dashboard_default_layout === null ? update.is("dashboard_default_layout", null)
    : update.eq("dashboard_default_layout", JSON.stringify(current.dashboard_default_layout));
  const { data, error } = await update.select("dashboard_layout, dashboard_default_layout, updated_at").maybeSingle<LayoutRecord>();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "Your homepage layout changed while saving. Your draft is preserved. Reload the saved layout before saving again." }, 409);
  return json(layoutResponse(data));
}
