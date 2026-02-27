import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface WorkInstructionRow {
  id: string;
  work_item_id: string;
  is_archived: boolean;
  revision: number;
}

interface WorkItemRecord {
  id: string;
  part_id: string;
  item_title: string;
  department_id: string;
}

interface WorkInstructionLookupRow {
  id: string;
  revision: number;
  work_items:
    | Pick<WorkItemRecord, "part_id" | "item_title" | "department_id">
    | Array<Pick<WorkItemRecord, "part_id" | "item_title" | "department_id">>
    | null;
}

function canPromoteArchivedRevision(role: string) {
  return role === "admin" || role === "system_admin";
}

function normalizeLookupValue(value: string) {
  return value.trim().toLowerCase();
}

function normalizeWorkItemRelation(relation: WorkInstructionLookupRow["work_items"]) {
  if (!relation) {
    return null;
  }

  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }

  return relation;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!canPromoteArchivedRevision(requester.role)) {
    return NextResponse.json(
      { error: "Only admins and system admins can bring back archived revisions." },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  const supabaseAdmin = getSupabaseAdminClient();

  const { data: targetInstruction, error: targetInstructionError } = await supabaseAdmin
    .from("work_instructions")
    .select("id, work_item_id, is_archived, revision")
    .eq("id", id)
    .maybeSingle<WorkInstructionRow>();

  if (targetInstructionError) {
    return NextResponse.json({ error: targetInstructionError.message }, { status: 500 });
  }

  if (!targetInstruction) {
    return NextResponse.json({ error: "Instruction not found." }, { status: 404 });
  }

  const { data: targetWorkItem, error: targetWorkItemError } = await supabaseAdmin
    .from("work_items")
    .select("id, part_id, item_title, department_id")
    .eq("id", targetInstruction.work_item_id)
    .maybeSingle<WorkItemRecord>();

  if (targetWorkItemError) {
    return NextResponse.json({ error: targetWorkItemError.message }, { status: 500 });
  }

  if (!targetWorkItem) {
    return NextResponse.json(
      { error: "Instruction work item was not found." },
      { status: 404 },
    );
  }

  const [
    { data: activeInstructionsByWorkItem, error: activeInstructionsByWorkItemError },
    { data: activeInstructionsByPartAndDepartment, error: activeInstructionsByPartAndDepartmentError },
  ] = await Promise.all([
    supabaseAdmin
      .from("work_instructions")
      .select("id, revision")
      .eq("work_item_id", targetInstruction.work_item_id)
      .eq("is_archived", false)
      .neq("id", targetInstruction.id),
    supabaseAdmin
      .from("work_instructions")
      .select("id, revision, work_items!inner(part_id, item_title, department_id)")
      .eq("is_archived", false)
      .neq("id", targetInstruction.id)
      .eq("work_items.department_id", targetWorkItem.department_id),
  ]);

  if (activeInstructionsByWorkItemError) {
    return NextResponse.json({ error: activeInstructionsByWorkItemError.message }, { status: 500 });
  }

  if (activeInstructionsByPartAndDepartmentError) {
    return NextResponse.json(
      { error: activeInstructionsByPartAndDepartmentError.message },
      { status: 500 },
    );
  }

  const normalizedTargetPartId = normalizeLookupValue(targetWorkItem.part_id);
  const normalizedTargetItemTitle = normalizeLookupValue(targetWorkItem.item_title);
  const activeInstructionRowsByWorkItem = (activeInstructionsByWorkItem ?? []) as Array<{
    id: string;
    revision: number;
  }>;
  const activeInstructionRowsByPartAndDepartment =
    (activeInstructionsByPartAndDepartment ?? []) as WorkInstructionLookupRow[];
  const matchedLegacyRows = activeInstructionRowsByPartAndDepartment
    .map((entry) => {
      const entryWorkItem = normalizeWorkItemRelation(entry.work_items);
      if (!entryWorkItem) {
        return null;
      }

      if (
        normalizeLookupValue(entryWorkItem.part_id) !== normalizedTargetPartId ||
        normalizeLookupValue(entryWorkItem.item_title) !== normalizedTargetItemTitle
      ) {
        return null;
      }

      return {
        id: entry.id,
        revision: entry.revision,
      };
    })
    .filter((entry): entry is { id: string; revision: number } => entry !== null);

  const activeInstructionById = new Map<string, { id: string; revision: number }>();
  for (const entry of [...activeInstructionRowsByWorkItem, ...matchedLegacyRows]) {
    if (!activeInstructionById.has(entry.id)) {
      activeInstructionById.set(entry.id, entry);
    }
  }

  const archivedInstructionIds = [...activeInstructionById.keys()];

  if (archivedInstructionIds.length > 0) {
    const { error: archiveCurrentActiveError } = await supabaseAdmin
      .from("work_instructions")
      .update({
        is_archived: true,
        updated_by: requester.id,
      })
      .in("id", archivedInstructionIds);

    if (archiveCurrentActiveError) {
      return NextResponse.json({ error: archiveCurrentActiveError.message }, { status: 500 });
    }
  }

  if (targetInstruction.is_archived) {
    const { error: promoteInstructionError } = await supabaseAdmin
      .from("work_instructions")
      .update({
        is_archived: false,
        updated_by: requester.id,
      })
      .eq("id", targetInstruction.id);

    if (promoteInstructionError) {
      if (archivedInstructionIds.length > 0) {
        await supabaseAdmin
          .from("work_instructions")
          .update({
            is_archived: false,
            updated_by: requester.id,
          })
          .in("id", archivedInstructionIds);
      }

      return NextResponse.json({ error: promoteInstructionError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    promotedInstructionId: targetInstruction.id,
    archivedInstructionIds,
  });
}
