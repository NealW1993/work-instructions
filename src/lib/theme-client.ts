import type { ThemePreference } from "@/lib/types";

const THEME_STORAGE_KEY = "theme";

function normalizeThemePreference(value: string | null | undefined): ThemePreference | null {
  if (value === "light" || value === "dark") {
    return value;
  }

  return null;
}

export function getActiveThemePreference(): ThemePreference {
  if (typeof document !== "undefined") {
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  }

  if (typeof window !== "undefined") {
    const storedThemePreference = normalizeThemePreference(
      window.localStorage.getItem(THEME_STORAGE_KEY),
    );
    if (storedThemePreference) {
      return storedThemePreference;
    }
  }

  return "dark";
}

export function persistThemePreference(themePreference: ThemePreference) {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", themePreference === "dark");
    document.documentElement.style.colorScheme = themePreference;
  }

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
    } catch {
      // Theme persistence should never block navigation flows.
    }
  }
}

export function persistActiveThemePreference() {
  const activeThemePreference = getActiveThemePreference();
  persistThemePreference(activeThemePreference);
  return activeThemePreference;
}
