import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getRequestProfile } from "@/lib/api-auth";
import { recordAiUsageEvent } from "@/lib/ai-usage";
import { sendNotificationEmailsToRoles, sendNotificationEmailsToUsers } from "@/lib/notification-email.server";
import { isProcessDocumentStatus, isProcessDocumentType, normalizeIsoClauseRefs } from "@/lib/process-documents";
import { canApproveControlledDocuments, hasFullAccess } from "@/lib/roles";
import { hasMeaningfulRichText, sanitizeRichHtml } from "@/lib/rich-text.server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { STALE_RECORD_ERROR_CODE } from "@/lib/supabase/constants";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_IMPORT_BYTES = 15 * 1024 * 1024;
function string(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
function uuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}
function uuidArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(uuid).filter((entry): entry is string => entry !== null))].sort() : [];
}
interface SaveResult {
  documentId: string; revision: number; revisionId: string; status: string;
  previousStatus: string | null; revisionChanged: boolean; createdBy: string;
  ownerUserId: string | null; createdAt: string; updatedAt: string;
}

/** Content, source evidence, access rules and lifecycle stamps commit together. */
export async function saveProcessDocument(request: NextRequest, documentId: string | null) {
  const requester = await getRequestProfile(request);
  if (!requester) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (documentId !== null && !uuid(documentId)) return NextResponse.json({ error: "Invalid document id." }, { status: 400 });
  const rawBody: unknown = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return NextResponse.json({ error: "A document object is required." }, { status: 400 });
  }
  const body = rawBody as Record<string, unknown>;
  const status = body.status ?? "draft";
  if (!isProcessDocumentStatus(status)) return NextResponse.json({ error: "Invalid document status." }, { status: 400 });
  if ((status === "approved" && !canApproveControlledDocuments(requester.role)) || (status === "obsolete" && !hasFullAccess(requester.role))) {
    return NextResponse.json({ error: "Only admins can approve or obsolete controlled documents." }, { status: 403 });
  }
  if (!isProcessDocumentType(body.documentType)) return NextResponse.json({ error: "A valid document type is required." }, { status: 400 });
  if (typeof body.bodyHtml !== "string" || body.bodyHtml.length > 900_000) {
    return NextResponse.json({ error: "Document body is required and must be no more than 900,000 characters." }, { status: 400 });
  }
  const documentNumber = string(body.documentNumber, 80);
  const title = string(body.title, 180);
  const bodyHtml = sanitizeRichHtml(body.bodyHtml).trim();
  if (!documentNumber || !title || !hasMeaningfulRichText(bodyHtml)) {
    return NextResponse.json({ error: "Document number, title, and document body are required." }, { status: 400 });
  }
  if (documentId && (!Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 1 || typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt)))) {
    return NextResponse.json({ error: "Reload the document before saving so its revision can be verified." }, { status: 409 });
  }
  const sourceType = body.sourceType ?? "manual";
  if (sourceType !== "manual" && sourceType !== "template" && sourceType !== "import") return NextResponse.json({ error: "Invalid document source type." }, { status: 400 });
  const cover = typeof body.documentCoverImageDataUrl === "string" ? body.documentCoverImageDataUrl.trim() : "";
  if (cover && (cover.length > 500_000 || !/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(cover))) {
    return NextResponse.json({ error: "The document cover must be a PNG, JPEG, WebP, or GIF image under 350 KB." }, { status: 400 });
  }
  if (body.accessGroupIds !== undefined && (!Array.isArray(body.accessGroupIds) || body.accessGroupIds.some((entry) => !uuid(entry)))) {
    return NextResponse.json({ error: "One or more access group ids are invalid." }, { status: 400 });
  }
  for (const key of ["departmentId", "ownerUserId", "templateId"] as const) {
    if (body[key] && !uuid(body[key])) return NextResponse.json({ error: `Invalid ${key}.` }, { status: 400 });
  }
  let importFile: Record<string, unknown> | null = null;
  if (sourceType === "import" && body.importedFileDataBase64 != null) {
    if (typeof body.importedFileDataBase64 !== "string" || body.importedFileDataBase64.length > 22_000_000) return NextResponse.json({ error: "Imported source file exceeds the 15 MB limit." }, { status: 400 });
    const base64 = body.importedFileDataBase64.replace(/\s+/g, "");
    if (!base64 || base64.length % 4 !== 0 || !/^[a-z0-9+/]+={0,2}$/i.test(base64)) return NextResponse.json({ error: "Imported source file content is not valid base64." }, { status: 400 });
    const bytes = Buffer.from(base64, "base64");
    const fileName = string(body.importedFileName, 260);
    if (!fileName || bytes.length === 0 || bytes.length > MAX_IMPORT_BYTES || bytes.toString("base64") !== base64) return NextResponse.json({ error: "A valid imported source file of no more than 15 MB is required." }, { status: 400 });
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (body.importedFileSha256 && body.importedFileSha256 !== hash) return NextResponse.json({ error: "Imported source file checksum does not match its content. Import the file again." }, { status: 400 });
    importFile = { file_name: fileName, content_type: string(body.importedFileType, 120) || "application/octet-stream", file_size: bytes.length, file_sha256: hash, content_base64: base64 };
  }
  if (sourceType === "import" && !documentId && !importFile) return NextResponse.json({ error: "Imported source file content is required for retention." }, { status: 400 });
  const processScope = string(body.processScope, 4000);
  const processControls = string(body.processControls, 4000);
  const isoClauseRefs = normalizeIsoClauseRefs(body.isoClauseRefs);
  if (status === "approved" && (!processScope || !processControls || !isoClauseRefs.includes("7.5 Documented information"))) return NextResponse.json({ error: "Approval requires process scope, controls and measures, and the ISO clause 7.5 mapping." }, { status: 400 });
  const supabaseAdmin = getSupabaseAdminClient();
  const { data, error } = await supabaseAdmin.rpc("save_process_document_controlled", {
    p_actor_user_id: requester.id, p_document_id: documentId,
    p_expected_revision: documentId ? body.expectedRevision : null,
    p_expected_updated_at: documentId ? body.expectedUpdatedAt : null,
    p_document: {
      document_number: documentNumber, title, document_type: body.documentType, status,
      department_id: uuid(body.departmentId), owner_user_id: uuid(body.ownerUserId) ?? requester.id,
      process_name: string(body.processName, 180),
      ...(body.processPurpose !== undefined ? { process_purpose: string(body.processPurpose, 4000) } : {}),
      ...(body.processMapPayload !== undefined ? { process_map_payload: body.processMapPayload } : {}),
      process_scope: processScope, process_inputs: string(body.processInputs, 4000), process_outputs: string(body.processOutputs, 4000),
      process_risks: string(body.processRisks, 4000), process_controls: processControls,
      related_instruction_ids: uuidArray(body.relatedInstructionIds), iso_clause_refs: isoClauseRefs,
      document_cover_image_data_url: cover, document_cover_image_name: cover ? string(body.documentCoverImageName, 260) : "",
    },
    p_revision: {
      body_html: bodyHtml, change_summary: string(body.changeSummary, 500), source_type: sourceType,
      template_id: sourceType === "template" ? uuid(body.templateId) : null,
      imported_file_name: sourceType === "import" ? string(body.importedFileName, 260) : null,
      imported_file_type: sourceType === "import" ? string(body.importedFileType, 120) : null,
      imported_file_size: sourceType === "import" && Number.isSafeInteger(body.importedFileSize) ? body.importedFileSize : null,
    },
    p_import_file: importFile, p_access_group_ids: uuidArray(body.accessGroupIds),
  });
  if (error) {
    const responseStatus = error.code === STALE_RECORD_ERROR_CODE || error.code === "23505" ? 409 : error.code === "42501" ? 403 : error.code === "P0002" ? 404 : ["22023", "23503", "23514"].includes(error.code) ? 400 : 500;
    const message = error.code === "23505" ? "That document number is already in use. Choose a unique document number." : error.code === "PGRST202" ? "Document control database update is required before saving. Contact your system administrator." : error.message;
    return NextResponse.json({ error: message }, { status: responseStatus });
  }
  const saved = data as SaveResult;
  // A delivery outage must not turn a committed save into a failed save.
  try {
    if (saved.previousStatus !== status && status === "in_review") await sendNotificationEmailsToRoles(supabaseAdmin, {
      roles: ["admin", "system_admin"], settingKey: "pendingApprovals", title: "Document pending approval",
      body: `${documentNumber} | ${title} was submitted for review.`, href: `/process-documents?doc=${saved.documentId}`, actorName: requester.full_name || requester.email,
    });
    if (saved.previousStatus !== status && (status === "approved" || status === "obsolete")) await sendNotificationEmailsToUsers(supabaseAdmin, {
      recipientUserIds: [saved.createdBy, saved.ownerUserId ?? ""], settingKey: "documentApprovals", title: `Document ${status}`,
      body: `${documentNumber} | ${title} was ${status} by ${requester.full_name || requester.email}.`, href: `/process-documents?doc=${saved.documentId}`, actorName: requester.full_name || requester.email,
    });
    if (saved.revisionChanged) await recordAiUsageEvent({
      actorUserId: requester.id, feature: documentId ? "process_document_revision" : "process_document_create", action: `revision_${saved.revision}`,
      mode: sourceType, subjectType: "process_document", subjectId: saved.documentId,
      metadata: { documentNumber, title, documentType: body.documentType, status, sourceType, revision: saved.revision, revisionId: saved.revisionId }, createdAt: saved.createdAt,
    });
  } catch (deliveryError) {
    console.error("Controlled document saved; notification or analytics delivery failed.", deliveryError);
  }
  return NextResponse.json(saved, { status: documentId ? 200 : 201 });
}
