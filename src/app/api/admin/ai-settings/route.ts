import type { NextRequest } from "next/server";

import { AI_KEY_PATTERN, AI_MODEL_PATTERN, getAiProviderOption, isAiProviderId } from "@/lib/ai-providers";
import {
  AI_SETTINGS_ROW_ID,
  aiKeyContext,
  CONNECTION_CHECK_REQUEST,
  loadStoredAiSettings,
  openStoredAiKey,
  requestStructuredJson,
} from "@/lib/ai-provider.server";
import {
  aiSettingsJson,
  getAiSettingsStatus,
  keyHint,
  recordAiSettingsEvent,
  requireAiSettingsAdmin,
  verifyStepUpPin,
} from "@/lib/ai-settings.server";
import { sealSecret, secretEncryptionStatus } from "@/lib/secret-box.server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/** Provider, model and a hint of the key. Never the key itself. */
export async function GET(request: NextRequest) {
  const auth = await requireAiSettingsAdmin(request);
  if (auth.response) return auth.response;
  return aiSettingsJson(await getAiSettingsStatus());
}

interface SaveBody {
  pin?: unknown;
  provider?: unknown;
  model?: unknown;
  apiKey?: unknown;
  verify?: unknown;
}

/** Saves a provider, model and key (encrypted). Leaving the key empty changes only the model. */
export async function PUT(request: NextRequest) {
  const auth = await requireAiSettingsAdmin(request);
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as SaveBody;
  const provider = body.provider;
  if (!isAiProviderId(provider)) return aiSettingsJson({ error: "Choose an AI provider." }, 400);
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!AI_MODEL_PATTERN.test(model)) {
    return aiSettingsJson({ error: `Enter a model name, for example ${getAiProviderOption(provider).defaultModel}.` }, 400);
  }
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (apiKey && !AI_KEY_PATTERN.test(apiKey)) {
    return aiSettingsJson({ error: "That doesn't look like an API key. Paste the whole key, without spaces." }, 400);
  }
  if (secretEncryptionStatus() !== "ready") {
    return aiSettingsJson({ error: "The server can't encrypt keys yet. Set AI_KEY_ENCRYPTION_KEY on the server and restart the app." }, 503);
  }

  const pinProblem = await verifyStepUpPin(auth.profile, body.pin);
  if (pinProblem) return pinProblem;

  const { settings: existing, error: loadError } = await loadStoredAiSettings();
  if (loadError) return aiSettingsJson({ error: "AI settings are unavailable. Apply the latest database update." }, 503);

  let keyToStore = apiKey;
  if (!keyToStore) {
    // A model-only change keeps the saved key, which must belong to the same provider.
    if (!existing || existing.provider !== provider) return aiSettingsJson({ error: "Enter the API key for this provider." }, 400);
    const savedKey = openStoredAiKey(existing);
    if (!savedKey) {
      return aiSettingsJson({ error: "The saved key can't be read with the server's current encryption key. Enter the API key again." }, 409);
    }
    keyToStore = savedKey;
  }

  if (body.verify !== false) {
    const check = await requestStructuredJson({ provider, model, apiKey: keyToStore, source: "app" }, CONNECTION_CHECK_REQUEST);
    if (!check.ok) {
      const messages = {
        rejected_key: "The provider rejected this key. Nothing was saved.",
        bad_request: "The provider didn't accept the request. Check the model name. Nothing was saved.",
        rate_limited: "The provider is limiting requests or the account is out of credit. Nothing was saved.",
        unavailable: "The provider couldn't be reached, so nothing was saved. Try again, or save without checking.",
      } as const;
      return aiSettingsJson({ error: messages[check.reason], reason: check.reason }, 400);
    }
  }

  const sealed = sealSecret(keyToStore, aiKeyContext(provider));
  const { error } = await getSupabaseAdminClient().from("ai_provider_settings").upsert({
    id: AI_SETTINGS_ROW_ID,
    provider,
    model,
    key_ciphertext: sealed.ciphertext,
    key_iv: sealed.iv,
    key_tag: sealed.tag,
    key_fingerprint: sealed.keyFingerprint,
    key_hint: keyHint(keyToStore),
    updated_by: auth.profile.id,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error("The AI provider settings could not be saved.", error.message);
    return aiSettingsJson({ error: "The key could not be saved. Try again." }, 500);
  }
  await recordAiSettingsEvent(apiKey ? "saved" : "model_changed", auth.profile.id, provider);
  return aiSettingsJson(await getAiSettingsStatus());
}

/** Removes the saved key. The server's OPENAI_API_KEY, if set, is used again. */
export async function DELETE(request: NextRequest) {
  const auth = await requireAiSettingsAdmin(request);
  if (auth.response) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { pin?: unknown };
  const pinProblem = await verifyStepUpPin(auth.profile, body.pin);
  if (pinProblem) return pinProblem;

  const { settings } = await loadStoredAiSettings();
  if (!settings) return aiSettingsJson({ error: "No key is saved in the app." }, 404);
  const { error } = await getSupabaseAdminClient().from("ai_provider_settings").delete().eq("id", AI_SETTINGS_ROW_ID);
  if (error) return aiSettingsJson({ error: "The key could not be removed. Try again." }, 500);
  await recordAiSettingsEvent("removed", auth.profile.id, isAiProviderId(settings.provider) ? settings.provider : null);
  return aiSettingsJson(await getAiSettingsStatus());
}
