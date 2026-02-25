"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";

import { clearSessionStart, getSessionStartTime } from "@/lib/session-timer";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { persistActiveThemePreference } from "@/lib/theme-client";

export function SignOutButton() {
  const router = useRouter();
  const posthog = usePostHog();

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
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        keepalive: true,
        body: JSON.stringify({
          sessionStartedAtMs,
          clientElapsedSeconds,
        }),
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

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="inline-flex items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-500/20 dark:text-rose-300"
    >
      <LogOut size={16} />
      Sign Out
    </button>
  );
}
