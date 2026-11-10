import { NextRequest } from "next/server";
import { archiveInstruction } from "@/lib/instruction-archive.server";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return archiveInstruction(request, (await context.params).id, false, true);
}
