"use client";

import { useTheme } from "next-themes";
import { useEffect } from "react";

import type { ThemePreference } from "@/lib/types";

interface ThemePreferenceSyncProps {
  themePreference: ThemePreference;
}

export function ThemePreferenceSync({ themePreference }: ThemePreferenceSyncProps) {
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    if (theme !== themePreference) {
      setTheme(themePreference);
    }
  }, [setTheme, theme, themePreference]);

  return null;
}
