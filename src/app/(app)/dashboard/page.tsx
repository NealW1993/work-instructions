import { DashboardClient } from "@/components/dashboard/dashboard-client";
import type {
  DashboardInstructionCardData,
  DashboardPinnedInstructionCardData,
  DashboardWorkItemData,
} from "@/components/dashboard/dashboard-client";
import { requireAuthenticatedUser } from "@/lib/auth";
import { canEditInstructions } from "@/lib/roles";

interface DashboardPageProps {
  searchParams: Promise<{
    q?: string;
  }>;
}

interface DashboardInstructionWorkItem {
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
  part_number: string;
  mold_number: string;
  item_title: string;
  updated_at: string;
  work_instructions: DashboardWorkItemInstructionRow[];
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
      "id, part_number, mold_number, item_title, updated_at, work_instructions(id, revision, created_at, updated_at, created_by)",
    )
    .order("updated_at", { ascending: false })
    .limit(300);

  const newestRequest = supabase
    .from("work_instructions")
    .select(
      "id, revision, created_at, updated_at, created_by, work_items(part_number, mold_number, item_title)",
    )
    .order("created_at", { ascending: false })
    .limit(5);

  const pinnedRequest = supabase
    .from("user_pinned_instructions")
    .select(
      "created_at, work_instructions(id, revision, created_at, updated_at, created_by, work_items(part_number, mold_number, item_title))",
    )
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(25);

  const [
    { data: searchData, error: searchError },
    { data: newestData, error: newestError },
    { data: pinnedData, error: pinnedError },
  ] = await Promise.all([searchRequest, newestRequest, pinnedRequest]);

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
    ...item,
    work_instructions: (item.work_instructions ?? []).map((instruction) => ({
      ...instruction,
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
        workItem,
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
        workItem,
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
      initialQuery={initialQuery}
      searchError={searchError?.message ?? null}
      newestError={newestError?.message ?? null}
      pinnedError={pinnedError?.message ?? null}
      pinnedInstructions={pinnedInstructions}
      newestInstructions={newestInstructions}
      items={items}
    />
  );
}
