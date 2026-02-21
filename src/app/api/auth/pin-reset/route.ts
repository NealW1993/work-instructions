import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface PinResetBody {
  email?: string;
  pin?: string;
  newPassword?: string;
}

export async function POST(request: Request) {
  const supabaseAdmin = getSupabaseAdminClient();
  const body = (await request.json().catch(() => ({}))) as PinResetBody;

  const email = body.email?.trim().toLowerCase();
  const pin = body.pin?.trim();
  const newPassword = body.newPassword?.trim();

  if (!email || !pin || !newPassword) {
    return NextResponse.json(
      { error: "Email, PIN, and new password are required." },
      { status: 400 },
    );
  }

  if (!/^\d{6}$/.test(pin)) {
    return NextResponse.json(
      { error: "PIN must be exactly 6 digits." },
      { status: 400 },
    );
  }

  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }

  const { data: userId, error: pinError } = await supabaseAdmin.rpc(
    "verify_pin_login",
    {
      login_email: email,
      submitted_pin: pin,
    },
  );

  if (pinError || !userId) {
    return NextResponse.json(
      { error: "Invalid email or PIN." },
      { status: 401 },
    );
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: newPassword,
  });

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
