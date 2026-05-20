import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { canViewKpis } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
  is_active: boolean | null;
}

interface AiUsageEventRow {
  actor_user_id: string;
  feature: string;
  action: string;
  mode: string;
  token_input: number | null;
  token_output: number | null;
  token_total: number | null;
  metadata: unknown;
  created_at: string;
}

interface UserSystemUsageAccumulator {
  userId: string;
  label: string;
  isActive: boolean;
  totalEvents: number;
  aiEvents: number;
  tokenInput: number;
  tokenOutput: number;
  tokenTotal: number;
  dashboardSearches: number;
  dashboardAiSearches: number;
  dashboardLexicalSearches: number;
  instructionEnhancements: number;
  processMapRecommendations: number;
  processMapBuilderActions: number;
  chartExports: number;
  capabilityAnalyses: number;
  processDocumentCreates: number;
  processDocumentRevisions: number;
  processDocumentImports: number;
  processDocumentTemplates: number;
  lastActivityAt: string | null;
}

const MAX_KPI_ROWS = 100000;

function toCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

function getProfileLabel(profile: ProfileRow) {
  return profile.full_name?.trim() || profile.email?.trim() || "Unknown User";
}

function metadataIndicatesCapability(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }

  const typedMetadata = metadata as {
    usesCapability?: unknown;
    formulaTool?: unknown;
  };

  return typedMetadata.usesCapability === true || typedMetadata.formulaTool === "capability";
}

function createAccumulator(input: {
  userId: string;
  label: string;
  isActive: boolean;
}): UserSystemUsageAccumulator {
  return {
    userId: input.userId,
    label: input.label,
    isActive: input.isActive,
    totalEvents: 0,
    aiEvents: 0,
    tokenInput: 0,
    tokenOutput: 0,
    tokenTotal: 0,
    dashboardSearches: 0,
    dashboardAiSearches: 0,
    dashboardLexicalSearches: 0,
    instructionEnhancements: 0,
    processMapRecommendations: 0,
    processMapBuilderActions: 0,
    chartExports: 0,
    capabilityAnalyses: 0,
    processDocumentCreates: 0,
    processDocumentRevisions: 0,
    processDocumentImports: 0,
    processDocumentTemplates: 0,
    lastActivityAt: null,
  };
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
    { data: usageRows, error: usageError },
  ] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, is_active")
      .order("full_name", { ascending: true })
      .range(0, 4999),
    supabaseAdmin
      .from("ai_usage_events")
      .select(
        "actor_user_id, feature, action, mode, token_input, token_output, token_total, metadata, created_at",
      )
      .order("created_at", { ascending: false })
      .range(0, MAX_KPI_ROWS - 1),
  ]);

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  if (usageError) {
    return NextResponse.json({ error: usageError.message }, { status: 500 });
  }

  const profiles = (profileRows ?? []) as ProfileRow[];
  const usageEvents = (usageRows ?? []) as AiUsageEventRow[];
  const byUser = new Map<string, UserSystemUsageAccumulator>();

  for (const profile of profiles) {
    byUser.set(
      profile.id,
      createAccumulator({
        userId: profile.id,
        label: getProfileLabel(profile),
        isActive: profile.is_active !== false,
      }),
    );
  }

  const ensureAccumulator = (userId: string) => {
    const existing = byUser.get(userId);
    if (existing) {
      return existing;
    }

    const created = createAccumulator({
      userId,
      label: "Unknown User",
      isActive: false,
    });
    byUser.set(userId, created);
    return created;
  };

  for (const event of usageEvents) {
    const accumulator = ensureAccumulator(event.actor_user_id);
    const tokenInput = toCount(event.token_input);
    const tokenOutput = toCount(event.token_output);
    const tokenTotal = toCount(event.token_total) || tokenInput + tokenOutput;

    accumulator.totalEvents += 1;
    accumulator.tokenInput += tokenInput;
    accumulator.tokenOutput += tokenOutput;
    accumulator.tokenTotal += tokenTotal;

    if (event.mode === "ai" || tokenTotal > 0) {
      accumulator.aiEvents += 1;
    }

    if (!accumulator.lastActivityAt || event.created_at > accumulator.lastActivityAt) {
      accumulator.lastActivityAt = event.created_at;
    }

    if (event.feature === "dashboard_search") {
      accumulator.dashboardSearches += 1;
      if (event.mode === "ai") {
        accumulator.dashboardAiSearches += 1;
      } else {
        accumulator.dashboardLexicalSearches += 1;
      }
    }

    if (event.feature === "instruction_enhancement") {
      accumulator.instructionEnhancements += 1;
    }

    if (event.feature === "process_map_recommendation") {
      accumulator.processMapRecommendations += 1;
    }

    if (event.feature === "process_map_builder") {
      accumulator.processMapBuilderActions += 1;
      if (
        event.action === "download_svg" ||
        event.action === "download_csv" ||
        event.action === "download_report" ||
        event.action === "print"
      ) {
        accumulator.chartExports += 1;
      }
    }

    if (event.feature === "capability_analysis" || metadataIndicatesCapability(event.metadata)) {
      accumulator.capabilityAnalyses += 1;
    }

    if (event.feature === "process_document_create") {
      accumulator.processDocumentCreates += 1;
    }

    if (event.feature === "process_document_revision") {
      accumulator.processDocumentRevisions += 1;
    }

    if (event.feature === "process_document_import") {
      accumulator.processDocumentImports += 1;
    }

    if (event.feature === "process_document_template") {
      accumulator.processDocumentTemplates += 1;
    }
  }

  const users = [...byUser.values()]
    .filter((entry) => entry.isActive || entry.totalEvents > 0)
    .sort((first, second) => {
      if (second.totalEvents !== first.totalEvents) {
        return second.totalEvents - first.totalEvents;
      }

      if (second.tokenTotal !== first.tokenTotal) {
        return second.tokenTotal - first.tokenTotal;
      }

      return first.label.localeCompare(second.label);
    });

  const totals = users.reduce(
    (accumulator, user) => ({
      totalEvents: accumulator.totalEvents + user.totalEvents,
      aiEvents: accumulator.aiEvents + user.aiEvents,
      tokenInput: accumulator.tokenInput + user.tokenInput,
      tokenOutput: accumulator.tokenOutput + user.tokenOutput,
      tokenTotal: accumulator.tokenTotal + user.tokenTotal,
      dashboardSearches: accumulator.dashboardSearches + user.dashboardSearches,
      processMapRecommendations:
        accumulator.processMapRecommendations + user.processMapRecommendations,
      capabilityAnalyses: accumulator.capabilityAnalyses + user.capabilityAnalyses,
      processDocumentCreates:
        accumulator.processDocumentCreates + user.processDocumentCreates,
      processDocumentImports:
        accumulator.processDocumentImports + user.processDocumentImports,
      processDocumentTemplates:
        accumulator.processDocumentTemplates + user.processDocumentTemplates,
      chartExports: accumulator.chartExports + user.chartExports,
    }),
    {
      totalEvents: 0,
      aiEvents: 0,
      tokenInput: 0,
      tokenOutput: 0,
      tokenTotal: 0,
      dashboardSearches: 0,
      processMapRecommendations: 0,
      capabilityAnalyses: 0,
      processDocumentCreates: 0,
      processDocumentImports: 0,
      processDocumentTemplates: 0,
      chartExports: 0,
    },
  );

  return NextResponse.json({
    totals,
    users,
    generatedAt: new Date().toISOString(),
  });
}
