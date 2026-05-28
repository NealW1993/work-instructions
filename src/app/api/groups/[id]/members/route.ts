import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { isSystemAdmin } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface AssignMemberBody {
  userId?: unknown;
}

function normalizeUuid(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(
    normalized,
  )
    ? normalized
    : null;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requester = await getRequestProfile(request);

  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!isSystemAdmin(requester.role)) {
    return NextResponse.json(
      { error: "Only system admins can assign group members directly." },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as AssignMemberBody;
  const userId = normalizeUuid(body.userId);

  if (!userId) {
    return NextResponse.json({ error: "A valid userId is required." }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const supabaseAdmin = getSupabaseAdminClient();
  const { error } = await supabaseAdmin.from("access_group_memberships").upsert(
    {
      group_id: id,
      user_id: userId,
      assigned_by: requester.id,
      assigned_at: nowIso,
    },
    { onConflict: "group_id,user_id" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ assigned: true });
}
