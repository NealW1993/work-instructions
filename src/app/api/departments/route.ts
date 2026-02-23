import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface CreateDepartmentBody {
  name?: string;
}

function normalizeDepartmentName(value: string) {
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

export async function GET(request: NextRequest) {
  const auth = await requireSystemAdmin(request);
  if (auth.error) {
    return auth.error;
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from("departments")
    .select("id, name, created_at, updated_at")
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
  const { data, error } = await supabaseAdmin
    .from("departments")
    .insert({
      name,
    })
    .select("id, name, created_at, updated_at")
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
