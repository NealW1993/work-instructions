import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface InstructionRecord {
  id: string;
  work_item_id: string;
  is_archived: boolean;
  revision: number;
  fork_root_instruction_id: string | null;
  fork_number: number | null;
}

interface WorkItemRecord {
  id: string;
  part_id: string;
  item_title: string;
  department_id: string;
}

interface WorkInstructionLookupRecord {
  id: string;
  work_item_id: string;
  revision: number;
  work_items:
    | Pick<WorkItemRecord, "part_id" | "item_title" | "department_id">
    | Array<Pick<WorkItemRecord, "part_id" | "item_title" | "department_id">>
    | null;
}

interface RestoreRequestBody {
  forceSwap?: boolean;
}

interface DeleteRequestBody {
  permanent?: boolean;
}

async function requireSystemAdmin(request: NextRequest) {
  const requester = await getRequestProfile(request);

  if (!requester) {
    return {
      error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
      requester: null,
    };
  }

  if (requester.role !== "system_admin") {
    return {
      error: NextResponse.json(
        { error: "Only system admins can archive or restore work instructions." },
        { status: 403 },
      ),
      requester,
    };
  }

  return { error: null, requester };
}

async function requireAdminOrSystemAdmin(request: NextRequest) {
  const requester = await getRequestProfile(request);

  if (!requester) {
    return {
      error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
      requester: null,
    };
  }

  if (requester.role !== "admin" && requester.role !== "system_admin") {
    return {
      error: NextResponse.json(
        { error: "Only admins and system admins can restore work instructions." },
        { status: 403 },
      ),
      requester,
    };
  }

  return { error: null, requester };
}

function normalizeWorkItemRelation(
  relation: WorkInstructionLookupRecord["work_items"],
) {
  if (!relation) {
    return null;
  }

  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }

  return relation;
}

function normalizeLookupValue(value: string) {
  return value.trim().toLowerCase();
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSystemAdmin(request);
  if (auth.error || !auth.requester) {
    return auth.error;
  }

  const { id } = await context.params;
  const supabaseAdmin = getSupabaseAdminClient();
  let requestBody: DeleteRequestBody = {};

  try {
    requestBody = (await request.json()) as DeleteRequestBody;
  } catch {
    requestBody = {};
  }

  const permanentDelete = requestBody.permanent === true;

  const { data: instruction, error: instructionReadError } = await supabaseAdmin
    .from("work_instructions")
    .select("id, work_item_id, is_archived, revision, fork_root_instruction_id, fork_number")
    .eq("id", id)
    .maybeSingle<InstructionRecord>();

  if (instructionReadError) {
    return NextResponse.json(
      { error: instructionReadError.message },
      { status: 500 },
    );
  }

  if (!instruction) {
    return NextResponse.json(
      { error: "Instruction not found." },
      { status: 404 },
    );
  }

  if (permanentDelete) {
    if (!instruction.is_archived) {
      return NextResponse.json(
        { error: "Only archived instructions can be permanently deleted." },
        { status: 400 },
      );
    }

    const { error: permanentDeleteError } = await supabaseAdmin
      .from("work_instructions")
      .delete()
      .eq("id", id);

    if (permanentDeleteError) {
      return NextResponse.json(
        { error: permanentDeleteError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      deleted: true,
      permanent: true,
    });
  }

  if (instruction.is_archived) {
    return NextResponse.json({ success: true, archived: true });
  }

  const { error: archiveInstructionError } = await supabaseAdmin
    .from("work_instructions")
    .update({
      is_archived: true,
      updated_by: auth.requester.id,
    })
    .eq("id", id);

  if (archiveInstructionError) {
    return NextResponse.json(
      { error: archiveInstructionError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, archived: true });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminOrSystemAdmin(request);
  if (auth.error || !auth.requester) {
    return auth.error;
  }

  const { id } = await context.params;
  const supabaseAdmin = getSupabaseAdminClient();
  let requestBody: RestoreRequestBody = {};

  try {
    requestBody = (await request.json()) as RestoreRequestBody;
  } catch {
    requestBody = {};
  }

  const forceSwap = requestBody.forceSwap === true;

  const { data: instruction, error: instructionReadError } = await supabaseAdmin
    .from("work_instructions")
    .select("id, work_item_id, is_archived, revision, fork_root_instruction_id, fork_number")
    .eq("id", id)
    .maybeSingle<InstructionRecord>();

  if (instructionReadError) {
    return NextResponse.json(
      { error: instructionReadError.message },
      { status: 500 },
    );
  }

  if (!instruction) {
    return NextResponse.json(
      { error: "Instruction not found." },
      { status: 404 },
    );
  }

  if (!instruction.is_archived) {
    return NextResponse.json({ success: true, archived: false, restored: true });
  }

  const { data: targetWorkItem, error: targetWorkItemError } = await supabaseAdmin
    .from("work_items")
    .select("id, part_id, item_title, department_id")
    .eq("id", instruction.work_item_id)
    .maybeSingle<WorkItemRecord>();

  if (targetWorkItemError) {
    return NextResponse.json(
      { error: targetWorkItemError.message },
      { status: 500 },
    );
  }

  if (!targetWorkItem) {
    return NextResponse.json(
      { error: "Instruction work item was not found." },
      { status: 404 },
    );
  }

  const targetIsFork =
    Boolean(instruction.fork_root_instruction_id) &&
    Number.isInteger(instruction.fork_number) &&
    Number(instruction.fork_number) > 0;
  let activeInstructionRows: Array<{ id: string; revision: number }> = [];

  if (targetIsFork) {
    const { data: activeForkRows, error: activeForkRowsError } = await supabaseAdmin
      .from("work_instructions")
      .select("id, revision")
      .eq("is_archived", false)
      .eq("fork_root_instruction_id", instruction.fork_root_instruction_id as string)
      .eq("fork_number", instruction.fork_number as number)
      .neq("id", instruction.id);

    if (activeForkRowsError) {
      return NextResponse.json({ error: activeForkRowsError.message }, { status: 500 });
    }

    activeInstructionRows = (activeForkRows ?? []) as Array<{ id: string; revision: number }>;
  } else {
    const [
      { data: activeInstructionsByWorkItem, error: activeInstructionsByWorkItemError },
      {
        data: activeInstructionsByPartIdDepartment,
        error: activeInstructionsByPartIdDepartmentError,
      },
    ] = await Promise.all([
      supabaseAdmin
        .from("work_instructions")
        .select("id, revision")
        .eq("work_item_id", instruction.work_item_id)
        .eq("is_archived", false)
        .is("fork_root_instruction_id", null)
        .neq("id", instruction.id),
      supabaseAdmin
        .from("work_instructions")
        .select(
          "id, work_item_id, revision, work_items!inner(part_id, item_title, department_id)",
        )
        .eq("is_archived", false)
        .is("fork_root_instruction_id", null)
        .neq("id", instruction.id)
        .eq("work_items.department_id", targetWorkItem.department_id),
    ]);

    if (activeInstructionsByWorkItemError) {
      return NextResponse.json(
        { error: activeInstructionsByWorkItemError.message },
        { status: 500 },
      );
    }

    if (activeInstructionsByPartIdDepartmentError) {
      return NextResponse.json(
        { error: activeInstructionsByPartIdDepartmentError.message },
        { status: 500 },
      );
    }

    const activeInstructionRowsByWorkItem = (activeInstructionsByWorkItem ?? []) as Array<{
      id: string;
      revision: number;
    }>;
    const activeInstructionRowsByPartIdDepartment =
      (activeInstructionsByPartIdDepartment ?? []) as WorkInstructionLookupRecord[];
    const normalizedTargetPartId = normalizeLookupValue(targetWorkItem.part_id);
    const normalizedTargetItemTitle = normalizeLookupValue(targetWorkItem.item_title);
    const matchedLegacyRows = activeInstructionRowsByPartIdDepartment
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

    activeInstructionRows = [...activeInstructionById.values()];
  }

  const activeInstructionIds = activeInstructionRows.map((entry) => entry.id);

  if (activeInstructionRows.length > 0 && !forceSwap) {
    const existingActiveInstruction = [...activeInstructionRows].sort(
      (first, second) => second.revision - first.revision,
    )[0];

    if (existingActiveInstruction) {
      return NextResponse.json(
        {
          error: "An active revision already exists for this work instruction.",
          conflict: {
            existingInstructionId: existingActiveInstruction.id,
            existingRevision: existingActiveInstruction.revision,
            restoringRevision: instruction.revision,
            hasNewerRevision:
              existingActiveInstruction.revision > instruction.revision,
          },
        },
        { status: 409 },
      );
    }
  }

  if (activeInstructionIds.length > 0) {
    const { error: archiveOtherActiveInstructionsError } = await supabaseAdmin
      .from("work_instructions")
      .update({
        is_archived: true,
        updated_by: auth.requester.id,
      })
      .in("id", activeInstructionIds);

    if (archiveOtherActiveInstructionsError) {
      return NextResponse.json(
        { error: archiveOtherActiveInstructionsError.message },
        { status: 500 },
      );
    }
  }

  const { error: restoreInstructionError } = await supabaseAdmin
    .from("work_instructions")
    .update({
      is_archived: false,
      updated_by: auth.requester.id,
    })
    .eq("id", id);

  if (restoreInstructionError) {
    if (activeInstructionIds.length > 0) {
      await supabaseAdmin
        .from("work_instructions")
        .update({
          is_archived: false,
          updated_by: auth.requester.id,
        })
        .in("id", activeInstructionIds);
    }

    return NextResponse.json(
      { error: restoreInstructionError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    archived: false,
    restored: true,
    swappedOutInstructionIds: activeInstructionIds,
  });
}
