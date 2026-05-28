import { FormulaLabClient } from "@/components/process-maps/formula-lab-client";
import { requireAuthenticatedUser } from "@/lib/auth";
import { hasFullAccess } from "@/lib/roles";

export default async function ProcessMapFormulasPage() {
  const { profile } = await requireAuthenticatedUser();

  return <FormulaLabClient canApproveCustomFormulas={hasFullAccess(profile.role)} />;
}
