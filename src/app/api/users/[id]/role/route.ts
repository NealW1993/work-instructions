import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import type { AppRole } from "@/lib/types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface UpdateRoleBody {
  role?: AppRole;
}

function validateRole(role: string): role is AppRole {
  return role === "user" || role === "admin" || role === "system_admin";
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

  if (requester.role !== "system_admin") {
    return NextResponse.json(
      { error: "System admin privileges required." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as UpdateRoleBody;
  const role = body.role;

  if (!role || !validateRole(role)) {
    return NextResponse.json({ error: "Valid role is required." }, { status: 400 });
  }

  const { id } = await context.params;

  const { error } = await supabaseAdmin.from("profiles").update({ role }).eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
