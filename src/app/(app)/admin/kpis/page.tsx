import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AiEnhancementKpiPanel } from "@/components/admin/ai-enhancement-kpi-panel";
import { ForkMergeKpiPanel } from "@/components/admin/fork-merge-kpi-panel";
import { KpiActivitySection } from "@/components/admin/kpi-activity-section";
import { KpiInsightsPanel } from "@/components/admin/kpi-insights-panel";
import { KpiSummaryCards, type KpiSummaryCardConfig } from "@/components/admin/kpi-summary-cards";
import { ReviewCoverageKpiPanel } from "@/components/admin/review-coverage-kpi-panel";
import { requireAuthenticatedUser } from "@/lib/auth";
import { canViewKpis, isSystemAdmin } from "@/lib/roles";
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

const DEFAULT_DEPARTMENT_COLOR = "#0EA5E9";

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

function startOfSystemDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addSystemDays(date: Date, daysToAdd: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + daysToAdd);
  return next;
}

function formatSystemDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}


function maxOf(values: number[]) {
  return values.length > 0 ? Math.max(...values) : 1;
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
  if (!canViewKpis(profile.role)) {
    redirect("/dashboard");
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const now = new Date();
  const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "system timezone";
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

  const profileLabelById = new Map(
    profiles.map((entry) => [entry.id, entry.full_name.trim() || entry.email]),
  );
  const todaySystem = startOfSystemDay(now);
  const tomorrowSystem = addSystemDays(todaySystem, 1);
  const sevenDaysAgoSystem = addSystemDays(todaySystem, -6);
  let updatedLast7Days = 0;
  const recentUpdateContributors = new Set<string>();

  for (const event of changeEvents) {
    if (event.event_type !== "updated") continue;
    const occurredAtMs = toTimestamp(event.occurred_at);
    if (occurredAtMs === null) continue;
    const occurredAt = new Date(occurredAtMs);
    if (occurredAt >= sevenDaysAgoSystem && occurredAt < tomorrowSystem) {
      updatedLast7Days += 1;
      recentUpdateContributors.add(
        profileLabelById.get(event.actor_user_id) ?? "Unknown User",
      );
    }
  }
  const recentUpdateContributorNames = [...recentUpdateContributors].sort((a, b) =>
    a.localeCompare(b),
  );
  const activeInstructionCount = instructions.filter((entry) => !entry.is_archived).length;
  const archivedInstructionCount = instructions.filter((entry) => entry.is_archived).length;
  const totalInstructionCount = activeInstructionCount + archivedInstructionCount;
  const activeUsersWithLiveSession = usageByActiveUsers.filter((entry) => entry.activeSession).length;
  const averageUsagePerActiveUserSeconds =
    usageByActiveUsers.length > 0
      ? Math.round(totalUsageSecondsAcrossActiveUsers / usageByActiveUsers.length)
      : 0;
  const summaryCards: KpiSummaryCardConfig[] = [
    {
      id: "active-users",
      label: "Active Users",
      value: String(usageByActiveUsers.length),
      tone: "cyan",
      details: [
        `${usageByActiveUsers.length} active user profile${
          usageByActiveUsers.length === 1 ? "" : "s"
        } currently included in KPI tracking.`,
        `${activeUsersWithLiveSession} active user session${
          activeUsersWithLiveSession === 1 ? "" : "s"
        } currently running live.`,
        `${formatDurationFromSeconds(totalUsageSecondsAcrossActiveUsers)} total tracked active-user time.`,
      ],
    },
    {
      id: "active-instructions",
      label: "Active Instructions",
      value: String(activeInstructionCount),
      tone: "emerald",
      details: [
        `${activeInstructionCount} instruction${activeInstructionCount === 1 ? "" : "s"} currently visible in active workflows.`,
        `${archivedInstructionCount} instruction${archivedInstructionCount === 1 ? "" : "s"} currently archived.`,
        `${totalInstructionCount} total instruction${totalInstructionCount === 1 ? "" : "s"} across the system.`,
      ],
    },
    {
      id: "archived-instructions",
      label: "Archived Instructions",
      value: String(archivedInstructionCount),
      tone: "amber",
      details: [
        `${archivedInstructionCount} archived instruction${archivedInstructionCount === 1 ? "" : "s"} retained for history.`,
        `${activeInstructionCount} active instruction${activeInstructionCount === 1 ? "" : "s"} still available for daily use.`,
        `${totalInstructionCount} total instruction${totalInstructionCount === 1 ? "" : "s"} in all statuses.`,
      ],
    },
    {
      id: "updates-last-7-days",
      label: "Updates (Last 7 Days)",
      value: String(updatedLast7Days),
      tone: "violet",
      details: [
        `${updatedLast7Days} update event${updatedLast7Days === 1 ? "" : "s"} recorded in the trailing 7-day ${systemTimeZone} window.`,
        `Window start: ${formatSystemDate(sevenDaysAgoSystem)} ${systemTimeZone}.`,
        `Window end: ${formatSystemDate(todaySystem)} ${systemTimeZone}.`,
        recentUpdateContributorNames.length > 0
          ? `Contributors: ${recentUpdateContributorNames.join(", ")}.`
          : "Contributors: none recorded in this window.",
      ],
    },
    {
      id: "total-active-user-time",
      label: "Total Active User Time",
      value: formatDurationFromSeconds(totalUsageSecondsAcrossActiveUsers),
      tone: "rose",
      details: [
        `${formatDurationFromSeconds(totalUsageSecondsAcrossActiveUsers)} total active-user time from all tracked sessions.`,
        `${formatDurationFromSeconds(averageUsagePerActiveUserSeconds)} average tracked time per active user.`,
        `${usageByActiveUsers.length} active user profile${
          usageByActiveUsers.length === 1 ? "" : "s"
        } included in the aggregate.`,
      ],
    },
  ];

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
        {isSystemAdmin(profile.role) ? (
          <Link
            href="/admin/users"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300/70 bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            <ArrowLeft size={16} />
            Back to System Admin
          </Link>
        ) : null}
      </header>

      {dataErrors.length > 0 ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          Some KPI datasets could not be loaded. Showing available data.
        </div>
      ) : null}

      <KpiSummaryCards cards={summaryCards} />

      <KpiInsightsPanel />
      <ReviewCoverageKpiPanel />
      <AiEnhancementKpiPanel />
      <ForkMergeKpiPanel />

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

        <KpiActivitySection />
    </section>
  );
}
