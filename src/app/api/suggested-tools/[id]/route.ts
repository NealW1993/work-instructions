import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

async function requireSystemAdmin(request: NextRequest) {
  const profile = await getRequestProfile(request);

  if (!profile) {
    return {
      error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
      profile: null,
    };
  }

  if (profile.role !== "system_admin") {
    return {
      error: NextResponse.json(
        { error: "System admin privileges required." },
        { status: 403 },
      ),
      profile,
    };
  }

  return { error: null, profile };
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSystemAdmin(request);
  if (auth.error) {
    return auth.error;
  }

  const { id } = await context.params;
  const supabaseAdmin = getSupabaseAdminClient();

  const { data: existingTool, error: existingToolError } = await supabaseAdmin
    .from("suggested_tools")
    .select("id")
    .eq("id", id)
    .maybeSingle<{ id: string }>();

  if (existingToolError) {
    return NextResponse.json({ error: existingToolError.message }, { status: 500 });
  }

  if (!existingTool) {
    return NextResponse.json({ error: "Suggested tool not found." }, { status: 404 });
  }

  const { error: deleteError } = await supabaseAdmin
    .from("suggested_tools")
    .delete()
    .eq("id", id);

  if (deleteError) {
    if (deleteError.code === "23503") {
      return NextResponse.json(
        { error: "Tool is linked to one or more instructions and cannot be deleted yet." },
        { status: 409 },
      );
    }

    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
