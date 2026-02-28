import { redirect } from "next/navigation";

import {
  ArchivedInstructionsPanel,
  type ArchivedInstructionListItem,
} from "@/components/instructions/archived-instructions-panel";
import { requireAuthenticatedUser } from "@/lib/auth";
import { isSystemAdmin } from "@/lib/roles";

interface DepartmentRelation {
  name: string;
}

interface ArchivedInstructionWorkItemRow {
  part_id: string;
  item_title: string;
  departments: DepartmentRelation | DepartmentRelation[] | null;
}

interface ArchivedInstructionRow {
  id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  fork_root_instruction_id: string | null;
  fork_number: number | null;
  work_items: ArchivedInstructionWorkItemRow | ArchivedInstructionWorkItemRow[] | null;
}

function normalizeWorkItem(
  relation:
    | ArchivedInstructionWorkItemRow
    | ArchivedInstructionWorkItemRow[]
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
  relation: DepartmentRelation | DepartmentRelation[] | null | undefined,
) {
  if (!relation) {
    return "Unknown";
  }

  if (Array.isArray(relation)) {
    return relation[0]?.name ?? "Unknown";
  }

  return relation.name;
}

function buildUserNameMap(users: Array<{ id: string; full_name: string }> | null) {
  return new Map((users ?? []).map((entry) => [entry.id, entry.full_name || "Unknown"]));
}

export default async function ArchivedInstructionsPage() {
  const { supabase, profile } = await requireAuthenticatedUser();

  if (!isSystemAdmin(profile.role)) {
    redirect("/dashboard");
  }

  const { data, error } = await supabase
    .from("work_instructions")
    .select(
      "id, revision, created_at, updated_at, created_by, updated_by, fork_root_instruction_id, fork_number, work_items(part_id, item_title, departments(name))",
    )
    .eq("is_archived", true)
    .order("updated_at", { ascending: false })
    .limit(300);

  if (error) {
    throw new Error(error.message);
  }

  const rawRows = (data ?? []) as ArchivedInstructionRow[];
  const userIds = new Set<string>();

  for (const row of rawRows) {
    userIds.add(row.created_by);
    userIds.add(row.updated_by);
  }

  const userIdList = Array.from(userIds);
  const { data: users } =
    userIdList.length > 0
      ? await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIdList)
      : { data: null };

  const userNameMap = buildUserNameMap(
    (users ?? []) as Array<{ id: string; full_name: string }>,
  );

  const instructions: ArchivedInstructionListItem[] = rawRows
    .map((row) => {
      const workItem = normalizeWorkItem(row.work_items);
      if (!workItem) {
        return null;
      }

      return {
        id: row.id,
        revision: row.revision,
        created_at: row.created_at,
        updated_at: row.updated_at,
        creator_name: userNameMap.get(row.created_by) ?? "Unknown",
        updated_by_name: userNameMap.get(row.updated_by) ?? "Unknown",
        fork_number:
          row.fork_root_instruction_id &&
          Number.isInteger(row.fork_number) &&
          Number(row.fork_number) > 0
            ? Number(row.fork_number)
            : null,
        workItem: {
          department_name: normalizeDepartmentName(workItem.departments),
          part_id: workItem.part_id,
          item_title: workItem.item_title,
        },
      };
    })
    .filter((row): row is ArchivedInstructionListItem => row !== null);

  return <ArchivedInstructionsPanel initialInstructions={instructions} />;
}
