"use client";

import { ExternalLink, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface InstructionImageDialogProps {
  src: string;
  caption?: string | null;
  onClose: () => void;
}

/** One contained image viewer for inline figures and attached manufacturing images. */
export function InstructionImageDialog({ src, caption, onClose }: InstructionImageDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <dialog ref={ref} aria-label="Enlarged instruction image" onCancel={(event) => { event.preventDefault(); onClose(); }}
      className="instruction-image-dialog fixed inset-0 m-0 h-dvh max-h-none w-dvw max-w-none border-0 bg-slate-950/95 p-0 text-white backdrop:bg-slate-950/80">
      <div className="flex h-full min-h-0 flex-col gap-3 p-3 sm:gap-4 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <h2 className="min-w-0 break-words text-base font-semibold">{caption || "Instruction image"}</h2>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <a href={src} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/25 px-3 text-sm hover:bg-white/10"><ExternalLink size={17} />Open original</a>
            <button autoFocus type="button" aria-label="Close image" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-white/25 hover:bg-white/10"><X size={20} /></button>
          </div>
        </div>
        <div className="min-h-0 min-w-0 flex-1">
          {/* Preserve every edge and the original proportions of drawings and setup photos. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={caption || "Enlarged instruction image"} className="h-full w-full object-contain" />
        </div>
      </div>
    </dialog>, document.body,
  );
}
