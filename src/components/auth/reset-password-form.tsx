"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

interface ResetPasswordFormProps {
  email: string;
  token: string;
}

export function ResetPasswordForm({ email, token }: ResetPasswordFormProps) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      if (password !== confirm) {
        throw new Error("Passwords do not match.");
      }

      const response = await fetch("/api/auth/confirm-password-reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          token,
          newPassword: password,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to reset password.");
      }

      setMessage("Password updated. Redirecting to sign in...");
      window.setTimeout(() => {
        router.push("/login");
      }, 1200);
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unexpected error.";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 rounded-2xl border border-white/30 bg-white/80 p-6 shadow-xl dark:border-white/10 dark:bg-slate-900/70">
      {message ? (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-2 text-sm text-emerald-700 dark:text-emerald-200">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-2 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </p>
      ) : null}
      <label className="grid gap-1 text-sm">
        <span>New Password</span>
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
        <span>Confirm Password</span>
        <input
          required
          minLength={8}
          type="password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {busy ? "Updating..." : "Update password"}
      </button>
    </form>
  );
}