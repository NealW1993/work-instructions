import { NextRequest, NextResponse } from "next/server";

import { canEditInstructions } from "@/lib/roles";
import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface CreateSuggestedToolSubcategoryBody {
  categoryId?: string;
  name?: string;
  sortOrder?: number;
}

function normalizeValue(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeSortOrder(value: unknown) {
  if (!Number.isInteger(value)) {
    return 0;
  }

  return Math.max(0, Number(value));
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
      error: NextResponse.json({ error: "Editor privileges required." }, { status: 403 }),
      profile,
    };
  }

  return { error: null, profile };
}

export async function POST(request: NextRequest) {
  const auth = await requireEditor(request);
  if (auth.error || !auth.profile) {
    return auth.error;
  }

  const body = (await request.json().catch(() => ({}))) as CreateSuggestedToolSubcategoryBody;
  const categoryId = typeof body.categoryId === "string" ? body.categoryId.trim() : "";
  const name = normalizeValue(body.name ?? "");
  const sortOrder = normalizeSortOrder(body.sortOrder);

  if (!categoryId) {
    return NextResponse.json({ error: "Category is required." }, { status: 400 });
  }

  if (!name) {
    return NextResponse.json({ error: "Sub-category name is required." }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdminClient();

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

  const { data, error } = await supabaseAdmin
    .from("suggested_tool_subcategories")
    .insert({
      category_id: categoryId,
      name,
      sort_order: sortOrder,
      created_by: auth.profile.id,
    })
    .select("id, category_id, name, sort_order, created_at, updated_at")
    .maybeSingle<{
      id: string;
      category_id: string;
      name: string;
      sort_order: number;
      created_at: string;
      updated_at: string;
    }>();

  if (error?.code === "23505") {
    return NextResponse.json(
      { error: "Sub-category already exists in this category." },
      { status: 409 },
    );
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Unable to create sub-category." }, { status: 500 });
  }

  return NextResponse.json({
    subcategory: {
      id: data.id,
      categoryId: data.category_id,
      name: data.name,
      sortOrder: data.sort_order,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  });
}
