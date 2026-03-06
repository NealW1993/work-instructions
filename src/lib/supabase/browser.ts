import { createBrowserClient } from "@supabase/ssr";

import { clientEnv } from "@/lib/env.client";
import { SUPABASE_AUTH_COOKIE_NAME } from "@/lib/supabase/constants";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

function isLoopbackOnlyHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname === "host.docker.internal"
  );
}

function resolveBrowserSupabaseUrl() {
  const configuredUrl = clientEnv.NEXT_PUBLIC_SUPABASE_URL;

  if (typeof window === "undefined" || !configuredUrl) {
    return configuredUrl;
  }

  try {
    const resolvedUrl = new URL(configuredUrl);
    const currentHostname = window.location.hostname;

    if (
      !isLoopbackOnlyHostname(resolvedUrl.hostname) ||
      !currentHostname ||
      isLoopbackOnlyHostname(currentHostname)
    ) {
      return configuredUrl;
    }

    resolvedUrl.hostname = currentHostname;
    return resolvedUrl.toString();
  } catch {
    return configuredUrl;
  }
}

export function getSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(
      resolveBrowserSupabaseUrl(),
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
