import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { canViewKpis } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface DepartmentRelation {
  name: string | null;
}

interface WorkItemRelation {
  part_id: string | null;
  item_title: string | null;
  departments: DepartmentRelation | DepartmentRelation[] | null;
}

interface WorkInstructionRelation {
  id: string;
  work_items: WorkItemRelation | WorkItemRelation[] | null;
}

interface ChangeEventRow {
  id: string;
  instruction_id: string;
  actor_user_id: string;
  event_type: string;
  occurred_at: string;
  detail: string | null;
  work_instructions: WorkInstructionRelation | WorkInstructionRelation[] | null;
}

interface ProfileRow {
  id: string;
  full_name: string;
  email: string;
}

export interface ActivityDetailEvent {
  eventId: string;
  instructionId: string;
  partId: string;
  itemTitle: string;
  departmentName: string;
  actorName: string;
  eventType: string;
  occurredAt: string;
  detail: string | null;
}

export interface ActivityDetailResponse {
  from: string;
  to: string;
  events: ActivityDetailEvent[];
  truncated: boolean;
}

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeIso(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

const MAX_EVENTS = 200;

export async function GET(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!canViewKpis(requester.role)) {
    return NextResponse.json({ error: "Admin privileges required." }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const from = normalizeIso(sp.get("from"));
  const to = normalizeIso(sp.get("to"));

  if (!from || !to) {
    return NextResponse.json({ error: "Missing or invalid 'from' / 'to' params." }, { status: 400 });
  }
  if (to.getTime() <= from.getTime()) {
    return NextResponse.json({ error: "'to' must be after 'from'." }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdminClient();

  const [{ data: rawEvents, error: eventsError }, { data: rawProfiles, error: profilesError }] =
    await Promise.all([
      supabaseAdmin
        .from("instruction_change_events")
        .select(
          "id, instruction_id, actor_user_id, event_type, occurred_at, detail, work_instructions(id, work_items(part_id, item_title, departments(name)))",
        )
        .gte("occurred_at", from.toISOString())
        .lt("occurred_at", to.toISOString())
        .order("occurred_at", { ascending: false })
        .range(0, MAX_EVENTS),
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

  const truncated = events.length > MAX_EVENTS;
  const sliced = truncated ? events.slice(0, MAX_EVENTS) : events;

  const detailEvents: ActivityDetailEvent[] = sliced.map((event) => {
    const instruction = normalizeRelation(event.work_instructions);
    const workItem = normalizeRelation(instruction?.work_items);
    const department = normalizeRelation(workItem?.departments);

    return {
      eventId: event.id,
      instructionId: event.instruction_id,
      partId: workItem?.part_id?.trim() || "N/A",
      itemTitle: workItem?.item_title?.trim() || "Unknown Instruction",
      departmentName: department?.name?.trim() || "Unknown Department",
      actorName: profileNameById.get(event.actor_user_id) ?? "Unknown User",
      eventType: event.event_type,
      occurredAt: event.occurred_at,
      detail: event.detail ?? null,
    };
  });

  const response: ActivityDetailResponse = {
    from: from.toISOString(),
    to: to.toISOString(),
    events: detailEvents,
    truncated,
  };

  return NextResponse.json(response);
}
