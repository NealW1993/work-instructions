import { redirect } from "next/navigation";

import { requireAuthenticatedUser } from "@/lib/auth";
import { isSystemAdmin } from "@/lib/roles";

export default async function ExportDataPage() {
  const { profile } = await requireAuthenticatedUser();

  if (!isSystemAdmin(profile.role)) {
    redirect("/dashboard");
  }

  redirect("/admin/users#export-data");
}
