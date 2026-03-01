import "server-only";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

const AUTH_QUERY_TIMEOUT_MS = 10000;

async function withTimeout<T>(
  promise: PromiseLike<T>,
  fallback: () => T,
  timeoutMs = AUTH_QUERY_TIMEOUT_MS,
) {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeoutHandle = setTimeout(() => {
          resolve(fallback());
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function getCurrentUserWithProfile() {
  const supabase = await createSupabaseServerClient();
  const authQuery = supabase.auth.getUser();
  const authResult = await withTimeout(
    authQuery,
    () =>
      ({
        data: { user: null },
        error: {
          name: "AuthTimeoutError",
          message: "Auth lookup timed out.",
        },
      }) as Awaited<typeof authQuery>,
  );
  const user = authResult.data.user;

  if (!user) {
    return { supabase, user: null, profile: null };
  }

  const profileQuery = supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();
  const profileResult = await withTimeout(
    profileQuery,
    () =>
      ({
        data: null,
        error: null,
        count: null,
        status: 408,
        statusText: "Request Timeout",
      }) as Awaited<typeof profileQuery>,
  );
  const profile = profileResult.data;

  return { supabase, user, profile: profile ?? null };
}

export async function requireAuthenticatedUser() {
  const context = await getCurrentUserWithProfile();

  if (!context.user) {
    redirect("/login");
  }

  if (!context.profile) {
    redirect("/login?error=missing_profile");
  }

  return {
    supabase: context.supabase,
    user: context.user,
    profile: context.profile,
  };
}
