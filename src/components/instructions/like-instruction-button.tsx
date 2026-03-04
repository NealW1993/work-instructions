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
          "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-70",
          isLiked
            ? "border-emerald-500/45 bg-emerald-500/15 text-emerald-800 hover:bg-emerald-500/25 dark:text-emerald-200"
            : "border-slate-400/30 bg-slate-900/10 text-slate-700 hover:bg-slate-900/15 dark:bg-white/10 dark:text-slate-100",
          className,
        )}
      >
        {busy ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <ThumbsUp
            size={14}
            className={cn(thumbAnimating ? "instruction-like-thumb-pop" : undefined)}
          />
        )}
        <span className="rounded-full bg-slate-900/15 px-2 py-0.5 text-xs font-bold dark:bg-white/20">
          {likeCount}
        </span>
      </button>

      {error ? <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p> : null}
    </div>
  );
}
