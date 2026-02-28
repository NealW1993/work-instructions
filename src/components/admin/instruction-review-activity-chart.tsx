"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { cn } from "@/lib/utils";

type ReviewStatus = "up_to_date" | "needs_review";
type ReviewStatusFilter = "all" | ReviewStatus;
type ReviewPeriod = "year" | "month" | "week" | "day";

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

interface ChartBucket {
  key: string;
  label: string;
  needsReviewCount: number;
  upToDateCount: number;
  events: ReviewActivityEvent[];
}

interface WeekSubBucket {
  key: string;
  label: string;
  startAt: string;
  events: ReviewActivityEvent[];
}

interface InstructionReviewActivityChartProps {
  getAuthHeaders: () => Promise<Record<string, string>>;
  reloadToken?: number;
}

interface StoredReviewActivityFilters {
  period: ReviewPeriod;
  selectedYear: number;
  selectedPeriodMonth: number;
  selectedPeriodWeekStart: string;
  selectedPeriodDay: string;
  statusFilter: ReviewStatusFilter;
}

const MONTH_SHORT_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const MONTH_LONG_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const DAY_SHORT_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const MONTH_SELECT_OPTIONS = MONTH_SHORT_LABELS.map((label, i) => ({ value: i + 1, label }));

const STATUS_FILTER_OPTIONS: Array<{ value: ReviewStatusFilter; label: string }> = [
  { value: "all", label: "All review states" },
  { value: "needs_review", label: "Needs Review only" },
  { value: "up_to_date", label: "Reviewed only" },
];

const PERIOD_BUTTONS: Array<{ value: ReviewPeriod; label: string }> = [
  { value: "year", label: "Year" },
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
];

const MS_IN_DAY = 24 * 60 * 60 * 1000;
const REVIEW_ACTIVITY_FILTER_STORAGE_KEY = "admin.review.activity.filters";

function getUtcWeekStart(date: Date): Date {
  const utcDay = date.getUTCDay();
  const mondayOffset = (utcDay + 6) % 7;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - mondayOffset),
  );
}

function toUtcDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function formatUtcMonthDayLabel(date: Date): string {
  const month = MONTH_SHORT_LABELS[date.getUTCMonth()] ?? "Jan";
  return `${month} ${date.getUTCDate()}`;
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return "12am";
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return "12pm";
  return `${hour - 12}pm`;
}

function shiftDay(dateKey: string, deltaDays: number): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return toUtcDateKey(d);
}

function shiftWeek(weekStartKey: string, deltaWeeks: number): string {
  const d = new Date(`${weekStartKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaWeeks * 7);
  return toUtcDateKey(d);
}

function formatWeekLabel(weekStartKey: string): string {
  const weekStart = new Date(`${weekStartKey}T00:00:00.000Z`);
  const weekEnd = new Date(weekStart.getTime() + 6 * MS_IN_DAY);
  return `${formatUtcMonthDayLabel(weekStart)} – ${formatUtcMonthDayLabel(weekEnd)}, ${weekEnd.getUTCFullYear()}`;
}

function getPartIdLabel(partId: string): string {
  return partId.trim() || "N/A";
}

function toSortableTimestamp(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getReviewStatusLabel(status: ReviewStatus): string {
  return status === "needs_review" ? "Needs Review" : "Reviewed";
}

function getReviewStatusBadgeClass(status: ReviewStatus): string {
  return status === "needs_review"
    ? "border-amber-500/45 bg-amber-500/20 text-amber-800 dark:text-amber-100"
    : "border-emerald-500/45 bg-emerald-500/20 text-emerald-800 dark:text-emerald-100";
}

function getReviewTransitionLabel(event: ReviewActivityEvent): string {
  const nextLabel = getReviewStatusLabel(event.nextStatus);
  if (!event.previousStatus) return nextLabel;
  return `${getReviewStatusLabel(event.previousStatus)} -> ${nextLabel}`;
}

function getSeriesBarHeight(count: number, maxCount: number): number {
  if (count <= 0 || maxCount <= 0) return 0;
  return Math.min(96, Math.max((count / maxCount) * 100, 6));
}

function isReviewPeriod(value: unknown): value is ReviewPeriod {
  return value === "year" || value === "month" || value === "week" || value === "day";
}

function isReviewStatusFilter(value: unknown): value is ReviewStatusFilter {
  return value === "all" || value === "up_to_date" || value === "needs_review";
}

function isValidYear(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 2000 && value <= 2100;
}

function isValidMonth(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12;
}

function isValidUtcDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(paddingLength);
  return atob(padded);
}

function getUserIdFromAuthHeaders(headers: Record<string, string>): string | null {
  const authorizationHeader = headers.Authorization ?? headers.authorization;
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authorizationHeader.slice(7).trim();
  const tokenParts = token.split(".");
  if (tokenParts.length < 2) {
    return null;
  }

  try {
    const decodedPayload = decodeBase64Url(tokenParts[1] ?? "");
    const parsedPayload = JSON.parse(decodedPayload) as { sub?: unknown };
    const subject =
      typeof parsedPayload.sub === "string" ? parsedPayload.sub.trim() : "";
    return subject || null;
  } catch {
    return null;
  }
}

function isInteractiveClickTarget(target: EventTarget | null) {
  if (!(target instanceof Node)) {
    return false;
  }

  const element =
    target instanceof HTMLElement ? target : target.parentElement;
  if (!element) {
    return false;
  }

  return Boolean(
    element.closest(
      "button, a, input, select, textarea, label, [role='button'], [role='link']",
    ),
  );
}

function buildYearChartBuckets(events: ReviewActivityEvent[]): ChartBucket[] {
  const buckets: ChartBucket[] = MONTH_SHORT_LABELS.map((label, i) => ({
    key: String(i),
    label,
    needsReviewCount: 0,
    upToDateCount: 0,
    events: [],
  }));
  const needsReviewIds = buckets.map(() => new Set<string>());
  const reviewedIds = buckets.map(() => new Set<string>());

  for (const event of events) {
    const d = new Date(event.occurredAt);
    if (Number.isNaN(d.getTime())) continue;
    const mi = d.getUTCMonth();
    const bucket = buckets[mi];
    if (!bucket) continue;
    bucket.events.push(event);
    if (event.nextStatus === "needs_review") {
      needsReviewIds[mi]?.add(event.instructionId);
    } else {
      reviewedIds[mi]?.add(event.instructionId);
    }
  }

  for (let i = 0; i < buckets.length; i++) {
    buckets[i]!.needsReviewCount = needsReviewIds[i]?.size ?? 0;
    buckets[i]!.upToDateCount = reviewedIds[i]?.size ?? 0;
    buckets[i]!.events.sort(
      (a, b) => toSortableTimestamp(b.occurredAt) - toSortableTimestamp(a.occurredAt),
    );
  }
  return buckets;
}

function buildMonthChartBuckets(
  events: ReviewActivityEvent[],
  year: number,
  month: number,
): ChartBucket[] {
  const monthIndex = month - 1;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const buckets: ChartBucket[] = Array.from({ length: daysInMonth }, (_, i) => ({
    key: `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`,
    label: String(i + 1),
    needsReviewCount: 0,
    upToDateCount: 0,
    events: [],
  }));
  const needsReviewIds = buckets.map(() => new Set<string>());
  const reviewedIds = buckets.map(() => new Set<string>());

  for (const event of events) {
    const d = new Date(event.occurredAt);
    if (Number.isNaN(d.getTime())) continue;
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== monthIndex) continue;
    const dayIdx = d.getUTCDate() - 1;
    const bucket = buckets[dayIdx];
    if (!bucket) continue;
    bucket.events.push(event);
    if (event.nextStatus === "needs_review") {
      needsReviewIds[dayIdx]?.add(event.instructionId);
    } else {
      reviewedIds[dayIdx]?.add(event.instructionId);
    }
  }

  for (let i = 0; i < buckets.length; i++) {
    buckets[i]!.needsReviewCount = needsReviewIds[i]?.size ?? 0;
    buckets[i]!.upToDateCount = reviewedIds[i]?.size ?? 0;
    buckets[i]!.events.sort(
      (a, b) => toSortableTimestamp(b.occurredAt) - toSortableTimestamp(a.occurredAt),
    );
  }
  return buckets;
}

function buildWeekChartBuckets(events: ReviewActivityEvent[], weekStart: Date): ChartBucket[] {
  const buckets: ChartBucket[] = DAY_SHORT_LABELS.map((label, i) => {
    const dayDate = new Date(weekStart.getTime() + i * MS_IN_DAY);
    return { key: toUtcDateKey(dayDate), label, needsReviewCount: 0, upToDateCount: 0, events: [] };
  });
  const keyToIdx = new Map(buckets.map((b, i) => [b.key, i]));
  const needsReviewIds = buckets.map(() => new Set<string>());
  const reviewedIds = buckets.map(() => new Set<string>());

  for (const event of events) {
    const d = new Date(event.occurredAt);
    if (Number.isNaN(d.getTime())) continue;
    const idx = keyToIdx.get(toUtcDateKey(d));
    if (idx === undefined) continue;
    buckets[idx]!.events.push(event);
    if (event.nextStatus === "needs_review") {
      needsReviewIds[idx]!.add(event.instructionId);
    } else {
      reviewedIds[idx]!.add(event.instructionId);
    }
  }

  for (let i = 0; i < buckets.length; i++) {
    buckets[i]!.needsReviewCount = needsReviewIds[i]!.size;
    buckets[i]!.upToDateCount = reviewedIds[i]!.size;
    buckets[i]!.events.sort(
      (a, b) => toSortableTimestamp(b.occurredAt) - toSortableTimestamp(a.occurredAt),
    );
  }
  return buckets;
}

function buildDayChartBuckets(events: ReviewActivityEvent[], dayKey: string): ChartBucket[] {
  const buckets: ChartBucket[] = Array.from({ length: 24 }, (_, h) => ({
    key: `${dayKey}T${String(h).padStart(2, "0")}`,
    label: formatHourLabel(h),
    needsReviewCount: 0,
    upToDateCount: 0,
    events: [],
  }));
  const needsReviewIds = buckets.map(() => new Set<string>());
  const reviewedIds = buckets.map(() => new Set<string>());

  for (const event of events) {
    const d = new Date(event.occurredAt);
    if (Number.isNaN(d.getTime())) continue;
    if (toUtcDateKey(d) !== dayKey) continue;
    const h = d.getUTCHours();
    const bucket = buckets[h];
    if (!bucket) continue;
    bucket.events.push(event);
    if (event.nextStatus === "needs_review") {
      needsReviewIds[h]!.add(event.instructionId);
    } else {
      reviewedIds[h]!.add(event.instructionId);
    }
  }

  for (let h = 0; h < 24; h++) {
    buckets[h]!.needsReviewCount = needsReviewIds[h]!.size;
    buckets[h]!.upToDateCount = reviewedIds[h]!.size;
    buckets[h]!.events.sort(
      (a, b) => toSortableTimestamp(b.occurredAt) - toSortableTimestamp(a.occurredAt),
    );
  }
  return buckets;
}

function buildWeekSubBuckets(events: ReviewActivityEvent[]): WeekSubBucket[] {
  const weekByKey = new Map<string, WeekSubBucket>();
  for (const event of events) {
    const d = new Date(event.occurredAt);
    if (Number.isNaN(d.getTime())) continue;
    const weekStart = getUtcWeekStart(d);
    const weekKey = toUtcDateKey(weekStart);
    let wb = weekByKey.get(weekKey);
    if (!wb) {
      const weekEnd = new Date(weekStart.getTime() + 6 * MS_IN_DAY);
      wb = {
        key: weekKey,
        label: `${formatUtcMonthDayLabel(weekStart)} - ${formatUtcMonthDayLabel(weekEnd)}`,
        startAt: weekStart.toISOString(),
        events: [],
      };
      weekByKey.set(weekKey, wb);
    }
    wb.events.push(event);
  }
  const result = [...weekByKey.values()];
  for (const wb of result) {
    wb.events.sort(
      (a, b) => toSortableTimestamp(b.occurredAt) - toSortableTimestamp(a.occurredAt),
    );
  }
  result.sort((a, b) => toSortableTimestamp(b.startAt) - toSortableTimestamp(a.startAt));
  return result;
}

function EventCard({ event }: { event: ReviewActivityEvent }) {
  return (
    <Link
      href={`/instructions/${event.instructionId}`}
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
      <p className="text-xs text-slate-600 dark:text-slate-300">{event.workItem.itemTitle}</p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        <LocalDateTime value={event.occurredAt} mode="dateTime" /> by {event.actorName}
        {event.revision ? ` | Rev ${event.revision}` : ""}
      </p>
      {event.detail ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{event.detail}</p>
      ) : null}
    </Link>
  );
}

export function InstructionReviewActivityChart({
  getAuthHeaders,
  reloadToken = 0,
}: InstructionReviewActivityChartProps) {
  const [period, setPeriod] = useState<ReviewPeriod>("year");
  const [selectedYear, setSelectedYear] = useState(() => new Date().getUTCFullYear());
  const [selectedPeriodMonth, setSelectedPeriodMonth] = useState(
    () => new Date().getUTCMonth() + 1,
  );
  const [selectedPeriodWeekStart, setSelectedPeriodWeekStart] = useState(() =>
    toUtcDateKey(getUtcWeekStart(new Date())),
  );
  const [selectedPeriodDay, setSelectedPeriodDay] = useState(() => toUtcDateKey(new Date()));
  const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>("all");
  const [events, setEvents] = useState<ReviewActivityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const [filtersStorageKey, setFiltersStorageKey] = useState<string | null>(null);

  // Unified bucket selection
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(() =>
    String(new Date().getUTCMonth()),
  );
  // Year-view week sub-navigation
  const [selectedWeekKey, setSelectedWeekKey] = useState<string | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getUTCFullYear();
    const years: number[] = [];
    for (let y = Math.max(selectedYear, currentYear + 1); y >= Math.min(selectedYear, currentYear - 5); y -= 1) {
      years.push(y);
    }
    return years;
  }, [selectedYear]);

  useEffect(() => {
    let isActive = true;

    void (async () => {
      if (typeof window === "undefined") {
        return;
      }

      let storageKey = REVIEW_ACTIVITY_FILTER_STORAGE_KEY;
      try {
        const headers = await getAuthHeaders();
        const userId = getUserIdFromAuthHeaders(headers);
        if (userId) {
          storageKey = `${REVIEW_ACTIVITY_FILTER_STORAGE_KEY}.${userId}`;
        }
      } catch {
        // Continue with generic local filter key if auth headers are unavailable.
      }

      if (!isActive) {
        return;
      }

      setFiltersStorageKey(storageKey);
      const storedValue = window.localStorage.getItem(storageKey);
      if (storedValue) {
        try {
          const parsed = JSON.parse(storedValue) as Partial<StoredReviewActivityFilters>;
          if (isReviewPeriod(parsed.period)) {
            setPeriod(parsed.period);
          }
          if (isValidYear(parsed.selectedYear)) {
            setSelectedYear(parsed.selectedYear);
          }
          if (isValidMonth(parsed.selectedPeriodMonth)) {
            setSelectedPeriodMonth(parsed.selectedPeriodMonth);
          }
          if (isValidUtcDateKey(parsed.selectedPeriodWeekStart)) {
            setSelectedPeriodWeekStart(parsed.selectedPeriodWeekStart);
          }
          if (isValidUtcDateKey(parsed.selectedPeriodDay)) {
            setSelectedPeriodDay(parsed.selectedPeriodDay);
          }
          if (isReviewStatusFilter(parsed.statusFilter)) {
            setStatusFilter(parsed.statusFilter);
          }
        } catch {
          // Ignore invalid persisted state and keep defaults.
        }
      }

      setFiltersHydrated(true);
    })();

    return () => {
      isActive = false;
    };
  }, [getAuthHeaders]);

  useEffect(() => {
    if (!filtersHydrated || !filtersStorageKey || typeof window === "undefined") {
      return;
    }

    const payload: StoredReviewActivityFilters = {
      period,
      selectedYear,
      selectedPeriodMonth,
      selectedPeriodWeekStart,
      selectedPeriodDay,
      statusFilter,
    };
    window.localStorage.setItem(filtersStorageKey, JSON.stringify(payload));
  }, [
    filtersHydrated,
    filtersStorageKey,
    period,
    selectedPeriodDay,
    selectedPeriodMonth,
    selectedPeriodWeekStart,
    selectedYear,
    statusFilter,
  ]);

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
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to load instruction review activity.",
      );
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, selectedYear]);

  useEffect(() => {
    if (!filtersHydrated) {
      return;
    }

    void fetchActivityEvents();
  }, [fetchActivityEvents, filtersHydrated, reloadToken]);

  // Keep year synced when navigating week/day into a different year
  useEffect(() => {
    if (period === "week") {
      const y = new Date(`${selectedPeriodWeekStart}T00:00:00.000Z`).getUTCFullYear();
      if (y !== selectedYear) setSelectedYear(y);
    } else if (period === "day") {
      const y = new Date(`${selectedPeriodDay}T00:00:00.000Z`).getUTCFullYear();
      if (y !== selectedYear) setSelectedYear(y);
    }
  }, [period, selectedPeriodWeekStart, selectedPeriodDay, selectedYear]);

  const filteredEvents = useMemo(() => {
    if (statusFilter === "all") return events;
    return events.filter((e) => e.nextStatus === statusFilter);
  }, [events, statusFilter]);

  // Chart buckets per period
  const yearBuckets = useMemo(() => buildYearChartBuckets(filteredEvents), [filteredEvents]);

  const monthBuckets = useMemo(() => {
    if (period !== "month") return [];
    return buildMonthChartBuckets(filteredEvents, selectedYear, selectedPeriodMonth);
  }, [filteredEvents, period, selectedYear, selectedPeriodMonth]);

  const weekBuckets = useMemo(() => {
    if (period !== "week") return [];
    return buildWeekChartBuckets(
      filteredEvents,
      new Date(`${selectedPeriodWeekStart}T00:00:00.000Z`),
    );
  }, [filteredEvents, period, selectedPeriodWeekStart]);

  const dayBuckets = useMemo(() => {
    if (period !== "day") return [];
    return buildDayChartBuckets(filteredEvents, selectedPeriodDay);
  }, [filteredEvents, period, selectedPeriodDay]);

  const activeBuckets = useMemo(() => {
    switch (period) {
      case "year":
        return yearBuckets;
      case "month":
        return monthBuckets;
      case "week":
        return weekBuckets;
      case "day":
        return dayBuckets;
    }
  }, [period, yearBuckets, monthBuckets, weekBuckets, dayBuckets]);

  // Chart axis
  const maxCount = useMemo(
    () => Math.max(...activeBuckets.flatMap((b) => [b.needsReviewCount, b.upToDateCount]), 1),
    [activeBuckets],
  );
  const axisStep = Math.max(1, Math.ceil(maxCount / 4));
  const axisTicks = useMemo(
    () => Array.from({ length: 5 }, (_, i) => axisStep * (4 - i)),
    [axisStep],
  );
  const axisMax = axisTicks[0] ?? 1;
  const labelStep =
    period === "year" || period === "week" ? 1 : period === "month" ? 4 : 4;

  // Keep selectedBucketKey valid when period or buckets change
  // Use a ref to avoid selectedBucketKey as a dep (prevents render loops)
  const selectedBucketKeyRef = useRef(selectedBucketKey);
  selectedBucketKeyRef.current = selectedBucketKey;

  useEffect(() => {
    if (activeBuckets.length === 0) {
      setSelectedBucketKey(null);
      return;
    }
    if (
      selectedBucketKeyRef.current &&
      activeBuckets.some((b) => b.key === selectedBucketKeyRef.current)
    ) {
      return;
    }
    if (period === "year") {
      setSelectedBucketKey(String(new Date().getUTCMonth()));
    } else {
      const first = activeBuckets.find((b) => b.events.length > 0) ?? activeBuckets[0];
      setSelectedBucketKey(first?.key ?? null);
    }
  }, [period, activeBuckets]);

  // Reset detailsExpanded on selection change
  useEffect(() => {
    setDetailsExpanded(false);
  }, [selectedBucketKey, period, selectedYear]);

  // Selected bucket
  const selectedBucket = useMemo(
    () => activeBuckets.find((b) => b.key === selectedBucketKey) ?? null,
    [activeBuckets, selectedBucketKey],
  );
  const selectedBucketEvents = useMemo(
    () => selectedBucket?.events ?? [],
    [selectedBucket],
  );

  // Year-view week sub-buckets
  const weekSubBuckets = useMemo(
    () => (period === "year" ? buildWeekSubBuckets(selectedBucketEvents) : []),
    [period, selectedBucketEvents],
  );

  useEffect(() => {
    if (period !== "year") return;
    setSelectedWeekKey((curr) => {
      if (weekSubBuckets.length === 0) return null;
      if (curr && weekSubBuckets.some((wb) => wb.key === curr)) return curr;
      return weekSubBuckets[0]?.key ?? null;
    });
  }, [period, weekSubBuckets]);

  const selectedWeekEvents = useMemo(() => {
    if (!selectedWeekKey || period !== "year") return [];
    return weekSubBuckets.find((wb) => wb.key === selectedWeekKey)?.events ?? [];
  }, [period, selectedWeekKey, weekSubBuckets]);

  // Heading label
  const selectedBucketLongLabel = useMemo(() => {
    if (!selectedBucket) return "—";
    if (period === "year") {
      const mi = Number.parseInt(selectedBucket.key, 10);
      return MONTH_LONG_LABELS[mi] ?? selectedBucket.label;
    }
    if (period === "day") {
      const hourStr = selectedBucket.key.split("T")[1];
      const h = hourStr ? Number.parseInt(hourStr, 10) : 0;
      return `${selectedPeriodDay} at ${formatHourLabel(h)}`;
    }
    const d = new Date(`${selectedBucket.key}T00:00:00.000Z`);
    return `${MONTH_LONG_LABELS[d.getUTCMonth()] ?? ""} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  }, [selectedBucket, period, selectedPeriodDay]);

  const totalNeedsReview = useMemo(
    () => events.filter((e) => e.nextStatus === "needs_review").length,
    [events],
  );
  const totalUpToDate = events.length - totalNeedsReview;

  return (
    <div className="grid gap-3 rounded-2xl border border-slate-300/70 bg-white/60 p-4 dark:border-slate-700 dark:bg-slate-900/45">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Instruction Reviews by Period
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-300">
          Click a bar to filter review events below.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-2">
        {/* Period toggle */}
        <div className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
            Period
          </span>
          <div className="inline-flex overflow-hidden rounded-xl border border-slate-300/70 bg-white/70 dark:border-slate-700 dark:bg-slate-900/50">
            {PERIOD_BUTTONS.map((btn) => (
              <button
                key={btn.value}
                type="button"
                onClick={() => setPeriod(btn.value)}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold transition",
                  period === btn.value
                    ? "bg-cyan-500/20 text-cyan-800 dark:text-cyan-100"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                )}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* Year select */}
        {period !== "day" ? (
          <label className="grid gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
              Year
            </span>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number.parseInt(e.target.value, 10))}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {/* Month select */}
        {period === "month" ? (
          <label className="grid gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
              Month
            </span>
            <select
              value={selectedPeriodMonth}
              onChange={(e) => setSelectedPeriodMonth(Number.parseInt(e.target.value, 10))}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
            >
              {MONTH_SELECT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {/* Week navigation */}
        {period === "week" ? (
          <div className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
              Week
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSelectedPeriodWeekStart(shiftWeek(selectedPeriodWeekStart, -1))}
                className="rounded-lg border border-slate-300 bg-white p-1.5 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-800"
                aria-label="Previous week"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="min-w-[152px] text-center text-xs font-semibold text-slate-700 dark:text-slate-200">
                {formatWeekLabel(selectedPeriodWeekStart)}
              </span>
              <button
                type="button"
                onClick={() => setSelectedPeriodWeekStart(shiftWeek(selectedPeriodWeekStart, 1))}
                className="rounded-lg border border-slate-300 bg-white p-1.5 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-800"
                aria-label="Next week"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        ) : null}

        {/* Day navigation */}
        {period === "day" ? (
          <div className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
              Day
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSelectedPeriodDay(shiftDay(selectedPeriodDay, -1))}
                className="rounded-lg border border-slate-300 bg-white p-1.5 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-800"
                aria-label="Previous day"
              >
                <ChevronLeft size={14} />
              </button>
              <input
                type="date"
                value={selectedPeriodDay}
                onChange={(e) => e.target.value && setSelectedPeriodDay(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
              />
              <button
                type="button"
                onClick={() => setSelectedPeriodDay(shiftDay(selectedPeriodDay, 1))}
                className="rounded-lg border border-slate-300 bg-white p-1.5 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-800"
                aria-label="Next day"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        ) : null}

        {/* Status filter */}
        <label className="grid gap-1 text-xs">
          <span className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
            Filter
          </span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ReviewStatusFilter)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
          >
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={loading || !filtersHydrated}
          onClick={() => void fetchActivityEvents()}
          className="self-end rounded-lg border border-slate-300/70 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100/80 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800/70"
        >
          {loading ? "Loading..." : "Reload Activity"}
        </button>
      </div>

      {error ? (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      {/* Chart */}
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
          <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Click a bar to filter events
          </p>
        </div>

        <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2">
          {/* Y-axis */}
          <div className="grid h-44 grid-rows-5 items-end text-right text-[10px] font-semibold text-slate-500 dark:text-slate-400">
            {axisTicks.map((tick, i) => (
              <span
                key={`axis-${tick}-${i}`}
                className={i === axisTicks.length - 1 ? "" : "translate-y-1"}
              >
                {tick}
              </span>
            ))}
          </div>

          <div className="min-w-0">
            <div className="relative h-44 overflow-hidden rounded-lg border border-slate-300/70 bg-white/75 dark:border-slate-700 dark:bg-slate-950/40">
              {/* Grid lines */}
              <div className="pointer-events-none absolute inset-0 grid grid-rows-5">
                {axisTicks.map((_, i) => (
                  <span
                    key={`grid-${i}`}
                    className={cn(
                      "border-t border-dashed border-slate-300/70 dark:border-slate-700/70",
                      i === axisTicks.length - 1
                        ? "border-b border-slate-300/70 dark:border-slate-700/70"
                        : "",
                    )}
                  />
                ))}
              </div>

              {/* Bars */}
              <div
                className="relative z-10 h-full px-1"
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${activeBuckets.length}, minmax(0, 1fr))`,
                  gap: activeBuckets.length > 20 ? "1px" : "3px",
                  alignItems: "end",
                }}
              >
                {activeBuckets.map((bucket, i) => {
                  const isSelected = selectedBucketKey === bucket.key;
                  const dimNeeds = statusFilter === "up_to_date";
                  const dimReviewed = statusFilter === "needs_review";
                  const needsH = getSeriesBarHeight(bucket.needsReviewCount, axisMax);
                  const reviewedH = getSeriesBarHeight(bucket.upToDateCount, axisMax);

                  return (
                    <button
                      key={bucket.key}
                      type="button"
                      onClick={() => setSelectedBucketKey(bucket.key)}
                      className={cn(
                        "group grid h-full min-w-0 grid-rows-[minmax(0,1fr)_auto] items-end rounded-md px-0.5 pb-1 pt-1 outline-none transition focus-visible:ring-2 focus-visible:ring-cyan-500/70",
                        isSelected
                          ? "bg-cyan-500/15 ring-1 ring-cyan-500/45"
                          : "hover:bg-cyan-500/10",
                      )}
                      title={`${bucket.label}: Needs Review ${bucket.needsReviewCount}, Reviewed ${bucket.upToDateCount}`}
                    >
                      <div className="flex min-h-0 w-full items-end justify-center gap-[3px]">
                        <span
                          className={cn(
                            "w-[42%] rounded-t-[4px] border border-amber-300/25 transition",
                            isSelected
                              ? "bg-gradient-to-t from-amber-700 to-amber-500"
                              : "bg-amber-500/70 group-hover:bg-amber-400/90",
                            dimNeeds ? "opacity-30" : "opacity-100",
                          )}
                          style={{ height: `${needsH}%` }}
                        />
                        <span
                          className={cn(
                            "w-[42%] rounded-t-[4px] border border-emerald-300/25 transition",
                            isSelected
                              ? "bg-gradient-to-t from-emerald-700 to-cyan-500"
                              : "bg-cyan-500/70 group-hover:bg-cyan-400/90",
                            dimReviewed ? "opacity-30" : "opacity-100",
                          )}
                          style={{ height: `${reviewedH}%` }}
                        />
                      </div>
                      {i % labelStep === 0 ? (
                        <span
                          className={cn(
                            "mt-1 text-[10px] font-semibold leading-none",
                            isSelected
                              ? "text-cyan-700 dark:text-cyan-200"
                              : "text-slate-600 dark:text-slate-300",
                          )}
                        >
                          {bucket.label}
                        </span>
                      ) : (
                        <span className="mt-1 h-[10px]" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Summary */}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {events.length} review event{events.length === 1 ? "" : "s"} for {selectedYear} (
        {totalNeedsReview} Needs Review, {totalUpToDate} Reviewed).{" "}
        {filteredEvents.length} event{filteredEvents.length === 1 ? "" : "s"} match the active
        filter.
      </p>

      {/* Events section */}
      <div
        onClick={(event) => {
          if (isInteractiveClickTarget(event.target)) {
            return;
          }

          setDetailsExpanded((current) => !current);
        }}
        className="grid cursor-pointer gap-2 rounded-xl border border-slate-300/70 bg-white/60 p-3 dark:border-slate-700 dark:bg-slate-900/45"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {selectedBucketLongLabel}:{" "}
            {period === "year"
              ? `${selectedBucketEvents.length} review event${selectedBucketEvents.length === 1 ? "" : "s"}`
              : `${selectedBucketEvents.length} review event${selectedBucketEvents.length === 1 ? "" : "s"}`}
            {statusFilter !== "all" ? ` (${getReviewStatusLabel(statusFilter)})` : ""}
          </h3>
          {period === "year" && selectedWeekKey ? (
            <p className="text-xs text-slate-500 dark:text-slate-300">
              Week:{" "}
              {weekSubBuckets.find((wb) => wb.key === selectedWeekKey)?.label}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => setDetailsExpanded((c) => !c)}
            className="rounded-lg border border-slate-300/80 bg-white/80 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-800/70"
          >
            {detailsExpanded ? "Collapse review events" : "Expand review events"}
          </button>
        </div>

        {!detailsExpanded ? (
          <p className="rounded-lg border border-slate-300/70 bg-white/80 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
            Review events are collapsed. Click &quot;Expand review events&quot; to see details.
          </p>
        ) : period === "year" ? (
          weekSubBuckets.length === 0 ? (
            <p className="rounded-lg border border-slate-300/70 bg-white/80 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
              No review activity in this month for the current filter.
            </p>
          ) : (
            <>
              <div className="grid gap-1 sm:grid-cols-2">
                {weekSubBuckets.map((wb) => (
                  <button
                    key={wb.key}
                    type="button"
                    onClick={() => setSelectedWeekKey(wb.key)}
                    className={cn(
                      "rounded-lg border px-2 py-1.5 text-left text-xs transition",
                      selectedWeekKey === wb.key
                        ? "border-cyan-500/45 bg-cyan-500/15 text-cyan-800 dark:text-cyan-100"
                        : "border-slate-300/80 bg-white/80 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-800/70",
                    )}
                  >
                    <p className="font-semibold">{wb.label}</p>
                    <p className="text-[11px] opacity-80">
                      {wb.events.length} review event{wb.events.length === 1 ? "" : "s"}
                    </p>
                  </button>
                ))}
              </div>

              {selectedWeekEvents.length === 0 ? (
                <p className="rounded-lg border border-slate-300/70 bg-white/80 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
                  Choose a week to see review activity details.
                </p>
              ) : (
                <div className="grid max-h-72 gap-1 overflow-y-auto pr-1">
                  {selectedWeekEvents.map((event) => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </div>
              )}
            </>
          )
        ) : selectedBucketEvents.length === 0 ? (
          <p className="rounded-lg border border-slate-300/70 bg-white/80 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
            No review activity in this period.
          </p>
        ) : (
          <div className="grid max-h-72 gap-1 overflow-y-auto pr-1">
            {selectedBucketEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
