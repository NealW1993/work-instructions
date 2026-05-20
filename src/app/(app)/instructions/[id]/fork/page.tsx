import { notFound, redirect } from "next/navigation";

import { InstructionBackButton } from "@/components/instructions/instruction-back-button";
import { InstructionEditor } from "@/components/instructions/instruction-editor";
import { requireAuthenticatedUser } from "@/lib/auth";
import { canEditInstructions } from "@/lib/roles";

interface ForkInstructionPageProps {
  params: Promise<{
    id: string;
  }>;
}

interface WorkItemRelation {
  id: string;
  department_id: string;
  part_id: string;
  item_title: string;
}

interface ForkInstructionRecord {
  id: string;
  is_archived: boolean;
  body_markdown: string;
  uncommon_tools: string;
  iso_clause_refs: string[] | null;
  process_scope: string | null;
  acceptance_criteria: string | null;
  verification_records: string | null;
  risk_controls: string | null;
  revision: number;
  fork_root_instruction_id: string | null;
  fork_number: number | null;
  work_items: WorkItemRelation | WorkItemRelation[];
}

interface InstructionSuggestedToolLinkRow {
  suggested_tool_id: string;
}

function normalizeWorkItem(
  relation: ForkInstructionRecord["work_items"],
): WorkItemRelation | null {
  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }

  return relation;
}

export default async function ForkInstructionPage({ params }: ForkInstructionPageProps) {
  const { id } = await params;
  const { supabase, profile } = await requireAuthenticatedUser();

  if (!canEditInstructions(profile.role)) {
    redirect(`/instructions/${id}`);
  }

  const { data, error } = await supabase
    .from("work_instructions")
    .select(
      "id, is_archived, body_markdown, uncommon_tools, iso_clause_refs, process_scope, acceptance_criteria, verification_records, risk_controls, revision, fork_root_instruction_id, fork_number, work_items(id, department_id, part_id, item_title)",
    )
    .eq("id", id)
    .eq("is_archived", false)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    notFound();
  }

  const instruction = data as ForkInstructionRecord;
  const workItem = normalizeWorkItem(instruction.work_items);
  const forkRootInstructionId =
    instruction.fork_root_instruction_id ?? instruction.id;

  const { data: suggestedToolLinkData, error: suggestedToolLinkError } = await supabase
    .from("instruction_suggested_tools")
    .select("suggested_tool_id")
    .eq("instruction_id", instruction.id);

  if (suggestedToolLinkError) {
    throw new Error(suggestedToolLinkError.message);
  }

  const suggestedToolIds = ((suggestedToolLinkData ?? []) as InstructionSuggestedToolLinkRow[])
    .map((link) => link.suggested_tool_id)
    .filter((value) => value.trim().length > 0);

  if (!workItem) {
    notFound();
  }

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <InstructionBackButton fallbackHref={`/instructions/${id}`} />
        <div className="grid min-w-0 gap-1">
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100">
            Fork Instruction
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Create a copy of this instruction to edit without affecting the original.
          </p>
        </div>
      </header>

      <InstructionEditor
        mode="fork"
        initialData={{
          sourceInstructionId: instruction.id,
          forkRootInstructionId,
          departmentId: workItem.department_id,
          partId: workItem.part_id,
          itemTitle: workItem.item_title,
          bodyMarkdown: instruction.body_markdown,
          uncommonTools: instruction.uncommon_tools,
          isoClauseRefs: instruction.iso_clause_refs ?? undefined,
          processScope: instruction.process_scope ?? "",
          acceptanceCriteria: instruction.acceptance_criteria ?? "",
          verificationRecords: instruction.verification_records ?? "",
          riskControls: instruction.risk_controls ?? "",
          revision: instruction.revision,
          suggestedToolIds,
        }}
      />
    </div>
  );
}
