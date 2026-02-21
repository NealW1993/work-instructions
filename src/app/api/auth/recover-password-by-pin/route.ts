import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface RecoverPasswordByPinBody {
  email?: string;
  pin?: string;
}

function generateTemporaryPassword(length = 14): string {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const bytes = randomBytes(length);
  let value = "";

  for (let index = 0; index < length; index += 1) {
    value += alphabet[bytes[index] % alphabet.length];
  }

  return value;
}

export async function POST(request: Request) {
  const supabaseAdmin = getSupabaseAdminClient();
  const body = (await request.json().catch(() => ({}))) as RecoverPasswordByPinBody;

  const email = body.email?.trim().toLowerCase();
  const pin = body.pin?.trim();

  if (!email || !pin) {
    return NextResponse.json(
      { error: "Email and PIN are required." },
      { status: 400 },
    );
  }

  if (!/^\d{6}$/.test(pin)) {
    return NextResponse.json(
      { error: "PIN must be exactly 6 digits." },
      { status: 400 },
    );
  }

  const { data: userId, error: pinError } = await supabaseAdmin.rpc(
    "verify_pin_login",
    {
      login_identifier: email,
      submitted_pin: pin,
    },
  );

  if (pinError || !userId) {
    return NextResponse.json(
      { error: "Invalid email or PIN." },
      { status: 401 },
    );
  }

  const temporaryPassword = generateTemporaryPassword();

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: temporaryPassword,
  });

  if (updateError) {
    return NextResponse.json(
      { error: updateError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    temporaryPassword,
  });
}
