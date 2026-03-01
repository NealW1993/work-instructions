import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { canViewKpis } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type InstructionViewPeriod = "year" | "month" | "week" | "day";

interface ViewDepartmentRelation {
  name: string | null;
}

interface ViewWorkItemRelation {
  part_id: string | null;
  item_title: string | null;
  departments: ViewDepartmentRelation | ViewDepartmentRelation[] | null;
}

interface ViewInstructionRelation {
  id: string;
  is_archived: boolean;
  work_items: ViewWorkItemRelation | ViewWorkItemRelation[] | null;
}

interface InstructionViewEventRow {
  instruction_id: string;
  viewed_at: string;
  work_instructions: ViewInstructionRelation | ViewInstructionRelation[] | null;
}

const MAX_VIEW_EVENTS = 50000;

function normalizeRelation<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

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

function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function normalizeDay(value: string | null) {
  if (!value) {
    return null;
  }
  return parseDateKey(value);
}

function getWeekStart(date: Date) {
  const day = date.getDay();
  const mondayOffset = (day + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - mondayOffset);
}

function normalizeWeekStart(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = parseDateKey(value);
  if (!parsed) {
    return null;
  }

  return getWeekStart(parsed);
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
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
    const dayStart = requestedDay ?? new Date(year, month - 1, 1, 0, 0, 0, 0);
    const rangeStart = new Date(
      dayStart.getFullYear(),
      dayStart.getMonth(),
      dayStart.getDate(),
      0,
      0,
      0,
      0,
    );
    const rangeEnd = new Date(rangeStart.getTime() + 24 * 60 * 60 * 1000);
    return {
      startAt: rangeStart,
      endAt: rangeEnd,
      label: toDateKey(rangeStart),
      weekStart: null,
      day: toDateKey(rangeStart),
    };
  }

  if (period === "year") {
    const rangeStart = new Date(year, 0, 1, 0, 0, 0, 0);
    const rangeEnd = new Date(year + 1, 0, 1, 0, 0, 0, 0);
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
    const rangeStart = new Date(year, monthIndex, 1, 0, 0, 0, 0);
    const rangeEnd = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0);
    return {
      startAt: rangeStart,
      endAt: rangeEnd,
      label: `${year}-${String(month).padStart(2, "0")}`,
      weekStart: null,
      day: null,
    };
  }

  const fallbackWeekStart = getWeekStart(new Date(year, month - 1, 1, 0, 0, 0, 0));
  const weekStart = requestedWeekStart ?? fallbackWeekStart;
  const rangeStart = new Date(
    weekStart.getFullYear(),
    weekStart.getMonth(),
    weekStart.getDate(),
    0,
    0,
    0,
    0,
  );
  const rangeEnd = new Date(rangeStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    startAt: rangeStart,
    endAt: rangeEnd,
    label: `${toDateKey(rangeStart)}..${toDateKey(new Date(rangeEnd.getTime() - 1))}`,
    weekStart: toDateKey(rangeStart),
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

  const now = new Date();
  const requestedPeriod = normalizeRequestedPeriod(request.nextUrl.searchParams.get("period"));
  const requestedYear =
    normalizeRequestedYear(request.nextUrl.searchParams.get("year")) ?? now.getFullYear();
  const requestedMonth =
    normalizeRequestedMonth(request.nextUrl.searchParams.get("month")) ?? now.getMonth() + 1;
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
  const { data: rawEvents, error: rawEventsError } = await supabaseAdmin
    .from("instruction_view_events")
    .select(
      "instruction_id, viewed_at, work_instructions!inner(id, is_archived, work_items!inner(part_id, item_title, departments(name)))",
    )
    .eq("work_instructions.is_archived", false)
    .gte("viewed_at", range.startAt.toISOString())
    .lt("viewed_at", range.endAt.toISOString())
    .order("viewed_at", { ascending: false })
    .range(0, MAX_VIEW_EVENTS - 1);

  if (rawEventsError) {
    return NextResponse.json({ error: rawEventsError.message }, { status: 500 });
  }

  const events = (rawEvents ?? []) as InstructionViewEventRow[];
  const viewCountsByInstruction = new Map<
    string,
    {
      instructionId: string;
      partId: string;
      itemTitle: string;
      departmentName: string;
      viewCount: number;
    }
  >();

  for (const event of events) {
    const instruction = normalizeRelation(event.work_instructions);
    const workItem = normalizeRelation(instruction?.work_items);
    const department = normalizeRelation(workItem?.departments);
    if (!instruction || !workItem) {
      continue;
    }

    const existing = viewCountsByInstruction.get(event.instruction_id);
    if (existing) {
      existing.viewCount += 1;
      continue;
    }

    viewCountsByInstruction.set(event.instruction_id, {
      instructionId: event.instruction_id,
      partId: workItem.part_id?.trim() || "N/A",
      itemTitle: workItem.item_title?.trim() || "Untitled work instruction",
      departmentName: department?.name?.trim() || "Unknown Department",
      viewCount: 1,
    });
  }

  const points = [...viewCountsByInstruction.values()]
    .sort((first, second) => {
      if (second.viewCount !== first.viewCount) {
        return second.viewCount - first.viewCount;
      }

      if (first.partId !== second.partId) {
        return first.partId.localeCompare(second.partId);
      }

      return first.itemTitle.localeCompare(second.itemTitle);
    })
    .slice(0, 60);

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
    totalViews: events.length,
    totalInstructionsViewed: viewCountsByInstruction.size,
    points,
  });
}
