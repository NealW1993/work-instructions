import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, Archive, ArrowLeft, BarChart3, FileText, Users } from "lucide-react";

import { KpiInsightsPanel } from "@/components/admin/kpi-insights-panel";
import { requireAuthenticatedUser } from "@/lib/auth";
import { isSystemAdmin } from "@/lib/roles";
import { formatElapsedHhMmSs } from "@/lib/session-timer";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";

interface KpiProfileRow {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  total_signed_in_seconds: number | null;
  active_session_started_at: string | null;
}

interface KpiDepartmentRow {
  id: string;
  name: string;
  sort_order: number;
  color_hex: string;
}

interface KpiWorkItemRow {
  id: string;
  department_id: string;
}

interface KpiInstructionRow {
  id: string;
  work_item_id: string;
  is_archived: boolean;
}

interface KpiInstructionChangeEventRow {
  occurred_at: string;
  event_type: "created" | "updated" | string;
  actor_user_id: string;
}

interface UsageByUser {
  id: string;
  label: string;
  totalSeconds: number;
  activeSession: boolean;
}

interface DepartmentInstructionBreakdown {
  id: string;
  name: string;
  colorHex: string;
  activeCount: number;
  archivedCount: number;
  totalCount: number;
}

interface ActivityDayPoint {
  key: string;
  label: string;
  created: number;
  updated: number;
}

interface ContributorPoint {
  userId: string;
  label: string;
  updates: number;
}

const DEFAULT_DEPARTMENT_COLOR = "#0EA5E9";
const ACTIVITY_TREND_DAYS = 14;

function normalizeDepartmentColor(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : DEFAULT_DEPARTMENT_COLOR;
}

function colorWithAlpha(colorHex: string, alpha: number) {
  const resolvedColor = normalizeDepartmentColor(colorHex);
  const red = Number.parseInt(resolvedColor.slice(1, 3), 16);
  const green = Number.parseInt(resolvedColor.slice(3, 5), 16);
  const blue = Number.parseInt(resolvedColor.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDurationFromSeconds(totalSeconds: number) {
  return formatElapsedHhMmSs(Math.max(0, totalSeconds) * 1000);
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, daysToAdd: number) {
  return new Date(date.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
}

function toUtcDateKey(date: Date) {
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toShortUtcLabel(date: Date) {
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

function maxOf(values: number[]) {
  return values.length > 0 ? Math.max(...values) : 1;
}

function KpiSummaryCard(props: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: "cyan" | "emerald" | "amber" | "violet" | "rose";
}) {
  const toneClasses: Record<typeof props.tone, string> = {
    cyan: "border-cyan-500/40 bg-cyan-500/10 text-cyan-900 dark:text-cyan-100",
    emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
    amber: "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100",
    violet: "border-violet-500/40 bg-violet-500/10 text-violet-900 dark:text-violet-100",
    rose: "border-rose-500/40 bg-rose-500/10 text-rose-900 dark:text-rose-100",
  };

  return (
    <article className={`grid gap-1 rounded-2xl border p-4 ${toneClasses[props.tone]}`}>
      <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide opacity-90">
        {props.icon}
        {props.label}
      </p>
      <p className="text-2xl font-extrabold">{props.value}</p>
    </article>
  );
}

type KpiTooltipTone = "cyan" | "emerald" | "amber" | "violet" | "rose";

function KpiDataTooltip(props: {
  title: string;
  lines: string[];
  tone?: KpiTooltipTone;
  align?: "left" | "center" | "right";
  accentColor?: string;
}) {
  const toneClasses: Record<KpiTooltipTone, string> = {
    cyan: "border-cyan-500/50 bg-slate-950/95 text-cyan-100",
    emerald: "border-emerald-500/50 bg-slate-950/95 text-emerald-100",
    amber: "border-amber-500/50 bg-slate-950/95 text-amber-100",
    violet: "border-violet-500/50 bg-slate-950/95 text-violet-100",
    rose: "border-rose-500/50 bg-slate-950/95 text-rose-100",
  };
  const alignClasses: Record<"left" | "center" | "right", string> = {
    left: "left-0",
    center: "left-1/2 -translate-x-1/2",
    right: "right-0",
  };
  const tone = props.tone ?? "cyan";
  const align = props.align ?? "right";

  return (
    <div
      className={cn(
        "pointer-events-none absolute top-0 z-20 w-64 -translate-y-[108%] rounded-xl border px-3 py-2 text-xs shadow-2xl ring-1 ring-black/45 opacity-0 transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100",
        alignClasses[align],
        props.accentColor ? "border-white/35 bg-slate-950 text-slate-100" : toneClasses[tone],
      )}
      style={
        props.accentColor
          ? {
              borderColor: colorWithAlpha(props.accentColor, 0.7),
              backgroundColor: "rgba(2, 6, 23, 0.98)",
              boxShadow: `0 18px 40px rgba(0, 0, 0, 0.45), inset 3px 0 0 ${colorWithAlpha(
                props.accentColor,
                0.95,
              )}`,
            }
          : undefined
      }
    >
      <p className="font-semibold">{props.title}</p>
      <div className="mt-1 grid gap-0.5">
        {props.lines.map((line, index) => (
          <p key={`${props.title}-${index}`} className="text-[11px] opacity-95">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

export default async function SystemKpisPage() {
  const { profile } = await requireAuthenticatedUser();
  if (!isSystemAdmin(profile.role)) {
    redirect("/dashboard");
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const now = new Date();
  const nowMs = now.getTime();
  const thirtyDaysAgoIso = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: profilesData, error: profilesError },
    { data: departmentsData, error: departmentsError },
    { data: workItemsData, error: workItemsError },
    { data: instructionsData, error: instructionsError },
    { data: changeEventsData, error: changeEventsError },
  ] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select(
        "id, full_name, email, is_active, total_signed_in_seconds, active_session_started_at",
      )
      .order("full_name", { ascending: true })
      .range(0, 4999),
    supabaseAdmin
      .from("departments")
      .select("id, name, sort_order, color_hex")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .range(0, 4999),
    supabaseAdmin.from("work_items").select("id, department_id").range(0, 9999),
    supabaseAdmin
      .from("work_instructions")
      .select("id, work_item_id, is_archived")
      .range(0, 9999),
    supabaseAdmin
      .from("instruction_change_events")
      .select("occurred_at, event_type, actor_user_id")
      .gte("occurred_at", thirtyDaysAgoIso)
      .order("occurred_at", { ascending: false })
      .range(0, 9999),
  ]);

  const profiles = (profilesData ?? []) as KpiProfileRow[];
  const departments = (departmentsData ?? []) as KpiDepartmentRow[];
  const workItems = (workItemsData ?? []) as KpiWorkItemRow[];
  const instructions = (instructionsData ?? []) as KpiInstructionRow[];
  const changeEvents = (changeEventsData ?? []) as KpiInstructionChangeEventRow[];

  const dataErrors = [
    profilesError?.message ?? null,
    departmentsError?.message ?? null,
    workItemsError?.message ?? null,
    instructionsError?.message ?? null,
    changeEventsError?.message ?? null,
  ].filter((message): message is string => Boolean(message));

  const profileNameById = new Map(
    profiles.map((entry) => [entry.id, entry.full_name.trim() || entry.email]),
  );

  const usageByActiveUsers: UsageByUser[] = profiles
    .filter((entry) => entry.is_active)
    .map((entry) => {
      const baseSeconds = Math.max(0, Number(entry.total_signed_in_seconds ?? 0));
      const activeSessionStartMs = toTimestamp(entry.active_session_started_at);
      const activeSessionSeconds =
        activeSessionStartMs !== null
          ? Math.max(0, Math.floor((nowMs - activeSessionStartMs) / 1000))
          : 0;

      return {
        id: entry.id,
        label: entry.full_name.trim() || entry.email,
        totalSeconds: baseSeconds + activeSessionSeconds,
        activeSession: activeSessionStartMs !== null,
      };
    })
    .sort((a, b) => {
      if (b.totalSeconds !== a.totalSeconds) {
        return b.totalSeconds - a.totalSeconds;
      }
      return a.label.localeCompare(b.label);
    });

  const maxUserUsageSeconds = maxOf(usageByActiveUsers.map((entry) => entry.totalSeconds));
  const shouldScrollUsageByUser = usageByActiveUsers.length > 5;
  const totalUsageSecondsAcrossActiveUsers = usageByActiveUsers.reduce(
    (sum, entry) => sum + entry.totalSeconds,
    0,
  );

  const workItemDepartmentById = new Map(workItems.map((entry) => [entry.id, entry.department_id]));
  const instructionCountsByDepartment = new Map<string, { active: number; archived: number }>();
  for (const department of departments) {
    instructionCountsByDepartment.set(department.id, { active: 0, archived: 0 });
  }

  const unknownDepartmentCounts = { active: 0, archived: 0 };

  for (const instruction of instructions) {
    const departmentId = workItemDepartmentById.get(instruction.work_item_id);
    const targetCounts = departmentId
      ? instructionCountsByDepartment.get(departmentId) ?? unknownDepartmentCounts
      : unknownDepartmentCounts;

    if (instruction.is_archived) {
      targetCounts.archived += 1;
    } else {
      targetCounts.active += 1;
    }
  }

  const departmentBreakdown: DepartmentInstructionBreakdown[] = departments
    .map((department) => {
      const counts = instructionCountsByDepartment.get(department.id) ?? { active: 0, archived: 0 };
      return {
        id: department.id,
        name: department.name,
        colorHex: normalizeDepartmentColor(department.color_hex),
        activeCount: counts.active,
        archivedCount: counts.archived,
        totalCount: counts.active + counts.archived,
      };
    })
    .filter((entry) => entry.totalCount > 0)
    .sort((a, b) => {
      if (b.totalCount !== a.totalCount) {
        return b.totalCount - a.totalCount;
      }
      return a.name.localeCompare(b.name);
    });

  if (unknownDepartmentCounts.active + unknownDepartmentCounts.archived > 0) {
    departmentBreakdown.push({
      id: "unknown",
      name: "Unknown Department",
      colorHex: DEFAULT_DEPARTMENT_COLOR,
      activeCount: unknownDepartmentCounts.active,
      archivedCount: unknownDepartmentCounts.archived,
      totalCount: unknownDepartmentCounts.active + unknownDepartmentCounts.archived,
    });
  }

  const maxDepartmentTotal = maxOf(departmentBreakdown.map((entry) => entry.totalCount));

  const todayUtc = startOfUtcDay(now);
  const trendStartUtc = addUtcDays(todayUtc, -(ACTIVITY_TREND_DAYS - 1));
  const trendByDay = new Map<string, ActivityDayPoint>();
  for (let index = 0; index < ACTIVITY_TREND_DAYS; index += 1) {
    const dayDate = addUtcDays(trendStartUtc, index);
    const key = toUtcDateKey(dayDate);
    trendByDay.set(key, {
      key,
      label: toShortUtcLabel(dayDate),
      created: 0,
      updated: 0,
    });
  }

  const contributorCounts = new Map<string, number>();
  let createdLast30Days = 0;
  let updatedLast30Days = 0;
  let updatedLast7Days = 0;
  const sevenDaysAgoUtc = addUtcDays(todayUtc, -6);

  for (const event of changeEvents) {
    const occurredAtMs = toTimestamp(event.occurred_at);
    if (occurredAtMs === null) {
      continue;
    }

    const occurredAt = new Date(occurredAtMs);
    const eventType = event.event_type;

    if (eventType === "created") {
      createdLast30Days += 1;
    }

    if (eventType === "updated") {
      updatedLast30Days += 1;
      contributorCounts.set(
        event.actor_user_id,
        (contributorCounts.get(event.actor_user_id) ?? 0) + 1,
      );

      if (occurredAt >= sevenDaysAgoUtc) {
        updatedLast7Days += 1;
      }
    }

    if (occurredAt < trendStartUtc) {
      continue;
    }

    const dayKey = toUtcDateKey(occurredAt);
    const dayPoint = trendByDay.get(dayKey);
    if (!dayPoint) {
      continue;
    }

    if (eventType === "created") {
      dayPoint.created += 1;
    } else if (eventType === "updated") {
      dayPoint.updated += 1;
    }
  }

  const trendPoints = Array.from(trendByDay.values());
  const maxTrendBarCount = maxOf(
    trendPoints.flatMap((point) => [point.created, point.updated]),
  );
  const trendAxisStep = Math.max(1, Math.ceil(maxTrendBarCount / 4));
  const trendAxisTicks = Array.from({ length: 5 }, (_, index) =>
    trendAxisStep * (4 - index),
  );
  const trendAxisMax = trendAxisTicks[0] ?? 1;

  const topContributors: ContributorPoint[] = Array.from(contributorCounts.entries())
    .map(([userId, updates]) => ({
      userId,
      updates,
      label: profileNameById.get(userId) ?? "Unknown User",
    }))
    .sort((a, b) => {
      if (b.updates !== a.updates) {
        return b.updates - a.updates;
      }
      return a.label.localeCompare(b.label);
    })
    .slice(0, 12);

  const maxContributorUpdates = maxOf(topContributors.map((entry) => entry.updates));
  const activeInstructionCount = instructions.filter((entry) => !entry.is_archived).length;
  const archivedInstructionCount = instructions.filter((entry) => entry.is_archived).length;

  return (
    <section className="grid gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100">
            System KPI&apos;s
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Operations and usage metrics for your work instructions system.
          </p>
        </div>
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300/70 bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-900"
        >
          <ArrowLeft size={16} />
          Back to System Admin
        </Link>
      </header>

      {dataErrors.length > 0 ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          Some KPI datasets could not be loaded. Showing available data.
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiSummaryCard
          label="Active Users"
          value={String(usageByActiveUsers.length)}
          icon={<Users size={14} />}
          tone="cyan"
        />
        <KpiSummaryCard
          label="Active Instructions"
          value={String(activeInstructionCount)}
          icon={<FileText size={14} />}
          tone="emerald"
        />
        <KpiSummaryCard
          label="Archived Instructions"
          value={String(archivedInstructionCount)}
          icon={<Archive size={14} />}
          tone="amber"
        />
        <KpiSummaryCard
          label="Updates (Last 7 Days)"
          value={String(updatedLast7Days)}
          icon={<Activity size={14} />}
          tone="violet"
        />
        <KpiSummaryCard
          label="Total Active User Time"
          value={formatDurationFromSeconds(totalUsageSecondsAcrossActiveUsers)}
          icon={<BarChart3 size={14} />}
          tone="rose"
        />
      </div>

      <KpiInsightsPanel />

      <section className="grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            Active Users: All-Time Usage
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Includes current in-progress session time.
          </p>
        </div>

        {usageByActiveUsers.length === 0 ? (
          <p className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
            No active users found.
          </p>
        ) : (
          <div
            className={
              shouldScrollUsageByUser
                ? "grid max-h-[24rem] gap-2 overflow-y-auto pr-1"
                : "grid gap-2"
            }
          >
            {usageByActiveUsers.map((entry) => {
              const width = (entry.totalSeconds / maxUserUsageSeconds) * 100;
              const usageSharePercent =
                totalUsageSecondsAcrossActiveUsers > 0
                  ? (entry.totalSeconds / totalUsageSecondsAcrossActiveUsers) * 100
                  : 0;

              return (
                <article
                  key={entry.id}
                  className="group relative grid gap-1 rounded-xl border border-slate-300/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50"
                >
                  <KpiDataTooltip
                    tone="cyan"
                    title={entry.label}
                    lines={[
                      `${formatDurationFromSeconds(entry.totalSeconds)} total tracked usage.`,
                      entry.activeSession
                        ? "Active live session is currently running."
                        : "No active live session right now.",
                      `${usageSharePercent.toFixed(1)}% of all active-user usage time.`,
                    ]}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <p className="font-semibold text-slate-800 dark:text-slate-100">{entry.label}</p>
                    <p className="font-mono text-slate-600 dark:text-slate-300">
                      {formatDurationFromSeconds(entry.totalSeconds)}
                      {entry.activeSession ? " (live)" : ""}
                    </p>
                  </div>
                  <div className="h-2 rounded-full bg-slate-300/40 dark:bg-slate-700/50">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
                      style={{ width: `${Math.max(width, 2)}%` }}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-6">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Instruction Load by Department
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Active vs archived instruction volume.
            </p>
          </div>

          {departmentBreakdown.length === 0 ? (
            <p className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              No instruction data available.
            </p>
          ) : (
            <div className="grid gap-2">
              {departmentBreakdown.map((entry) => {
                const width = (entry.totalCount / maxDepartmentTotal) * 100;
                const activeWidth = entry.totalCount > 0 ? (entry.activeCount / entry.totalCount) * 100 : 0;
                const archivedWidth = Math.max(0, 100 - activeWidth);
                const departmentSharePercent =
                  activeInstructionCount + archivedInstructionCount > 0
                    ? (entry.totalCount / (activeInstructionCount + archivedInstructionCount)) * 100
                    : 0;

                return (
                  <article
                    key={entry.id}
                    className="group relative grid gap-1.5 rounded-xl border border-slate-300/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50"
                  >
                    <KpiDataTooltip
                      align="left"
                      accentColor={entry.colorHex}
                      title={entry.name}
                      lines={[
                        `${entry.totalCount} total instructions in this department.`,
                        `${entry.activeCount} active, ${entry.archivedCount} archived.`,
                        `${departmentSharePercent.toFixed(1)}% of all instruction volume.`,
                      ]}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <p className="font-semibold text-slate-800 dark:text-slate-100">{entry.name}</p>
                      <p className="text-slate-600 dark:text-slate-300">
                        {entry.activeCount} active / {entry.archivedCount} archived
                      </p>
                    </div>
                    <div className="h-3 rounded-full bg-slate-300/35 dark:bg-slate-700/45">
                      <div
                        className="flex h-3 overflow-hidden rounded-full"
                        style={{ width: `${Math.max(width, 2)}%` }}
                      >
                        <span
                          className="h-3"
                          style={{
                            width: `${activeWidth}%`,
                            backgroundColor: colorWithAlpha(entry.colorHex, 0.9),
                          }}
                        />
                        <span
                          className="h-3 bg-slate-500/60"
                          style={{ width: `${archivedWidth}%` }}
                        />
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-6">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Activity Trend (Last 14 Days)
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Created and updated events.
            </p>
          </div>

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
              <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2">
                <div className="grid h-44 grid-rows-5 items-end text-right text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                  {trendAxisTicks.map((tickValue, index) => (
                    <span
                      key={`trend-axis-${tickValue}-${index}`}
                      className={index === trendAxisTicks.length - 1 ? "" : "translate-y-1"}
                    >
                      {tickValue}
                    </span>
                  ))}
                </div>

                <div className="min-w-0">
                  <div className="relative h-44">
                    <div className="pointer-events-none absolute inset-0 grid grid-rows-5">
                      {trendAxisTicks.map((_, index) => (
                        <span
                          key={`trend-grid-line-${index}`}
                          className={cn(
                            "border-t border-slate-300/35 dark:border-slate-700/45",
                            index === trendAxisTicks.length - 1
                              ? "border-b border-slate-300/35 dark:border-slate-700/45"
                              : "",
                          )}
                        />
                      ))}
                    </div>

                    <div className="relative grid h-44 grid-cols-14 items-end gap-1">
                      {trendPoints.map((point) => {
                        const createdHeight = (point.created / trendAxisMax) * 100;
                        const updatedHeight = (point.updated / trendAxisMax) * 100;
                        const totalEvents = point.created + point.updated;
                        const trendTooltipTone: KpiTooltipTone =
                          totalEvents === 0
                            ? "violet"
                            : point.updated >= point.created
                              ? "cyan"
                              : "emerald";

                        return (
                          <div
                            key={point.key}
                            tabIndex={0}
                            className="group relative flex h-full items-end justify-center gap-1 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
                          >
                            <KpiDataTooltip
                              align="center"
                              tone={trendTooltipTone}
                              title={`Activity on ${point.key}`}
                              lines={[
                                `${point.created} created event${point.created === 1 ? "" : "s"}.`,
                                `${point.updated} updated event${point.updated === 1 ? "" : "s"}.`,
                                `${totalEvents} total tracked changes.`,
                              ]}
                            />
                            <span
                              className="w-2 rounded-t bg-emerald-500/85"
                              style={{
                                height: `${Math.max(point.created > 0 ? createdHeight : 0, point.created > 0 ? 6 : 0)}%`,
                              }}
                              title={`${point.label}: ${point.created} created`}
                            />
                            <span
                              className="w-2 rounded-t bg-cyan-500/85"
                              style={{
                                height: `${Math.max(point.updated > 0 ? updatedHeight : 0, point.updated > 0 ? 6 : 0)}%`,
                              }}
                              title={`${point.label}: ${point.updated} updated`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-1 grid grid-cols-14 gap-1">
                    {trendPoints.map((point) => (
                      <p
                        key={`trend-label-${point.key}`}
                        className="text-center text-[10px] text-slate-500 dark:text-slate-400"
                      >
                        {point.label}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Last 30 days: {createdLast30Days} created, {updatedLast30Days} updated.
            </p>
          </div>
        </section>
      </div>

      <section className="grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            Top Contributors (Last 30 Days)
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Ranked by instruction update events.
          </p>
        </div>

        {topContributors.length === 0 ? (
          <p className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
            No recent update activity recorded.
          </p>
        ) : (
          <div className="grid gap-2">
            {topContributors.map((entry) => {
              const width = (entry.updates / maxContributorUpdates) * 100;
              const contributionSharePercent =
                updatedLast30Days > 0 ? (entry.updates / updatedLast30Days) * 100 : 0;

              return (
                <article
                  key={entry.userId}
                  className="group relative grid gap-1 rounded-xl border border-slate-300/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50"
                >
                  <KpiDataTooltip
                    tone="violet"
                    title={entry.label}
                    lines={[
                      `${entry.updates} update event${entry.updates === 1 ? "" : "s"} in the last 30 days.`,
                      `${contributionSharePercent.toFixed(1)}% of all update activity.`,
                      `Ranked among the top ${topContributors.length} contributors.`,
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
    </section>
  );
}
