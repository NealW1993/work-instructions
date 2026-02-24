import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface InstructionRecord {
  id: string;
  is_archived: boolean;
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

  const { data: instruction, error: instructionReadError } = await supabaseAdmin
    .from("work_instructions")
    .select("id, is_archived")
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

  const { data: instruction, error: instructionReadError } = await supabaseAdmin
    .from("work_instructions")
    .select("id, is_archived")
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

  const { error: restoreInstructionError } = await supabaseAdmin
    .from("work_instructions")
    .update({
      is_archived: false,
      updated_by: auth.requester.id,
    })
    .eq("id", id);

  if (restoreInstructionError) {
    return NextResponse.json(
      { error: restoreInstructionError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, archived: false, restored: true });
}
