import { PostHogIdentify } from "@/components/analytics/posthog-identify";
import { AppHeader } from "@/components/layout/app-header";
import { InactivitySignOut } from "@/components/layout/inactivity-sign-out";
import { ThemePreferenceSync } from "@/components/layout/theme-preference-sync";
import { requireAuthenticatedUser } from "@/lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireAuthenticatedUser();

  return (
    <div className="min-h-screen overflow-x-hidden">
      <PostHogIdentify
        id={profile.id}
        email={profile.email}
        fullName={profile.full_name}
        role={profile.role}
      />
      <ThemePreferenceSync themePreference={profile.theme_preference ?? "dark"} />
      <InactivitySignOut />
      <AppHeader profile={profile} />
      <main className="mx-auto w-full min-w-0 max-w-7xl px-4 py-6 md:px-8 md:py-8">
        {children}
      </main>
    </div>
  );
}
