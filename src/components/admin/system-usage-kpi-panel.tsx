"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

interface SystemUsageUserEntry {
  userId: string;
  label: string;
  isActive: boolean;
  totalEvents: number;
  aiEvents: number;
  tokenInput: number;
  tokenOutput: number;
  tokenTotal: number;
  dashboardSearches: number;
  dashboardAiSearches: number;
  dashboardLexicalSearches: number;
  instructionEnhancements: number;
  processMapRecommendations: number;
  processMapBuilderActions: number;
  chartExports: number;
  capabilityAnalyses: number;
  processDocumentCreates: number;
  processDocumentRevisions: number;
  processDocumentImports: number;
  processDocumentTemplates: number;
  lastActivityAt: string | null;
}

interface SystemUsageTotals {
  totalEvents: number;
  aiEvents: number;
  tokenInput: number;
  tokenOutput: number;
  tokenTotal: number;
  dashboardSearches: number;
  processMapRecommendations: number;
  capabilityAnalyses: number;
  processDocumentCreates: number;
  processDocumentImports: number;
  processDocumentTemplates: number;
  chartExports: number;
}

interface SystemUsageKpiResponse {
  totals: SystemUsageTotals;
  users: SystemUsageUserEntry[];
  generatedAt: string;
}

interface DashboardAiSearchSettingResponse {
  enabled: boolean;
  error?: string;
}

interface SystemUsageKpiPanelProps {
  isSystemAdmin: boolean;
}

const MAX_VISIBLE_USER_ROWS = 8;
const USER_TABLE_ROW_HEIGHT_PX = 56;
const USER_TABLE_HEADER_HEIGHT_PX = 44;

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export function SystemUsageKpiPanel({ isSystemAdmin }: SystemUsageKpiPanelProps) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [busy, setBusy] = useState(false);
  const [settingBusy, setSettingBusy] = useState(false);
  const [data, setData] = useState<SystemUsageKpiResponse | null>(null);
  const [dashboardAiSearchEnabled, setDashboardAiSearchEnabled] = useState<boolean | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [settingError, setSettingError] = useState<string | null>(null);

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

  const fetchUsage = useCallback(async () => {



    try {
      const headers = await getAuthHeaders();
      setBusy(true);
      setError(null);
      const response = await fetch("/api/kpis/system-usage", {
        method: "GET",
        headers,
      });
      const payload = (await response.json().catch(() => ({}))) as
        | SystemUsageKpiResponse
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in payload
            ? payload.error ?? "Unable to load system usage KPI data."
            : "Unable to load system usage KPI data.",
        );
      }

      if ("users" in payload) {
        setData(payload);
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to load system usage KPI data.",
      );
    } finally {
      setBusy(false);
    }
  }, [getAuthHeaders]);

  const fetchDashboardAiSearchSetting = useCallback(async () => {
    if (!isSystemAdmin) {
      return;
    }



    try {
      const headers = await getAuthHeaders();
      setSettingError(null);
      const response = await fetch("/api/admin/system-settings/dashboard-ai-search", {
        method: "GET",
        headers,
      });
      const payload = (await response.json().catch(() => ({}))) as DashboardAiSearchSettingResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load Dashboard AI Search setting.");
      }

      setDashboardAiSearchEnabled(payload.enabled);
    } catch (caughtError) {
      setSettingError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to load Dashboard AI Search setting.",
      );
    }
  }, [getAuthHeaders, isSystemAdmin]);

  const updateDashboardAiSearchSetting = useCallback(
    async (enabled: boolean) => {
      if (!isSystemAdmin) {
        return;
      }

      setSettingBusy(true);
      setSettingError(null);

      try {
        const headers = await getAuthHeaders();
        const response = await fetch("/api/admin/system-settings/dashboard-ai-search", {
          method: "PATCH",
          headers,
          body: JSON.stringify({ enabled }),
        });
        const payload = (await response.json().catch(() => ({}))) as DashboardAiSearchSettingResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to update Dashboard AI Search setting.");
        }

        setDashboardAiSearchEnabled(payload.enabled);
      } catch (caughtError) {
        setSettingError(
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to update Dashboard AI Search setting.",
        );
      } finally {
        setSettingBusy(false);
      }
    },
    [getAuthHeaders, isSystemAdmin],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchUsage();
      void fetchDashboardAiSearchSetting();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchDashboardAiSearchSetting, fetchUsage]);

  const shouldLimitUserTableHeight = Boolean(
    data && data.users.length > MAX_VISIBLE_USER_ROWS,
  );
  const userTableMaxHeight = shouldLimitUserTableHeight
    ? USER_TABLE_HEADER_HEIGHT_PX + USER_TABLE_ROW_HEIGHT_PX * MAX_VISIBLE_USER_ROWS
    : undefined;

  const activeUsers = data?.users.filter((entry) => entry.totalEvents > 0).length ?? 0;
  const dashboardAiSearchStatus =
    dashboardAiSearchEnabled === null
      ? "Loading"
      : dashboardAiSearchEnabled
        ? "OpenAI ranking on"
        : "Controlled text fallback";

  return (
    <section className="grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            System Usage and AI Controls
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Per-user usage for AI calls, dashboard search, process maps, Cp/Cpk, controlled
            documents, imports, templates, and chart exports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isSystemAdmin ? (
            <div className="flex items-center gap-3 rounded-xl border border-slate-300/70 bg-white/80 px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-950/70">
              <div className="grid gap-0.5">
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Dashboard AI Search
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Off keeps all-document text ranking active.
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={dashboardAiSearchEnabled === true}
                disabled={settingBusy || dashboardAiSearchEnabled === null}
                onClick={() => {
                  void updateDashboardAiSearchSetting(!dashboardAiSearchEnabled);
                }}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-55",
                  dashboardAiSearchEnabled
                    ? "border-emerald-500/45 bg-emerald-500/15 text-emerald-800 hover:bg-emerald-500/25 dark:text-emerald-200"
                    : "border-slate-300/70 bg-white/80 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200 dark:hover:bg-slate-900",
                )}
              >
                <span
                  className={cn(
                    "h-2.5 w-2.5 rounded-full",
                    dashboardAiSearchEnabled ? "bg-emerald-500" : "bg-slate-400",
                  )}
                />
                {settingBusy ? "Saving..." : dashboardAiSearchStatus}
              </button>
            </div>
          ) : null}

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void fetchUsage();
              void fetchDashboardAiSearchSetting();
            }}
            className="rounded-lg border border-slate-300/70 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100/70 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800/70"
          >
            {busy ? "Working..." : "Reload"}
          </button>
        </div>
      </div>

      {settingError ? (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          {settingError}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-800 dark:text-cyan-100">
                Active Usage Users
              </p>
              <p className="text-xl font-extrabold text-cyan-900 dark:text-cyan-100">
                {formatNumber(activeUsers)}
              </p>
            </div>
            <div className="rounded-xl border border-violet-500/35 bg-violet-500/10 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-100">
                AI Events
              </p>
              <p className="text-xl font-extrabold text-violet-900 dark:text-violet-100">
                {formatNumber(data.totals.aiEvents)}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-100">
                Total Tokens
              </p>
              <p className="text-xl font-extrabold text-emerald-900 dark:text-emerald-100">
                {formatCompact(data.totals.tokenTotal)}
              </p>
            </div>
            <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-100">
                Cp/Cpk Uses
              </p>
              <p className="text-xl font-extrabold text-amber-900 dark:text-amber-100">
                {formatNumber(data.totals.capabilityAnalyses)}
              </p>
            </div>
            <div className="rounded-xl border border-sky-500/35 bg-sky-500/10 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-100">
                Documents/Templates
              </p>
              <p className="text-xl font-extrabold text-sky-900 dark:text-sky-100">
                {formatNumber(
                  data.totals.processDocumentCreates +
                    data.totals.processDocumentTemplates,
                )}
              </p>
            </div>
          </div>

          {data.users.length === 0 ? (
            <p className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              No system usage activity has been recorded yet.
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
                <table className="min-w-[76rem] text-sm">
                  <thead className="bg-slate-900/10 text-left dark:bg-white/10">
                    <tr>
                      <th className="px-3 py-2">User</th>
                      <th className="px-3 py-2">Total Events</th>
                      <th className="px-3 py-2">Tokens</th>
                      <th className="px-3 py-2">Dashboard Search</th>
                      <th className="px-3 py-2">Instruction AI</th>
                      <th className="px-3 py-2">Charts</th>
                      <th className="px-3 py-2">Cp/Cpk</th>
                      <th className="px-3 py-2">Docs</th>
                      <th className="px-3 py-2">Templates</th>
                      <th className="px-3 py-2">Imports</th>
                      <th className="px-3 py-2">Last Activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((entry) => (
                      <tr
                        key={entry.userId}
                        className="border-t border-slate-200/70 dark:border-slate-800"
                      >
                        <td className="px-3 py-2 font-medium">
                          <div className="grid gap-0.5">
                            <span>{entry.label}</span>
                            {!entry.isActive ? (
                              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                Inactive
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2">{formatNumber(entry.totalEvents)}</td>
                        <td className="px-3 py-2">
                          <div className="grid gap-0.5">
                            <span className="font-semibold">
                              {formatCompact(entry.tokenTotal)}
                            </span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              In {formatCompact(entry.tokenInput)} / Out{" "}
                              {formatCompact(entry.tokenOutput)}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="grid gap-0.5">
                            <span>{formatNumber(entry.dashboardSearches)}</span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              AI {formatNumber(entry.dashboardAiSearches)} / Text{" "}
                              {formatNumber(entry.dashboardLexicalSearches)}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {formatNumber(entry.instructionEnhancements)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="grid gap-0.5">
                            <span>
                              {formatNumber(
                                entry.processMapRecommendations +
                                  entry.processMapBuilderActions,
                              )}
                            </span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              Exports {formatNumber(entry.chartExports)}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2">{formatNumber(entry.capabilityAnalyses)}</td>
                        <td className="px-3 py-2">
                          <div className="grid gap-0.5">
                            <span>{formatNumber(entry.processDocumentCreates)}</span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              Revisions {formatNumber(entry.processDocumentRevisions)}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {formatNumber(entry.processDocumentTemplates)}
                        </td>
                        <td className="px-3 py-2">
                          {formatNumber(entry.processDocumentImports)}
                        </td>
                        <td className="px-3 py-2">
                          {entry.lastActivityAt ? (
                            <LocalDateTime value={entry.lastActivityAt} mode="dateTime" />
                          ) : (
                            <span className="text-slate-500 dark:text-slate-400">None</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-xs text-slate-500 dark:text-slate-400">
            Last refreshed <LocalDateTime value={data.generatedAt} mode="dateTime" />. When
            Dashboard AI Search is off, dashboard search still scans work instructions and
            controlled process documents with text ranking.
          </p>
        </>
      ) : (
        <p className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
          {busy ? "Loading system usage KPI data..." : "No system usage KPI data available yet."}
        </p>
      )}
    </section>
  );
}
