import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getUserSettingAtPath,
  normalizeUserSettings,
  parseUserSettingsPath,
  setUserSettingAtPath,
} from "@/lib/user-settings";

interface UserSettingsRecord {
  user_settings: unknown;
}

const MAX_SAVE_ATTEMPTS = 4;

function json(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function readUserSettingsForUser(userId: string) {
  return getSupabaseAdminClient()
    .from("profiles")
    .select("user_settings")
    .eq("id", userId)
    .eq("is_active", true)
    .maybeSingle<UserSettingsRecord>();
}

export async function GET(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) return json({ error: "Unauthorized." }, 401);

  const parsedPath = request.nextUrl.searchParams.get("path");
  const pathSegments = parsedPath ? parseUserSettingsPath(parsedPath) : null;
  if (parsedPath && !pathSegments) {
    return json({ error: "path must be a dot-delimited key path." }, 400);
  }

  const { data, error } = await readUserSettingsForUser(requester.id);
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "Your active profile could not be found. Sign in again before changing settings." }, 404);
  const settings = normalizeUserSettings(data.user_settings);

  if (!pathSegments) {
    return json({ settings });
  }

  const value = getUserSettingAtPath(settings, pathSegments);
  return json({
    path: pathSegments.join("."),
    value: value ?? null,
  });
}

export async function PATCH(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) return json({ error: "Unauthorized." }, 401);

  const rawBody: unknown = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return json({ error: "A settings update object is required." }, 400);
  }
  const body = rawBody as Record<string, unknown>;
  const pathSegments = parseUserSettingsPath(body.path);
  if (!pathSegments) {
    return json({ error: "path must be a dot-delimited key path." }, 400);
  }

  if (!Object.prototype.hasOwnProperty.call(body, "value")) {
    return json({ error: "value is required." }, 400);
  }

  const supabaseAdmin = getSupabaseAdminClient();
  for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt++) {
    const { data: current, error: readError } = await readUserSettingsForUser(requester.id);
    if (readError) return json({ error: readError.message }, 500);
    if (!current) return json({ error: "Your active profile could not be found. Sign in again before changing settings." }, 404);

    const nextSettings = setUserSettingAtPath(current.user_settings, pathSegments, body.value);
    let update = supabaseAdmin.from("profiles").update({ user_settings: nextSettings })
      .eq("id", requester.id)
      .eq("is_active", true);
    // Compare the original JSON in the same statement as the write. If another
    // request changed a sibling preference, reread it before applying this path.
    update = current.user_settings == null
      ? update.is("user_settings", null)
      : update.eq("user_settings", JSON.stringify(current.user_settings));
    const { data: saved, error: updateError } = await update.select("user_settings")
      .maybeSingle<UserSettingsRecord>();
    if (updateError) return json({ error: updateError.message }, 500);
    if (saved) {
      return json({
        path: pathSegments.join("."),
        value: getUserSettingAtPath(saved.user_settings, pathSegments) ?? null,
      });
    }
  }

  return json({ error: "Your settings changed repeatedly while saving. This change was not saved. Try again." }, 409);
}
