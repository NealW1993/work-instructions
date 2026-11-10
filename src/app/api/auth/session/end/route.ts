import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Ends the signed-in session timer. Elapsed time comes only from the server-recorded session start
 * (touch_user_session), so a client cannot add arbitrary time to the usage figures shown in KPIs.
 */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: requester, error: requesterError } = await supabase
    .from("profiles")
    .select("id, total_signed_in_seconds")
    .eq("id", user.id)
    .maybeSingle<{ id: string; total_signed_in_seconds: number | null }>();

  if (requesterError) {
    return NextResponse.json({ error: requesterError.message }, { status: 500 });
  }

  if (!requester) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  const previousTotalSeconds = Math.max(0, Number(requester.total_signed_in_seconds ?? 0));
  const { data: totalSignedInSeconds, error: sessionError } = await supabase.rpc("touch_user_session", {
    end_session: true,
  });

  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }

  const nextTotalSeconds = Math.max(previousTotalSeconds, Number(totalSignedInSeconds ?? previousTotalSeconds));
  return NextResponse.json({
    totalSignedInSeconds: nextTotalSeconds,
    addedSeconds: nextTotalSeconds - previousTotalSeconds,
  });
}
