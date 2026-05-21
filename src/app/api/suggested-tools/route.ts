import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { canEditInstructions, hasFullAccess } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface CreateSuggestedToolBody {
  name?: string;
  categoryId?: string;
  subcategoryId?: string | null;
  sortOrder?: number;
}

interface SuggestedToolCategoryRow {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface SuggestedToolSubcategoryRow {
  id: string;
  category_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface SuggestedToolRow {
  id: string;
  name: string;
  category_id: string;
  subcategory_id: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function normalizeToolValue(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeSortOrder(value: unknown) {
  if (!Number.isInteger(value)) {
    return 0;
  }

  return Math.max(0, Number(value));
}

async function ensureGeneralCategoryId(
  supabaseAdmin: ReturnType<typeof getSupabaseAdminClient>,
  createdBy: string,
) {
  const { data: existingCategory, error: existingCategoryError } = await supabaseAdmin
    .from("suggested_tool_categories")
    .select("id")
    .ilike("name", "General")
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (existingCategoryError) {
    throw new Error(existingCategoryError.message);
  }

  if (existingCategory?.id) {
    return existingCategory.id;
  }

  const { data: insertedCategory, error: insertCategoryError } = await supabaseAdmin
    .from("suggested_tool_categories")
    .insert({
      name: "General",
      sort_order: 0,
      created_by: createdBy,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (!insertCategoryError && insertedCategory?.id) {
    return insertedCategory.id;
  }

  if (insertCategoryError?.code !== "23505") {
    throw new Error(insertCategoryError?.message ?? "Unable to resolve default category.");
  }

  const { data: raceResolvedCategory, error: raceResolvedCategoryError } = await supabaseAdmin
    .from("suggested_tool_categories")
    .select("id")
    .ilike("name", "General")
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (raceResolvedCategoryError) {
    throw new Error(raceResolvedCategoryError.message);
  }

  if (!raceResolvedCategory?.id) {
    throw new Error("Unable to resolve default category.");
  }

  return raceResolvedCategory.id;
}

async function requireAuthenticated(request: NextRequest) {
  const profile = await getRequestProfile(request);

  if (!profile) {
    return {
      error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
      profile: null,
    };
  }

  return { error: null, profile };
}

async function requireEditor(request: NextRequest) {
  const auth = await requireAuthenticated(request);
  if (auth.error || !auth.profile) {
    return auth;
  }

  if (!canEditInstructions(auth.profile.role)) {
    return {
      error: NextResponse.json(
        { error: "Editor privileges required." },
        { status: 403 },
      ),
      profile: auth.profile,
    };
  }

  return auth;
}

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticated(request);
  if (auth.error || !auth.profile) {
    return auth.error;
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const includeInactive =
    request.nextUrl.searchParams.get("includeInactive") === "true" &&
    hasFullAccess(auth.profile.role);
  let toolsQuery = supabaseAdmin
    .from("suggested_tools")
    .select("id, name, category_id, subcategory_id, sort_order, is_active, created_at, updated_at");

  if (!includeInactive) {
    toolsQuery = toolsQuery.eq("is_active", true);
  }

  const [
    { data: categoryData, error: categoryError },
    { data: subcategoryData, error: subcategoryError },
    { data: toolData, error: toolError },
  ] = await Promise.all([
    supabaseAdmin
      .from("suggested_tool_categories")
      .select("id, name, sort_order, created_at, updated_at")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabaseAdmin
      .from("suggested_tool_subcategories")
      .select("id, category_id, name, sort_order, created_at, updated_at")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    toolsQuery.order("name", { ascending: true }).order("sort_order", { ascending: true }),
  ]);

  if (categoryError) {
    return NextResponse.json({ error: categoryError.message }, { status: 500 });
  }

  if (subcategoryError) {
    return NextResponse.json({ error: subcategoryError.message }, { status: 500 });
  }

  if (toolError) {
    return NextResponse.json({ error: toolError.message }, { status: 500 });
  }

  const categories = ((categoryData ?? []) as SuggestedToolCategoryRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  const subcategories = ((subcategoryData ?? []) as SuggestedToolSubcategoryRow[]).map((row) => ({
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  const tools = ((toolData ?? []) as SuggestedToolRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    subcategoryId: row.subcategory_id,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return NextResponse.json({
    canCreateTaxonomy: canEditInstructions(auth.profile.role),
    canManageTaxonomy: hasFullAccess(auth.profile.role),
    categories,
    subcategories,
    tools,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireEditor(request);
  if (auth.error || !auth.profile) {
    return auth.error;
  }

  const body = (await request.json().catch(() => ({}))) as CreateSuggestedToolBody;
  const name = normalizeToolValue(body.name ?? "");
  const requestedCategoryId = typeof body.categoryId === "string" ? body.categoryId.trim() : "";
  const subcategoryId =
    typeof body.subcategoryId === "string" ? body.subcategoryId.trim() : null;
  const sortOrder = normalizeSortOrder(body.sortOrder);

  if (!name) {
    return NextResponse.json({ error: "Tool name is required." }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdminClient();
  let categoryId = requestedCategoryId;

  if (!categoryId && subcategoryId) {
    const { data: subcategoryFromInput, error: subcategoryFromInputError } = await supabaseAdmin
      .from("suggested_tool_subcategories")
      .select("category_id")
      .eq("id", subcategoryId)
      .maybeSingle<{ category_id: string }>();

    if (subcategoryFromInputError) {
      return NextResponse.json({ error: subcategoryFromInputError.message }, { status: 500 });
    }

    if (!subcategoryFromInput) {
      return NextResponse.json({ error: "Sub-category not found." }, { status: 404 });
    }

    categoryId = subcategoryFromInput.category_id;
  }

  if (!categoryId) {
    try {
      categoryId = await ensureGeneralCategoryId(supabaseAdmin, auth.profile.id);
    } catch (caughtError) {
      return NextResponse.json(
        {
          error:
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to resolve default category.",
        },
        { status: 500 },
      );
    }
  }

  const { data: category, error: categoryLookupError } = await supabaseAdmin
    .from("suggested_tool_categories")
    .select("id")
    .eq("id", categoryId)
    .maybeSingle<{ id: string }>();

  if (categoryLookupError) {
    return NextResponse.json({ error: categoryLookupError.message }, { status: 500 });
  }

  if (!category) {
    return NextResponse.json({ error: "Category not found." }, { status: 404 });
  }

  if (subcategoryId) {
    const { data: subcategory, error: subcategoryLookupError } = await supabaseAdmin
      .from("suggested_tool_subcategories")
      .select("id")
      .eq("id", subcategoryId)
      .eq("category_id", categoryId)
      .maybeSingle<{ id: string }>();

    if (subcategoryLookupError) {
      return NextResponse.json({ error: subcategoryLookupError.message }, { status: 500 });
    }

    if (!subcategory) {
      return NextResponse.json(
        { error: "Sub-category not found under selected category." },
        { status: 404 },
      );
    }
  }

  const { data, error } = await supabaseAdmin
    .from("suggested_tools")
    .insert({
      name,
      category_id: categoryId,
      subcategory_id: subcategoryId,
      sort_order: sortOrder,
      is_active: true,
      created_by: auth.profile.id,
    })
    .select("id, name, category_id, subcategory_id, sort_order, is_active, created_at, updated_at")
    .maybeSingle<SuggestedToolRow>();

  const insertedTool = data as SuggestedToolRow | null;

  if (error?.code === "23505") {
    return NextResponse.json(
      { error: "This common tool already exists." },
      { status: 409 },
    );
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!insertedTool) {
    return NextResponse.json(
      { error: "Unable to create suggested tool." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    tool: {
      id: insertedTool.id,
      name: insertedTool.name,
      categoryId: insertedTool.category_id,
      subcategoryId: insertedTool.subcategory_id,
      sortOrder: insertedTool.sort_order,
      isActive: insertedTool.is_active,
      createdAt: insertedTool.created_at,
      updatedAt: insertedTool.updated_at,
    },
  });
}
