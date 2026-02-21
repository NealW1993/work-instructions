import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/env.server";
import { sendPasswordResetEmail } from "@/lib/mailer";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface RequestResetBody {
  email?: string;
}

function resolveResetAppOrigin(request: Request): string {
  const requestUrl = new URL(request.url);
  const configuredAppUrl = serverEnv.NEXT_PUBLIC_APP_URL.trim();

  if (!configuredAppUrl) {
    return requestUrl.origin;
  }

  let configuredUrl: URL;
  try {
    configuredUrl = new URL(configuredAppUrl);
  } catch {
    return requestUrl.origin;
  }

  const configuredHost = configuredUrl.hostname.toLowerCase();
  const requestHost = requestUrl.hostname.toLowerCase();
  const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
  const isLocalDev = localHosts.has(configuredHost) || localHosts.has(requestHost);

  if (!isLocalDev) {
    return configuredUrl.origin;
  }

  const localHostname = requestHost === "0.0.0.0" ? "localhost" : requestHost;
  return `${requestUrl.protocol}//${localHostname}:3000`;
}

export async function POST(request: Request) {
  const supabaseAdmin = getSupabaseAdminClient();
  const body = (await request.json().catch(() => ({}))) as RequestResetBody;
  const email = body.email?.trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, email, full_name")
    .ilike("email", email)
    .maybeSingle<{ id: string; email: string; full_name: string }>();

  if (!profile) {
    return NextResponse.json({ success: true });
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  await supabaseAdmin
    .from("password_reset_tokens")
    .delete()
    .eq("user_id", profile.id)
    .is("used_at", null);

  const { error: tokenInsertError } = await supabaseAdmin
    .from("password_reset_tokens")
    .insert({
      user_id: profile.id,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

  if (tokenInsertError) {
    return NextResponse.json({ error: tokenInsertError.message }, { status: 500 });
  }

  const resetOrigin = resolveResetAppOrigin(request);
  const resetLink = `${resetOrigin}/reset-password?token=${rawToken}&email=${encodeURIComponent(
    profile.email,
  )}`;

  await sendPasswordResetEmail({
    to: profile.email,
    fullName: profile.full_name,
    resetLink,
  });

  return NextResponse.json({ success: true });
}
