import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getUserSettingAtPath,
  normalizeUserSettings,
  parseUserSettingsPath,
  setUserSettingAtPath,
} from "@/lib/user-settings";

interface UpdateUserSettingsBody {
  path?: unknown;
  value?: unknown;
}

async function readUserSettingsForUser(userId: string) {
  const supabaseAdmin = getSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("user_settings")
    .eq("id", userId)
    .maybeSingle<{ user_settings: unknown }>();

  if (error) {
    return { settings: null, error: error.message };
  }

  return {
    settings: normalizeUserSettings(data?.user_settings),
    error: null,
  };
}

export async function GET(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const parsedPath = request.nextUrl.searchParams.get("path");
  const pathSegments = parsedPath ? parseUserSettingsPath(parsedPath) : null;
  if (parsedPath && !pathSegments) {
    return NextResponse.json(
      { error: "path must be a dot-delimited key path." },
      { status: 400 },
    );
  }

  const { settings, error } = await readUserSettingsForUser(requester.id);
  if (error || !settings) {
    return NextResponse.json(
      { error: error ?? "Unable to load user settings." },
      { status: 500 },
    );
  }

  if (!pathSegments) {
    return NextResponse.json({ settings });
  }

  const value = getUserSettingAtPath(settings, pathSegments);
  return NextResponse.json({
    path: pathSegments.join("."),
    value: value ?? null,
  });
}

export async function PATCH(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as UpdateUserSettingsBody;
  const pathSegments = parseUserSettingsPath(body.path);
  if (!pathSegments) {
    return NextResponse.json(
      { error: "path must be a dot-delimited key path." },
      { status: 400 },
    );
  }

  if (!Object.prototype.hasOwnProperty.call(body, "value")) {
    return NextResponse.json(
      { error: "value is required." },
      { status: 400 },
    );
  }

  const { settings: currentSettings, error: readError } = await readUserSettingsForUser(
    requester.id,
  );
  if (readError || !currentSettings) {
    return NextResponse.json(
      { error: readError ?? "Unable to load user settings." },
      { status: 500 },
    );
  }

  const nextSettings = setUserSettingAtPath(currentSettings, pathSegments, body.value);

  const supabaseAdmin = getSupabaseAdminClient();
  const { error: updateError } = await supabaseAdmin
    .from("profiles")
    .update({
      user_settings: nextSettings,
    })
    .eq("id", requester.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const value = getUserSettingAtPath(nextSettings, pathSegments);
  return NextResponse.json({
    path: pathSegments.join("."),
    value: value ?? null,
  });
}
