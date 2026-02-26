import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface UpdateInstructionReviewSettingsBody {
  reviewWindowDays?: unknown;
}

const MIN_REVIEW_WINDOW_DAYS = 1;
const MAX_REVIEW_WINDOW_DAYS = 365;
const DEFAULT_REVIEW_WINDOW_DAYS = 30;

async function requireSystemAdmin(request: NextRequest) {
  const requester = await getRequestProfile(request);

  if (!requester) {
    return {
      error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
      requester: null,
    };
  }

  if (requester.role !== "system_admin") {
    return {
      error: NextResponse.json(
        { error: "System admin privileges required." },
        { status: 403 },
      ),
      requester,
    };
  }

  return { error: null, requester };
}

function normalizeReviewWindowDays(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;

  if (!Number.isInteger(parsed)) {
    return null;
  }

  if (parsed < MIN_REVIEW_WINDOW_DAYS || parsed > MAX_REVIEW_WINDOW_DAYS) {
    return null;
  }

  return parsed;
}

export async function GET(request: NextRequest) {
  const auth = await requireSystemAdmin(request);
  if (auth.error || !auth.requester) {
    return auth.error;
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from("instruction_review_settings")
    .select("review_window_days, updated_at")
    .eq("id", true)
    .maybeSingle<{ review_window_days: number; updated_at: string }>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const reviewWindowDays = normalizeReviewWindowDays(data?.review_window_days) ??
    DEFAULT_REVIEW_WINDOW_DAYS;

  if (!data) {
    const { error: upsertError } = await supabaseAdmin
      .from("instruction_review_settings")
      .upsert(
        {
          id: true,
          review_window_days: reviewWindowDays,
          updated_by: auth.requester.id,
        },
        {
          onConflict: "id",
        },
      );

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    reviewWindowDays,
    updatedAt: data?.updated_at ?? null,
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSystemAdmin(request);
  if (auth.error || !auth.requester) {
    return auth.error;
  }

  const body = (await request.json().catch(() => ({}))) as UpdateInstructionReviewSettingsBody;
  const reviewWindowDays = normalizeReviewWindowDays(body.reviewWindowDays);

  if (reviewWindowDays === null) {
    return NextResponse.json(
      {
        error: `reviewWindowDays must be an integer between ${MIN_REVIEW_WINDOW_DAYS} and ${MAX_REVIEW_WINDOW_DAYS}.`,
      },
      { status: 400 },
    );
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { error } = await supabaseAdmin
    .from("instruction_review_settings")
    .upsert(
      {
        id: true,
        review_window_days: reviewWindowDays,
        updated_by: auth.requester.id,
      },
      {
        onConflict: "id",
      },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: refreshedData, error: readError } = await supabaseAdmin
    .from("instruction_review_settings")
    .select("review_window_days, updated_at")
    .eq("id", true)
    .maybeSingle<{ review_window_days: number; updated_at: string }>();

  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }

  return NextResponse.json({
    reviewWindowDays:
      normalizeReviewWindowDays(refreshedData?.review_window_days) ?? reviewWindowDays,
    updatedAt: refreshedData?.updated_at ?? null,
  });
}
