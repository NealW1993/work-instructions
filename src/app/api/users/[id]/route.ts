import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { ACCOUNT_MANAGEMENT_DENIED, canManageAccounts } from "@/lib/user-management";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { authorizeAccountChange } from "@/lib/user-management.server";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const supabaseAdmin = getSupabaseAdminClient();
  const requester = await getRequestProfile(request);

  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!canManageAccounts(requester.role)) {
    return NextResponse.json(
      { error: ACCOUNT_MANAGEMENT_DENIED },
      { status: 403 },
    );
  }

  const { id } = await context.params;

  if (id === requester.id) {
    return NextResponse.json(
      { error: "You cannot delete your own account." },
      { status: 400 },
    );
  }

  const authorization = await authorizeAccountChange(requester.role, id);
  if (authorization.response) {
    return authorization.response;
  }
  const targetProfile = authorization.target;

  if (targetProfile.role === "system_admin") {
    const { count, error: adminCountError } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "system_admin")
      .eq("is_active", true);

    if (adminCountError) {
      return NextResponse.json({ error: adminCountError.message }, { status: 500 });
    }

    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "You cannot delete the last active system admin." },
        { status: 400 },
      );
    }
  }

  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(id);

  if (deleteError) {
    const normalizedErrorMessage = deleteError.message.toLowerCase();
    if (normalizedErrorMessage.includes("not found")) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }
    // Controlled records (revisions, approvals, audit events) keep a reference to their author.
    if (normalizedErrorMessage.includes("foreign key") || normalizedErrorMessage.includes("database error")) {
      return NextResponse.json(
        { error: "This user has instruction or document history that must be retained, so the account cannot be deleted. Deactivate it instead." },
        { status: 409 },
      );
    }

    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
