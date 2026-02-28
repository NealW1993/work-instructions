import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { canViewKpis } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface AiEnhancementEventRow {
  actor_user_id: string;
  outcome: "generated" | "applied" | "discarded" | string;
  mode: "create" | "edit" | "fork" | string;
}

type InstructionDraftMode = "create" | "edit" | "fork";

interface ModeBreakdown {
  create: number;
  edit: number;
  fork: number;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface UserAiStatsAccumulator {
  userId: string;
  label: string;
  totalGenerations: number;
  appliedGenerations: number;
  unusedGenerations: number;
}

const MAX_KPI_ROWS = 100000;

function createModeBreakdown(): ModeBreakdown {
  return {
    create: 0,
    edit: 0,
    fork: 0,
  };
}

function isInstructionDraftMode(value: string): value is InstructionDraftMode {
  return value === "create" || value === "edit" || value === "fork";
}

function incrementModeBreakdown(
  breakdown: ModeBreakdown,
  mode: string,
) {
  if (!isInstructionDraftMode(mode)) {
    return;
  }

  breakdown[mode] += 1;
}

export async function GET(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!canViewKpis(requester.role)) {
    return NextResponse.json({ error: "Admin privileges required." }, { status: 403 });
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const [
    { data: profileRows, error: profileError },
    { data: enhancementRows, error: enhancementError },
  ] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .order("full_name", { ascending: true })
      .range(0, 4999),
    supabaseAdmin
      .from("instruction_ai_enhancements")
      .select("actor_user_id, outcome, mode")
      .order("generated_at", { ascending: false })
      .range(0, MAX_KPI_ROWS - 1),
  ]);

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }
  if (enhancementError) {
    return NextResponse.json({ error: enhancementError.message }, { status: 500 });
  }

  const profiles = (profileRows ?? []) as ProfileRow[];
  const enhancements = (enhancementRows ?? []) as AiEnhancementEventRow[];
  const profileLabelById = new Map(
    profiles.map((profile) => [
      profile.id,
      profile.full_name?.trim() || profile.email?.trim() || "Unknown User",
    ]),
  );

  const byUser = new Map<string, UserAiStatsAccumulator>();
  const ensureUserAccumulator = (userId: string) => {
    const existing = byUser.get(userId);
    if (existing) {
      return existing;
    }

    const created: UserAiStatsAccumulator = {
      userId,
      label: profileLabelById.get(userId) ?? "Unknown User",
      totalGenerations: 0,
      appliedGenerations: 0,
      unusedGenerations: 0,
    };
    byUser.set(userId, created);
    return created;
  };

  let totalGenerations = 0;
  let totalAppliedGenerations = 0;
  let totalUnusedGenerations = 0;
  const totalGenerationsByMode = createModeBreakdown();
  const appliedGenerationsByMode = createModeBreakdown();
  const unusedGenerationsByMode = createModeBreakdown();

  for (const event of enhancements) {
    totalGenerations += 1;
    const accumulator = ensureUserAccumulator(event.actor_user_id);
    accumulator.totalGenerations += 1;
    incrementModeBreakdown(totalGenerationsByMode, event.mode);

    if (event.outcome === "applied") {
      totalAppliedGenerations += 1;
      accumulator.appliedGenerations += 1;
      incrementModeBreakdown(appliedGenerationsByMode, event.mode);
    } else if (event.outcome === "discarded") {
      totalUnusedGenerations += 1;
      accumulator.unusedGenerations += 1;
      incrementModeBreakdown(unusedGenerationsByMode, event.mode);
    }
  }

  const users = [...byUser.values()].sort((first, second) => {
    if (second.totalGenerations !== first.totalGenerations) {
      return second.totalGenerations - first.totalGenerations;
    }

    if (second.appliedGenerations !== first.appliedGenerations) {
      return second.appliedGenerations - first.appliedGenerations;
    }

    if (second.unusedGenerations !== first.unusedGenerations) {
      return second.unusedGenerations - first.unusedGenerations;
    }

    return first.label.localeCompare(second.label);
  });

  return NextResponse.json({
    totalGenerations,
    totalAppliedGenerations,
    totalUnusedGenerations,
    totalGenerationsByMode,
    appliedGenerationsByMode,
    unusedGenerationsByMode,
    users,
    generatedAt: new Date().toISOString(),
  });
}
