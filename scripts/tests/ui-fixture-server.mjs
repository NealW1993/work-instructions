// Isolated API fixtures. Writes remain in memory and never use a real backend.
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { handleMedia, readBody } from "./media-fixture.mjs";
import { handleProfileFixture } from "./profile-fixture.mjs";

const userId = "a1000000-0000-0000-0000-000000000001";
const instructionId = "a3000000-0000-0000-0000-000000000001";
const departmentId = "a2000000-0000-0000-0000-000000000001";
const stamp = "2026-11-01T12:00:00Z";
const user = { id: userId, aud: "authenticated", role: "authenticated", email: "reviewer@example.invalid", email_confirmed_at: stamp, app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { full_name: "Quality Reviewer" }, identities: [], created_at: stamp };
const profile = { id: userId, email: user.email, full_name: "Quality Reviewer", employee_id: "980101", role: "system_admin", is_active: true, theme_preference: "light", created_at: stamp, updated_at: stamp, user_settings: {}, dashboard_layout: null, dashboard_default_layout: null, inactivity_timeout_minutes: null, total_signed_in_seconds: 0 };
const department = { id: departmentId, name: "Manufacturing Engineering", color_hex: "#0891B2", sort_order: 1, created_at: stamp, updated_at: stamp };
const workItem = { id: "a4000000-0000-0000-0000-000000000001", department_id: departmentId, part_id: "MFG-2048", item_title: "Fixture setup and first article inspection", created_by: userId, created_at: stamp, updated_at: stamp, departments: department };
const instruction = { id: instructionId, work_item_id: workItem.id, work_items: workItem, revision: 3, is_archived: false, body_markdown: "<h2>Safety and preparation</h2><p>Verify the machine is in its safe setup state. Wear the specified PPE.</p><ol><li>Clean and inspect the fixture locating surfaces.</li><li>Load the approved part and verify its orientation.</li><li>Measure the first article against the drawing before release.</li></ol>", notes_markdown: "", uncommon_tools: "Calibrated torque wrench", iso_clause_refs: ["7.5 Documented information"], process_scope: "Approved setup for cell MFG-02.", acceptance_criteria: "Dimensions and torque meet the current released drawing.", verification_records: "First article inspection record and calibration log.", risk_controls: "Stop and escalate nonconforming output.", approval_status: "approved", approved_by: userId, approved_at: stamp, submitted_by: userId, submitted_at: stamp, rejected_by: null, rejected_at: null, approval_note: "", fork_root_instruction_id: null, fork_number: null, merged_into_root_at: null, merge_count: 0, created_by: userId, updated_by: userId, created_at: stamp, updated_at: stamp, last_change_summary: "Clarified first article inspection.", instruction_media: [], ai_assisted: false };
workItem.work_instructions = [{ ...instruction, work_items: undefined }];
instruction.revision_family_id = instructionId;
instruction.body_markdown += '<figure data-type="image" data-align="center" data-width="640"><img src="http://127.0.0.1:3900/storage/v1/object/public/instruction-media/fixture-diagram.svg" alt="Fixture locator diagram" width="640" /></figure>';
instruction.instruction_media = [{ id: "a8000000-0000-0000-0000-000000000001", instruction_id: instructionId, storage_path: "fixture.mp4", public_url: "http://127.0.0.1:3900/storage/v1/object/public/instruction-media/fixture.mp4", media_type: "video", caption: "Setup demonstration", sort_order: 0, created_by: userId, created_at: stamp }];
instruction.instruction_media.push({ id: "a8000000-0000-0000-0000-000000000002", instruction_id: instructionId, storage_path: "fixture-diagram.svg", public_url: "http://127.0.0.1:3900/storage/v1/object/public/instruction-media/fixture-diagram.svg", media_type: "image", caption: "Fixture attachment diagram", sort_order: 1, created_by: userId, created_at: stamp });

const documents = Array.from({ length: 23 }, (_, index) => ({ id: `a5000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`, document_number: `QMS-${String(index + 1).padStart(3, "0")}`, title: index === 0 ? "Production release and traceability procedure" : `Manufacturing process control ${index + 1}`, document_type: "procedure", status: index % 4 === 0 ? "in_review" : "approved", department_id: departmentId, owner_user_id: userId, process_name: "Production control", process_purpose: "Ensure repeatable production and traceable release.", process_scope: "Manufacturing operations", process_inputs: "Approved material and drawing", process_outputs: "Verified output", process_risks: "Incorrect setup", process_controls: "First article verification", related_instruction_ids: [instructionId], iso_clause_refs: ["7.5 Documented information"], process_map_payload: {}, current_revision: 1, effective_at: stamp, next_review_at: "2027-11-01T12:00:00Z", approved_by: userId, approved_at: stamp, created_by: userId, updated_by: userId, created_at: stamp, updated_at: stamp }));
const revisions = documents.map((document, index) => ({ id: `a6000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`, document_id: document.id, revision: 1, title: document.title, body_html: "<h2>Purpose</h2><p>Control production release and retain objective evidence.</p><h2>Procedure</h2><ol><li>Verify the released specification.</li><li>Complete the required inspection.</li><li>Record lot identification and release authorization.</li></ol>", change_summary: "Initial controlled release.", source_type: "manual", prepared_by: userId, approved_by: userId, approved_at: stamp, created_at: stamp, metadata_snapshot: {} }));
const tables = { profiles: [profile], departments: [department], work_items: [workItem], work_instructions: [instruction], process_documents: documents, process_document_revisions: revisions, access_groups: [{ id: "a7000000-0000-0000-0000-000000000001", name: "Production", slug: "production", description: "Controlled documents for trained production personnel.", is_active: true }], instruction_review_settings: [{ id: 1, review_window_days: 30 }], instruction_review_status: [{ instruction_id: instructionId, status: "up_to_date", last_calibrated_at: stamp, updated_at: stamp }], system_settings: [], process_document_templates: [] };

const server = http.createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:3100");
  response.setHeader("Access-Control-Allow-Headers", "authorization,apikey,content-type,x-client-info,prefer,range,x-supabase-api-version");
  response.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS,POST,PATCH");
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
  const url = new URL(request.url, "http://127.0.0.1:3900");
  const send = (value, status = 200) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(request.method === "HEAD" ? undefined : JSON.stringify(value)); };
  if (await handleProfileFixture(request, response, url, send, profile)) return;
  try { if (await handleMedia(request, response)) return; } catch { if (!response.headersSent) send({ message: "Fixture transfer interrupted" }, 499); return; }
  if (url.pathname === "/auth/v1/user") return send(user);
  if (url.pathname.startsWith("/auth/")) return send({ error: "Read-only browser fixture" }, 405);
  const controlledList = url.pathname === "/rest/v1/rpc/list_process_documents_controlled";
  if (url.pathname === "/rest/v1/rpc/save_work_instruction_controlled" && request.method === "POST") {
    const body = JSON.parse((await readBody(request)).toString());
    const draft = body.p_payload;
    instruction.body_markdown = draft.bodyMarkdown;
    instruction.process_scope = draft.processScope;
    instruction.acceptance_criteria = draft.acceptanceCriteria;
    instruction.verification_records = draft.verificationRecords;
    instruction.approval_status = "pending_review";
    return send({ instructionId });
  }
  if (url.pathname.startsWith("/rest/v1/rpc/") && !controlledList) return send(null);
  if (!url.pathname.startsWith("/rest/v1/") || (!controlledList && !["GET", "HEAD"].includes(request.method))) return send({ message: "Read-only browser fixture" }, 405);
  const name = controlledList ? "process_documents" : url.pathname.slice("/rest/v1/".length);
  let rows = [...(tables[name] || [])];
  for (const [field, filter] of url.searchParams.entries()) {
    if (filter.startsWith("eq.") && !field.includes(".")) rows = rows.filter((row) => String(row[field]) === filter.slice(3));
    if (filter.startsWith("neq.") && !field.includes(".")) rows = rows.filter((row) => String(row[field]) !== filter.slice(4));
    if (filter.startsWith("in.(") && !field.includes(".")) { const values = filter.slice(4, -1).split(","); rows = rows.filter((row) => values.includes(String(row[field]))); }
  }
  response.setHeader("Content-Range", rows.length ? `0-${rows.length - 1}/${rows.length}` : "*/0");
  const offset = Number(url.searchParams.get("offset") || 0);
  const limit = Number(url.searchParams.get("limit") || rows.length);
  rows = rows.slice(offset, offset + limit);
  return send(request.headers.accept?.includes("application/vnd.pgrst.object+json") ? rows[0] || null : rows);
});

// Webpack keeps the isolated Windows browser fixture predictable after dependency updates.
// The production application still uses its configured default bundler.
const nextProcess = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3100"], {
  stdio: "inherit",
  env: { ...process.env, NEXT_BUILD_DIR: ".next-ui-smoke", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:3900", SUPABASE_URL_INTERNAL: "http://127.0.0.1:3900", NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key", SUPABASE_ANON_KEY: "fixture-anon-key", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100", NEXT_PUBLIC_POSTHOG_KEY: "", OPENAI_API_KEY: "", SYSTEM_ADMIN_EMAIL: "", NEXT_TELEMETRY_DISABLED: "1" },
});
server.listen(3900, "127.0.0.1");
nextProcess.on("exit", (code) => { server.close(); process.exitCode = code || 0; });
function stop() { nextProcess.kill(); server.close(); }
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
