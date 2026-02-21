import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
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

  if (requester.role !== "system_admin") {
    return NextResponse.json(
      { error: "System admin privileges required." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as UpdateEmployeeIdBody;
  const employeeId = normalizeEmployeeId(body.employeeId ?? "");

  if (!isValidEmployeeId(employeeId)) {
    return NextResponse.json(
      { error: "Employee ID must be 1-6 digits." },
      { status: 400 },
    );
  }

  const { id } = await context.params;

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .update({
      employee_id: employeeId,
    })
    .eq("id", id);

  if (profileError) {
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
