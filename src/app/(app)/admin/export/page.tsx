import { redirect } from "next/navigation";

import { ExportDataPanel } from "@/components/admin/export-data-panel";
import { InstructionBackButton } from "@/components/instructions/instruction-back-button";
import { requireAuthenticatedUser } from "@/lib/auth";
import { canEditInstructions } from "@/lib/roles";

export default async function ExportDataPage() {
  const { profile } = await requireAuthenticatedUser();

  if (!canEditInstructions(profile.role)) {
    redirect("/dashboard");
  }

  return (
    <section className="grid gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <InstructionBackButton fallbackHref="/dashboard" />
        <div className="grid gap-1">
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100">
            Data Export
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Export dashboard and instruction data in common formats.
          </p>
        </div>
      </header>

      <ExportDataPanel />
    </section>
  );
}
