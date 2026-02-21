"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

interface InstructionBackButtonProps {
  fallbackHref: string;
}

export function InstructionBackButton({ fallbackHref }: InstructionBackButtonProps) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
          return;
        }

        router.push(fallbackHref);
      }}
      className="inline-flex w-fit items-center gap-2 rounded-xl border border-slate-300 bg-white/80 px-3 py-1.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-100 dark:hover:bg-slate-900"
    >
      <ArrowLeft size={15} />
      Back
    </button>
  );
}
