import { DashboardClient } from "@/components/dashboard/dashboard-client";
import type {
  DashboardInstructionCardData,
  DashboardFormulaApprovalStatus,
  DashboardFormulaData,
  DashboardInstructionReviewStatusData,
  DashboardLikeCelebrationData,
  DashboardLikedInstructionCardData,
  DashboardPinnedInstructionCardData,
  DashboardProcessDocumentData,
  DashboardSystemHistoryEventData,
  DashboardWorkItemData,
} from "@/components/dashboard/dashboard-client";
import { requireAuthenticatedUser } from "@/lib/auth";
import {
  type ProcessDocumentStatus,
  type ProcessDocumentType,
  getProcessDocumentTypeLabel,
} from "@/lib/process-documents";
import { canEditInstructions, hasFullAccess } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface DashboardPageProps {
  searchParams: Promise<{
    q?: string;
  }>;
}

interface DashboardDepartmentRelation {
  name: string;
  color_hex: string | null;
}

interface DashboardInstructionWorkItem {
  department_id: string;
  departments: DashboardDepartmentRelation | DashboardDepartmentRelation[] | null;
  part_id: string;
  item_title: string;
}

interface DashboardInstructionRow {
  id: string;
  revision: number;
  fork_root_instruction_id: string | null;
  fork_number: number | null;
  last_change_summary: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  work_items: DashboardInstructionWorkItem | DashboardInstructionWorkItem[];
}

interface DashboardHistoryInstructionRelation {
  id: string;
  is_archived: boolean;
  work_items: DashboardInstructionWorkItem | DashboardInstructionWorkItem[] | null;
}

interface DashboardInstructionChangeEventRow {
  id: string;
  instruction_id: string;
  event_type: "created" | "updated" | string;
  detail: string | null;
  revision: number | null;
  occurred_at: string;
  actor_user_id: string;
  work_instructions:
    | DashboardHistoryInstructionRelation
    | DashboardHistoryInstructionRelation[]
    | null;
}

interface DashboardWorkItemInstructionRow {
  id: string;
  revision: number;
  fork_root_instruction_id: string | null;
  fork_number: number | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}

interface DashboardPinnedInstructionRow {
  created_at: string;
  work_instructions: DashboardInstructionRow | DashboardInstructionRow[] | null;
}

interface DashboardInstructionLikeRow {
  created_at: string;
  instruction_id: string;
  user_id: string;
  work_instructions: DashboardInstructionRow | DashboardInstructionRow[] | null;
}

interface DashboardWorkItemRow {
  id: string;
  department_id: string;
  departments: DashboardDepartmentRelation | DashboardDepartmentRelation[] | null;
  part_id: string;
  item_title: string;
  updated_at: string;
  work_instructions: DashboardWorkItemInstructionRow[];
}

interface DashboardInstructionReviewSettingsRow {
  review_window_days: number;
}

interface DashboardInstructionReviewStatusRow {
  instruction_id: string;
  status: "up_to_date" | "needs_review";
  last_calibrated_at: string;
  flagged_at: string | null;
  updated_at: string;
}

interface DashboardProcessDocumentRow {
  id: string;
  document_number: string;
  title: string;
  document_type: ProcessDocumentType;
  status: ProcessDocumentStatus;
  department_id: string | null;
  process_name: string | null;
  process_scope: string | null;
  process_inputs: string | null;
  process_outputs: string | null;
  process_risks: string | null;
  process_controls: string | null;
  iso_clause_refs: string[] | null;
  current_revision: number;
  updated_at: string;
  departments: DashboardDepartmentRelation | DashboardDepartmentRelation[] | null;
}

interface DashboardFormulaRow {
  id: string;
  owner_user_id: string;
  name: string;
  formula_type: string;
  payload: unknown;
  created_at: string;
  updated_at: string;
}

interface DashboardReviewStateSourcePayload {
  kind?: unknown;
  nextStatus?: unknown;
  reviewOrigin?: unknown;
  note?: unknown;
}

interface DashboardNeedsReviewEventRow {
  instruction_id: string;
  occurred_at: string;
  detail: string | null;
  source_payload: unknown;
}

interface DashboardNeedsReviewMetadata {
  reviewOrigin: "user" | "system";
  note: string | null;
}

const DEFAULT_REVIEW_WINDOW_DAYS = 30;
const MIN_REVIEW_WINDOW_DAYS = 1;
const MAX_REVIEW_WINDOW_DAYS = 365;
const REVIEW_STATUS_BATCH_SIZE = 300;
const DEFAULT_DEPARTMENT_COLOR = "#0EA5E9";
const DASHBOARD_QUERY_TIMEOUT_MS = 12000;

interface DashboardQueryError {
  message: string;
}

interface DashboardQueryResult<TData> {
  data: TData | null;
  error: DashboardQueryError | null;
}

async function runDashboardQuery<TData>(
  queryPromise: PromiseLike<DashboardQueryResult<TData>>,
  timeoutMessage: string,
): Promise<DashboardQueryResult<TData>> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      queryPromise,
      new Promise<DashboardQueryResult<TData>>((resolve) => {
        timeoutHandle = setTimeout(() => {
          resolve({
            data: null,
            error: { message: timeoutMessage },
          });
        }, DASHBOARD_QUERY_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return {
      data: null,
      error: { message: timeoutMessage },
    };
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
}

function normalizeReviewWindowDays(value: unknown) {
  if (!Number.isInteger(value)) {
    return null;
  }

  const parsed = Number(value);
  if (parsed < MIN_REVIEW_WINDOW_DAYS || parsed > MAX_REVIEW_WINDOW_DAYS) {
    return null;
  }

  return parsed;
}

function normalizeWorkItem(
  relation:
    | DashboardInstructionWorkItem
    | DashboardInstructionWorkItem[]
    | null
    | undefined,
) {
  if (!relation) {
    return null;
  }

  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }

  return relation;
}

function normalizeDepartmentName(
  relation: DashboardDepartmentRelation | DashboardDepartmentRelation[] | null | undefined,
) {
  if (!relation) {
    return "Unknown";
  }

  if (Array.isArray(relation)) {
    return relation[0]?.name ?? "Unknown";
  }

  return relation.name;
}

function normalizeDepartmentColor(
  relation: DashboardDepartmentRelation | DashboardDepartmentRelation[] | null | undefined,
) {
  const department = Array.isArray(relation) ? (relation[0] ?? null) : relation;
  const normalized = (department?.color_hex ?? "").trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : DEFAULT_DEPARTMENT_COLOR;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getCustomFormulaApprovalStatus(
  payload: unknown,
): Exclude<DashboardFormulaApprovalStatus, "system"> {
  if (!isRecord(payload)) {
    return "draft";
  }

  const customFormula = isRecord(payload.customFormula) ? payload.customFormula : {};
  const status = customFormula.approvalStatus;

  return status === "pending_review" ||
    status === "approved" ||
    status === "rejected" ||
    status === "draft"
    ? status
    : "draft";
}

function getFormulaApprovalStatus(row: DashboardFormulaRow): DashboardFormulaApprovalStatus {
  if (row.formula_type !== "custom") {
    return "system";
  }

  return getCustomFormulaApprovalStatus(row.payload);
}

function requesterCanSeeFormula(
  row: DashboardFormulaRow,
  requesterId: string,
  canApprove: boolean,
) {
  if (canApprove || row.owner_user_id === requesterId) {
    return true;
  }

  return row.formula_type === "custom" && getCustomFormulaApprovalStatus(row.payload) === "approved";
}

function getFormulaDescription(payload: unknown) {
  if (!isRecord(payload)) {
    return "";
  }

  const customFormula = isRecord(payload.customFormula) ? payload.customFormula : null;
  const description =
    (typeof customFormula?.description === "string" && customFormula.description) ||
    (typeof payload.description === "string" && payload.description) ||
    (typeof payload.summary === "string" && payload.summary) ||
    "";

  return description.trim().slice(0, 240);
}

function getFormulaCollectionCount(payload: unknown, key: "inputs" | "outputs") {
  if (!isRecord(payload)) {
    return 0;
  }

  const customFormula = isRecord(payload.customFormula) ? payload.customFormula : null;
  const collection = Array.isArray(customFormula?.[key])
    ? customFormula[key]
    : Array.isArray(payload[key])
      ? payload[key]
      : null;

  return collection?.length ?? 0;
}

function normalizeInstruction(
  relation: DashboardInstructionRow | DashboardInstructionRow[] | null,
) {
  if (!relation) {
    return null;
  }

  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }

  return relation;
}

function normalizeHistoryEventInstruction(
  relation:
    | DashboardHistoryInstructionRelation
    | DashboardHistoryInstructionRelation[]
    | null
    | undefined,
) {
  if (!relation) {
    return null;
  }

  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }

  return relation;
}

function getPartIdLabel(partId: string) {
  const normalizedPartId = partId?.trim();
  if (normalizedPartId) {
    return normalizedPartId;
  }

  return "N/A";
}

function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function formatHistoryInstructionUpdateDetail(instruction: DashboardInstructionRow) {
  const summary = instruction.last_change_summary?.trim();
  if (summary) {
    return summary;
  }

  if (instruction.revision > 1) {
    return `Revision ${instruction.revision} updated.`;
  }

  return "Instruction content updated.";
}

function formatHistoryEventDetail(params: {
  detail: string | null | undefined;
  eventType: "created" | "updated";
  revision: number | null;
}) {
  const summary = params.detail?.trim();
  if (summary) {
    return summary;
  }

  if (params.eventType === "created") {
    if ((params.revision ?? 0) > 0) {
      return `Revision ${params.revision} created.`;
    }
    return "Instruction created.";
  }

  if ((params.revision ?? 0) > 0) {
    return `Revision ${params.revision} updated.`;
  }

  return "Instruction content updated.";
}

function getHistoryEventActionLabel(params: {
  eventType: "created" | "updated";
  detail: string | null | undefined;
}) {
  if (params.eventType === "created") {
    return "Instruction Created";
  }

  const normalizedDetail = params.detail?.trim().toLowerCase() ?? "";
  if (normalizedDetail.includes("review state changed to needs review")) {
    return "Needs Review";
  }
  if (normalizedDetail.includes("review state changed to up to date")) {
    return "Marked Up To Date";
  }

  return "Instruction Updated";
}

function buildCreatorNameMap(
  users: Array<{ id: string; full_name: string }> | null,
) {
  return new Map((users ?? []).map((entry) => [entry.id, entry.full_name || "Unknown"]));
}

function isInstructionReviewState(value: unknown): value is "up_to_date" | "needs_review" {
  return value === "up_to_date" || value === "needs_review";
}

function normalizeNeedsReviewMetadata(
  sourcePayload: unknown,
  detail: string | null,
): DashboardNeedsReviewMetadata | null {
  if (sourcePayload && typeof sourcePayload === "object" && !Array.isArray(sourcePayload)) {
    const payload = sourcePayload as DashboardReviewStateSourcePayload;
    if (
      payload.kind === "instruction_review_state" &&
      isInstructionReviewState(payload.nextStatus) &&
      payload.nextStatus === "needs_review"
    ) {
      return {
        reviewOrigin: payload.reviewOrigin === "system" ? "system" : "user",
        note:
          typeof payload.note === "string" && payload.note.trim().length > 0
            ? payload.note.trim()
            : null,
      };
    }
  }

  const normalizedDetail = detail?.trim().toLowerCase() ?? "";
  if (!normalizedDetail.includes("review state changed to needs review")) {
    return null;
  }

  return {
    reviewOrigin: normalizedDetail.includes("system counter") ? "system" : "user",
    note: null,
  };
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { supabase, profile } = await requireAuthenticatedUser();
  const supabaseAdmin = getSupabaseAdminClient();
  const params = await searchParams;
  const initialQuery = params.q?.trim() ?? "";

  const searchRequest = supabase
    .from("work_items")
    .select(
      "id, department_id, departments(name, color_hex), part_id, item_title, updated_at, work_instructions!inner(id, revision, fork_root_instruction_id, fork_number, created_at, updated_at, created_by, updated_by)",
    )
    .eq("work_instructions.is_archived", false)
    .order("updated_at", { ascending: false })
    .limit(300);

  const newestRequest = supabase
    .from("work_instructions")
    .select(
      "id, revision, fork_root_instruction_id, fork_number, last_change_summary, created_at, updated_at, created_by, updated_by, work_items(department_id, departments(name, color_hex), part_id, item_title)",
    )
    .eq("is_archived", false)
    .order("created_at", { ascending: false })
    .limit(24);

  const pinnedRequest = supabase
    .from("user_pinned_instructions")
    .select(
      "created_at, work_instructions!inner(id, revision, fork_root_instruction_id, fork_number, last_change_summary, created_at, updated_at, created_by, updated_by, is_archived, work_items(department_id, departments(name, color_hex), part_id, item_title))",
    )
    .eq("user_id", profile.id)
    .eq("work_instructions.is_archived", false)
    .order("created_at", { ascending: false })
    .limit(25);

  const authoredLikesRequest = supabase
    .from("instruction_likes")
    .select(
      "created_at, instruction_id, user_id, work_instructions!inner(id, revision, fork_root_instruction_id, fork_number, last_change_summary, created_at, updated_at, created_by, updated_by, is_archived, work_items(department_id, departments(name, color_hex), part_id, item_title))",
    )
    .eq("work_instructions.created_by", profile.id)
    .eq("work_instructions.is_archived", false)
    .neq("user_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(250);

  const historyInstructionsRequest = supabase
    .from("work_instructions")
    .select(
      "id, revision, fork_root_instruction_id, fork_number, last_change_summary, created_at, updated_at, created_by, updated_by, work_items(department_id, departments(name, color_hex), part_id, item_title)",
    )
    .eq("is_archived", false)
    .order("updated_at", { ascending: false })
    .limit(120);

  const historyEventsRequest = supabase
    .from("instruction_change_events")
    .select(
      "id, instruction_id, event_type, detail, revision, occurred_at, actor_user_id, work_instructions!inner(id, is_archived, work_items(department_id, departments(name, color_hex), part_id, item_title))",
    )
    .eq("work_instructions.is_archived", false)
    .order("occurred_at", { ascending: false })
    .limit(240);

  const departmentsRequest = supabase
    .from("departments")
    .select("id, name, color_hex")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  const processDocumentsRequest = supabase
    .from("process_documents")
    .select(
      "id, document_number, title, document_type, status, department_id, process_name, process_scope, process_inputs, process_outputs, process_risks, process_controls, iso_clause_refs, current_revision, updated_at, departments(name, color_hex)",
    )
    .order("updated_at", { ascending: false })
    .limit(200);

  const formulasRequest = supabaseAdmin
    .from("process_map_formulas")
    .select("id, owner_user_id, name, formula_type, payload, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(250);

  const reviewSettingsRequest = supabase
    .from("instruction_review_settings")
    .select("review_window_days")
    .eq("id", true)
    .maybeSingle<DashboardInstructionReviewSettingsRow>();

  const [
    { data: searchData, error: searchError },
    { data: newestData, error: newestError },
    { data: pinnedData, error: pinnedError },
    { data: authoredLikesData },
    { data: historyInstructionsData },
    { data: historyEventsData },
    { data: departmentsData },
    { data: processDocumentsData },
    { data: formulasData },
    { data: reviewSettingsData, error: reviewSettingsError },
  ] = await Promise.all([
    runDashboardQuery(
      searchRequest,
      "Dashboard search query timed out.",
    ),
    runDashboardQuery(
      newestRequest,
      "Newest instructions query timed out.",
    ),
    runDashboardQuery(
      pinnedRequest,
      "Pinned instructions query timed out.",
    ),
    runDashboardQuery(
      authoredLikesRequest,
      "Likes query timed out.",
    ),
    runDashboardQuery(
      historyInstructionsRequest,
      "Instruction history query timed out.",
    ),
    runDashboardQuery(
      historyEventsRequest,
      "History events query timed out.",
    ),
    runDashboardQuery(
      departmentsRequest,
      "Departments query timed out.",
    ),
    runDashboardQuery(
      processDocumentsRequest,
      "Process documents query timed out.",
    ),
    runDashboardQuery(
      formulasRequest,
      "Formula library query timed out.",
    ),
    runDashboardQuery(
      reviewSettingsRequest,
      "Review settings query timed out.",
    ),
  ]);

  const rawItems = (searchData ?? []) as DashboardWorkItemRow[];
  const rawNewest = (newestData ?? []) as DashboardInstructionRow[];
  const rawPinned = (pinnedData ?? []) as DashboardPinnedInstructionRow[];
  const rawAuthoredLikes = (authoredLikesData ?? []) as DashboardInstructionLikeRow[];
  const rawHistoryInstructions = (historyInstructionsData ?? []) as DashboardInstructionRow[];
  const rawHistoryEvents =
    (historyEventsData ?? []) as DashboardInstructionChangeEventRow[];
  const rawProcessDocuments = (processDocumentsData ?? []) as DashboardProcessDocumentRow[];
  const rawFormulas = ((formulasData ?? []) as DashboardFormulaRow[]).filter((row) =>
    requesterCanSeeFormula(row, profile.id, hasFullAccess(profile.role)),
  );
  const instructionReviewWindowDays =
    !reviewSettingsError
      ? normalizeReviewWindowDays(reviewSettingsData?.review_window_days) ??
        DEFAULT_REVIEW_WINDOW_DAYS
      : DEFAULT_REVIEW_WINDOW_DAYS;

  const instructionIdSet = new Set<string>();
  for (const item of rawItems) {
    for (const instruction of item.work_instructions ?? []) {
      instructionIdSet.add(instruction.id);
    }
  }
  for (const instruction of rawNewest) {
    instructionIdSet.add(instruction.id);
  }
  for (const row of rawPinned) {
    const instruction = normalizeInstruction(row.work_instructions);
    if (instruction) {
      instructionIdSet.add(instruction.id);
    }
  }
  for (const row of rawAuthoredLikes) {
    const instruction = normalizeInstruction(row.work_instructions);
    if (instruction) {
      instructionIdSet.add(instruction.id);
    }
  }
  for (const instruction of rawHistoryInstructions) {
    instructionIdSet.add(instruction.id);
  }

  const instructionReviewStatusByInstructionId: Record<
    string,
    DashboardInstructionReviewStatusData
  > = {};

  const instructionIdList = Array.from(instructionIdSet);
  for (
    let batchStartIndex = 0;
    batchStartIndex < instructionIdList.length;
    batchStartIndex += REVIEW_STATUS_BATCH_SIZE
  ) {
    const batchIds = instructionIdList.slice(
      batchStartIndex,
      batchStartIndex + REVIEW_STATUS_BATCH_SIZE,
    );

    const { data: reviewStatusRows, error: reviewStatusError } = await runDashboardQuery(
      supabase
        .from("instruction_review_status")
        .select("instruction_id, status, last_calibrated_at, flagged_at, updated_at")
        .in("instruction_id", batchIds),
      "Instruction review status query timed out.",
    );

    if (reviewStatusError) {
      break;
    }

    for (const row of (reviewStatusRows ?? []) as DashboardInstructionReviewStatusRow[]) {
      instructionReviewStatusByInstructionId[row.instruction_id] = {
        instruction_id: row.instruction_id,
        status: row.status,
        last_calibrated_at: row.last_calibrated_at,
        flagged_at: row.flagged_at,
        updated_at: row.updated_at,
        needs_review_note: null,
        needs_review_origin: null,
      };
    }
  }

  const needsReviewInstructionIds = Object.values(instructionReviewStatusByInstructionId)
    .filter((status) => status.status === "needs_review")
    .map((status) => status.instruction_id);
  const latestNeedsReviewMetadataByInstructionId = new Map<
    string,
    DashboardNeedsReviewMetadata
  >();

  for (
    let batchStartIndex = 0;
    batchStartIndex < needsReviewInstructionIds.length;
    batchStartIndex += REVIEW_STATUS_BATCH_SIZE
  ) {
    const batchIds = needsReviewInstructionIds.slice(
      batchStartIndex,
      batchStartIndex + REVIEW_STATUS_BATCH_SIZE,
    );

    const { data: reviewEvents, error: reviewEventsError } = await runDashboardQuery(
      supabase
        .from("instruction_change_events")
        .select("instruction_id, occurred_at, detail, source_payload")
        .eq("event_type", "updated")
        .in("instruction_id", batchIds)
        .ilike("detail", "Review state changed to Needs Review%")
        .order("occurred_at", { ascending: false })
        .range(0, 4999),
      "Needs-review metadata query timed out.",
    );

    if (reviewEventsError) {
      break;
    }

    for (const event of (reviewEvents ?? []) as DashboardNeedsReviewEventRow[]) {
      if (latestNeedsReviewMetadataByInstructionId.has(event.instruction_id)) {
        continue;
      }

      const metadata = normalizeNeedsReviewMetadata(event.source_payload, event.detail);
      if (metadata) {
        latestNeedsReviewMetadataByInstructionId.set(event.instruction_id, metadata);
      }
    }
  }

  for (const instructionId of needsReviewInstructionIds) {
    const reviewStatus = instructionReviewStatusByInstructionId[instructionId];
    if (!reviewStatus) {
      continue;
    }

    const metadata = latestNeedsReviewMetadataByInstructionId.get(instructionId);
    reviewStatus.needs_review_note = metadata?.note ?? null;
    reviewStatus.needs_review_origin = metadata?.reviewOrigin ?? null;
  }

  const profileIds = new Set<string>();
  for (const item of rawItems) {
    for (const instruction of item.work_instructions ?? []) {
      profileIds.add(instruction.created_by);
      profileIds.add(instruction.updated_by);
    }
  }
  for (const instruction of rawNewest) {
    profileIds.add(instruction.created_by);
    profileIds.add(instruction.updated_by);
  }
  for (const pinnedRow of rawPinned) {
    const instruction = normalizeInstruction(pinnedRow.work_instructions);
    if (instruction) {
      profileIds.add(instruction.created_by);
      profileIds.add(instruction.updated_by);
    }
  }
  for (const likeRow of rawAuthoredLikes) {
    const instruction = normalizeInstruction(likeRow.work_instructions);
    if (instruction) {
      profileIds.add(instruction.created_by);
      profileIds.add(instruction.updated_by);
    }
  }
  for (const instruction of rawHistoryInstructions) {
    profileIds.add(instruction.created_by);
    profileIds.add(instruction.updated_by);
  }
  for (const historyEvent of rawHistoryEvents) {
    profileIds.add(historyEvent.actor_user_id);
  }
  for (const formula of rawFormulas) {
    profileIds.add(formula.owner_user_id);
  }

  const profileIdList = Array.from(profileIds);
  const { data: profiles } =
    profileIdList.length > 0
      ? await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", profileIdList)
      : { data: null };

  const profileNameMap = buildCreatorNameMap(
    (profiles ?? []) as Array<{ id: string; full_name: string }>,
  );

  const items: DashboardWorkItemData[] = rawItems.map((item) => ({
    id: item.id,
    department_id: item.department_id,
    department_name: normalizeDepartmentName(item.departments),
    department_color: normalizeDepartmentColor(item.departments),
    part_id: item.part_id,
    item_title: item.item_title,
    updated_at: item.updated_at,
    work_instructions: (item.work_instructions ?? []).map((instruction) => ({
      id: instruction.id,
      revision: instruction.revision,
      fork_root_instruction_id: instruction.fork_root_instruction_id,
      fork_number: instruction.fork_number,
      created_at: instruction.created_at,
      updated_at: instruction.updated_at,
      creator_id: instruction.created_by,
      creator_name: profileNameMap.get(instruction.created_by) ?? "Unknown",
      updater_id: instruction.updated_by,
      updater_name: profileNameMap.get(instruction.updated_by) ?? "Unknown",
    })),
  }));

  const newestInstructions: DashboardInstructionCardData[] = rawNewest
    .map((instruction) => {
      const workItem = normalizeWorkItem(instruction.work_items);
      if (!workItem) {
        return null;
      }

      return {
        id: instruction.id,
        revision: instruction.revision,
        fork_root_instruction_id: instruction.fork_root_instruction_id,
        fork_number: instruction.fork_number,
        created_at: instruction.created_at,
        updated_at: instruction.updated_at,
        creator_name: profileNameMap.get(instruction.created_by) ?? "Unknown",
        workItem: {
          department_id: workItem.department_id,
          department_name: normalizeDepartmentName(workItem.departments),
          department_color: normalizeDepartmentColor(workItem.departments),
          part_id: workItem.part_id,
          item_title: workItem.item_title,
        },
      };
    })
    .filter((instruction): instruction is DashboardInstructionCardData => instruction !== null);

  const pinnedInstructions: DashboardPinnedInstructionCardData[] = rawPinned
    .map((row) => {
      const instruction = normalizeInstruction(row.work_instructions);
      if (!instruction) {
        return null;
      }

      const workItem = normalizeWorkItem(instruction.work_items);
      if (!workItem) {
        return null;
      }

      return {
        id: instruction.id,
        revision: instruction.revision,
        fork_root_instruction_id: instruction.fork_root_instruction_id,
        fork_number: instruction.fork_number,
        created_at: instruction.created_at,
        updated_at: instruction.updated_at,
        creator_name: profileNameMap.get(instruction.created_by) ?? "Unknown",
        workItem: {
          department_id: workItem.department_id,
          department_name: normalizeDepartmentName(workItem.departments),
          department_color: normalizeDepartmentColor(workItem.departments),
          part_id: workItem.part_id,
          item_title: workItem.item_title,
        },
        pinned_at: row.created_at,
      };
    })
    .filter(
      (instruction): instruction is DashboardPinnedInstructionCardData =>
        instruction !== null,
    );

  const likedInstructionsById = new Map<string, DashboardLikedInstructionCardData>();
  for (const row of rawAuthoredLikes) {
    const instruction = normalizeInstruction(row.work_instructions);
    if (!instruction) {
      continue;
    }

    const workItem = normalizeWorkItem(instruction.work_items);
    if (!workItem) {
      continue;
    }

    const existing = likedInstructionsById.get(instruction.id);
    if (existing) {
      existing.likes_count += 1;

      const existingTimestamp = toTimestamp(existing.latest_liked_at) ?? 0;
      const rowTimestamp = toTimestamp(row.created_at) ?? 0;
      if (rowTimestamp > existingTimestamp) {
        existing.latest_liked_at = row.created_at;
      }
      continue;
    }

    likedInstructionsById.set(instruction.id, {
      id: instruction.id,
      revision: instruction.revision,
      fork_root_instruction_id: instruction.fork_root_instruction_id,
      fork_number: instruction.fork_number,
      created_at: instruction.created_at,
      updated_at: instruction.updated_at,
      creator_name: profileNameMap.get(instruction.created_by) ?? "Unknown",
      workItem: {
        department_id: workItem.department_id,
        department_name: normalizeDepartmentName(workItem.departments),
        department_color: normalizeDepartmentColor(workItem.departments),
        part_id: workItem.part_id,
        item_title: workItem.item_title,
      },
      likes_count: 1,
      latest_liked_at: row.created_at,
    });
  }

  const likedInstructions = [...likedInstructionsById.values()].sort((a, b) => {
    const aTimestamp = toTimestamp(a.latest_liked_at) ?? 0;
    const bTimestamp = toTimestamp(b.latest_liked_at) ?? 0;
    return bTimestamp - aTimestamp;
  });

  const systemHistoryEventsFromEventLog: DashboardSystemHistoryEventData[] = rawHistoryEvents
    .map((event) => {
      const historyInstruction = normalizeHistoryEventInstruction(event.work_instructions);
      const workItem = normalizeWorkItem(historyInstruction?.work_items);
      if (!workItem) {
        return null;
      }

      const eventType = event.event_type === "created" ? "created" : "updated";

      return {
        id: event.id,
        occurred_at: event.occurred_at,
        action_label: getHistoryEventActionLabel({
          eventType,
          detail: event.detail,
        }),
        actor_name: profileNameMap.get(event.actor_user_id) ?? "Unknown",
        detail: formatHistoryEventDetail({
          detail: event.detail,
          eventType,
          revision: event.revision,
        }),
        instruction_id: event.instruction_id,
        event_type: eventType,
        revision: event.revision,
        workItem: {
          department_id: workItem.department_id,
          department_name: normalizeDepartmentName(workItem.departments),
          department_color: normalizeDepartmentColor(workItem.departments),
          part_id: workItem.part_id,
          item_title: workItem.item_title,
        },
      };
    })
    .filter((event): event is DashboardSystemHistoryEventData => event !== null);

  const systemHistoryEvents: DashboardSystemHistoryEventData[] =
    systemHistoryEventsFromEventLog.length > 0
      ? systemHistoryEventsFromEventLog
      : (() => {
          const fallbackEvents: DashboardSystemHistoryEventData[] = [];

          for (const instruction of rawHistoryInstructions) {
            const workItem = normalizeWorkItem(instruction.work_items);
            if (!workItem) {
              continue;
            }

            const resolvedWorkItem = {
              department_id: workItem.department_id,
              department_name: normalizeDepartmentName(workItem.departments),
              department_color: normalizeDepartmentColor(workItem.departments),
              part_id: workItem.part_id,
              item_title: workItem.item_title,
            };

            fallbackEvents.push({
              id: `created:${instruction.id}:${instruction.created_at}`,
              occurred_at: instruction.created_at,
              action_label: "Instruction Created",
              actor_name: profileNameMap.get(instruction.created_by) ?? "Unknown",
              detail: `Revision ${instruction.revision} created.`,
              instruction_id: instruction.id,
              event_type: "created",
              revision: instruction.revision,
              workItem: resolvedWorkItem,
            });

            const createdTimestamp = toTimestamp(instruction.created_at) ?? 0;
            const updatedTimestamp = toTimestamp(instruction.updated_at) ?? 0;
            const shouldIncludeUpdateEvent =
              updatedTimestamp > createdTimestamp + 1000 ||
              instruction.updated_by !== instruction.created_by ||
              instruction.revision > 1;

            if (!shouldIncludeUpdateEvent) {
              continue;
            }

            fallbackEvents.push({
              id: `updated:${instruction.id}:${instruction.updated_at}`,
              occurred_at: instruction.updated_at,
              action_label: "Instruction Updated",
              actor_name: profileNameMap.get(instruction.updated_by) ?? "Unknown",
              detail: formatHistoryInstructionUpdateDetail(instruction),
              instruction_id: instruction.id,
              event_type: "updated",
              revision: instruction.revision,
              workItem: resolvedWorkItem,
            });
          }

          return fallbackEvents;
        })();

  systemHistoryEvents.sort((a, b) => {
    const aTimestamp = toTimestamp(a.occurred_at) ?? 0;
    const bTimestamp = toTimestamp(b.occurred_at) ?? 0;
    return bTimestamp - aTimestamp;
  });

  const processDocuments: DashboardProcessDocumentData[] = rawProcessDocuments.map(
    (document) => ({
      id: document.id,
      document_number: document.document_number,
      title: document.title,
      type_label: getProcessDocumentTypeLabel(document.document_type),
      status: document.status,
      department_id: document.department_id,
      department_name: normalizeDepartmentName(document.departments),
      process_name: document.process_name ?? "",
      process_scope: document.process_scope ?? "",
      process_inputs: document.process_inputs ?? "",
      process_outputs: document.process_outputs ?? "",
      process_risks: document.process_risks ?? "",
      process_controls: document.process_controls ?? "",
      iso_clause_refs: document.iso_clause_refs ?? [],
      current_revision: document.current_revision,
      updated_at: document.updated_at,
    }),
  );

  const formulas: DashboardFormulaData[] = rawFormulas.map((formula) => ({
    id: formula.id,
    ownerUserId: formula.owner_user_id,
    ownerName: profileNameMap.get(formula.owner_user_id) ?? "Unknown",
    name: formula.name,
    formulaType: formula.formula_type,
    approvalStatus: getFormulaApprovalStatus(formula),
    description: getFormulaDescription(formula.payload),
    inputCount: getFormulaCollectionCount(formula.payload, "inputs"),
    outputCount: getFormulaCollectionCount(formula.payload, "outputs"),
    createdAt: formula.created_at,
    updatedAt: formula.updated_at,
  }));

  const seenLikesAtTimestamp = toTimestamp(profile.authored_likes_seen_at ?? null);
  const newLikeRows =
    seenLikesAtTimestamp === null
      ? rawAuthoredLikes
      : rawAuthoredLikes.filter((row) => {
          const rowTimestamp = toTimestamp(row.created_at);
          return rowTimestamp !== null && rowTimestamp > seenLikesAtTimestamp;
        });

  const likeHighlightByInstruction = new Map<
    string,
    {
      instructionId: string;
      label: string;
      revision: number;
      newLikesCount: number;
      latestLikedAt: string;
    }
  >();

  for (const row of newLikeRows) {
    const instruction = normalizeInstruction(row.work_instructions);
    if (!instruction) {
      continue;
    }

    const workItem = normalizeWorkItem(instruction.work_items);
    if (!workItem) {
      continue;
    }

    const existing = likeHighlightByInstruction.get(instruction.id);
    if (existing) {
      existing.newLikesCount += 1;
      const existingTimestamp = toTimestamp(existing.latestLikedAt) ?? 0;
      const rowTimestamp = toTimestamp(row.created_at) ?? 0;
      if (rowTimestamp > existingTimestamp) {
        existing.latestLikedAt = row.created_at;
      }
      continue;
    }

    likeHighlightByInstruction.set(instruction.id, {
      instructionId: instruction.id,
      label: `${getPartIdLabel(workItem.part_id)} | ${normalizeDepartmentName(workItem.departments)}`,
      revision: instruction.revision,
      newLikesCount: 1,
      latestLikedAt: row.created_at,
    });
  }

  const likeCelebration: DashboardLikeCelebrationData | null =
    newLikeRows.length === 0
      ? null
      : {
          newLikesCount: newLikeRows.length,
          latestNewLikeAt: newLikeRows[0]?.created_at ?? new Date().toISOString(),
          highlights: [...likeHighlightByInstruction.values()]
            .sort((a, b) => {
              if (b.newLikesCount !== a.newLikesCount) {
                return b.newLikesCount - a.newLikesCount;
              }

              const aTimestamp = toTimestamp(a.latestLikedAt) ?? 0;
              const bTimestamp = toTimestamp(b.latestLikedAt) ?? 0;
              return bTimestamp - aTimestamp;
            })
            .map((highlight) => ({
              instructionId: highlight.instructionId,
              label: highlight.label,
              revision: highlight.revision,
              newLikesCount: highlight.newLikesCount,
            })),
        };

  return (
    <DashboardClient
      canEdit={canEditInstructions(profile.role)}
      isSystemAdmin={hasFullAccess(profile.role)}
      initialQuery={initialQuery}
      searchError={searchError?.message ?? null}
      newestError={newestError?.message ?? null}
      pinnedError={pinnedError?.message ?? null}
      pinnedInstructions={pinnedInstructions}
      likedInstructions={likedInstructions}
      likeCelebration={likeCelebration}
      newestInstructions={newestInstructions}
      items={items}
      processDocuments={processDocuments}
      formulas={formulas}
      systemHistoryEvents={systemHistoryEvents.slice(0, 240)}
      currentUserId={profile.id}
      initialDashboardLayout={profile.dashboard_layout ?? null}
      initialDashboardDefaultLayout={profile.dashboard_default_layout ?? null}
      instructionReviewWindowDays={instructionReviewWindowDays}
      instructionReviewStatusByInstructionId={instructionReviewStatusByInstructionId}
      departmentOptions={
        (departmentsData ?? []) as Array<{
          id: string;
          name: string;
          color_hex: string | null;
        }>
      }
    />
  );
}
