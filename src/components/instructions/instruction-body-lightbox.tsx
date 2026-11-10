"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { InstructionImageDialog } from "@/components/instructions/instruction-image-dialog";

interface InstructionBodyLightboxProps {
  children: React.ReactNode;
}

export function InstructionBodyLightbox({ children }: InstructionBodyLightboxProps) {
  const [image, setImage] = useState<{ src: string; caption: string } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    contentRef.current?.querySelectorAll<HTMLImageElement>("img").forEach((element) => {
      if (element.closest("a,button")) return;
      element.tabIndex = 0;
      element.setAttribute("role", "button");
      element.setAttribute("aria-haspopup", "dialog");
      element.setAttribute("aria-label", `Enlarge image: ${element.alt || "instruction figure"}`);
    });
  }, [children]);

  function openImage(event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || target.closest("a,button")) return;
    if ("key" in event && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    target.focus({ preventScroll: true });
    if (target.currentSrc || target.src) setImage({ src: target.currentSrc || target.src, caption: target.alt });
  }

  return (
    <>
      <div
        ref={contentRef}
        onClick={openImage}
        onKeyDown={openImage}
        className="min-w-0 max-w-full overflow-x-auto [&_img]:cursor-zoom-in"
      >
        {children}
      </div>
      {image ? <InstructionImageDialog src={image.src} caption={image.caption} onClose={() => setImage(null)} /> : null}
    </>
  );
}
