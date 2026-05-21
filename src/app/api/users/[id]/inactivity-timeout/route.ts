import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { hasFullAccess } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface UpdateInactivityTimeoutBody {
  inactivityTimeoutMinutes?: number | null;
}

function normalizeInactivityTimeoutMinutes(value: unknown) {
  if (value === null) {
    return null;
  }

  if (!Number.isInteger(value)) {
    return null;
  }

  const parsed = Number(value);
  if (parsed < 1 || parsed > 10080) {
    return null;
  }

  return parsed;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const supabaseAdmin = getSupabaseAdminClient();
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

  const body = (await request.json().catch(() => ({}))) as UpdateInactivityTimeoutBody;

  const { id } = await context.params;
  let inactivityTimeoutMinutes: number | null;

  if (body.inactivityTimeoutMinutes === null) {
    inactivityTimeoutMinutes = null;
  } else {
    const normalizedTimeout = normalizeInactivityTimeoutMinutes(body.inactivityTimeoutMinutes);
    if (normalizedTimeout === null) {
      return NextResponse.json(
        {
          error:
            "Timeout must be null (Never) or a whole number of minutes between 1 and 10080.",
        },
        { status: 400 },
      );
    }
    inactivityTimeoutMinutes = normalizedTimeout;
  }

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      inactivity_timeout_minutes: inactivityTimeoutMinutes,
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    inactivityTimeoutMinutes: inactivityTimeoutMinutes,
  });
}
