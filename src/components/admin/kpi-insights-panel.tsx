"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

type InstructionViewPeriod = "year" | "month" | "week";

interface InstructionViewPoint {
  instructionId: string;
  partId: string;
  itemTitle: string;
  departmentName: string;
  viewCount: number;
}

interface InstructionViewsPayload {
  period: InstructionViewPeriod;
  year: number;
  month: number;
  weekStart: string | null;
  range: {
    startAt: string;
    endAt: string;
    label: string;
  };
  totalViews: number;
  totalInstructionsViewed: number;
  points: InstructionViewPoint[];
}

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

const MONTH_OPTIONS = [
  { value: 1, label: "Jan" },
  { value: 2, label: "Feb" },
  { value: 3, label: "Mar" },
  { value: 4, label: "Apr" },
  { value: 5, label: "May" },
  { value: 6, label: "Jun" },
  { value: 7, label: "Jul" },
  { value: 8, label: "Aug" },
  { value: 9, label: "Sep" },
  { value: 10, label: "Oct" },
  { value: 11, label: "Nov" },
  { value: 12, label: "Dec" },
] as const;

const MS_IN_DAY = 24 * 60 * 60 * 1000;
const GRID_COLUMNS_BY_COUNT: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
  9: "grid-cols-9",
  10: "grid-cols-10",
  11: "grid-cols-11",
  12: "grid-cols-12",
};

function toUtcDateKey(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getUtcWeekStart(date: Date) {
  const utcDay = date.getUTCDay();
  const mondayOffset = (utcDay + 6) % 7;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - mondayOffset),
  );
}

function formatUtcMonthDay(date: Date) {
  const month = MONTH_OPTIONS[date.getUTCMonth()]?.label ?? "Jan";
  return `${month} ${date.getUTCDate()}`;
}

function buildWeekOptionsForMonth(year: number, month: number) {
  const monthIndex = month - 1;
  const monthStart = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
  const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 0, 0, 0, 0, 0));
  const weekOptions: Array<{ value: string; label: string }> = [];
  let cursor = getUtcWeekStart(monthStart);

  while (cursor.getTime() <= monthEnd.getTime()) {
    const weekStart = new Date(cursor.getTime());
    const weekEnd = new Date(cursor.getTime() + 6 * MS_IN_DAY);
    weekOptions.push({
      value: toUtcDateKey(weekStart),
      label: `${formatUtcMonthDay(weekStart)} - ${formatUtcMonthDay(weekEnd)}`,
    });
    cursor = new Date(cursor.getTime() + 7 * MS_IN_DAY);
  }

  return weekOptions;
}

function getBarHeight(value: number, max: number) {
  if (value <= 0 || max <= 0) {
    return 0;
  }

  return Math.max((value / max) * 100, 8);
}

export function KpiInsightsPanel() {
  const [period, setPeriod] = useState<InstructionViewPeriod>("year");
  const [year, setYear] = useState(() => new Date().getUTCFullYear());
  const [month, setMonth] = useState(() => new Date().getUTCMonth() + 1);
  const [weekStart, setWeekStart] = useState(() => toUtcDateKey(getUtcWeekStart(new Date())));
  const [viewsPayload, setViewsPayload] = useState<InstructionViewsPayload | null>(null);
  const [viewsLoading, setViewsLoading] = useState(false);
  const [viewsError, setViewsError] = useState<string | null>(null);
  const [reviewCoveragePayload, setReviewCoveragePayload] =
    useState<ReviewCoveragePayload | null>(null);
  const [reviewCoverageLoading, setReviewCoverageLoading] = useState(false);
  const [reviewCoverageError, setReviewCoverageError] = useState<string | null>(null);
  const [showNeedsReviewList, setShowNeedsReviewList] = useState(false);

  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const currentYear = new Date().getUTCFullYear();
  const yearOptions = useMemo(() => {
    const earliestYear = currentYear - 5;
    const years: number[] = [];
    for (let value = currentYear + 1; value >= earliestYear; value -= 1) {
      years.push(value);
    }
    if (!years.includes(year)) {
      years.unshift(year);
    }

    return years.sort((first, second) => second - first);
  }, [currentYear, year]);
  const weekOptions = useMemo(() => buildWeekOptionsForMonth(year, month), [month, year]);

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

  const fetchInstructionViews = useCallback(async () => {
    setViewsLoading(true);
    setViewsError(null);

    try {
      const params = new URLSearchParams({
        period,
        year: String(year),
        month: String(month),
      });

      if (period === "week") {
        params.set("weekStart", weekStart);
      }

      const headers = await getAuthHeaders();
      const response = await fetch(`/api/kpis/instruction-views?${params.toString()}`, {
        method: "GET",
        headers,
      });

      const payload = (await response.json().catch(() => ({}))) as
        | InstructionViewsPayload
        | { error?: string };
      if (!response.ok) {
        throw new Error(
          "error" in payload
            ? payload.error ?? "Unable to load instruction view KPI data."
            : "Unable to load instruction view KPI data.",
        );
      }

      if ("points" in payload) {
        setViewsPayload(payload);
      }
    } catch (caughtError) {
      setViewsError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to load instruction view KPI data.",
      );
    } finally {
      setViewsLoading(false);
    }
  }, [getAuthHeaders, month, period, weekStart, year]);

  const fetchReviewCoverage = useCallback(async () => {
    setReviewCoverageLoading(true);
    setReviewCoverageError(null);

    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/kpis/review-coverage", {
        method: "GET",
        headers,
      });

      const payload = (await response.json().catch(() => ({}))) as
        | ReviewCoveragePayload
        | { error?: string };
      if (!response.ok) {
        throw new Error(
          "error" in payload
            ? payload.error ?? "Unable to load review coverage KPI data."
            : "Unable to load review coverage KPI data.",
        );
      }

      if ("needsReviewInstructions" in payload) {
        setReviewCoveragePayload(payload);
      }
    } catch (caughtError) {
      setReviewCoverageError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to load review coverage KPI data.",
      );
    } finally {
      setReviewCoverageLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (period !== "week") {
      return;
    }

    if (weekOptions.some((option) => option.value === weekStart)) {
      return;
    }

    const fallbackWeek = weekOptions[0]?.value;
    if (fallbackWeek) {
      setWeekStart(fallbackWeek);
    }
  }, [period, weekOptions, weekStart]);

  useEffect(() => {
    void fetchInstructionViews();
  }, [fetchInstructionViews]);

  useEffect(() => {
    void fetchReviewCoverage();
  }, [fetchReviewCoverage]);

  const visibleViewPoints = (viewsPayload?.points ?? []).slice(0, 12);
  const chartColumnClass =
    GRID_COLUMNS_BY_COUNT[Math.max(1, Math.min(visibleViewPoints.length, 12))] ??
    "grid-cols-1";
  const maxViewCount = Math.max(1, ...visibleViewPoints.map((point) => point.viewCount));
  const viewAxisStep = Math.max(1, Math.ceil(maxViewCount / 4));
  const viewAxisTicks = Array.from({ length: 5 }, (_, index) => viewAxisStep * (4 - index));
  const viewAxisMax = viewAxisTicks[0] ?? 1;

  const totalInstructions = reviewCoveragePayload?.totalInstructions ?? 0;
  const needsReviewCount = reviewCoveragePayload?.needsReviewCount ?? 0;
  const reviewedCount = reviewCoveragePayload?.reviewedCount ?? 0;
  const donutRatio = totalInstructions > 0 ? needsReviewCount / totalInstructions : 0;
  const donutRadius = 56;
  const donutCircumference = 2 * Math.PI * donutRadius;
  const donutArc = donutCircumference * donutRatio;

  return (
    <div className="grid gap-4">
      <section className="grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            Instruction Views by Range
          </h2>
          <button
            type="button"
            disabled={viewsLoading}
            onClick={() => void fetchInstructionViews()}
            className="rounded-xl border border-slate-300/70 bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-800/70"
          >
            {viewsLoading ? "Loading..." : "Reload Views"}
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
              Range
            </span>
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value as InstructionViewPeriod)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="year">Year</option>
              <option value="month">Month</option>
              <option value="week">Week</option>
            </select>
          </label>

          <label className="grid gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
              Year
            </span>
            <select
              value={year}
              onChange={(event) => setYear(Number.parseInt(event.target.value, 10))}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
            >
              {yearOptions.map((optionYear) => (
                <option key={optionYear} value={optionYear}>
                  {optionYear}
                </option>
              ))}
            </select>
          </label>

          {period === "month" || period === "week" ? (
            <label className="grid gap-1 text-xs">
              <span className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
                Month
              </span>
              <select
                value={month}
                onChange={(event) => setMonth(Number.parseInt(event.target.value, 10))}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
              >
                {MONTH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {period === "week" ? (
            <label className="grid gap-1 text-xs">
              <span className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
                Week
              </span>
              <select
                value={weekStart}
                onChange={(event) => setWeekStart(event.target.value)}
                className="min-w-40 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
              >
                {weekOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {viewsError ? (
          <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
            {viewsError}
          </p>
        ) : null}

        <div className="rounded-xl border border-slate-300/70 bg-white/70 p-2 dark:border-slate-700 dark:bg-slate-900/55">
          <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2">
            <div className="grid h-48 grid-rows-5 items-end text-right text-[10px] font-semibold text-slate-500 dark:text-slate-400">
              {viewAxisTicks.map((tickValue, index) => (
                <span
                  key={`views-axis-${tickValue}-${index}`}
                  className={index === viewAxisTicks.length - 1 ? "" : "translate-y-1"}
                >
                  {tickValue}
                </span>
              ))}
            </div>

            <div className="min-w-0">
              <div className="relative h-48">
                <div className="pointer-events-none absolute inset-0 grid grid-rows-5">
                  {viewAxisTicks.map((_, index) => (
                    <span
                      key={`views-grid-${index}`}
                      className={cn(
                        "border-t border-slate-300/35 dark:border-slate-700/45",
                        index === viewAxisTicks.length - 1
                          ? "border-b border-slate-300/35 dark:border-slate-700/45"
                          : "",
                      )}
                    />
                  ))}
                </div>

                <div
                  className={cn(
                    "relative grid h-full items-end gap-1",
                    visibleViewPoints.length > 0 ? chartColumnClass : "grid-cols-1",
                  )}
                >
                  {visibleViewPoints.length === 0 ? (
                    <p className="col-span-full self-center rounded-lg border border-slate-300/70 bg-white/80 px-3 py-2 text-center text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
                      No instruction views recorded in this range yet.
                    </p>
                  ) : (
                    visibleViewPoints.map((point) => (
                      <div
                        key={point.instructionId}
                        className="group relative flex h-full items-end justify-center rounded-md"
                      >
                        <span
                          className="w-full rounded-t-md border border-cyan-300/35 bg-gradient-to-t from-cyan-700 to-cyan-500"
                          style={{ height: `${getBarHeight(point.viewCount, viewAxisMax)}%` }}
                          title={`${point.partId} | ${point.itemTitle} (${point.departmentName}) - ${point.viewCount} views`}
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>

              {visibleViewPoints.length > 0 ? (
                <div className={cn("mt-1 grid gap-1", chartColumnClass)}>
                  {visibleViewPoints.map((point) => (
                    <p
                      key={`views-label-${point.instructionId}`}
                      className="truncate text-center text-[10px] text-slate-500 dark:text-slate-400"
                      title={`${point.partId} | ${point.departmentName}`}
                    >
                      {point.partId}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          {viewsPayload?.totalViews ?? 0} total views in selected range across{" "}
          {viewsPayload?.totalInstructionsViewed ?? 0} instruction
          {(viewsPayload?.totalInstructionsViewed ?? 0) === 1 ? "" : "s"}.
          {viewsPayload?.points && viewsPayload.points.length > 12
            ? ` Showing top ${visibleViewPoints.length} instructions by view count.`
            : ""}
        </p>
      </section>

      <section className="grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            Review Coverage
          </h2>
          <button
            type="button"
            disabled={reviewCoverageLoading}
            onClick={() => void fetchReviewCoverage()}
            className="rounded-xl border border-slate-300/70 bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-800/70"
          >
            {reviewCoverageLoading ? "Loading..." : "Reload Coverage"}
          </button>
        </div>

        {reviewCoverageError ? (
          <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
            {reviewCoverageError}
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
              <p>Review Window: {reviewCoveragePayload?.reviewWindowDays ?? 0} day(s)</p>
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
            ) : reviewCoveragePayload?.needsReviewInstructions.length ? (
              <div className="grid max-h-[22rem] gap-1 overflow-y-auto pr-1">
                {reviewCoveragePayload.needsReviewInstructions.map((instruction) => (
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
    </div>
  );
}
