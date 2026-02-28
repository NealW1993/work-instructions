import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { canViewKpis } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type ForkMergeDetailKind = "fork_created" | "fork_merge";
type ForkMergeMode = "selective" | "overwrite";

interface ProfileRow {
  id: string;
  full_name: string;
  email: string;
}

interface DepartmentRelation {
  name: string | null;
}

interface WorkItemRelation {
  part_id: string | null;
  item_title: string | null;
  departments: DepartmentRelation | DepartmentRelation[] | null;
}

interface InstructionRelation {
  id: string;
  work_items: WorkItemRelation | WorkItemRelation[] | null;
}

interface ForkMergeEventRow {
  id: string;
  instruction_id: string;
  actor_user_id: string;
  occurred_at: string;
  detail: string | null;
  source_payload: unknown;
  work_instructions: InstructionRelation | InstructionRelation[] | null;
}

interface ForkMergeDetailEvent {
  id: string;
  kind: ForkMergeDetailKind;
  instructionId: string;
  actorName: string;
  occurredAt: string;
  detail: string;
  partId: string;
  itemTitle: string;
  departmentName: string;
  forkNumber: number | null;
  mode: ForkMergeMode | null;
}

interface ForkMergeDetailResponse {
  from: string;
  to: string;
  events: ForkMergeDetailEvent[];
  truncated: boolean;
}

const MAX_EVENTS = 300;

function normalizeIso(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

function parseEventKind(value: unknown): ForkMergeDetailKind | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "fork_created") {
    return "fork_created";
  }
  if (candidate.kind === "fork_merge") {
    return "fork_merge";
  }
  return null;
}

function parseForkNumber(value: unknown): number | null {
  if (!Number.isInteger(value)) {
    return null;
  }

  const parsed = Number(value);
  return parsed > 0 ? parsed : null;
}

function parseMergeMode(value: unknown): ForkMergeMode {
  return value === "overwrite" ? "overwrite" : "selective";
}

export async function GET(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!canViewKpis(requester.role)) {
    return NextResponse.json({ error: "Admin privileges required." }, { status: 403 });
  }

  const from = normalizeIso(request.nextUrl.searchParams.get("from"));
  const to = normalizeIso(request.nextUrl.searchParams.get("to"));
  if (!from || !to) {
    return NextResponse.json(
      { error: "Missing or invalid 'from'/'to' parameters." },
      { status: 400 },
    );
  }
  if (to.getTime() <= from.getTime()) {
    return NextResponse.json({ error: "'to' must be after 'from'." }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const [
    { data: eventRowsData, error: eventRowsError },
    { data: profileRowsData, error: profileRowsError },
  ] = await Promise.all([
    supabaseAdmin
      .from("instruction_change_events")
      .select(
        "id, instruction_id, actor_user_id, occurred_at, detail, source_payload, work_instructions(id, work_items(part_id, item_title, departments(name)))",
      )
      .gte("occurred_at", from.toISOString())
      .lt("occurred_at", to.toISOString())
      .order("occurred_at", { ascending: false })
      .range(0, MAX_EVENTS),
    supabaseAdmin.from("profiles").select("id, full_name, email").range(0, 4999),
  ]);

  if (eventRowsError) {
    return NextResponse.json({ error: eventRowsError.message }, { status: 500 });
  }
  if (profileRowsError) {
    return NextResponse.json({ error: profileRowsError.message }, { status: 500 });
  }

  const eventRows = (eventRowsData ?? []) as ForkMergeEventRow[];
  const profileRows = (profileRowsData ?? []) as ProfileRow[];
  const profileNameById = new Map(
    profileRows.map((profile) => [profile.id, profile.full_name.trim() || profile.email]),
  );

  const parsedEvents = eventRows
    .map((eventRow) => {
      const eventKind = parseEventKind(eventRow.source_payload);
      if (!eventKind) {
        return null;
      }

      const payload = eventRow.source_payload as Record<string, unknown>;
      const instruction = normalizeRelation(eventRow.work_instructions);
      const workItem = normalizeRelation(instruction?.work_items);
      const department = normalizeRelation(workItem?.departments);

      const fallbackPartId = workItem?.part_id?.trim() || "N/A";
      const fallbackItemTitle = workItem?.item_title?.trim() || "Unknown Instruction";
      const fallbackDepartmentName = department?.name?.trim() || "Unknown Department";

      const forkNumber = parseForkNumber(payload.forkNumber ?? null);
      const mode = eventKind === "fork_merge" ? parseMergeMode(payload.mode) : null;

      return {
        id: eventRow.id,
        kind: eventKind,
        instructionId: eventRow.instruction_id,
        actorName: profileNameById.get(eventRow.actor_user_id) ?? "Unknown User",
        occurredAt: eventRow.occurred_at,
        detail: eventRow.detail?.trim() || (eventKind === "fork_merge" ? "Fork merged." : "Fork created."),
        partId:
          (typeof payload.forkPartId === "string" && payload.forkPartId.trim()) || fallbackPartId,
        itemTitle:
          (typeof payload.forkItemTitle === "string" && payload.forkItemTitle.trim()) ||
          fallbackItemTitle,
        departmentName:
          (typeof payload.forkDepartmentName === "string" && payload.forkDepartmentName.trim()) ||
          fallbackDepartmentName,
        forkNumber,
        mode,
      } satisfies ForkMergeDetailEvent;
    })
    .filter((event): event is ForkMergeDetailEvent => event !== null);

  const response: ForkMergeDetailResponse = {
    from: from.toISOString(),
    to: to.toISOString(),
    events: parsedEvents.slice(0, MAX_EVENTS),
    truncated: parsedEvents.length > MAX_EVENTS,
  };

  return NextResponse.json(response);
}
