"use client";

import { useEffect, useRef } from "react";

export function LoginHeroMedia() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const applyPlaybackRate = () => {
      video.defaultPlaybackRate = 0.65;
      video.playbackRate = 0.65;
    };

    applyPlaybackRate();
    video.addEventListener("playing", applyPlaybackRate);
    return () => {
      video.removeEventListener("playing", applyPlaybackRate);
    };
  }, []);

  return (
    <section className="relative isolate h-full min-h-[22rem] overflow-hidden rounded-[2rem] border border-white/15 shadow-2xl shadow-black/40 lg:min-h-full">
      <video
        ref={videoRef}
        src="/omni-login-left.mp4"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className="absolute inset-0 h-full w-full object-cover"
        aria-label="Work instructions hero video"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950/80 via-slate-950/65 to-slate-950/50" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(148,163,184,0.24),transparent_50%)]" />
      <div className="relative z-10 flex h-full items-end p-7 md:p-10">
        <h1 className="max-w-xl text-4xl font-extrabold leading-tight text-white md:text-5xl">
          Fast, visual work instructions that you create.
        </h1>
      </div>
    </section>
  );
}
