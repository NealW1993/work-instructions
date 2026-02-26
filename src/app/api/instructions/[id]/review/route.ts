import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type InstructionReviewStatus = "up_to_date" | "needs_review";

interface UpdateInstructionReviewBody {
  status?: unknown;
}

interface InstructionReviewStatusRecord {
  instruction_id: string;
  status: InstructionReviewStatus;
  last_calibrated_at: string;
  flagged_at: string | null;
  flagged_by: string | null;
  updated_at: string;
}

function isInstructionReviewStatus(value: unknown): value is InstructionReviewStatus {
  return value === "up_to_date" || value === "needs_review";
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requester = await getRequestProfile(request);

  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as UpdateInstructionReviewBody;
  const requestedStatus = body.status;

  if (!isInstructionReviewStatus(requestedStatus)) {
    return NextResponse.json(
      { error: "status must be either \"up_to_date\" or \"needs_review\"." },
      { status: 400 },
    );
  }

  const { id } = await context.params;
  const supabaseAdmin = getSupabaseAdminClient();

  const { data: instruction, error: instructionError } = await supabaseAdmin
    .from("work_instructions")
    .select("id, is_archived, updated_at, revision")
    .eq("id", id)
    .maybeSingle<{ id: string; is_archived: boolean; updated_at: string; revision: number }>();

  if (instructionError) {
    return NextResponse.json({ error: instructionError.message }, { status: 500 });
  }

  if (!instruction) {
    return NextResponse.json({ error: "Instruction not found." }, { status: 404 });
  }

  if (instruction.is_archived) {
    return NextResponse.json(
      { error: "Archived instructions cannot be reviewed." },
      { status: 400 },
    );
  }

  const { data: existingStatus, error: statusReadError } = await supabaseAdmin
    .from("instruction_review_status")
    .select("status, last_calibrated_at")
    .eq("instruction_id", instruction.id)
    .maybeSingle<{ status: InstructionReviewStatus; last_calibrated_at: string }>();

  if (statusReadError) {
    return NextResponse.json({ error: statusReadError.message }, { status: 500 });
  }

  const nowIso = new Date().toISOString();
  const baselineCalibrationAt =
    requestedStatus === "up_to_date"
      ? nowIso
      : existingStatus?.last_calibrated_at ?? instruction.updated_at ?? nowIso;

  const { error: upsertError } = await supabaseAdmin
    .from("instruction_review_status")
    .upsert(
      {
        instruction_id: instruction.id,
        status: requestedStatus,
        last_calibrated_at: baselineCalibrationAt,
        flagged_at: requestedStatus === "needs_review" ? nowIso : null,
        flagged_by: requestedStatus === "needs_review" ? requester.id : null,
        updated_by: requester.id,
      },
      {
        onConflict: "instruction_id",
      },
    );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  if (existingStatus?.status !== requestedStatus) {
    const reviewStateDetail =
      requestedStatus === "needs_review"
        ? "Review state changed to Needs Review."
        : "Review state changed to Up To Date.";

    const { error: changeEventError } = await supabaseAdmin
      .from("instruction_change_events")
      .upsert(
        {
          instruction_id: instruction.id,
          actor_user_id: requester.id,
          event_type: "updated",
          detail: reviewStateDetail,
          revision: instruction.revision,
          occurred_at: nowIso,
          source_payload: {
            kind: "instruction_review_state",
            previousStatus: existingStatus?.status ?? null,
            nextStatus: requestedStatus,
          },
        },
        {
          onConflict: "instruction_id,event_type,actor_user_id,occurred_at",
          ignoreDuplicates: true,
        },
      );

    if (changeEventError) {
      return NextResponse.json({ error: changeEventError.message }, { status: 500 });
    }
  }

  const { data: refreshedStatus, error: refreshedStatusError } = await supabaseAdmin
    .from("instruction_review_status")
    .select("instruction_id, status, last_calibrated_at, flagged_at, flagged_by, updated_at")
    .eq("instruction_id", instruction.id)
    .maybeSingle<InstructionReviewStatusRecord>();

  if (refreshedStatusError) {
    return NextResponse.json({ error: refreshedStatusError.message }, { status: 500 });
  }

  return NextResponse.json({
    reviewStatus: refreshedStatus ?? null,
  });
}
