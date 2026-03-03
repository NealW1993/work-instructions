"use client";

import { ChevronDown, Printer } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  PRINT_MEDIA_MODE_ATTRIBUTE,
  PRINT_MEDIA_MODE_EVENT,
  type PrintMediaMode,
} from "@/components/instructions/print-media-isolator";

import { cn } from "@/lib/utils";

interface PrintInstructionButtonProps {
  className?: string;
}

export function PrintInstructionButton({
  className,
}: PrintInstructionButtonProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
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

  function printWithMode(mode: PrintMediaMode) {
    document.documentElement.setAttribute(PRINT_MEDIA_MODE_ATTRIBUTE, mode);
    window.dispatchEvent(new Event(PRINT_MEDIA_MODE_EVENT));
    setOpen(false);
    window.print();
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "inline-flex items-center justify-between gap-2 rounded-xl border border-sky-500/35 bg-sky-500/12 px-3 py-1.5 text-xs font-semibold text-sky-800 transition hover:bg-sky-500/20 dark:text-sky-100",
          className,
        )}
      >
        <span className="inline-flex items-center gap-2">
          <Printer size={14} />
          Print
        </span>
        <ChevronDown size={13} />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 grid min-w-48 gap-1 rounded-xl border border-slate-300 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-950"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => printWithMode("paginate-inline")}
            className="rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Print Media Inline
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => printWithMode("append-to-end")}
            className="rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Print Media At End
          </button>
        </div>
      ) : null}
    </div>
  );
}
