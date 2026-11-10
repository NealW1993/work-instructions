import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { getRequestProfile } from "@/lib/api-auth";
import { isWeakPin, PIN_POLICY_MESSAGE } from "@/lib/pin-policy";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AppRole, Profile } from "@/lib/types";
import { ACCOUNT_MANAGEMENT_DENIED, canManageAccounts } from "@/lib/user-management";
import { isValidEmployeeId, normalizeEmployeeId } from "@/lib/utils";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface CreateUserBody {
  fullName?: string;
  email?: string;
  employeeId?: string;
  pin?: string;
  role?: AppRole;
}

function validateRole(role: string): role is AppRole {
  return role === "user" || role === "admin" || role === "system_admin";
}

/** Listing and creating accounts is for system admins only. */
async function requireAccountManager(request: NextRequest) {
  const profile = await getRequestProfile(request);

  if (!profile) {
    return {
      error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
      profile: null,
    };
  }

  if (!canManageAccounts(profile.role)) {
    return {
      error: NextResponse.json(
        { error: ACCOUNT_MANAGEMENT_DENIED },
        { status: 403 },
      ),
      profile,
    };
  }

  return { error: null, profile };
}

export async function GET(request: NextRequest) {
  const supabaseAdmin = getSupabaseAdminClient();
  const auth = await requireAccountManager(request);

  if (auth.error) {
    return auth.error;
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email, employee_id, full_name, role, is_active, created_at, inactivity_timeout_minutes")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ users: data });
}

export async function POST(request: NextRequest) {
  const supabaseAdmin = getSupabaseAdminClient();
  const auth = await requireAccountManager(request);

  if (auth.error) {
    return auth.error;
  }

  const body = (await request.json().catch(() => ({}))) as CreateUserBody;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

  const fullName = text(body.fullName);
  const email = text(body.email).toLowerCase();
  const employeeId = normalizeEmployeeId(text(body.employeeId));
  const pin = text(body.pin);
  const role = body.role;

  if (!fullName || !email || !employeeId || !pin || !role) {
    return NextResponse.json(
      { error: "fullName, email, employeeId, pin, and role are required." },
      { status: 400 },
    );
  }

  if (!validateRole(role)) {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  }

  if (fullName.length > 120 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "Enter a valid name and email." }, { status: 400 });
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

  const { data: duplicateEmployee, error: duplicateError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("employee_id", employeeId)
    .limit(1);
  if (duplicateError) {
    return NextResponse.json({ error: duplicateError.message }, { status: 500 });
  }
  if ((duplicateEmployee?.length ?? 0) > 0) {
    return NextResponse.json({ error: "That employee ID already exists." }, { status: 409 });
  }

  const generatedPassword = `WI-${randomUUID()}!`;

  const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser(
    {
      email,
      password: generatedPassword,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        employee_id: employeeId,
      },
    },
  );

  if (createError || !createdUser.user) {
    return NextResponse.json(
      { error: createError?.message ?? "Unable to create auth user." },
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

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, email, employee_id, full_name, role, is_active, created_at, updated_at, inactivity_timeout_minutes")
    .eq("id", userId)
    .single<Profile>();

  return NextResponse.json({ user: profile });
}
