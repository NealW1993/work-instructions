import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Profile, ThemePreference } from "@/lib/types";
import { isValidEmployeeId, normalizeEmployeeId } from "@/lib/utils";

interface UpdateAccountBody {
  fullName?: string;
  email?: string;
  employeeId?: string;
  password?: string;
  themePreference?: ThemePreference;
  iconColor?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ICON_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const DEFAULT_ICON_COLOR = "#0EA5E9";

function normalizeIconColor(value: string | undefined) {
  if (!value) {
    return "";
  }

  return value.trim().toUpperCase();
}

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
  const includeEmployeeId = hasOwn(body, "employeeId");
  const includePassword = hasOwn(body, "password");
  const includeThemePreference = hasOwn(body, "themePreference");
  const includeIconColor = hasOwn(body, "iconColor");

  if (
    !includeFullName &&
    !includeEmail &&
    !includeEmployeeId &&
    !includePassword &&
    !includeThemePreference &&
    !includeIconColor
  ) {
    return NextResponse.json(
      {
        error:
          "fullName, email, employeeId, password, themePreference, or iconColor is required.",
      },
      { status: 400 },
    );
  }

  const fullName = body.fullName?.trim();
  const normalizedEmail = body.email?.trim().toLowerCase();
  const normalizedEmployeeId = normalizeEmployeeId(body.employeeId ?? "");
  const password = body.password?.trim();
  const themePreference = body.themePreference;
  const normalizedIconColor = normalizeIconColor(body.iconColor);

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

  if (includeEmployeeId) {
    if (!normalizedEmployeeId) {
      return NextResponse.json(
        { error: "Employee ID cannot be empty." },
        { status: 400 },
      );
    }

    if (!isValidEmployeeId(normalizedEmployeeId)) {
      return NextResponse.json(
        { error: "Employee ID must be 1-6 digits." },
        { status: 400 },
      );
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

  if (includeIconColor) {
    if (!normalizedIconColor) {
      return NextResponse.json(
        { error: "Icon color cannot be empty." },
        { status: 400 },
      );
    }

    if (!ICON_COLOR_PATTERN.test(normalizedIconColor)) {
      return NextResponse.json(
        { error: "Icon color must be a valid hex color like #0EA5E9." },
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
  const authMetadata: Record<string, string> = {};
  const profileUpdate: Partial<
    Pick<Profile, "full_name" | "email" | "employee_id" | "theme_preference" | "icon_color">
  > = {};

  if (fullName && fullName !== requester.full_name) {
    authMetadata.full_name = fullName;
    profileUpdate.full_name = fullName;
  }

  if (normalizedEmail && normalizedEmail !== requester.email.toLowerCase()) {
    authUpdate.email = normalizedEmail;
    authUpdate.email_confirm = true;
    profileUpdate.email = normalizedEmail;
  }

  if (normalizedEmployeeId && normalizedEmployeeId !== (requester.employee_id ?? "")) {
    authMetadata.employee_id = normalizedEmployeeId;
    profileUpdate.employee_id = normalizedEmployeeId;
  }

  if (Object.keys(authMetadata).length > 0) {
    authUpdate.user_metadata = authMetadata;
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

  if (
    includeIconColor &&
    normalizedIconColor &&
    normalizedIconColor !== (requester.icon_color ?? DEFAULT_ICON_COLOR)
  ) {
    profileUpdate.icon_color = normalizedIconColor;
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
    .select(
      "id, email, employee_id, full_name, role, is_active, theme_preference, icon_color, created_at, updated_at",
    )
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
