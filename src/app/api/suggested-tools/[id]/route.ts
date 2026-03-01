import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { canEditInstructions } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface UpdateSuggestedToolBody {
  name?: string;
  isActive?: boolean;
}

function normalizeToolName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

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

async function requireEditor(request: NextRequest) {
  const profile = await getRequestProfile(request);

  if (!profile) {
    return {
      error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
      profile: null,
    };
  }

  if (!canEditInstructions(profile.role)) {
    return {
      error: NextResponse.json(
        { error: "Editor privileges required." },
        { status: 403 },
      ),
      profile,
    };
  }

  return { error: null, profile };
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const body = (await request.json().catch(() => ({}))) as UpdateSuggestedToolBody;
  const hasName = typeof body.name === "string";
  const hasIsActive = typeof body.isActive === "boolean";

  if (!hasName && !hasIsActive) {
    return NextResponse.json(
      { error: "At least one field is required to update a common tool." },
      { status: 400 },
    );
  }

  const auth =
    hasName
      ? await requireSystemAdmin(request)
      : await requireEditor(request);
  if (auth.error || !auth.profile) {
    return auth.error;
  }

  const { id } = await context.params;
  const updates: Record<string, unknown> = {};
  if (hasName) {
    const normalizedName = normalizeToolName(body.name ?? "");
    if (!normalizedName) {
      return NextResponse.json({ error: "Tool name is required." }, { status: 400 });
    }
    updates.name = normalizedName;
  }

  if (hasIsActive) {
    const shouldBeActive = body.isActive === true;
    updates.is_active = shouldBeActive;
    updates.deleted_at = shouldBeActive ? null : new Date().toISOString();
    updates.deleted_by = shouldBeActive ? null : auth.profile.id;
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from("suggested_tools")
    .update(updates)
    .eq("id", id)
    .select("id, name, is_active, updated_at")
    .maybeSingle<{
      id: string;
      name: string;
      is_active: boolean;
      updated_at: string;
    }>();

  if (error?.code === "23505") {
    return NextResponse.json({ error: "This common tool name is already in use." }, { status: 409 });
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Suggested tool not found." }, { status: 404 });
  }

  return NextResponse.json({
    tool: {
      id: data.id,
      name: data.name,
      isActive: data.is_active,
      updatedAt: data.updated_at,
    },
  });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSystemAdmin(request);
  if (auth.error || !auth.profile) {
    return auth.error;
  }

  const { id } = await context.params;
  const supabaseAdmin = getSupabaseAdminClient();

  const { data: existingTool, error: existingToolError } = await supabaseAdmin
    .from("suggested_tools")
    .select("id, is_active")
    .eq("id", id)
    .maybeSingle<{ id: string; is_active: boolean }>();

  if (existingToolError) {
    return NextResponse.json({ error: existingToolError.message }, { status: 500 });
  }

  if (!existingTool) {
    return NextResponse.json({ error: "Suggested tool not found." }, { status: 404 });
  }

  if (!existingTool.is_active) {
    return NextResponse.json({ success: true, alreadyInactive: true });
  }

  const { error: updateError } = await supabaseAdmin
    .from("suggested_tools")
    .update({
      is_active: false,
      deleted_at: new Date().toISOString(),
      deleted_by: auth.profile.id,
    })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
