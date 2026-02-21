"use client";

import { Loader2, Pin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

interface PinInstructionButtonProps {
  instructionId: string;
  userId: string;
  initialPinned: boolean;
  className?: string;
}

export function PinInstructionButton({
  instructionId,
  userId,
  initialPinned,
  className,
}: PinInstructionButtonProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [isPinned, setIsPinned] = useState(initialPinned);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      if (isPinned) {
        const { error: unpinError } = await supabase
          .from("user_pinned_instructions")
          .delete()
          .eq("user_id", userId)
          .eq("instruction_id", instructionId);

        if (unpinError) {
          throw new Error(unpinError.message);
        }

        setIsPinned(false);
      } else {
        const { error: pinError } = await supabase
          .from("user_pinned_instructions")
          .insert({
            user_id: userId,
            instruction_id: instructionId,
          });

        if (pinError) {
          throw new Error(pinError.message);
        }

        setIsPinned(true);
      }

      router.refresh();
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to update pin.";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void handleToggle()}
        aria-label={isPinned ? "Unpin instruction" : "Pin instruction"}
        className={cn(
          "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-70",
          isPinned
            ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-800 hover:bg-cyan-500/20 dark:text-cyan-200"
            : "border-slate-400/30 bg-slate-900/10 text-slate-700 hover:bg-slate-900/15 dark:bg-white/10 dark:text-slate-100",
          className,
        )}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Pin size={14} />}
        {isPinned ? "Pinned" : "Pin"}
      </button>
      {error ? (
        <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p>
      ) : null}
    </div>
  );
}
