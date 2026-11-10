import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import type { AppRole } from "@/lib/types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { authorizeAccountChange } from "@/lib/user-management.server";

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

  const { id } = await context.params;
  // Only system admins change roles; this also loads the account being changed.
  const authorization = await authorizeAccountChange(requester.role, id);
  if (authorization.response) {
    return authorization.response;
  }
  const target = authorization.target;

  const body = (await request.json().catch(() => ({}))) as UpdateRoleBody;
  const role = body.role;

  if (!role || !validateRole(role)) {
    return NextResponse.json({ error: "Valid role is required." }, { status: 400 });
  }

  if (target.role === "system_admin" && target.is_active && role !== "system_admin") {
    const { count, error: countError } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "system_admin")
      .eq("is_active", true);
    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "You cannot demote the last active system admin." },
        { status: 409 },
      );
    }
  }

  const { error } = await supabaseAdmin.from("profiles").update({ role }).eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
