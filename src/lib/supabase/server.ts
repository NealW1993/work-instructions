import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { clientEnv } from "@/lib/env.client";
import { serverEnv } from "@/lib/env.server";
import { SUPABASE_AUTH_COOKIE_NAME } from "@/lib/supabase/constants";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const supabaseUrl =
    serverEnv.SUPABASE_URL_INTERNAL || clientEnv.NEXT_PUBLIC_SUPABASE_URL;

  return createServerClient(
    supabaseUrl,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookieOptions: {
        name: SUPABASE_AUTH_COOKIE_NAME,
      },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const cookie of cookiesToSet) {
              cookieStore.set(cookie.name, cookie.value, cookie.options);
            }
          } catch {
            // No-op in server components where setting cookies is unsupported.
          }
        },
      },
    },
  );
}
