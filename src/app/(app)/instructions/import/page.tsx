import { redirect } from "next/navigation";

import { InstructionBackButton } from "@/components/instructions/instruction-back-button";
import { InstructionImportClient } from "@/components/instructions/instruction-import-client";
import { requireAuthenticatedUser } from "@/lib/auth";
import { canCreateInstructions } from "@/lib/roles";

interface DepartmentRow {
  id: string;
  name: string;
}

export default async function ImportInstructionPage() {
  const { supabase, profile } = await requireAuthenticatedUser();

  if (!canCreateInstructions(profile.role)) {
    redirect("/dashboard");
  }

  const { data } = await supabase
    .from("departments")
    .select("id, name")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  const departments = (data ?? []) as DepartmentRow[];

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <InstructionBackButton fallbackHref="/dashboard" />
        <div className="grid min-w-0 gap-1">
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100">
            Import Work Instruction
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Bring an existing controlled document into the instruction review workflow.
          </p>
        </div>
      </header>
      <InstructionImportClient departments={departments} />
    </div>
  );
}
