import { NextRequest, NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

interface ImportedFileRow {
  id: string;
  file_name: string;
  content_type: string;
  file_size: number;
  content_base64: string;
}

function normalizeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? value
    : null;
}

function contentDispositionFileName(fileName: string) {
  return fileName.replace(/[\r\n"]/g, "_");
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const fileId = normalizeUuid(id);
  if (!fileId) {
    return NextResponse.json({ error: "Invalid file id." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("work_instruction_import_files")
    .select("id, file_name, content_type, file_size, content_base64")
    .eq("id", fileId)
    .maybeSingle<ImportedFileRow>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const bytes = Buffer.from(data.content_base64, "base64");
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": data.content_type || "application/octet-stream",
      "Content-Length": String(data.file_size || bytes.byteLength),
      "Content-Disposition": `inline; filename="${contentDispositionFileName(data.file_name)}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
