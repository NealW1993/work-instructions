import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { normalizeNotificationSettings } from "@/lib/notification-settings";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Profile, ThemePreference } from "@/lib/types";

interface UpdateAccountBody {
  fullName?: string;
  email?: string;
  themePreference?: ThemePreference;
  iconColor?: string;
  fontColor?: string;
  notificationSettings?: unknown;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ICON_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const FONT_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const DEFAULT_ICON_COLOR = "#0EA5E9";
const DEFAULT_FONT_COLOR = "#FFFFFF";

function normalizeIconColor(value: string | undefined) {
  if (!value) {
    return "";
  }

  return value.trim().toUpperCase();
}

function normalizeFontColor(value: string | undefined) {
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
  const includeThemePreference = hasOwn(body, "themePreference");
  const includeIconColor = hasOwn(body, "iconColor");
  const includeFontColor = hasOwn(body, "fontColor");
  const includeNotificationSettings = hasOwn(body, "notificationSettings");

  if (
    !includeFullName &&
    !includeEmail &&
    !includeThemePreference &&
    !includeIconColor &&
    !includeFontColor &&
    !includeNotificationSettings
  ) {
    return NextResponse.json(
      {
        error:
          "fullName, email, themePreference, iconColor, fontColor, or notificationSettings is required.",
      },
      { status: 400 },
    );
  }

  const fullName = body.fullName?.trim();
  const normalizedEmail = body.email?.trim().toLowerCase();
  const themePreference = body.themePreference;
  const normalizedIconColor = normalizeIconColor(body.iconColor);
  const normalizedFontColor = normalizeFontColor(body.fontColor);
  const notificationSettings = includeNotificationSettings
    ? normalizeNotificationSettings(body.notificationSettings)
    : null;

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

  if (includeFontColor) {
    if (!normalizedFontColor) {
      return NextResponse.json(
        { error: "Font color cannot be empty." },
        { status: 400 },
      );
    }

    if (!FONT_COLOR_PATTERN.test(normalizedFontColor)) {
      return NextResponse.json(
        { error: "Font color must be a valid hex color like #FFFFFF." },
        { status: 400 },
      );
    }
  }

  const authUpdate: {
    email?: string;
    email_confirm?: boolean;
    user_metadata?: Record<string, string>;
  } = {};
  const authMetadata: Record<string, string> = {};
  const profileUpdate: Partial<
    Pick<
      Profile,
      "full_name" | "email" | "theme_preference" | "icon_color" | "font_color"
    >
  > & { user_settings?: Record<string, unknown> } = {};

  if (fullName && fullName !== requester.full_name) {
    authMetadata.full_name = fullName;
    profileUpdate.full_name = fullName;
  }

  if (normalizedEmail && normalizedEmail !== requester.email.toLowerCase()) {
    authUpdate.email = normalizedEmail;
    authUpdate.email_confirm = true;
    profileUpdate.email = normalizedEmail;
  }

  if (Object.keys(authMetadata).length > 0) {
    authUpdate.user_metadata = authMetadata;
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

  if (
    includeFontColor &&
    normalizedFontColor &&
    normalizedFontColor !== (requester.font_color ?? DEFAULT_FONT_COLOR)
  ) {
    profileUpdate.font_color = normalizedFontColor;
  }

  if (notificationSettings) {
    const currentUserSettings =
      requester.user_settings &&
      typeof requester.user_settings === "object" &&
      !Array.isArray(requester.user_settings)
        ? (requester.user_settings as Record<string, unknown>)
        : {};
    profileUpdate.user_settings = {
      ...currentUserSettings,
      notifications: notificationSettings,
    };
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
      "id, email, employee_id, full_name, role, is_active, theme_preference, icon_color, font_color, user_settings, created_at, updated_at",
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
