import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import {
  getDashboardAiSearchEnabled,
  setDashboardAiSearchEnabled,
} from "@/lib/ai-usage";
import { hasFullAccess } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface DashboardAiSearchSettingBody {
  enabled?: unknown;
}

export async function GET(request: NextRequest) {
  const requester = await getRequestProfile(request);

  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!hasFullAccess(requester.role)) {
    return NextResponse.json(
      { error: "Admin privileges required." },
      { status: 403 },
    );
  }

  const enabled = await getDashboardAiSearchEnabled(getSupabaseAdminClient());

  return NextResponse.json({
    enabled,
  });
}

export async function PATCH(request: NextRequest) {
  const requester = await getRequestProfile(request);

  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!hasFullAccess(requester.role)) {
    return NextResponse.json(
      { error: "Only admins can change Dashboard AI Search." },
      { status: 403 },
    );
  }

  const requestBody = (await request.json().catch(() => ({}))) as DashboardAiSearchSettingBody;

  if (typeof requestBody.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean." }, { status: 400 });
  }

  try {
    const enabled = await setDashboardAiSearchEnabled({
      enabled: requestBody.enabled,
      updatedBy: requester.id,
      supabaseAdmin: getSupabaseAdminClient(),
    });

    return NextResponse.json({ enabled });
  } catch (caughtError) {
    return NextResponse.json(
      {
        error:
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to update Dashboard AI Search setting.",
      },
      { status: 500 },
    );
  }
}
