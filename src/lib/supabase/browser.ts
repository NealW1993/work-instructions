import { createBrowserClient } from "@supabase/ssr";

import { clientEnv } from "@/lib/env.client";
import { SUPABASE_AUTH_COOKIE_NAME } from "@/lib/supabase/constants";
import { browserBackendUrl } from "@/lib/backend-url";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function getBrowserSupabaseUrl() {
  return browserBackendUrl(clientEnv.NEXT_PUBLIC_SUPABASE_URL, typeof window === "undefined" ? undefined : window.location);
}

export function getSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(
      getBrowserSupabaseUrl(),
      clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookieOptions: {
          name: SUPABASE_AUTH_COOKIE_NAME,
          secure: typeof window !== "undefined" && window.location.protocol === "https:",
        },
      },
    );
  }

  return browserClient;
}
