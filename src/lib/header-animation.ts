import { useSyncExternalStore } from "react";

/*
 * The header's background loop is part of the look of the app, so it plays by default, including on
 * computers where Windows animation effects are turned off (shop PCs often are, for speed). Anyone who
 * prefers a still header can turn it off for their device from the account menu.
 */

export const HEADER_ANIMATION_STORAGE_KEY = "work-instructions:header-animation";
const HEADER_ANIMATION_EVENT = "work-instructions:header-animation-change";

function readEnabled() {
  try {
    return window.localStorage.getItem(HEADER_ANIMATION_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(HEADER_ANIMATION_EVENT, onChange);
  // Another tab on the same device changed the setting.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(HEADER_ANIMATION_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Whether this device shows the header loop. `null` while rendering on the server. */
export function useHeaderAnimationEnabled(): boolean | null {
  return useSyncExternalStore(subscribe, readEnabled, () => null);
}

export function setHeaderAnimationEnabled(enabled: boolean) {
  try {
    if (enabled) window.localStorage.removeItem(HEADER_ANIMATION_STORAGE_KEY);
    else window.localStorage.setItem(HEADER_ANIMATION_STORAGE_KEY, "off");
  } catch {
    // Without storage the choice lasts until the page is reloaded.
  }
  window.dispatchEvent(new Event(HEADER_ANIMATION_EVENT));
}
