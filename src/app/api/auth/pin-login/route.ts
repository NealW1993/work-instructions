import { NextResponse } from "next/server";

import { clientAddress, isRateLimited, recordRateLimitedEvent } from "@/lib/rate-limit.server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isValidEmployeeId, normalizeEmployeeId } from "@/lib/utils";

// Matches the database lock: ten wrong PINs for one Employee ID lock it for 1 minute.
const LOCKOUT_SECONDS = 60;
// Many failures from one device within a minute pause it for up to a minute, across all IDs.
const MAX_FAILURES_PER_ADDRESS = 20;
const FAILURE_WINDOW_MS = LOCKOUT_SECONDS * 1000;

interface PinLoginBody {
  employeeId?: string;
  pin?: string;
}

export async function POST(request: Request) {
  const supabaseAdmin = getSupabaseAdminClient();
  const body = (await request.json().catch(() => ({}))) as PinLoginBody;

  const employeeId = normalizeEmployeeId(typeof body?.employeeId === "string" ? body.employeeId : "");
  const pin = typeof body?.pin === "string" ? body.pin.trim() : "";

  if (!isValidEmployeeId(employeeId)) {
    return NextResponse.json(
      { error: "Employee ID must be 1-6 digits." },
      { status: 400 },
    );
  }

  if (!pin || !/^\d{6}$/.test(pin)) {
    return NextResponse.json(
      { error: "Valid 6-digit PIN is required." },
      { status: 400 },
    );
  }

  // Many failures from one address are slowed down across all identifiers (PIN spraying).
  const addressKey = `pin-login:${clientAddress(request)}`;
  if (isRateLimited(addressKey, MAX_FAILURES_PER_ADDRESS)) {
    return NextResponse.json(
      { error: "Too many failed sign-in attempts from this device. Wait a minute and try again." },
      { status: 429, headers: { "Retry-After": String(LOCKOUT_SECONDS) } },
    );
  }

  const { data: userId, error: pinError } = await supabaseAdmin.rpc(
    "verify_pin_login",
    {
      login_identifier: employeeId,
      submitted_pin: pin,
    },
  );

  if (pinError) {
    if (pinError.code === "P0429") {
      return NextResponse.json({ error: pinError.message }, { status: 429, headers: { "Retry-After": String(LOCKOUT_SECONDS) } });
    }
    return NextResponse.json({ error: "Sign-in is unavailable right now. Try again shortly." }, { status: 500 });
  }

  if (!userId) {
    recordRateLimitedEvent(addressKey, FAILURE_WINDOW_MS);
    return NextResponse.json(
      { error: "Invalid credentials." },
      { status: 401 },
    );
  }

  // Issue the session for the exact account whose PIN was verified (by id), not a profile email copy.
  const { data: authUser, error: profileError } = await supabaseAdmin.auth.admin.getUserById(userId);

  const verifiedUser = authUser?.user?.id === userId ? authUser.user : null;
  const resolvedEmail = verifiedUser?.email?.trim().toLowerCase();

  if (profileError || !resolvedEmail) {
    return NextResponse.json(
      { error: "Unable to resolve account email for PIN login." },
      { status: 500 },
    );
  }

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink(
    {
      type: "magiclink",
      email: resolvedEmail,
    },
  );

  if (linkError || !linkData.properties?.hashed_token || linkData.user?.id !== userId) {
    return NextResponse.json(
      { error: linkError?.message ?? "Unable to generate login token." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    tokenHash: linkData.properties.hashed_token,
    email: resolvedEmail,
  });
}
