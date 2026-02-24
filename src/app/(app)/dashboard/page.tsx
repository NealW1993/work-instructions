import { DashboardClient } from "@/components/dashboard/dashboard-client";
import type {
  DashboardInstructionCardData,
  DashboardLikeCelebrationData,
  DashboardLikedInstructionCardData,
  DashboardPinnedInstructionCardData,
  DashboardWorkItemData,
} from "@/components/dashboard/dashboard-client";
import { requireAuthenticatedUser } from "@/lib/auth";
import { canEditInstructions, isSystemAdmin } from "@/lib/roles";

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
  part_number: string;
  mold_number: string;
  item_title: string;
}

interface DashboardInstructionRow {
  id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  work_items: DashboardInstructionWorkItem | DashboardInstructionWorkItem[];
}

interface DashboardWorkItemInstructionRow {
  id: string;
  revision: number;
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
  part_number: string;
  mold_number: string;
  item_title: string;
  updated_at: string;
  work_instructions: DashboardWorkItemInstructionRow[];
}

const DEFAULT_DEPARTMENT_COLOR = "#0EA5E9";

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

function getPrimaryPartOrMoldLabel(partNumber: string, moldNumber: string) {
  const normalizedMold = moldNumber?.trim();
  if (normalizedMold) {
    return `Mold # ${normalizedMold}`;
  }

  const normalizedPart = partNumber?.trim();
  if (normalizedPart) {
    return `Part # ${normalizedPart}`;
  }

  return "Part # N/A";
}

function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function buildCreatorNameMap(
  users: Array<{ id: string; full_name: string }> | null,
) {
  return new Map((users ?? []).map((entry) => [entry.id, entry.full_name || "Unknown"]));
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { supabase, profile } = await requireAuthenticatedUser();
  const params = await searchParams;
  const initialQuery = params.q?.trim() ?? "";

  const searchRequest = supabase
    .from("work_items")
    .select(
      "id, department_id, departments(name, color_hex), part_number, mold_number, item_title, updated_at, work_instructions!inner(id, revision, created_at, updated_at, created_by, updated_by)",
    )
    .eq("work_instructions.is_archived", false)
    .order("updated_at", { ascending: false })
    .limit(300);

  const newestRequest = supabase
    .from("work_instructions")
    .select(
      "id, revision, created_at, updated_at, created_by, updated_by, work_items(department_id, departments(name, color_hex), part_number, mold_number, item_title)",
    )
    .eq("is_archived", false)
    .order("created_at", { ascending: false })
    .limit(6);

  const pinnedRequest = supabase
    .from("user_pinned_instructions")
    .select(
      "created_at, work_instructions!inner(id, revision, created_at, updated_at, created_by, updated_by, is_archived, work_items(department_id, departments(name, color_hex), part_number, mold_number, item_title))",
    )
    .eq("user_id", profile.id)
    .eq("work_instructions.is_archived", false)
    .order("created_at", { ascending: false })
    .limit(25);

  const authoredLikesRequest = supabase
    .from("instruction_likes")
    .select(
      "created_at, instruction_id, user_id, work_instructions!inner(id, revision, created_at, updated_at, created_by, updated_by, is_archived, work_items(department_id, departments(name, color_hex), part_number, mold_number, item_title))",
    )
    .eq("work_instructions.created_by", profile.id)
    .eq("work_instructions.is_archived", false)
    .neq("user_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(250);

  const departmentsRequest = supabase
    .from("departments")
    .select("id, name, color_hex")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  const [
    { data: searchData, error: searchError },
    { data: newestData, error: newestError },
    { data: pinnedData, error: pinnedError },
    { data: authoredLikesData },
    { data: departmentsData },
  ] = await Promise.all([
    searchRequest,
    newestRequest,
    pinnedRequest,
    authoredLikesRequest,
    departmentsRequest,
  ]);

  const rawItems = (searchData ?? []) as DashboardWorkItemRow[];
  const rawNewest = (newestData ?? []) as DashboardInstructionRow[];
  const rawPinned = (pinnedData ?? []) as DashboardPinnedInstructionRow[];
  const rawAuthoredLikes = (authoredLikesData ?? []) as DashboardInstructionLikeRow[];

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
    part_number: item.part_number,
    mold_number: item.mold_number,
    item_title: item.item_title,
    updated_at: item.updated_at,
    work_instructions: (item.work_instructions ?? []).map((instruction) => ({
      id: instruction.id,
      revision: instruction.revision,
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
        created_at: instruction.created_at,
        updated_at: instruction.updated_at,
        creator_name: profileNameMap.get(instruction.created_by) ?? "Unknown",
        workItem: {
          department_id: workItem.department_id,
          department_name: normalizeDepartmentName(workItem.departments),
          department_color: normalizeDepartmentColor(workItem.departments),
          part_number: workItem.part_number,
          mold_number: workItem.mold_number,
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
        created_at: instruction.created_at,
        updated_at: instruction.updated_at,
        creator_name: profileNameMap.get(instruction.created_by) ?? "Unknown",
        workItem: {
          department_id: workItem.department_id,
          department_name: normalizeDepartmentName(workItem.departments),
          department_color: normalizeDepartmentColor(workItem.departments),
          part_number: workItem.part_number,
          mold_number: workItem.mold_number,
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
      created_at: instruction.created_at,
      updated_at: instruction.updated_at,
      creator_name: profileNameMap.get(instruction.created_by) ?? "Unknown",
      workItem: {
        department_id: workItem.department_id,
        department_name: normalizeDepartmentName(workItem.departments),
        department_color: normalizeDepartmentColor(workItem.departments),
        part_number: workItem.part_number,
        mold_number: workItem.mold_number,
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
      label: `${getPrimaryPartOrMoldLabel(workItem.part_number, workItem.mold_number)} | ${normalizeDepartmentName(workItem.departments)}`,
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
              newLikesCount: highlight.newLikesCount,
            })),
        };

  const latestAuthoredLikeAt = rawAuthoredLikes[0]?.created_at ?? null;
  const latestAuthoredLikeTimestamp = toTimestamp(latestAuthoredLikeAt);
  const seenAuthoredLikeTimestamp = toTimestamp(profile.authored_likes_seen_at ?? null);
  if (
    latestAuthoredLikeAt &&
    latestAuthoredLikeTimestamp !== null &&
    (seenAuthoredLikeTimestamp === null ||
      latestAuthoredLikeTimestamp > seenAuthoredLikeTimestamp)
  ) {
    await supabase
      .from("profiles")
      .update({ authored_likes_seen_at: latestAuthoredLikeAt })
      .eq("id", profile.id);
  }

  return (
    <DashboardClient
      canEdit={canEditInstructions(profile.role)}
      isSystemAdmin={isSystemAdmin(profile.role)}
      initialQuery={initialQuery}
      searchError={searchError?.message ?? null}
      newestError={newestError?.message ?? null}
      pinnedError={pinnedError?.message ?? null}
      pinnedInstructions={pinnedInstructions}
      likedInstructions={likedInstructions}
      likeCelebration={likeCelebration}
      newestInstructions={newestInstructions}
      items={items}
      currentUserId={profile.id}
      initialDashboardLayout={profile.dashboard_layout ?? null}
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
