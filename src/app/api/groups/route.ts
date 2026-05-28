import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { isSystemAdmin } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface CreateGroupBody {
  name?: unknown;
  description?: unknown;
}

function normalizeString(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "group";
}

export async function POST(request: NextRequest) {
  const requester = await getRequestProfile(request);

  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!isSystemAdmin(requester.role)) {
    return NextResponse.json(
      { error: "Only system admins can create access groups." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as CreateGroupBody;
  const name = normalizeString(body.name, 120);
  const description = normalizeString(body.description, 1000);

  if (!name) {
    return NextResponse.json({ error: "Group name is required." }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const baseSlug = slugify(name);
  let slug = baseSlug;
  let suffix = 2;

  while (suffix < 100) {
    const { data: existingGroup, error: existingError } = await supabaseAdmin
      .from("access_groups")
      .select("id")
      .eq("slug", slug)
      .maybeSingle<{ id: string }>();

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    if (!existingGroup) {
      break;
    }

    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  const { data: group, error } = await supabaseAdmin
    .from("access_groups")
    .insert({
      name,
      slug,
      description,
      created_by: requester.id,
      updated_by: requester.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !group) {
    return NextResponse.json(
      { error: error?.message ?? "Unable to create access group." },
      { status: 500 },
    );
  }

  await supabaseAdmin.from("access_group_memberships").insert({
    group_id: group.id,
    user_id: requester.id,
    assigned_by: requester.id,
  });

  return NextResponse.json({ groupId: group.id });
}
