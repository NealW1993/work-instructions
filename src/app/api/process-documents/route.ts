import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { recordAiUsageEvent } from "@/lib/ai-usage";
import {
  type ProcessDocumentSourceType,
  type ProcessDocumentStatus,
  type ProcessDocumentType,
  isProcessDocumentStatus,
  isProcessDocumentType,
  normalizeIsoClauseRefs,
} from "@/lib/process-documents";
import { canEditInstructions, hasFullAccess } from "@/lib/roles";
import {
  hasMeaningfulRichText,
  sanitizeRichHtml,
} from "@/lib/rich-text.server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AppRole } from "@/lib/types";

interface ProcessDocumentRequestBody {
  documentNumber?: unknown;
  title?: unknown;
  documentType?: unknown;
  status?: unknown;
  departmentId?: unknown;
  ownerUserId?: unknown;
  processName?: unknown;
  processPurpose?: unknown;
  processScope?: unknown;
  processInputs?: unknown;
  processOutputs?: unknown;
  processRisks?: unknown;
  processControls?: unknown;
  isoClauseRefs?: unknown;
  relatedInstructionIds?: unknown;
  bodyHtml?: unknown;
  processMapPayload?: unknown;
  documentCoverImageDataUrl?: unknown;
  documentCoverImageName?: unknown;
  changeSummary?: unknown;
  sourceType?: unknown;
  templateId?: unknown;
  importedFileName?: unknown;
  importedFileType?: unknown;
  importedFileSize?: unknown;
}

interface InsertedDocumentRow {
  id: string;
  created_at: string;
}

interface InsertedRevisionRow {
  id: string;
  created_at: string;
}

const DEFAULT_NEXT_REVIEW_DAYS = 365;
const MAX_COVER_IMAGE_DATA_URL_LENGTH = 500_000;

function normalizeString(value: unknown, maxLength = 5000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeNullableUuid(value: unknown) {
  const normalized = normalizeString(value, 80);
  if (!normalized) {
    return null;
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    normalized,
  )
    ? normalized
    : null;
}

function normalizeUuidArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((entry) => normalizeNullableUuid(entry))
        .filter((entry): entry is string => Boolean(entry)),
    ),
  );
}

function normalizeSourceType(value: unknown): ProcessDocumentSourceType {
  return value === "template" || value === "import" ? value : "manual";
}

function normalizeJsonObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function normalizeImportedFileSize(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.round(value);
}

function normalizeCoverImageDataUrl(value: unknown) {
  const normalized = normalizeString(value, MAX_COVER_IMAGE_DATA_URL_LENGTH);
  if (!normalized) {
    return "";
  }

  return /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(normalized)
    ? normalized
    : "";
}

function nextReviewDate(now: Date) {
  const next = new Date(now);
  next.setDate(next.getDate() + DEFAULT_NEXT_REVIEW_DAYS);
  return next.toISOString();
}

function normalizeRequestedStatus(
  value: unknown,
  requesterRole: AppRole,
): ProcessDocumentStatus | { error: string } {
  const status: ProcessDocumentStatus = isProcessDocumentStatus(value) ? value : "draft";

  if (status === "obsolete" && !hasFullAccess(requesterRole)) {
    return { error: "Only admins can obsolete controlled documents." };
  }

  return status;
}

function getApprovalReadinessIssues(input: {
  processScope: string;
  processControls: string;
  ownerUserId: string | null;
  isoClauseRefs: string[];
  sourceType: ProcessDocumentSourceType;
  importedFileName: string | null;
}) {
  const issues: string[] = [];

  if (!input.ownerUserId) {
    issues.push("owner");
  }
  if (!input.processScope) {
    issues.push("process scope");
  }
  if (!input.processControls) {
    issues.push("controls and measures");
  }
  if (!input.isoClauseRefs.includes("7.5 Documented information")) {
    issues.push("ISO 9001 clause 7.5 mapping");
  }
  if (input.sourceType === "import" && !input.importedFileName) {
    issues.push("imported source file metadata");
  }

  return issues;
}

export async function POST(request: NextRequest) {
  const requester = await getRequestProfile(request);

  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!canEditInstructions(requester.role)) {
    return NextResponse.json(
      { error: "Only admins and system admins can create controlled documents." },
      { status: 403 },
    );
  }

  const requestBody = (await request.json().catch(() => ({}))) as ProcessDocumentRequestBody;
  const documentNumber = normalizeString(requestBody.documentNumber, 80);
  const title = normalizeString(requestBody.title, 180);
  const documentType: ProcessDocumentType = isProcessDocumentType(requestBody.documentType)
    ? requestBody.documentType === "work_instruction"
      ? "procedure"
      : requestBody.documentType
    : "procedure";
  const requestedStatus = normalizeRequestedStatus(requestBody.status, requester.role);
  const bodyHtml = sanitizeRichHtml(normalizeString(requestBody.bodyHtml, 900_000)).trim();
  const changeSummary =
    normalizeString(requestBody.changeSummary, 500) || "Initial controlled document revision.";
  const sourceType = normalizeSourceType(requestBody.sourceType);
  const templateId = normalizeNullableUuid(requestBody.templateId);
  const departmentId = normalizeNullableUuid(requestBody.departmentId);
  const ownerUserId = normalizeNullableUuid(requestBody.ownerUserId) ?? requester.id;
  const processScope = normalizeString(requestBody.processScope, 4000);
  const processPurpose =
    normalizeString(requestBody.processPurpose, 4000) || processScope;
  const processControls = normalizeString(requestBody.processControls, 4000);
  const processMapPayload = normalizeJsonObject(requestBody.processMapPayload);
  const isoClauseRefs = normalizeIsoClauseRefs(requestBody.isoClauseRefs);
  const documentCoverImageDataUrl = normalizeCoverImageDataUrl(
    requestBody.documentCoverImageDataUrl,
  );
  const documentCoverImageName = documentCoverImageDataUrl
    ? normalizeString(requestBody.documentCoverImageName, 260)
    : "";
  const importedFileName =
    sourceType === "import" ? normalizeString(requestBody.importedFileName, 260) : null;
  const importedFileType =
    sourceType === "import" ? normalizeString(requestBody.importedFileType, 120) : null;
  const importedFileSize =
    sourceType === "import" ? normalizeImportedFileSize(requestBody.importedFileSize) : null;
  const now = new Date();

  if (typeof requestedStatus !== "string") {
    return NextResponse.json({ error: requestedStatus.error }, { status: 403 });
  }

  if (!documentNumber) {
    return NextResponse.json({ error: "Document number is required." }, { status: 400 });
  }

  if (!title) {
    return NextResponse.json({ error: "Document title is required." }, { status: 400 });
  }

  if (!hasMeaningfulRichText(bodyHtml)) {
    return NextResponse.json({ error: "Document body is required." }, { status: 400 });
  }

  if (requestedStatus === "approved") {
    const approvalIssues = getApprovalReadinessIssues({
      processScope,
      processControls,
      ownerUserId,
      isoClauseRefs,
      sourceType,
      importedFileName,
    });

    if (approvalIssues.length > 0) {
      return NextResponse.json(
        { error: `Approval requires: ${approvalIssues.join(", ")}.` },
        { status: 400 },
      );
    }
  }

  const approvalFields =
    requestedStatus === "approved"
      ? {
          approved_by: requester.id,
          approved_at: now.toISOString(),
        }
      : {
          approved_by: null,
          approved_at: null,
        };

  const supabaseAdmin = getSupabaseAdminClient();
  const { data: insertedDocument, error: insertError } = await supabaseAdmin
    .from("process_documents")
    .insert({
      document_number: documentNumber,
      title,
      document_type: documentType,
      status: "draft",
      department_id: departmentId,
      owner_user_id: ownerUserId,
      process_name: normalizeString(requestBody.processName, 180),
      process_purpose: processPurpose,
      process_scope: processScope,
      process_inputs: normalizeString(requestBody.processInputs, 4000),
      process_outputs: normalizeString(requestBody.processOutputs, 4000),
      process_risks: normalizeString(requestBody.processRisks, 4000),
      process_controls: processControls,
      related_instruction_ids: normalizeUuidArray(requestBody.relatedInstructionIds),
      iso_clause_refs: isoClauseRefs,
      document_cover_image_data_url: documentCoverImageDataUrl,
      document_cover_image_name: documentCoverImageName,
      process_map_payload: processMapPayload,
      current_revision: 1,
      created_by: requester.id,
      updated_by: requester.id,
    })
    .select("id, created_at")
    .single<InsertedDocumentRow>();

  if (insertError || !insertedDocument) {
    return NextResponse.json(
      { error: insertError?.message ?? "Unable to create controlled document." },
      { status: 500 },
    );
  }

  const { data: insertedRevision, error: revisionError } = await supabaseAdmin
    .from("process_document_revisions")
    .insert({
      document_id: insertedDocument.id,
      revision: 1,
      title,
      body_html: bodyHtml,
      change_summary: changeSummary,
      source_type: sourceType,
      template_id: sourceType === "template" ? templateId : null,
      imported_file_name: importedFileName,
      imported_file_type: importedFileType,
      imported_file_size: importedFileSize,
      process_map_payload: processMapPayload,
      prepared_by: requester.id,
      ...approvalFields,
    })
    .select("id, created_at")
    .single<InsertedRevisionRow>();

  if (revisionError || !insertedRevision) {
    return NextResponse.json(
      { error: revisionError?.message ?? "Unable to create document revision." },
      { status: 500 },
    );
  }

  if (requestedStatus !== "draft") {
    const statusUpdate =
      requestedStatus === "approved"
        ? {
            status: requestedStatus,
            approved_by: requester.id,
            approved_at: now.toISOString(),
            effective_at: now.toISOString(),
            next_review_at: nextReviewDate(now),
            updated_by: requester.id,
          }
        : {
            status: requestedStatus,
            approved_by: null,
            approved_at: null,
            effective_at: null,
            next_review_at: null,
            updated_by: requester.id,
          };

    const { error: statusError } = await supabaseAdmin
      .from("process_documents")
      .update(statusUpdate)
      .eq("id", insertedDocument.id);

    if (statusError) {
      return NextResponse.json({ error: statusError.message }, { status: 500 });
    }
  }

  const usageMetadata = {
    documentNumber,
    title,
    documentType,
    status: requestedStatus,
    sourceType,
    templateId,
    importedFileName,
    importedFileType,
    importedFileSize,
    revision: 1,
  };

  await recordAiUsageEvent({
    actorUserId: requester.id,
    feature: "process_document_create",
    action: requestedStatus,
    mode: sourceType,
    subjectType: "process_document",
    subjectId: insertedDocument.id,
    metadata: usageMetadata,
    createdAt: insertedDocument.created_at,
  });

  await recordAiUsageEvent({
    actorUserId: requester.id,
    feature: "process_document_revision",
    action: "revision_1",
    mode: sourceType,
    subjectType: "process_document",
    subjectId: insertedDocument.id,
    metadata: {
      ...usageMetadata,
      revisionId: insertedRevision.id,
    },
    createdAt: insertedRevision.created_at,
  });

  if (sourceType === "template" || sourceType === "import") {
    await recordAiUsageEvent({
      actorUserId: requester.id,
      feature:
        sourceType === "template" ? "process_document_template" : "process_document_import",
      action: "revision_1",
      mode: sourceType,
      subjectType: "process_document",
      subjectId: insertedDocument.id,
      metadata: {
        ...usageMetadata,
        revisionId: insertedRevision.id,
      },
      createdAt: insertedRevision.created_at,
    });
  }

  return NextResponse.json({
    documentId: insertedDocument.id,
    revision: 1,
    status: requestedStatus,
  });
}
