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
      </header>
      <AccountSettingsPanel
        initialFullName={profile.full_name}
        initialEmail={profile.email}
        initialEmployeeId={profile.employee_id ?? ""}
        initialThemePreference={profile.theme_preference ?? "dark"}
        initialIconColor={profile.icon_color ?? "#0EA5E9"}
        initialTotalSignedInSeconds={profile.total_signed_in_seconds ?? 0}
      />
    </div>
  );
}
