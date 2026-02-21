import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Profile, ThemePreference } from "@/lib/types";

interface UpdateAccountBody {
  fullName?: string;
  email?: string;
  password?: string;
  themePreference?: ThemePreference;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hasOwn<T extends object>(value: T, key: keyof UpdateAccountBody): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export async function PATCH(request: NextRequest) {
  const supabaseAdmin = getSupabaseAdminClient();
  const requester = await getRequestProfile(request);

  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as UpdateAccountBody;

  const includeFullName = hasOwn(body, "fullName");
  const includeEmail = hasOwn(body, "email");
  const includePassword = hasOwn(body, "password");
  const includeThemePreference = hasOwn(body, "themePreference");

  if (!includeFullName && !includeEmail && !includePassword && !includeThemePreference) {
    return NextResponse.json(
      { error: "fullName, email, password, or themePreference is required." },
      { status: 400 },
    );
  }

  const fullName = body.fullName?.trim();
  const normalizedEmail = body.email?.trim().toLowerCase();
  const password = body.password?.trim();
  const themePreference = body.themePreference;

  if (includeFullName && !fullName) {
    return NextResponse.json(
      { error: "Full name cannot be empty." },
      { status: 400 },
    );
  }

  if (fullName && fullName.length > 120) {
    return NextResponse.json(
      { error: "Full name is too long (max 120 characters)." },
      { status: 400 },
    );
  }

  if (includeEmail) {
    if (!normalizedEmail) {
      return NextResponse.json(
        { error: "Email cannot be empty." },
        { status: 400 },
      );
    }

    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
    }
  }

  if (includePassword) {
    if (!password) {
      return NextResponse.json(
        { error: "Password cannot be empty." },
        { status: 400 },
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 },
      );
    }
  }

  if (includeThemePreference) {
    if (themePreference !== "light" && themePreference !== "dark") {
      return NextResponse.json(
        { error: "Theme must be either light or dark." },
        { status: 400 },
      );
    }
  }

  const authUpdate: {
    email?: string;
    email_confirm?: boolean;
    password?: string;
    user_metadata?: Record<string, string>;
  } = {};
  const profileUpdate: Partial<Pick<Profile, "full_name" | "email" | "theme_preference">> = {};

  if (fullName && fullName !== requester.full_name) {
    authUpdate.user_metadata = {
      full_name: fullName,
    };
    profileUpdate.full_name = fullName;
  }

  if (normalizedEmail && normalizedEmail !== requester.email.toLowerCase()) {
    authUpdate.email = normalizedEmail;
    authUpdate.email_confirm = true;
    profileUpdate.email = normalizedEmail;
  }

  if (password) {
    authUpdate.password = password;
  }

  if (
    includeThemePreference &&
    themePreference &&
    themePreference !== requester.theme_preference
  ) {
    profileUpdate.theme_preference = themePreference;
  }

  if (Object.keys(authUpdate).length > 0) {
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
      requester.id,
      authUpdate,
    );

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }
  }

  if (Object.keys(profileUpdate).length > 0) {
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update(profileUpdate)
      .eq("id", requester.id);

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }
  }

  const { data: profile, error: readError } = await supabaseAdmin
    .from("profiles")
    .select("id, email, full_name, role, is_active, theme_preference, created_at, updated_at")
    .eq("id", requester.id)
    .maybeSingle<Profile>();

  if (readError || !profile) {
    return NextResponse.json(
      { error: "Account updated, but profile refresh failed." },
      { status: 500 },
    );
  }

  return NextResponse.json({ profile });
}
