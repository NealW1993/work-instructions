import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/env.server";
import { isWeakPin, PIN_POLICY_MESSAGE } from "@/lib/pin-policy";
import { clientAddress, consumeRateLimit } from "@/lib/rate-limit.server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isValidEmployeeId, normalizeEmployeeId } from "@/lib/utils";

interface RegisterBody {
  fullName?: string;
  email?: string;
  employeeId?: string;
  pin?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as RegisterBody;
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const employeeId = normalizeEmployeeId(typeof body?.employeeId === "string" ? body.employeeId : "");
  const pin = typeof body?.pin === "string" ? body.pin.trim() : "";

  if (!fullName || !email || !employeeId || !pin) {
    return NextResponse.json(
      { error: "fullName, email, employeeId, and pin are required." },
      { status: 400 },
    );
  }

  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }

  if (email === serverEnv.SYSTEM_ADMIN_EMAIL.trim().toLowerCase()) {
    return NextResponse.json(
      { error: "The initial administrator account must be provisioned by a trusted administrator in Supabase. Contact your system owner." },
      { status: 403 },
    );
  }
  if (fullName.length > 120 || email.length > 254) {
    return NextResponse.json({ error: "Name or email is too long." }, { status: 400 });
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

  if (isWeakPin(pin)) {
    return NextResponse.json({ error: PIN_POLICY_MESSAGE }, { status: 400 });
  }

  // Self-registration is public, so limit how many accounts one device can attempt to create.
  const registrationLimit = consumeRateLimit(`register:${clientAddress(request)}`, 10, 60 * 60 * 1000);
  if (!registrationLimit.allowed) {
    return NextResponse.json(
      { error: "Too many accounts were requested from this device. Try again later or ask an administrator." },
      { status: 429, headers: { "Retry-After": String(registrationLimit.retryAfterSeconds) } },
    );
  }

  const supabaseAdmin = getSupabaseAdminClient();

  const { data: duplicateByEmployeeId, error: duplicateByEmployeeIdError } =
    await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("employee_id", employeeId)
      .limit(1);

  if (duplicateByEmployeeIdError) {
    return NextResponse.json({ error: duplicateByEmployeeIdError.message }, { status: 500 });
  }

  if ((duplicateByEmployeeId?.length ?? 0) > 0) {
    return NextResponse.json(
      { error: "That employee ID already exists." },
      { status: 409 },
    );
  }

  const generatedPassword = `WI-${randomUUID()}!`;
  const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: generatedPassword,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      employee_id: employeeId,
    },
  });

  if (createError || !createdUser.user?.id) {
    const createMessage = (createError?.message ?? "Unable to create account.").toLowerCase();
    if (createMessage.includes("already registered") || createMessage.includes("already exists")) {
      return NextResponse.json(
        { error: "That account already exists. Sign in with PIN." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: createError?.message ?? "Unable to create account." },
      { status: 500 },
    );
  }

  const userId = createdUser.user.id;
  let profileCreated = false;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (existingProfile) {
      profileCreated = true;
      break;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });
  }

  if (!profileCreated) {
    await supabaseAdmin.auth.admin.deleteUser(userId);
    return NextResponse.json(
      { error: "Profile trigger did not create profile row." },
      { status: 500 },
    );
  }

  const { error: profileUpdateError } = await supabaseAdmin
    .from("profiles")
    .update({
      full_name: fullName,
      employee_id: employeeId,
      role: "user",
    })
    .eq("id", userId);

  if (profileUpdateError) {
    await supabaseAdmin.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: profileUpdateError.message }, { status: 500 });
  }

  const { error: pinError } = await supabaseAdmin.rpc("set_user_pin", {
    target_user_id: userId,
    new_pin: pin,
  });

  if (pinError) {
    await supabaseAdmin.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: pinError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    promoted: false,
  });
}
