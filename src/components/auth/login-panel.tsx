"use client";

import { Eye, EyeOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { PinInput } from "@/components/ui/pin-input";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isValidEmployeeId, normalizeEmployeeId } from "@/lib/utils";

type AuthMode = "pin" | "password" | "signup";

const MODES: Array<{ mode: AuthMode; label: string }> = [
  { mode: "pin", label: "PIN" },
  { mode: "password", label: "Password" },
  { mode: "signup", label: "Create Account" },
];

const REMEMBER_EMAIL_KEY = "work_instructions_remembered_email";

async function parseJsonResponse(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    [key: string]: unknown;
  };

  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }

  return payload;
}

export function LoginPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mode, setMode] = useState<AuthMode>("pin");

  const [pinEmployeeId, setPinEmployeeId] = useState("");
  const [pinLoginValue, setPinLoginValue] = useState("");

  const [passwordEmail, setPasswordEmail] = useState("");
  const [passwordValue, setPasswordValue] = useState("");
  const [showPasswordLogin, setShowPasswordLogin] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [showForgotTools, setShowForgotTools] = useState(false);

  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupEmployeeId, setSignupEmployeeId] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupPasswordConfirm, setSignupPasswordConfirm] = useState("");
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showSignupPasswordConfirm, setShowSignupPasswordConfirm] = useState(false);
  const [signupPin, setSignupPin] = useState("");
  const [signupPinConfirm, setSignupPinConfirm] = useState("");

  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryEmployeeId, setRecoveryEmployeeId] = useState("");
  const [recoveryPin, setRecoveryPin] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [showTemporaryPassword, setShowTemporaryPassword] = useState(false);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const savedEmail = window.localStorage.getItem(REMEMBER_EMAIL_KEY);
    if (savedEmail) {
      setPasswordEmail(savedEmail);
      setRememberMe(true);
      setRecoveryEmail(savedEmail);
    } else {
      setRememberMe(false);
    }
  }, []);

  async function withBusy(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      await action();
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unexpected error";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }

  function getRecoveryEmail() {
    return (recoveryEmail || passwordEmail).trim().toLowerCase();
  }

  async function handlePasswordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await withBusy(async () => {
      const supabase = getSupabaseBrowserClient();
      const normalizedEmail = passwordEmail.trim().toLowerCase();

      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: passwordValue,
      });

      if (loginError) {
        throw new Error(loginError.message);
      }

      if (rememberMe) {
        window.localStorage.setItem(REMEMBER_EMAIL_KEY, normalizedEmail);
      } else {
        window.localStorage.removeItem(REMEMBER_EMAIL_KEY);
      }

      router.push("/dashboard");
      router.refresh();
    });
  }

  async function handlePinLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await withBusy(async () => {
      const supabase = getSupabaseBrowserClient();
      const normalizedEmployeeId = normalizeEmployeeId(pinEmployeeId);

      if (!isValidEmployeeId(normalizedEmployeeId)) {
        throw new Error("Employee ID must be 1-6 digits.");
      }

      const response = await fetch("/api/auth/pin-login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          employeeId: normalizedEmployeeId,
          pin: pinLoginValue,
        }),
      });

      const payload = (await parseJsonResponse(response)) as {
        tokenHash: string;
      };

      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: payload.tokenHash,
        type: "magiclink",
      });

      if (verifyError) {
        throw new Error(verifyError.message);
      }

      router.push("/dashboard");
      router.refresh();
    });
  }

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await withBusy(async () => {
      const supabase = getSupabaseBrowserClient();

      if (signupPassword !== signupPasswordConfirm) {
        throw new Error("Password and Confirm Password must match.");
      }

      if (signupPin !== signupPinConfirm) {
        throw new Error("PIN and Confirm PIN must match.");
      }

      if (signupPin.length !== 6) {
        throw new Error("PIN must be exactly 6 digits.");
      }

      const normalizedEmployeeId = normalizeEmployeeId(signupEmployeeId);
      if (!isValidEmployeeId(normalizedEmployeeId)) {
        throw new Error("Employee ID must be 1-6 digits.");
      }

      const { data, error: signupError } = await supabase.auth.signUp({
        email: signupEmail.trim().toLowerCase(),
        password: signupPassword,
        options: {
          data: {
            full_name: signupName,
            employee_id: normalizedEmployeeId,
          },
        },
      });

      if (signupError) {
        if (signupError.message.toLowerCase().includes("already registered")) {
          setMessage(
            "That account already exists. Use PIN login or Password -> Forgot password.",
          );
          setMode("pin");
          return;
        }
        throw new Error(signupError.message);
      }

      if (data.session) {
        if (!data.user?.id) {
          throw new Error("Unable to create profile for this account.");
        }

        const { error: profileEmployeeIdError } = await supabase
          .from("profiles")
          .update({
            employee_id: normalizedEmployeeId,
          })
          .eq("id", data.user.id);

        if (profileEmployeeIdError) {
          throw new Error(profileEmployeeIdError.message);
        }

        const { error: pinError } = await supabase.rpc("set_my_pin", {
          new_pin: signupPin,
        });

        if (pinError) {
          throw new Error(pinError.message);
        }

        const accessToken = data.session.access_token;

        await fetch("/api/users/bootstrap", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        });

        setMessage(
          "Account created. If your email matches SYSTEM_ADMIN_EMAIL and no system admin exists yet, this account was promoted automatically.",
        );
        router.push("/dashboard");
        router.refresh();
        return;
      }

      setMessage(
        "Account created. Confirm the email if your Supabase project requires confirmation before sign-in.",
      );
    });
  }

  async function sendEmailResetLink() {
    await withBusy(async () => {
      const normalizedEmail = getRecoveryEmail();
      if (!normalizedEmail) {
        throw new Error("Enter an email to send a reset link.");
      }

      const response = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: normalizedEmail }),
      });

      await parseJsonResponse(response);
      setRecoveryEmail(normalizedEmail);
      setMessage("If the account exists, a reset link was sent.");
    });
  }

  async function generateTemporaryPassword() {
    await withBusy(async () => {
      const normalizedEmployeeId = normalizeEmployeeId(recoveryEmployeeId);
      if (!isValidEmployeeId(normalizedEmployeeId)) {
        throw new Error("Enter a valid Employee ID (1-6 digits).");
      }

      if (recoveryPin.length !== 6) {
        throw new Error("Enter a valid 6-digit PIN.");
      }

      const response = await fetch("/api/auth/recover-password-by-pin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          employeeId: normalizedEmployeeId,
          pin: recoveryPin,
        }),
      });

      const payload = (await parseJsonResponse(response)) as {
        temporaryPassword: string;
        email: string;
      };

      setTemporaryPassword(payload.temporaryPassword);
      setShowTemporaryPassword(false);
      setPasswordEmail(payload.email);
      setPasswordValue(payload.temporaryPassword);
      setMode("password");
      setMessage(
        "Temporary password generated. Sign in with it, then change your password.",
      );
    });
  }

  const signupPasswordMismatch =
    signupPasswordConfirm.length > 0 && signupPassword !== signupPasswordConfirm;
  const signupPinMismatch =
    signupPinConfirm.length > 0 && signupPin !== signupPinConfirm;

  return (
    <div className="grid gap-6 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/75 md:p-8">
      <div className="space-y-3">
        <Image
          src="/omni-technologies-logo.svg"
          alt="OMNI Technologies"
          width={420}
          height={100}
          priority
          className="h-10 w-auto opacity-95"
        />
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Work Instructions
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Sign in fast with Employee ID + 6-digit PIN. Password login is still available.
        </p>
        <div className="flex flex-wrap gap-2">
          {MODES.map((item) => (
            <button
              key={item.mode}
              type="button"
              onClick={() => setMode(item.mode)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                mode === item.mode
                  ? "bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900"
                  : "bg-slate-900/10 text-slate-700 hover:bg-slate-900/20 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/20"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {searchParams.get("error") === "missing_profile" ? (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-200">
          Account is missing a profile row. Run the SQL migration and try again.
        </p>
      ) : null}

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

      {mode === "pin" ? (
        <form className="grid gap-3" onSubmit={handlePinLogin}>
          <label className="grid gap-1 text-sm">
            <span>Employee ID</span>
            <input
              required
              inputMode="numeric"
              pattern="[0-9]{1,6}"
              maxLength={6}
              value={pinEmployeeId}
              onChange={(event) =>
                setPinEmployeeId(normalizeEmployeeId(event.target.value))
              }
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span>6-Digit PIN</span>
            <PinInput
              required
              value={pinLoginValue}
              onChange={setPinLoginValue}
              className="tracking-[0.35em]"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="mt-1 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {busy ? "Validating PIN..." : "Login with PIN"}
          </button>
        </form>
      ) : null}

      {mode === "password" ? (
        <form className="grid gap-3" onSubmit={handlePasswordLogin}>
          <label className="grid gap-1 text-sm">
            <span>Email</span>
            <input
              required
              type="email"
              value={passwordEmail}
              onChange={(event) => setPasswordEmail(event.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span>Password</span>
            <div className="relative">
              <input
                required
                type={showPasswordLogin ? "text" : "password"}
                value={passwordValue}
                onChange={(event) => setPasswordValue(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 pr-11 text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={() => setShowPasswordLogin((current) => !current)}
                aria-label={showPasswordLogin ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-2 flex items-center rounded-md px-1.5 text-slate-500 transition hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 dark:text-slate-400 dark:hover:text-slate-200"
              >
                {showPasswordLogin ? (
                  <EyeOff size={16} aria-hidden="true" />
                ) : (
                  <Eye size={16} aria-hidden="true" />
                )}
              </button>
            </div>
          </label>

          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 accent-cyan-500 dark:border-slate-600"
              />
              <span>Remember me</span>
            </label>
            <button
              type="button"
              onClick={() => setShowForgotTools((current) => !current)}
              className="font-semibold underline underline-offset-2 transition hover:text-cyan-600 dark:hover:text-cyan-300"
            >
              {showForgotTools ? "Hide forgot tools" : "Forgot password?"}
            </button>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="mt-1 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {busy ? "Signing in..." : "Sign In"}
          </button>

          {showForgotTools ? (
            <div className="mt-1 grid gap-3 rounded-2xl border border-white/20 bg-slate-900/30 p-3 text-sm">
              <p className="text-xs text-slate-300">
                Enter your email to send a reset link, or enter Employee ID + PIN
                to generate a temporary password you can reveal.
              </p>
              <label className="grid gap-1 text-sm">
                <span>Recovery Email</span>
                <input
                  type="email"
                  value={recoveryEmail}
                  onChange={(event) => setRecoveryEmail(event.target.value)}
                  placeholder={passwordEmail || "you@company.com"}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </label>
              <button
                type="button"
                onClick={() => void sendEmailResetLink()}
                disabled={busy}
                className="rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Send reset link
              </button>

              <div className="h-px bg-white/15" />

              <label className="grid gap-1 text-sm">
                <span>Employee ID</span>
                <input
                  inputMode="numeric"
                  pattern="[0-9]{1,6}"
                  maxLength={6}
                  value={recoveryEmployeeId}
                  onChange={(event) =>
                    setRecoveryEmployeeId(normalizeEmployeeId(event.target.value))
                  }
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span>6-Digit PIN</span>
                <PinInput
                  value={recoveryPin}
                  onChange={setRecoveryPin}
                  className="tracking-[0.35em]"
                />
              </label>
              <button
                type="button"
                onClick={() => void generateTemporaryPassword()}
                disabled={busy}
                className="rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Get temporary password
              </button>

              {temporaryPassword ? (
                <label className="grid gap-1 text-sm">
                  <span>Temporary Password</span>
                  <div className="relative">
                    <input
                      readOnly
                      type={showTemporaryPassword ? "text" : "password"}
                      value={temporaryPassword}
                      className="w-full rounded-xl border border-slate-500/50 bg-slate-900/70 px-3 py-2 pr-11 text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowTemporaryPassword((current) => !current)
                      }
                      aria-label={
                        showTemporaryPassword
                          ? "Hide temporary password"
                          : "Show temporary password"
                      }
                      className="absolute inset-y-0 right-2 flex items-center rounded-md px-1.5 text-slate-400 transition hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                    >
                      {showTemporaryPassword ? (
                        <EyeOff size={16} aria-hidden="true" />
                      ) : (
                        <Eye size={16} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  <span className="text-xs text-slate-400">
                    Sign in with this password, then change it immediately.
                  </span>
                </label>
              ) : null}
            </div>
          ) : null}
        </form>
      ) : null}

      {mode === "signup" ? (
        <form className="grid gap-3" onSubmit={handleSignup}>
          <label className="grid gap-1 text-sm">
            <span>Full Name</span>
            <input
              required
              value={signupName}
              onChange={(event) => setSignupName(event.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span>Email</span>
            <input
              required
              type="email"
              value={signupEmail}
              onChange={(event) => setSignupEmail(event.target.value)}
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
              value={signupEmployeeId}
              onChange={(event) =>
                setSignupEmployeeId(normalizeEmployeeId(event.target.value))
              }
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span>Password</span>
            <div className="relative">
              <input
                required
                minLength={8}
                type={showSignupPassword ? "text" : "password"}
                value={signupPassword}
                onChange={(event) => setSignupPassword(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 pr-11 text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={() => setShowSignupPassword((current) => !current)}
                aria-label={showSignupPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-2 flex items-center rounded-md px-1.5 text-slate-500 transition hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 dark:text-slate-400 dark:hover:text-slate-200"
              >
                {showSignupPassword ? (
                  <EyeOff size={16} aria-hidden="true" />
                ) : (
                  <Eye size={16} aria-hidden="true" />
                )}
              </button>
            </div>
          </label>
          <label className="grid gap-1 text-sm">
            <span>Confirm Password</span>
            <div className="relative">
              <input
                required
                minLength={8}
                type={showSignupPasswordConfirm ? "text" : "password"}
                value={signupPasswordConfirm}
                onChange={(event) => setSignupPasswordConfirm(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 pr-11 text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={() =>
                  setShowSignupPasswordConfirm((current) => !current)
                }
                aria-label={
                  showSignupPasswordConfirm
                    ? "Hide confirm password"
                    : "Show confirm password"
                }
                className="absolute inset-y-0 right-2 flex items-center rounded-md px-1.5 text-slate-500 transition hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 dark:text-slate-400 dark:hover:text-slate-200"
              >
                {showSignupPasswordConfirm ? (
                  <EyeOff size={16} aria-hidden="true" />
                ) : (
                  <Eye size={16} aria-hidden="true" />
                )}
              </button>
            </div>
          </label>
          {signupPasswordMismatch ? (
            <p className="text-sm text-rose-600 dark:text-rose-300">
              Password and Confirm Password do not match.
            </p>
          ) : null}
          <label className="grid gap-1 text-sm">
            <span>6-Digit PIN</span>
            <PinInput
              required
              value={signupPin}
              onChange={setSignupPin}
              className="tracking-[0.35em]"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span>Confirm PIN</span>
            <PinInput
              required
              value={signupPinConfirm}
              onChange={setSignupPinConfirm}
              className="tracking-[0.35em]"
            />
          </label>
          {signupPinMismatch ? (
            <p className="text-sm text-rose-600 dark:text-rose-300">
              PIN and Confirm PIN do not match.
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy || signupPasswordMismatch || signupPinMismatch}
            className="mt-1 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {busy ? "Creating account..." : "Create account"}
          </button>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            New accounts are created as <strong>user</strong> by default.
            System admin can promote roles in User Admin.
          </p>
        </form>
      ) : null}

      <div className="text-xs text-slate-500 dark:text-slate-400">
        Need help? Ask your system admin to reset your role or PIN.
        <div>
          <Link href="/dashboard" className="underline">
            Continue to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
