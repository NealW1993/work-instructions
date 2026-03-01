"use client";

import { Printer } from "lucide-react";

import { cn } from "@/lib/utils";

interface PrintInstructionButtonProps {
  instructionId: string;
  className?: string;
}

export function PrintInstructionButton({
  instructionId,
  className,
}: PrintInstructionButtonProps) {
  function handlePrint() {
    const printHref = `/instructions/${instructionId}/print?autoprint=1`;
    const openedWindow = window.open(printHref, "_blank", "noopener,noreferrer");

    if (!openedWindow) {
      window.location.href = printHref;
    }
  }

  return (
    <button
      type="button"
      onClick={handlePrint}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl border border-sky-500/35 bg-sky-500/12 px-3 py-1.5 text-xs font-semibold text-sky-800 transition hover:bg-sky-500/20 dark:text-sky-100",
        className,
      )}
    >
      <Printer size={14} />
      Print
    </button>
  );
}
