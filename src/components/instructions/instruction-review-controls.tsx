"use client";

import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

interface InstructionReviewControlsProps {
  instructionId: string;
  instructionUpdatedAt: string;
  reviewWindowDays: number;
  initialStatus: "up_to_date" | "needs_review";
  initialLastCalibratedAt: string | null;
  initialFlaggedAt: string | null;
  className?: string;
}

interface InstructionReviewStatusPayload {
  instruction_id: string;
  status: "up_to_date" | "needs_review";
  last_calibrated_at: string;
  flagged_at: string | null;
  updated_at: string;
}

const DEFAULT_REVIEW_WINDOW_DAYS = 30;

function normalizeReviewWindowDays(value: number) {
  if (!Number.isInteger(value)) {
    return DEFAULT_REVIEW_WINDOW_DAYS;
  }

  if (value < 1 || value > 365) {
    return DEFAULT_REVIEW_WINDOW_DAYS;
  }

  return value;
}

function toElapsedCalendarDays(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const today = new Date();
  const valueDayStart = new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
  ).getTime();
  const todayDayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const elapsed = todayDayStart - valueDayStart;
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return null;
  }

  return Math.round(elapsed / (1000 * 60 * 60 * 24));
}

function isInstructionReviewStatusPayload(value: unknown): value is InstructionReviewStatusPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.instruction_id === "string" &&
    (candidate.status === "up_to_date" || candidate.status === "needs_review") &&
    typeof candidate.last_calibrated_at === "string" &&
    (typeof candidate.flagged_at === "string" || candidate.flagged_at === null) &&
    typeof candidate.updated_at === "string"
  );
}

export function InstructionReviewControls({
  instructionId,
  instructionUpdatedAt,
  reviewWindowDays,
  initialStatus,
  initialLastCalibratedAt,
  initialFlaggedAt,
  className,
}: InstructionReviewControlsProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [status, setStatus] = useState<"up_to_date" | "needs_review">(initialStatus);
  const [lastCalibratedAt, setLastCalibratedAt] = useState<string>(
    initialLastCalibratedAt ?? instructionUpdatedAt,
  );
  const [flaggedAt, setFlaggedAt] = useState<string | null>(initialFlaggedAt);
  const [busyStatus, setBusyStatus] = useState<InstructionReviewStatusPayload["status"] | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const normalizedReviewWindowDays = normalizeReviewWindowDays(reviewWindowDays);
  const daysSinceCalibration = toElapsedCalendarDays(lastCalibratedAt);
  const reviewIsOutOfRange =
    daysSinceCalibration !== null && daysSinceCalibration >= normalizedReviewWindowDays;
  const daysUntilDue =
    daysSinceCalibration === null
      ? null
      : Math.max(0, normalizedReviewWindowDays - daysSinceCalibration);

  async function getAuthHeaders() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Missing session token. Please sign in again.");
    }

    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    };
  }

  async function updateInstructionReviewStatus(nextStatus: "up_to_date" | "needs_review") {
    if (busyStatus) {
      return;
    }

    if (nextStatus === status) {
      return;
    }

    setBusyStatus(nextStatus);
    setError(null);
    setMessage(null);

    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/instructions/${instructionId}/review`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: nextStatus }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        reviewStatus?: unknown;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update review status.");
      }

      const serverReviewStatus = isInstructionReviewStatusPayload(payload.reviewStatus)
        ? payload.reviewStatus
        : null;

      if (serverReviewStatus) {
        setStatus(serverReviewStatus.status);
        setLastCalibratedAt(serverReviewStatus.last_calibrated_at);
        setFlaggedAt(serverReviewStatus.flagged_at);
      } else if (nextStatus === "up_to_date") {
        const nowIso = new Date().toISOString();
        setStatus("up_to_date");
        setLastCalibratedAt(nowIso);
        setFlaggedAt(null);
      } else {
        setStatus("needs_review");
        setFlaggedAt(new Date().toISOString());
      }

      setMessage(
        nextStatus === "up_to_date"
          ? "Instruction marked Up To Date."
          : "Instruction marked Needs Review.",
      );
      router.refresh();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to update review status.",
      );
    } finally {
      setBusyStatus(null);
    }
  }

  const statusSummary =
    status === "needs_review"
      ? "Needs review is flagged. This instruction is still available for use."
      : reviewIsOutOfRange
        ? `Review window has passed (${normalizedReviewWindowDays}-day range). Please re-check and confirm Up To Date.`
        : daysUntilDue === null
          ? "Review timing is unavailable."
          : daysUntilDue === 0
            ? "Review check is due today."
            : `Next review check in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}.`;

  return (
    <div
      className={cn(
        "grid gap-2 rounded-xl border border-slate-300/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold",
            status === "needs_review"
              ? "border-amber-500/45 bg-amber-500/12 text-amber-800 dark:text-amber-200"
              : "border-emerald-500/45 bg-emerald-500/12 text-emerald-800 dark:text-emerald-200",
          )}
        >
          {status === "needs_review" ? (
            <TriangleAlert size={12} />
          ) : (
            <CheckCircle2 size={12} />
          )}
          {status === "needs_review" ? "Needs Review" : "Up To Date"}
        </span>

        <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
          <span>Set state</span>
          <span className="relative inline-flex items-center">
            <select
              value={status}
              disabled={busyStatus !== null}
              onChange={(event) =>
                void updateInstructionReviewStatus(
                  event.target.value as "up_to_date" | "needs_review",
                )
              }
              className="rounded-lg border border-slate-400/45 bg-slate-900/10 px-2.5 py-1.5 text-xs font-semibold text-slate-700 outline-none transition hover:bg-slate-900/15 focus:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-100 dark:hover:bg-white/10"
            >
              <option value="up_to_date">Up To Date</option>
              <option value="needs_review">Needs Review</option>
            </select>
            {busyStatus ? (
              <Loader2 size={12} className="pointer-events-none absolute right-2 animate-spin" />
            ) : null}
          </span>
        </label>
      </div>

      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{statusSummary}</p>

      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Last review check: <LocalDateTime value={lastCalibratedAt} mode="dateTime" />
      </p>
      {flaggedAt ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Latest needs-review flag: <LocalDateTime value={flaggedAt} mode="dateTime" />
        </p>
      ) : null}

      {message ? (
        <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">{error}</p>
      ) : null}
    </div>
  );
}
