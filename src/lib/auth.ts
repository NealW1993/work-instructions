import "server-only";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export async function getCurrentUserWithProfile() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, user: null, profile: null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();

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