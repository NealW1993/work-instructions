import { NextRequest } from "next/server";
import { saveProcessDocument } from "@/lib/process-document-save.server";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return saveProcessDocument(request, (await context.params).id);
}
