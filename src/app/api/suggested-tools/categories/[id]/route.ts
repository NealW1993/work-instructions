import { NextRequest, NextResponse } from "next/server";

import { isSystemAdmin } from "@/lib/roles";
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

  if (!isSystemAdmin(profile.role)) {
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

  const { data: existingCategory, error: categoryLookupError } = await supabaseAdmin
    .from("suggested_tool_categories")
    .select("id")
    .eq("id", id)
    .maybeSingle<{ id: string }>();

  if (categoryLookupError) {
    return NextResponse.json({ error: categoryLookupError.message }, { status: 500 });
  }

  if (!existingCategory) {
    return NextResponse.json({ error: "Category not found." }, { status: 404 });
  }

  const { error: deleteError } = await supabaseAdmin
    .from("suggested_tool_categories")
    .delete()
    .eq("id", id);

  if (deleteError) {
    if (deleteError.code === "23503") {
      return NextResponse.json(
        {
          error:
            "Category is in use by tools or sub-categories. Delete or move those first.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
