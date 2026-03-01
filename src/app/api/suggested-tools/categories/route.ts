import { NextRequest, NextResponse } from "next/server";

import { canEditInstructions } from "@/lib/roles";
import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface CreateSuggestedToolCategoryBody {
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

  const body = (await request.json().catch(() => ({}))) as CreateSuggestedToolCategoryBody;
  const name = normalizeValue(body.name ?? "");
  const sortOrder = normalizeSortOrder(body.sortOrder);

  if (!name) {
    return NextResponse.json({ error: "Category name is required." }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from("suggested_tool_categories")
    .insert({
      name,
      sort_order: sortOrder,
      created_by: auth.profile.id,
    })
    .select("id, name, sort_order, created_at, updated_at")
    .maybeSingle<{
      id: string;
      name: string;
      sort_order: number;
      created_at: string;
      updated_at: string;
    }>();

  if (error?.code === "23505") {
    return NextResponse.json({ error: "Category already exists." }, { status: 409 });
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Unable to create category." }, { status: 500 });
  }

  return NextResponse.json({
    category: {
      id: data.id,
      name: data.name,
      sortOrder: data.sort_order,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  });
}
