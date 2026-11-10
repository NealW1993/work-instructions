import { NextRequest } from "next/server";
import { saveProcessDocument } from "@/lib/process-document-save.server";

export async function POST(request: NextRequest) {
  return saveProcessDocument(request, null);
}
