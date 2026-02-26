import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import {
  normalizeDashboardLayout,
  parseDashboardLayout,
} from "@/lib/dashboard-layout";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface UpdateDashboardLayoutBody {
  dashboardLayout?: unknown;
  saveAsDefault?: boolean;
}

export async function GET(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("dashboard_layout, dashboard_default_layout")
    .eq("id", requester.id)
    .maybeSingle<{
      dashboard_layout: unknown;
      dashboard_default_layout: unknown;
    }>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const normalizedLayout = normalizeDashboardLayout(data?.dashboard_layout ?? null);
  const normalizedDefaultLayout = normalizeDashboardLayout(
    data?.dashboard_default_layout ?? null,
  );
  return NextResponse.json({
    dashboardLayout: normalizedLayout,
    dashboardDefaultLayout: normalizedDefaultLayout,
  });
}

export async function PATCH(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as UpdateDashboardLayoutBody;
  const parsedLayout = parseDashboardLayout(body.dashboardLayout);

  if (!parsedLayout) {
    return NextResponse.json(
      { error: "dashboardLayout must be a valid widget layout array." },
      { status: 400 },
    );
  }
  const normalizedLayout = normalizeDashboardLayout(parsedLayout);
  const saveAsDefault = body.saveAsDefault === true;

  const supabaseAdmin = getSupabaseAdminClient();
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      dashboard_layout: normalizedLayout,
      ...(saveAsDefault
        ? {
            dashboard_default_layout: normalizedLayout,
          }
        : {}),
    })
    .eq("id", requester.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    dashboardLayout: normalizedLayout,
    ...(saveAsDefault
      ? {
          dashboardDefaultLayout: normalizedLayout,
        }
      : {}),
  });
}
