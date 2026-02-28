import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface CreateSuggestedToolBody {
  name?: string;
  toolType?: string;
}

interface SuggestedToolRow {
  id: string;
  name: string;
  tool_type: string;
  created_at: string;
  updated_at: string;
}

function normalizeToolValue(value: string) {
  return value.trim().replace(/\s+/g, " ");
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

async function requireSystemAdmin(request: NextRequest) {
  const auth = await requireAuthenticated(request);
  if (auth.error || !auth.profile) {
    return auth;
  }

  if (auth.profile.role !== "system_admin") {
    return {
      error: NextResponse.json(
        { error: "System admin privileges required." },
        { status: 403 },
      ),
      profile: auth.profile,
    };
  }

  return auth;
}

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticated(request);
  if (auth.error) {
    return auth.error;
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from("suggested_tools")
    .select("id, name, tool_type, created_at, updated_at")
    .order("tool_type", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as SuggestedToolRow[];
  const suggestedTools = rows.map((row) => ({
    id: row.id,
    name: row.name,
    toolType: row.tool_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  const toolTypes = Array.from(
    new Set(
      suggestedTools
        .map((tool) => normalizeToolValue(tool.toolType))
        .filter((value) => value.length > 0),
    ),
  ).sort((first, second) => first.localeCompare(second));

  return NextResponse.json({
    suggestedTools,
    toolTypes,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireSystemAdmin(request);
  if (auth.error || !auth.profile) {
    return auth.error;
  }

  const body = (await request.json().catch(() => ({}))) as CreateSuggestedToolBody;
  const name = normalizeToolValue(body.name ?? "");
  const toolType = normalizeToolValue(body.toolType ?? "");

  if (!name) {
    return NextResponse.json({ error: "Tool name is required." }, { status: 400 });
  }

  if (!toolType) {
    return NextResponse.json({ error: "Tool type is required." }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from("suggested_tools")
    .insert({
      name,
      tool_type: toolType,
      created_by: auth.profile.id,
    })
    .select("id, name, tool_type, created_at, updated_at")
    .maybeSingle<SuggestedToolRow>();

  if (error?.code === "23505") {
    return NextResponse.json(
      { error: "This suggested tool already exists for that tool type." },
      { status: 409 },
    );
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(
      { error: "Unable to create suggested tool." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    suggestedTool: {
      id: data.id,
      name: data.name,
      toolType: data.tool_type,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  });
}
