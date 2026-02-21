"use client";

import { ThemeProvider } from "next-themes";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { useMemo } from "react";

import { PostHogPageview } from "@/components/analytics/posthog-pageview";
import { clientEnv } from "@/lib/env.client";

let posthogInitialized = false;

function initializePostHog() {
  if (posthogInitialized) {
    return;
  }

  if (!clientEnv.NEXT_PUBLIC_POSTHOG_KEY) {
    return;
  }

  try {
    posthog.init(clientEnv.NEXT_PUBLIC_POSTHOG_KEY, {
      api_host: clientEnv.NEXT_PUBLIC_POSTHOG_HOST,
      person_profiles: "identified_only",
      capture_pageview: false,
      capture_pageleave: true,
      autocapture: true,
    });
  } catch (error) {
    // Prevent analytics setup failures from breaking the app shell.
    console.error("PostHog initialization failed", error);
    return;
  }

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
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      {children}
    </ThemeProvider>
  );

  if (!posthogClient) {
    return content;
  }

  return (
    <PostHogProvider client={posthogClient}>
      <PostHogPageview />
      {content}
    </PostHogProvider>
  );
}
