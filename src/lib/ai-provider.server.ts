import "server-only";

import { type AiProviderId, isAiProviderId } from "@/lib/ai-providers";
import type { OpenAiTokenUsage } from "@/lib/ai-usage";
import { serverEnv } from "@/lib/env.server";
import { openSecret } from "@/lib/secret-box.server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/*
 * One place that talks to AI providers. The active provider, model and encrypted API key are saved
 * by a system admin in System Administration; until then the server's OPENAI_API_KEY is used.
 *
 * The key is decrypted only for the moment a request is sent, it is sent only to the provider's fixed
 * address below, and it never appears in responses, logs or error messages.
 */

export type AiPurpose = "enhance" | "search" | "diagram";

export interface AiConfig {
  provider: AiProviderId;
  model: string;
  apiKey: string;
  source: "app" | "environment";
}

const PROVIDER_ENDPOINTS: Record<AiProviderId, string> = {
  anthropic: "https://api.anthropic.com/v1/messages",
  openai: "https://api.openai.com/v1/chat/completions",
  xai: "https://api.x.ai/v1/chat/completions",
  google: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
};

/** There is one active AI configuration. */
export const AI_SETTINGS_ROW_ID = 1;

/** Authenticated with the encrypted key, so a sealed key only opens for the provider it was saved for. */
export function aiKeyContext(provider: AiProviderId) {
  return `ai-provider-key:${provider}`;
}

export interface StoredAiSettings {
  provider: string;
  model: string;
  key_ciphertext: string;
  key_iv: string;
  key_tag: string;
  key_fingerprint: string;
  key_hint: string;
  updated_by: string | null;
  updated_at: string;
}

export async function loadStoredAiSettings(): Promise<{ settings: StoredAiSettings | null; error: string | null }> {
  const { data, error } = await getSupabaseAdminClient()
    .from("ai_provider_settings")
    .select("provider, model, key_ciphertext, key_iv, key_tag, key_fingerprint, key_hint, updated_by, updated_at")
    .eq("id", AI_SETTINGS_ROW_ID)
    .maybeSingle<StoredAiSettings>();
  return { settings: data ?? null, error: error?.message ?? null };
}

/** Decrypts a stored key, or returns null when the server's encryption key changed or the data was altered. */
export function openStoredAiKey(settings: StoredAiSettings): string | null {
  if (!isAiProviderId(settings.provider)) return null;
  return openSecret(
    { ciphertext: settings.key_ciphertext, iv: settings.key_iv, tag: settings.key_tag, keyFingerprint: settings.key_fingerprint },
    aiKeyContext(settings.provider),
  );
}

function environmentModel(purpose: AiPurpose) {
  if (purpose === "search") return serverEnv.OPENAI_SEARCH_MODEL;
  if (purpose === "diagram") return serverEnv.OPENAI_DIAGRAM_MODEL;
  return serverEnv.OPENAI_ENHANCE_MODEL;
}

/** The provider, model and key to use, or null when AI is not configured. */
export async function getAiConfig(purpose: AiPurpose): Promise<AiConfig | null> {
  const { settings, error } = await loadStoredAiSettings();
  if (settings) {
    const apiKey = openStoredAiKey(settings);
    if (!apiKey || !isAiProviderId(settings.provider)) {
      // An explicit app setting is never silently replaced by the environment key.
      console.error("The saved AI provider key could not be decrypted with the server's AI_KEY_ENCRYPTION_KEY. A system admin must enter the key again.");
      return null;
    }
    return { provider: settings.provider, model: settings.model, apiKey, source: "app" };
  }
  if (error) console.error("AI provider settings could not be read; using the server environment key if one is set.", error);
  if (serverEnv.OPENAI_API_KEY) {
    return { provider: "openai", model: environmentModel(purpose), apiKey: serverEnv.OPENAI_API_KEY, source: "environment" };
  }
  return null;
}

/** Shown to users when no provider is configured. */
export const AI_NOT_CONFIGURED_MESSAGE = "AI is not set up. A system admin can add an AI provider key in System Administration.";

/** A tiny request that proves the key and model work. */
export const CONNECTION_CHECK_REQUEST = {
  system: "You confirm that an API connection works.",
  user: "Confirm the connection by returning ok set to true.",
  schemaName: "connection_check",
  schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
  temperature: 0,
  maxTokens: 64,
  timeoutMs: 30_000,
} as const satisfies StructuredJsonRequest;

export interface StructuredJsonRequest {
  system: string;
  user: string;
  /** Letters, digits and underscores; names the result structure. */
  schemaName: string;
  schema: Record<string, unknown>;
  temperature?: number;
  /** Required by some providers; the longest answer allowed. */
  maxTokens?: number;
  timeoutMs?: number;
}

export type AiFailureReason = "rejected_key" | "rate_limited" | "bad_request" | "unavailable";

export type StructuredJsonResult =
  | { ok: true; content: string; usage: OpenAiTokenUsage | null; model: string; provider: AiProviderId }
  | { ok: false; status: number; reason: AiFailureReason; error: string };

function endpointFor(provider: AiProviderId) {
  // Tests point every provider at a local stand-in. Only loopback addresses are accepted, and never in
  // production builds, so this cannot be used to send a key anywhere else.
  const testBase = process.env.AI_PROVIDER_TEST_BASE_URL?.trim() ?? "";
  if (process.env.NODE_ENV !== "production" && /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(testBase)) {
    return `${testBase}${provider === "anthropic" ? "/v1/messages" : "/v1/chat/completions"}`;
  }
  return PROVIDER_ENDPOINTS[provider];
}

/** Removes the key and anything key-shaped from provider text before it is logged. */
function redact(text: string, apiKey: string) {
  const withoutKey = apiKey ? text.split(apiKey).join("[redacted]") : text;
  return withoutKey.replace(/\b(sk-[A-Za-z0-9_*-]{4,}|xai-[A-Za-z0-9_*-]{4,}|AIza[0-9A-Za-z_*-]{8,})/g, "[redacted]").slice(0, 500);
}

function failure(status: number, reason: AiFailureReason): StructuredJsonResult {
  const messages: Record<AiFailureReason, string> = {
    rejected_key: "The AI provider rejected the API key. A system admin can update it in System Administration.",
    rate_limited: "The AI provider is limiting requests or the account is out of credit. Try again shortly.",
    bad_request: "The AI provider refused the request. A system admin can check the model name in System Administration.",
    unavailable: "The AI provider is unavailable right now. Try again shortly.",
  };
  return { ok: false, status, reason, error: messages[reason] };
}

function providerErrorText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "";
}

/** Asks the configured provider for JSON matching `schema` and returns the JSON text. */
export async function requestStructuredJson(config: AiConfig, request: StructuredJsonRequest): Promise<StructuredJsonResult> {
  const signal = AbortSignal.timeout(request.timeoutMs ?? 90_000);
  const isAnthropic = config.provider === "anthropic";
  const body = isAnthropic
    ? {
        model: config.model,
        max_tokens: request.maxTokens ?? 8192,
        temperature: request.temperature ?? 0.2,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
        // A forced tool call is how Claude returns data in an exact structure.
        tools: [{ name: request.schemaName, description: "Return the result in this structure.", input_schema: request.schema }],
        tool_choice: { type: "tool", name: request.schemaName },
      }
    : {
        model: config.model,
        temperature: request.temperature ?? 0.2,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        response_format: { type: "json_schema", json_schema: { name: request.schemaName, schema: request.schema } },
      };
  const headers: Record<string, string> = isAnthropic
    ? { "content-type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" }
    : { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` };

  let response: Response;
  try {
    response = await fetch(endpointFor(config.provider), { method: "POST", headers, body: JSON.stringify(body), signal, cache: "no-store" });
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : "request failed";
    console.error(`AI provider ${config.provider} could not be reached.`, redact(detail, config.apiKey));
    return failure(502, "unavailable");
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    console.error(`AI provider ${config.provider} returned ${response.status}.`, redact(providerErrorText(payload), config.apiKey));
    if (response.status === 401 || response.status === 403) return failure(502, "rejected_key");
    if (response.status === 429) return failure(429, "rate_limited");
    if (response.status === 400 || response.status === 404 || response.status === 422) return failure(502, "bad_request");
    return failure(502, "unavailable");
  }

  let content = "";
  if (isAnthropic) {
    const blocks = (payload as { content?: Array<{ type?: string; name?: string; input?: unknown; text?: string }> } | null)?.content ?? [];
    const toolUse = blocks.find((block) => block.type === "tool_use" && block.name === request.schemaName);
    content = toolUse ? JSON.stringify(toolUse.input ?? {}) : blocks.filter((block) => block.type === "text").map((block) => block.text ?? "").join("").trim();
  } else {
    const message = (payload as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices?.[0]?.message;
    content = typeof message?.content === "string" ? message.content.trim() : "";
  }
  const usage = ((payload as { usage?: OpenAiTokenUsage } | null)?.usage ?? null) as OpenAiTokenUsage | null;
  return { ok: true, content, usage, model: config.model, provider: config.provider };
}
