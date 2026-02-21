"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { normalizePin } from "@/lib/utils";

type AuthMode = "password" | "pin" | "signup" | "recover_email" | "recover_pin";

const MODES: Array<{ mode: AuthMode; label: string }> = [
  { mode: "password", label: "Password" },
  { mode: "pin", label: "PIN" },
  { mode: "signup", label: "Create Account" },
  { mode: "recover_email", label: "Email Reset" },
  { mode: "recover_pin", label: "PIN Reset" },
];

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
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [mode, setMode] = useState<AuthMode>("password");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [pin, setPin] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  async function handlePasswordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await withBusy(async () => {
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (loginError) {
        throw new Error(loginError.message);
      }

      router.push("/dashboard");
      router.refresh();
    });
  }

  async function handlePinLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await withBusy(async () => {
      const response = await fetch("/api/auth/pin-login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          pin,
        }),
      });

      const payload = (await parseJsonResponse(response)) as {
        tokenHash: string;
      };

      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
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
      if (pin.length !== 6) {
        throw new Error("PIN must be exactly 6 digits.");
      }

      const { data, error: signupError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
        },
      });

      if (signupError) {
        throw new Error(signupError.message);
      }

      if (data.session) {
        const { error: pinError } = await supabase.rpc("set_my_pin", {
          new_pin: pin,
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

  async function handleEmailResetRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await withBusy(async () => {
      const response = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      await parseJsonResponse(response);
      setMessage("If the account exists, a reset link was sent.");
    });
  }

  async function handlePinReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await withBusy(async () => {
      const response = await fetch("/api/auth/pin-reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          pin,
          newPassword,
        }),
      });

      await parseJsonResponse(response);
      setMessage("Password was reset. You can now sign in with your new password.");
      setMode("password");
    });
  }

  return (
    <div className="grid gap-6 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/75 md:p-8">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Work Instructions
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Sign in with your password or 6-digit PIN. Recover access with a reset
          link or PIN reset.
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

      {mode === "password" ? (
        <form className="grid gap-3" onSubmit={handlePasswordLogin}>
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
            <span>Password</span>
            <input
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="mt-1 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {busy ? "Signing in..." : "Sign In"}
          </button>
        </form>
      ) : null}

      {mode === "pin" ? (
        <form className="grid gap-3" onSubmit={handlePinLogin}>
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
            <span>6-Digit PIN</span>
            <input
              required
              inputMode="numeric"
              pattern="[0-9]{6}"
              value={pin}
              onChange={(event) => setPin(normalizePin(event.target.value))}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 tracking-[0.35em] text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
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

      {mode === "signup" ? (
        <form className="grid gap-3" onSubmit={handleSignup}>
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
            <span>Password</span>
            <input
              required
              minLength={8}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span>6-Digit PIN</span>
            <input
              required
              inputMode="numeric"
              pattern="[0-9]{6}"
              value={pin}
              onChange={(event) => setPin(normalizePin(event.target.value))}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 tracking-[0.35em] text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
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

      {mode === "recover_email" ? (
        <form className="grid gap-3" onSubmit={handleEmailResetRequest}>
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
          <button
            type="submit"
            disabled={busy}
            className="mt-1 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {busy ? "Sending..." : "Send reset link"}
          </button>
        </form>
      ) : null}

      {mode === "recover_pin" ? (
        <form className="grid gap-3" onSubmit={handlePinReset}>
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
            <span>6-Digit PIN</span>
            <input
              required
              inputMode="numeric"
              pattern="[0-9]{6}"
              value={pin}
              onChange={(event) => setPin(normalizePin(event.target.value))}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 tracking-[0.35em] text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span>New Password</span>
            <input
              required
              type="password"
              minLength={8}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="mt-1 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {busy ? "Resetting..." : "Reset with PIN"}
          </button>
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