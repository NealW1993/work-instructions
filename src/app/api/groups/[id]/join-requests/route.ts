import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface JoinRequestBody {
  note?: unknown;
}

function normalizeString(value: unknown, maxLength = 800) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requester = await getRequestProfile(request);

  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as JoinRequestBody;
  const supabaseAdmin = getSupabaseAdminClient();

  const { data: existingMembership, error: membershipError } = await supabaseAdmin
    .from("access_group_memberships")
    .select("group_id")
    .eq("group_id", id)
    .eq("user_id", requester.id)
    .maybeSingle<{ group_id: string }>();

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 });
  }

  if (existingMembership) {
    return NextResponse.json({ error: "You are already a member of this group." }, { status: 409 });
  }

  const { error } = await supabaseAdmin.from("access_group_join_requests").insert({
    group_id: id,
    requester_user_id: requester.id,
    request_note: normalizeString(body.note),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requested: true });
}
