import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { sendNotificationEmailsToUsers } from "@/lib/notification-email.server";
import { hasFullAccess } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { InstructionApprovalStatus } from "@/lib/types";

interface ApprovalRequestBody {
  status?: unknown;
  note?: unknown;
}

interface InstructionRecord {
  id: string;
  revision: number;
  approval_status: InstructionApprovalStatus | null;
  is_archived: boolean;
  created_by: string;
  submitted_by: string | null;
  updated_by: string;
  work_items:
    | {
        part_id: string;
        item_title: string;
      }
    | Array<{
        part_id: string;
        item_title: string;
      }>
    | null;
}

const MAX_APPROVAL_NOTE_LENGTH = 1200;

function isApprovalDecision(value: unknown): value is "approved" | "rejected" {
  return value === "approved" || value === "rejected";
}

function normalizeNote(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, MAX_APPROVAL_NOTE_LENGTH) : "";
}

function normalizeWorkItem(
  relation: InstructionRecord["work_items"],
) {
  if (!relation) {
    return null;
  }

  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requester = await getRequestProfile(request);

  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!hasFullAccess(requester.role)) {
    return NextResponse.json(
      { error: "Only admins can approve or reject work instructions." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as ApprovalRequestBody;
  if (!isApprovalDecision(body.status)) {
    return NextResponse.json(
      { error: "status must be approved or rejected." },
      { status: 400 },
    );
  }

  const { id } = await context.params;
  const note = normalizeNote(body.note);
  const nowIso = new Date().toISOString();
  const supabaseAdmin = getSupabaseAdminClient();
  const { data: instruction, error: instructionError } = await supabaseAdmin
    .from("work_instructions")
    .select("id, revision, approval_status, is_archived, created_by, submitted_by, updated_by, work_items(part_id, item_title)")
    .eq("id", id)
    .maybeSingle<InstructionRecord>();

  if (instructionError) {
    return NextResponse.json({ error: instructionError.message }, { status: 500 });
  }

  if (!instruction) {
    return NextResponse.json({ error: "Instruction not found." }, { status: 404 });
  }

  if (instruction.is_archived) {
    return NextResponse.json(
      { error: "Archived instructions cannot be approved or rejected." },
      { status: 400 },
    );
  }

  const updatePayload =
    body.status === "approved"
      ? {
          approval_status: "approved" as const,
          approved_by: requester.id,
          approved_at: nowIso,
          rejected_by: null,
          rejected_at: null,
          approval_note: note,
          updated_by: requester.id,
          last_change_summary: "Instruction approved for controlled release.",
        }
      : {
          approval_status: "rejected" as const,
          rejected_by: requester.id,
          rejected_at: nowIso,
          approved_by: null,
          approved_at: null,
          approval_note: note,
          updated_by: requester.id,
          last_change_summary: note
            ? `Instruction rejected: ${note}`
            : "Instruction rejected and returned for revision.",
        };

  const { error: updateError } = await supabaseAdmin
    .from("work_instructions")
    .update(updatePayload)
    .eq("id", instruction.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await supabaseAdmin.from("instruction_change_events").insert({
    instruction_id: instruction.id,
    actor_user_id: requester.id,
    event_type: "updated",
    detail: updatePayload.last_change_summary,
    revision: instruction.revision,
    occurred_at: nowIso,
    source_payload: {
      kind: "instruction_approval_status",
      previousStatus: instruction.approval_status ?? "pending_review",
      nextStatus: body.status,
      note,
    },
  });

  if (body.status === "approved") {
    await supabaseAdmin.from("instruction_review_status").upsert(
      {
        instruction_id: instruction.id,
        status: "up_to_date",
        last_calibrated_at: nowIso,
        flagged_at: null,
        flagged_by: null,
        updated_by: requester.id,
      },
      { onConflict: "instruction_id" },
    );
  }

  const decisionLabel = body.status === "approved" ? "approved" : "denied";
  const workItem = normalizeWorkItem(instruction.work_items);
  const instructionLabel = workItem
    ? `${workItem.part_id} | ${workItem.item_title}`
    : "A work instruction";
  await sendNotificationEmailsToUsers(supabaseAdmin, {
    recipientUserIds: [
      instruction.created_by,
      instruction.submitted_by ?? "",
      instruction.updated_by,
    ],
    settingKey: "instructionApprovals",
    title: `Work instruction ${decisionLabel}`,
    body: `${instructionLabel} was ${decisionLabel} by ${
      requester.full_name || requester.email
    }.`,
    href: `/instructions/${instruction.id}`,
    actorName: requester.full_name || requester.email,
  });

  return NextResponse.json({ status: body.status });
}
