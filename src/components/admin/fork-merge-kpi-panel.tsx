"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

type ForkMergePeriod = "day" | "week" | "month" | "year";
type ForkMergeMode = "selective" | "overwrite";

interface TrendPoint {
  key: string;
  label: string;
  forksCreated: number;
  merges: number;
  selectiveMerges: number;
  overwriteMerges: number;
}

interface ContributorEntry {
  userId: string;
  label: string;
  merges: number;
  selectiveMerges: number;
  overwriteMerges: number;
}

interface ForkMergeKpiResponse {
  period: ForkMergePeriod;
  periodLabel: string;
  trendPoints: TrendPoint[];
  contributors: ContributorEntry[];
  totalForkBranches: number;
  mergedForkBranches: number;
  openForkBranches: number;
  totalForksCreatedInPeriod: number;
  totalMergesInPeriod: number;
  totalSelectiveMergesInPeriod: number;
  totalOverwriteMergesInPeriod: number;
  mergeRatePercent: number;
  prevPeriodParams: string;
  nextPeriodParams: string;
  generatedAt: string;
}

interface ForkMergeDetailEvent {
  id: string;
  kind: "fork_created" | "fork_merge";
  instructionId: string;
  actorName: string;
  occurredAt: string;
  detail: string;
  partId: string;
  itemTitle: string;
  departmentName: string;
  forkNumber: number | null;
  mode: ForkMergeMode | null;
}

interface SelectedTrendBucket {
  point: TrendPoint;
  from: string;
  to: string;
}

const PERIOD_BUTTONS: Array<{ value: ForkMergePeriod; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

const KPI_STORAGE_KEY = "admin.kpi.forkMerge.periodParams";

function getBucketRange(
  period: ForkMergePeriod,
  key: string,
): { from: string; to: string } {
  if (period === "day") {
    const startAt = new Date(`${key}:00:00.000Z`);
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    return { from: startAt.toISOString(), to: endAt.toISOString() };
  }

  if (period === "year") {
    const [yearString, monthString] = key.split("-");
    const year = Number.parseInt(yearString ?? "2000", 10);
    const month = Number.parseInt(monthString ?? "1", 10);
    const startAt = new Date(Date.UTC(year, month - 1, 1));
    const endAt =
      month === 12
        ? new Date(Date.UTC(year + 1, 0, 1))
        : new Date(Date.UTC(year, month, 1));
    return { from: startAt.toISOString(), to: endAt.toISOString() };
  }

  const startAt = new Date(`${key}T00:00:00.000Z`);
  const endAt = new Date(startAt.getTime() + 24 * 60 * 60 * 1000);
  return { from: startAt.toISOString(), to: endAt.toISOString() };
}

function isValidPeriodParams(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }

  const params = new URLSearchParams(value);
  const period = params.get("period");
  return period === "day" || period === "week" || period === "month" || period === "year";
}

export function ForkMergeKpiPanel() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [periodParams, setPeriodParams] = useState("period=week");
  const [data, setData] = useState<ForkMergeKpiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<SelectedTrendBucket | null>(null);
  const [detailEvents, setDetailEvents] = useState<ForkMergeDetailEvent[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailTruncated, setDetailTruncated] = useState(false);

  const getAuthHeaders = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Missing session token. Please sign in again.");
    }

    return {
      Authorization: `Bearer ${session.access_token}`,
    };
  }, [supabase]);

  const fetchKpiData = useCallback(
    async (params: string) => {
      setLoading(true);
      setError(null);

      try {
        const headers = await getAuthHeaders();
        const response = await fetch(`/api/kpis/fork-merge?${params}`, {
          method: "GET",
          headers,
        });

        const payload = (await response.json().catch(() => ({}))) as
          | ForkMergeKpiResponse
          | { error?: string };
        if (!response.ok) {
          throw new Error(
            "error" in payload
              ? payload.error ?? "Unable to load fork/merge KPI data."
              : "Unable to load fork/merge KPI data.",
          );
        }

        if ("trendPoints" in payload) {
          setData(payload);
        }
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to load fork/merge KPI data.",
        );
      } finally {
        setLoading(false);
      }
    },
    [getAuthHeaders],
  );

  const fetchDetailData = useCallback(
    async (from: string, to: string) => {
      setDetailLoading(true);
      setDetailError(null);
      setDetailEvents([]);
      setDetailTruncated(false);

      try {
        const headers = await getAuthHeaders();
        const params = new URLSearchParams({ from, to });
        const response = await fetch(`/api/kpis/fork-merge/detail?${params.toString()}`, {
          method: "GET",
          headers,
        });

        const payload = (await response.json().catch(() => ({}))) as {
          events?: ForkMergeDetailEvent[];
          truncated?: boolean;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(
            payload.error ?? "Unable to load fork/merge drilldown events.",
          );
        }

        setDetailEvents(Array.isArray(payload.events) ? payload.events : []);
        setDetailTruncated(payload.truncated === true);
      } catch (caughtError) {
        setDetailError(
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to load fork/merge drilldown events.",
        );
      } finally {
        setDetailLoading(false);
      }
    },
    [getAuthHeaders],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedParams = window.localStorage.getItem(KPI_STORAGE_KEY);
    if (isValidPeriodParams(storedParams)) {
      setPeriodParams(storedParams);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(KPI_STORAGE_KEY, periodParams);
  }, [periodParams]);

  useEffect(() => {
    void fetchKpiData(periodParams);
  }, [fetchKpiData, periodParams]);

  const trendPoints = data?.trendPoints ?? [];
  const contributors = data?.contributors ?? [];
  const currentPeriod = data?.period ?? "week";
  const currentPeriodLabel = data?.periodLabel ?? "";
  const maxTrendValue = Math.max(
    1,
    ...trendPoints.map((point) => Math.max(point.forksCreated, point.merges)),
  );
  const labelStep = trendPoints.length <= 12 ? 1 : trendPoints.length <= 20 ? 2 : 4;
  const canUsePortal = typeof document !== "undefined";

  return (
    <>
      <section className="grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Fork and Merge KPI
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Tracks fork branch creation, merge mode usage, and open branch backlog.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (data?.prevPeriodParams) {
                  setPeriodParams(data.prevPeriodParams);
                }
              }}
              disabled={loading}
              className="rounded-lg border border-slate-300/70 bg-white/70 p-1.5 text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label="Previous period"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="min-w-[150px] text-center text-sm font-semibold text-slate-700 dark:text-slate-200">
              {loading ? <Loader2 size={14} className="mx-auto animate-spin" /> : currentPeriodLabel}
            </span>
            <button
              type="button"
              onClick={() => {
                if (data?.nextPeriodParams) {
                  setPeriodParams(data.nextPeriodParams);
                }
              }}
              disabled={loading}
              className="rounded-lg border border-slate-300/70 bg-white/70 p-1.5 text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label="Next period"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        <div className="inline-flex overflow-hidden rounded-xl border border-slate-300/70 bg-white/70 dark:border-slate-700 dark:bg-slate-900/50">
          {PERIOD_BUTTONS.map((button) => (
            <button
              key={button.value}
              type="button"
              onClick={() => setPeriodParams(`period=${button.value}`)}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold transition",
                currentPeriod === button.value
                  ? "bg-cyan-500/20 text-cyan-800 dark:text-cyan-100"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
              )}
            >
              {button.label}
            </button>
          ))}
        </div>

        {error ? (
          <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200">
            {error}
          </p>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-800 dark:text-cyan-100">
              Total Fork Branches
            </p>
            <p className="text-2xl font-extrabold text-cyan-900 dark:text-cyan-100">
              {data?.totalForkBranches ?? 0}
            </p>
          </article>
          <article className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-100">
              Open Branches
            </p>
            <p className="text-2xl font-extrabold text-amber-900 dark:text-amber-100">
              {data?.openForkBranches ?? 0}
            </p>
          </article>
          <article className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-100">
              Merge Rate
            </p>
            <p className="text-2xl font-extrabold text-emerald-900 dark:text-emerald-100">
              {`${(data?.mergeRatePercent ?? 0).toFixed(1)}%`}
            </p>
          </article>
          <article className="rounded-xl border border-violet-500/35 bg-violet-500/10 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-100">
              Merges In Period
            </p>
            <p className="text-2xl font-extrabold text-violet-900 dark:text-violet-100">
              {data?.totalMergesInPeriod ?? 0}
            </p>
          </article>
        </div>

        <div className="grid gap-3 rounded-2xl border border-slate-300/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-cyan-500" />
                Forks created
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-emerald-500" />
                Merges
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Click a bar to drill down.
            </p>
          </div>

          {loading ? (
            <div className="flex h-44 items-center justify-center">
              <Loader2 size={22} className="animate-spin text-slate-400" />
            </div>
          ) : trendPoints.length === 0 ? (
            <div className="flex h-44 items-center justify-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No fork or merge activity in this period.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2">
              <div className="grid h-44 grid-rows-5 items-end text-right text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                {Array.from({ length: 5 }, (_, idx) => {
                  const value = Math.ceil((maxTrendValue / 4) * (4 - idx));
                  return (
                    <span key={`fork-merge-axis-${idx}`}>{idx === 4 ? "0" : value}</span>
                  );
                })}
              </div>
              <div className="min-w-0">
                <div className="relative h-44">
                  <div className="pointer-events-none absolute inset-0 grid grid-rows-5">
                    {Array.from({ length: 5 }, (_, idx) => (
                      <span
                        key={`fork-merge-grid-${idx}`}
                        className={cn(
                          "border-t border-slate-300/35 dark:border-slate-700/45",
                          idx === 4 ? "border-b border-slate-300/35 dark:border-slate-700/45" : "",
                        )}
                      />
                    ))}
                  </div>
                  <div
                    className="relative h-44 items-end"
                    style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(${trendPoints.length}, minmax(0, 1fr))`,
                      alignItems: "end",
                    }}
                  >
                    {trendPoints.map((point) => {
                      const total = point.forksCreated + point.merges;
                      const forksHeight = (point.forksCreated / maxTrendValue) * 100;
                      const mergesHeight = (point.merges / maxTrendValue) * 100;
                      const isEmpty = total === 0;

                      return (
                        <button
                          key={point.key}
                          type="button"
                          onClick={() => {
                            if (isEmpty) {
                              return;
                            }

                            const { from, to } = getBucketRange(currentPeriod, point.key);
                            setSelectedBucket({ point, from, to });
                            void fetchDetailData(from, to);
                          }}
                          className={cn(
                            "group relative flex h-full items-end justify-center gap-px rounded-sm",
                            isEmpty ? "cursor-default" : "cursor-pointer focus-visible:ring-2 focus-visible:ring-cyan-400/70",
                          )}
                          disabled={isEmpty}
                          aria-label={`${point.key}: ${point.forksCreated} forks and ${point.merges} merges`}
                        >
                          <span
                            className="rounded-t bg-cyan-500/85"
                            style={{
                              width: "calc(50% - 1px)",
                              height: `${Math.max(
                                point.forksCreated > 0 ? forksHeight : 0,
                                point.forksCreated > 0 ? 4 : 0,
                              )}%`,
                            }}
                          />
                          <span
                            className="rounded-t bg-emerald-500/85"
                            style={{
                              width: "calc(50% - 1px)",
                              height: `${Math.max(
                                point.merges > 0 ? mergesHeight : 0,
                                point.merges > 0 ? 4 : 0,
                              )}%`,
                            }}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div
                  className="mt-1"
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${trendPoints.length}, minmax(0, 1fr))`,
                  }}
                >
                  {trendPoints.map((point, index) => (
                    <p
                      key={`fork-merge-label-${point.key}`}
                      className={cn(
                        "text-center text-[10px] text-slate-500 dark:text-slate-400",
                        index % labelStep !== 0 ? "invisible" : "",
                      )}
                    >
                      {point.label}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}

          <p className="text-xs text-slate-500 dark:text-slate-400">
            {currentPeriodLabel}: {data?.totalForksCreatedInPeriod ?? 0} fork
            {data?.totalForksCreatedInPeriod === 1 ? "" : "s"} created,{" "}
            {data?.totalMergesInPeriod ?? 0} merge{data?.totalMergesInPeriod === 1 ? "" : "s"} (
            {data?.totalSelectiveMergesInPeriod ?? 0} selective /{" "}
            {data?.totalOverwriteMergesInPeriod ?? 0} overwrite).
          </p>
          {data?.generatedAt ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Last refreshed <LocalDateTime value={data.generatedAt} mode="dateTime" />.
            </p>
          ) : null}
        </div>

        <div className="grid gap-2 rounded-2xl border border-slate-300/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Top Merge Contributors
          </h3>
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={20} className="animate-spin text-slate-400" />
            </div>
          ) : contributors.length === 0 ? (
            <p className="rounded-lg border border-slate-300/70 bg-white/80 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
              No merge activity in this period.
            </p>
          ) : (
            <div className="grid gap-2">
              {contributors.map((entry) => (
                <article
                  key={entry.userId}
                  className="rounded-lg border border-slate-300/70 bg-white/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-950/60"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <p className="font-semibold text-slate-800 dark:text-slate-100">
                      {entry.label}
                    </p>
                    <p className="text-slate-600 dark:text-slate-300">
                      {entry.merges} merge{entry.merges === 1 ? "" : "s"}
                    </p>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {entry.selectiveMerges} selective | {entry.overwriteMerges} overwrite
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {canUsePortal && selectedBucket
        ? createPortal(
            <div
              className="app-modal-shell fixed inset-0 z-[211] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
              onClick={() => setSelectedBucket(null)}
              role="presentation"
            >
              <article
                className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-slate-950/96 shadow-2xl"
                style={{ maxHeight: "80dvh" }}
                role="dialog"
                aria-modal="true"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 p-5">
                  <div>
                    <h3 className="text-base font-bold text-slate-100">{selectedBucket.point.key}</h3>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {selectedBucket.point.forksCreated} forks | {selectedBucket.point.merges} merges
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedBucket(null)}
                    aria-label="Close drilldown"
                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  {detailLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 size={22} className="animate-spin text-slate-400" />
                    </div>
                  ) : detailError ? (
                    <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                      {detailError}
                    </p>
                  ) : detailEvents.length === 0 ? (
                    <p className="text-center text-sm text-slate-400">
                      No fork or merge events in this bucket.
                    </p>
                  ) : (
                    <div className="grid gap-2">
                      {detailTruncated ? (
                        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
                          Showing first 300 events. Narrow the period for full detail.
                        </p>
                      ) : null}
                      {detailEvents.map((event) => (
                        <Link
                          key={event.id}
                          href={`/instructions/${event.instructionId}`}
                          className="grid gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 transition hover:bg-white/10"
                          onClick={() => setSelectedBucket(null)}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-100">
                              {event.partId} | {event.itemTitle}
                            </p>
                            <span
                              className={cn(
                                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                event.kind === "fork_created"
                                  ? "border-cyan-500/40 bg-cyan-500/20 text-cyan-700 dark:text-cyan-300"
                                  : "border-emerald-500/40 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
                              )}
                            >
                              {event.kind === "fork_created"
                                ? `Fork ${event.forkNumber ?? "?"} Created`
                                : `Merged (${event.mode ?? "selective"})`}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400">{event.departmentName}</p>
                          <p className="text-[11px] text-slate-500">
                            {event.actorName} |{" "}
                            <LocalDateTime value={event.occurredAt} mode="dateTime" />
                          </p>
                          <p className="text-xs text-slate-300">{event.detail}</p>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
