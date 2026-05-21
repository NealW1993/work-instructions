import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3 } from "lucide-react";

import { ExportDataPanel } from "@/components/admin/export-data-panel";
import { UserAdminPanel } from "@/components/admin/user-admin-panel";
import { InstructionBackButton } from "@/components/instructions/instruction-back-button";
import { requireAuthenticatedUser } from "@/lib/auth";
import { hasFullAccess } from "@/lib/roles";

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
          View KPI&apos;s
        </Link>
      </header>
      <UserAdminPanel />
      <section id="export-data" className="grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7">
        <div className="grid gap-1">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Export Data</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Admins can export dashboard and instruction data in common formats.
          </p>
        </div>
        <ExportDataPanel />
      </section>
    </section>
  );
}
