"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { PinInput } from "@/components/ui/pin-input";
import {
  ensureSessionStartTime,
  formatElapsedHhMmSs,
  getSessionStartTime,
  setSessionStartTime,
} from "@/lib/session-timer";
import { useSynchronizedNowMs } from "@/lib/second-ticker";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { ThemePreference } from "@/lib/types";

const ACCOUNT_HISTORY_GUARD_STATE_KEY = "__accountSettingsUnsavedGuard";
const ICON_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const FONT_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const DEFAULT_ICON_COLOR = "#0EA5E9";
const DEFAULT_FONT_COLOR = "#FFFFFF";
const ICON_COLOR_OPTIONS = [
  "#0EA5E9",
  "#2563EB",
  "#7C3AED",
  "#DB2777",
  "#DC2626",
  "#EA580C",
  "#16A34A",
  "#0D9488",
  "#4B5563",
  "#111827",
] as const;
const FONT_COLOR_OPTIONS = [
  "#FFFFFF",
  "#E5E7EB",
  "#111827",
  "#0EA5E9",
  "#2563EB",
  "#7C3AED",
  "#DB2777",
  "#DC2626",
  "#EA580C",
  "#16A34A",
] as const;

function normalizeIconColor(value: string) {
  return value.trim().toUpperCase();
}

function normalizeFontColor(value: string) {
  return value.trim().toUpperCase();
}

function getInitials(value: string) {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "U";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

type PendingNavigation =
  | {
      kind: "history-back";
    }
  | {
      kind: "internal-link";
      href: string;
    }
  | {
      kind: "external-link";
      href: string;
    };

interface AccountSettingsPanelProps {
  initialFullName: string;
  initialEmail: string;
  initialEmployeeId: string;
  initialThemePreference: ThemePreference;
  initialIconColor: string;
  initialFontColor: string;
  initialTotalSignedInSeconds: number;
  initialActiveSessionStartedAt: string | null;
}

function toTimestampMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function AccountSettingsPanel({
  initialFullName,
  initialEmail,
  initialEmployeeId,
  initialThemePreference,
  initialIconColor,
  initialFontColor,
  initialTotalSignedInSeconds,
  initialActiveSessionStartedAt,
}: AccountSettingsPanelProps) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [savedFullName, setSavedFullName] = useState(initialFullName);
  const [savedEmail, setSavedEmail] = useState(initialEmail.toLowerCase());
  const [savedEmployeeId] = useState(initialEmployeeId);
  const [savedThemePreference, setSavedThemePreference] =
    useState<ThemePreference>(initialThemePreference);
  const [savedIconColor, setSavedIconColor] = useState(
    normalizeIconColor(initialIconColor || DEFAULT_ICON_COLOR),
  );
  const [savedFontColor, setSavedFontColor] = useState(
    normalizeFontColor(initialFontColor || DEFAULT_FONT_COLOR),
  );

  const [fullName, setFullName] = useState(initialFullName);
  const [email, setEmail] = useState(initialEmail);
  const [themePreference, setThemePreference] =
    useState<ThemePreference>(initialThemePreference);
  const [iconColor, setIconColor] = useState(
    normalizeIconColor(initialIconColor || DEFAULT_ICON_COLOR),
  );
  const [fontColor, setFontColor] = useState(
    normalizeFontColor(initialFontColor || DEFAULT_FONT_COLOR),
  );
  const [wantsPinChange, setWantsPinChange] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const synchronizedNowMs = useSynchronizedNowMs();
  const serverSessionStartMs = useMemo(
    () => toTimestampMs(initialActiveSessionStartedAt),
    [initialActiveSessionStartedAt],
  );
  const localSessionStartMs = getSessionStartTime();
  const sessionStartedAtMs = serverSessionStartMs ?? localSessionStartMs;

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [navigationModalOpen, setNavigationModalOpen] = useState(false);

  const hasUnsavedChangesRef = useRef(false);
  const navigationModalOpenRef = useRef(false);
  const historyGuardActiveRef = useRef(false);
  const suppressNextPopStateRef = useRef(false);
  const pendingNavigationRef = useRef<PendingNavigation | null>(null);
  const navigationBypassRef = useRef(false);

  const normalizedFullName = fullName.trim();
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedIconColor = normalizeIconColor(iconColor);
  const normalizedFontColor = normalizeFontColor(fontColor);
  const pinMismatch = wantsPinChange && confirmPin.length > 0 && pin !== confirmPin;
  const fullNameChanged = normalizedFullName !== savedFullName;
  const emailChanged = normalizedEmail !== savedEmail;
  const themeChanged = themePreference !== savedThemePreference;
  const iconColorChanged = normalizedIconColor !== savedIconColor;
  const fontColorChanged = normalizedFontColor !== savedFontColor;
  const pinChanged = wantsPinChange && pin.length > 0;

  const hasChanges =
    fullNameChanged ||
    emailChanged ||
    themeChanged ||
    iconColorChanged ||
    fontColorChanged ||
    pinChanged;
  const saveDisabled = busy || pinMismatch || !hasChanges;
  const iconInitials = getInitials(normalizedFullName || savedFullName);
  const totalSignedInLabel = useMemo(() => {
    const baseMs = Math.max(0, initialTotalSignedInSeconds) * 1000;
    const liveSessionMs =
      sessionStartedAtMs !== null ? Math.max(0, synchronizedNowMs - sessionStartedAtMs) : 0;
    return formatElapsedHhMmSs(baseMs + liveSessionMs);
  }, [initialTotalSignedInSeconds, sessionStartedAtMs, synchronizedNowMs]);

  const releaseHistoryGuard = useCallback(() => {
    if (!historyGuardActiveRef.current) {
      return;
    }

    suppressNextPopStateRef.current = true;
    historyGuardActiveRef.current = false;
    window.history.back();
  }, []);

  const navigateWithGuardReleased = useCallback(
    (navigate: () => void) => {
      if (historyGuardActiveRef.current) {
        releaseHistoryGuard();
        window.setTimeout(() => {
          navigate();
        }, 0);
        return;
      }

      navigate();
    },
    [releaseHistoryGuard],
  );

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    hasUnsavedChangesRef.current = hasChanges;
  }, [hasChanges]);

  useEffect(() => {
    navigationModalOpenRef.current = navigationModalOpen;
  }, [navigationModalOpen]);

  useEffect(() => {
    if (serverSessionStartMs !== null) {
      setSessionStartTime(serverSessionStartMs);
      return;
    }

    ensureSessionStartTime();
  }, [serverSessionStartMs]);

  useEffect(() => {
    if (!hasChanges) {
      if (historyGuardActiveRef.current) {
        releaseHistoryGuard();
      }

      setNavigationModalOpen(false);
      pendingNavigationRef.current = null;
      navigationBypassRef.current = false;
      return;
    }

    if (!historyGuardActiveRef.current) {
      window.history.pushState({ [ACCOUNT_HISTORY_GUARD_STATE_KEY]: true }, "", window.location.href);
      historyGuardActiveRef.current = true;
    }
  }, [hasChanges, releaseHistoryGuard]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChangesRef.current || navigationBypassRef.current) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      if (suppressNextPopStateRef.current) {
        suppressNextPopStateRef.current = false;
        return;
      }

      if (!hasUnsavedChangesRef.current || navigationBypassRef.current) {
        historyGuardActiveRef.current = false;
        return;
      }

      if (navigationModalOpenRef.current) {
        window.history.pushState({ [ACCOUNT_HISTORY_GUARD_STATE_KEY]: true }, "", window.location.href);
        historyGuardActiveRef.current = true;
        return;
      }

      window.history.pushState({ [ACCOUNT_HISTORY_GUARD_STATE_KEY]: true }, "", window.location.href);
      historyGuardActiveRef.current = true;
      openNavigationModal({ kind: "history-back" });
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    const handleDocumentNavigation = (event: MouseEvent) => {
      if (!hasUnsavedChangesRef.current || navigationBypassRef.current) {
        return;
      }

      if (event.defaultPrevented || event.button !== 0) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const target = event.target as Element | null;
      const anchor = target?.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      if (anchor.target && anchor.target !== "_self") {
        return;
      }

      if (anchor.hasAttribute("download")) {
        return;
      }

      let destination: URL;
      try {
        destination = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      if (destination.href === window.location.href) {
        return;
      }

      event.preventDefault();
      if (destination.origin === window.location.origin) {
        openNavigationModal({ kind: "internal-link", href: destination.href });
      } else {
        openNavigationModal({ kind: "external-link", href: destination.href });
      }
    };

    document.addEventListener("click", handleDocumentNavigation, true);
    return () => {
      document.removeEventListener("click", handleDocumentNavigation, true);
    };
  }, []);

  useEffect(() => {
    if (!navigationModalOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (
        pendingNavigationRef.current?.kind === "history-back" &&
        hasUnsavedChangesRef.current &&
        !historyGuardActiveRef.current
      ) {
        window.history.pushState({ [ACCOUNT_HISTORY_GUARD_STATE_KEY]: true }, "", window.location.href);
        historyGuardActiveRef.current = true;
      }

      navigationBypassRef.current = false;
      pendingNavigationRef.current = null;
      setNavigationModalOpen(false);
    };

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [navigationModalOpen]);

  function closeNavigationModal() {
    pendingNavigationRef.current = null;
    setNavigationModalOpen(false);
  }

  function openNavigationModal(nextNavigation: PendingNavigation) {
    pendingNavigationRef.current = nextNavigation;
    setNavigationModalOpen(true);
  }

  function handleCancelNavigationAway() {
    if (
      pendingNavigationRef.current?.kind === "history-back" &&
      hasUnsavedChangesRef.current &&
      !historyGuardActiveRef.current
    ) {
      window.history.pushState({ [ACCOUNT_HISTORY_GUARD_STATE_KEY]: true }, "", window.location.href);
      historyGuardActiveRef.current = true;
    }

    navigationBypassRef.current = false;
    closeNavigationModal();
  }

  function handleConfirmNavigationAway() {
    const navigation = pendingNavigationRef.current;
    if (!navigation) {
      closeNavigationModal();
      return;
    }

    navigationBypassRef.current = true;
    closeNavigationModal();

    if (themePreference !== savedThemePreference) {
      setTheme(savedThemePreference);
    }

    if (navigation.kind === "history-back") {
      navigateWithGuardReleased(() => {
        if (window.history.length <= 2) {
          router.push("/dashboard");
          return;
        }

        router.back();
      });
      return;
    }

    window.location.assign(navigation.href);
  }

  function applyThemeSelection(nextTheme: ThemePreference) {
    setThemePreference(nextTheme);
    setTheme(nextTheme);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      if (!hasChanges) {
        throw new Error("No changes to save.");
      }

      if (!normalizedFullName) {
        throw new Error("Full name cannot be empty.");
      }

      if (!normalizedEmail) {
        throw new Error("Email cannot be empty.");
      }

      if (!ICON_COLOR_PATTERN.test(normalizedIconColor)) {
        throw new Error("Icon color must be a valid hex value like #0EA5E9.");
      }

      if (!FONT_COLOR_PATTERN.test(normalizedFontColor)) {
        throw new Error("Font color must be a valid hex value like #FFFFFF.");
      }

      if (wantsPinChange) {
        if (!/^\d{6}$/.test(pin)) {
          throw new Error("PIN must be exactly 6 digits.");
        }

        if (pinMismatch) {
          throw new Error("PIN and Confirm PIN must match.");
        }
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Missing session token. Please sign in again.");
      }

      const payload: {
        fullName?: string;
        email?: string;
        themePreference?: ThemePreference;
        iconColor?: string;
        fontColor?: string;
      } = {};
      let accountUpdated = false;

      if (fullNameChanged) {
        payload.fullName = normalizedFullName;
      }

      if (emailChanged) {
        payload.email = normalizedEmail;
      }

      if (themeChanged) {
        payload.themePreference = themePreference;
      }

      if (iconColorChanged) {
        payload.iconColor = normalizedIconColor;
      }

      if (fontColorChanged) {
        payload.fontColor = normalizedFontColor;
      }

      if (Object.keys(payload).length > 0) {
        const response = await fetch("/api/auth/account", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(payload),
        });

        const responsePayload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(responsePayload.error ?? "Unable to update account.");
        }

        accountUpdated = true;
      }

      if (pinChanged) {
        const { error: pinError } = await supabase.rpc("set_my_pin", {
          new_pin: pin,
        });

        if (pinError) {
          throw new Error(pinError.message);
        }
      }

      setPin("");
      setConfirmPin("");
      setWantsPinChange(false);
      setSavedFullName(normalizedFullName);
      setSavedEmail(normalizedEmail);
      setSavedThemePreference(themePreference);
      setSavedIconColor(normalizedIconColor);
      setSavedFontColor(normalizedFontColor);

      if (accountUpdated && pinChanged) {
        setMessage("Account and PIN updated.");
      } else if (pinChanged) {
        setMessage("PIN updated.");
      } else {
        setMessage("Account updated.");
      }

      window.scrollTo({ top: 0, behavior: "smooth" });

      if (fullNameChanged || emailChanged || iconColorChanged || fontColorChanged) {
        router.refresh();
      }
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to update account.";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="grid gap-4 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7">
        <div className="grid gap-3">
          <div className="w-fit rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-200">
              All-Time Total Usage
            </p>
            <p className="mt-0.5 font-mono text-xl font-extrabold text-cyan-900 dark:text-cyan-100">
              {totalSignedInLabel}
            </p>
          </div>
        </div>

        {message ? (
          <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-200">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-200">
            {error}
          </p>
        ) : null}

        <form className="grid gap-4 md:max-w-5xl" onSubmit={handleSubmit}>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-1 text-sm">
              <span>Full Name</span>
              <input
                required
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span>Email</span>
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span>Employee ID</span>
              <div
                aria-readonly="true"
                className="rounded-xl border border-slate-300/80 bg-slate-100 px-3 py-2 text-slate-600 select-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              >
                {savedEmployeeId || "N/A"}
              </div>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-3 md:items-start">
            <fieldset className="grid gap-2 text-sm">
              <legend className="mb-1">Icon Color</legend>
              <div className="flex flex-wrap gap-2">
                {ICON_COLOR_OPTIONS.map((presetColor) => (
                  <button
                    key={presetColor}
                    type="button"
                    onClick={() => setIconColor(presetColor)}
                    aria-label={`Set icon color to ${presetColor}`}
                    className={`h-8 w-8 rounded-full border transition ${
                      normalizedIconColor === presetColor
                        ? "border-slate-900 ring-2 ring-cyan-500/40 dark:border-slate-100"
                        : "border-slate-300 dark:border-slate-700"
                    }`}
                    style={{ backgroundColor: presetColor }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
                <input
                  type="color"
                  value={ICON_COLOR_PATTERN.test(normalizedIconColor) ? normalizedIconColor : DEFAULT_ICON_COLOR}
                  onChange={(event) => setIconColor(normalizeIconColor(event.target.value))}
                  className="h-10 w-12 cursor-pointer rounded-lg border border-slate-300 bg-transparent p-1 dark:border-slate-700"
                />
                <input
                  value={iconColor}
                  maxLength={7}
                  onChange={(event) =>
                    setIconColor(normalizeIconColor(event.target.value.slice(0, 7)))
                  }
                  className="w-28 rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-sm uppercase text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  placeholder="#0EA5E9"
                />
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Pick a preset or enter a hex code.
                </span>
              </div>
            </fieldset>

            <fieldset className="grid gap-2 text-sm">
              <legend className="mb-1 opacity-0 select-none" aria-hidden="true">
                Profile Preview
              </legend>
              <div className="inline-flex min-h-[120px] w-full items-center justify-center rounded-xl border border-slate-300/80 bg-white/75 px-3 py-2 dark:border-slate-700 dark:bg-slate-950/60">
                <span
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-extrabold"
                  style={{
                    backgroundColor: ICON_COLOR_PATTERN.test(normalizedIconColor)
                      ? normalizedIconColor
                      : DEFAULT_ICON_COLOR,
                    color: FONT_COLOR_PATTERN.test(normalizedFontColor)
                      ? normalizedFontColor
                      : DEFAULT_FONT_COLOR,
                  }}
                >
                  {iconInitials}
                </span>
                <span className="ml-2 text-xs text-slate-600 dark:text-slate-300">Profile icon preview</span>
              </div>
            </fieldset>

            <fieldset className="grid gap-2 text-sm">
              <legend className="mb-1">Font Color</legend>
              <div className="flex flex-wrap gap-2">
                {FONT_COLOR_OPTIONS.map((presetColor) => (
                  <button
                    key={presetColor}
                    type="button"
                    onClick={() => setFontColor(presetColor)}
                    aria-label={`Set font color to ${presetColor}`}
                    className={`h-8 w-8 rounded-full border transition ${
                      normalizedFontColor === presetColor
                        ? "border-slate-900 ring-2 ring-cyan-500/40 dark:border-slate-100"
                        : "border-slate-300 dark:border-slate-700"
                    }`}
                    style={{ backgroundColor: presetColor }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
                <input
                  type="color"
                  value={FONT_COLOR_PATTERN.test(normalizedFontColor) ? normalizedFontColor : DEFAULT_FONT_COLOR}
                  onChange={(event) => setFontColor(normalizeFontColor(event.target.value))}
                  className="h-10 w-12 cursor-pointer rounded-lg border border-slate-300 bg-transparent p-1 dark:border-slate-700"
                />
                <input
                  value={fontColor}
                  maxLength={7}
                  onChange={(event) =>
                    setFontColor(normalizeFontColor(event.target.value.slice(0, 7)))
                  }
                  className="w-28 rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-sm uppercase text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  placeholder="#FFFFFF"
                />
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Initials text color in your account menu icon.
                </span>
              </div>
            </fieldset>
          </div>

          <div className="mt-1 grid gap-3 md:grid-cols-[auto_auto_1fr] md:items-end">
            <button
              type="submit"
              disabled={saveDisabled}
              className={`w-fit rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                saveDisabled
                  ? "cursor-not-allowed border border-slate-300 bg-slate-200 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
                  : "bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:brightness-110"
              }`}
            >
              {busy ? "Saving..." : "Save account changes"}
            </button>

            <div className="grid gap-1 text-sm">
              <span>PIN</span>
              <button
                type="button"
                onClick={() => {
                  if (wantsPinChange) {
                    setWantsPinChange(false);
                    setPin("");
                    setConfirmPin("");
                    return;
                  }

                  setWantsPinChange(true);
                }}
                className={`w-fit rounded-xl border px-3 py-1.5 text-sm font-semibold transition ${
                  wantsPinChange
                    ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-900 dark:text-cyan-100"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
                }`}
              >
                {wantsPinChange ? "Cancel PIN change" : "Change PIN"}
              </button>
            </div>

            <fieldset className="grid gap-1 text-sm md:justify-self-start">
              <legend className="mb-1">Theme</legend>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => applyThemeSelection("dark")}
                  className={`rounded-xl border px-3 py-1.5 text-sm font-semibold transition ${
                    themePreference === "dark"
                      ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-900 dark:text-cyan-100"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
                  }`}
                >
                  Dark
                </button>
                <button
                  type="button"
                  onClick={() => applyThemeSelection("light")}
                  className={`rounded-xl border px-3 py-1.5 text-sm font-semibold transition ${
                    themePreference === "light"
                      ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-900 dark:text-cyan-100"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
                  }`}
                >
                  Light
                </button>
              </div>
            </fieldset>
          </div>

          {wantsPinChange ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span>New 6-Digit PIN</span>
                <PinInput
                  value={pin}
                  onChange={setPin}
                  className="tracking-[0.3em]"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span>Confirm New PIN</span>
                <PinInput
                  value={confirmPin}
                  onChange={setConfirmPin}
                  className="tracking-[0.3em]"
                />
              </label>
            </div>
          ) : null}

          {pinMismatch ? (
            <p className="text-sm text-rose-600 dark:text-rose-300">
              PIN and Confirm PIN do not match.
            </p>
          ) : null}
        </form>
      </section>

      {navigationModalOpen && portalReady
        ? createPortal(
            <div className="app-modal-shell fixed inset-0 z-[111] flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm sm:p-6">
              <div className="grid w-full max-w-md gap-4 rounded-2xl border border-amber-500/45 bg-slate-950/95 p-5 shadow-2xl">
                <div className="grid gap-1">
                  <h3 className="text-lg font-bold text-slate-100">Discard unsaved account changes?</h3>
                  <p className="text-sm text-slate-300">
                    You have unsaved account settings updates. Leaving now will discard those changes.
                  </p>
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleCancelNavigationAway}
                    className="rounded-xl border border-slate-600 bg-slate-900/70 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                  >
                    Keep Editing
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmNavigationAway}
                    className="rounded-xl border border-amber-500/45 bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/30"
                  >
                    Leave Without Saving
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

