"use client";

import { SlidersHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface InstructionActionMenuProps {
  children: ReactNode;
  className?: string;
  badgeCount?: number;
}

export function InstructionActionMenu({
  children,
  className,
  badgeCount,
}: InstructionActionMenuProps) {
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
        aria-label="Open instruction action menu"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/35 bg-cyan-500/10 text-cyan-800 transition hover:bg-cyan-500/20 dark:text-cyan-100"
      >
        <SlidersHorizontal size={16} />
        {badgeCount !== undefined && badgeCount >= 0 ? (
          <span className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-cyan-500 px-1 text-[9px] font-bold leading-none text-white">
            ({badgeCount})
          </span>
        ) : null}
        <span className="sr-only">Open instruction action menu</span>
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-2 grid w-[min(22rem,calc(100vw-2rem))] gap-2 rounded-2xl border border-white/25 bg-white/95 p-2 shadow-2xl backdrop-blur-xl dark:border-white/15 dark:bg-slate-950/95">
          {children}
        </div>
      ) : null}
    </div>
  );
}
