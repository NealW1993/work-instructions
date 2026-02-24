import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const ALLOWED_WIDGET_IDS = new Set([
  "finder",
  "pinned",
  "newest",
  "department_activity",
  "recent_updates",
  "my_impact",
]);

const ALLOWED_WIDGET_SIZES = new Set(["compact", "standard", "wide", "full"]);

interface DashboardWidgetLayoutRow {
  id: string;
  visible: boolean;
  size: string;
}

interface UpdateDashboardLayoutBody {
  dashboardLayout?: unknown;
}

function normalizeDashboardLayout(value: unknown): DashboardWidgetLayoutRow[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized: DashboardWidgetLayoutRow[] = [];
  const seenIds = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object") {
      return null;
    }

    const candidate = item as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const visible = typeof candidate.visible === "boolean" ? candidate.visible : null;
    const size = typeof candidate.size === "string" ? candidate.size.trim() : "";

    if (!id || !ALLOWED_WIDGET_IDS.has(id) || seenIds.has(id)) {
      return null;
    }

    if (visible === null || !ALLOWED_WIDGET_SIZES.has(size)) {
      return null;
    }

    normalized.push({
      id,
      visible,
      size,
    });
    seenIds.add(id);
  }

  return normalized;
}

export async function GET(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("dashboard_layout")
    .eq("id", requester.id)
    .maybeSingle<{ dashboard_layout: unknown }>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const normalizedLayout = normalizeDashboardLayout(data?.dashboard_layout ?? []);
  return NextResponse.json({
    dashboardLayout: normalizedLayout ?? [],
  });
}

export async function PATCH(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as UpdateDashboardLayoutBody;
  const normalizedLayout = normalizeDashboardLayout(body.dashboardLayout);

  if (!normalizedLayout) {
    return NextResponse.json(
      { error: "dashboardLayout must be a valid widget layout array." },
      { status: 400 },
    );
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      dashboard_layout: normalizedLayout,
    })
    .eq("id", requester.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ dashboardLayout: normalizedLayout });
}
