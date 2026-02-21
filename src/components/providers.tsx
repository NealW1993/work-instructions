"use client";

import { ThemeProvider } from "next-themes";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { useMemo } from "react";

import { clientEnv } from "@/lib/env.client";

let posthogInitialized = false;

function initializePostHog() {
  if (posthogInitialized) {
    return;
  }

  if (!clientEnv.NEXT_PUBLIC_POSTHOG_KEY) {
    return;
  }

  posthog.init(clientEnv.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: clientEnv.NEXT_PUBLIC_POSTHOG_HOST,
    person_profiles: "identified_only",
    capture_pageview: false,
  });

  posthogInitialized = true;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const shouldEnablePostHog = Boolean(clientEnv.NEXT_PUBLIC_POSTHOG_KEY);

  const posthogClient = useMemo(() => {
    if (!shouldEnablePostHog) {
      return null;
    }

    initializePostHog();
    return posthog;
  }, [shouldEnablePostHog]);

  const content = (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </ThemeProvider>
  );

  if (!posthogClient) {
    return content;
  }

  return <PostHogProvider client={posthogClient}>{content}</PostHogProvider>;
}