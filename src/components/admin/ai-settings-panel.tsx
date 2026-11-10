"use client";

import { Check, Copy, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { PinInput } from "@/components/ui/pin-input";
import {
  AI_PROVIDER_OPTIONS,
  type AiProviderId,
  type AiSettingsAction,
  type AiSettingsStatus,
  getAiProviderOption,
  isAiProviderId,
} from "@/lib/ai-providers";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

/** How long a viewed key stays on screen. */
const REVEAL_SECONDS = 30;

const ACTION_LABELS: Record<AiSettingsAction, string> = {
  saved: "saved a new key",
  model_changed: "changed the model",
  revealed: "viewed the key",
  removed: "removed the key",
  tested: "tested the connection",
  pin_failed: "entered a wrong PIN",
  pin_locked: "was locked out after wrong PINs",
};

type Mode = "idle" | "change" | "reveal" | "remove";

const buttonClass =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900";
const primaryButtonClass =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

function providerName(id: string | null) {
  if (!id || !isAiProviderId(id)) return null;
  const option = getAiProviderOption(id);
  return `${option.label} (${option.company})`;
}

/** System admins choose the AI provider and manage its encrypted API key. */
export function AiSettingsPanel() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [status, setStatus] = useState<AiSettingsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [provider, setProvider] = useState<AiProviderId>("anthropic");
  const [model, setModel] = useState(getAiProviderOption("anthropic").defaultModel);
  const [apiKey, setApiKey] = useState("");
  const [verify, setVerify] = useState(true);
  const [pin, setPin] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [copied, setCopied] = useState(false);

  const send = useCallback(
    async (path: string, method = "GET", body?: unknown) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Your session ended. Sign in again.");
      const response = await fetch(path, {
        method,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The request failed. Try again.");
      return payload;
    },
    [supabase],
  );

  const loadStatus = useCallback(async () => {
    try {
      const payload = await send("/api/admin/ai-settings");
      setStatus(payload as unknown as AiSettingsStatus);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI settings could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [send]);

  useEffect(() => {
    let active = true;
    send("/api/admin/ai-settings")
      .then((payload) => {
        if (active) setStatus(payload as unknown as AiSettingsStatus);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "AI settings could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [send]);

  // A viewed key disappears after a short time, or as soon as the page is hidden.
  useEffect(() => {
    if (!revealedKey) return;
    const shownAt = Date.now();
    const hide = () => {
      setRevealedKey(null);
      setSecondsLeft(0);
      setCopied(false);
    };
    const timer = window.setInterval(() => {
      const left = REVEAL_SECONDS - Math.floor((Date.now() - shownAt) / 1000);
      if (left <= 0) hide();
      else setSecondsLeft(left);
    }, 250);
    const onVisibilityChange = () => {
      if (document.hidden) hide();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [revealedKey]);

  function startMode(next: Mode) {
    setError(null);
    setNotice(null);
    setPin("");
    setApiKey("");
    if (next === "change") {
      const current = status?.source === "app" && status.provider ? status.provider : "anthropic";
      setProvider(current);
      setModel(status?.source === "app" && status.model ? status.model : getAiProviderOption(current).defaultModel);
      setVerify(true);
    }
    setMode(next);
  }

  function closeForm() {
    setMode("idle");
    setPin("");
    setApiKey("");
  }

  function chooseProvider(next: AiProviderId) {
    setProvider(next);
    setModel(status?.source === "app" && status.provider === next && status.model ? status.model : getAiProviderOption(next).defaultModel);
  }

  async function runAction(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request failed. Try again.");
      // Failed PIN entries are recorded; refresh the activity list.
      void loadStatus();
    } finally {
      setPin("");
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void runAction(async () => {
      const payload = await send("/api/admin/ai-settings", "PUT", { provider, model, apiKey, verify, pin });
      setStatus(payload as unknown as AiSettingsStatus);
      setNotice(apiKey ? "The new key is encrypted and saved." : "The model is updated.");
      setApiKey("");
      setMode("idle");
    });
  }

  function reveal(event: FormEvent) {
    event.preventDefault();
    void runAction(async () => {
      const payload = await send("/api/admin/ai-settings/reveal", "POST", { pin });
      if (typeof payload.apiKey !== "string") throw new Error("The key could not be shown.");
      setRevealedKey(payload.apiKey);
      setSecondsLeft(REVEAL_SECONDS);
      setCopied(false);
      setMode("idle");
      void loadStatus();
    });
  }

  function remove(event: FormEvent) {
    event.preventDefault();
    void runAction(async () => {
      const payload = await send("/api/admin/ai-settings", "DELETE", { pin });
      setStatus(payload as unknown as AiSettingsStatus);
      setRevealedKey(null);
      setNotice("The saved key was removed.");
      setMode("idle");
    });
  }

  function testConnection() {
    void runAction(async () => {
      const payload = await send("/api/admin/ai-settings/test", "POST");
      setNotice(`The connection works. ${providerName(String(payload.provider)) ?? "The provider"} answered using ${String(payload.model)}.`);
      void loadStatus();
    });
  }

  async function copyKey() {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey);
      setCopied(true);
    } catch {
      setError("Copying is blocked in this browser. Select the key and copy it instead.");
    }
  }

  const selectedOption = getAiProviderOption(provider);
  const canSave = Boolean(status?.available && status.encryption === "ready");
  const keepsSavedKey = status?.source === "app" && status.provider === provider;

  return (
    <section
      aria-labelledby="ai-provider-heading"
      className="grid gap-4 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-slate-900/70 md:p-7"
    >
      <div className="grid gap-1">
        <h2 id="ai-provider-heading" className="flex items-center gap-2 text-lg font-bold">
          <KeyRound size={18} aria-hidden="true" />
          AI provider
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          AI writing help, search ranking and chart suggestions use this provider. The API key is encrypted on the server. Changing, viewing or
          removing it requires your PIN, and every action is recorded below.
        </p>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading AI settings…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-800 dark:text-rose-200">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-800 dark:text-emerald-200">
          {notice}
        </p>
      ) : null}

      {status ? (
        <>
          {!status.available ? (
            <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
              AI settings need the latest database update before a key can be saved here.
            </p>
          ) : null}
          {status.encryption !== "ready" ? (
            <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
              {status.encryption === "missing" ? "The server has no AI_KEY_ENCRYPTION_KEY, so keys can't be saved yet." : "The server's AI_KEY_ENCRYPTION_KEY is not a valid 32-byte key."}{" "}
              Ask whoever runs the server to set it (for example, the output of <code>openssl rand -base64 32</code>) and restart the app.
            </p>
          ) : null}
          {status.source === "app" && !status.keyReadable ? (
            <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
              The saved key can&apos;t be decrypted because the server&apos;s encryption key changed. AI features are off until the key is entered again.
            </p>
          ) : null}

          <dl className="grid gap-3 rounded-2xl border border-slate-200 p-4 text-sm dark:border-slate-800 sm:grid-cols-3">
            <div className="grid gap-0.5">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Provider</dt>
              <dd className="font-semibold">{providerName(status.provider) ?? "Not set up"}</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Model</dt>
              <dd className="break-all font-mono">{status.model ?? "None"}</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">API key</dt>
              <dd className="font-mono">{status.keyHint ? `•••• ${status.keyHint.replace("…", "")}` : "None"}</dd>
            </div>
          </dl>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {status.source === "app" ? (
              <>
                Saved in the app{status.updatedByName ? ` by ${status.updatedByName}` : ""}
                {status.updatedAt ? (
                  <>
                    {" "}on <LocalDateTime value={status.updatedAt} />
                  </>
                ) : null}
                .
              </>
            ) : status.source === "environment" ? (
              "Using the server's OPENAI_API_KEY. Save a key here to choose the provider and manage the key from the app."
            ) : (
              "No AI provider is set up, so AI features are turned off."
            )}
          </p>

          <div className="flex flex-wrap gap-2">
            <button type="button" className={primaryButtonClass} disabled={!canSave || busy} onClick={() => startMode("change")}>
              {status.source === "app" ? "Change provider or key" : "Add an API key"}
            </button>
            {status.source === "app" ? (
              <button type="button" className={buttonClass} disabled={busy || !status.keyReadable} onClick={() => startMode("reveal")}>
                View key
              </button>
            ) : null}
            {status.source !== "none" ? (
              <button type="button" className={buttonClass} disabled={busy} onClick={testConnection}>
                {busy && mode === "idle" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
                Test connection
              </button>
            ) : null}
            {status.source === "app" ? (
              <button
                type="button"
                className={cn(buttonClass, "border-rose-500/40 text-rose-700 hover:bg-rose-500/10 dark:text-rose-300")}
                disabled={busy}
                onClick={() => startMode("remove")}
              >
                Remove key
              </button>
            ) : null}
          </div>

          {revealedKey ? (
            <div className="grid gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
              <label className="grid gap-1 text-sm">
                <span className="font-semibold">Saved API key (hides in {secondsLeft} s)</span>
                <input
                  readOnly
                  value={revealedKey}
                  autoComplete="off"
                  spellCheck={false}
                  onFocus={(event) => event.currentTarget.select()}
                  className={cn(inputClass, "font-mono text-sm")}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass} onClick={() => void copyKey()}>
                  {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button type="button" className={buttonClass} onClick={() => setRevealedKey(null)}>
                  <EyeOff size={16} aria-hidden="true" />
                  Hide now
                </button>
              </div>
            </div>
          ) : null}

          {mode === "change" ? (
            <form onSubmit={save} className="grid gap-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-800" autoComplete="off">
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-semibold">Provider</legend>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {AI_PROVIDER_OPTIONS.map((option) => (
                    <label
                      key={option.id}
                      className={cn(
                        "flex cursor-pointer flex-col gap-0.5 rounded-xl border px-3 py-2 text-sm transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-cyan-500",
                        provider === option.id
                          ? "border-cyan-500 bg-cyan-500/10"
                          : "border-slate-300 hover:border-slate-400 dark:border-slate-700",
                      )}
                    >
                      <input
                        type="radio"
                        name="ai-provider"
                        value={option.id}
                        checked={provider === option.id}
                        onChange={() => chooseProvider(option.id)}
                        className="sr-only"
                      />
                      <span className="font-semibold">{option.label}</span>
                      <span className="text-xs text-slate-600 dark:text-slate-400">{option.company}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="grid gap-1 text-sm">
                <span className="font-semibold">Model</span>
                <input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  list="ai-model-suggestions"
                  spellCheck={false}
                  autoComplete="off"
                  className={cn(inputClass, "font-mono")}
                />
                <datalist id="ai-model-suggestions">
                  {selectedOption.suggestedModels.map((suggestion) => (
                    <option key={suggestion} value={suggestion} />
                  ))}
                </datalist>
                <span className="text-xs text-slate-500">Any model your {selectedOption.company} account offers.</span>
              </label>

              <label className="grid gap-1 text-sm">
                <span className="font-semibold">API key</span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  autoComplete="new-password"
                  spellCheck={false}
                  placeholder={keepsSavedKey ? "Leave empty to keep the saved key" : selectedOption.keyHint}
                  className={cn(inputClass, "font-mono")}
                />
                <span className="text-xs text-slate-500">
                  Create a key in your{" "}
                  <a href={selectedOption.keysUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-cyan-700 underline dark:text-cyan-300">
                    {selectedOption.company} account
                  </a>
                  .
                </span>
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={verify} onChange={(event) => setVerify(event.target.checked)} className="size-4" />
                Check the key with {selectedOption.label} before saving
              </label>

              <div className="grid gap-1 text-sm sm:max-w-xs">
                <label htmlFor="ai-settings-pin-change" className="font-semibold">
                  Your PIN
                </label>
                <PinInput id="ai-settings-pin-change" value={pin} onChange={setPin} />
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="submit" className={primaryButtonClass} disabled={busy || pin.length !== 6 || (!apiKey && !keepsSavedKey)}>
                  {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
                  {verify ? "Check and save" : "Save"}
                </button>
                <button type="button" className={buttonClass} disabled={busy} onClick={closeForm}>
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          {mode === "reveal" ? (
            <form onSubmit={reveal} className="grid gap-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800" autoComplete="off">
              <p className="text-sm">Enter your PIN to show the saved key for {REVEAL_SECONDS} seconds. Viewing it is recorded.</p>
              <div className="grid gap-1 text-sm sm:max-w-xs">
                <label htmlFor="ai-settings-pin-reveal" className="font-semibold">
                  Your PIN
                </label>
                <PinInput id="ai-settings-pin-reveal" value={pin} onChange={setPin} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={primaryButtonClass} disabled={busy || pin.length !== 6}>
                  Show key
                </button>
                <button type="button" className={buttonClass} disabled={busy} onClick={closeForm}>
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          {mode === "remove" ? (
            <form onSubmit={remove} className="grid gap-3 rounded-2xl border border-rose-500/40 p-4" autoComplete="off">
              <p className="text-sm">
                Removing the saved key turns AI features off
                {status.environmentFallback ? ", unless the server's OPENAI_API_KEY is set, which is then used again" : ""}. Enter your PIN to
                confirm.
              </p>
              <div className="grid gap-1 text-sm sm:max-w-xs">
                <label htmlFor="ai-settings-pin-remove" className="font-semibold">
                  Your PIN
                </label>
                <PinInput id="ai-settings-pin-remove" value={pin} onChange={setPin} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className={cn(primaryButtonClass, "from-rose-600 to-rose-700")}
                  disabled={busy || pin.length !== 6}
                >
                  Remove key
                </button>
                <button type="button" className={buttonClass} disabled={busy} onClick={closeForm}>
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          {status.events.length > 0 ? (
            <div className="grid gap-2">
              <h3 className="text-sm font-semibold">Recent activity</h3>
              <ul className="grid gap-1 text-sm text-slate-700 dark:text-slate-300">
                {status.events.map((event, index) => (
                  <li key={`${event.createdAt}-${index}`} className="flex flex-wrap gap-x-2">
                    <span className="font-medium">{event.actorName}</span>
                    <span>
                      {ACTION_LABELS[event.action] ?? event.action}
                      {event.provider ? ` (${providerName(event.provider) ?? event.provider})` : ""}
                    </span>
                    <span className="text-slate-500">
                      <LocalDateTime value={event.createdAt} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
