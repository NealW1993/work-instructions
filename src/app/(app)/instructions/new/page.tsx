import { redirect } from "next/navigation";

import { InstructionEditor } from "@/components/instructions/instruction-editor";
import { requireAuthenticatedUser } from "@/lib/auth";
import { canEditInstructions } from "@/lib/roles";

export default async function NewInstructionPage() {
  const { profile } = await requireAuthenticatedUser();

  if (!canEditInstructions(profile.role)) {
    redirect("/dashboard");
  }

  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100">
          New Work Instruction
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Use rich text formatting, attach media, and add clear descriptions for
          photos/videos captured directly from tablets.
        </p>
      </header>
      <InstructionEditor mode="create" />
    </div>
  );
}
