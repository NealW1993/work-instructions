"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";

import { clearSessionStart, getSessionStartTime } from "@/lib/session-timer";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { persistActiveThemePreference } from "@/lib/theme-client";

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
  "click",
] as const;

export function InactivitySignOut() {
  const router = useRouter();
  const posthog = usePostHog();

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    async function handleSignOut() {
      const supabase = getSupabaseBrowserClient();
      const sessionStartedAtMs = getSessionStartTime();
      const clientElapsedSeconds =
        sessionStartedAtMs !== null
          ? Math.max(0, Math.floor((Date.now() - sessionStartedAtMs) / 1000))
          : null;

      try {
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
      clearTimeout(timeoutId);
      timeoutId = setTimeout(handleSignOut, INACTIVITY_TIMEOUT_MS);
    }

    // Start the timer and listen for activity
    resetTimer();
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, resetTimer, { passive: true });
    }

    return () => {
      clearTimeout(timeoutId);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, resetTimer);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
