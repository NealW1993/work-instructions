import type { NextRequest } from "next/server";

import { loadStoredAiSettings, openStoredAiKey } from "@/lib/ai-provider.server";
import { aiSettingsJson, recordAiSettingsEvent, requireAiSettingsAdmin, verifyStepUpPin } from "@/lib/ai-settings.server";

/** Shows the saved key to a system admin who re-enters their PIN. Every view is recorded. */
export async function POST(request: NextRequest) {
  const auth = await requireAiSettingsAdmin(request);
  if (auth.response) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { pin?: unknown };
  const pinProblem = await verifyStepUpPin(auth.profile, body.pin);
  if (pinProblem) return pinProblem;

  const { settings } = await loadStoredAiSettings();
  if (!settings) return aiSettingsJson({ error: "No key is saved in the app." }, 404);
  const apiKey = openStoredAiKey(settings);
  if (!apiKey) {
    return aiSettingsJson({ error: "The saved key can't be read with the server's current encryption key. Enter the API key again." }, 409);
  }
  // Every view must be on record, so the key is not shown if the record cannot be written.
  if (!(await recordAiSettingsEvent("revealed", auth.profile.id, settings.provider))) {
    return aiSettingsJson({ error: "The view could not be recorded, so the key was not shown. Try again." }, 500);
  }
  return aiSettingsJson({ apiKey });
}
