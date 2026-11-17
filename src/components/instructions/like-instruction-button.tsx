"use client";

import { Loader2, ThumbsUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

interface LikeInstructionButtonProps {
  instructionId: string;
  userId: string;
  initialLiked: boolean;
  initialLikeCount: number;
  className?: string;
}

export function LikeInstructionButton({
  instructionId,
  userId,
  initialLiked,
  initialLikeCount,
  className,
}: LikeInstructionButtonProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [isLiked, setIsLiked] = useState(initialLiked);
  const [likeCount, setLikeCount] = useState(Math.max(0, initialLikeCount));
  const [thumbAnimating, setThumbAnimating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    if (busy) {
      return;
    }

    const previousLiked = isLiked;
    const previousLikeCount = likeCount;
    const nextLiked = !previousLiked;

    setBusy(true);
    setError(null);
    setIsLiked(nextLiked);
    setLikeCount((current) => Math.max(0, current + (nextLiked ? 1 : -1)));

    if (nextLiked) {
      setThumbAnimating(true);
      window.setTimeout(() => {
        setThumbAnimating(false);
      }, 460);
    }

    try {
      if (nextLiked) {
        const { error: likeError } = await supabase.from("instruction_likes").insert({
          user_id: userId,
          instruction_id: instructionId,
        });

        if (likeError) {
          throw new Error(likeError.message);
        }
      } else {
        const { error: unlikeError } = await supabase
          .from("instruction_likes")
          .delete()
          .eq("user_id", userId)
          .eq("instruction_id", instructionId);

        if (unlikeError) {
          throw new Error(unlikeError.message);
        }
      }

      router.refresh();
    } catch (caughtError) {
      setIsLiked(previousLiked);
      setLikeCount(previousLikeCount);

      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to update like.";
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
        aria-label={isLiked ? "Unlike instruction" : "Like instruction"}
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-70",
          isLiked
            ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/45 dark:bg-emerald-500/15 dark:text-emerald-200 dark:hover:bg-emerald-500/25"
            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800",
          className,
        )}
      >
        {busy ? (
          <Loader2 size={15} className="animate-spin" aria-hidden="true" />
        ) : (
          <ThumbsUp
            size={15}
            aria-hidden="true"
            className={cn(thumbAnimating ? "instruction-like-thumb-pop" : undefined)}
          />
        )}
        <span className="rounded bg-slate-200/80 px-1.5 py-0.5 text-xs font-bold tabular-nums text-slate-700 dark:bg-slate-700 dark:text-slate-100">
          {likeCount}
        </span>
      </button>

      {error ? <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p> : null}
    </div>
  );
}
