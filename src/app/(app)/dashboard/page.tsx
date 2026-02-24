import { DashboardClient } from "@/components/dashboard/dashboard-client";
import type {
  DashboardInstructionCardData,
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
  work_items: DashboardInstructionWorkItem | DashboardInstructionWorkItem[];
}

interface DashboardWorkItemInstructionRow {
  id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  created_by: string;
}

interface DashboardPinnedInstructionRow {
  created_at: string;
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
      "id, department_id, departments(name, color_hex), part_number, mold_number, item_title, updated_at, work_instructions!inner(id, revision, created_at, updated_at, created_by)",
    )
    .eq("work_instructions.is_archived", false)
    .order("updated_at", { ascending: false })
    .limit(300);

  const newestRequest = supabase
    .from("work_instructions")
    .select(
      "id, revision, created_at, updated_at, created_by, work_items(department_id, departments(name, color_hex), part_number, mold_number, item_title)",
    )
    .eq("is_archived", false)
    .order("created_at", { ascending: false })
    .limit(6);

  const pinnedRequest = supabase
    .from("user_pinned_instructions")
    .select(
      "created_at, work_instructions!inner(id, revision, created_at, updated_at, created_by, is_archived, work_items(department_id, departments(name, color_hex), part_number, mold_number, item_title))",
    )
    .eq("user_id", profile.id)
    .eq("work_instructions.is_archived", false)
    .order("created_at", { ascending: false })
    .limit(25);

  const departmentsRequest = supabase
    .from("departments")
    .select("id, name, color_hex")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  const [
    { data: searchData, error: searchError },
    { data: newestData, error: newestError },
    { data: pinnedData, error: pinnedError },
    { data: departmentsData },
  ] = await Promise.all([
    searchRequest,
    newestRequest,
    pinnedRequest,
    departmentsRequest,
  ]);

  const rawItems = (searchData ?? []) as DashboardWorkItemRow[];
  const rawNewest = (newestData ?? []) as DashboardInstructionRow[];
  const rawPinned = (pinnedData ?? []) as DashboardPinnedInstructionRow[];

  const creatorIds = new Set<string>();
  for (const item of rawItems) {
    for (const instruction of item.work_instructions ?? []) {
      creatorIds.add(instruction.created_by);
    }
  }
  for (const instruction of rawNewest) {
    creatorIds.add(instruction.created_by);
  }
  for (const pinnedRow of rawPinned) {
    const instruction = normalizeInstruction(pinnedRow.work_instructions);
    if (instruction) {
      creatorIds.add(instruction.created_by);
    }
  }

  const creatorIdList = Array.from(creatorIds);
  const { data: creators } =
    creatorIdList.length > 0
      ? await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", creatorIdList)
      : { data: null };

  const creatorNameMap = buildCreatorNameMap(
    (creators ?? []) as Array<{ id: string; full_name: string }>,
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
      creator_name: creatorNameMap.get(instruction.created_by) ?? "Unknown",
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
        creator_name: creatorNameMap.get(instruction.created_by) ?? "Unknown",
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
        creator_name: creatorNameMap.get(instruction.created_by) ?? "Unknown",
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

  return (
    <DashboardClient
      canEdit={canEditInstructions(profile.role)}
      isSystemAdmin={isSystemAdmin(profile.role)}
      initialQuery={initialQuery}
      searchError={searchError?.message ?? null}
      newestError={newestError?.message ?? null}
      pinnedError={pinnedError?.message ?? null}
      pinnedInstructions={pinnedInstructions}
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
