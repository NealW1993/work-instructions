import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { sendNotificationEmailsToRoles } from "@/lib/notification-email.server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { InstructionApprovalStatus } from "@/lib/types";

interface RequestBody {
  instructionId?: unknown;
}

interface InstructionRow {
  id: string;
  approval_status: InstructionApprovalStatus | null;
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

function normalizeUuid(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    normalized,
  )
    ? normalized
    : null;
}

function normalizeWorkItem(relation: InstructionRow["work_items"]) {
  if (!relation) {
    return null;
  }

  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

export async function POST(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as RequestBody;
  const instructionId = normalizeUuid(body.instructionId);
  if (!instructionId) {
    return NextResponse.json({ error: "Valid instructionId is required." }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { data: instruction, error } = await supabaseAdmin
    .from("work_instructions")
    .select("id, approval_status, created_by, submitted_by, updated_by, work_items(part_id, item_title)")
    .eq("id", instructionId)
    .maybeSingle<InstructionRow>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!instruction || instruction.approval_status !== "pending_review") {
    return NextResponse.json({ success: true });
  }

  const isSubmitter =
    instruction.created_by === requester.id ||
    instruction.submitted_by === requester.id ||
    instruction.updated_by === requester.id;

  if (!isSubmitter) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const workItem = normalizeWorkItem(instruction.work_items);
  await sendNotificationEmailsToRoles(supabaseAdmin, {
    roles: ["admin", "system_admin"],
    settingKey: "pendingApprovals",
    title: "Work instruction pending approval",
    body: workItem
      ? `${workItem.part_id} | ${workItem.item_title} was submitted for review.`
      : "A work instruction was submitted for review.",
    href: `/instructions/${instruction.id}`,
    actorName: requester.full_name || requester.email,
  });

  return NextResponse.json({ success: true });
}
