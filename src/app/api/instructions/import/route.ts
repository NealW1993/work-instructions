import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { canCreateInstructions } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { STALE_RECORD_ERROR_CODE } from "@/lib/supabase/constants";

const MAX_IMPORT_BYTES = 15 * 1024 * 1024;
function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}
function uuid(value: unknown) {
  // 8-4-4-4-12 hexadecimal groups. (The previous pattern was missing a group and rejected every id.)
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

export async function POST(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canCreateInstructions(requester.role)) return NextResponse.json({ error: "Your role cannot import work instructions." }, { status: 403 });
  const rawBody: unknown = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) return NextResponse.json({ error: "An import object is required." }, { status: 400 });
  const body = rawBody as Record<string, unknown>;
  const departmentId = uuid(body.departmentId);
  const partId = text(body.partId, 120);
  const itemTitle = text(body.itemTitle, 160);
  const revision = typeof body.revision === "number" ? body.revision : typeof body.revision === "string" && /^\d+$/.test(body.revision) ? Number(body.revision) : NaN;
  if (!departmentId || !partId || !itemTitle || !Number.isSafeInteger(revision) || revision < 1 || revision > 2147483647) {
    return NextResponse.json({ error: "Department, Part ID, title, and a positive whole-number revision are required." }, { status: 400 });
  }
  const fileName = text(body.fileName, 240);
  const contentType = text(body.contentType, 160) || "application/octet-stream";
  const contentBase64 = typeof body.contentBase64 === "string" ? body.contentBase64.trim() : "";
  if (!fileName || !contentBase64 || contentBase64.length > Math.ceil(MAX_IMPORT_BYTES / 3) * 4
    || contentBase64.length % 4 !== 0 || !/^[a-z0-9+/]+={0,2}$/i.test(contentBase64)) {
    return NextResponse.json({ error: "A valid source file of no more than 15 MB is required." }, { status: 400 });
  }
  const bytes = Buffer.from(contentBase64, "base64");
  if (!bytes.length || bytes.length > MAX_IMPORT_BYTES || bytes.toString("base64") !== contentBase64
    || !Number.isSafeInteger(body.fileSize) || body.fileSize !== bytes.length) {
    return NextResponse.json({ error: "The source file size does not match its content. Select the original file again." }, { status: 400 });
  }
  const { data, error } = await getSupabaseAdminClient().rpc("import_work_instruction_controlled", {
    p_actor: requester.id,
    p_metadata: {
      departmentId, partId, itemTitle, revision,
      bodyMarkdown: `Imported source document: ${fileName}\n\nOpen the retained original source file below. Review and approval are required before production use.`,
      uncommonTools: "", suggestedToolIds: [],
      isoClauseRefs: ["7.5 Documented information", "8.5 Production and service provision"],
      processScope: "Imported work instruction retained as an original source document.",
      acceptanceCriteria: "Review the original document and verify its acceptance criteria before controlled release.",
      verificationRecords: `Original source file retained: ${fileName}`,
      riskControls: "Do not use this instruction for production until review and approval are complete.",
      changeSummary: `Imported source document ${fileName}.`,
    },
    p_file: { file_name: fileName, content_type: contentType, file_size: bytes.length, content_base64: contentBase64 },
  });
  if (error) {
    const status = error.code === "23505" || error.code === STALE_RECORD_ERROR_CODE ? 409 : error.code === "42501" ? 403 : ["23503", "23514", "22023", "22P02"].includes(error.code) ? 400 : 500;
    return NextResponse.json({ error: error.code === "PGRST202" ? "The document-control database update is required before importing. Contact your administrator." : error.message }, { status });
  }
  return NextResponse.json(data, { status: 201 });
}
