import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const supabaseAdmin = getSupabaseAdminClient();

  const { data: instruction, error: instructionError } = await supabaseAdmin
    .from("work_instructions")
    .select("id")
    .eq("id", id)
    .maybeSingle<{ id: string }>();

  if (instructionError) {
    return NextResponse.json({ error: instructionError.message }, { status: 500 });
  }

  if (!instruction) {
    return NextResponse.json({ error: "Instruction not found." }, { status: 404 });
  }

  const { error: insertError } = await supabaseAdmin
    .from("instruction_view_events")
    .insert({
      instruction_id: instruction.id,
      viewer_user_id: requester.id,
      viewed_at: new Date().toISOString(),
    });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
