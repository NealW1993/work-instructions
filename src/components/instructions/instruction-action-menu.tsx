"use client";

import { MoreHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface InstructionActionMenuProps {
  children: ReactNode;
  className?: string;
}

/** Less-used instruction actions (updates, print, pin, edit, archive) behind one labelled button. */
export function InstructionActionMenu({ children, className }: InstructionActionMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target instanceof Element && target.closest(".app-modal-shell")) {
        return;
      }

      if (!menuRef.current || !target || menuRef.current.contains(target)) {
        return;
      }

      setOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={menuRef} className={cn("relative print:hidden", className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label="More actions"
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition",
          open
            ? "border-slate-400 bg-slate-100 text-slate-950 dark:border-slate-500 dark:bg-slate-800 dark:text-white"
            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800",
        )}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
        <span aria-hidden="true">More</span>
      </button>

      {open ? (
        <div className="fixed inset-x-4 bottom-4 z-30 grid max-h-[calc(100dvh-2rem)] gap-2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900 sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-[calc(100%+0.5rem)] sm:w-[min(22rem,calc(100vw-2rem))] sm:max-h-none sm:overflow-visible">
          {children}
        </div>
      ) : null}
    </div>
  );
}
