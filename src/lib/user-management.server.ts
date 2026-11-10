import "server-only";

import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AppRole } from "@/lib/types";
import { ACCOUNT_MANAGEMENT_DENIED, canManageAccounts } from "@/lib/user-management";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ManagedAccount {
  id: string;
  role: AppRole;
  is_active: boolean;
  employee_id: string | null;
  email: string;
}

/** Confirms the requester may change accounts and loads the target; otherwise returns the error response. */
export async function authorizeAccountChange(
  requesterRole: AppRole,
  targetId: string,
): Promise<{ target: ManagedAccount; response?: undefined } | { target?: undefined; response: NextResponse }> {
  // Checked before the lookup, so a refused caller cannot learn which account ids exist.
  if (!canManageAccounts(requesterRole)) {
    return { response: NextResponse.json({ error: ACCOUNT_MANAGEMENT_DENIED }, { status: 403 }) };
  }
  if (!UUID_PATTERN.test(targetId)) {
    return { response: NextResponse.json({ error: "Invalid user id." }, { status: 400 }) };
  }
  const { data, error } = await getSupabaseAdminClient()
    .from("profiles")
    .select("id, role, is_active, employee_id, email")
    .eq("id", targetId)
    .maybeSingle<ManagedAccount>();
  if (error) return { response: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!data) return { response: NextResponse.json({ error: "User not found." }, { status: 404 }) };
  return { target: data };
}
