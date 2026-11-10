import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3 } from "lucide-react";

import { AiSettingsPanel } from "@/components/admin/ai-settings-panel";
import { UserAdminPanel } from "@/components/admin/user-admin-panel";
import { InstructionBackButton } from "@/components/instructions/instruction-back-button";
import { requireAuthenticatedUser } from "@/lib/auth";
import { hasFullAccess, isSystemAdmin } from "@/lib/roles";

export default async function UserAdminPage() {
  const { profile } = await requireAuthenticatedUser();

  if (!hasFullAccess(profile.role)) {
    redirect("/dashboard");
  }

  return (
    <section className="grid gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-start gap-3">
          <InstructionBackButton fallbackHref="/dashboard" />
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100">
            System Administration
          </h1>
        </div>
        <Link
          href="/admin/kpis"
          className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/12 px-3 py-2 text-sm font-semibold text-cyan-900 transition hover:bg-cyan-500/20 dark:text-cyan-100"
        >
          <BarChart3 size={16} />
          Quality Metrics
        </Link>
      </header>
      <UserAdminPanel currentUserId={profile.id} currentUserRole={profile.role} />
      {isSystemAdmin(profile.role) ? <AiSettingsPanel /> : null}
      <section id="export-data" className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Audit & Data Exports</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Download document histories, revision evidence, and operational records.
          </p>
        </div>
        <Link href="/admin/export" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Open exports</Link>
      </section>
    </section>
  );
}
