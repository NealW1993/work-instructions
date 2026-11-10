"use client";

import { useState } from "react";
import { inferVideoMimeType } from "@/lib/video";

export function InstructionVideo({ src, mimeType, label = "Instruction video", className = "max-h-[65vh] w-full bg-black" }: { src: string; mimeType?: string | null; label?: string; className?: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return (
    <div className="min-w-0">
      <video key={src} src={src} controls playsInline preload="metadata" aria-label={label}
        className={className} onError={() => setFailedSource(src)}>
        <source src={src} type={mimeType ?? inferVideoMimeType(src) ?? undefined} />
        Your browser cannot play this video.
      </video>
      {failedSource === src ? (
        <p role="alert" className="border-t border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          This device could not play the video. <a href={src} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Open the video file</a> or try an MP4 encoded with H.264/AAC.
        </p>
      ) : null}
    </div>
  );
}
