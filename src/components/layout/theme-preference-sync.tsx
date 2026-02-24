"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";

import type { ThemePreference } from "@/lib/types";

interface ThemePreferenceSyncProps {
  themePreference: ThemePreference;
}

export function ThemePreferenceSync({ themePreference }: ThemePreferenceSyncProps) {
  const { setTheme } = useTheme();
  const lastAppliedThemePreferenceRef = useRef<ThemePreference | null>(null);

  useEffect(() => {
    if (lastAppliedThemePreferenceRef.current === themePreference) {
      return;
    }

    lastAppliedThemePreferenceRef.current = themePreference;
    setTheme(themePreference);
  }, [setTheme, themePreference]);

  return null;
}
