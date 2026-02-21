import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isValidEmployeeId, normalizeEmployeeId } from "@/lib/utils";

interface RecoverPasswordByPinBody {
  employeeId?: string;
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

  const employeeId = normalizeEmployeeId(body.employeeId ?? "");
  const pin = body.pin?.trim();

  if (!employeeId || !pin) {
    return NextResponse.json(
      { error: "Employee ID and PIN are required." },
      { status: 400 },
    );
  }

  if (!isValidEmployeeId(employeeId)) {
    return NextResponse.json(
      { error: "Employee ID must be 1-6 digits." },
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
      login_identifier: employeeId,
      submitted_pin: pin,
    },
  );

  if (pinError || !userId) {
    return NextResponse.json(
      { error: "Invalid employee ID or PIN." },
      { status: 401 },
    );
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle<{ email: string }>();

  const resolvedEmail = profile?.email?.trim().toLowerCase();

  if (profileError || !resolvedEmail) {
    return NextResponse.json(
      { error: "Unable to resolve account email for password recovery." },
      { status: 500 },
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
    email: resolvedEmail,
  });
}
