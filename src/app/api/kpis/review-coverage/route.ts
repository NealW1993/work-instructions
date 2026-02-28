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
  updated_at: string;
  work_items: ReviewCoverageWorkItemRelation | ReviewCoverageWorkItemRelation[] | null;
}

interface ReviewCoverageStatusRow {
  instruction_id: string;
  status: "up_to_date" | "needs_review";
  last_calibrated_at: string;
}

const DEFAULT_REVIEW_WINDOW_DAYS = 30;

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

function toElapsedCalendarDaysUtc(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const today = new Date();
  const valueStart = Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  );
  const todayStart = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const elapsed = todayStart - valueStart;
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return null;
  }

  return Math.round(elapsed / (1000 * 60 * 60 * 24));
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

  const { data: instructionRows, error: instructionRowsError } = await supabaseAdmin
    .from("work_instructions")
    .select("id, updated_at, work_items!inner(part_id, item_title, departments(name))")
    .eq("is_archived", false)
    .range(0, 9999);

  if (instructionRowsError) {
    return NextResponse.json({ error: instructionRowsError.message }, { status: 500 });
  }

  const instructions = (instructionRows ?? []) as ReviewCoverageInstructionRow[];
  const instructionIds = instructions.map((instruction) => instruction.id);

  const { data: reviewStatusRows, error: reviewStatusRowsError } =
    instructionIds.length > 0
      ? await supabaseAdmin
          .from("instruction_review_status")
          .select("instruction_id, status, last_calibrated_at")
          .in("instruction_id", instructionIds)
          .range(0, 9999)
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
      const daysSinceCalibration = toElapsedCalendarDaysUtc(calibratedAt);
      const isFlagged = reviewStatus?.status === "needs_review";
      const isOutOfRange =
        daysSinceCalibration !== null && daysSinceCalibration >= reviewWindowDays;

      if (!isFlagged && !isOutOfRange) {
        return null;
      }

      const workItem = normalizeRelation(instruction.work_items);
      const department = normalizeRelation(workItem?.departments);
      const overdueDays =
        daysSinceCalibration === null
          ? null
          : Math.max(0, daysSinceCalibration - reviewWindowDays);
      const reviewReason =
        isFlagged && isOutOfRange
          ? "Flagged and out of range"
          : isFlagged
            ? "Flagged Needs Review"
            : "Outside review window";

      return {
        instructionId: instruction.id,
        partId: workItem?.part_id?.trim() || "N/A",
        itemTitle: workItem?.item_title?.trim() || "Untitled work instruction",
        departmentName: department?.name?.trim() || "Unknown Department",
        reviewReason,
        isFlagged,
        isOutOfRange,
        daysSinceCalibration,
        overdueDays,
        lastCalibratedAt: calibratedAt,
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        instructionId: string;
        partId: string;
        itemTitle: string;
        departmentName: string;
        reviewReason: string;
        isFlagged: boolean;
        isOutOfRange: boolean;
        daysSinceCalibration: number | null;
        overdueDays: number | null;
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

  return NextResponse.json({
    reviewWindowDays,
    totalInstructions,
    needsReviewCount,
    reviewedCount,
    needsReviewInstructions,
  });
}
