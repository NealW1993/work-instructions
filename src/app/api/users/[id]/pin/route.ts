import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { isWeakPin, PIN_POLICY_MESSAGE } from "@/lib/pin-policy";
import { ACCOUNT_MANAGEMENT_DENIED, canManageAccounts } from "@/lib/user-management";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { authorizeAccountChange } from "@/lib/user-management.server";

interface UpdatePinBody {
  pin?: string;
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

  const body = (await request.json().catch(() => ({}))) as UpdatePinBody;
  const pin = typeof body.pin === "string" ? body.pin.trim() : "";

  if (!pin || !/^\d{6}$/.test(pin)) {
    return NextResponse.json(
      { error: "PIN must be exactly 6 digits." },
      { status: 400 },
    );
  }

  if (isWeakPin(pin)) {
    return NextResponse.json({ error: PIN_POLICY_MESSAGE }, { status: 400 });
  }

  const { id } = await context.params;
  // Resetting a PIN lets someone sign in as that account, so it is limited to accounts the requester manages.
  const authorization = await authorizeAccountChange(requester.role, id);
  if (authorization.response) {
    return authorization.response;
  }

  const { error } = await supabaseAdmin.rpc("set_user_pin", {
    target_user_id: id,
    new_pin: pin,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
