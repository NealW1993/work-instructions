import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface MarkSeenBody {
  seenAt?: string;
}

function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as MarkSeenBody;
  const seenAt = body.seenAt?.trim() ?? "";
  const seenAtTimestamp = toTimestamp(seenAt);

  if (!seenAt || seenAtTimestamp === null) {
    return NextResponse.json(
      { error: "seenAt must be a valid ISO timestamp." },
      { status: 400 },
    );
  }

  const currentSeenAtTimestamp = toTimestamp(requester.authored_likes_seen_at ?? null);
  if (currentSeenAtTimestamp !== null && seenAtTimestamp <= currentSeenAtTimestamp) {
    return NextResponse.json({ success: true, updated: false });
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ authored_likes_seen_at: seenAt })
    .eq("id", requester.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, updated: true });
}
