import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { canViewKpis } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface ReviewCoverageSettingsRow {
  review_window_days: number;
}

interface ReviewCoverageDepartmentRelation {
  name: string | null;
}

interface ReviewCoverageWorkItemRelation {
  part_id: string | null;
  item_title: string | null;
  departments: ReviewCoverageDepartmentRelation | ReviewCoverageDepartmentRelation[] | null;
}

interface ReviewCoverageInstructionRow {
  id: string;
  revision: number;
  updated_at: string;
  work_items: ReviewCoverageWorkItemRelation | ReviewCoverageWorkItemRelation[] | null;
}

interface ReviewCoverageStatusRow {
  instruction_id: string;
  status: "up_to_date" | "needs_review";
  last_calibrated_at: string;
  flagged_at: string | null;
}

interface ReviewStateChangeEventRow {
  instruction_id: string;
  occurred_at: string;
  actor_user_id: string | null;
  source_payload: unknown;
}

interface ReviewStatePayload {
  kind?: unknown;
  nextStatus?: unknown;
}

interface ReviewActionUserStats {
  userId: string;
  label: string;
  markedNeedsReviewCount: number;
  markedUpToDateCount: number;
  totalReviewActions: number;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
}

const DEFAULT_REVIEW_WINDOW_DAYS = 30;
const MAX_KPI_ROWS = 10000;

function isReviewState(value: unknown): value is "up_to_date" | "needs_review" {
  return value === "up_to_date" || value === "needs_review";
}

function normalizeRelation<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function normalizeReviewWindowDays(value: unknown) {
  if (!Number.isInteger(value)) {
    return null;
  }

  const parsed = Number(value);
  return parsed >= 1 && parsed <= 365 ? parsed : null;
}

function addDaysLocal(value: string, days: number) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || !Number.isFinite(days)) {
    return null;
  }

  parsed.setDate(parsed.getDate() + Math.trunc(days));
  return parsed.toISOString();
}

function toElapsedCalendarDays(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const today = new Date();
  const valueStart = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const elapsed = todayStart - valueStart;
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return null;
  }

  return Math.round(elapsed / (1000 * 60 * 60 * 24));
}

function normalizeReviewStatePayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const typed = payload as ReviewStatePayload;
  if (typed.kind !== "instruction_review_state") {
    return null;
  }

  if (!isReviewState(typed.nextStatus)) {
    return null;
  }

  return {
    nextStatus: typed.nextStatus,
  };
}

function toElapsedDays(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  const deltaMs = end.getTime() - start.getTime();
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    return null;
  }

  return deltaMs / (1000 * 60 * 60 * 24);
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
  const { data: reviewSettingsData, error: reviewSettingsError } = await supabaseAdmin
    .from("instruction_review_settings")
    .select("review_window_days")
    .eq("id", true)
    .maybeSingle<ReviewCoverageSettingsRow>();

  if (reviewSettingsError) {
    return NextResponse.json({ error: reviewSettingsError.message }, { status: 500 });
  }

  const reviewWindowDays =
    normalizeReviewWindowDays(reviewSettingsData?.review_window_days) ??
    DEFAULT_REVIEW_WINDOW_DAYS;

  const [
    { data: instructionRows, error: instructionRowsError },
    { data: reviewStateEventsRows, error: reviewStateEventsError },
  ] = await Promise.all([
    supabaseAdmin
      .from("work_instructions")
      .select("id, revision, updated_at, work_items!inner(part_id, item_title, departments(name))")
      .eq("is_archived", false)
      .range(0, MAX_KPI_ROWS - 1),
    supabaseAdmin
      .from("instruction_change_events")
      .select("instruction_id, occurred_at, actor_user_id, source_payload")
      .eq("event_type", "updated")
      .contains("source_payload", { kind: "instruction_review_state" })
      .range(0, MAX_KPI_ROWS - 1),
  ]);

  if (instructionRowsError) {
    return NextResponse.json({ error: instructionRowsError.message }, { status: 500 });
  }
  if (reviewStateEventsError) {
    return NextResponse.json({ error: reviewStateEventsError.message }, { status: 500 });
  }

  const instructions = (instructionRows ?? []) as ReviewCoverageInstructionRow[];
  const reviewStateEvents = (reviewStateEventsRows ?? []) as ReviewStateChangeEventRow[];
  const instructionIds = instructions.map((instruction) => instruction.id);

  const { data: reviewStatusRows, error: reviewStatusRowsError } =
    instructionIds.length > 0
      ? await supabaseAdmin
          .from("instruction_review_status")
          .select("instruction_id, status, last_calibrated_at, flagged_at")
          .in("instruction_id", instructionIds)
          .range(0, MAX_KPI_ROWS - 1)
      : { data: null, error: null };

  if (reviewStatusRowsError) {
    return NextResponse.json({ error: reviewStatusRowsError.message }, { status: 500 });
  }

  const reviewStatusByInstructionId = new Map<string, ReviewCoverageStatusRow>();
  for (const row of (reviewStatusRows ?? []) as ReviewCoverageStatusRow[]) {
    reviewStatusByInstructionId.set(row.instruction_id, row);
  }

  const needsReviewInstructions = instructions
    .map((instruction) => {
      const reviewStatus = reviewStatusByInstructionId.get(instruction.id) ?? null;
      const calibratedAt = reviewStatus?.last_calibrated_at ?? instruction.updated_at;
      const daysSinceCalibration = toElapsedCalendarDays(calibratedAt);
      const isFlagged = reviewStatus?.status === "needs_review";
      const isOutOfRange =
        daysSinceCalibration !== null && daysSinceCalibration >= reviewWindowDays;
      const overdueDays =
        daysSinceCalibration === null
          ? null
          : Math.max(0, daysSinceCalibration - reviewWindowDays);

      if (!isFlagged && !isOutOfRange) {
        return null;
      }

      const workItem = normalizeRelation(instruction.work_items);
      const department = normalizeRelation(workItem?.departments);
      const flaggedAt = reviewStatus?.flagged_at ?? null;
      const flaggedDurationDays = flaggedAt ? toElapsedCalendarDays(flaggedAt) : null;
      const outOfRangeDurationDays = overdueDays;
      const needsReviewDurationDays =
        isFlagged && flaggedDurationDays !== null
          ? flaggedDurationDays
          : isOutOfRange && outOfRangeDurationDays !== null
            ? outOfRangeDurationDays
            : null;
      const needsReviewSinceAt =
        isFlagged && flaggedAt
          ? flaggedAt
          : isOutOfRange
            ? addDaysLocal(calibratedAt, reviewWindowDays)
            : null;
      const reviewReason =
        isFlagged && isOutOfRange
          ? "Flagged and out of range"
          : isFlagged
            ? "Flagged Needs Review"
            : "Outside review window";

      return {
        instructionId: instruction.id,
        revision: instruction.revision,
        partId: workItem?.part_id?.trim() || "N/A",
        itemTitle: workItem?.item_title?.trim() || "Untitled work instruction",
        departmentName: department?.name?.trim() || "Unknown Department",
        reviewReason,
        isFlagged,
        isOutOfRange,
        daysSinceCalibration,
        overdueDays,
        needsReviewDurationDays,
        needsReviewSinceAt,
        lastCalibratedAt: calibratedAt,
      };
    })
    .filter(
      (
        entry,
        ): entry is {
          instructionId: string;
          revision: number;
          partId: string;
          itemTitle: string;
          departmentName: string;
        reviewReason: string;
        isFlagged: boolean;
        isOutOfRange: boolean;
        daysSinceCalibration: number | null;
        overdueDays: number | null;
        needsReviewDurationDays: number | null;
        needsReviewSinceAt: string | null;
        lastCalibratedAt: string;
      } => entry !== null,
    )
    .sort((first, second) => {
      if (first.isFlagged !== second.isFlagged) {
        return Number(second.isFlagged) - Number(first.isFlagged);
      }

      const firstOverdueDays = first.overdueDays ?? -1;
      const secondOverdueDays = second.overdueDays ?? -1;
      if (secondOverdueDays !== firstOverdueDays) {
        return secondOverdueDays - firstOverdueDays;
      }

      if (first.partId !== second.partId) {
        return first.partId.localeCompare(second.partId);
      }

      return first.itemTitle.localeCompare(second.itemTitle);
    });

  const totalInstructions = instructions.length;
  const needsReviewCount = needsReviewInstructions.length;
  const reviewedCount = Math.max(0, totalInstructions - needsReviewCount);
  const totalNeedsReviewDurationDays = needsReviewInstructions.reduce((sum, instruction) => {
    return sum + (instruction.needsReviewDurationDays ?? 0);
  }, 0);
  const averageNeedsReviewDurationDays =
    needsReviewCount > 0 ? totalNeedsReviewDurationDays / needsReviewCount : null;

  const reviewActionByUserId = new Map<string, ReviewActionUserStats>();
  const actorIds = new Set<string>();
  let totalMarkedNeedsReviewActions = 0;
  let totalMarkedUpToDateActions = 0;
  const reviewEventsByInstructionId = new Map<
    string,
    Array<{ occurredAt: string; nextStatus: "up_to_date" | "needs_review" }>
  >();

  for (const event of reviewStateEvents) {
    const payload = normalizeReviewStatePayload(event.source_payload);
    if (!payload) {
      continue;
    }

    const existingReviewEvents = reviewEventsByInstructionId.get(event.instruction_id) ?? [];
    existingReviewEvents.push({
      occurredAt: event.occurred_at,
      nextStatus: payload.nextStatus,
    });
    reviewEventsByInstructionId.set(event.instruction_id, existingReviewEvents);

    if (!event.actor_user_id) {
      continue;
    }

    actorIds.add(event.actor_user_id);
    const existing = reviewActionByUserId.get(event.actor_user_id) ?? {
      userId: event.actor_user_id,
      label: "Unknown User",
      markedNeedsReviewCount: 0,
      markedUpToDateCount: 0,
      totalReviewActions: 0,
    };

    existing.totalReviewActions += 1;
    if (payload.nextStatus === "needs_review") {
      existing.markedNeedsReviewCount += 1;
      totalMarkedNeedsReviewActions += 1;
    } else {
      existing.markedUpToDateCount += 1;
      totalMarkedUpToDateActions += 1;
    }

    reviewActionByUserId.set(event.actor_user_id, existing);
  }

  let totalResolvedNeedsReviewDays = 0;
  let resolvedNeedsReviewCycleCount = 0;

  for (const events of reviewEventsByInstructionId.values()) {
    const sortedEvents = [...events].sort((first, second) =>
      first.occurredAt.localeCompare(second.occurredAt),
    );
    let needsReviewStartedAt: string | null = null;

    for (const event of sortedEvents) {
      if (event.nextStatus === "needs_review") {
        needsReviewStartedAt = event.occurredAt;
        continue;
      }

      if (event.nextStatus === "up_to_date" && needsReviewStartedAt) {
        const elapsedDays = toElapsedDays(needsReviewStartedAt, event.occurredAt);
        if (elapsedDays !== null) {
          totalResolvedNeedsReviewDays += elapsedDays;
          resolvedNeedsReviewCycleCount += 1;
        }
        needsReviewStartedAt = null;
      }
    }
  }

  const averageResolvedNeedsReviewDays =
    resolvedNeedsReviewCycleCount > 0
      ? totalResolvedNeedsReviewDays / resolvedNeedsReviewCycleCount
      : null;

  const actorIdList = Array.from(actorIds);
  const { data: actorProfiles, error: actorProfilesError } =
    actorIdList.length > 0
      ? await supabaseAdmin
          .from("profiles")
          .select("id, full_name, email")
          .in("id", actorIdList)
          .range(0, 4999)
      : { data: null, error: null };

  if (actorProfilesError) {
    return NextResponse.json({ error: actorProfilesError.message }, { status: 500 });
  }

  const actorNameById = new Map<string, string>();
  for (const actorProfile of (actorProfiles ?? []) as ProfileRow[]) {
    actorNameById.set(
      actorProfile.id,
      actorProfile.full_name?.trim() || actorProfile.email?.trim() || "Unknown User",
    );
  }

  const userReviewActions = Array.from(reviewActionByUserId.values())
    .map((entry) => ({
      ...entry,
      label: actorNameById.get(entry.userId) ?? entry.label,
    }))
    .sort((first, second) => {
      if (second.totalReviewActions !== first.totalReviewActions) {
        return second.totalReviewActions - first.totalReviewActions;
      }

      if (second.markedNeedsReviewCount !== first.markedNeedsReviewCount) {
        return second.markedNeedsReviewCount - first.markedNeedsReviewCount;
      }

      return first.label.localeCompare(second.label);
    });

  return NextResponse.json({
    reviewWindowDays,
    totalInstructions,
    needsReviewCount,
    reviewedCount,
    averageNeedsReviewDurationDays,
    totalNeedsReviewDurationDays,
    averageResolvedNeedsReviewDays,
    resolvedNeedsReviewCycleCount,
    totalMarkedNeedsReviewActions,
    totalMarkedUpToDateActions,
    userReviewActions,
    needsReviewInstructions,
  });
}
