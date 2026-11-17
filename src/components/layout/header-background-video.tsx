"use client";

import { useSyncExternalStore } from "react";

import { useHeaderAnimationEnabled } from "@/lib/header-animation";

/** The header loop plays slowly so it reads as ambient motion, not content. */
const PLAYBACK_RATE = 0.45;

function subscribeToTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function currentTheme() {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * The animated header background. Only the video for the current theme is loaded (the dark loop is
 * large, which matters on tablets) and it switches when the theme changes. It plays unless the person
 * has turned the header animation off for their device in the account menu.
 */
export function HeaderBackgroundVideo() {
  const theme = useSyncExternalStore(subscribeToTheme, currentTheme, () => null);
  const enabled = useHeaderAnimationEnabled();
  if (!theme || !enabled) return null;

  const source = theme === "dark" ? "/header-dark.mp4" : "/header-light.mp4";
  return (
    <video
      key={source}
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
      tabIndex={-1}
      disablePictureInPicture
      onLoadedMetadata={(event) => {
        event.currentTarget.defaultPlaybackRate = PLAYBACK_RATE;
        event.currentTarget.playbackRate = PLAYBACK_RATE;
      }}
      className="absolute inset-0 h-full w-full object-cover"
    >
      <source src={source} type="video/mp4" />
    </video>
  );
}
