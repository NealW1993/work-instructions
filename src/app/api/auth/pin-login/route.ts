import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isValidEmployeeId, normalizeEmployeeId } from "@/lib/utils";

interface PinLoginBody {
  employeeId?: string;
  pin?: string;
}

export async function POST(request: Request) {
  const supabaseAdmin = getSupabaseAdminClient();
  const body = (await request.json().catch(() => ({}))) as PinLoginBody;

  const employeeId = normalizeEmployeeId(body.employeeId ?? "");
  const pin = body.pin?.trim();

  if (!isValidEmployeeId(employeeId)) {
    return NextResponse.json(
      { error: "Employee ID must be 1-6 digits." },
      { status: 400 },
    );
  }

  if (!pin || !/^\d{6}$/.test(pin)) {
    return NextResponse.json(
      { error: "Valid 6-digit PIN is required." },
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

  if (pinError) {
    return NextResponse.json({ error: pinError.message }, { status: 500 });
  }

  if (!userId) {
    return NextResponse.json(
      { error: "Invalid credentials." },
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
      { error: "Unable to resolve account email for PIN login." },
      { status: 500 },
    );
  }

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink(
    {
      type: "magiclink",
      email: resolvedEmail,
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
    email: resolvedEmail,
  });
}
