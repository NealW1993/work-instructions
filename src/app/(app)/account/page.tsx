import { AccountSettingsPanel } from "@/components/account/account-settings-panel";
import { requireAuthenticatedUser } from "@/lib/auth";

export default async function AccountSettingsPage() {
  const { profile } = await requireAuthenticatedUser();

  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100">
          Account Settings
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Manage your profile, password, and saved theme preference.
        </p>
      </header>
      <AccountSettingsPanel
        initialFullName={profile.full_name}
        initialEmail={profile.email}
        initialEmployeeId={profile.employee_id ?? ""}
        initialThemePreference={profile.theme_preference ?? "dark"}
      />
    </div>
  );
}
