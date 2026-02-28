import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { canViewKpis } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type InstructionViewPeriod = "year" | "month" | "week" | "day";

interface InstructionViewEventRow {
  viewer_user_id: string | null;
}

interface InstructionViewProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
}

const MAX_VIEW_EVENTS = 50000;

function normalizeRequestedYear(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
    return null;
  }

  return parsed;
}

function normalizeRequestedMonth(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
    return null;
  }

  return parsed;
}

function normalizeRequestedPeriod(value: string | null): InstructionViewPeriod {
  if (value === "month" || value === "week" || value === "day") {
    return value;
  }

  return "year";
}

function normalizeDay(value: string | null) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function getUtcWeekStart(date: Date) {
  const utcDay = date.getUTCDay();
  const mondayOffset = (utcDay + 6) % 7;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - mondayOffset),
  );
}

function normalizeWeekStart(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return getUtcWeekStart(parsed);
}

function toUtcDateKey(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildRange(
  period: InstructionViewPeriod,
  year: number,
  month: number,
  requestedWeekStart: Date | null,
  requestedDay: Date | null,
) {
  if (period === "day") {
    const dayUtc = requestedDay ?? new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const rangeStart = new Date(
      Date.UTC(dayUtc.getUTCFullYear(), dayUtc.getUTCMonth(), dayUtc.getUTCDate(), 0, 0, 0, 0),
    );
    const rangeEnd = new Date(rangeStart.getTime() + 24 * 60 * 60 * 1000);
    return {
      startAt: rangeStart,
      endAt: rangeEnd,
      label: toUtcDateKey(rangeStart),
      weekStart: null,
      day: toUtcDateKey(rangeStart),
    };
  }

  if (period === "year") {
    const rangeStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const rangeEnd = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
    return {
      startAt: rangeStart,
      endAt: rangeEnd,
      label: `${year}`,
      weekStart: null,
      day: null,
    };
  }

  if (period === "month") {
    const monthIndex = month - 1;
    const rangeStart = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
    const rangeEnd = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0));
    return {
      startAt: rangeStart,
      endAt: rangeEnd,
      label: `${year}-${String(month).padStart(2, "0")}`,
      weekStart: null,
      day: null,
    };
  }

  const fallbackWeekStart = getUtcWeekStart(new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)));
  const weekStart = requestedWeekStart ?? fallbackWeekStart;
  const rangeStart = new Date(
    Date.UTC(
      weekStart.getUTCFullYear(),
      weekStart.getUTCMonth(),
      weekStart.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  );
  const rangeEnd = new Date(rangeStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    startAt: rangeStart,
    endAt: rangeEnd,
    label: `${toUtcDateKey(rangeStart)}..${toUtcDateKey(new Date(rangeEnd.getTime() - 1))}`,
    weekStart: toUtcDateKey(rangeStart),
    day: null,
  };
}

export async function GET(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!canViewKpis(requester.role)) {
    return NextResponse.json({ error: "Admin privileges required." }, { status: 403 });
  }

  const instructionId = (request.nextUrl.searchParams.get("instructionId") ?? "").trim();
  if (!instructionId) {
    return NextResponse.json({ error: "Instruction id is required." }, { status: 400 });
  }

  const now = new Date();
  const requestedPeriod = normalizeRequestedPeriod(request.nextUrl.searchParams.get("period"));
  const requestedYear =
    normalizeRequestedYear(request.nextUrl.searchParams.get("year")) ?? now.getUTCFullYear();
  const requestedMonth =
    normalizeRequestedMonth(request.nextUrl.searchParams.get("month")) ?? now.getUTCMonth() + 1;
  const requestedWeekStart = normalizeWeekStart(request.nextUrl.searchParams.get("weekStart"));
  const requestedDay = normalizeDay(request.nextUrl.searchParams.get("day"));
  const range = buildRange(
    requestedPeriod,
    requestedYear,
    requestedMonth,
    requestedWeekStart,
    requestedDay,
  );

  const supabaseAdmin = getSupabaseAdminClient();

  const { data: instructionRow, error: instructionError } = await supabaseAdmin
    .from("work_instructions")
    .select("id, is_archived")
    .eq("id", instructionId)
    .maybeSingle<{ id: string; is_archived: boolean }>();
  if (instructionError) {
    return NextResponse.json({ error: instructionError.message }, { status: 500 });
  }
  if (!instructionRow || instructionRow.is_archived) {
    return NextResponse.json({ error: "Instruction not found." }, { status: 404 });
  }

  const { data: rawEvents, error: rawEventsError } = await supabaseAdmin
    .from("instruction_view_events")
    .select("viewer_user_id")
    .eq("instruction_id", instructionId)
    .gte("viewed_at", range.startAt.toISOString())
    .lt("viewed_at", range.endAt.toISOString())
    .range(0, MAX_VIEW_EVENTS - 1);

  if (rawEventsError) {
    return NextResponse.json({ error: rawEventsError.message }, { status: 500 });
  }

  const events = (rawEvents ?? []) as InstructionViewEventRow[];
  const viewerIds = Array.from(
    new Set(
      events
        .map((event) => event.viewer_user_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );

  const { data: rawProfiles, error: profilesError } =
    viewerIds.length > 0
      ? await supabaseAdmin
          .from("profiles")
          .select("id, full_name, email")
          .in("id", viewerIds)
          .range(0, 4999)
      : { data: null, error: null };
  if (profilesError) {
    return NextResponse.json({ error: profilesError.message }, { status: 500 });
  }

  const profileLabelById = new Map<string, string>();
  for (const profile of (rawProfiles ?? []) as InstructionViewProfileRow[]) {
    profileLabelById.set(
      profile.id,
      profile.full_name?.trim() || profile.email?.trim() || "Unknown User",
    );
  }

  const contributorCounts = new Map<string, { userId: string | null; label: string; viewCount: number }>();
  for (const event of events) {
    const userId = event.viewer_user_id;
    const contributorKey = userId ?? "__unknown__";
    const existing = contributorCounts.get(contributorKey);
    if (existing) {
      existing.viewCount += 1;
      continue;
    }

    contributorCounts.set(contributorKey, {
      userId,
      label: userId ? profileLabelById.get(userId) ?? "Unknown User" : "Unknown User",
      viewCount: 1,
    });
  }

  const contributors = [...contributorCounts.values()].sort((first, second) => {
    if (second.viewCount !== first.viewCount) {
      return second.viewCount - first.viewCount;
    }

    return first.label.localeCompare(second.label);
  });

  return NextResponse.json({
    period: requestedPeriod,
    year: requestedYear,
    month: requestedMonth,
    weekStart: range.weekStart,
    day: range.day,
    range: {
      startAt: range.startAt.toISOString(),
      endAt: range.endAt.toISOString(),
      label: range.label,
    },
    instructionId,
    totalViews: events.length,
    contributors,
  });
}
