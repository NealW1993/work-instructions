import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export type ActivityPeriod = "day" | "week" | "month" | "year";

interface ChangeEventRow {
  occurred_at: string;
  event_type: "created" | "updated" | string;
  actor_user_id: string;
}

interface ProfileRow {
  id: string;
  full_name: string;
  email: string;
}

export interface ActivityTrendPoint {
  key: string;
  label: string;
  created: number;
  updated: number;
}

export interface ContributorEntry {
  userId: string;
  label: string;
  updates: number;
}

export interface ActivityApiResponse {
  period: ActivityPeriod;
  periodLabel: string;
  trendPoints: ActivityTrendPoint[];
  contributors: ContributorEntry[];
  totalCreated: number;
  totalUpdated: number;
  prevPeriodParams: string;
  nextPeriodParams: string;
}

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTH_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function normalizePeriod(value: string | null): ActivityPeriod {
  if (value === "day" || value === "week" || value === "month" || value === "year") {
    return value;
  }
  return "week";
}

function normalizeYear(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) return fallback;
  return parsed;
}

function normalizeMonth(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) return fallback;
  return parsed;
}

function normalizeDay(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function normalizeWeekStart(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return getMondayOf(parsed);
}

function getMondayOf(date: Date): Date {
  const utcDay = date.getUTCDay();
  const mondayOffset = (utcDay + 6) % 7;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - mondayOffset),
  );
}

function toDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function toMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function toHourKey(date: Date): string {
  return `${toDateKey(date)}T${String(date.getUTCHours()).padStart(2, "0")}`;
}

function formatHourLabel(hour: number): string {
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
  buildPoints(): ActivityTrendPoint[];
  getEventKey(occurred: Date): string;
}

function buildRange(
  period: ActivityPeriod,
  year: number,
  month: number,
  day: Date | null,
  weekStart: Date | null,
  now: Date,
): ActivityRange {
  if (period === "day") {
    const todayUtc = day ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const nextDayUtc = new Date(todayUtc.getTime() + 24 * 60 * 60 * 1000);
    const prevDay = new Date(todayUtc.getTime() - 24 * 60 * 60 * 1000);
    const dayKey = toDateKey(todayUtc);
    const label = `${MONTH_FULL[todayUtc.getUTCMonth()]} ${todayUtc.getUTCDate()}, ${todayUtc.getUTCFullYear()}`;
    return {
      startAt: todayUtc,
      endAt: nextDayUtc,
      label,
      prevParams: `period=day&day=${toDateKey(prevDay)}`,
      nextParams: `period=day&day=${toDateKey(nextDayUtc)}`,
      buildPoints() {
        return Array.from({ length: 24 }, (_, h) => ({
          key: `${dayKey}T${String(h).padStart(2, "0")}`,
          label: formatHourLabel(h),
          created: 0,
          updated: 0,
        }));
      },
      getEventKey(occurred) {
        return toHourKey(occurred);
      },
    };
  }

  if (period === "week") {
    const ws = weekStart ?? getMondayOf(now);
    const we = new Date(ws.getTime() + 7 * 24 * 60 * 60 * 1000);
    const lastDay = new Date(we.getTime() - 24 * 60 * 60 * 1000);
    const prevWs = new Date(ws.getTime() - 7 * 24 * 60 * 60 * 1000);
    const labelStart = `${MONTH_SHORT[ws.getUTCMonth()]} ${ws.getUTCDate()}`;
    const labelEnd = `${MONTH_SHORT[lastDay.getUTCMonth()]} ${lastDay.getUTCDate()}, ${lastDay.getUTCFullYear()}`;
    return {
      startAt: ws,
      endAt: we,
      label: `${labelStart} – ${labelEnd}`,
      prevParams: `period=week&weekStart=${toDateKey(prevWs)}`,
      nextParams: `period=week&weekStart=${toDateKey(we)}`,
      buildPoints() {
        return Array.from({ length: 7 }, (_, d) => {
          const dayDate = new Date(ws.getTime() + d * 24 * 60 * 60 * 1000);
          return {
            key: toDateKey(dayDate),
            label: `${dayDate.getUTCMonth() + 1}/${dayDate.getUTCDate()}`,
            created: 0,
            updated: 0,
          };
        });
      },
      getEventKey(occurred) {
        return toDateKey(occurred);
      },
    };
  }

  if (period === "month") {
    const monthIndex = month - 1;
    const rangeStart = new Date(Date.UTC(year, monthIndex, 1));
    const rangeEnd = new Date(Date.UTC(year, monthIndex + 1, 1));
    const daysInMonth = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / (24 * 60 * 60 * 1000));
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    return {
      startAt: rangeStart,
      endAt: rangeEnd,
      label: `${MONTH_FULL[monthIndex]} ${year}`,
      prevParams: `period=month&year=${prevYear}&month=${prevMonth}`,
      nextParams: `period=month&year=${nextYear}&month=${nextMonth}`,
      buildPoints() {
        return Array.from({ length: daysInMonth }, (_, d) => {
          const dayDate = new Date(rangeStart.getTime() + d * 24 * 60 * 60 * 1000);
          return {
            key: toDateKey(dayDate),
            label: `${dayDate.getUTCMonth() + 1}/${dayDate.getUTCDate()}`,
            created: 0,
            updated: 0,
          };
        });
      },
      getEventKey(occurred) {
        return toDateKey(occurred);
      },
    };
  }

  // year (default)
  const rangeStart = new Date(Date.UTC(year, 0, 1));
  const rangeEnd = new Date(Date.UTC(year + 1, 0, 1));
  return {
    startAt: rangeStart,
    endAt: rangeEnd,
    label: String(year),
    prevParams: `period=year&year=${year - 1}`,
    nextParams: `period=year&year=${year + 1}`,
    buildPoints() {
      return MONTH_SHORT.map((label, index) => ({
        key: `${year}-${String(index + 1).padStart(2, "0")}`,
        label,
        created: 0,
        updated: 0,
      }));
    },
    getEventKey(occurred) {
      return toMonthKey(occurred);
    },
  };
}

export async function GET(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (requester.role !== "system_admin") {
    return NextResponse.json({ error: "System admin privileges required." }, { status: 403 });
  }

  const now = new Date();
  const sp = request.nextUrl.searchParams;
  const period = normalizePeriod(sp.get("period"));
  const year = normalizeYear(sp.get("year"), now.getUTCFullYear());
  const month = normalizeMonth(sp.get("month"), now.getUTCMonth() + 1);
  const day = normalizeDay(sp.get("day"));
  const weekStart = normalizeWeekStart(sp.get("weekStart"));
  const range = buildRange(period, year, month, day, weekStart, now);

  const supabaseAdmin = getSupabaseAdminClient();
  const [{ data: rawEvents, error: eventsError }, { data: rawProfiles, error: profilesError }] =
    await Promise.all([
      supabaseAdmin
        .from("instruction_change_events")
        .select("occurred_at, event_type, actor_user_id")
        .gte("occurred_at", range.startAt.toISOString())
        .lt("occurred_at", range.endAt.toISOString())
        .order("occurred_at", { ascending: true })
        .range(0, 49999),
      supabaseAdmin.from("profiles").select("id, full_name, email").range(0, 4999),
    ]);

  if (eventsError) {
    return NextResponse.json({ error: eventsError.message }, { status: 500 });
  }
  if (profilesError) {
    return NextResponse.json({ error: profilesError.message }, { status: 500 });
  }

  const events = (rawEvents ?? []) as ChangeEventRow[];
  const profiles = (rawProfiles ?? []) as ProfileRow[];
  const profileNameById = new Map(profiles.map((p) => [p.id, p.full_name.trim() || p.email]));

  const points = range.buildPoints();
  const pointByKey = new Map(points.map((p) => [p.key, p]));
  const contributorCounts = new Map<string, number>();
  let totalCreated = 0;
  let totalUpdated = 0;

  for (const event of events) {
    const occurredMs = new Date(event.occurred_at).getTime();
    if (Number.isNaN(occurredMs)) continue;
    const occurred = new Date(occurredMs);
    const eventType = event.event_type;

    if (eventType === "created") {
      totalCreated += 1;
    } else if (eventType === "updated") {
      totalUpdated += 1;
      contributorCounts.set(
        event.actor_user_id,
        (contributorCounts.get(event.actor_user_id) ?? 0) + 1,
      );
    }

    const key = range.getEventKey(occurred);
    const point = pointByKey.get(key);
    if (!point) continue;

    if (eventType === "created") {
      point.created += 1;
    } else if (eventType === "updated") {
      point.updated += 1;
    }
  }

  const contributors: ContributorEntry[] = Array.from(contributorCounts.entries())
    .map(([userId, updates]) => ({
      userId,
      label: profileNameById.get(userId) ?? "Unknown User",
      updates,
    }))
    .sort((a, b) =>
      b.updates !== a.updates ? b.updates - a.updates : a.label.localeCompare(b.label),
    )
    .slice(0, 12);

  const response: ActivityApiResponse = {
    period,
    periodLabel: range.label,
    trendPoints: points,
    contributors,
    totalCreated,
    totalUpdated,
    prevPeriodParams: range.prevParams,
    nextPeriodParams: range.nextParams,
  };

  return NextResponse.json(response);
}
