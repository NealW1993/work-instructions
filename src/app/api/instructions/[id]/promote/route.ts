import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface WorkInstructionRow {
  id: string;
  work_item_id: string;
  is_archived: boolean;
}

function canPromoteArchivedRevision(role: string) {
  return role === "admin" || role === "system_admin";
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
    .select("id, work_item_id, is_archived")
    .eq("id", id)
    .maybeSingle<WorkInstructionRow>();

  if (targetInstructionError) {
    return NextResponse.json({ error: targetInstructionError.message }, { status: 500 });
  }

  if (!targetInstruction) {
    return NextResponse.json({ error: "Instruction not found." }, { status: 404 });
  }

  const { data: activeInstructions, error: activeInstructionsError } = await supabaseAdmin
    .from("work_instructions")
    .select("id")
    .eq("work_item_id", targetInstruction.work_item_id)
    .eq("is_archived", false)
    .neq("id", targetInstruction.id);

  if (activeInstructionsError) {
    return NextResponse.json({ error: activeInstructionsError.message }, { status: 500 });
  }

  const archivedInstructionIds = ((activeInstructions ?? []) as Array<{ id: string }>).map(
    (entry) => entry.id,
  );

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
