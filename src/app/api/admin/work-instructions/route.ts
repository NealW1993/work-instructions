import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { hasFullAccess } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface DepartmentRelationRow {
  name: string | null;
  color_hex: string | null;
}

interface WorkItemRelationRow {
  part_id: string | null;
  item_title: string | null;
  departments: DepartmentRelationRow | DepartmentRelationRow[] | null;
}

interface WorkInstructionRow {
  id: string;
  work_item_id: string;
  revision: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  fork_root_instruction_id: string | null;
  fork_number: number | null;
  work_items: WorkItemRelationRow | WorkItemRelationRow[] | null;
}

interface WorkInstructionArchiveStateRow {
  id: string;
  is_archived: boolean;
}

interface InstructionViewEventRow {
  instruction_id: string;
}

interface WorkInstructionBulkActionBody {
  action?: unknown;
  instructionIds?: unknown;
}

type WorkInstructionBulkAction = "archive" | "permanent_delete";

const VIEW_EVENTS_PAGE_SIZE = 5000;

function normalizeRelation<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function normalizeInstructionIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalizedIds = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry): entry is string => entry.length > 0);

  return [...new Set(normalizedIds)];
}

function normalizeAction(value: unknown): WorkInstructionBulkAction | null {
  return value === "archive" || value === "permanent_delete" ? value : null;
}

async function requireFullAccess(request: NextRequest) {
  const profile = await getRequestProfile(request);

  if (!profile) {
    return {
      error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
      profile: null,
    };
  }

  if (!hasFullAccess(profile.role)) {
    return {
      error: NextResponse.json(
        { error: "Admin privileges required." },
        { status: 403 },
      ),
      profile,
    };
  }

  return { error: null, profile };
}

async function collectInstructionViewCounts() {
  const supabaseAdmin = getSupabaseAdminClient();
  const countsByInstructionId = new Map<string, number>();
  let rangeStart = 0;

  for (;;) {
    const rangeEnd = rangeStart + VIEW_EVENTS_PAGE_SIZE - 1;
    const { data, error } = await supabaseAdmin
      .from("instruction_view_events")
      .select("instruction_id")
      .order("viewed_at", { ascending: false })
      .range(rangeStart, rangeEnd);

    if (error) {
      return {
        countsByInstructionId,
        error,
      };
    }

    const rows = (data ?? []) as InstructionViewEventRow[];
    for (const row of rows) {
      countsByInstructionId.set(
        row.instruction_id,
        (countsByInstructionId.get(row.instruction_id) ?? 0) + 1,
      );
    }

    if (rows.length < VIEW_EVENTS_PAGE_SIZE) {
      break;
    }

    rangeStart += VIEW_EVENTS_PAGE_SIZE;
  }

  return {
    countsByInstructionId,
    error: null,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireFullAccess(request);
  if (auth.error) {
    return auth.error;
  }

  const supabaseAdmin = getSupabaseAdminClient();

  const [{ data: rawInstructions, error: instructionsError }, { countsByInstructionId, error: viewsError }] =
    await Promise.all([
      supabaseAdmin
        .from("work_instructions")
        .select(
          "id, work_item_id, revision, is_archived, created_at, updated_at, fork_root_instruction_id, fork_number, work_items(part_id, item_title, departments(name, color_hex))",
        )
        .order("updated_at", { ascending: false }),
      collectInstructionViewCounts(),
    ]);

  if (instructionsError) {
    return NextResponse.json({ error: instructionsError.message }, { status: 500 });
  }

  if (viewsError) {
    return NextResponse.json({ error: viewsError.message }, { status: 500 });
  }

  const instructions = ((rawInstructions ?? []) as WorkInstructionRow[])
    .map((instruction) => {
      const workItem = normalizeRelation(instruction.work_items);
      const department = normalizeRelation(workItem?.departments);
      const viewCount = countsByInstructionId.get(instruction.id) ?? 0;

      return {
        id: instruction.id,
        workItemId: instruction.work_item_id,
        revision: instruction.revision,
        isArchived: instruction.is_archived,
        createdAt: instruction.created_at,
        updatedAt: instruction.updated_at,
        partId: workItem?.part_id?.trim() || "N/A",
        itemTitle: workItem?.item_title?.trim() || "Untitled work instruction",
        departmentName: department?.name?.trim() || "Unknown Department",
        departmentColorHex: department?.color_hex?.trim() || null,
        forkRootInstructionId: instruction.fork_root_instruction_id,
        forkNumber: instruction.fork_number,
        viewCount,
      };
    })
    .sort((first, second) => {
      if (second.viewCount !== first.viewCount) {
        return second.viewCount - first.viewCount;
      }

      if (first.partId !== second.partId) {
        return first.partId.localeCompare(second.partId);
      }

      return first.itemTitle.localeCompare(second.itemTitle);
    });

  return NextResponse.json({ instructions });
}

export async function POST(request: NextRequest) {
  const auth = await requireFullAccess(request);
  if (auth.error || !auth.profile) {
    return auth.error;
  }

  const body = (await request.json().catch(() => ({}))) as WorkInstructionBulkActionBody;
  const action = normalizeAction(body.action);
  const instructionIds = normalizeInstructionIds(body.instructionIds);

  if (!action) {
    return NextResponse.json(
      { error: "action must be either \"archive\" or \"permanent_delete\"." },
      { status: 400 },
    );
  }

  if (instructionIds.length === 0) {
    return NextResponse.json(
      { error: "At least one instruction id is required." },
      { status: 400 },
    );
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { data: rawInstructionRows, error: instructionRowsError } = await supabaseAdmin
    .from("work_instructions")
    .select("id, is_archived")
    .in("id", instructionIds);

  if (instructionRowsError) {
    return NextResponse.json({ error: instructionRowsError.message }, { status: 500 });
  }

  const instructionRows = (rawInstructionRows ?? []) as WorkInstructionArchiveStateRow[];
  const existingById = new Map(
    instructionRows.map((row) => [row.id, row] as const),
  );
  const missingInstructionIds = instructionIds.filter((id) => !existingById.has(id));

  if (action === "archive") {
    const archiveInstructionIds = instructionRows
      .filter((row) => !row.is_archived)
      .map((row) => row.id);
    const skippedAlreadyArchivedIds = instructionRows
      .filter((row) => row.is_archived)
      .map((row) => row.id);

    if (archiveInstructionIds.length > 0) {
      const { error: archiveError } = await supabaseAdmin
        .from("work_instructions")
        .update({
          is_archived: true,
          updated_by: auth.profile.id,
        })
        .in("id", archiveInstructionIds);

      if (archiveError) {
        return NextResponse.json({ error: archiveError.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      action,
      archiveInstructionIds,
      skippedAlreadyArchivedIds,
      missingInstructionIds,
    });
  }

  return NextResponse.json(
    {
      error:
        "Permanent deletion is disabled for ISO document-control retention. Archive instructions instead.",
    },
    { status: 409 },
  );
}
