import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

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

  if (requester.role !== "system_admin") {
    return NextResponse.json(
      { error: "System admin privileges required." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as UpdatePinBody;
  const pin = body.pin?.trim();

  if (!pin || !/^\d{6}$/.test(pin)) {
    return NextResponse.json(
      { error: "PIN must be exactly 6 digits." },
      { status: 400 },
    );
  }

  const { id } = await context.params;

  const { error } = await supabaseAdmin.rpc("set_user_pin", {
    target_user_id: id,
    new_pin: pin,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
