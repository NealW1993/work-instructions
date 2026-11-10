import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { ACCOUNT_MANAGEMENT_DENIED, canManageAccounts } from "@/lib/user-management";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { authorizeAccountChange } from "@/lib/user-management.server";
import { isValidEmployeeId, normalizeEmployeeId } from "@/lib/utils";

interface UpdateEmployeeIdBody {
  employeeId?: string;
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

  if (!canManageAccounts(requester.role)) {
    return NextResponse.json(
      { error: ACCOUNT_MANAGEMENT_DENIED },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as UpdateEmployeeIdBody;
  const employeeId = normalizeEmployeeId(typeof body.employeeId === "string" ? body.employeeId : "");

  if (!isValidEmployeeId(employeeId)) {
    return NextResponse.json(
      { error: "Employee ID must be 1-6 digits." },
      { status: 400 },
    );
  }

  const { id } = await context.params;
  // The employee ID is the sign-in identifier, so only accounts the requester manages can be changed.
  const authorization = await authorizeAccountChange(requester.role, id);
  if (authorization.response) {
    return authorization.response;
  }

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .update({
      employee_id: employeeId,
    })
    .eq("id", id);

  if (profileError) {
    if (profileError.code === "23505") {
      return NextResponse.json({ error: "That employee ID is already assigned to another user." }, { status: 409 });
    }
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(id, {
    user_metadata: {
      employee_id: employeeId,
    },
  });

  if (authUpdateError) {
    return NextResponse.json({ error: authUpdateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
