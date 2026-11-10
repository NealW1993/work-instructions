"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function ModalDialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return createPortal(
    <dialog ref={ref} aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className={`fixed inset-0 m-auto max-h-[90dvh] ${wide ? "w-[min(72rem,calc(100vw-2rem))]" : "w-[min(44rem,calc(100vw-2rem))]"} overflow-y-auto rounded-2xl border border-slate-300 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100`}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button type="button" aria-label={`Close ${title}`} onClick={onClose} className="min-h-11 shrink-0 rounded-lg px-3 text-sm hover:bg-slate-100 dark:hover:bg-slate-800">Close</button>
      </div>
      <div className="grid gap-4 p-5">{children}</div>
    </dialog>, document.body,
  );
}
