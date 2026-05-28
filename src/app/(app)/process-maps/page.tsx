import { ProcessMapBuilderClient } from "@/components/process-maps/process-map-builder-client";
import { requireAuthenticatedUser } from "@/lib/auth";
import { canCreateControlledDocuments } from "@/lib/roles";

interface DepartmentRow {
  id: string;
  name: string;
}

export default async function ProcessMapsPage() {
  const { supabase, profile } = await requireAuthenticatedUser();
  const { data: departmentRows } = await supabase
    .from("departments")
    .select("id, name")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  return (
    <ProcessMapBuilderClient
      canEdit={canCreateControlledDocuments(profile.role)}
      departments={((departmentRows ?? []) as DepartmentRow[]).map((department) => ({
        id: department.id,
        name: department.name,
      }))}
    />
  );
}
