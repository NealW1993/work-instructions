import type { NextRequest } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";

export async function getRequestProfile(request: NextRequest): Promise<Profile | null> {
  const supabaseAdmin = getSupabaseAdminClient();
  const authorization = request.headers.get("authorization");

  if (!authorization || !authorization.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = authorization.slice(7).trim();
  if (!token) {
    return null;
  }

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return null;
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  return profile?.is_active ? profile : null;
}
