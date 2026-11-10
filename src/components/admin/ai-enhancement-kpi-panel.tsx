"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

interface AiEnhancementUserKpiEntry {
  userId: string;
  label: string;
  totalGenerations: number;
  appliedGenerations: number;
  unusedGenerations: number;
}

interface ModeBreakdown {
  create: number;
  edit: number;
  fork: number;
}

interface AiEnhancementKpiResponse {
  totalGenerations: number;
  totalAppliedGenerations: number;
  totalUnusedGenerations: number;
  totalGenerationsByMode: ModeBreakdown;
  appliedGenerationsByMode: ModeBreakdown;
  unusedGenerationsByMode: ModeBreakdown;
  users: AiEnhancementUserKpiEntry[];
  generatedAt: string;
}

type InsightCardKey = "total" | "applied" | "unused";

const MAX_VISIBLE_USER_ROWS = 5;
const USER_TABLE_ROW_HEIGHT_PX = 46;
const USER_TABLE_HEADER_HEIGHT_PX = 40;

const MODE_BREAKDOWN_LABELS: Array<{
  key: keyof ModeBreakdown;
  label: string;
}> = [
  { key: "create", label: "New instructions" },
  { key: "edit", label: "Updated instructions" },
  { key: "fork", label: "Forked instructions" },
];

function formatPercent(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return "0.0%";
  }

  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export function AiEnhancementKpiPanel() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<AiEnhancementKpiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedInsight, setSelectedInsight] = useState<InsightCardKey>("total");

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

  const fetchAiEnhancementKpis = useCallback(async () => {



    try {
      const headers = await getAuthHeaders();
      setBusy(true);
      setError(null);
      const response = await fetch("/api/kpis/ai-enhancement", {
        method: "GET",
        headers,
      });

      const payload = (await response.json().catch(() => ({}))) as
        | AiEnhancementKpiResponse
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in payload
            ? payload.error ?? "Unable to load AI enhancement KPI data."
            : "Unable to load AI enhancement KPI data.",
        );
      }

      if ("users" in payload) {
        setData(payload);
      }
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to load AI enhancement KPI data.";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchAiEnhancementKpis(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchAiEnhancementKpis]);

  const shouldLimitUserTableHeight = Boolean(
    data && data.users.length > MAX_VISIBLE_USER_ROWS,
  );

  const userTableMaxHeight = shouldLimitUserTableHeight
    ? USER_TABLE_HEADER_HEIGHT_PX + USER_TABLE_ROW_HEIGHT_PX * MAX_VISIBLE_USER_ROWS
    : undefined;

  const topUsersByShare = useMemo(() => {
    if (!data || data.totalGenerations <= 0) {
      return [] as Array<{
        userId: string;
        label: string;
        totalGenerations: number;
        share: string;
      }>;
    }

    return data.users
      .filter((entry) => entry.totalGenerations > 0)
      .slice(0, 5)
      .map((entry) => ({
        userId: entry.userId,
        label: entry.label,
        totalGenerations: entry.totalGenerations,
        share: formatPercent(entry.totalGenerations, data.totalGenerations),
      }));
  }, [data]);

  return (
    <section className="grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
          AI Enhancement KPI
        </h2>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void fetchAiEnhancementKpis();
          }}
          className="rounded-lg border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100/70 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800/70"
        >
          {busy ? "Working..." : "Reload"}
        </button>
      </div>

      <p className="text-sm text-slate-600 dark:text-slate-300">
        Tracks AI generations and highlights what was applied or unused.
      </p>

      {error ? (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <button
              type="button"
              onClick={() => setSelectedInsight("total")}
              className={`rounded-xl border p-3 text-left transition ${
                selectedInsight === "total"
                  ? "border-cyan-500/65 bg-cyan-500/20 ring-2 ring-cyan-500/35"
                  : "border-cyan-500/35 bg-cyan-500/10 hover:bg-cyan-500/15"
              }`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-800 dark:text-cyan-100">
                Total AI Generations
              </p>
              <p className="text-xl font-extrabold text-cyan-900 dark:text-cyan-100">
                {data.totalGenerations}
              </p>
            </button>
            <button
              type="button"
              onClick={() => setSelectedInsight("applied")}
              className={`rounded-xl border p-3 text-left transition ${
                selectedInsight === "applied"
                  ? "border-emerald-500/65 bg-emerald-500/20 ring-2 ring-emerald-500/35"
                  : "border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/15"
              }`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-100">
                Applied AI Generations
              </p>
              <p className="text-xl font-extrabold text-emerald-900 dark:text-emerald-100">
                {data.totalAppliedGenerations}
              </p>
            </button>
            <button
              type="button"
              onClick={() => setSelectedInsight("unused")}
              className={`rounded-xl border p-3 text-left transition ${
                selectedInsight === "unused"
                  ? "border-amber-500/65 bg-amber-500/20 ring-2 ring-amber-500/35"
                  : "border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/15"
              }`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-100">
                Unused AI Generations
              </p>
              <p className="text-xl font-extrabold text-amber-900 dark:text-amber-100">
                {data.totalUnusedGenerations}
              </p>
            </button>
          </div>

          <div className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/50">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              {selectedInsight === "total"
                ? "Total Insight"
                : selectedInsight === "applied"
                  ? "Applied Insight"
                  : "Unused Insight"}
            </p>

            {selectedInsight === "total" ? (
              <div className="mt-2 grid gap-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-200/70 bg-white/70 p-2 dark:border-slate-700 dark:bg-slate-950/35">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Applied Rate
                    </p>
                    <p className="text-base font-bold text-slate-800 dark:text-slate-100">
                      {formatPercent(data.totalAppliedGenerations, data.totalGenerations)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200/70 bg-white/70 p-2 dark:border-slate-700 dark:bg-slate-950/35">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Unused Rate
                    </p>
                    <p className="text-base font-bold text-slate-800 dark:text-slate-100">
                      {formatPercent(data.totalUnusedGenerations, data.totalGenerations)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200/70 bg-white/70 p-2 dark:border-slate-700 dark:bg-slate-950/35">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Active AI Users
                    </p>
                    <p className="text-base font-bold text-slate-800 dark:text-slate-100">
                      {data.users.filter((entry) => entry.totalGenerations > 0).length}
                    </p>
                  </div>
                </div>

                {topUsersByShare.length > 0 ? (
                  <div className="grid gap-1">
                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      Top users by total generation share
                    </p>
                    <div className="grid gap-1">
                      {topUsersByShare.map((entry) => (
                        <div
                          key={entry.userId}
                          className="flex items-center justify-between rounded-md border border-slate-200/70 bg-white/65 px-2 py-1 dark:border-slate-700 dark:bg-slate-950/35"
                        >
                          <span className="truncate pr-3 text-slate-700 dark:text-slate-200">
                            {entry.label}
                          </span>
                          <span className="whitespace-nowrap font-semibold text-slate-800 dark:text-slate-100">
                            {entry.totalGenerations} ({entry.share})
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    No user activity has been recorded yet.
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {MODE_BREAKDOWN_LABELS.map((mode) => {
                  const sourceBreakdown =
                    selectedInsight === "applied"
                      ? data.appliedGenerationsByMode
                      : data.unusedGenerationsByMode;
                  const totalForInsight =
                    selectedInsight === "applied"
                      ? data.totalAppliedGenerations
                      : data.totalUnusedGenerations;
                  const modeCount = sourceBreakdown[mode.key];

                  return (
                    <div
                      key={mode.key}
                      className="rounded-lg border border-slate-200/70 bg-white/70 p-2 dark:border-slate-700 dark:bg-slate-950/35"
                    >
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {mode.label}
                      </p>
                      <p className="text-base font-bold text-slate-800 dark:text-slate-100">
                        {modeCount}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {formatPercent(modeCount, totalForInsight)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            Last refreshed <LocalDateTime value={data.generatedAt} mode="dateTime" />.
          </p>

          {data.users.length === 0 ? (
            <p className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              No AI enhancement activity recorded yet.
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-300/70 dark:border-slate-700">
              <div
                className="overflow-auto"
                style={
                  userTableMaxHeight
                    ? {
                        maxHeight: `${userTableMaxHeight}px`,
                      }
                    : undefined
                }
              >
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-900/10 text-left dark:bg-white/10">
                    <tr>
                      <th className="px-3 py-2">User</th>
                      <th className="px-3 py-2">Total AI Generations</th>
                      <th className="px-3 py-2">Applied AI Generations</th>
                      <th className="px-3 py-2">Unused AI Generations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((entry) => (
                      <tr
                        key={entry.userId}
                        className="border-t border-slate-200/70 dark:border-slate-800"
                      >
                        <td className="px-3 py-2 font-medium">{entry.label}</td>
                        <td className="px-3 py-2">{entry.totalGenerations}</td>
                        <td className="px-3 py-2">{entry.appliedGenerations}</td>
                        <td className="px-3 py-2">{entry.unusedGenerations}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {shouldLimitUserTableHeight ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Showing 5 users at a time. Scroll for more.
            </p>
          ) : null}
        </>
      ) : (
        <p className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
          {busy ? "Loading AI enhancement KPI data..." : "No AI KPI data available yet."}
        </p>
      )}
    </section>
  );
}
