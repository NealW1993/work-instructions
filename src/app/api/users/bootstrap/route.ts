import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { serverEnv } from "@/lib/env.server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const supabaseAdmin = getSupabaseAdminClient();
  const profile = await getRequestProfile(request);

  if (!profile) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (profile.role === "system_admin") {
    return NextResponse.json({ success: true, promoted: false });
  }

  if (!serverEnv.SYSTEM_ADMIN_EMAIL) {
    return NextResponse.json(
      { error: "SYSTEM_ADMIN_EMAIL is not configured." },
      { status: 400 },
    );
  }

  const token = request.headers.get("authorization")?.slice(7).trim() ?? "";
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
  const configuredEmail = serverEnv.SYSTEM_ADMIN_EMAIL.trim().toLowerCase();
  if (userError || !user?.email_confirmed_at || user.email?.trim().toLowerCase() !== configuredEmail ||
      profile.email.trim().toLowerCase() !== configuredEmail) {
    return NextResponse.json(
      { error: "This account is not authorized for bootstrap promotion." },
      { status: 403 },
    );
  }

  const { data: admins, error: lookupError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("role", "system_admin")
    .limit(1);

  if (lookupError) {
    return NextResponse.json({ error: "Unable to verify administrator setup." }, { status: 500 });
  }

  if ((admins?.length ?? 0) > 0 && admins?.[0]?.id !== profile.id) {
    return NextResponse.json(
      { error: "A system admin already exists." },
      { status: 409 },
    );
  }

  const { error: updateError } = await supabaseAdmin
    .from("profiles")
    .update({ role: "system_admin" })
    .eq("id", profile.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, promoted: true });
}
