/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn } from "lucide-react";

import type { InstructionMedia } from "@/lib/types";

interface InstructionMediaSectionProps {
  media: InstructionMedia[];
}

export function InstructionMediaSection({ media }: InstructionMediaSectionProps) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxCaption, setLightboxCaption] = useState<string | null>(null);
  const canUsePortal = typeof document !== "undefined";

  useEffect(() => {
    if (!lightboxSrc) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLightboxSrc(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightboxSrc]);

  const sortedMedia = [...media].sort((a, b) => a.sort_order - b.sort_order);

  const lightbox = lightboxSrc ? (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={() => setLightboxSrc(null)}
    >
      <button
        type="button"
        onClick={() => setLightboxSrc(null)}
        aria-label="Close image"
        className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition hover:bg-white/20"
      >
        <X size={18} />
      </button>

      <div
        className="flex max-h-[90dvh] max-w-[90dvw] flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={lightboxSrc}
          alt={lightboxCaption ?? "Enlarged media"}
          className="max-h-[80dvh] max-w-[88dvw] rounded-xl object-contain shadow-2xl"
        />
        {lightboxCaption ? (
          <p className="text-center text-sm text-slate-300">{lightboxCaption}</p>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {sortedMedia.map((item) => (
          <figure
            key={item.id}
            className="overflow-hidden rounded-2xl border border-slate-300/70 bg-slate-50 dark:border-slate-700 dark:bg-slate-950"
          >
            {item.media_type === "video" ? (
              <video
                src={item.public_url}
                controls
                className="max-h-[420px] w-full bg-black"
              />
            ) : (
              <button
                type="button"
                className="group relative block w-full cursor-zoom-in"
                onClick={() => {
                  setLightboxSrc(item.public_url);
                  setLightboxCaption(item.caption ?? null);
                }}
                aria-label={`Enlarge: ${item.caption ?? "image"}`}
              >
                <img
                  src={item.public_url}
                  alt={item.caption ?? "Instruction media"}
                  className="max-h-[420px] w-full object-cover transition group-hover:brightness-90"
                />
                <span className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition group-hover:opacity-100">
                  <ZoomIn size={14} />
                </span>
              </button>
            )}
            {item.caption ? (
              <figcaption className="p-2 text-xs text-slate-600 dark:text-slate-300">
                {item.caption}
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>

      {canUsePortal && lightbox ? createPortal(lightbox, document.body) : null}
    </>
  );
}
