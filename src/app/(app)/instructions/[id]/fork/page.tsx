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
  revision: number;
  fork_root_instruction_id: string | null;
  fork_number: number | null;
  work_items: WorkItemRelation | WorkItemRelation[];
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
      "id, is_archived, body_markdown, revision, fork_root_instruction_id, fork_number, work_items(id, department_id, part_id, item_title)",
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

  if (!workItem) {
    notFound();
  }

  return (
    <div className="grid gap-4">
      <header className="grid gap-2">
        <InstructionBackButton fallbackHref={`/instructions/${id}`} />
        <div>
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
          revision: instruction.revision,
        }}
      />
    </div>
  );
}
