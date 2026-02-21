"use client";

import { usePostHog } from "posthog-js/react";
import { useEffect } from "react";

import type { AppRole } from "@/lib/types";

interface PostHogIdentifyProps {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
}

export function PostHogIdentify({
  id,
  email,
  fullName,
  role,
}: PostHogIdentifyProps) {
  const posthog = usePostHog();

  useEffect(() => {
    if (!posthog) {
      return;
    }

    posthog.identify(id, {
      email,
      full_name: fullName,
      role,
    });
  }, [posthog, id, email, fullName, role]);

  return null;
}