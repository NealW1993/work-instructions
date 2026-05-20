import { ProcessDocumentsClient } from "@/components/process-documents/process-documents-client";
import type {
  ProcessDocumentAuditItem,
  ProcessDocumentDepartmentOption,
  ProcessDocumentInstructionOption,
  ProcessDocumentListItem,
  ProcessDocumentProfileOption,
  ProcessDocumentRevisionItem,
  ProcessDocumentTemplateItem,
} from "@/components/process-documents/process-documents-client";
import { requireAuthenticatedUser } from "@/lib/auth";
import type {
  ProcessDocumentStatus,
  ProcessDocumentType,
  ProcessDocumentSourceType,
} from "@/lib/process-documents";
import { canEditInstructions, isSystemAdmin } from "@/lib/roles";

interface ProcessDocumentsPageProps {
  searchParams: Promise<{
    doc?: string;
  }>;
}

interface ProcessDocumentRow {
  id: string;
  document_number: string;
  title: string;
  document_type: ProcessDocumentType;
  status: ProcessDocumentStatus;
  department_id: string | null;
  owner_user_id: string | null;
  process_name: string | null;
  process_scope: string | null;
  process_inputs: string | null;
  process_outputs: string | null;
  process_risks: string | null;
  process_controls: string | null;
  related_instruction_ids: string[] | null;
  iso_clause_refs: string[] | null;
  current_revision: number;
  effective_at: string | null;
  next_review_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  obsoleted_by: string | null;
  obsoleted_at: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

interface ProcessDocumentRevisionRow {
  id: string;
  document_id: string;
  revision: number;
  title: string;
  body_html: string;
  change_summary: string | null;
  source_type: ProcessDocumentSourceType;
  template_id: string | null;
  imported_file_name: string | null;
  imported_file_type: string | null;
  imported_file_size: number | null;
  prepared_by: string;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

interface ProcessDocumentAuditRow {
  id: string;
  document_id: string;
  revision_id: string | null;
  actor_user_id: string;
  event_type: string;
  detail: string | null;
  from_status: ProcessDocumentStatus | null;
  to_status: ProcessDocumentStatus | null;
  occurred_at: string;
}

interface ProcessDocumentTemplateRow {
  id: string;
  slug: string;
  name: string;
  document_type: ProcessDocumentType;
  description: string | null;
  body_html: string;
}

interface DepartmentRow {
  id: string;
  name: string;
  color_hex: string | null;
}

interface ProfileRow {
  id: string;
  full_name: string;
  email: string;
}

interface InstructionOptionRow {
  id: string;
  revision: number;
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

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function ProcessDocumentsPage({
  searchParams,
}: ProcessDocumentsPageProps) {
  const { supabase, profile } = await requireAuthenticatedUser();
  const params = await searchParams;
  const canEdit = canEditInstructions(profile.role);

  const [
    { data: documentRows },
    { data: revisionRows },
    { data: auditRows },
    { data: templateRows },
    { data: departmentRows },
    { data: profileRows },
    { data: instructionRows },
  ] = await Promise.all([
    supabase
      .from("process_documents")
      .select("*")
      .order("updated_at", { ascending: false })
      .range(0, 999),
    supabase
      .from("process_document_revisions")
      .select("*")
      .order("revision", { ascending: false })
      .range(0, 2999),
    supabase
      .from("process_document_audit_events")
      .select("*")
      .order("occurred_at", { ascending: false })
      .range(0, 3999),
    supabase
      .from("process_document_templates")
      .select("id, slug, name, document_type, description, body_html")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("departments")
      .select("id, name, color_hex")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
    supabase
      .from("work_instructions")
      .select("id, revision, work_items(part_id, item_title, departments(name))")
      .eq("is_archived", false)
      .order("updated_at", { ascending: false })
      .range(0, 499),
  ]);

  const departments = ((departmentRows ?? []) as DepartmentRow[]).map(
    (department): ProcessDocumentDepartmentOption => ({
      id: department.id,
      name: department.name,
      color_hex: department.color_hex,
    }),
  );
  const departmentById = new Map(departments.map((department) => [department.id, department]));

  const profiles = ((profileRows ?? []) as ProfileRow[]).map(
    (userProfile): ProcessDocumentProfileOption => ({
      id: userProfile.id,
      full_name: userProfile.full_name,
      email: userProfile.email,
    }),
  );
  const profileNameById = new Map(
    profiles.map((userProfile) => [
      userProfile.id,
      userProfile.full_name || userProfile.email || "Unknown",
    ]),
  );

  const documents = ((documentRows ?? []) as ProcessDocumentRow[]).map(
    (document): ProcessDocumentListItem => {
      const department = document.department_id
        ? departmentById.get(document.department_id) ?? null
        : null;

      return {
        id: document.id,
        document_number: document.document_number,
        title: document.title,
        document_type: document.document_type,
        status: document.status,
        department_id: document.department_id,
        owner_user_id: document.owner_user_id,
        process_name: document.process_name ?? "",
        process_scope: document.process_scope ?? "",
        process_inputs: document.process_inputs ?? "",
        process_outputs: document.process_outputs ?? "",
        process_risks: document.process_risks ?? "",
        process_controls: document.process_controls ?? "",
        related_instruction_ids: document.related_instruction_ids ?? [],
        iso_clause_refs: document.iso_clause_refs ?? [],
        current_revision: document.current_revision,
        effective_at: document.effective_at,
        next_review_at: document.next_review_at,
        approved_by: document.approved_by,
        approved_at: document.approved_at,
        obsoleted_by: document.obsoleted_by,
        obsoleted_at: document.obsoleted_at,
        created_by: document.created_by,
        updated_by: document.updated_by,
        created_at: document.created_at,
        updated_at: document.updated_at,
        department_name: department?.name ?? null,
        department_color: department?.color_hex ?? null,
        owner_name: document.owner_user_id
          ? profileNameById.get(document.owner_user_id) ?? null
          : null,
        updated_by_name: profileNameById.get(document.updated_by) ?? null,
        approved_by_name: document.approved_by
          ? profileNameById.get(document.approved_by) ?? null
          : null,
      };
    },
  );

  const revisions = ((revisionRows ?? []) as ProcessDocumentRevisionRow[]).map(
    (revision): ProcessDocumentRevisionItem => ({
      id: revision.id,
      document_id: revision.document_id,
      revision: revision.revision,
      title: revision.title,
      body_html: revision.body_html,
      change_summary: revision.change_summary ?? "",
      source_type: revision.source_type,
      template_id: revision.template_id,
      imported_file_name: revision.imported_file_name,
      imported_file_type: revision.imported_file_type,
      imported_file_size: revision.imported_file_size,
      prepared_by: revision.prepared_by,
      approved_by: revision.approved_by,
      approved_at: revision.approved_at,
      created_at: revision.created_at,
      prepared_by_name: profileNameById.get(revision.prepared_by) ?? null,
      approved_by_name: revision.approved_by
        ? profileNameById.get(revision.approved_by) ?? null
        : null,
    }),
  );

  const auditEvents = ((auditRows ?? []) as ProcessDocumentAuditRow[]).map(
    (event): ProcessDocumentAuditItem => ({
      id: event.id,
      document_id: event.document_id,
      revision_id: event.revision_id,
      actor_user_id: event.actor_user_id,
      event_type: event.event_type,
      detail: event.detail ?? "",
      from_status: event.from_status,
      to_status: event.to_status,
      occurred_at: event.occurred_at,
      actor_name: profileNameById.get(event.actor_user_id) ?? null,
    }),
  );

  const templates = ((templateRows ?? []) as ProcessDocumentTemplateRow[]).map(
    (template): ProcessDocumentTemplateItem => ({
      id: template.id,
      slug: template.slug,
      name: template.name,
      document_type: template.document_type,
      description: template.description ?? "",
      body_html: template.body_html,
    }),
  );

  const instructions = ((instructionRows ?? []) as InstructionOptionRow[])
    .map((instruction): ProcessDocumentInstructionOption | null => {
      const workItem = normalizeRelation(instruction.work_items);
      const department = normalizeRelation(workItem?.departments);

      if (!workItem) {
        return null;
      }

      return {
        id: instruction.id,
        revision: instruction.revision,
        part_id: workItem.part_id,
        item_title: workItem.item_title,
        department_name: department?.name ?? "Unknown",
      };
    })
    .filter(
      (instruction): instruction is ProcessDocumentInstructionOption =>
        instruction !== null,
    );

  return (
    <ProcessDocumentsClient
      canEdit={canEdit}
      isSystemAdmin={isSystemAdmin(profile.role)}
      currentUserId={profile.id}
      initialDocumentId={params.doc?.trim() ?? null}
      documents={documents}
      revisions={revisions}
      auditEvents={auditEvents}
      templates={templates}
      departments={departments}
      profiles={profiles}
      instructions={instructions}
    />
  );
}
