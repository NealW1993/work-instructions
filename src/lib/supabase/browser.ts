import { createBrowserClient } from "@supabase/ssr";

import { clientEnv } from "@/lib/env.client";
import { SUPABASE_AUTH_COOKIE_NAME } from "@/lib/supabase/constants";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(
      clientEnv.NEXT_PUBLIC_SUPABASE_URL,
      clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookieOptions: {
          name: SUPABASE_AUTH_COOKIE_NAME,
        },
      },
    );
  }

  return browserClient;
}
