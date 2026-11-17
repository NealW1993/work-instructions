"use client";

import {
  ArrowLeft,
  LifeBuoy,
  Loader2,
  LogIn,
  type LucideIcon,
  MessageSquare,
  Send,
  UserPlus,
  X,
} from "lucide-react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { FloatingStatusNotices } from "@/components/ui/floating-status-notices";
import { PinInput } from "@/components/ui/pin-input";
import {
  normalizeAppRestorePath,
  popAutoLogoutRouteForUser,
  savePendingPostLoginScrollRestore,
} from "@/lib/last-route-restore";
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

function isSafeRestorePath(path: string) {
  return normalizeAppRestorePath(path) !== null;
}

async function doesRouteExistForCurrentSession(path: string) {
  if (!isSafeRestorePath(path)) {
    return false;
  }

  try {
    const targetUrl = new URL(path, window.location.origin);
    const response = await fetch(targetUrl.toString(), {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "follow",
    });

    if (!response.ok || response.status === 404) {
      return false;
    }

    const finalUrl = new URL(response.url, window.location.origin);
    if (finalUrl.origin !== window.location.origin) {
      return false;
    }
    if (finalUrl.pathname === "/login") {
      return false;
    }

    if (targetUrl.pathname !== "/dashboard" && finalUrl.pathname === "/dashboard") {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

async function resolvePostLoginDestination(userId: string) {
  const fallback = {
    path: "/dashboard",
    scrollX: 0,
    scrollY: 0,
    isAutoTimeoutResume: false,
  };

  const storedRoute = popAutoLogoutRouteForUser(userId);
  if (!storedRoute) {
    return fallback;
  }

  if (!isSafeRestorePath(storedRoute.path)) {
    return {
      ...fallback,
      isAutoTimeoutResume: true,
    };
  }

  const routeExists = await doesRouteExistForCurrentSession(storedRoute.path);
  if (!routeExists) {
    return {
      ...fallback,
      isAutoTimeoutResume: true,
    };
  }

  return {
    path: storedRoute.path,
    scrollX: storedRoute.scrollX,
    scrollY: storedRoute.scrollY,
    isAutoTimeoutResume: true,
  };
}

export function LoginPanel({ inactiveSession = false }: { inactiveSession?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // The card shows one task at a time: signing in, or creating an account.
  const [view, setView] = useState<"signin" | "signup">("signin");

  // A session whose account was deactivated (or never got a profile) is signed out here,
  // so the browser does not keep presenting a token the app will refuse.
  useEffect(() => {
    if (!inactiveSession) return;
    void getSupabaseBrowserClient().auth.signOut().catch(() => undefined);
  }, [inactiveSession]);

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
  const helpTriggerRef = useRef<HTMLButtonElement | null>(null);
  const feedbackTriggerRef = useRef<HTMLButtonElement | null>(null);
  const helpWasOpenRef = useRef(false);
  const feedbackWasOpenRef = useRef(false);

  // When a dialog closes (Escape, Cancel, the close button, a click outside or a successful send),
  // keyboard focus goes back to the button that opened it.
  useEffect(() => {
    if (helpWasOpenRef.current && !helpOpen) helpTriggerRef.current?.focus();
    helpWasOpenRef.current = helpOpen;
  }, [helpOpen]);

  useEffect(() => {
    if (feedbackWasOpenRef.current && !feedbackOpen) feedbackTriggerRef.current?.focus();
    feedbackWasOpenRef.current = feedbackOpen;
  }, [feedbackOpen]);

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

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const destination = user
      ? await resolvePostLoginDestination(user.id)
      : {
          path: "/dashboard",
          scrollX: 0,
          scrollY: 0,
          isAutoTimeoutResume: false,
        };

    if (destination.scrollX > 0 || destination.scrollY > 0) {
      savePendingPostLoginScrollRestore(destination.path, destination.scrollX, destination.scrollY);
    }

    if (
      destination.isAutoTimeoutResume &&
      !destination.path.startsWith("/dashboard")
    ) {
      router.replace("/dashboard");
      window.setTimeout(() => {
        router.push(destination.path);
      }, 0);
      return;
    }

    router.replace(destination.path);
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
      setFeedbackStatus("Thank you. Your feedback was sent anonymously.");
      setFeedbackMessage("");
      setFeedbackOpen(false);
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
      setHelpOpen(false);
    } catch (caughtError) {
      const normalizedError =
        caughtError instanceof Error ? caughtError.message : "Unable to send help request.";
      setHelpError(normalizedError);
    } finally {
      setHelpBusy(false);
    }
  }

  const signupPinMismatch = signupPinConfirm.length > 0 && signupPin !== signupPinConfirm;

  function openHelp() {
    setHelpOpen(true);
    setHelpError(null);
    setHelpStatus(null);
  }

  function openFeedback() {
    setFeedbackOpen(true);
    setFeedbackError(null);
    setFeedbackStatus(null);
  }

  return (
    <>
      <FloatingStatusNotices
        notices={[
          message && {
            id: "login-message",
            tone: "success",
            message,
            onDismiss: () => setMessage(null),
          },
          error && {
            id: "login-error",
            tone: "error",
            message: error,
            onDismiss: () => setError(null),
          },
          feedbackStatus && {
            id: "login-feedback-status",
            tone: "success",
            message: feedbackStatus,
            onDismiss: () => setFeedbackStatus(null),
          },
          helpStatus && {
            id: "login-help-status",
            tone: "success",
            message: helpStatus,
            onDismiss: () => setHelpStatus(null),
          },
        ]}
      />
      <div className="pointer-events-none fixed inset-0 -z-20 overflow-hidden">
        <video
          ref={backgroundVideoRef}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          className="h-full w-full object-cover"
          aria-label="Work instructions background video"
        >
          <source src="/omni-login-left.mp4" type="video/mp4" />
        </video>
      </div>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-slate-950/58" />

      <div className="auth-login-shell relative z-10 mx-auto w-full max-w-[28rem] overflow-hidden rounded-2xl border border-white/10 bg-slate-950/75 p-6 text-slate-100 shadow-2xl shadow-black/50 backdrop-blur-xl sm:p-8">
        <div aria-hidden="true" className={CARD_ACCENT_CLASS} />

        <div className="flex items-center gap-3">
          <Image
            src="/delta-logo.svg"
            alt=""
            width={40}
            height={40}
            priority
            className="h-10 w-10 shrink-0 rounded-full ring-1 ring-white/25"
          />
          <span className="text-base font-semibold tracking-tight text-white">Work Instructions</span>
        </div>

        {view === "signin" ? (
          <>
            <div className="mt-7 grid gap-1.5">
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Visual work instructions.
              </h1>
              <p className="text-sm text-slate-300">Reduce training time and increase quality.</p>
            </div>

            {searchParams.get("error") === "missing_profile" || inactiveSession ? (
              <p
                role="alert"
                className="mt-5 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-100"
              >
                This account is not active. Ask your system administrator to reactivate it, then sign in again.
              </p>
            ) : null}

            <form className="mt-6 grid gap-4" onSubmit={handlePinLogin}>
              <label className="grid gap-1.5">
                <span className={LABEL_CLASS}>Employee ID</span>
                <input
                  required
                  inputMode="numeric"
                  pattern="[0-9]{1,6}"
                  maxLength={6}
                  autoComplete="username"
                  placeholder="Your employee number"
                  value={pinEmployeeId}
                  onChange={(event) => setPinEmployeeId(normalizeEmployeeId(event.target.value))}
                  className={FIELD_CLASS}
                />
              </label>
              <label className="grid gap-1.5">
                <span className={LABEL_CLASS}>6-digit PIN</span>
                <PinInput
                  required
                  value={pinLoginValue}
                  onChange={setPinLoginValue}
                  className={PIN_FIELD_CLASS}
                  toggleClassName={PIN_TOGGLE_CLASS}
                />
              </label>
              <button type="submit" disabled={busy} className={`${PRIMARY_BUTTON_CLASS} mt-1`}>
                {busy ? (
                  <Loader2 aria-hidden="true" size={18} className="animate-spin" />
                ) : (
                  <LogIn aria-hidden="true" size={18} />
                )}
                {busy ? "Signing in..." : "Sign in"}
              </button>
              <div className="flex justify-center">
                <button type="button" ref={helpTriggerRef} onClick={openHelp} className={LINK_BUTTON_CLASS}>
                  <LifeBuoy aria-hidden="true" size={15} />
                  Trouble signing in?
                </button>
              </div>
            </form>

            <div className="mt-6 flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-slate-500">
              <span aria-hidden="true" className="h-px flex-1 bg-white/10" />
              New here?
              <span aria-hidden="true" className="h-px flex-1 bg-white/10" />
            </div>
            <button type="button" onClick={() => setView("signup")} className={`${SECONDARY_BUTTON_CLASS} mt-4`}>
              <UserPlus aria-hidden="true" size={18} />
              Create account
            </button>
          </>
        ) : (
          <>
            <div className="mt-7 grid gap-1.5">
              <h1 className="text-2xl font-bold tracking-tight text-white">Create your account</h1>
              <p className="text-sm text-slate-300">
                New accounts start as operators. A system admin can change your role later.
              </p>
            </div>

            <form className="mt-6 grid gap-4" onSubmit={handleSignup}>
              <label className="grid gap-1.5">
                <span className={LABEL_CLASS}>Full name</span>
                <input
                  required
                  autoComplete="name"
                  value={signupName}
                  onChange={(event) => setSignupName(event.target.value)}
                  className={FIELD_CLASS}
                />
              </label>
              <label className="grid gap-1.5">
                <span className={LABEL_CLASS}>Email</span>
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={signupEmail}
                  onChange={(event) => setSignupEmail(event.target.value)}
                  className={FIELD_CLASS}
                />
              </label>
              <label className="grid gap-1.5">
                <span className={LABEL_CLASS}>Employee ID</span>
                <input
                  required
                  inputMode="numeric"
                  pattern="[0-9]{1,6}"
                  maxLength={6}
                  value={signupEmployeeId}
                  onChange={(event) => setSignupEmployeeId(normalizeEmployeeId(event.target.value))}
                  className={FIELD_CLASS}
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className={LABEL_CLASS}>6-digit PIN</span>
                  <PinInput
                    required
                    value={signupPin}
                    onChange={setSignupPin}
                    className={PIN_FIELD_CLASS}
                    toggleClassName={PIN_TOGGLE_CLASS}
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className={LABEL_CLASS}>Confirm PIN</span>
                  <PinInput
                    required
                    value={signupPinConfirm}
                    onChange={setSignupPinConfirm}
                    className={PIN_FIELD_CLASS}
                    toggleClassName={PIN_TOGGLE_CLASS}
                  />
                </label>
              </div>
              {signupPinMismatch ? (
                <p role="alert" className="text-sm text-rose-300">
                  The two PINs do not match.
                </p>
              ) : null}
              <button
                type="submit"
                disabled={busy || signupPinMismatch}
                className={`${PRIMARY_BUTTON_CLASS} mt-1`}
              >
                {busy ? (
                  <Loader2 aria-hidden="true" size={18} className="animate-spin" />
                ) : (
                  <UserPlus aria-hidden="true" size={18} />
                )}
                {busy ? "Creating account..." : "Create account"}
              </button>
            </form>

            <div className="mt-4 flex justify-center">
              <button type="button" onClick={() => setView("signin")} className={LINK_BUTTON_CLASS}>
                <ArrowLeft aria-hidden="true" size={15} />
                Back to sign in
              </button>
            </div>
          </>
        )}

        <div className="mt-8 flex items-center justify-between gap-3 border-t border-white/10 pt-4 text-xs text-slate-400">
          <p>&copy; 2026 Work Instructions</p>
          <button
            type="button"
            ref={feedbackTriggerRef}
            onClick={openFeedback}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 font-medium text-slate-300 transition hover:bg-white/5 hover:text-white"
          >
            <MessageSquare aria-hidden="true" size={14} />
            Leave feedback
          </button>
        </div>
      </div>

      {feedbackOpen ? (
        <LoginDialog
          id="login-feedback"
          icon={MessageSquare}
          title="Leave feedback"
          description="Tell us what would make this system better. Your feedback is sent anonymously to the system admin."
          onClose={() => setFeedbackOpen(false)}
        >
          <form className="grid gap-4" onSubmit={handleSubmitFeedback}>
            <label className="grid gap-1.5">
              <span className={LABEL_CLASS}>Your feedback</span>
              <textarea
                autoFocus
                value={feedbackMessage}
                onChange={(event) => setFeedbackMessage(event.target.value)}
                rows={5}
                maxLength={4000}
                placeholder="What should we improve?"
                className={TEXTAREA_CLASS}
              />
            </label>
            {feedbackError ? <DialogError message={feedbackError} /> : null}
            <DialogActions
              busy={feedbackBusy}
              submitLabel="Send feedback"
              busyLabel="Sending..."
              onCancel={() => setFeedbackOpen(false)}
            />
          </form>
        </LoginDialog>
      ) : null}

      {helpOpen ? (
        <LoginDialog
          id="login-help"
          icon={LifeBuoy}
          title="Trouble signing in?"
          description="Send a short message and a system admin will follow up."
          onClose={() => setHelpOpen(false)}
        >
          <form className="grid gap-4" onSubmit={handleSubmitHelpRequest}>
            <ul className="grid gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3.5 py-3 text-sm text-slate-300">
              <li>Locked out after too many wrong PINs? Wait one minute, then try again.</li>
              <li>Forgot your PIN? A system admin can reset it for you.</li>
            </ul>
            <label className="grid gap-1.5">
              <span className={LABEL_CLASS}>Your name</span>
              <input
                autoFocus
                value={helpName}
                onChange={(event) => setHelpName(event.target.value)}
                maxLength={120}
                autoComplete="name"
                className={FIELD_CLASS}
              />
            </label>
            <label className="grid gap-1.5">
              <span className={LABEL_CLASS}>What do you need help with?</span>
              <textarea
                value={helpMessage}
                onChange={(event) => setHelpMessage(event.target.value)}
                rows={4}
                maxLength={4000}
                placeholder="For example: I forgot my PIN, Employee ID 1042."
                className={TEXTAREA_CLASS}
              />
            </label>
            {helpError ? <DialogError message={helpError} /> : null}
            <DialogActions
              busy={helpBusy}
              submitLabel="Send request"
              busyLabel="Sending..."
              onCancel={() => setHelpOpen(false)}
            />
          </form>
        </LoginDialog>
      ) : null}
    </>
  );
}

const LABEL_CLASS = "text-sm font-medium text-slate-200";
const FIELD_CLASS = "h-12 w-full rounded-lg border px-3.5 text-base outline-none transition";
const TEXTAREA_CLASS = "w-full rounded-lg border px-3.5 py-3 text-base outline-none transition";
const PIN_FIELD_CLASS = "h-12 rounded-lg px-3.5 pr-12 text-base tracking-[0.35em]";
const PIN_TOGGLE_CLASS = "right-1.5 px-2 text-slate-400 hover:text-white dark:text-slate-400 dark:hover:text-white";
const PRIMARY_BUTTON_CLASS =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-5 text-base font-semibold text-white shadow-lg shadow-cyan-950/40 transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60";
const SECONDARY_BUTTON_CLASS =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-5 text-base font-semibold text-slate-100 transition hover:border-white/25 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60";
const LINK_BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-cyan-300 underline-offset-4 transition hover:text-cyan-200 hover:underline";
const CARD_ACCENT_CLASS =
  "pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/80 to-transparent";

/** A dialog on the sign-in screen: the same dark card as the sign-in form, closed by Escape, the X or a click outside. */
function LoginDialog({
  id,
  icon: Icon,
  title,
  description,
  onClose,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="auth-login-shell fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        className="relative my-auto w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 p-6 text-slate-100 shadow-2xl shadow-black/60"
      >
        <div aria-hidden="true" className={CARD_ACCENT_CLASS} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-400 transition hover:bg-white/10 hover:text-white"
        >
          <X aria-hidden="true" size={18} />
        </button>
        <div className="flex items-start gap-3 pr-8">
          <span
            aria-hidden="true"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-400/20"
          >
            <Icon size={20} />
          </span>
          <div className="grid gap-1">
            <h2 id={`${id}-title`} className="text-lg font-semibold text-white">
              {title}
            </h2>
            <p id={`${id}-description`} className="text-sm text-slate-300">
              {description}
            </p>
          </div>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

function DialogError({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-100">
      {message}
    </p>
  );
}

function DialogActions({
  busy,
  submitLabel,
  busyLabel,
  onCancel,
}: {
  busy: boolean;
  submitLabel: string;
  busyLabel: string;
  onCancel: () => void;
}) {
  return (
    <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button type="button" onClick={onCancel} className={`${SECONDARY_BUTTON_CLASS} h-11 sm:w-auto`}>
        Cancel
      </button>
      <button type="submit" disabled={busy} className={`${PRIMARY_BUTTON_CLASS} h-11 sm:w-auto`}>
        {busy ? (
          <Loader2 aria-hidden="true" size={17} className="animate-spin" />
        ) : (
          <Send aria-hidden="true" size={17} />
        )}
        {busy ? busyLabel : submitLabel}
      </button>
    </div>
  );
}
