import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { canEditInstructions } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type ForkMergeMode = "selective" | "overwrite";

interface MergeForkFieldsPayload {
  department?: unknown;
  partId?: unknown;
  itemTitle?: unknown;
  body?: unknown;
  revision?: unknown;
  media?: unknown;
}

interface MergeForkRequestBody {
  mergeMode?: unknown;
  fields?: MergeForkFieldsPayload;
}

interface MergeForkFieldSelection {
  department: boolean;
  partId: boolean;
  itemTitle: boolean;
  body: boolean;
  revision: boolean;
  media: boolean;
}

interface WorkItemLookupRow {
  id: string;
  department_id: string;
  part_id: string;
  item_title: string;
  departments:
    | {
        name: string;
      }
    | Array<{
        name: string;
      }>
    | null;
}

interface InstructionLookupRow {
  id: string;
  work_item_id: string;
  fork_root_instruction_id: string | null;
  fork_number: number | null;
  body_markdown: string;
  revision: number;
  is_archived: boolean;
  merged_into_root_at: string | null;
  merge_count: number;
  work_items: WorkItemLookupRow | WorkItemLookupRow[] | null;
}

interface InstructionMediaRow {
  id: string;
  storage_path: string;
  public_url: string;
  media_type: "image" | "video";
  caption: string | null;
  sort_order: number;
}

const DEFAULT_FIELD_SELECTION: MergeForkFieldSelection = {
  department: false,
  partId: false,
  itemTitle: false,
  body: true,
  revision: true,
  media: false,
};

function normalizeForkMergeMode(value: unknown): ForkMergeMode {
  return value === "overwrite" ? "overwrite" : "selective";
}

function normalizeFieldSelection(value: unknown): MergeForkFieldSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_FIELD_SELECTION;
  }

  const candidate = value as MergeForkFieldsPayload;
  return {
    department: candidate.department === true,
    partId: candidate.partId === true,
    itemTitle: candidate.itemTitle === true,
    body: candidate.body === true,
    revision: candidate.revision === true,
    media: candidate.media === true,
  };
}

function normalizeWorkItemRelation(
  relation: InstructionLookupRow["work_items"],
) {
  if (!relation) {
    return null;
  }

  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }

  return relation;
}

function normalizeDepartmentName(
  relation:
    | WorkItemLookupRow["departments"]
    | null
    | undefined,
) {
  if (!relation) {
    return "Unknown";
  }

  if (Array.isArray(relation)) {
    return relation[0]?.name ?? "Unknown";
  }

  return relation.name;
}

function buildFieldLabelList(fields: MergeForkFieldSelection) {
  const labels: string[] = [];
  if (fields.body) labels.push("body");
  if (fields.revision) labels.push("revision");
  if (fields.partId) labels.push("part id");
  if (fields.itemTitle) labels.push("item title");
  if (fields.department) labels.push("department");
  if (fields.media) labels.push("media");
  return labels;
}

function buildMergeSummary(
  params: {
    mode: ForkMergeMode;
    forkNumber: number;
    fields: MergeForkFieldSelection;
  },
) {
  if (params.mode === "overwrite") {
    return `Fork ${params.forkNumber} overwrote original instruction details.`;
  }

  const labels = buildFieldLabelList(params.fields);
  if (labels.length === 0) {
    return `Fork ${params.forkNumber} merged into original instruction.`;
  }

  return `Fork ${params.forkNumber} merged into original instruction (${labels.join(", ")}).`;
}

function toStorageCopyPath(
  sourcePath: string,
  rootInstructionId: string,
  index: number,
) {
  const normalizedSourcePath = sourcePath.trim();
  const sourceFileName = normalizedSourcePath.split("/").pop() ?? `media-${index + 1}`;
  const extensionMatch = sourceFileName.match(/(\.[a-zA-Z0-9]+)$/);
  const extension = extensionMatch?.[1] ?? "";
  const token =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const dateFolder = new Date().toISOString().slice(0, 10);
  return `merged/${rootInstructionId}/${dateFolder}/${token}${extension}`;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!canEditInstructions(requester.role)) {
    return NextResponse.json(
      { error: "Only editors can merge forked instructions." },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  const requestBody = (await request.json().catch(() => ({}))) as MergeForkRequestBody;
  const mergeMode = normalizeForkMergeMode(requestBody.mergeMode);
  const selectedFields = normalizeFieldSelection(requestBody.fields);
  const mergedFields =
    mergeMode === "overwrite"
      ? {
          department: true,
          partId: true,
          itemTitle: true,
          body: true,
          revision: true,
          media: true,
        }
      : selectedFields;

  if (mergeMode === "selective" && !Object.values(mergedFields).some(Boolean)) {
    return NextResponse.json(
      { error: "Select at least one field to merge." },
      { status: 400 },
    );
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { data: forkInstructionData, error: forkInstructionError } = await supabaseAdmin
    .from("work_instructions")
    .select(
      "id, work_item_id, fork_root_instruction_id, fork_number, body_markdown, revision, is_archived, merged_into_root_at, merge_count, work_items(id, department_id, part_id, item_title, departments(name))",
    )
    .eq("id", id)
    .maybeSingle();

  if (forkInstructionError) {
    return NextResponse.json({ error: forkInstructionError.message }, { status: 500 });
  }

  if (!forkInstructionData) {
    return NextResponse.json({ error: "Instruction not found." }, { status: 404 });
  }

  const forkInstruction = forkInstructionData as InstructionLookupRow;
  const forkWorkItem = normalizeWorkItemRelation(forkInstruction.work_items);
  const forkNumber =
    Number.isInteger(forkInstruction.fork_number) && Number(forkInstruction.fork_number) > 0
      ? Number(forkInstruction.fork_number)
      : null;

  if (!forkInstruction.fork_root_instruction_id || !forkNumber) {
    return NextResponse.json(
      { error: "Only forked instructions can be merged." },
      { status: 400 },
    );
  }

  if (!forkWorkItem) {
    return NextResponse.json(
      { error: "Fork work item details could not be loaded." },
      { status: 404 },
    );
  }

  if (forkInstruction.is_archived) {
    return NextResponse.json(
      { error: "Archived forks cannot be merged." },
      { status: 400 },
    );
  }

  const { data: rootInstructionData, error: rootInstructionError } = await supabaseAdmin
    .from("work_instructions")
    .select(
      "id, work_item_id, fork_root_instruction_id, fork_number, body_markdown, revision, is_archived, merged_into_root_at, merge_count, work_items(id, department_id, part_id, item_title, departments(name))",
    )
    .eq("id", forkInstruction.fork_root_instruction_id)
    .maybeSingle();

  if (rootInstructionError) {
    return NextResponse.json({ error: rootInstructionError.message }, { status: 500 });
  }

  if (!rootInstructionData) {
    return NextResponse.json(
      { error: "Original instruction was not found." },
      { status: 404 },
    );
  }

  const rootInstruction = rootInstructionData as InstructionLookupRow;
  const rootWorkItem = normalizeWorkItemRelation(rootInstruction.work_items);
  if (!rootWorkItem) {
    return NextResponse.json(
      { error: "Original instruction work item details could not be loaded." },
      { status: 404 },
    );
  }

  if (rootInstruction.is_archived) {
    return NextResponse.json(
      { error: "Original instruction is archived and cannot receive merges." },
      { status: 400 },
    );
  }

  let targetWorkItemId = rootInstruction.work_item_id;
  const shouldMergeWorkItemDetails =
    mergedFields.department || mergedFields.partId || mergedFields.itemTitle;

  if (shouldMergeWorkItemDetails) {
    const candidateDepartmentId = mergedFields.department
      ? forkWorkItem.department_id
      : rootWorkItem.department_id;
    const candidatePartId = mergedFields.partId ? forkWorkItem.part_id : rootWorkItem.part_id;
    const candidateItemTitle = mergedFields.itemTitle
      ? forkWorkItem.item_title
      : rootWorkItem.item_title;

    const { data: mergedWorkItemData, error: mergedWorkItemError } = await supabaseAdmin
      .from("work_items")
      .upsert(
        {
          department_id: candidateDepartmentId,
          part_id: candidatePartId,
          item_title: candidateItemTitle,
          created_by: requester.id,
        },
        {
          onConflict: "part_id,item_title,department_id",
        },
      )
      .select("id")
      .single();

    if (mergedWorkItemError || !mergedWorkItemData) {
      return NextResponse.json(
        { error: mergedWorkItemError?.message ?? "Unable to resolve merged work item." },
        { status: 500 },
      );
    }

    targetWorkItemId = (mergedWorkItemData as { id: string }).id;
  }

  const copiedMediaPaths: string[] = [];
  if (mergedFields.media) {
    const [
      { data: forkMediaData, error: forkMediaError },
      { data: rootMediaData, error: rootMediaError },
    ] = await Promise.all([
      supabaseAdmin
        .from("instruction_media")
        .select("id, storage_path, public_url, media_type, caption, sort_order")
        .eq("instruction_id", forkInstruction.id)
        .order("sort_order", { ascending: true }),
      supabaseAdmin
        .from("instruction_media")
        .select("id, storage_path")
        .eq("instruction_id", rootInstruction.id),
    ]);

    if (forkMediaError) {
      return NextResponse.json({ error: forkMediaError.message }, { status: 500 });
    }
    if (rootMediaError) {
      return NextResponse.json({ error: rootMediaError.message }, { status: 500 });
    }

    const forkMediaRows = (forkMediaData ?? []) as InstructionMediaRow[];
    const rootMediaRows = (rootMediaData ?? []) as Array<{ id: string; storage_path: string }>;
    const mediaRowsToInsert: Array<{
      instruction_id: string;
      storage_path: string;
      public_url: string;
      media_type: "image" | "video";
      caption: string | null;
      sort_order: number;
      created_by: string;
    }> = [];

    for (const [index, mediaRow] of forkMediaRows.entries()) {
      const destinationStoragePath = toStorageCopyPath(
        mediaRow.storage_path,
        rootInstruction.id,
        index,
      );
      const { error: copyError } = await supabaseAdmin.storage
        .from("instruction-media")
        .copy(mediaRow.storage_path, destinationStoragePath);

      if (copyError) {
        if (copiedMediaPaths.length > 0) {
          await supabaseAdmin.storage.from("instruction-media").remove(copiedMediaPaths);
        }

        return NextResponse.json(
          { error: `Unable to copy media during merge: ${copyError.message}` },
          { status: 500 },
        );
      }

      copiedMediaPaths.push(destinationStoragePath);
      const { data: publicUrlData } = supabaseAdmin.storage
        .from("instruction-media")
        .getPublicUrl(destinationStoragePath);
      mediaRowsToInsert.push({
        instruction_id: rootInstruction.id,
        storage_path: destinationStoragePath,
        public_url: publicUrlData.publicUrl,
        media_type: mediaRow.media_type,
        caption: mediaRow.caption,
        sort_order: mediaRow.sort_order,
        created_by: requester.id,
      });
    }

    if (rootMediaRows.length > 0) {
      const { error: deleteRootMediaError } = await supabaseAdmin
        .from("instruction_media")
        .delete()
        .eq("instruction_id", rootInstruction.id);

      if (deleteRootMediaError) {
        if (copiedMediaPaths.length > 0) {
          await supabaseAdmin.storage.from("instruction-media").remove(copiedMediaPaths);
        }

        return NextResponse.json({ error: deleteRootMediaError.message }, { status: 500 });
      }
    }

    if (mediaRowsToInsert.length > 0) {
      const { error: insertRootMediaError } = await supabaseAdmin
        .from("instruction_media")
        .insert(mediaRowsToInsert);

      if (insertRootMediaError) {
        if (copiedMediaPaths.length > 0) {
          await supabaseAdmin.storage.from("instruction-media").remove(copiedMediaPaths);
        }

        return NextResponse.json({ error: insertRootMediaError.message }, { status: 500 });
      }
    }
  }

  const mergeSummary = buildMergeSummary({
    mode: mergeMode,
    forkNumber,
    fields: mergedFields,
  });

  const rootUpdatePayload: {
    updated_by: string;
    last_change_summary: string;
    work_item_id?: string;
    body_markdown?: string;
    revision?: number;
  } = {
    updated_by: requester.id,
    last_change_summary: mergeSummary,
  };

  if (shouldMergeWorkItemDetails) {
    rootUpdatePayload.work_item_id = targetWorkItemId;
  }
  if (mergedFields.body) {
    rootUpdatePayload.body_markdown = forkInstruction.body_markdown;
  }
  if (mergedFields.revision) {
    rootUpdatePayload.revision = Math.max(1, forkInstruction.revision);
  }

  const { data: updatedRootInstructionData, error: updatedRootInstructionError } =
    await supabaseAdmin
      .from("work_instructions")
      .update(rootUpdatePayload)
      .eq("id", rootInstruction.id)
      .select("id, revision, updated_at")
      .single();

  if (updatedRootInstructionError) {
    if (updatedRootInstructionError.code === "23505") {
      return NextResponse.json(
        {
          error:
            "Merge would conflict with another active original instruction. Deselect Part ID, title, or department fields and retry.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: updatedRootInstructionError.message },
      { status: 500 },
    );
  }

  const updatedRootInstruction = updatedRootInstructionData as {
    id: string;
    revision: number;
    updated_at: string;
  };
  const mergedAt = updatedRootInstruction.updated_at ?? new Date().toISOString();

  const { error: updateForkStatusError } = await supabaseAdmin
    .from("work_instructions")
    .update({
      merged_into_root_at: mergedAt,
      merge_count: Math.max(0, Number(forkInstruction.merge_count ?? 0)) + 1,
      updated_by: requester.id,
    })
    .eq("id", forkInstruction.id);

  if (updateForkStatusError) {
    return NextResponse.json({ error: updateForkStatusError.message }, { status: 500 });
  }

  const mergeEventPayload = {
    kind: "fork_merge",
    mode: mergeMode,
    forkInstructionId: forkInstruction.id,
    forkNumber,
    rootInstructionId: rootInstruction.id,
    fields: mergedFields,
    forkPartId: forkWorkItem.part_id,
    forkItemTitle: forkWorkItem.item_title,
    forkDepartmentName: normalizeDepartmentName(forkWorkItem.departments),
  };

  const { error: mergeEventError } = await supabaseAdmin
    .from("instruction_change_events")
    .upsert(
      {
        instruction_id: rootInstruction.id,
        actor_user_id: requester.id,
        event_type: "updated",
        detail: mergeSummary,
        revision: updatedRootInstruction.revision,
        occurred_at: mergedAt,
        source_payload: mergeEventPayload,
      },
      {
        onConflict: "instruction_id,event_type,actor_user_id,occurred_at",
      },
    );

  if (mergeEventError) {
    return NextResponse.json({ error: mergeEventError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    rootInstructionId: rootInstruction.id,
    mergedAt,
    mode: mergeMode,
    mergedFields,
  });
}
