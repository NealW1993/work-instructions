import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { type AiSettingsAction, type AiSettingsEvent, type AiSettingsStatus, isAiProviderId } from "@/lib/ai-providers";
import { loadStoredAiSettings, openStoredAiKey } from "@/lib/ai-provider.server";
import { serverEnv } from "@/lib/env.server";
import { isSystemAdmin } from "@/lib/roles";
import { secretEncryptionStatus, sealedWithCurrentKey } from "@/lib/secret-box.server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";

/** Responses about the AI key are never stored by browsers or proxies. */
export const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" } as const;

export function aiSettingsJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

/** Only system admins can see or change AI provider settings. */
export async function requireAiSettingsAdmin(request: NextRequest): Promise<{ profile: Profile; response?: undefined } | { profile?: undefined; response: NextResponse }> {
  const profile = await getRequestProfile(request);
  if (!profile) return { response: aiSettingsJson({ error: "Unauthorized." }, 401) };
  if (!isSystemAdmin(profile.role)) return { response: aiSettingsJson({ error: "Only a system admin can manage the AI provider key." }, 403) };
  return { profile };
}

/** Returns false when the record could not be written. */
export async function recordAiSettingsEvent(action: AiSettingsAction, actorUserId: string, provider: string | null): Promise<boolean> {
  const { error } = await getSupabaseAdminClient()
    .from("ai_settings_audit_events")
    .insert({ action, actor_user_id: actorUserId, provider });
  if (error) console.error("Could not record an AI settings activity event.", error.message);
  return !error;
}

/**
 * Confirms the signed-in system admin's own PIN before the key is changed, shown or removed, so a
 * session left open on a shared screen is not enough. Wrong PINs count toward the same lockout as
 * sign-in (ten in a row lock the account's PIN for a minute).
 */
export async function verifyStepUpPin(profile: Profile, pin: unknown): Promise<NextResponse | null> {
  if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) {
    return aiSettingsJson({ error: "Enter your 6-digit PIN to continue." }, 400);
  }
  const identifier = profile.employee_id?.trim() || profile.email.trim().toLowerCase();
  const { data, error } = await getSupabaseAdminClient().rpc("verify_pin_login", { login_identifier: identifier, submitted_pin: pin });
  if (error?.code === "P0429") {
    await recordAiSettingsEvent("pin_locked", profile.id, null);
    return aiSettingsJson({ error: "Too many incorrect PIN entries. Try again in a minute." }, 429);
  }
  if (error) return aiSettingsJson({ error: "Your PIN could not be checked right now. Try again shortly." }, 500);
  if (data !== profile.id) {
    await recordAiSettingsEvent("pin_failed", profile.id, null);
    return aiSettingsJson({ error: "That PIN is incorrect." }, 401);
  }
  return null;
}

/** "…a1B2": enough to recognise a key without revealing it. */
export function keyHint(apiKey: string) {
  return `…${apiKey.slice(-4)}`;
}

/** Everything the settings screen shows. Never includes the key itself. */
export async function getAiSettingsStatus(): Promise<AiSettingsStatus> {
  const encryption = secretEncryptionStatus();
  const { settings, error } = await loadStoredAiSettings();
  const supabaseAdmin = getSupabaseAdminClient();
  const { data: eventRows } = await supabaseAdmin
    .from("ai_settings_audit_events")
    .select("action, provider, actor_user_id, created_at")
    .order("created_at", { ascending: false })
    .limit(12);
  const actorIds = [...new Set([settings?.updated_by, ...(eventRows ?? []).map((row) => row.actor_user_id)].filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: people } = await supabaseAdmin.from("profiles").select("id, full_name, email").in("id", actorIds);
    for (const person of people ?? []) names.set(person.id, person.full_name || person.email);
  }
  const events: AiSettingsEvent[] = (eventRows ?? []).map((row) => ({
    action: row.action as AiSettingsAction,
    provider: row.provider,
    actorName: (row.actor_user_id && names.get(row.actor_user_id)) || "Unknown user",
    createdAt: row.created_at,
  }));

  if (settings && isAiProviderId(settings.provider)) {
    return {
      available: true,
      encryption,
      source: "app",
      provider: settings.provider,
      model: settings.model,
      keyHint: settings.key_hint,
      keyReadable: sealedWithCurrentKey({ keyFingerprint: settings.key_fingerprint }) && openStoredAiKey(settings) !== null,
      environmentFallback: Boolean(serverEnv.OPENAI_API_KEY),
      updatedAt: settings.updated_at,
      updatedByName: (settings.updated_by && names.get(settings.updated_by)) || null,
      events,
    };
  }
  return {
    available: !error,
    encryption,
    source: serverEnv.OPENAI_API_KEY ? "environment" : "none",
    provider: serverEnv.OPENAI_API_KEY ? "openai" : null,
    model: serverEnv.OPENAI_API_KEY ? serverEnv.OPENAI_ENHANCE_MODEL : null,
    keyHint: serverEnv.OPENAI_API_KEY ? keyHint(serverEnv.OPENAI_API_KEY) : null,
    keyReadable: Boolean(serverEnv.OPENAI_API_KEY),
    environmentFallback: Boolean(serverEnv.OPENAI_API_KEY),
    updatedAt: null,
    updatedByName: null,
    events,
  };
}
