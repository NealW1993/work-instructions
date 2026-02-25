import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

interface EndSessionBody {
  sessionStartedAtMs?: number | null;
  clientElapsedSeconds?: number | null;
}

function parseSessionStartedAtMs(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return null;
  }

  return normalized;
}

function parseClientElapsedSeconds(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.floor(value);
  if (normalized < 0) {
    return null;
  }

  // Guard against accidental runaway values from a stale client timer.
  const maxReasonableSessionSeconds = 14 * 24 * 60 * 60;
  if (normalized > maxReasonableSessionSeconds) {
    return maxReasonableSessionSeconds;
  }

  return normalized;
}

function toTimestampMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as EndSessionBody;
  const clientElapsedSeconds = parseClientElapsedSeconds(body.clientElapsedSeconds);
  const clientSessionStartedAtMs = parseSessionStartedAtMs(body.sessionStartedAtMs);

  const { data: requester, error: requesterError } = await supabase
    .from("profiles")
    .select("id, total_signed_in_seconds, active_session_started_at")
    .eq("id", user.id)
    .maybeSingle<{
      id: string;
      total_signed_in_seconds: number | null;
      active_session_started_at: string | null;
    }>();

  if (requesterError) {
    return NextResponse.json({ error: requesterError.message }, { status: 500 });
  }

  if (!requester) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  const serverSessionStartedAtMs = toTimestampMs(requester.active_session_started_at);
  const nowMs = Date.now();

  let elapsedSeconds = 0;
  if (serverSessionStartedAtMs !== null) {
    elapsedSeconds = Math.max(0, Math.floor((nowMs - serverSessionStartedAtMs) / 1000));
  } else if (clientElapsedSeconds !== null) {
    elapsedSeconds = clientElapsedSeconds;
  } else if (clientSessionStartedAtMs !== null) {
    elapsedSeconds = Math.max(0, Math.floor((nowMs - clientSessionStartedAtMs) / 1000));
  }

  const currentTotalSeconds = Math.max(0, Number(requester.total_signed_in_seconds ?? 0));
  const nextTotalSeconds = currentTotalSeconds + elapsedSeconds;

  const { data: updatedProfile, error: updateError } = await supabase
    .from("profiles")
    .update({
      total_signed_in_seconds: nextTotalSeconds,
      active_session_started_at: null,
    })
    .eq("id", requester.id)
    .select("total_signed_in_seconds")
    .maybeSingle<{ total_signed_in_seconds: number }>();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    totalSignedInSeconds:
      updatedProfile?.total_signed_in_seconds ?? nextTotalSeconds,
    addedSeconds: elapsedSeconds,
  });
}
