import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface ConfirmResetBody {
  email?: string;
  token?: string;
  newPassword?: string;
}

export async function POST(request: Request) {
  const supabaseAdmin = getSupabaseAdminClient();
  const body = (await request.json().catch(() => ({}))) as ConfirmResetBody;

  const email = body.email?.trim().toLowerCase();
  const token = body.token?.trim();
  const newPassword = body.newPassword?.trim();

  if (!email || !token || !newPassword) {
    return NextResponse.json(
      { error: "Email, token, and new password are required." },
      { status: 400 },
    );
  }

  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const { data: resetToken, error: tokenError } = await supabaseAdmin
    .from("password_reset_tokens")
    .select("id, user_id, expires_at")
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .gte("expires_at", new Date().toISOString())
    .maybeSingle<{ id: string; user_id: string; expires_at: string }>();

  if (tokenError || !resetToken) {
    return NextResponse.json(
      { error: "Reset token is invalid or expired." },
      { status: 400 },
    );
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("id", resetToken.user_id)
    .ilike("email", email)
    .maybeSingle<{ id: string }>();

  if (!profile) {
    return NextResponse.json(
      { error: "Reset token does not match this email." },
      { status: 400 },
    );
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    resetToken.user_id,
    {
      password: newPassword,
    },
  );

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const { error: markUsedError } = await supabaseAdmin
    .from("password_reset_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", resetToken.id);

  if (markUsedError) {
    return NextResponse.json({ error: markUsedError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
