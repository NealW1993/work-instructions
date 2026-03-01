import { redirect } from "next/navigation";

import { InstructionBackButton } from "@/components/instructions/instruction-back-button";
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
      <header className="flex flex-wrap items-start gap-3">
        <InstructionBackButton fallbackHref="/dashboard" />
        <div className="grid min-w-0 gap-1">
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100">
            New Work Instruction
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Capture clear step-by-step instructions
          </p>
        </div>
      </header>
      <InstructionEditor mode="create" />
    </div>
  );
}
