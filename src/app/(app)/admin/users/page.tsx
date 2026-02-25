import { redirect } from "next/navigation";

import { UserAdminPanel } from "@/components/admin/user-admin-panel";
import { requireAuthenticatedUser } from "@/lib/auth";
import { isSystemAdmin } from "@/lib/roles";

export default async function UserAdminPage() {
  const { profile } = await requireAuthenticatedUser();

  if (!isSystemAdmin(profile.role)) {
    redirect("/dashboard");
  }

  return (
    <section className="grid gap-4">
      <header>
        <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100">
          System Administration
        </h1>
      </header>
      <UserAdminPanel />
    </section>
  );
}
