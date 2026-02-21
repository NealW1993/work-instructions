import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface InstructionDeleteRecord {
  id: string;
  is_archived: boolean;
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
      { error: "Only system admins can archive work instructions." },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  const supabaseAdmin = getSupabaseAdminClient();

  const { data: instruction, error: instructionReadError } = await supabaseAdmin
    .from("work_instructions")
    .select("id, is_archived")
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

  if (instruction.is_archived) {
    return NextResponse.json({ success: true, archived: true });
  }

  const { error: archiveInstructionError } = await supabaseAdmin
    .from("work_instructions")
    .update({
      is_archived: true,
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
