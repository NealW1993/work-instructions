import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AppRole, Profile } from "@/lib/types";
import { isValidEmployeeId, normalizeEmployeeId } from "@/lib/utils";

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

async function requireSystemAdmin(request: NextRequest) {
  const profile = await getRequestProfile(request);

  if (!profile) {
    return {
      error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
      profile: null,
    };
  }

  if (profile.role !== "system_admin") {
    return {
      error: NextResponse.json(
        { error: "System admin privileges required." },
        { status: 403 },
      ),
      profile,
    };
  }

  return { error: null, profile };
}

export async function GET(request: NextRequest) {
  const supabaseAdmin = getSupabaseAdminClient();
  const auth = await requireSystemAdmin(request);

  if (auth.error) {
    return auth.error;
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email, employee_id, full_name, role, is_active, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ users: data });
}

export async function POST(request: NextRequest) {
  const supabaseAdmin = getSupabaseAdminClient();
  const auth = await requireSystemAdmin(request);

  if (auth.error) {
    return auth.error;
  }

  const body = (await request.json().catch(() => ({}))) as CreateUserBody;

  const fullName = body.fullName?.trim();
  const email = body.email?.trim().toLowerCase();
  const employeeId = normalizeEmployeeId(body.employeeId ?? "");
  const pin = body.pin?.trim();
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
    .select("id, email, employee_id, full_name, role, is_active, created_at, updated_at")
    .eq("id", userId)
    .single<Profile>();

  return NextResponse.json({ user: profile });
}
