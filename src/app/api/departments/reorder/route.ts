import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { hasFullAccess } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface ReorderDepartmentsBody {
  orderedDepartmentIds?: string[];
}

async function requireFullAccess(request: NextRequest) {
  const profile = await getRequestProfile(request);

  if (!profile) {
    return {
      error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
      profile: null,
    };
  }

  if (!hasFullAccess(profile.role)) {
    return {
      error: NextResponse.json(
        { error: "Admin privileges required." },
        { status: 403 },
      ),
      profile,
    };
  }

  return { error: null, profile };
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFullAccess(request);
  if (auth.error) {
    return auth.error;
  }

  const body = (await request.json().catch(() => ({}))) as ReorderDepartmentsBody;
  const orderedDepartmentIds = Array.isArray(body.orderedDepartmentIds)
    ? body.orderedDepartmentIds.map((id) => id.trim()).filter(Boolean)
    : [];

  if (orderedDepartmentIds.length === 0) {
    return NextResponse.json(
      { error: "orderedDepartmentIds must include all departments in the new order." },
      { status: 400 },
    );
  }

  if (new Set(orderedDepartmentIds).size !== orderedDepartmentIds.length) {
    return NextResponse.json(
      { error: "orderedDepartmentIds contains duplicate department IDs." },
      { status: 400 },
    );
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { data: existingDepartments, error: existingDepartmentsError } = await supabaseAdmin
    .from("departments")
    .select("id");

  if (existingDepartmentsError) {
    return NextResponse.json(
      { error: existingDepartmentsError.message },
      { status: 500 },
    );
  }

  const existingDepartmentIds = new Set(
    (existingDepartments ?? []).map((department) => department.id),
  );

  if (orderedDepartmentIds.length !== existingDepartmentIds.size) {
    return NextResponse.json(
      {
        error:
          "orderedDepartmentIds must include every department exactly once before saving order.",
      },
      { status: 400 },
    );
  }

  const containsUnknownDepartment = orderedDepartmentIds.some(
    (departmentId) => !existingDepartmentIds.has(departmentId),
  );

  if (containsUnknownDepartment) {
    return NextResponse.json(
      { error: "orderedDepartmentIds includes unknown department IDs." },
      { status: 400 },
    );
  }

  for (const [index, departmentId] of orderedDepartmentIds.entries()) {
    const { error: updateError } = await supabaseAdmin
      .from("departments")
      .update({ sort_order: index })
      .eq("id", departmentId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  const { data: departments, error: departmentsError } = await supabaseAdmin
    .from("departments")
    .select("id, name, sort_order, color_hex, created_at, updated_at")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (departmentsError) {
    return NextResponse.json({ error: departmentsError.message }, { status: 500 });
  }

  return NextResponse.json({ departments: departments ?? [] });
}
