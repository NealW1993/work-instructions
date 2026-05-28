import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { isSystemAdmin } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; userId: string }> },
) {
  const requester = await getRequestProfile(request);

  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!isSystemAdmin(requester.role)) {
    return NextResponse.json(
      { error: "Only system admins can remove group members." },
      { status: 403 },
    );
  }

  const { id, userId } = await context.params;
  const supabaseAdmin = getSupabaseAdminClient();
  const { error } = await supabaseAdmin
    .from("access_group_memberships")
    .delete()
    .eq("group_id", id)
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ removed: true });
}
