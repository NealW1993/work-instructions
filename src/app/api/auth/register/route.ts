import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/env.server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AppRole } from "@/lib/types";
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
  const fullName = body.fullName?.trim() ?? "";
  const email = body.email?.trim().toLowerCase() ?? "";
  const employeeId = normalizeEmployeeId(body.employeeId ?? "");
  const pin = body.pin?.trim() ?? "";

  if (!fullName || !email || !employeeId || !pin) {
    return NextResponse.json(
      { error: "fullName, email, employeeId, and pin are required." },
      { status: 400 },
    );
  }

  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
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

  let role: AppRole = "user";
  const systemAdminEmail = serverEnv.SYSTEM_ADMIN_EMAIL.trim().toLowerCase();
  if (systemAdminEmail && email === systemAdminEmail) {
    const { data: admins, error: adminLookupError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("role", "system_admin")
      .neq("id", userId)
      .limit(1);

    if (adminLookupError) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: adminLookupError.message }, { status: 500 });
    }

    if ((admins?.length ?? 0) === 0) {
      role = "system_admin";
    }
  }

  const { error: profileUpdateError } = await supabaseAdmin
    .from("profiles")
    .update({
      full_name: fullName,
      employee_id: employeeId,
      role,
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
    promoted: role === "system_admin",
  });
}
