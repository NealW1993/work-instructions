import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { serverEnv } from "@/lib/env.server";

let cachedAdminClient: SupabaseClient | null = null;

export function getSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl =
    serverEnv.SUPABASE_URL_INTERNAL || serverEnv.NEXT_PUBLIC_SUPABASE_URL;

  if (
    !supabaseUrl ||
    !serverEnv.SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  if (!cachedAdminClient) {
    cachedAdminClient = createClient(
      supabaseUrl,
      serverEnv.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }

  return cachedAdminClient;
}
