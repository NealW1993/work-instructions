import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { canViewKpis } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type ForkMergePeriod = "day" | "week" | "month" | "year";
type MergeMode = "selective" | "overwrite";

interface ForkInstructionRow {
  fork_root_instruction_id: string | null;
  fork_number: number | null;
  created_at: string;
  merged_into_root_at: string | null;
}

interface ForkMergeChangeEventRow {
  id: string;
  actor_user_id: string;
  occurred_at: string;
  source_payload: unknown;
}

interface ProfileRow {
  id: string;
  full_name: string;
  email: string;
}

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

const MONTH_SHORT = [
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
];

const MONTH_FULL = [
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
];

const MAX_FORK_ROWS = 100_000;
const MAX_EVENT_ROWS = 50_000;

function normalizePeriod(value: string | null): ForkMergePeriod {
  if (value === "day" || value === "week" || value === "month" || value === "year") {
    return value;
  }

  return "week";
}

function normalizeYear(value: string | null, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
    return fallback;
  }

  return parsed;
}

function normalizeMonth(value: string | null, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
    return fallback;
  }

  return parsed;
}

function normalizeDay(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function normalizeWeekStart(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return getMondayOf(parsed);
}

function getMondayOf(date: Date) {
  const utcDay = date.getUTCDay();
  const mondayOffset = (utcDay + 6) % 7;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - mondayOffset),
  );
}

function toDateKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;
}

function toMonthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function toHourKey(date: Date) {
  return `${toDateKey(date)}T${String(date.getUTCHours()).padStart(2, "0")}`;
}

function formatHourLabel(hour: number) {
  if (hour === 0) return "12am";
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return "12pm";
  return `${hour - 12}pm`;
}

interface ActivityRange {
  startAt: Date;
  endAt: Date;
  label: string;
  prevParams: string;
  nextParams: string;
  buildPoints(): TrendPoint[];
  getEventKey(occurredAt: Date): string;
}

function buildRange(
  period: ForkMergePeriod,
  year: number,
  month: number,
  day: Date | null,
  weekStart: Date | null,
  now: Date,
): ActivityRange {
  if (period === "day") {
    const dayStart =
      day ??
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const prevDay = new Date(dayStart.getTime() - 24 * 60 * 60 * 1000);
    const dayKey = toDateKey(dayStart);
    const label = `${MONTH_FULL[dayStart.getUTCMonth()]} ${dayStart.getUTCDate()}, ${dayStart.getUTCFullYear()}`;

    return {
      startAt: dayStart,
      endAt: dayEnd,
      label,
      prevParams: `period=day&day=${toDateKey(prevDay)}`,
      nextParams: `period=day&day=${toDateKey(dayEnd)}`,
      buildPoints() {
        return Array.from({ length: 24 }, (_, hourIndex) => ({
          key: `${dayKey}T${String(hourIndex).padStart(2, "0")}`,
          label: formatHourLabel(hourIndex),
          forksCreated: 0,
          merges: 0,
          selectiveMerges: 0,
          overwriteMerges: 0,
        }));
      },
      getEventKey(occurredAt) {
        return toHourKey(occurredAt);
      },
    };
  }

  if (period === "week") {
    const weekStartDate = weekStart ?? getMondayOf(now);
    const weekEndDate = new Date(weekStartDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    const previousWeekStart = new Date(weekStartDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekLastDay = new Date(weekEndDate.getTime() - 24 * 60 * 60 * 1000);
    const label = `${MONTH_SHORT[weekStartDate.getUTCMonth()]} ${weekStartDate.getUTCDate()} - ${MONTH_SHORT[weekLastDay.getUTCMonth()]} ${weekLastDay.getUTCDate()}, ${weekLastDay.getUTCFullYear()}`;

    return {
      startAt: weekStartDate,
      endAt: weekEndDate,
      label,
      prevParams: `period=week&weekStart=${toDateKey(previousWeekStart)}`,
      nextParams: `period=week&weekStart=${toDateKey(weekEndDate)}`,
      buildPoints() {
        return Array.from({ length: 7 }, (_, dayIndex) => {
          const currentDay = new Date(weekStartDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
          return {
            key: toDateKey(currentDay),
            label: `${currentDay.getUTCMonth() + 1}/${currentDay.getUTCDate()}`,
            forksCreated: 0,
            merges: 0,
            selectiveMerges: 0,
            overwriteMerges: 0,
          };
        });
      },
      getEventKey(occurredAt) {
        return toDateKey(occurredAt);
      },
    };
  }

  if (period === "month") {
    const monthIndex = month - 1;
    const monthStart = new Date(Date.UTC(year, monthIndex, 1));
    const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 1));
    const daysInMonth = Math.round(
      (monthEnd.getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000),
    );
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;

    return {
      startAt: monthStart,
      endAt: monthEnd,
      label: `${MONTH_FULL[monthIndex]} ${year}`,
      prevParams: `period=month&year=${prevYear}&month=${prevMonth}`,
      nextParams: `period=month&year=${nextYear}&month=${nextMonth}`,
      buildPoints() {
        return Array.from({ length: daysInMonth }, (_, dayIndex) => {
          const currentDay = new Date(monthStart.getTime() + dayIndex * 24 * 60 * 60 * 1000);
          return {
            key: toDateKey(currentDay),
            label: `${currentDay.getUTCMonth() + 1}/${currentDay.getUTCDate()}`,
            forksCreated: 0,
            merges: 0,
            selectiveMerges: 0,
            overwriteMerges: 0,
          };
        });
      },
      getEventKey(occurredAt) {
        return toDateKey(occurredAt);
      },
    };
  }

  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
  return {
    startAt: yearStart,
    endAt: yearEnd,
    label: String(year),
    prevParams: `period=year&year=${year - 1}`,
    nextParams: `period=year&year=${year + 1}`,
    buildPoints() {
      return MONTH_SHORT.map((monthLabel, monthIndex) => ({
        key: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
        label: monthLabel,
        forksCreated: 0,
        merges: 0,
        selectiveMerges: 0,
        overwriteMerges: 0,
      }));
    },
    getEventKey(occurredAt) {
      return toMonthKey(occurredAt);
    },
  };
}

function parseMergeMode(value: unknown): MergeMode {
  return value === "overwrite" ? "overwrite" : "selective";
}

function readEventKind(
  sourcePayload: unknown,
): "fork_created" | "fork_merge" | null {
  if (!sourcePayload || typeof sourcePayload !== "object" || Array.isArray(sourcePayload)) {
    return null;
  }

  const candidate = sourcePayload as Record<string, unknown>;
  if (candidate.kind === "fork_created") {
    return "fork_created";
  }
  if (candidate.kind === "fork_merge") {
    return "fork_merge";
  }
  return null;
}

export async function GET(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!canViewKpis(requester.role)) {
    return NextResponse.json({ error: "Admin privileges required." }, { status: 403 });
  }

  const now = new Date();
  const searchParams = request.nextUrl.searchParams;
  const period = normalizePeriod(searchParams.get("period"));
  const year = normalizeYear(searchParams.get("year"), now.getUTCFullYear());
  const month = normalizeMonth(searchParams.get("month"), now.getUTCMonth() + 1);
  const day = normalizeDay(searchParams.get("day"));
  const weekStart = normalizeWeekStart(searchParams.get("weekStart"));
  const range = buildRange(period, year, month, day, weekStart, now);

  const supabaseAdmin = getSupabaseAdminClient();
  const [
    { data: forkRowsData, error: forkRowsError },
    { data: eventRowsData, error: eventRowsError },
    { data: profileRowsData, error: profileRowsError },
  ] = await Promise.all([
    supabaseAdmin
      .from("work_instructions")
      .select("fork_root_instruction_id, fork_number, created_at, merged_into_root_at")
      .not("fork_root_instruction_id", "is", null)
      .order("created_at", { ascending: true })
      .range(0, MAX_FORK_ROWS - 1),
    supabaseAdmin
      .from("instruction_change_events")
      .select("id, actor_user_id, occurred_at, source_payload")
      .gte("occurred_at", range.startAt.toISOString())
      .lt("occurred_at", range.endAt.toISOString())
      .order("occurred_at", { ascending: true })
      .range(0, MAX_EVENT_ROWS - 1),
    supabaseAdmin.from("profiles").select("id, full_name, email").range(0, 4999),
  ]);

  if (forkRowsError) {
    return NextResponse.json({ error: forkRowsError.message }, { status: 500 });
  }
  if (eventRowsError) {
    return NextResponse.json({ error: eventRowsError.message }, { status: 500 });
  }
  if (profileRowsError) {
    return NextResponse.json({ error: profileRowsError.message }, { status: 500 });
  }

  const forkRows = (forkRowsData ?? []) as ForkInstructionRow[];
  const eventRows = (eventRowsData ?? []) as ForkMergeChangeEventRow[];
  const profiles = (profileRowsData ?? []) as ProfileRow[];
  const profileNameById = new Map(
    profiles.map((profile) => [profile.id, profile.full_name.trim() || profile.email]),
  );

  const branchByKey = new Map<
    string,
    {
      firstCreatedAt: string;
      mergedAt: string | null;
    }
  >();
  for (const forkRow of forkRows) {
    const rootInstructionId = forkRow.fork_root_instruction_id;
    const forkNumber =
      Number.isInteger(forkRow.fork_number) && Number(forkRow.fork_number) > 0
        ? Number(forkRow.fork_number)
        : null;
    if (!rootInstructionId || !forkNumber) {
      continue;
    }

    const branchKey = `${rootInstructionId}:${forkNumber}`;
    const existingBranch = branchByKey.get(branchKey);
    if (!existingBranch) {
      branchByKey.set(branchKey, {
        firstCreatedAt: forkRow.created_at,
        mergedAt: forkRow.merged_into_root_at ?? null,
      });
      continue;
    }

    if (
      new Date(forkRow.created_at).getTime() <
      new Date(existingBranch.firstCreatedAt).getTime()
    ) {
      existingBranch.firstCreatedAt = forkRow.created_at;
    }

    if (forkRow.merged_into_root_at) {
      if (
        !existingBranch.mergedAt ||
        new Date(forkRow.merged_into_root_at).getTime() >
          new Date(existingBranch.mergedAt).getTime()
      ) {
        existingBranch.mergedAt = forkRow.merged_into_root_at;
      }
    }
  }

  const totalForkBranches = branchByKey.size;
  const mergedForkBranches = Array.from(branchByKey.values()).filter(
    (branch) => branch.mergedAt,
  ).length;
  const openForkBranches = Math.max(0, totalForkBranches - mergedForkBranches);
  const mergeRatePercent =
    totalForkBranches > 0 ? (mergedForkBranches / totalForkBranches) * 100 : 0;

  const trendPoints = range.buildPoints();
  const trendPointByKey = new Map(trendPoints.map((entry) => [entry.key, entry]));
  const contributorByUserId = new Map<
    string,
    {
      userId: string;
      label: string;
      merges: number;
      selectiveMerges: number;
      overwriteMerges: number;
    }
  >();
  let totalForksCreatedInPeriod = 0;
  let totalMergesInPeriod = 0;
  let totalSelectiveMergesInPeriod = 0;
  let totalOverwriteMergesInPeriod = 0;

  for (const eventRow of eventRows) {
    const kind = readEventKind(eventRow.source_payload);
    if (!kind) {
      continue;
    }

    const occurredAtMs = new Date(eventRow.occurred_at).getTime();
    if (Number.isNaN(occurredAtMs)) {
      continue;
    }

    const occurredAt = new Date(occurredAtMs);
    const pointKey = range.getEventKey(occurredAt);
    const point = trendPointByKey.get(pointKey);
    if (!point) {
      continue;
    }

    if (kind === "fork_created") {
      point.forksCreated += 1;
      totalForksCreatedInPeriod += 1;
      continue;
    }

    point.merges += 1;
    totalMergesInPeriod += 1;

    const payload = eventRow.source_payload as Record<string, unknown>;
    const mergeMode = parseMergeMode(payload.mode);
    if (mergeMode === "overwrite") {
      point.overwriteMerges += 1;
      totalOverwriteMergesInPeriod += 1;
    } else {
      point.selectiveMerges += 1;
      totalSelectiveMergesInPeriod += 1;
    }

    const existingContributor = contributorByUserId.get(eventRow.actor_user_id) ?? {
      userId: eventRow.actor_user_id,
      label: profileNameById.get(eventRow.actor_user_id) ?? "Unknown User",
      merges: 0,
      selectiveMerges: 0,
      overwriteMerges: 0,
    };
    existingContributor.merges += 1;
    if (mergeMode === "overwrite") {
      existingContributor.overwriteMerges += 1;
    } else {
      existingContributor.selectiveMerges += 1;
    }
    contributorByUserId.set(eventRow.actor_user_id, existingContributor);
  }

  const contributors: ContributorEntry[] = Array.from(contributorByUserId.values())
    .sort((first, second) => {
      if (second.merges !== first.merges) {
        return second.merges - first.merges;
      }
      if (second.overwriteMerges !== first.overwriteMerges) {
        return second.overwriteMerges - first.overwriteMerges;
      }
      return first.label.localeCompare(second.label);
    })
    .slice(0, 12);

  const response: ForkMergeKpiResponse = {
    period,
    periodLabel: range.label,
    trendPoints,
    contributors,
    totalForkBranches,
    mergedForkBranches,
    openForkBranches,
    totalForksCreatedInPeriod,
    totalMergesInPeriod,
    totalSelectiveMergesInPeriod,
    totalOverwriteMergesInPeriod,
    mergeRatePercent,
    prevPeriodParams: range.prevParams,
    nextPeriodParams: range.nextParams,
    generatedAt: new Date().toISOString(),
  };

  return NextResponse.json(response);
}
