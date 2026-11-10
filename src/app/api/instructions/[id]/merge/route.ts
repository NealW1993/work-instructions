import { NextRequest, NextResponse } from "next/server";
import { getRequestProfile } from "@/lib/api-auth";
import { canEditInstructions } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { STALE_RECORD_ERROR_CODE } from "@/lib/supabase/constants";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await getRequestProfile(request);
  if (!actor) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canEditInstructions(actor.role)) return NextResponse.json({ error: "Only editors can merge instructions." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || ![body.expectedRootUpdatedAt, body.expectedForkUpdatedAt].every(value => typeof value === "string" && Number.isFinite(Date.parse(value)))) {
    return NextResponse.json({ error: "Refresh and review the merge preview before merging." }, { status: 400 });
  }
  const fields = Object.fromEntries(["department", "partId", "itemTitle", "body", "revision", "media"].map(key => [key, body.mergeMode === "overwrite" || body.fields?.[key] === true]));
  if (!Object.values(fields).some(Boolean)) return NextResponse.json({ error: "Select at least one field to merge." }, { status: 400 });
  const { data, error } = await getSupabaseAdminClient().rpc("merge_work_instruction_controlled", {
    p_fork_id: (await context.params).id, p_actor: actor.id, p_fields: fields,
    p_expected_root_updated_at: body.expectedRootUpdatedAt, p_expected_fork_updated_at: body.expectedForkUpdatedAt,
  });
  if (error) {
    const status = [STALE_RECORD_ERROR_CODE, "23505"].includes(error.code) ? 409 : error.code === "42501" ? 403 : error.code === "23514" ? 400 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(data);
}
