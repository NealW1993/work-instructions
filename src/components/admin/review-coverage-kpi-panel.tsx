"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

interface ReviewCoverageInstruction {
  instructionId: string;
  partId: string;
  itemTitle: string;
  departmentName: string;
  reviewReason: string;
  isFlagged: boolean;
  isOutOfRange: boolean;
  daysSinceCalibration: number | null;
  overdueDays: number | null;
  lastCalibratedAt: string;
}

interface ReviewCoveragePayload {
  reviewWindowDays: number;
  totalInstructions: number;
  needsReviewCount: number;
  reviewedCount: number;
  needsReviewInstructions: ReviewCoverageInstruction[];
}

export function ReviewCoverageKpiPanel() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [payload, setPayload] = useState<ReviewCoveragePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNeedsReviewList, setShowNeedsReviewList] = useState(false);

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
    setLoading(true);
    setError(null);

    try {
      const headers = await getAuthHeaders();
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
    void fetchReviewCoverage();
  }, [fetchReviewCoverage]);

  const totalInstructions = payload?.totalInstructions ?? 0;
  const needsReviewCount = payload?.needsReviewCount ?? 0;
  const reviewedCount = payload?.reviewedCount ?? 0;
  const donutRatio = totalInstructions > 0 ? needsReviewCount / totalInstructions : 0;
  const donutRadius = 56;
  const donutCircumference = 2 * Math.PI * donutRadius;
  const donutArc = donutCircumference * donutRatio;

  return (
    <section className="grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
          Review Coverage
        </h2>
        <button
          type="button"
          disabled={loading}
          onClick={() => void fetchReviewCoverage()}
          className="rounded-xl border border-slate-300/70 bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-800/70"
        >
          {loading ? "Loading..." : "Reload Coverage"}
        </button>
      </div>

      {error ? (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="grid place-items-center rounded-2xl border border-slate-300/70 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/50">
          <div className="relative h-36 w-36">
            <svg viewBox="0 0 140 140" className="h-36 w-36">
              <circle
                cx="70"
                cy="70"
                r={donutRadius}
                fill="none"
                stroke="rgba(148, 163, 184, 0.28)"
                strokeWidth="18"
              />
              {donutArc > 0 ? (
                <circle
                  cx="70"
                  cy="70"
                  r={donutRadius}
                  fill="none"
                  stroke="rgba(245, 158, 11, 0.95)"
                  strokeWidth="18"
                  strokeLinecap="round"
                  strokeDasharray={`${donutArc} ${donutCircumference - donutArc}`}
                  transform="rotate(-90 70 70)"
                />
              ) : null}
            </svg>
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
              <p className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                {needsReviewCount}
              </p>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
                Needs Review
              </p>
            </div>
          </div>

          <div className="mt-2 grid gap-1 text-xs text-slate-600 dark:text-slate-300">
            <p className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />
              Needs Review: {needsReviewCount}
            </p>
            <p className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-slate-400" />
              Reviewed: {reviewedCount}
            </p>
            <p>Total Instructions: {totalInstructions}</p>
            <p>Review Window: {payload?.reviewWindowDays ?? 0} day(s)</p>
          </div>
        </div>

        <div className="grid gap-2 rounded-2xl border border-slate-300/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Needs Review Drill-Down
            </h3>
            <button
              type="button"
              onClick={() => setShowNeedsReviewList((current) => !current)}
              className="rounded-lg border border-slate-300/80 bg-white/80 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-800/70"
            >
              {showNeedsReviewList ? "Collapse list" : "Expand list"}
            </button>
          </div>

          {!showNeedsReviewList ? (
            <p className="rounded-lg border border-slate-300/70 bg-white/80 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
              Drill-down is collapsed. Click Expand list to view instructions that currently
              need review.
            </p>
          ) : payload?.needsReviewInstructions.length ? (
            <div className="grid max-h-[22rem] gap-1 overflow-y-auto pr-1">
              {payload.needsReviewInstructions.map((instruction) => (
                <Link
                  key={instruction.instructionId}
                  href={`/instructions/${instruction.instructionId}`}
                  className="grid gap-1 rounded-lg border border-slate-300/70 bg-white/85 px-3 py-2 transition hover:border-amber-400/60 hover:bg-amber-500/10 dark:border-slate-700 dark:bg-slate-950/60 dark:hover:border-amber-500/50 dark:hover:bg-amber-500/15"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {instruction.partId} | {instruction.departmentName}
                    </p>
                    <span className="rounded-full border border-amber-500/45 bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-100">
                      {instruction.reviewReason}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    {instruction.itemTitle}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Last review check:{" "}
                    <LocalDateTime value={instruction.lastCalibratedAt} mode="dateTime" />
                    {instruction.overdueDays !== null
                      ? ` | Overdue by ${instruction.overdueDays} day${
                          instruction.overdueDays === 1 ? "" : "s"
                        }`
                      : ""}
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-slate-300/70 bg-white/80 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
              No instructions currently require review.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
