"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";

interface PrintPageControlsProps {
  instructionHref: string;
}

export function PrintPageControls({ instructionHref }: PrintPageControlsProps) {
  return (
    <div className="print-toolbar mb-4 flex flex-wrap items-center justify-between gap-2">
      <Link
        href={instructionHref}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900/70 dark:text-slate-100 dark:hover:bg-slate-800"
      >
        <ArrowLeft size={15} />
        Back to Instruction
      </Link>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/45 bg-cyan-500/15 px-3 py-1.5 text-sm font-semibold text-cyan-900 transition hover:bg-cyan-500/25 dark:text-cyan-100"
      >
        <Printer size={15} />
        Print
      </button>
    </div>
  );
}
