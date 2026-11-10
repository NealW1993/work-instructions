import type { NextRequest } from "next/server";

import { AI_NOT_CONFIGURED_MESSAGE, CONNECTION_CHECK_REQUEST, getAiConfig, requestStructuredJson } from "@/lib/ai-provider.server";
import { aiSettingsJson, recordAiSettingsEvent, requireAiSettingsAdmin } from "@/lib/ai-settings.server";

/** Sends a tiny request with the active key to confirm it works. The key is not returned. */
export async function POST(request: NextRequest) {
  const auth = await requireAiSettingsAdmin(request);
  if (auth.response) return auth.response;
  const config = await getAiConfig("enhance");
  if (!config) return aiSettingsJson({ error: AI_NOT_CONFIGURED_MESSAGE }, 409);
  const result = await requestStructuredJson(config, CONNECTION_CHECK_REQUEST);
  await recordAiSettingsEvent("tested", auth.profile.id, config.provider);
  if (!result.ok) return aiSettingsJson({ error: result.error, reason: result.reason }, result.status);
  return aiSettingsJson({ ok: true, provider: config.provider, model: config.model });
}
