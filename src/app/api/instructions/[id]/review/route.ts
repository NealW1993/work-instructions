import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { hasFullAccess } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type InstructionReviewStatus = "up_to_date" | "needs_review";
type InstructionReviewOrigin = "user" | "system";

interface UpdateInstructionReviewBody {
  status?: unknown;
  note?: unknown;
  reviewOrigin?: unknown;
}

interface InstructionReviewStatusRecord {
  instruction_id: string;
  status: InstructionReviewStatus;
  last_calibrated_at: string;
  flagged_at: string | null;
  flagged_by: string | null;
  updated_at: string;
}

const MAX_REVIEW_NOTE_CHARACTERS = 1200;

function isInstructionReviewStatus(value: unknown): value is InstructionReviewStatus {
  return value === "up_to_date" || value === "needs_review";
}

function isInstructionReviewOrigin(value: unknown): value is InstructionReviewOrigin {
  return value === "user" || value === "system";
}

function normalizeReviewNote(value: unknown) {
  if (value === null || value === undefined) {
    return {
      note: null,
      error: null,
    };
  }

  if (typeof value !== "string") {
    return {
      note: null,
      error: "note must be a string when provided.",
    };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return {
      note: null,
      error: null,
    };
  }

  if (trimmed.length > MAX_REVIEW_NOTE_CHARACTERS) {
    return {
      note: null,
      error: `note must be ${MAX_REVIEW_NOTE_CHARACTERS} characters or less.`,
    };
  }

  return {
    note: trimmed,
    error: null,
  };
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

  if (body.reviewOrigin !== undefined && !isInstructionReviewOrigin(body.reviewOrigin)) {
    return NextResponse.json(
      { error: "reviewOrigin must be either \"user\" or \"system\" when provided." },
      { status: 400 },
    );
  }

  const reviewOrigin: InstructionReviewOrigin =
    isInstructionReviewOrigin(body.reviewOrigin) ? body.reviewOrigin : "user";

  if (reviewOrigin === "system" && !hasFullAccess(requester.role)) {
    return NextResponse.json(
      { error: "Only admins can mark review events as system generated." },
      { status: 403 },
    );
  }

  const normalizedReviewNoteResult = normalizeReviewNote(body.note);
  if (normalizedReviewNoteResult.error) {
    return NextResponse.json({ error: normalizedReviewNoteResult.error }, { status: 400 });
  }
  const reviewNote = requestedStatus === "needs_review" ? normalizedReviewNoteResult.note : null;

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
        ? reviewOrigin === "system"
          ? "Review state changed to Needs Review by system counter."
          : "Review state changed to Needs Review."
        : reviewOrigin === "system"
          ? "Review state changed to Up To Date by system counter."
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
            reviewOrigin,
            note: reviewNote,
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
