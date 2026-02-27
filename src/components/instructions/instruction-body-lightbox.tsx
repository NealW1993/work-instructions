"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface InstructionBodyLightboxProps {
  children: React.ReactNode;
}

export function InstructionBodyLightbox({ children }: InstructionBodyLightboxProps) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [canUsePortal, setCanUsePortal] = useState(false);

  useEffect(() => {
    setCanUsePortal(true);
  }, []);

  useEffect(() => {
    if (!lightboxSrc) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightboxSrc(null);
    };

    document.addEventListener("keydown", handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightboxSrc]);

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.tagName === "IMG") {
      const img = target as HTMLImageElement;
      if (img.src) {
        setLightboxSrc(img.src);
      }
    }
  }

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

      <img
        src={lightboxSrc}
        alt="Enlarged view"
        className="max-h-[85dvh] max-w-[90dvw] rounded-xl object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  ) : null;

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div onClick={handleClick} className="[&_img]:cursor-zoom-in">
        {children}
      </div>
      {canUsePortal && lightbox ? createPortal(lightbox, document.body) : null}
    </>
  );
}
