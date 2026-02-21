import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface InstructionDeleteRecord {
  id: string;
  work_item_id: string;
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requester = await getRequestProfile(request);

  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (requester.role !== "system_admin") {
    return NextResponse.json(
      { error: "Only system admins can delete work instructions." },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  const supabaseAdmin = getSupabaseAdminClient();

  const { data: instruction, error: instructionReadError } = await supabaseAdmin
    .from("work_instructions")
    .select("id, work_item_id")
    .eq("id", id)
    .maybeSingle<InstructionDeleteRecord>();

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

  const { error: deleteInstructionError } = await supabaseAdmin
    .from("work_instructions")
    .delete()
    .eq("id", id);

  if (deleteInstructionError) {
    return NextResponse.json(
      { error: deleteInstructionError.message },
      { status: 500 },
    );
  }

  const { count, error: remainingInstructionCountError } = await supabaseAdmin
    .from("work_instructions")
    .select("id", { count: "exact", head: true })
    .eq("work_item_id", instruction.work_item_id);

  if (!remainingInstructionCountError && (count ?? 0) === 0) {
    await supabaseAdmin
      .from("work_items")
      .delete()
      .eq("id", instruction.work_item_id);
  }

  return NextResponse.json({ success: true });
}
