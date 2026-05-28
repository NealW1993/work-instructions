import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { ISO_9001_CLAUSE_OPTIONS } from "@/lib/process-documents";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface ImportInstructionBody {
  departmentId?: unknown;
  partId?: unknown;
  itemTitle?: unknown;
  revision?: unknown;
  fileName?: unknown;
  contentType?: unknown;
  fileSize?: unknown;
  contentBase64?: unknown;
}

const MAX_IMPORT_BYTES = 15 * 1024 * 1024;
const BASE64_PATTERN = /^[a-zA-Z0-9+/]+={0,2}$/;

function normalizeText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value, 80);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(
    normalized,
  )
    ? normalized
    : "";
}

function normalizeRevision(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as ImportInstructionBody;
  const departmentId = normalizeUuid(body.departmentId);
  const partId = normalizeText(body.partId, 120);
  const itemTitle = normalizeText(body.itemTitle, 160);
  const revision = normalizeRevision(body.revision);
  const fileName = normalizeText(body.fileName, 240);
  const contentType = normalizeText(body.contentType, 160) || "application/octet-stream";
  const fileSize = typeof body.fileSize === "number" ? body.fileSize : Number(body.fileSize ?? 0);
  const contentBase64 = typeof body.contentBase64 === "string" ? body.contentBase64.trim() : "";

  if (!departmentId || !partId || !itemTitle || !revision) {
    return NextResponse.json(
      { error: "Department, Part ID, Work Item Title, and Revision are required." },
      { status: 400 },
    );
  }

  if (!fileName || !contentBase64 || !BASE64_PATTERN.test(contentBase64)) {
    return NextResponse.json({ error: "A valid source file is required." }, { status: 400 });
  }

  if (!Number.isFinite(fileSize) || fileSize < 1 || fileSize > MAX_IMPORT_BYTES) {
    return NextResponse.json({ error: "Imported files must be 15 MB or smaller." }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { data: department } = await supabaseAdmin
    .from("departments")
    .select("id")
    .eq("id", departmentId)
    .maybeSingle<{ id: string }>();

  if (!department) {
    return NextResponse.json({ error: "Department not found." }, { status: 404 });
  }

  const { data: existingWorkItem, error: existingWorkItemError } = await supabaseAdmin
    .from("work_items")
    .select("id")
    .eq("department_id", departmentId)
    .eq("part_id", partId)
    .eq("item_title", itemTitle)
    .maybeSingle<{ id: string }>();

  if (existingWorkItemError) {
    return NextResponse.json(
      { error: existingWorkItemError.message ?? "Unable to read work item." },
      { status: 500 },
    );
  }

  const workItem =
    existingWorkItem ??
    (
      await supabaseAdmin
        .from("work_items")
        .insert({
          department_id: departmentId,
          part_id: partId,
          item_title: itemTitle,
          created_by: requester.id,
        })
        .select("id")
        .single<{ id: string }>()
    ).data;

  if (!workItem) {
    return NextResponse.json({ error: "Unable to create work item." }, { status: 500 });
  }

  const now = new Date().toISOString();
  const importSummary = `Imported source document ${fileName}.`;
  const bodyMarkdown = [
    `Imported source document: ${fileName}`,
    "",
    "Open the imported source file below to view the work instruction in its original format.",
  ].join("\n");

  const { data: instruction, error: instructionError } = await supabaseAdmin
    .from("work_instructions")
    .insert({
      work_item_id: workItem.id,
      body_markdown: bodyMarkdown,
      notes_markdown: "",
      uncommon_tools: "",
      iso_clause_refs: ISO_9001_CLAUSE_OPTIONS.filter((clause) =>
        ["7.5 Documented information", "8.5 Production and service provision"].includes(clause),
      ),
      process_scope: "Imported work instruction retained as an original source document.",
      acceptance_criteria: "Imported document requires review and approval before controlled use.",
      verification_records: `Original source file retained: ${fileName}`,
      risk_controls: "Do not use imported work instruction as approved until review is complete.",
      revision,
      last_change_summary: importSummary,
      approval_status: "pending_review",
      submitted_by: requester.id,
      submitted_at: now,
      approved_by: null,
      approved_at: null,
      rejected_by: null,
      rejected_at: null,
      approval_note: "",
      created_by: requester.id,
      updated_by: requester.id,
    })
    .select("id, created_at")
    .single<{ id: string; created_at: string }>();

  if (instructionError || !instruction) {
    return NextResponse.json(
      { error: instructionError?.message ?? "Unable to create imported instruction." },
      { status: 500 },
    );
  }

  const { error: fileError } = await supabaseAdmin.from("work_instruction_import_files").insert({
    instruction_id: instruction.id,
    file_name: fileName,
    content_type: contentType,
    file_size: fileSize,
    content_base64: contentBase64,
    created_by: requester.id,
  });

  if (fileError) {
    await supabaseAdmin.from("work_instructions").delete().eq("id", instruction.id);
    return NextResponse.json(
      { error: fileError.message ?? "Unable to store imported source file." },
      { status: 500 },
    );
  }

  await supabaseAdmin.from("instruction_change_events").upsert(
    {
      instruction_id: instruction.id,
      actor_user_id: requester.id,
      event_type: "created",
      detail: importSummary,
      revision,
      occurred_at: instruction.created_at,
      source_payload: {
        kind: "instruction_imported",
        fileName,
        contentType,
        fileSize,
        partId,
        itemTitle,
      },
    },
    {
      onConflict: "instruction_id,event_type,actor_user_id,occurred_at",
    },
  );

  return NextResponse.json({ instructionId: instruction.id });
}
