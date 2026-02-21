"use client";

import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { FormEvent, useMemo, useState } from "react";

import { PinInput } from "@/components/ui/pin-input";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { ThemePreference } from "@/lib/types";
import { isValidEmployeeId, normalizeEmployeeId } from "@/lib/utils";

interface AccountSettingsPanelProps {
  initialFullName: string;
  initialEmail: string;
  initialEmployeeId: string;
  initialThemePreference: ThemePreference;
}

export function AccountSettingsPanel({
  initialFullName,
  initialEmail,
  initialEmployeeId,
  initialThemePreference,
}: AccountSettingsPanelProps) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [savedFullName, setSavedFullName] = useState(initialFullName);
  const [savedEmail, setSavedEmail] = useState(initialEmail.toLowerCase());
  const [savedEmployeeId, setSavedEmployeeId] = useState(initialEmployeeId);
  const [savedThemePreference, setSavedThemePreference] =
    useState<ThemePreference>(initialThemePreference);

  const [fullName, setFullName] = useState(initialFullName);
  const [email, setEmail] = useState(initialEmail);
  const [employeeId, setEmployeeId] = useState(initialEmployeeId);
  const [themePreference, setThemePreference] =
    useState<ThemePreference>(initialThemePreference);
  const [wantsPasswordChange, setWantsPasswordChange] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [wantsPinChange, setWantsPinChange] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const normalizedFullName = fullName.trim();
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedEmployeeId = normalizeEmployeeId(employeeId);
  const passwordMismatch =
    wantsPasswordChange && confirmPassword.length > 0 && password !== confirmPassword;
  const pinMismatch = wantsPinChange && confirmPin.length > 0 && pin !== confirmPin;
  const fullNameChanged = normalizedFullName !== savedFullName;
  const emailChanged = normalizedEmail !== savedEmail;
  const employeeIdChanged = normalizedEmployeeId !== savedEmployeeId;
  const themeChanged = themePreference !== savedThemePreference;
  const passwordChanged = wantsPasswordChange && password.length > 0;
  const pinChanged = wantsPinChange && pin.length > 0;

  const hasChanges =
    fullNameChanged ||
    emailChanged ||
    employeeIdChanged ||
    themeChanged ||
    passwordChanged ||
    pinChanged;

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

      if (!isValidEmployeeId(normalizedEmployeeId)) {
        throw new Error("Employee ID must be 1-6 digits.");
      }

      if (wantsPasswordChange) {
        if (password.length < 8) {
          throw new Error("Password must be at least 8 characters.");
        }

        if (passwordMismatch) {
          throw new Error("Password and Confirm Password must match.");
        }
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
        employeeId?: string;
        themePreference?: ThemePreference;
        password?: string;
      } = {};
      let accountUpdated = false;

      if (fullNameChanged) {
        payload.fullName = normalizedFullName;
      }

      if (emailChanged) {
        payload.email = normalizedEmail;
      }

      if (employeeIdChanged) {
        payload.employeeId = normalizedEmployeeId;
      }

      if (themeChanged) {
        payload.themePreference = themePreference;
      }

      if (wantsPasswordChange && password) {
        payload.password = password;
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

      setPassword("");
      setConfirmPassword("");
      setWantsPasswordChange(false);
      setShowPassword(false);
      setShowConfirmPassword(false);
      setPin("");
      setConfirmPin("");
      setWantsPinChange(false);
      setSavedFullName(normalizedFullName);
      setSavedEmail(normalizedEmail);
      setSavedEmployeeId(normalizedEmployeeId);
      setSavedThemePreference(themePreference);
      if (accountUpdated && pinChanged) {
        setMessage("Account and PIN updated.");
      } else if (pinChanged) {
        setMessage("PIN updated.");
      } else {
        setMessage("Account updated.");
      }

      if (fullNameChanged || emailChanged || employeeIdChanged) {
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
    <section className="grid gap-4 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7">
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
          Account Settings
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Update your full name, email, employee ID, password, and PIN.
        </p>
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

      <form className="grid gap-3 md:max-w-2xl" onSubmit={handleSubmit}>
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
          <input
            required
            inputMode="numeric"
            pattern="[0-9]{1,6}"
            maxLength={6}
            value={employeeId}
            onChange={(event) => setEmployeeId(normalizeEmployeeId(event.target.value))}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </label>

        <fieldset className="grid gap-1 text-sm">
          <legend>Theme</legend>
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

        <div className="grid gap-1 text-sm">
          <span>Password</span>
          <button
            type="button"
            onClick={() => {
              if (wantsPasswordChange) {
                setWantsPasswordChange(false);
                setPassword("");
                setConfirmPassword("");
                setShowPassword(false);
                setShowConfirmPassword(false);
                return;
              }

              setWantsPasswordChange(true);
            }}
            className={`w-fit rounded-xl border px-3 py-1.5 text-sm font-semibold transition ${
              wantsPasswordChange
                ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-900 dark:text-cyan-100"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
            }`}
          >
            {wantsPasswordChange ? "Cancel password change" : "Change password"}
          </button>
        </div>

        {wantsPasswordChange ? (
          <>
            <label className="grid gap-1 text-sm">
              <span>New Password</span>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  name="account_new_password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 pr-11 text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-2 flex items-center rounded-md px-1.5 text-slate-500 transition hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  {showPassword ? (
                    <EyeOff size={16} aria-hidden="true" />
                  ) : (
                    <Eye size={16} aria-hidden="true" />
                  )}
                </button>
              </div>
            </label>

            <label className="grid gap-1 text-sm">
              <span>Confirm New Password</span>
              <div className="relative">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                  name="account_confirm_new_password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 pr-11 text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((current) => !current)}
                  aria-label={
                    showConfirmPassword ? "Hide confirm password" : "Show confirm password"
                  }
                  className="absolute inset-y-0 right-2 flex items-center rounded-md px-1.5 text-slate-500 transition hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  {showConfirmPassword ? (
                    <EyeOff size={16} aria-hidden="true" />
                  ) : (
                    <Eye size={16} aria-hidden="true" />
                  )}
                </button>
              </div>
            </label>
          </>
        ) : null}

        {passwordMismatch ? (
          <p className="text-sm text-rose-600 dark:text-rose-300">
            Password and Confirm Password do not match.
          </p>
        ) : null}

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

        {wantsPinChange ? (
          <>
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
          </>
        ) : null}

        {pinMismatch ? (
          <p className="text-sm text-rose-600 dark:text-rose-300">
            PIN and Confirm PIN do not match.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || passwordMismatch || pinMismatch}
          className="mt-1 w-fit rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {busy ? "Saving..." : "Save account changes"}
        </button>
      </form>
    </section>
  );
}
