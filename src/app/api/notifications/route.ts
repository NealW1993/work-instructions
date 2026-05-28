import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface NotificationRow {
  id: string;
  event_type: string;
  title: string;
  body: string;
  href: string | null;
  entity_type: string | null;
  entity_id: string | null;
  metadata: unknown;
  read_at: string | null;
  created_at: string;
  actor_user_id: string | null;
  profiles:
    | {
        full_name: string | null;
        email: string | null;
      }
    | Array<{
        full_name: string | null;
        email: string | null;
      }>
    | null;
}

interface PatchBody {
  notificationIds?: unknown;
  markAllRead?: unknown;
}

function normalizeUuidArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) =>
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            entry,
          ),
        ),
    ),
  );
}

function getActorName(
  relation: NotificationRow["profiles"],
  fallback = "System",
) {
  const profile = Array.isArray(relation) ? relation[0] : relation;
  return profile?.full_name?.trim() || profile?.email?.trim() || fallback;
}

function toNotification(row: NotificationRow) {
  return {
    id: row.id,
    eventType: row.event_type,
    title: row.title,
    body: row.body,
    href: row.href,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: row.metadata,
    readAt: row.read_at,
    createdAt: row.created_at,
    actorUserId: row.actor_user_id,
    actorName: getActorName(row.profiles),
  };
}

export async function GET(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const limit = Math.min(
    80,
    Math.max(10, Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "40", 10) || 40),
  );
  const supabaseAdmin = getSupabaseAdminClient();

  const [{ data, error }, { count, error: unreadError }] = await Promise.all([
    supabaseAdmin
      .from("user_notifications")
      .select(
        "id, event_type, title, body, href, entity_type, entity_id, metadata, read_at, created_at, actor_user_id, profiles!user_notifications_actor_user_id_fkey(full_name, email)",
      )
      .eq("recipient_user_id", requester.id)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from("user_notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_user_id", requester.id)
      .is("read_at", null),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (unreadError) {
    return NextResponse.json({ error: unreadError.message }, { status: 500 });
  }

  return NextResponse.json({
    notifications: ((data ?? []) as NotificationRow[]).map(toNotification),
    unreadCount: count ?? 0,
  });
}

export async function PATCH(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as PatchBody;
  const supabaseAdmin = getSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  let query = supabaseAdmin
    .from("user_notifications")
    .update({ read_at: nowIso })
    .eq("recipient_user_id", requester.id)
    .is("read_at", null);

  if (body.markAllRead !== true) {
    const notificationIds = normalizeUuidArray(body.notificationIds);
    if (notificationIds.length === 0) {
      return NextResponse.json({ error: "No notifications selected." }, { status: 400 });
    }
    query = query.in("id", notificationIds);
  }

  const { error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
