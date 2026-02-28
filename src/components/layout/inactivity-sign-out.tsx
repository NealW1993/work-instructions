"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";

import {
  getCurrentBrowserPathWithSearch,
  saveAutoLogoutRouteForUser,
} from "@/lib/last-route-restore";
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

export function InactivitySignOut({ inactivityTimeoutMinutes }: InactivitySignOutProps) {
  const router = useRouter();
  const posthog = usePostHog();

  useEffect(() => {
    const resolvedTimeoutMinutes = normalizeInactivityTimeoutMinutes(
      inactivityTimeoutMinutes,
    );

    if (resolvedTimeoutMinutes === null) {
      return;
    }

    const timeoutMs = resolvedTimeoutMinutes * 60 * 1000;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function handleSignOut() {
      const supabase = getSupabaseBrowserClient();
      const sessionStartedAtMs = getSessionStartTime();
      const clientElapsedSeconds =
        sessionStartedAtMs !== null
          ? Math.max(0, Math.floor((Date.now() - sessionStartedAtMs) / 1000))
          : null;

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
      posthog?.reset();
      persistActiveThemePreference();
      router.push("/login");
      router.refresh();
    }

    function resetTimer() {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(handleSignOut, timeoutMs);
    }

    // Start the timer and listen for activity
    resetTimer();
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, resetTimer, { passive: true });
    }

    return () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, resetTimer);
      }
    };
  }, [inactivityTimeoutMinutes, posthog, router]);

  return null;
}
