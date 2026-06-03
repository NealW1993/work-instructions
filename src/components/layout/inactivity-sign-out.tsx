"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";

import {
  getCurrentBrowserPathWithSearch,
  saveAutoLogoutRouteForUser,
} from "@/lib/last-route-restore";
import {
  clearBrowserExitSignOutPending,
  consumeBrowserExitSignOutPending,
  markBrowserExitSignOutPending,
} from "@/lib/session-exit";
import { clearSessionStart, getSessionStartTime } from "@/lib/session-timer";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { persistActiveThemePreference } from "@/lib/theme-client";

const DEFAULT_INACTIVITY_TIMEOUT_MINUTES = 15;

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
  "click",
] as const;

interface InactivitySignOutProps {
  userId: string;
  inactivityTimeoutMinutes?: number | null;
}

function normalizeInactivityTimeoutMinutes(value: number | null | undefined) {
  if (value === null) {
    return null;
  }

  if (!Number.isInteger(value)) {
    return DEFAULT_INACTIVITY_TIMEOUT_MINUTES;
  }

  const parsed = Number(value);
  if (parsed < 1 || parsed > 10080) {
    return DEFAULT_INACTIVITY_TIMEOUT_MINUTES;
  }

  return parsed;
}

export function InactivitySignOut({ userId, inactivityTimeoutMinutes }: InactivitySignOutProps) {
  const router = useRouter();
  const posthog = usePostHog();

  useEffect(() => {
    const resolvedTimeoutMinutes = normalizeInactivityTimeoutMinutes(
      inactivityTimeoutMinutes,
    );

    const timeoutMs =
      resolvedTimeoutMinutes === null ? null : resolvedTimeoutMinutes * 60 * 1000;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let lastActivityAt = Date.now();
    let signingOut = false;
    let exitBeaconSent = false;

    function getSessionEndPayload() {
      const sessionStartedAtMs = getSessionStartTime();
      const clientElapsedSeconds =
        sessionStartedAtMs !== null
          ? Math.max(0, Math.floor((Date.now() - sessionStartedAtMs) / 1000))
          : null;

      return { sessionStartedAtMs, clientElapsedSeconds };
    }

    function sendSessionEndBeacon() {
      if (exitBeaconSent) {
        return;
      }

      exitBeaconSent = true;
      const body = JSON.stringify(getSessionEndPayload());

      try {
        if (navigator.sendBeacon) {
          const blob = new Blob([body], { type: "application/json" });
          if (navigator.sendBeacon("/api/auth/session/end", blob)) {
            return;
          }
        }
      } catch {
        // Fall through to keepalive fetch.
      }

      void fetch("/api/auth/session/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        keepalive: true,
        body,
      }).catch(() => {
        // Browser-exit telemetry is best effort.
      });
    }

    async function handleSignOut() {
      if (signingOut) {
        return;
      }

      signingOut = true;
      const supabase = getSupabaseBrowserClient();
      const { sessionStartedAtMs, clientElapsedSeconds } = getSessionEndPayload();

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const currentPath = getCurrentBrowserPathWithSearch();
        if (user?.id && currentPath) {
          saveAutoLogoutRouteForUser(user.id, currentPath, window.scrollX, window.scrollY);
        }

        const response = await fetch("/api/auth/session/end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          keepalive: true,
          body: JSON.stringify({ sessionStartedAtMs, clientElapsedSeconds }),
        });

        if (!response.ok) {
          const { error: touchSessionError } = await supabase.rpc("touch_user_session", {
            end_session: true,
          });
          if (touchSessionError) {
            console.warn("Unable to finalize session telemetry:", touchSessionError.message);
          }
        }
      } catch {
        // Do not block sign-out on session telemetry failures.
      }

      await supabase.auth.signOut();
      clearSessionStart();
      clearBrowserExitSignOutPending(userId);
      posthog?.reset();
      persistActiveThemePreference();
      router.push("/login");
      router.refresh();
    }

    if (consumeBrowserExitSignOutPending(userId)) {
      void handleSignOut();
      return;
    }

    function resetTimer() {
      if (timeoutMs === null) {
        return;
      }

      lastActivityAt = Date.now();
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(handleSignOut, timeoutMs);
    }

    // When the browser/tab becomes visible again (e.g. after laptop wakes from sleep),
    // check whether the timeout has already elapsed. Browsers freeze JS timers while
    // suspended, so a setTimeout alone cannot be relied upon for this case.
    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") {
        return;
      }
      if (timeoutMs === null) {
        return;
      }
      const elapsed = Date.now() - lastActivityAt;
      if (elapsed >= timeoutMs) {
        void handleSignOut();
      } else {
        // Re-arm the timer for the remaining time so it fires correctly.
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(handleSignOut, timeoutMs - elapsed);
      }
    }

    function handleBrowserExit() {
      markBrowserExitSignOutPending(userId);
      sendSessionEndBeacon();
    }

    if (timeoutMs !== null) {
      resetTimer();
      for (const event of ACTIVITY_EVENTS) {
        window.addEventListener(event, resetTimer, { passive: true });
      }
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    window.addEventListener("pagehide", handleBrowserExit);
    window.addEventListener("beforeunload", handleBrowserExit);

    return () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      if (timeoutMs !== null) {
        for (const event of ACTIVITY_EVENTS) {
          window.removeEventListener(event, resetTimer);
        }
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      window.removeEventListener("pagehide", handleBrowserExit);
      window.removeEventListener("beforeunload", handleBrowserExit);
    };
  }, [inactivityTimeoutMinutes, posthog, router, userId]);

  return null;
}
