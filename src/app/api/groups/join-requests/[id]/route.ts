import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { hasFullAccess } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface JoinDecisionBody {
  status?: unknown;
  note?: unknown;
}

interface JoinRequestRecord {
  id: string;
  group_id: string;
  requester_user_id: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
}

function isDecision(value: unknown): value is "approved" | "rejected" | "cancelled" {
  return value === "approved" || value === "rejected" || value === "cancelled";
}

function normalizeString(value: unknown, maxLength = 800) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requester = await getRequestProfile(request);

  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as JoinDecisionBody;
  if (!isDecision(body.status)) {
    return NextResponse.json(
      { error: "status must be approved, rejected, or cancelled." },
      { status: 400 },
    );
  }

  const { id } = await context.params;
  const supabaseAdmin = getSupabaseAdminClient();
  const { data: joinRequest, error: readError } = await supabaseAdmin
    .from("access_group_join_requests")
    .select("id, group_id, requester_user_id, status")
    .eq("id", id)
    .maybeSingle<JoinRequestRecord>();

  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }

  if (!joinRequest) {
    return NextResponse.json({ error: "Join request not found." }, { status: 404 });
  }

  const userCancellingOwnRequest =
    body.status === "cancelled" && joinRequest.requester_user_id === requester.id;

  if (!hasFullAccess(requester.role) && !userCancellingOwnRequest) {
    return NextResponse.json(
      { error: "Admin privileges are required to decide group requests." },
      { status: 403 },
    );
  }

  if (joinRequest.status !== "pending") {
    return NextResponse.json(
      { error: "Only pending join requests can be updated." },
      { status: 409 },
    );
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabaseAdmin
    .from("access_group_join_requests")
    .update({
      status: body.status,
      decision_note: normalizeString(body.note),
      decided_by: requester.id,
      decided_at: nowIso,
    })
    .eq("id", joinRequest.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (body.status === "approved") {
    const { error: membershipError } = await supabaseAdmin
      .from("access_group_memberships")
      .upsert(
        {
          group_id: joinRequest.group_id,
          user_id: joinRequest.requester_user_id,
          assigned_by: requester.id,
          assigned_at: nowIso,
        },
        { onConflict: "group_id,user_id" },
      );

    if (membershipError) {
      return NextResponse.json({ error: membershipError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ status: body.status });
}
