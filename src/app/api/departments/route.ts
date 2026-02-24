import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface CreateDepartmentBody {
  name?: string;
  colorHex?: string;
}

interface DepartmentMetadataRow {
  id: string;
  sort_order: number;
  color_hex: string;
}

function normalizeDepartmentName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeColorHex(value: string) {
  const normalized = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : null;
}

const DEFAULT_DEPARTMENT_COLORS = [
  "#0EA5E9",
  "#22C55E",
  "#F97316",
  "#A855F7",
  "#EAB308",
  "#14B8A6",
  "#EF4444",
  "#8B5CF6",
  "#06B6D4",
  "#84CC16",
  "#F43F5E",
  "#3B82F6",
] as const;

function pickNextDepartmentColor(
  departments: DepartmentMetadataRow[],
  nextSortOrder: number,
) {
  const usedColors = new Set(
    departments
      .map((department) => normalizeColorHex(department.color_hex))
      .filter((value): value is string => value !== null),
  );

  const firstUnusedColor = DEFAULT_DEPARTMENT_COLORS.find((color) => !usedColors.has(color));
  if (firstUnusedColor) {
    return firstUnusedColor;
  }

  return DEFAULT_DEPARTMENT_COLORS[nextSortOrder % DEFAULT_DEPARTMENT_COLORS.length];
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

export async function GET(request: NextRequest) {
  const auth = await requireSystemAdmin(request);
  if (auth.error) {
    return auth.error;
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from("departments")
    .select("id, name, sort_order, color_hex, created_at, updated_at")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ departments: data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireSystemAdmin(request);
  if (auth.error) {
    return auth.error;
  }

  const body = (await request.json().catch(() => ({}))) as CreateDepartmentBody;
  const name = normalizeDepartmentName(body.name ?? "");

  if (!name) {
    return NextResponse.json({ error: "Department name is required." }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdminClient();

  const { data: existingDepartments, error: existingDepartmentsError } = await supabaseAdmin
    .from("departments")
    .select("id, sort_order, color_hex")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (existingDepartmentsError) {
    return NextResponse.json(
      { error: existingDepartmentsError.message },
      { status: 500 },
    );
  }

  const resolvedDepartments = (existingDepartments ?? []) as DepartmentMetadataRow[];
  const nextSortOrder =
    resolvedDepartments.reduce(
      (maxOrder, department) => Math.max(maxOrder, department.sort_order),
      -1,
    ) + 1;
  const colorHex =
    normalizeColorHex(body.colorHex ?? "") ??
    pickNextDepartmentColor(resolvedDepartments, nextSortOrder);

  const { data, error } = await supabaseAdmin
    .from("departments")
    .insert({
      name,
      sort_order: nextSortOrder,
      color_hex: colorHex,
    })
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
