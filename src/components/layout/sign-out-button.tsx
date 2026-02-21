"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export function SignOutButton() {
  const router = useRouter();
  const posthog = usePostHog();

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    posthog?.reset();
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
