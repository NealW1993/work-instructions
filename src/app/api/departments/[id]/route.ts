import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface UpdateDepartmentBody {
  name?: string;
  colorHex?: string;
}

function normalizeDepartmentName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeColorHex(value: string) {
  const normalized = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : null;
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

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSystemAdmin(request);
  if (auth.error) {
    return auth.error;
  }

  const body = (await request.json().catch(() => ({}))) as UpdateDepartmentBody;

  const { id } = await context.params;
  const supabaseAdmin = getSupabaseAdminClient();

  const { data: existingDepartment, error: existingDepartmentError } = await supabaseAdmin
    .from("departments")
    .select("id, name, color_hex")
    .eq("id", id)
    .maybeSingle();

  if (existingDepartmentError) {
    return NextResponse.json(
      { error: existingDepartmentError.message },
      { status: 500 },
    );
  }

  if (!existingDepartment) {
    return NextResponse.json({ error: "Department not found." }, { status: 404 });
  }

  const normalizedName =
    body.name === undefined
      ? existingDepartment.name
      : normalizeDepartmentName(body.name);
  const normalizedColorHex =
    body.colorHex === undefined
      ? normalizeColorHex(existingDepartment.color_hex)
      : normalizeColorHex(body.colorHex);

  if (!normalizedName) {
    return NextResponse.json({ error: "Department name is required." }, { status: 400 });
  }

  if (!normalizedColorHex) {
    return NextResponse.json(
      { error: "Department color must be a valid hex value like #0EA5E9." },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("departments")
    .update({ name: normalizedName, color_hex: normalizedColorHex })
    .eq("id", id)
    .select("id, name, sort_order, color_hex, created_at, updated_at")
    .maybeSingle();

  if (error?.code === "23505") {
    return NextResponse.json(
      { error: "Department already exists." },
      { status: 409 },
    );
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ department: data });
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

  const { data: existingDepartment, error: existingDepartmentError } = await supabaseAdmin
    .from("departments")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (existingDepartmentError) {
    return NextResponse.json(
      { error: existingDepartmentError.message },
      { status: 500 },
    );
  }

  if (!existingDepartment) {
    return NextResponse.json({ error: "Department not found." }, { status: 404 });
  }

  const { count, error: usageError } = await supabaseAdmin
    .from("work_items")
    .select("id", { count: "exact", head: true })
    .eq("department_id", id);

  if (usageError) {
    return NextResponse.json({ error: usageError.message }, { status: 500 });
  }

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "Department is assigned to existing work instructions. You can still rename it, but you must reassign those items before deleting.",
      },
      { status: 409 },
    );
  }

  const { error: deleteError } = await supabaseAdmin
    .from("departments")
    .delete()
    .eq("id", id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
