import { FormulaLabClient } from "@/components/process-maps/formula-lab-client";
import { requireAuthenticatedUser } from "@/lib/auth";

export default async function ProcessMapFormulasPage() {
  await requireAuthenticatedUser();

  return <FormulaLabClient />;
}
