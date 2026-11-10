import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { sendNotificationEmailsToUsers } from "@/lib/notification-email.server";
import { hasFullAccess } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { STALE_RECORD_ERROR_CODE } from "@/lib/supabase/constants";
import type { InstructionApprovalStatus } from "@/lib/types";

interface ApprovalRequestBody {
  status?: unknown;
  note?: unknown;
  expectedUpdatedAt?: unknown;
}

interface InstructionRecord {
  id: string;
  revision: number;
  updated_at: string;
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

  const supabaseAdmin = getSupabaseAdminClient();
  const { data: instruction, error: instructionError } = await supabaseAdmin
    .from("work_instructions")
    .select("id, revision, updated_at, approval_status, is_archived, created_by, submitted_by, updated_by, work_items(part_id, item_title)")
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

  if (typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) {
    return NextResponse.json({ error: "The reviewed version is required. Refresh the instruction." }, { status: 400 });
  }
  if (body.status === "rejected" && !note) {
    return NextResponse.json({ error: "Enter a reason so the author knows what to change." }, { status: 400 });
  }
  const { error: decisionError } = await supabaseAdmin.rpc("decide_work_instruction", {
    p_id: instruction.id, p_actor: requester.id, p_status: body.status,
    p_note: note, p_expected_updated_at: body.expectedUpdatedAt,
  });
  if (decisionError) {
    const status = decisionError.code === STALE_RECORD_ERROR_CODE ? 409 : decisionError.code === "42501" ? 403 : decisionError.code === "23514" ? 400 : 500;
    return NextResponse.json({ error: decisionError.message }, { status });
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
