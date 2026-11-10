import { NextRequest, NextResponse } from "next/server";
import { archiveInstruction } from "@/lib/instruction-archive.server";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  const body = await request.json().catch(() => ({}));
  if (body?.permanent === true) return NextResponse.json({ error: "Permanent deletion is disabled. Archive the instruction to retain audit evidence." }, { status: 409 });
  return archiveInstruction(request, (await context.params).id, true);
}

export async function PATCH(request: NextRequest, context: Context) {
  const body = await request.json().catch(() => ({}));
  return archiveInstruction(request, (await context.params).id, false, body?.forceSwap === true);
}
