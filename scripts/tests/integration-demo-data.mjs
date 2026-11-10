// Optional demo content for exploring the app against the disposable integration stack.
// Creates instructions through the real controlled-save RPC and approves some through the real API.
import { createClient } from "@supabase/supabase-js";
import { INTEGRATION_PASSWORD, INTEGRATION_USERS, readIntegrationEnv, seedIntegrationStack } from "./integration-seed.mjs";

const appUrl = process.env.INTEGRATION_APP_URL || "http://127.0.0.1:3200";

const DEMO_INSTRUCTIONS = [
  { partId: "MLD-4410", title: "Press 7 mold change and first shot", department: "Compression Molding", approve: true,
    body: "## Before you start\n\n> [!CAUTION]\n> Lock out Press 7 and verify zero energy before reaching into the mold area.\n\n- [ ] Heat-resistant gloves\n- [ ] Face shield\n\n## Steps\n\n1. Raise the platen to the change height.\n2. Release the clamps **in the numbered order**.\n3. Lift the mold with the overhead hoist.\n\n> [!WARNING]\n> The mold stays above 180 °C for 40 minutes.\n\n| Check | Spec |\n| --- | --- |\n| Platen temperature | 175 ± 5 °C |\n| Cure time | 6 min |" },
  { partId: "ASM-2201", title: "Gearbox sub-assembly torque sequence", department: "Assembly", approve: true,
    body: "## Torque sequence\n\n1. Hand-start all six bolts.\n2. Torque to `12 Nm` in a star pattern.\n3. Final torque to `24 Nm`.\n\n> [!IMPORTANT]\n> Mark each bolt with the paint pen after the final pass.\n\n```chart\ntype: bar\ntitle: Rejects by station last week (pcs)\nStation 1: 2\nStation 2: 0\nStation 3: 5\n```" },
  { partId: "QC-0091", title: "First article inspection checklist", department: "Quality", approve: true,
    body: "## Inspection\n\n- [ ] Drawing revision matches the traveler\n- [ ] Critical dimensions measured\n- [ ] Results recorded in the FAI form\n\n> [!NOTE]\n> Use the calibrated height gauge from cabinet B." },
  { partId: "TRM-1180", title: "Flash trim and deburr", department: "Trim", approve: false,
    body: "## Steps\n\n1. Load the part in the trim fixture.\n2. Run the trim cycle.\n3. Deburr the gate area by hand.\n\n> [!TIP]\n> A sharp blade every 200 parts keeps the edge clean." },
  { partId: "SHP-3007", title: "Pallet wrap and label", department: "Shipping", approve: true,
    body: "## Steps\n\n1. Stack cartons in the column pattern.\n2. Wrap three times at the base.\n3. Apply the shipping label on two adjacent sides." },
];

async function main() {
  const { url, anonKey } = readIntegrationEnv();
  await seedIntegrationStack();
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email: INTEGRATION_USERS.admin.email, password: INTEGRATION_PASSWORD });
  if (signInError) throw signInError;
  const { data: departments, error: departmentError } = await client.from("departments").select("id, name");
  if (departmentError) throw departmentError;

  const sysadmin = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: adminSession, error: adminError } = await sysadmin.auth.signInWithPassword({ email: INTEGRATION_USERS.systemAdmin.email, password: INTEGRATION_PASSWORD });
  if (adminError) throw adminError;

  for (const demo of DEMO_INSTRUCTIONS) {
    const department = departments.find((entry) => entry.name === demo.department) ?? departments[0];
    const { data: existing } = await client.from("work_items").select("id").eq("part_id", demo.partId).maybeSingle();
    if (existing) continue;
    const { data, error } = await client.rpc("save_work_instruction_controlled", {
      p_payload: {
        mode: "create", instructionId: null, sourceInstructionId: null, expectedUpdatedAt: null, replacementInstructionId: null,
        departmentId: department.id, partId: demo.partId, itemTitle: demo.title, bodyMarkdown: demo.body, revision: 1,
        isoClauseRefs: ["7.5 Documented information", "8.5 Production and service provision"],
        processScope: "Production cells", acceptanceCriteria: "Meets the released drawing.", verificationRecords: "Traveler sign-off.",
        riskControls: "Stop and escalate nonconforming output.", uncommonTools: "", suggestedToolIds: [], changeSummary: "Initial release.", aiEnhancementId: null,
      },
    });
    if (error) throw error;
    const instructionId = data.instructionId;
    if (demo.approve) {
      const { data: row } = await sysadmin.from("work_instructions").select("updated_at").eq("id", instructionId).single();
      const response = await fetch(`${appUrl}/api/instructions/${instructionId}/approval`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminSession.session.access_token}` },
        body: JSON.stringify({ status: "approved", note: "Demo approval", expectedUpdatedAt: row.updated_at }),
      });
      if (!response.ok) throw new Error(`Approval failed for ${demo.partId}: ${response.status} ${await response.text()}`);
    }
    console.log(`Created ${demo.partId}${demo.approve ? " (approved)" : ""}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
