/*
 * AI providers a system admin can choose in System Administration. This module holds no secrets, so
 * the settings screen can import it. Each provider's API address is fixed on the server
 * (src/lib/ai-provider.server.ts), so a saved key is only ever sent to that provider.
 */
export type AiProviderId = "anthropic" | "openai" | "xai" | "google";

export interface AiProviderOption {
  id: AiProviderId;
  /** The product name people know. */
  label: string;
  company: string;
  defaultModel: string;
  /** Suggestions only; any model the provider account offers can be entered. */
  suggestedModels: string[];
  /** How keys from this provider usually start, shown as a hint. */
  keyHint: string;
  keysUrl: string;
}

export const AI_PROVIDER_OPTIONS: readonly AiProviderOption[] = [
  {
    id: "anthropic",
    label: "Claude",
    company: "Anthropic",
    defaultModel: "claude-opus-5-5",
    suggestedModels: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
    keyHint: "sk-ant-…",
    keysUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openai",
    label: "ChatGPT",
    company: "OpenAI",
    defaultModel: "gpt-4.1-mini",
    suggestedModels: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"],
    keyHint: "sk-…",
    keysUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "xai",
    label: "Grok",
    company: "xAI",
    defaultModel: "grok-4",
    suggestedModels: ["grok-4", "grok-3", "grok-3-mini"],
    keyHint: "xai-…",
    keysUrl: "https://console.x.ai",
  },
  {
    id: "google",
    label: "Gemini",
    company: "Google",
    defaultModel: "gemini-2.5-flash",
    suggestedModels: ["gemini-2.5-flash", "gemini-2.5-pro"],
    keyHint: "AIza…",
    keysUrl: "https://aistudio.google.com/apikey",
  },
];

export function isAiProviderId(value: unknown): value is AiProviderId {
  return AI_PROVIDER_OPTIONS.some((option) => option.id === value);
}

export function getAiProviderOption(id: AiProviderId): AiProviderOption {
  return AI_PROVIDER_OPTIONS.find((option) => option.id === id) ?? AI_PROVIDER_OPTIONS[0];
}

export type AiSettingsAction = "saved" | "model_changed" | "revealed" | "removed" | "tested" | "pin_failed" | "pin_locked";

export interface AiSettingsEvent {
  action: AiSettingsAction;
  provider: string | null;
  actorName: string;
  createdAt: string;
}

/** What the settings screen shows. Never includes the key itself. */
export interface AiSettingsStatus {
  /** False when the settings table is missing (database update not applied). */
  available: boolean;
  /** Whether the server has a valid AI_KEY_ENCRYPTION_KEY. */
  encryption: "ready" | "missing" | "invalid";
  source: "app" | "environment" | "none";
  provider: AiProviderId | null;
  model: string | null;
  keyHint: string | null;
  /** False when a saved key can no longer be decrypted (the server's encryption key changed). */
  keyReadable: boolean;
  /** Whether the server's OPENAI_API_KEY would be used if no key were saved in the app. */
  environmentFallback: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
  events: AiSettingsEvent[];
}

/** Model names are letters, digits and . _ - : / (for example "claude-opus-5-5" or "models/gemini-2.5-pro"). */
export const AI_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;

/** API keys are printable ASCII without spaces. */
export const AI_KEY_PATTERN = /^[\x21-\x7E]{16,512}$/;
