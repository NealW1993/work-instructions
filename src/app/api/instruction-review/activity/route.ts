import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type InstructionReviewState = "up_to_date" | "needs_review";

interface InstructionReviewStatePayload {
  kind?: unknown;
  previousStatus?: unknown;
  nextStatus?: unknown;
}

interface ReviewActivityDepartmentRelation {
  name: string | null;
  color_hex: string | null;
}

interface ReviewActivityWorkItemRelation {
  id: string;
  part_id: string | null;
  item_title: string | null;
  department_id: string | null;
  departments: ReviewActivityDepartmentRelation | ReviewActivityDepartmentRelation[] | null;
}

interface ReviewActivityInstructionRelation {
  id: string;
  is_archived: boolean;
  work_items: ReviewActivityWorkItemRelation | ReviewActivityWorkItemRelation[] | null;
}

interface ReviewActivityEventRow {
  id: string;
  instruction_id: string;
  detail: string | null;
  revision: number | null;
  occurred_at: string;
  actor_user_id: string | null;
  source_payload: unknown;
  work_instructions: ReviewActivityInstructionRelation | ReviewActivityInstructionRelation[] | null;
}

interface ReviewActivityProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
}

const MAX_EVENTS_PER_YEAR = 10000;

function isInstructionReviewState(value: unknown): value is InstructionReviewState {
  return value === "up_to_date" || value === "needs_review";
}

function normalizeRequestedYear(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    return null;
  }

  if (parsed < 2000 || parsed > 2100) {
    return null;
  }

  return parsed;
}

function normalizeRelation<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function normalizeReviewStatePayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const typed = payload as InstructionReviewStatePayload;
  if (typed.kind !== "instruction_review_state") {
    return null;
  }

  if (!isInstructionReviewState(typed.nextStatus)) {
    return null;
  }

  return {
    previousStatus: isInstructionReviewState(typed.previousStatus)
      ? typed.previousStatus
      : null,
    nextStatus: typed.nextStatus,
  };
}

export async function GET(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (requester.role !== "system_admin") {
    return NextResponse.json(
      { error: "System admin privileges required." },
      { status: 403 },
    );
  }

  const requestedYear = normalizeRequestedYear(request.nextUrl.searchParams.get("year"));
  const year = requestedYear ?? new Date().getFullYear();
  const rangeStartIso = new Date(year, 0, 1, 0, 0, 0, 0).toISOString();
  const rangeEndIso = new Date(year + 1, 0, 1, 0, 0, 0, 0).toISOString();
  const supabaseAdmin = getSupabaseAdminClient();

  const { data: rawEvents, error: rawEventsError } = await supabaseAdmin
    .from("instruction_change_events")
    .select(
      "id, instruction_id, detail, revision, occurred_at, actor_user_id, source_payload, work_instructions!inner(id, is_archived, work_items(id, part_id, item_title, department_id, departments(name, color_hex)))",
    )
    .eq("event_type", "updated")
    .eq("work_instructions.is_archived", false)
    .gte("occurred_at", rangeStartIso)
    .lt("occurred_at", rangeEndIso)
    .order("occurred_at", { ascending: false })
    .range(0, MAX_EVENTS_PER_YEAR - 1);

  if (rawEventsError) {
    return NextResponse.json({ error: rawEventsError.message }, { status: 500 });
  }

  const resolvedEvents = (rawEvents ?? []) as ReviewActivityEventRow[];

  const actorIds = new Set<string>();
  const normalizedEvents = resolvedEvents
    .map((event) => {
      const reviewStatePayload = normalizeReviewStatePayload(event.source_payload);
      if (!reviewStatePayload) {
        return null;
      }

      const instruction = normalizeRelation(event.work_instructions);
      const workItem = normalizeRelation(instruction?.work_items);
      const department = normalizeRelation(workItem?.departments);
      if (!instruction || !workItem) {
        return null;
      }

      if (event.actor_user_id) {
        actorIds.add(event.actor_user_id);
      }

      return {
        id: event.id,
        instructionId: event.instruction_id,
        occurredAt: event.occurred_at,
        detail: event.detail?.trim() || "",
        revision: event.revision,
        actorUserId: event.actor_user_id,
        previousStatus: reviewStatePayload.previousStatus,
        nextStatus: reviewStatePayload.nextStatus,
        workItem: {
          id: workItem.id,
          partId: workItem.part_id?.trim() || "",
          itemTitle: workItem.item_title?.trim() || "Untitled work instruction",
          departmentId: workItem.department_id,
          departmentName: department?.name?.trim() || "Unknown Department",
          departmentColorHex: department?.color_hex ?? null,
        },
      };
    })
    .filter((event) => event !== null);

  const actorIdList = Array.from(actorIds);
  const { data: profiles, error: profilesError } =
    actorIdList.length > 0
      ? await supabaseAdmin
          .from("profiles")
          .select("id, full_name, email")
          .in("id", actorIdList)
          .range(0, 4999)
      : { data: null, error: null };

  if (profilesError) {
    return NextResponse.json({ error: profilesError.message }, { status: 500 });
  }

  const actorNameById = new Map<string, string>();
  for (const profile of (profiles ?? []) as ReviewActivityProfileRow[]) {
    actorNameById.set(
      profile.id,
      profile.full_name?.trim() || profile.email?.trim() || "Unknown User",
    );
  }

  const events = normalizedEvents.map((event) => ({
    id: event.id,
    instructionId: event.instructionId,
    occurredAt: event.occurredAt,
    detail: event.detail,
    revision: event.revision,
    actorName:
      (event.actorUserId ? actorNameById.get(event.actorUserId) : null) ?? "Unknown User",
    previousStatus: event.previousStatus,
    nextStatus: event.nextStatus,
    workItem: event.workItem,
  }));

  return NextResponse.json({
    year,
    totalEvents: events.length,
    events,
  });
}
