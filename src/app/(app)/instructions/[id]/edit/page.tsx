import { notFound, redirect } from "next/navigation";

import { InstructionBackButton } from "@/components/instructions/instruction-back-button";
import { InstructionEditor } from "@/components/instructions/instruction-editor";
import { requireAuthenticatedUser } from "@/lib/auth";
import { canEditInstructions } from "@/lib/roles";

interface EditInstructionPageProps {
  params: Promise<{
    id: string;
  }>;
}

interface WorkItemRelation {
  id: string;
  department_id: string;
  part_number: string;
  mold_number: string;
  item_title: string;
}

interface EditInstructionRecord {
  id: string;
  is_archived: boolean;
  body_markdown: string;
  revision: number;
  work_item_id: string;
  work_items: WorkItemRelation | WorkItemRelation[];
}

function normalizeWorkItem(
  relation: EditInstructionRecord["work_items"],
): WorkItemRelation | null {
  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }

  return relation;
}

export default async function EditInstructionPage({ params }: EditInstructionPageProps) {
  const { id } = await params;
  const { supabase, profile } = await requireAuthenticatedUser();

  if (!canEditInstructions(profile.role)) {
    redirect(`/instructions/${id}`);
  }

  const { data, error } = await supabase
    .from("work_instructions")
    .select(
      "id, is_archived, body_markdown, revision, work_item_id, work_items(id, department_id, part_number, mold_number, item_title)",
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

  const instruction = data as EditInstructionRecord;
  const workItem = normalizeWorkItem(instruction.work_items);

  if (!workItem) {
    notFound();
  }

  return (
    <div className="grid gap-4">
      <header className="grid gap-2">
        <InstructionBackButton fallbackHref={`/instructions/${id}`} />
        <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100">
          Edit Instruction
        </h1>
      </header>
      <InstructionEditor
        mode="edit"
        initialData={{
          instructionId: instruction.id,
          workItemId: instruction.work_item_id,
          departmentId: workItem.department_id,
          partNumber: workItem.part_number,
          moldNumber: workItem.mold_number,
          itemTitle: workItem.item_title,
          bodyMarkdown: instruction.body_markdown,
          revision: instruction.revision,
        }}
      />
    </div>
  );
}
