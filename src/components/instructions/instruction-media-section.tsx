/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { ZoomIn } from "lucide-react";

import type { InstructionMedia } from "@/lib/types";
import { InstructionVideo } from "@/components/instructions/instruction-video";
import { InstructionImageDialog } from "@/components/instructions/instruction-image-dialog";

interface InstructionMediaSectionProps {
  media: InstructionMedia[];
}

export function InstructionMediaSection({ media }: InstructionMediaSectionProps) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxCaption, setLightboxCaption] = useState<string | null>(null);

  const sortedMedia = [...media].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {sortedMedia.map((item) => (
          <figure
            key={item.id}
            className="overflow-hidden rounded-2xl border border-slate-300/70 bg-slate-50 dark:border-slate-700 dark:bg-slate-950"
          >
            {item.media_type === "video" ? (
              <InstructionVideo src={item.public_url} label={item.caption ?? "Instruction video"} />
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
                  className="max-h-[65vh] w-full object-contain transition group-hover:brightness-90"
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

      {lightboxSrc ? <InstructionImageDialog src={lightboxSrc} caption={lightboxCaption} onClose={() => setLightboxSrc(null)} /> : null}
    </>
  );
}
