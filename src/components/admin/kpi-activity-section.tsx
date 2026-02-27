"use client";

import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

type ActivityPeriod = "day" | "week" | "month" | "year";

interface ActivityTrendPoint {
  key: string;
  label: string;
  created: number;
  updated: number;
}

interface ContributorEntry {
  userId: string;
  label: string;
  updates: number;
}

interface ActivityApiResponse {
  period: ActivityPeriod;
  periodLabel: string;
  trendPoints: ActivityTrendPoint[];
  contributors: ContributorEntry[];
  totalCreated: number;
  totalUpdated: number;
  prevPeriodParams: string;
  nextPeriodParams: string;
}

interface TooltipProps {
  title: string;
  lines: string[];
  align?: "left" | "center" | "right";
}

function KpiTooltip({ title, lines, align = "right" }: TooltipProps) {
  const alignClass =
    align === "left"
      ? "left-0"
      : align === "center"
        ? "left-1/2 -translate-x-1/2"
        : "right-0";
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-0 z-20 w-52 -translate-y-[108%] rounded-xl border border-white/35 bg-slate-950/97 px-3 py-2 text-xs shadow-2xl opacity-0 transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100",
        alignClass,
      )}
    >
      <p className="font-semibold text-slate-100">{title}</p>
      <div className="mt-1 grid gap-0.5">
        {lines.map((line, i) => (
          <p key={i} className="text-[11px] text-slate-300 opacity-95">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

const PERIOD_BUTTONS: { value: ActivityPeriod; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

export function KpiActivitySection() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [periodParams, setPeriodParams] = useState("period=week");
  const [data, setData] = useState<ActivityApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    async (params: string) => {
      setLoading(true);
      setError(null);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Not authenticated.");

        const response = await fetch(`/api/kpis/activity?${params}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Failed to load activity data.");
        }

        const result = (await response.json()) as ActivityApiResponse;
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load activity data.");
      } finally {
        setLoading(false);
      }
    },
    [supabase],
  );

  useEffect(() => {
    void fetchData(periodParams);
  }, [fetchData, periodParams]);

  const currentPeriod = data?.period ?? "week";
  const periodLabel = data?.periodLabel ?? "";
  const trendPoints: ActivityTrendPoint[] = data?.trendPoints ?? [];
  const contributors: ContributorEntry[] = data?.contributors ?? [];
  const totalCreated = data?.totalCreated ?? 0;
  const totalUpdated = data?.totalUpdated ?? 0;

  const numPoints = trendPoints.length;
  const maxTrendCount = Math.max(...trendPoints.flatMap((p) => [p.created, p.updated]), 1);
  const trendAxisStep = Math.max(1, Math.ceil(maxTrendCount / 4));
  const trendAxisTicks = Array.from({ length: 5 }, (_, i) => trendAxisStep * (4 - i));
  const trendAxisMax = trendAxisTicks[0] ?? 1;
  const maxContributorUpdates = Math.max(...contributors.map((c) => c.updates), 1);

  // Show fewer x-axis labels when many columns to avoid overlap
  const labelStep = numPoints <= 12 ? 1 : numPoints <= 20 ? 2 : 4;

  const handlePeriodChange = (newPeriod: ActivityPeriod) => {
    setPeriodParams(`period=${newPeriod}`);
  };

  const handlePrev = () => {
    if (data?.prevPeriodParams) setPeriodParams(data.prevPeriodParams);
  };

  const handleNext = () => {
    if (data?.nextPeriodParams) setPeriodParams(data.nextPeriodParams);
  };

  return (
    <>
      {/* Activity Trend */}
      <section className="grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Activity Trend
            </h2>
            {/* Period selector */}
            <div className="inline-flex overflow-hidden rounded-xl border border-slate-300/70 bg-white/70 dark:border-slate-700 dark:bg-slate-900/50">
              {PERIOD_BUTTONS.map((btn) => (
                <button
                  key={btn.value}
                  type="button"
                  onClick={() => handlePeriodChange(btn.value)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-semibold transition",
                    currentPeriod === btn.value
                      ? "bg-cyan-500/20 text-cyan-800 dark:text-cyan-100"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                  )}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          {/* Period navigation */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrev}
              disabled={loading}
              aria-label="Previous period"
              className="rounded-lg border border-slate-300/70 bg-white/70 p-1.5 text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="min-w-[160px] text-center text-sm font-semibold text-slate-700 dark:text-slate-200">
              {loading ? <Loader2 size={14} className="mx-auto animate-spin" /> : periodLabel}
            </span>
            <button
              type="button"
              onClick={handleNext}
              disabled={loading}
              aria-label="Next period"
              className="rounded-lg border border-slate-300/70 bg-white/70 p-1.5 text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {error ? (
          <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200">
            {error}
          </p>
        ) : (
          <div className="grid gap-3">
            <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-emerald-500" />
                Created
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-cyan-500" />
                Updated
              </span>
            </div>

            <div className="rounded-xl border border-slate-300/70 bg-white/70 p-2 dark:border-slate-700 dark:bg-slate-900/50">
              {loading ? (
                <div className="flex h-44 items-center justify-center">
                  <Loader2 size={22} className="animate-spin text-slate-400" />
                </div>
              ) : numPoints === 0 ? (
                <div className="flex h-44 items-center justify-center">
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    No activity in this period.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2">
                  {/* Y-axis */}
                  <div className="grid h-44 grid-rows-5 items-end text-right text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                    {trendAxisTicks.map((tick, i) => (
                      <span
                        key={`y-${tick}-${i}`}
                        className={i === trendAxisTicks.length - 1 ? "" : "translate-y-1"}
                      >
                        {tick}
                      </span>
                    ))}
                  </div>

                  <div className="min-w-0">
                    <div className="relative h-44">
                      {/* Grid lines */}
                      <div className="pointer-events-none absolute inset-0 grid grid-rows-5">
                        {trendAxisTicks.map((_, i) => (
                          <span
                            key={`grid-${i}`}
                            className={cn(
                              "border-t border-slate-300/35 dark:border-slate-700/45",
                              i === trendAxisTicks.length - 1
                                ? "border-b border-slate-300/35 dark:border-slate-700/45"
                                : "",
                            )}
                          />
                        ))}
                      </div>

                      {/* Bars */}
                      <div
                        className="relative h-44 items-end"
                        style={{
                          display: "grid",
                          gridTemplateColumns: `repeat(${numPoints}, minmax(0, 1fr))`,
                          alignItems: "end",
                        }}
                      >
                        {trendPoints.map((point) => {
                          const createdH = (point.created / trendAxisMax) * 100;
                          const updatedH = (point.updated / trendAxisMax) * 100;
                          const total = point.created + point.updated;
                          return (
                            <div
                              key={point.key}
                              tabIndex={0}
                              className="group relative flex h-full items-end justify-center gap-px rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
                            >
                              <KpiTooltip
                                align="center"
                                title={point.key}
                                lines={[
                                  `${point.created} created event${point.created === 1 ? "" : "s"}.`,
                                  `${point.updated} updated event${point.updated === 1 ? "" : "s"}.`,
                                  `${total} total tracked changes.`,
                                ]}
                              />
                              <span
                                className="rounded-t bg-emerald-500/85"
                                style={{
                                  width: "calc(50% - 1px)",
                                  height: `${Math.max(
                                    point.created > 0 ? createdH : 0,
                                    point.created > 0 ? 4 : 0,
                                  )}%`,
                                }}
                              />
                              <span
                                className="rounded-t bg-cyan-500/85"
                                style={{
                                  width: "calc(50% - 1px)",
                                  height: `${Math.max(
                                    point.updated > 0 ? updatedH : 0,
                                    point.updated > 0 ? 4 : 0,
                                  )}%`,
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* X-axis labels */}
                    <div
                      className="mt-1"
                      style={{
                        display: "grid",
                        gridTemplateColumns: `repeat(${numPoints}, minmax(0, 1fr))`,
                      }}
                    >
                      {trendPoints.map((point, i) => (
                        <p
                          key={`lbl-${point.key}`}
                          className={cn(
                            "text-center text-[10px] text-slate-500 dark:text-slate-400",
                            i % labelStep !== 0 ? "invisible" : "",
                          )}
                        >
                          {point.label}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {!loading && !error ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {periodLabel}: {totalCreated} created, {totalUpdated} updated.
              </p>
            ) : null}
          </div>
        )}
      </section>

      {/* Top Contributors */}
      <section className="grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            Top Contributors
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Ranked by instruction update events.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={22} className="animate-spin text-slate-400" />
          </div>
        ) : error ? (
          <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200">
            {error}
          </p>
        ) : contributors.length === 0 ? (
          <p className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
            No update activity recorded for {periodLabel}.
          </p>
        ) : (
          <div className="grid gap-2">
            {contributors.map((entry) => {
              const width = (entry.updates / maxContributorUpdates) * 100;
              const sharePercent = totalUpdated > 0 ? (entry.updates / totalUpdated) * 100 : 0;
              return (
                <article
                  key={entry.userId}
                  className="group relative grid gap-1 rounded-xl border border-slate-300/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50"
                >
                  <KpiTooltip
                    align="right"
                    title={entry.label}
                    lines={[
                      `${entry.updates} update event${entry.updates === 1 ? "" : "s"} in ${periodLabel}.`,
                      `${sharePercent.toFixed(1)}% of all update activity.`,
                      `Ranked among the top ${contributors.length} contributors.`,
                    ]}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <p className="font-semibold text-slate-800 dark:text-slate-100">{entry.label}</p>
                    <p className="text-slate-600 dark:text-slate-300">{entry.updates} updates</p>
                  </div>
                  <div className="h-2 rounded-full bg-slate-300/40 dark:bg-slate-700/50">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                      style={{ width: `${Math.max(width, 2)}%` }}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
