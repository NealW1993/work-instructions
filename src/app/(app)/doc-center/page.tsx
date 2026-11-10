import { DocCenterClient } from "@/components/doc-center/doc-center-client";
import type { DocCenterGroup, DocCenterItem } from "@/components/doc-center/doc-center-client";
import { requireAuthenticatedUser } from "@/lib/auth";
import {
  type ProcessDocumentStatus,
  type ProcessDocumentType,
  getProcessDocumentStatusLabel,
  getProcessDocumentTypeLabel,
} from "@/lib/process-documents";
import type { InstructionApprovalStatus } from "@/lib/types";
import { readAllRows } from "@/lib/supabase/read-all-rows";

interface AccessGroupRow {
  id: string;
  name: string;
}

interface ProcessDocumentRow {
  id: string;
  document_number: string;
  title: string;
  document_type: ProcessDocumentType;
  status: ProcessDocumentStatus;
  process_name: string | null;
  current_revision: number;
  updated_at: string;
}

interface ProcessDocumentGroupRow {
  document_id: string;
  group_id: string;
}

interface WorkInstructionRow {
  id: string;
  revision: number;
  approval_status: InstructionApprovalStatus | null;
  updated_at: string;
  work_items:
    | {
        part_id: string;
        item_title: string;
        departments: { name: string } | { name: string }[] | null;
      }
    | Array<{
        part_id: string;
        item_title: string;
        departments: { name: string } | { name: string }[] | null;
      }>
    | null;
}

interface WorkInstructionGroupRow {
  instruction_id: string;
  group_id: string;
}

function normalizeRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function getInstructionApprovalLabel(status: InstructionApprovalStatus | null | undefined) {
  switch (status) {
    case "draft":
      return "Draft";
    case "pending_review":
      return "Pending Review";
    case "rejected":
      return "Rejected";
    case "approved":
      return "Approved";
    default:
      return "Unverified";
  }
}

function buildGroupMap<T extends { group_id: string }>(
  rows: T[],
  idKey: keyof T,
) {
  const map = new Map<string, string[]>();

  for (const row of rows) {
    const targetId = String(row[idKey] ?? "");
    if (!targetId) {
      continue;
    }

    const groupIds = map.get(targetId) ?? [];
    groupIds.push(row.group_id);
    map.set(targetId, groupIds);
  }

  return map;
}

export default async function DocCenterPage() {
  const { supabase } = await requireAuthenticatedUser();
  const [
    { data: groupRows, error: groupError },
    { data: documentRows, error: documentError },
    { data: documentGroupRows, error: documentGroupError },
    { data: instructionRows, error: instructionError },
    { data: instructionGroupRows, error: instructionGroupError },
  ] = await Promise.all([
    readAllRows((from, to) => supabase
      .from("access_groups")
      .select("id, name")
      .eq("is_active", true)
      .order("name", { ascending: true }).order("id")
      .range(from, to)),
    readAllRows<ProcessDocumentRow>(async (from, to) => {
      const result = await supabase.rpc("list_process_documents_controlled")
        .select("id, document_number, title, document_type, status, process_name, current_revision, updated_at")
        .order("updated_at", { ascending: false }).order("id").range(from, to);
      return {
        data: Array.isArray(result.data) ? result.data as ProcessDocumentRow[] : null,
        error: result.error ?? (result.data !== null && !Array.isArray(result.data) ? { message: "The document library returned an invalid response." } : null),
      };
    }),
    readAllRows((from, to) => supabase
      .from("process_document_group_access")
      .select("document_id, group_id")
      .order("document_id").order("group_id")
      .range(from, to)),
    readAllRows((from, to) => supabase
      .from("work_instructions")
      .select("id, revision, approval_status, updated_at, work_items(part_id, item_title, departments(name))")
      .eq("is_archived", false)
      .order("updated_at", { ascending: false })
      .order("id")
      .range(from, to)),
    readAllRows((from, to) => supabase
      .from("work_instruction_group_access")
      .select("instruction_id, group_id")
      .order("instruction_id").order("group_id")
      .range(from, to)),
  ]);

  const groups = ((groupRows ?? []) as AccessGroupRow[]).map(
    (group): DocCenterGroup => ({
      id: group.id,
      name: group.name,
    }),
  );
  const groupNameById = new Map(groups.map((group) => [group.id, group.name]));
  const documentGroupIdsById = buildGroupMap(
    (documentGroupRows ?? []) as ProcessDocumentGroupRow[],
    "document_id",
  );
  const instructionGroupIdsById = buildGroupMap(
    (instructionGroupRows ?? []) as WorkInstructionGroupRow[],
    "instruction_id",
  );

  const documentItems = ((documentRows ?? []) as ProcessDocumentRow[]).map(
    (document): DocCenterItem => {
      const groupIds = documentGroupIdsById.get(document.id) ?? [];
      const kind = document.document_type === "process_map" ? "map" : "document";

      return {
        id: document.id,
        title: `${document.document_number} | ${document.title}`,
        subtitle: `${getProcessDocumentTypeLabel(document.document_type)} | Rev ${document.current_revision}${
          document.process_name ? ` | ${document.process_name}` : ""
        }`,
        href: `/process-documents?doc=${document.id}`,
        kind,
        status: getProcessDocumentStatusLabel(document.status),
        updated_at: document.updated_at,
        group_ids: groupIds,
        group_names: groupIds
          .map((groupId) => groupNameById.get(groupId))
          .filter((groupName): groupName is string => Boolean(groupName)),
      };
    },
  );

  const instructionItems = ((instructionRows ?? []) as WorkInstructionRow[])
    .map((instruction): DocCenterItem | null => {
      const workItem = normalizeRelation(instruction.work_items);
      const department = normalizeRelation(workItem?.departments);
      if (!workItem) {
        return null;
      }

      const groupIds = instructionGroupIdsById.get(instruction.id) ?? [];

      return {
        id: instruction.id,
        title: workItem.item_title,
        subtitle: `${workItem.part_id || "No Part ID"} | ${department?.name ?? "Unknown Department"} | Rev ${instruction.revision}`,
        href: `/instructions/${instruction.id}`,
        kind: "instruction",
        status: getInstructionApprovalLabel(instruction.approval_status),
        updated_at: instruction.updated_at,
        group_ids: groupIds,
        group_names: groupIds
          .map((groupId) => groupNameById.get(groupId))
          .filter((groupName): groupName is string => Boolean(groupName)),
      };
    })
    .filter((item): item is DocCenterItem => item !== null);

  const items = [...documentItems, ...instructionItems].sort(
    (first, second) =>
      new Date(second.updated_at).getTime() - new Date(first.updated_at).getTime(),
  );

  return <DocCenterClient groups={groups} items={items} loadFailed={Boolean(groupError || documentError || documentGroupError || instructionError || instructionGroupError)} />;
}
