import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const DASHBOARD_AI_SEARCH_SETTING_KEY = "dashboard_ai_search_enabled";

export interface OpenAiTokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}

export interface NormalizedTokenUsage {
  tokenInput: number;
  tokenOutput: number;
  tokenTotal: number;
}

export interface AiUsageEventInput {
  actorUserId: string;
  feature: string;
  action: string;
  mode?: string;
  subjectType?: string;
  subjectId?: string | null;
  model?: string;
  tokenInput?: number;
  tokenOutput?: number;
  tokenTotal?: number;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

interface SystemSettingRow {
  value: unknown;
}

function toNonNegativeInteger(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.round(value);
}

export function normalizeOpenAiTokenUsage(
  usage: OpenAiTokenUsage | null | undefined,
): NormalizedTokenUsage {
  const tokenInput = toNonNegativeInteger(usage?.prompt_tokens ?? usage?.input_tokens);
  const tokenOutput = toNonNegativeInteger(
    usage?.completion_tokens ?? usage?.output_tokens,
  );
  const tokenTotal = toNonNegativeInteger(usage?.total_tokens) || tokenInput + tokenOutput;

  return {
    tokenInput,
    tokenOutput,
    tokenTotal,
  };
}

function parseBooleanSetting(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const enabled = (value as { enabled?: unknown }).enabled;
    if (typeof enabled === "boolean") {
      return enabled;
    }
  }

  return fallback;
}

export async function getDashboardAiSearchEnabled(
  supabaseAdmin: SupabaseClient = getSupabaseAdminClient(),
) {
  const { data, error } = await supabaseAdmin
    .from("system_settings")
    .select("value")
    .eq("key", DASHBOARD_AI_SEARCH_SETTING_KEY)
    .maybeSingle<SystemSettingRow>();

  if (error) {
    return true;
  }

  return parseBooleanSetting(data?.value, true);
}

export async function setDashboardAiSearchEnabled(input: {
  enabled: boolean;
  updatedBy: string;
  supabaseAdmin?: SupabaseClient;
}) {
  const supabaseAdmin = input.supabaseAdmin ?? getSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from("system_settings")
    .upsert(
      {
        key: DASHBOARD_AI_SEARCH_SETTING_KEY,
        value: input.enabled,
        updated_by: input.updatedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    )
    .select("value")
    .single<SystemSettingRow>();

  if (error) {
    throw new Error(error.message);
  }

  return parseBooleanSetting(data?.value, input.enabled);
}

export async function recordAiUsageEvent(input: AiUsageEventInput) {
  const feature = input.feature.trim();
  const action = input.action.trim();

  if (!feature || !action) {
    return false;
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { error } = await supabaseAdmin.from("ai_usage_events").insert({
    actor_user_id: input.actorUserId,
    feature,
    action,
    mode: input.mode?.trim() ?? "",
    subject_type: input.subjectType?.trim() ?? "",
    subject_id: input.subjectId ?? null,
    token_input: toNonNegativeInteger(input.tokenInput),
    token_output: toNonNegativeInteger(input.tokenOutput),
    token_total: toNonNegativeInteger(input.tokenTotal),
    model: input.model?.trim() ?? "",
    metadata: input.metadata ?? {},
    created_at: input.createdAt ?? new Date().toISOString(),
  });

  return !error;
}
