/* SQL regression checks use an empty schema clone, never application records. */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const container = process.env.SQL_TEST_CONTAINER || "supabase_db_work-instructions";
const database = `codex_control_test_${Date.now()}`;
if (!/^[a-zA-Z0-9_-]+$/.test(container) || !/^codex_control_test_\d+$/.test(database)) throw new Error("Invalid test target");

function run(args) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 120000, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout || "Docker command failed");
  if (result.stdout.trim()) console.log(result.stdout.trim());
  if (result.stderr.trim()) console.log(result.stderr.trim());
}
function sql(command) {
  run(["exec", container, "sh", "-c", `PGPASSWORD="$POSTGRES_PASSWORD" ${command}`]);
}

let created = false;
const temporaryFiles = [`/tmp/${database}.sql`];
try {
  sql(`createdb -U supabase_admin ${database}`);
  created = true;
  sql(`pg_dump -U supabase_admin --schema-only --no-owner --no-privileges -d postgres -f /tmp/${database}.sql`);
  sql(`psql -U supabase_admin -d ${database} -v ON_ERROR_STOP=1 -q -f /tmp/${database}.sql`);
  const files = [
    "tests/platform-grants.sql",
    "supabase/migrations/202606031230_notification_delivery_preferences.sql",
    "supabase/migrations/202611070001_document_control.sql",
    "supabase/migrations/202611070002_instruction_control.sql",
    "supabase/migrations/202611070003_instruction_import.sql",
    "supabase/migrations/202611070004_media_uploads.sql",
    "supabase/migrations/202611080001_access_hardening.sql",
    "supabase/migrations/202611090001_ai_provider_settings.sql",
    "tests/instruction-control.sql",
    "tests/instruction-import.sql",
    "tests/document-control.sql",
    "tests/media-storage.sql",
    "tests/access-hardening.sql",
    "tests/ai-settings.sql",
  ];
  for (const [index, file] of files.entries()) {
    const remote = `/tmp/${database}-${index}.sql`;
    temporaryFiles.push(remote);
    run(["cp", resolve(file), `${container}:${remote}`]);
    sql(`psql -U supabase_admin -d ${database} -v ON_ERROR_STOP=1 -q -f ${remote}`);
    console.log(`Passed: ${file}`);
  }
  console.log("Database control regression checks passed.");
} finally {
  // Only the database created by this invocation can be removed.
  if (created) {
    sql(`dropdb -U supabase_admin ${database}`);
    run(["exec", container, "rm", "-f", ...temporaryFiles]);
  }
}
