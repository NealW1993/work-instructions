// Seeds a disposable local Supabase stack for the real-backend integration suite.
// It refuses to run against anything other than a loopback address so test users
// and records can never be written to a shared or production backend.
import { createClient } from "@supabase/supabase-js";

export const INTEGRATION_PASSWORD = "Integration-Test-Passw0rd!";

export const INTEGRATION_USERS = {
  systemAdmin: { email: "e2e.sysadmin@example.test", fullName: "Sam Systems", role: "system_admin", employeeId: "900001", pin: "314159" },
  admin: { email: "e2e.admin@example.test", fullName: "Avery Admin", role: "admin", employeeId: "900002", pin: "271828" },
  operator: { email: "e2e.operator@example.test", fullName: "Olive Operator", role: "user", employeeId: "900003", pin: "161803" },
};

export function readIntegrationEnv() {
  const url = process.env.INTEGRATION_SUPABASE_URL ?? "";
  const anonKey = process.env.INTEGRATION_SUPABASE_ANON_KEY ?? "";
  const serviceRoleKey = process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      "Set INTEGRATION_SUPABASE_URL, INTEGRATION_SUPABASE_ANON_KEY and INTEGRATION_SUPABASE_SERVICE_ROLE_KEY " +
        "for a disposable local Supabase stack. See docs/VALIDATION.md.",
    );
  }
  const { hostname } = new URL(url);
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname)) {
    throw new Error(`Refusing to seed ${hostname}: the integration suite only runs against a local, disposable stack.`);
  }
  return { url, anonKey, serviceRoleKey };
}

async function ensureUser(admin, spec) {
  const { data: existing, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listError) throw listError;
  let user = existing.users.find((candidate) => candidate.email === spec.email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: spec.email,
      password: INTEGRATION_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: spec.fullName },
    });
    if (error) throw error;
    user = data.user;
  } else {
    const { error } = await admin.auth.admin.updateUserById(user.id, { password: INTEGRATION_PASSWORD });
    if (error) throw error;
  }
  const { error: profileError } = await admin
    .from("profiles")
    .update({ full_name: spec.fullName, role: spec.role, employee_id: spec.employeeId, is_active: true, theme_preference: "light" })
    .eq("id", user.id);
  if (profileError) throw profileError;
  const { error: pinError } = await admin.rpc("set_user_pin", { target_user_id: user.id, new_pin: spec.pin });
  if (pinError) throw pinError;
  return user.id;
}

export async function seedIntegrationStack() {
  const { url, serviceRoleKey } = readIntegrationEnv();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const ids = {};
  for (const [key, spec] of Object.entries(INTEGRATION_USERS)) {
    ids[key] = await ensureUser(admin, spec);
  }
  const { data: departments, error: departmentError } = await admin.from("departments").select("id, name").order("sort_order");
  if (departmentError) throw departmentError;
  if (!departments?.length) {
    const { error } = await admin.from("departments").insert([
      { name: "Molding", color_hex: "#0891B2", sort_order: 1 },
      { name: "Assembly", color_hex: "#7C3AED", sort_order: 2 },
      { name: "Quality", color_hex: "#059669", sort_order: 3 },
    ]);
    if (error) throw error;
  }
  return ids;
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}` || process.argv[1]?.endsWith("integration-seed.mjs")) {
  seedIntegrationStack()
    .then((ids) => console.log("Seeded integration users:", ids))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
