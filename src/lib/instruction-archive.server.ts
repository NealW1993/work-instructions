import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getRequestProfile } from "@/lib/api-auth";
import { hasFullAccess } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { STALE_RECORD_ERROR_CODE } from "@/lib/supabase/constants";

export async function archiveInstruction(request: NextRequest, id: string, archived: boolean, forceSwap = false) {
  const actor = await getRequestProfile(request);
  if (!actor) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!hasFullAccess(actor.role)) return NextResponse.json({ error: "Only editors can archive or restore instructions." }, { status: 403 });
  const { data, error } = await getSupabaseAdminClient().rpc("set_work_instruction_archive", {
    p_id: id, p_actor: actor.id, p_archive: archived, p_force_swap: forceSwap,
  });
  if (error) {
    const status = error.code === "P0002" ? 404 : error.code === "42501" ? 403 : ["23505", STALE_RECORD_ERROR_CODE].includes(error.code) ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  if (data?.conflict) return NextResponse.json({ error: "An active revision already exists.", ...data }, { status: 409 });
  return NextResponse.json(data);
}
