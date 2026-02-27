import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface InstructionRecord {
  id: string;
  work_item_id: string;
  is_archived: boolean;
  revision: number;
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
    .select("id, work_item_id, is_archived, revision")
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
  const auth = await requireSystemAdmin(request);
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
    .select("id, work_item_id, is_archived, revision")
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

  const { data: activeInstructions, error: activeInstructionsError } = await supabaseAdmin
    .from("work_instructions")
    .select("id, revision")
    .eq("work_item_id", instruction.work_item_id)
    .eq("is_archived", false)
    .neq("id", instruction.id);

  if (activeInstructionsError) {
    return NextResponse.json(
      { error: activeInstructionsError.message },
      { status: 500 },
    );
  }

  const activeInstructionRows = (activeInstructions ?? []) as Array<{
    id: string;
    revision: number;
  }>;
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
