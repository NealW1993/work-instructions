import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { ACCOUNT_MANAGEMENT_DENIED, canManageAccounts } from "@/lib/user-management";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { authorizeAccountChange } from "@/lib/user-management.server";

/**
 * Deactivates or reactivates an account. Deactivation keeps the user's history (approvals, revisions,
 * audit events) intact, which deletion cannot do for controlled records, and blocks sign-in at once.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!canManageAccounts(requester.role)) {
    return NextResponse.json({ error: ACCOUNT_MANAGEMENT_DENIED }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { isActive?: unknown };
  if (typeof body.isActive !== "boolean") {
    return NextResponse.json({ error: "isActive must be true or false." }, { status: 400 });
  }

  const { id } = await context.params;
  if (id === requester.id) {
    return NextResponse.json({ error: "You cannot change the status of your own account." }, { status: 400 });
  }
  const authorization = await authorizeAccountChange(requester.role, id);
  if (authorization.response) {
    return authorization.response;
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { error } = await supabaseAdmin.from("profiles").update({ is_active: body.isActive }).eq("id", id);
  if (error) {
    // The database refuses to deactivate the last active system administrator.
    const status = error.code === "23514" ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  // Banning the auth user also stops existing refresh tokens; reactivation lifts it.
  const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(id, {
    ban_duration: body.isActive ? "none" : "876000h",
  });
  if (banError) {
    return NextResponse.json({ error: `Status saved, but sign-in could not be updated: ${banError.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, isActive: body.isActive });
}
