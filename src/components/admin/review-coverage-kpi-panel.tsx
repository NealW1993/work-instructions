"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

interface ReviewCoverageInstruction {
  instructionId: string;
  revision: number;
  partId: string;
  itemTitle: string;
  departmentName: string;
  reviewReason: string;
  isFlagged: boolean;
  isOutOfRange: boolean;
  daysSinceCalibration: number | null;
  overdueDays: number | null;
  needsReviewDurationDays: number | null;
  needsReviewSinceAt: string | null;
  lastCalibratedAt: string;
}

interface ReviewActionUser {
  userId: string;
  label: string;
  markedNeedsReviewCount: number;
  markedUpToDateCount: number;
  totalReviewActions: number;
}

interface ReviewCoveragePayload {
  reviewWindowDays: number;
  totalInstructions: number;
  needsReviewCount: number;
  reviewedCount: number;
  averageNeedsReviewDurationDays: number | null;
  totalNeedsReviewDurationDays: number;
  averageResolvedNeedsReviewDays: number | null;
  resolvedNeedsReviewCycleCount: number;
  totalMarkedNeedsReviewActions: number;
  totalMarkedUpToDateActions: number;
  userReviewActions: ReviewActionUser[];
  needsReviewInstructions: ReviewCoverageInstruction[];
}

const MAX_VISIBLE_NEEDS_REVIEW_ROWS = 5;
const MAX_VISIBLE_USER_ROWS = 5;
const NEEDS_REVIEW_ROW_HEIGHT_PX = 84;
const USER_ACTION_ROW_HEIGHT_PX = 40;
const USER_ACTION_HEADER_HEIGHT_PX = 34;

function formatDurationDays(value: number | null) {
  if (value === null) {
    return "None yet";
  }

  const rounded = Math.max(0, value);
  return `${rounded.toFixed(1)} day${rounded === 1 ? "" : "s"}`;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** The same plain wording the instruction page uses for why something needs a look. */
function reviewReasonLabel(instruction: ReviewCoverageInstruction) {
  if (instruction.isFlagged && instruction.isOutOfRange) {
    return "Flagged, check is due";
  }
  if (instruction.isFlagged) {
    return "Flagged";
  }
  if (instruction.isOutOfRange) {
    return "Check is due";
  }
  return instruction.reviewReason;
}

const STAT_TONE_CLASSES = {
  neutral: "text-slate-900 dark:text-slate-50",
  amber: "text-amber-700 dark:text-amber-300",
  emerald: "text-emerald-700 dark:text-emerald-300",
} as const;

function CoverageStat({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: string;
  note: string;
  tone?: keyof typeof STAT_TONE_CLASSES;
}) {
  return (
    <div className="grid content-start gap-1 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${STAT_TONE_CLASSES[tone]}`}>{value}</p>
      <p className="text-xs text-slate-600 dark:text-slate-400">{note}</p>
    </div>
  );
}

export function ReviewCoverageKpiPanel() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [payload, setPayload] = useState<ReviewCoveragePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getAuthHeaders = useCallback(async () => {
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
  }, [supabase]);

  const fetchReviewCoverage = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      setLoading(true);
      setError(null);
      const response = await fetch("/api/kpis/review-coverage", {
        method: "GET",
        headers,
      });

      const nextPayload = (await response.json().catch(() => ({}))) as
        | ReviewCoveragePayload
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in nextPayload
            ? nextPayload.error ?? "Unable to load review coverage KPI data."
            : "Unable to load review coverage KPI data.",
        );
      }

      if ("needsReviewInstructions" in nextPayload) {
        setPayload(nextPayload);
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to load review coverage KPI data.",
      );
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchReviewCoverage(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchReviewCoverage]);

  const totalInstructions = payload?.totalInstructions ?? 0;
  const needsReviewCount = payload?.needsReviewCount ?? 0;
  const reviewedCount = payload?.reviewedCount ?? 0;
  const reviewWindowDays = payload?.reviewWindowDays ?? 0;
  const averageNeedsReviewDurationDays = payload?.averageNeedsReviewDurationDays ?? null;
  const totalNeedsReviewDurationDays = payload?.totalNeedsReviewDurationDays ?? 0;
  const averageResolvedNeedsReviewDays = payload?.averageResolvedNeedsReviewDays ?? null;
  const resolvedNeedsReviewCycleCount = payload?.resolvedNeedsReviewCycleCount ?? 0;
  const needsReviewInstructions = payload?.needsReviewInstructions ?? [];
  const userReviewActions = payload?.userReviewActions ?? [];
  const shouldScrollNeedsReviewList = needsReviewInstructions.length > MAX_VISIBLE_NEEDS_REVIEW_ROWS;
  const needsReviewListMaxHeight = shouldScrollNeedsReviewList
    ? MAX_VISIBLE_NEEDS_REVIEW_ROWS * NEEDS_REVIEW_ROW_HEIGHT_PX
    : undefined;
  const userActionsListMaxHeight =
    userReviewActions.length > MAX_VISIBLE_USER_ROWS
      ? MAX_VISIBLE_USER_ROWS * USER_ACTION_ROW_HEIGHT_PX + USER_ACTION_HEADER_HEIGHT_PX
      : undefined;
  const upToDatePercent = totalInstructions > 0 ? Math.round((reviewedCount / totalInstructions) * 100) : 0;
  const needsReviewPercent = totalInstructions > 0 ? (needsReviewCount / totalInstructions) * 100 : 0;

  return (
    <section className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {payload === null
            ? loading
              ? "Loading review status..."
              : "Review status is not available."
            : totalInstructions === 0
              ? "No instructions yet."
              : `${upToDatePercent}% of instructions are up to date. Each one is due for a check every ${plural(reviewWindowDays, "day")}.`}
        </p>
        <button
          type="button"
          disabled={loading}
          onClick={() => void fetchReviewCoverage()}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <RefreshCw aria-hidden="true" size={15} className={loading ? "animate-spin" : undefined} />
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error ? (
        <p className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CoverageStat
          label="Needs review"
          value={String(needsReviewCount)}
          tone={needsReviewCount > 0 ? "amber" : "neutral"}
          note={needsReviewCount > 0 ? "Flagged or past the check date" : "Nothing is waiting"}
        />
        <CoverageStat
          label="Up to date"
          value={String(reviewedCount)}
          tone="emerald"
          note={`Out of ${plural(totalInstructions, "instruction")}`}
        />
        <CoverageStat
          label="Average wait"
          value={formatDurationDays(averageNeedsReviewDurationDays)}
          note={`${totalNeedsReviewDurationDays.toFixed(1)} days waiting in total`}
        />
        <CoverageStat
          label="Average time to clear"
          value={formatDurationDays(averageResolvedNeedsReviewDays)}
          note={`${plural(resolvedNeedsReviewCycleCount, "review")} cleared so far`}
        />
      </div>

      {totalInstructions > 0 ? (
        <div className="grid gap-2">
          <div
            role="img"
            aria-label={`${reviewedCount} up to date, ${needsReviewCount} need review`}
            className="flex h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
          >
            <span className="h-full bg-emerald-500" style={{ width: `${100 - needsReviewPercent}%` }} />
            <span className="h-full bg-amber-500" style={{ width: `${needsReviewPercent}%` }} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-500" />
              Up to date
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-500" />
              Needs review
            </span>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid content-start gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Waiting for a review</h3>
            {shouldScrollNeedsReviewList ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">Scroll for more</p>
            ) : null}
          </div>

          {needsReviewInstructions.length > 0 ? (
            <ul
              className="divide-y divide-slate-200 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800"
              style={needsReviewListMaxHeight ? { maxHeight: `${needsReviewListMaxHeight}px` } : undefined}
            >
              {needsReviewInstructions.map((instruction) => (
                <li key={instruction.instructionId}>
                  <Link
                    href={`/instructions/${instruction.instructionId}`}
                    className="grid gap-0.5 px-3 py-2.5 transition hover:bg-amber-50 dark:hover:bg-amber-500/10"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                        <span className="font-mono">{instruction.partId}</span>
                        <span className="ml-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                          Rev {instruction.revision}
                        </span>
                      </p>
                      <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                        {reviewReasonLabel(instruction)}
                      </span>
                    </div>
                    <p className="truncate text-sm text-slate-700 dark:text-slate-200">{instruction.itemTitle}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {instruction.departmentName} · Last checked{" "}
                      <LocalDateTime value={instruction.lastCalibratedAt} mode="date" />
                      {instruction.overdueDays !== null && instruction.overdueDays > 0
                        ? ` · ${plural(instruction.overdueDays, "day")} overdue`
                        : ""}
                      {instruction.needsReviewDurationDays !== null
                        ? ` · waiting ${plural(instruction.needsReviewDurationDays, "day")}`
                        : ""}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-300 px-3 py-5 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
              Nothing is waiting for a review.
            </p>
          )}
        </div>

        <div className="grid content-start gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Who checks instructions</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {payload?.totalMarkedUpToDateActions ?? 0} marked up to date ·{" "}
              {payload?.totalMarkedNeedsReviewActions ?? 0} marked needs review
            </p>
          </div>

          {userReviewActions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 px-3 py-5 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
              No one has checked an instruction yet.
            </p>
          ) : (
            <div
              className="overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800"
              style={userActionsListMaxHeight ? { maxHeight: `${userActionsListMaxHeight}px` } : undefined}
            >
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  <tr>
                    <th scope="col" className="px-3 py-2">Person</th>
                    <th scope="col" className="px-3 py-2 text-right">Up to date</th>
                    <th scope="col" className="px-3 py-2 text-right">Needs review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {userReviewActions.map((entry) => (
                    <tr key={entry.userId}>
                      <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100">{entry.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                        {entry.markedUpToDateCount}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                        {entry.markedNeedsReviewCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
