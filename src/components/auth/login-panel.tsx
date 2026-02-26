"use client";

import { CircleHelp } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

import { PinInput } from "@/components/ui/pin-input";
import { setSessionStartNow } from "@/lib/session-timer";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isValidEmployeeId, normalizeEmployeeId } from "@/lib/utils";

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
  const [showCreateAccount, setShowCreateAccount] = useState(false);

  const [pinEmployeeId, setPinEmployeeId] = useState("");
  const [pinLoginValue, setPinLoginValue] = useState("");

  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupEmployeeId, setSignupEmployeeId] = useState("");
  const [signupPin, setSignupPin] = useState("");
  const [signupPinConfirm, setSignupPinConfirm] = useState("");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpName, setHelpName] = useState("");
  const [helpMessage, setHelpMessage] = useState("");
  const [helpBusy, setHelpBusy] = useState(false);
  const [helpStatus, setHelpStatus] = useState<string | null>(null);
  const [helpError, setHelpError] = useState<string | null>(null);
  const backgroundVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!feedbackOpen && !helpOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHelpOpen(false);
        setFeedbackOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [feedbackOpen, helpOpen]);

  useEffect(() => {
    const video = backgroundVideoRef.current;
    if (!video) {
      return;
    }

    const applyPlaybackRate = () => {
      video.defaultPlaybackRate = 0.65;
      video.playbackRate = 0.65;
    };

    applyPlaybackRate();
    video.addEventListener("playing", applyPlaybackRate);
    return () => {
      video.removeEventListener("playing", applyPlaybackRate);
    };
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

  async function signInWithPinCredentials(employeeId: string, pin: string) {
    const supabase = getSupabaseBrowserClient();

    const response = await fetch("/api/auth/pin-login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        employeeId,
        pin,
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

    setSessionStartNow();
    const { error: touchSessionError } = await supabase.rpc("touch_user_session", {
      end_session: false,
    });
    if (touchSessionError) {
      console.warn("Unable to sync session start:", touchSessionError.message);
    }

    router.push("/dashboard");
  }

  async function handlePinLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await withBusy(async () => {
      const normalizedEmployeeId = normalizeEmployeeId(pinEmployeeId);

      if (!isValidEmployeeId(normalizedEmployeeId)) {
        throw new Error("Employee ID must be 1-6 digits.");
      }

      if (!/^\d{6}$/.test(pinLoginValue)) {
        throw new Error("PIN must be exactly 6 digits.");
      }

      await signInWithPinCredentials(normalizedEmployeeId, pinLoginValue);
    });
  }

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await withBusy(async () => {
      const fullName = signupName.trim();
      const email = signupEmail.trim().toLowerCase();
      const employeeId = normalizeEmployeeId(signupEmployeeId);
      const pin = signupPin.trim();
      const confirmPin = signupPinConfirm.trim();

      if (!fullName) {
        throw new Error("Full name is required.");
      }

      if (!email) {
        throw new Error("Email is required.");
      }

      if (!isValidEmployeeId(employeeId)) {
        throw new Error("Employee ID must be 1-6 digits.");
      }

      if (!/^\d{6}$/.test(pin)) {
        throw new Error("PIN must be exactly 6 digits.");
      }

      if (pin !== confirmPin) {
        throw new Error("PIN and Confirm PIN must match.");
      }

      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName,
          email,
          employeeId,
          pin,
        }),
      });

      const payload = (await parseJsonResponse(response)) as {
        promoted?: boolean;
      };

      if (payload.promoted) {
        setMessage("Account created and promoted to system admin. Signing in...");
      } else {
        setMessage("Account created. Signing in...");
      }

      await signInWithPinCredentials(employeeId, pin);
    });
  }

  async function handleSubmitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedMessage = feedbackMessage.trim();
    if (!normalizedMessage) {
      setFeedbackError("Please enter feedback before sending.");
      setFeedbackStatus(null);
      return;
    }

    setFeedbackBusy(true);
    setFeedbackError(null);
    setFeedbackStatus(null);

    try {
      const response = await fetch("/api/auth/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: normalizedMessage,
        }),
      });

      await parseJsonResponse(response);
      setFeedbackStatus("Feedback sent anonymously. Thank you.");
      setFeedbackMessage("");
    } catch (caughtError) {
      const normalizedError =
        caughtError instanceof Error ? caughtError.message : "Unable to send feedback.";
      setFeedbackError(normalizedError);
    } finally {
      setFeedbackBusy(false);
    }
  }

  async function handleSubmitHelpRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedName = helpName.trim();
    const normalizedMessage = helpMessage.trim();
    if (!normalizedName) {
      setHelpError("Please enter your name.");
      setHelpStatus(null);
      return;
    }

    if (!normalizedMessage) {
      setHelpError("Please enter a help request message.");
      setHelpStatus(null);
      return;
    }

    setHelpBusy(true);
    setHelpError(null);
    setHelpStatus(null);

    try {
      const response = await fetch("/api/auth/help", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: normalizedName,
          message: normalizedMessage,
        }),
      });

      await parseJsonResponse(response);
      setHelpStatus("Help request sent. A system admin will follow up.");
      setHelpMessage("");
    } catch (caughtError) {
      const normalizedError =
        caughtError instanceof Error ? caughtError.message : "Unable to send help request.";
      setHelpError(normalizedError);
    } finally {
      setHelpBusy(false);
    }
  }

  const signupPinMismatch = signupPinConfirm.length > 0 && signupPin !== signupPinConfirm;

  return (
    <>
      <div className="pointer-events-none fixed inset-0 -z-20 overflow-hidden">
        <video
          ref={backgroundVideoRef}
          src="/omni-login-left.mp4"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          className="h-full w-full object-cover"
          aria-label="Work instructions background video"
        />
      </div>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-slate-950/58" />
      <div className="auth-login-shell relative z-10 mx-auto w-full max-w-2xl rounded-[2rem] border border-white/20 bg-slate-950/32 p-5 text-slate-100 shadow-2xl shadow-black/45 backdrop-blur-2xl md:p-8">
        <div className="grid gap-2 text-center">
          <h1 className="text-4xl font-extrabold leading-tight text-white md:text-5xl">
            Visual work instructions for modern teams.
          </h1>
          <p className="text-base text-slate-200/90">
            Clear guidance, faster handoffs, and confident execution.
          </p>
        </div>

        {searchParams.get("error") === "missing_profile" ? (
          <p className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-500/15 p-3 text-sm text-amber-100">
            Account is missing a profile row. Run the SQL migration and try again.
          </p>
        ) : null}

        {message ? (
          <p className="mt-4 rounded-2xl border border-emerald-400/45 bg-emerald-500/15 p-3 text-sm text-emerald-100">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-2xl border border-rose-400/45 bg-rose-500/15 p-3 text-sm text-rose-100">
            {error}
          </p>
        ) : null}

        <form
          className="mx-auto mt-5 grid w-full max-w-xl justify-items-center gap-3"
          onSubmit={handlePinLogin}
        >
          <label className="grid w-full max-w-[360px] gap-1 text-left text-sm text-slate-200">
            <span>Employee ID</span>
            <input
              required
              inputMode="numeric"
              pattern="[0-9]{1,6}"
              maxLength={6}
              value={pinEmployeeId}
              onChange={(event) => setPinEmployeeId(normalizeEmployeeId(event.target.value))}
              className="rounded-xl border border-white/20 bg-black/65 px-3 py-2 text-slate-100 outline-none transition focus:border-slate-300"
            />
          </label>
          <label className="grid w-full max-w-[360px] gap-1 text-left text-sm text-slate-200">
            <span>6-Digit PIN</span>
            <PinInput
              required
              value={pinLoginValue}
              onChange={setPinLoginValue}
              className="border-white/20 bg-black/65 text-slate-100 tracking-[0.35em] focus:border-slate-300 dark:border-white/20 dark:bg-black/65 dark:text-slate-100"
            />
          </label>
          <div className="mt-1 flex w-full max-w-[360px] items-center justify-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-xl bg-white/40 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/50 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {busy ? "Validating PIN..." : "Login with PIN"}
            </button>
            <div className="group relative inline-flex shrink-0">
              <button
                type="button"
                aria-label="Need help?"
                title="If you need help logging in, contact the system admin."
                onClick={() => {
                  setHelpOpen(true);
                  setHelpError(null);
                  setHelpStatus(null);
                }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-black/50 text-slate-100 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                <CircleHelp size={18} />
              </button>
              <div className="pointer-events-none absolute bottom-[calc(100%+0.55rem)] right-0 z-20 w-60 rounded-xl border border-white/20 bg-slate-950/95 p-2.5 text-left text-xs text-slate-200 opacity-0 shadow-xl transition group-hover:opacity-100 group-focus-within:opacity-100">
                If you need help logging in, contact the system admin.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateAccount((current) => !current)}
            className="justify-self-center w-full max-w-[360px] rounded-xl border border-white/20 bg-black/50 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
          >
            {showCreateAccount ? "Hide Create Account" : "Create Account"}
          </button>
        </form>

        {showCreateAccount ? (
          <form
            className="mx-auto mt-4 grid w-full max-w-xl gap-3 rounded-2xl border border-white/20 bg-black/45 p-4 backdrop-blur-xl md:p-5"
            onSubmit={handleSignup}
          >
            <label className="grid gap-1 text-left text-sm text-slate-200">
              <span>Full Name</span>
              <input
                required
                value={signupName}
                onChange={(event) => setSignupName(event.target.value)}
                className="rounded-xl border border-white/20 bg-black/65 px-3 py-2 text-slate-100 outline-none transition focus:border-slate-300"
              />
            </label>
            <label className="grid gap-1 text-left text-sm text-slate-200">
              <span>Email</span>
              <input
                required
                type="email"
                value={signupEmail}
                onChange={(event) => setSignupEmail(event.target.value)}
                className="rounded-xl border border-white/20 bg-black/65 px-3 py-2 text-slate-100 outline-none transition focus:border-slate-300"
              />
            </label>
            <label className="grid gap-1 text-left text-sm text-slate-200">
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
                className="rounded-xl border border-white/20 bg-black/65 px-3 py-2 text-slate-100 outline-none transition focus:border-slate-300"
              />
            </label>
            <label className="grid gap-1 text-left text-sm text-slate-200">
              <span>6-Digit PIN</span>
              <PinInput
                required
                value={signupPin}
                onChange={setSignupPin}
                className="border-white/20 bg-black/65 text-slate-100 tracking-[0.35em] focus:border-slate-300 dark:border-white/20 dark:bg-black/65 dark:text-slate-100"
              />
            </label>
            <label className="grid gap-1 text-left text-sm text-slate-200">
              <span>Confirm PIN</span>
              <PinInput
                required
                value={signupPinConfirm}
                onChange={setSignupPinConfirm}
                className="border-white/20 bg-black/65 text-slate-100 tracking-[0.35em] focus:border-slate-300 dark:border-white/20 dark:bg-black/65 dark:text-slate-100"
              />
            </label>
            {signupPinMismatch ? (
              <p className="text-sm text-rose-200">PIN and Confirm PIN do not match.</p>
            ) : null}
            <button
              type="submit"
              disabled={busy || signupPinMismatch}
              className="mt-1 justify-self-center w-full max-w-[220px] rounded-xl bg-white/40 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/50 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {busy ? "Creating account..." : "Create account"}
            </button>
            <p className="text-xs text-slate-300/85">
              New accounts are created as <strong>user</strong> by default. System admin can
              promote roles in User Admin.
            </p>
          </form>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/15 pt-3 text-xs text-slate-300/80">
          <p>&reg; 2026 Omni Technologies, all rights reserved.</p>
          <button
            type="button"
            onClick={() => {
              setFeedbackOpen(true);
              setFeedbackError(null);
              setFeedbackStatus(null);
            }}
            className="rounded-lg border border-white/20 bg-black/45 px-2.5 py-1 font-semibold text-slate-100 transition hover:bg-white/10"
          >
            Leave Feedback
          </button>
        </div>
      </div>

      {feedbackOpen ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="grid w-full max-w-lg gap-3 rounded-2xl border border-white/20 bg-slate-950/90 p-4 text-slate-100 shadow-2xl">
            <div className="grid gap-1">
              <h3 className="text-lg font-bold text-slate-100">Leave Anonymous Feedback</h3>
              <p className="text-sm text-slate-300">
                This will email your feedback anonymously to the system admin.
              </p>
            </div>

            {feedbackStatus ? (
              <p className="rounded-xl border border-emerald-400/45 bg-emerald-500/15 p-2 text-sm text-emerald-100">
                {feedbackStatus}
              </p>
            ) : null}
            {feedbackError ? (
              <p className="rounded-xl border border-rose-400/45 bg-rose-500/15 p-2 text-sm text-rose-100">
                {feedbackError}
              </p>
            ) : null}

            <form className="grid gap-3" onSubmit={handleSubmitFeedback}>
              <label className="grid gap-1 text-sm text-slate-200">
                <span>Feedback</span>
                <textarea
                  value={feedbackMessage}
                  onChange={(event) => setFeedbackMessage(event.target.value)}
                  rows={6}
                  maxLength={4000}
                  placeholder="What should we improve?"
                  className="rounded-xl border border-white/20 bg-black/60 px-3 py-2 text-slate-100 outline-none transition focus:border-slate-300"
                />
              </label>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setFeedbackOpen(false)}
                  className="rounded-xl border border-white/20 bg-black/45 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={feedbackBusy}
                  className="rounded-xl bg-white/40 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/50 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {feedbackBusy ? "Sending..." : "Send Feedback"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {helpOpen ? (
        <div className="fixed inset-0 z-[121] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="grid w-full max-w-lg gap-3 rounded-2xl border border-white/20 bg-slate-950/90 p-4 text-slate-100 shadow-2xl">
            <div className="grid gap-1">
              <h3 className="text-lg font-bold text-slate-100">Request Help</h3>
              <p className="text-sm text-slate-300">
                Send your name and a short message to the system admin.
              </p>
            </div>

            {helpStatus ? (
              <p className="rounded-xl border border-emerald-400/45 bg-emerald-500/15 p-2 text-sm text-emerald-100">
                {helpStatus}
              </p>
            ) : null}
            {helpError ? (
              <p className="rounded-xl border border-rose-400/45 bg-rose-500/15 p-2 text-sm text-rose-100">
                {helpError}
              </p>
            ) : null}

            <form className="grid gap-3" onSubmit={handleSubmitHelpRequest}>
              <label className="grid gap-1 text-sm text-slate-200">
                <span>Name</span>
                <input
                  value={helpName}
                  onChange={(event) => setHelpName(event.target.value)}
                  maxLength={120}
                  placeholder="Your name"
                  className="rounded-xl border border-white/20 bg-black/60 px-3 py-2 text-slate-100 outline-none transition focus:border-slate-300"
                />
              </label>

              <label className="grid gap-1 text-sm text-slate-200">
                <span>Message</span>
                <textarea
                  value={helpMessage}
                  onChange={(event) => setHelpMessage(event.target.value)}
                  rows={6}
                  maxLength={4000}
                  placeholder="How can we help?"
                  className="rounded-xl border border-white/20 bg-black/60 px-3 py-2 text-slate-100 outline-none transition focus:border-slate-300"
                />
              </label>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setHelpOpen(false)}
                  className="rounded-xl border border-white/20 bg-black/45 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={helpBusy}
                  className="rounded-xl bg-white/40 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/50 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {helpBusy ? "Sending..." : "Send Help Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
