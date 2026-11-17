import type { ThemePreference } from "@/lib/types";

/**
 * Applies the signed-in user's theme before the page is painted. Without it, a full page load first
 * shows the theme this browser last used and then switches once the page has loaded (a visible flash
 * when, for example, another user last signed in on this device). ThemePreferenceSync keeps the
 * theme in step after client-side navigation, where this script does not run.
 */
export function ThemePreferenceScript({ themePreference }: { themePreference: ThemePreference }) {
  const theme = themePreference === "light" ? "light" : "dark";
  const code = `try{var t=${JSON.stringify(theme)},d=document.documentElement;localStorage.setItem("theme",t);d.classList.remove("light","dark");d.classList.add(t);d.style.colorScheme=t}catch(e){}`;

  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
