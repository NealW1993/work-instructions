import { AccountSettingsPanel } from "@/components/account/account-settings-panel";
import { InstructionBackButton } from "@/components/instructions/instruction-back-button";
import { requireAuthenticatedUser } from "@/lib/auth";

export default async function AccountSettingsPage() {
  const { profile } = await requireAuthenticatedUser();

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <InstructionBackButton fallbackHref="/dashboard" />
        <div className="grid min-w-0 gap-1">
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100">
            Account Settings
          </h1>
        </div>
      </header>
      <AccountSettingsPanel
        initialFullName={profile.full_name}
        initialEmail={profile.email}
        initialEmployeeId={profile.employee_id ?? ""}
        initialThemePreference={profile.theme_preference ?? "dark"}
        initialIconColor={profile.icon_color ?? "#0EA5E9"}
        initialTotalSignedInSeconds={profile.total_signed_in_seconds ?? 0}
        initialActiveSessionStartedAt={profile.active_session_started_at ?? null}
      />
    </div>
  );
}
