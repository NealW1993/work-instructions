"use client";

import Link from "next/link";
import { Maximize2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { cn } from "@/lib/utils";

type ReviewStatus = "up_to_date" | "needs_review";
type ReviewStatusFilter = "all" | ReviewStatus;

interface ReviewActivityEvent {
  id: string;
  instructionId: string;
  occurredAt: string;
  detail: string;
  revision: number | null;
  actorName: string;
  previousStatus: ReviewStatus | null;
  nextStatus: ReviewStatus;
  workItem: {
    id: string;
    partId: string;
    itemTitle: string;
    departmentId: string | null;
    departmentName: string;
    departmentColorHex: string | null;
  };
}

interface ReviewActivityResponse {
  year: number;
  totalEvents: number;
  events: ReviewActivityEvent[];
  error?: string;
}

interface ReviewMonthBucket {
  monthIndex: number;
  shortLabel: string;
  longLabel: string;
  needsReviewCount: number;
  upToDateCount: number;
  totalCount: number;
  events: ReviewActivityEvent[];
}

interface ReviewWeekBucket {
  key: string;
  label: string;
  startAt: string;
  events: ReviewActivityEvent[];
}

interface InstructionReviewActivityChartProps {
  getAuthHeaders: () => Promise<Record<string, string>>;
  reloadToken?: number;
}

const MONTH_SHORT_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const MONTH_LONG_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const STATUS_FILTER_OPTIONS: Array<{
  value: ReviewStatusFilter;
  label: string;
}> = [
  { value: "all", label: "All review states" },
  { value: "needs_review", label: "Needs Review only" },
  { value: "up_to_date", label: "Reviewed only" },
];

const MS_IN_DAY = 24 * 60 * 60 * 1000;

function getPartIdLabel(partId: string) {
  const normalized = partId.trim();
  return normalized ? normalized : "N/A";
}

function toSortableTimestamp(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getReviewStatusLabel(status: ReviewStatus) {
  return status === "needs_review" ? "Needs Review" : "Reviewed";
}

function getReviewStatusBadgeClass(status: ReviewStatus) {
  return status === "needs_review"
    ? "border-amber-500/45 bg-amber-500/20 text-amber-100"
    : "border-emerald-500/45 bg-emerald-500/20 text-emerald-100";
}

function getReviewTransitionLabel(event: ReviewActivityEvent) {
  const nextLabel = getReviewStatusLabel(event.nextStatus);
  if (!event.previousStatus) {
    return nextLabel;
  }

  return `${getReviewStatusLabel(event.previousStatus)} -> ${nextLabel}`;
}

function getUtcWeekStart(date: Date) {
  const utcDay = date.getUTCDay();
  const mondayOffset = (utcDay + 6) % 7;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - mondayOffset),
  );
}

function toUtcDateKey(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatUtcMonthDayLabel(date: Date) {
  const month = MONTH_SHORT_LABELS[date.getUTCMonth()] ?? MONTH_SHORT_LABELS[0];
  return `${month} ${date.getUTCDate()}`;
}

function getSeriesBarHeight(count: number, maxCount: number) {
  if (count <= 0 || maxCount <= 0) {
    return 2;
  }

  return Math.max((count / maxCount) * 100, 7);
}

function buildMonthBuckets(events: ReviewActivityEvent[]) {
  const monthBuckets: ReviewMonthBucket[] = MONTH_SHORT_LABELS.map((shortLabel, monthIndex) => ({
    monthIndex,
    shortLabel,
    longLabel: MONTH_LONG_LABELS[monthIndex] ?? shortLabel,
    needsReviewCount: 0,
    upToDateCount: 0,
    totalCount: 0,
    events: [],
  }));
  const needsReviewInstructionIdsByMonth = monthBuckets.map(() => new Set<string>());
  const reviewedInstructionIdsByMonth = monthBuckets.map(() => new Set<string>());

  for (const event of events) {
    const occurredAt = new Date(event.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      continue;
    }

    const monthBucket = monthBuckets[occurredAt.getUTCMonth()];
    if (monthBucket) {
      monthBucket.events.push(event);
      monthBucket.totalCount += 1;
      if (event.nextStatus === "needs_review" && event.instructionId) {
        needsReviewInstructionIdsByMonth[monthBucket.monthIndex]?.add(event.instructionId);
      } else {
        reviewedInstructionIdsByMonth[monthBucket.monthIndex]?.add(event.instructionId);
      }
    }
  }

  for (const monthBucket of monthBuckets) {
    monthBucket.needsReviewCount =
      needsReviewInstructionIdsByMonth[monthBucket.monthIndex]?.size ?? 0;
    monthBucket.upToDateCount = reviewedInstructionIdsByMonth[monthBucket.monthIndex]?.size ?? 0;
    monthBucket.events.sort(
      (first, second) =>
        toSortableTimestamp(second.occurredAt) - toSortableTimestamp(first.occurredAt),
    );
  }

  return monthBuckets;
}

function buildWeekBuckets(events: ReviewActivityEvent[]) {
  const weekByKey = new Map<string, ReviewWeekBucket>();

  for (const event of events) {
    const occurredAt = new Date(event.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      continue;
    }

    const weekStart = getUtcWeekStart(occurredAt);
    const weekKey = toUtcDateKey(weekStart);
    let weekBucket = weekByKey.get(weekKey);

    if (!weekBucket) {
      const weekEnd = new Date(weekStart.getTime() + 6 * MS_IN_DAY);
      weekBucket = {
        key: weekKey,
        label: `${formatUtcMonthDayLabel(weekStart)} - ${formatUtcMonthDayLabel(weekEnd)}`,
        startAt: weekStart.toISOString(),
        events: [],
      };
      weekByKey.set(weekKey, weekBucket);
    }

    weekBucket.events.push(event);
  }

  const weekBuckets = [...weekByKey.values()];
  for (const weekBucket of weekBuckets) {
    weekBucket.events.sort(
      (first, second) =>
        toSortableTimestamp(second.occurredAt) - toSortableTimestamp(first.occurredAt),
    );
  }

  weekBuckets.sort(
    (first, second) => toSortableTimestamp(second.startAt) - toSortableTimestamp(first.startAt),
  );

  return weekBuckets;
}

export function InstructionReviewActivityChart({
  getAuthHeaders,
  reloadToken = 0,
}: InstructionReviewActivityChartProps) {
  const [selectedYear, setSelectedYear] = useState(() => new Date().getUTCFullYear());
  const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>("all");
  const [events, setEvents] = useState<ReviewActivityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number>(
    new Date().getUTCMonth(),
  );
  const [selectedWeekKey, setSelectedWeekKey] = useState<string | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getUTCFullYear();
    const earliestYear = Math.min(selectedYear, currentYear - 5);
    const latestYear = Math.max(selectedYear, currentYear + 1);
    const years: number[] = [];

    for (let year = latestYear; year >= earliestYear; year -= 1) {
      years.push(year);
    }

    return years;
  }, [selectedYear]);

  const fetchActivityEvents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/instruction-review/activity?year=${selectedYear}`, {
        method: "GET",
        headers,
      });

      const payload = (await response.json().catch(() => ({}))) as Partial<ReviewActivityResponse>;
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load instruction review activity.");
      }

      setEvents(payload.events ?? []);
    } catch (caughtError) {
      const normalizedError =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to load instruction review activity.";
      setError(normalizedError);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, selectedYear]);

  useEffect(() => {
    void fetchActivityEvents();
  }, [fetchActivityEvents, reloadToken]);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!isModalOpen || typeof document === "undefined") {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsModalOpen(false);
      }
    };

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isModalOpen]);

  const filteredEvents = useMemo(() => {
    if (statusFilter === "all") {
      return events;
    }

    return events.filter((event) => event.nextStatus === statusFilter);
  }, [events, statusFilter]);

  const monthBuckets = useMemo(() => buildMonthBuckets(events), [events]);
  const filteredMonthBuckets = useMemo(
    () => buildMonthBuckets(filteredEvents),
    [filteredEvents],
  );

  const maxMonthlyCount = useMemo(() => {
    const monthlyCounts = monthBuckets.flatMap((monthBucket) => [
      monthBucket.needsReviewCount,
      monthBucket.upToDateCount,
    ]);
    return monthlyCounts.length > 0 ? Math.max(...monthlyCounts, 1) : 1;
  }, [monthBuckets]);

  const totalNeedsReviewEvents = useMemo(
    () => events.filter((event) => event.nextStatus === "needs_review").length,
    [events],
  );
  const totalUpToDateEvents = events.length - totalNeedsReviewEvents;
  const monthlyAxisStep = Math.max(1, Math.ceil(maxMonthlyCount / 4));
  const monthlyAxisTicks = useMemo(
    () => Array.from({ length: 5 }, (_, index) => monthlyAxisStep * (4 - index)),
    [monthlyAxisStep],
  );
  const monthlyAxisMax = monthlyAxisTicks[0] ?? 1;
  const selectedMonth = filteredMonthBuckets[selectedMonthIndex];
  const selectedMonthAllStates = monthBuckets[selectedMonthIndex];
  const selectedMonthEvents = useMemo(() => selectedMonth?.events ?? [], [selectedMonth]);
  const weekBuckets = useMemo(
    () => buildWeekBuckets(selectedMonthEvents),
    [selectedMonthEvents],
  );

  useEffect(() => {
    setSelectedWeekKey((currentWeekKey) => {
      if (weekBuckets.length === 0) {
        return null;
      }

      if (currentWeekKey && weekBuckets.some((weekBucket) => weekBucket.key === currentWeekKey)) {
        return currentWeekKey;
      }

      return weekBuckets[0]?.key ?? null;
    });
  }, [weekBuckets]);

  useEffect(() => {
    setDetailsExpanded(false);
  }, [selectedMonthIndex, selectedYear, statusFilter]);

  const selectedWeekEvents = useMemo(() => {
    if (!selectedWeekKey) {
      return [];
    }

    return weekBuckets.find((weekBucket) => weekBucket.key === selectedWeekKey)?.events ?? [];
  }, [selectedWeekKey, weekBuckets]);

  const totalMonthEvents = selectedMonthEvents.length;
  const compactVisibleWeekEvents = selectedWeekEvents.slice(0, 4);

  const renderExplorer = (expanded: boolean) => (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs">
          <span className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
            Year
          </span>
          <select
            value={selectedYear}
            onChange={(event) => setSelectedYear(Number.parseInt(event.target.value, 10))}
            className={cn(
              "rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950",
              expanded ? "min-w-32" : "min-w-24",
            )}
          >
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-xs">
          <span className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
            Filter
          </span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as ReviewStatusFilter)}
            className={cn(
              "rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950",
              expanded ? "min-w-44" : "min-w-32",
            )}
          >
            {STATUS_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={loading}
          onClick={() => void fetchActivityEvents()}
          className="rounded-lg border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100/80 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800/70"
        >
          {loading ? "Loading..." : "Reload Activity"}
        </button>
      </div>

      {error ? (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      <div className="rounded-xl border border-slate-300/70 bg-white/70 p-2.5 dark:border-slate-700 dark:bg-slate-900/55">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex flex-wrap items-center gap-3 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-gradient-to-t from-amber-600 to-amber-400" />
              Needs Review
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-gradient-to-t from-emerald-600 to-cyan-400" />
              Reviewed
            </span>
          </div>
          <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Clustered monthly view
          </p>
        </div>

        <div
          className={cn(
            "relative overflow-hidden rounded-lg border border-slate-300/70 bg-white/75 dark:border-slate-700 dark:bg-slate-950/40",
            expanded ? "h-60" : "h-28",
          )}
        >
          <div className="grid h-full grid-cols-[2rem_minmax(0,1fr)] gap-2 px-1.5 pb-1 pt-2">
            <div className="grid h-full grid-rows-5 items-end text-right text-[10px] font-semibold text-slate-500 dark:text-slate-400">
              {monthlyAxisTicks.map((tickValue, index) => (
                <span
                  key={`monthly-axis-${tickValue}-${index}`}
                  className={index === monthlyAxisTicks.length - 1 ? "" : "translate-y-1"}
                >
                  {tickValue}
                </span>
              ))}
            </div>

            <div className="relative min-w-0">
              <div className="pointer-events-none absolute inset-0 grid grid-rows-5">
                {monthlyAxisTicks.map((_, index) => (
                  <span
                    key={`monthly-grid-${index}`}
                    className={cn(
                      "border-t border-dashed border-slate-300/70 dark:border-slate-700/70",
                      index === monthlyAxisTicks.length - 1
                        ? "border-b border-slate-300/70 dark:border-slate-700/70"
                        : "",
                    )}
                  />
                ))}
              </div>

              <div className="relative z-10 grid h-full grid-cols-12 gap-1">
                {monthBuckets.map((monthBucket) => {
                  const isSelected = selectedMonthIndex === monthBucket.monthIndex;
                  const filteredMonthBucket = filteredMonthBuckets[monthBucket.monthIndex];
                  const filteredMonthEventCount = filteredMonthBucket?.totalCount ?? 0;
                  const needsReviewBarHeight = getSeriesBarHeight(
                    monthBucket.needsReviewCount,
                    monthlyAxisMax,
                  );
                  const reviewedBarHeight = getSeriesBarHeight(
                    monthBucket.upToDateCount,
                    monthlyAxisMax,
                  );
                  const dimNeedsSeries = statusFilter === "up_to_date";
                  const dimReviewedSeries = statusFilter === "needs_review";

                  return (
                    <button
                      key={monthBucket.shortLabel}
                      type="button"
                      onClick={() => {
                        setSelectedMonthIndex(monthBucket.monthIndex);
                        if (!expanded) {
                          setIsModalOpen(true);
                        }
                      }}
                      className={cn(
                        "group flex min-w-0 flex-col items-center justify-end rounded-md px-0.5 pb-1 pt-1 outline-none transition focus-visible:ring-2 focus-visible:ring-cyan-500/70",
                        isSelected
                          ? "bg-cyan-500/15 ring-1 ring-cyan-500/45"
                          : "hover:bg-cyan-500/10",
                      )}
                      title={`${monthBucket.longLabel}: Needs Review ${monthBucket.needsReviewCount}, Reviewed ${monthBucket.upToDateCount}, Current filter ${filteredMonthEventCount}`}
                    >
                      <div className="flex h-full w-full items-end justify-center gap-[3px]">
                        <span
                          className={cn(
                            "w-[42%] rounded-t-[4px] border border-amber-300/25 transition",
                            isSelected
                              ? "bg-gradient-to-t from-amber-700 to-amber-500"
                              : "bg-amber-500/70 group-hover:bg-amber-400/90",
                            dimNeedsSeries ? "opacity-30" : "opacity-100",
                          )}
                          style={{ height: `${needsReviewBarHeight}%` }}
                        />
                        <span
                          className={cn(
                            "w-[42%] rounded-t-[4px] border border-emerald-300/25 transition",
                            isSelected
                              ? "bg-gradient-to-t from-emerald-700 to-cyan-500"
                              : "bg-cyan-500/70 group-hover:bg-cyan-400/90",
                            dimReviewedSeries ? "opacity-30" : "opacity-100",
                          )}
                          style={{ height: `${reviewedBarHeight}%` }}
                        />
                      </div>
                      <span
                        className={cn(
                          "mt-1 text-[10px] font-semibold leading-none",
                          isSelected
                            ? "text-cyan-700 dark:text-cyan-200"
                            : "text-slate-600 dark:text-slate-300",
                        )}
                      >
                        {monthBucket.shortLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {events.length} review event{events.length === 1 ? "" : "s"} for {selectedYear}
        {" "}(
        {totalNeedsReviewEvents} Needs Review, {totalUpToDateEvents} Reviewed).{" "}
        {filteredEvents.length} event{filteredEvents.length === 1 ? "" : "s"} match the active
        filter.
      </p>

      <div className="grid gap-2 rounded-xl border border-slate-300/70 bg-white/60 p-3 dark:border-slate-700 dark:bg-slate-900/45">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {selectedMonthAllStates?.longLabel ?? "Month"}: {totalMonthEvents} review event
            {totalMonthEvents === 1 ? "" : "s"}
            {statusFilter === "all" ? "" : ` (${getReviewStatusLabel(statusFilter)})`}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {selectedWeekKey ? (
              <p className="text-xs text-slate-500 dark:text-slate-300">
                Week: {weekBuckets.find((weekBucket) => weekBucket.key === selectedWeekKey)?.label}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => setDetailsExpanded((current) => !current)}
              className="rounded-lg border border-slate-300/80 bg-white/80 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-800/70"
            >
              {detailsExpanded ? "Collapse review events" : "Expand review events"}
            </button>
          </div>
        </div>

        {!detailsExpanded ? (
          <p className="rounded-lg border border-slate-300/70 bg-white/80 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
            Review events are collapsed. Click Expand review events to drill into week and
            instruction details.
          </p>
        ) : weekBuckets.length === 0 ? (
          <p className="rounded-lg border border-slate-300/70 bg-white/80 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
            No review activity in this month for the current filter.
          </p>
        ) : (
          <>
            <div
              className={cn(
                "grid gap-1",
                expanded ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2",
              )}
            >
              {weekBuckets.map((weekBucket) => (
                <button
                  key={weekBucket.key}
                  type="button"
                  onClick={() => setSelectedWeekKey(weekBucket.key)}
                  className={cn(
                    "rounded-lg border px-2 py-1.5 text-left text-xs transition",
                    selectedWeekKey === weekBucket.key
                      ? "border-cyan-500/45 bg-cyan-500/15 text-cyan-800 dark:text-cyan-100"
                      : "border-slate-300/80 bg-white/80 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-800/70",
                  )}
                >
                  <p className="font-semibold">{weekBucket.label}</p>
                  <p className="text-[11px] opacity-80">
                    {weekBucket.events.length} review event
                    {weekBucket.events.length === 1 ? "" : "s"}
                  </p>
                </button>
              ))}
            </div>

            {selectedWeekEvents.length === 0 ? (
              <p className="rounded-lg border border-slate-300/70 bg-white/80 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
                Choose a week to see review activity details.
              </p>
            ) : (
              <div
                className={cn(
                  "grid gap-1 pr-1",
                  expanded ? "" : "max-h-52 overflow-y-auto",
                )}
              >
                {(expanded ? selectedWeekEvents : compactVisibleWeekEvents).map((event) => (
                  <Link
                    key={event.id}
                    href={`/instructions/${event.instructionId}`}
                    onClick={() => setIsModalOpen(false)}
                    className="grid gap-1 rounded-lg border border-slate-300/70 bg-white/85 px-3 py-2 transition hover:border-cyan-400/70 hover:bg-cyan-500/10 dark:border-slate-700 dark:bg-slate-950/60 dark:hover:border-cyan-500/50 dark:hover:bg-cyan-500/15"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {getPartIdLabel(event.workItem.partId)} | {event.workItem.departmentName}
                      </p>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          getReviewStatusBadgeClass(event.nextStatus),
                        )}
                      >
                        {getReviewTransitionLabel(event)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      {event.workItem.itemTitle}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      <LocalDateTime value={event.occurredAt} mode="dateTime" /> by {event.actorName}
                      {event.revision ? ` | Rev ${event.revision}` : ""}
                    </p>
                    {event.detail ? (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">{event.detail}</p>
                    ) : null}
                  </Link>
                ))}
              </div>
            )}

            {!expanded && selectedWeekEvents.length > compactVisibleWeekEvents.length ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                +{selectedWeekEvents.length - compactVisibleWeekEvents.length} more in this week.
                Open expanded view to see all.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="grid gap-3 rounded-2xl border border-slate-300/70 bg-white/60 p-4 dark:border-slate-700 dark:bg-slate-900/45">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="grid gap-0.5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Instruction Reviews by Month
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-300">
              Drill down month -&gt; week -&gt; reviewed instructions.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/20 dark:text-cyan-100"
          >
            <Maximize2 size={13} />
            Expand
          </button>
        </div>

        {renderExplorer(false)}
      </div>

      {portalReady && isModalOpen
        ? createPortal(
            <div
              className="dark fixed inset-0 z-[121] overflow-y-auto bg-slate-950/80 backdrop-blur-sm"
              role="presentation"
            >
              <div
                className="flex min-h-full items-center justify-center p-4 sm:p-6"
                onClick={() => setIsModalOpen(false)}
              >
                <div
                  className="flex max-h-[92dvh] w-full max-w-6xl min-h-0 flex-col gap-4 overflow-hidden rounded-2xl border border-cyan-500/35 bg-slate-950/95 p-4 shadow-2xl sm:p-5"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Instruction review activity chart"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold text-slate-100">
                        Instruction Review Activity
                      </h3>
                      <p className="text-sm text-slate-300">
                        Monthly review counts with week and instruction-level drill-down.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      className="rounded-xl border border-slate-600 bg-slate-900/70 px-3 py-1.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                    >
                      Close
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
                    {renderExplorer(true)}
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
