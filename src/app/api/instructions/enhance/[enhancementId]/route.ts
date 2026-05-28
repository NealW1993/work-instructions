import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { canCreateInstructions } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface UpdateEnhancementOutcomeRequestBody {
  outcome?: "applied" | "discarded" | string;
  instructionId?: string | null;
}

function normalizeUuid(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
    return null;
  }

  return trimmed;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ enhancementId: string }> },
) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!canCreateInstructions(requester.role)) {
    return NextResponse.json(
      { error: "You do not have permission to update AI enhancement outcomes." },
      { status: 403 },
    );
  }

  const { enhancementId } = await context.params;
  const normalizedEnhancementId = normalizeUuid(enhancementId);
  if (!normalizedEnhancementId) {
    return NextResponse.json({ error: "Invalid enhancement id." }, { status: 400 });
  }

  const requestBody = (await request.json().catch(() => ({}))) as UpdateEnhancementOutcomeRequestBody;
  if (requestBody.outcome !== "applied" && requestBody.outcome !== "discarded") {
    return NextResponse.json(
      { error: "Outcome must be 'applied' or 'discarded'." },
      { status: 400 },
    );
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const normalizedInstructionId = normalizeUuid(requestBody.instructionId ?? null);
  const updatePayload: {
    outcome: "applied" | "discarded";
    outcome_at: string;
    instruction_id?: string | null;
  } = {
    outcome: requestBody.outcome,
    outcome_at: new Date().toISOString(),
  };

  if (normalizedInstructionId) {
    updatePayload.instruction_id = normalizedInstructionId;
  }

  const { data: updatedRows, error: updateError } = await supabaseAdmin
    .from("instruction_ai_enhancements")
    .update(updatePayload)
    .eq("id", normalizedEnhancementId)
    .eq("actor_user_id", requester.id)
    .select("id")
    .limit(1);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json(
      { error: "AI enhancement record not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ success: true });
}
