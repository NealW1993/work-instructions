import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { hasFullAccess } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface ImportFileRecord {
  id: string;
  document_id: string;
  file_name: string;
  content_type: string;
  content_base64: string;
  process_document_revisions: { revision: number } | Array<{ revision: number }> | null;
  process_documents:
    | {
        status: string;
        created_by: string;
        owner_user_id: string | null;
      }
    | Array<{
        status: string;
        created_by: string;
        owner_user_id: string | null;
      }>
    | null;
}

function normalizeRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function sanitizeDownloadName(value: string) {
  return value.replace(/[^\w.\- ()]+/g, "_").slice(0, 180) || "document";
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requester = await getRequestProfile(request);

  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const supabaseAdmin = getSupabaseAdminClient();
  const { data: file, error } = await supabaseAdmin
    .from("process_document_import_files")
    .select("id, document_id, file_name, content_type, content_base64, process_document_revisions(revision), process_documents(status, created_by, owner_user_id)")
    .eq("id", id)
    .maybeSingle<ImportFileRecord>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!file) {
    return NextResponse.json({ error: "Imported file not found." }, { status: 404 });
  }

  const document = normalizeRelation(file.process_documents);
  let canAccess =
    hasFullAccess(requester.role) ||
    document?.created_by === requester.id ||
    document?.owner_user_id === requester.id;
  if (!canAccess) {
    const { data: releasedDocument, error: releaseError } = await supabaseAdmin
      .rpc("list_process_documents_controlled", { p_actor_user_id: requester.id })
      .select("current_revision, status")
      .eq("id", file.document_id)
      .maybeSingle<{ current_revision: number; status: string }>();
    if (releaseError) return NextResponse.json({ error: releaseError.message }, { status: 500 });
    const fileRevision = normalizeRelation(file.process_document_revisions);
    canAccess = releasedDocument?.status === "approved" && releasedDocument.current_revision === fileRevision?.revision;
  }

  if (!canAccess) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const bytes = Buffer.from(file.content_base64, "base64");
  const fileName = sanitizeDownloadName(file.file_name);

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": file.content_type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
