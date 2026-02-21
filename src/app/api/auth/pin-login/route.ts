import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface PinLoginBody {
  email?: string;
  pin?: string;
}

export async function POST(request: Request) {
  const supabaseAdmin = getSupabaseAdminClient();
  const body = (await request.json().catch(() => ({}))) as PinLoginBody;

  const email = body.email?.trim().toLowerCase();
  const pin = body.pin?.trim();

  if (!email || !pin || !/^\d{6}$/.test(pin)) {
    return NextResponse.json(
      { error: "Valid email and 6-digit PIN are required." },
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

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink(
    {
      type: "magiclink",
      email,
    },
  );

  if (linkError || !linkData.properties?.hashed_token) {
    return NextResponse.json(
      { error: linkError?.message ?? "Unable to generate login token." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    tokenHash: linkData.properties.hashed_token,
  });
}
