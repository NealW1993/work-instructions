"use client";

import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useEffect } from "react";

export function PostHogPageview() {
  const posthog = usePostHog();
  const pathname = usePathname();

  useEffect(() => {
    if (!posthog) {
      return;
    }

    const search = window.location.search;
    posthog.capture("$pageview", {
      $current_url: `${window.location.origin}${pathname}${search}`,
    });
  }, [pathname, posthog]);

  return null;
}
