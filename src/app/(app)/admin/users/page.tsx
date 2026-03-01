import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3 } from "lucide-react";

import { UserAdminPanel } from "@/components/admin/user-admin-panel";
import { InstructionBackButton } from "@/components/instructions/instruction-back-button";
import { requireAuthenticatedUser } from "@/lib/auth";
import { isSystemAdmin } from "@/lib/roles";

export default async function UserAdminPage() {
  const { profile } = await requireAuthenticatedUser();

  if (!isSystemAdmin(profile.role)) {
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
    </section>
  );
}
