import { PostHogIdentify } from "@/components/analytics/posthog-identify";
import { AppHeader } from "@/components/layout/app-header";
import { InactivitySignOut } from "@/components/layout/inactivity-sign-out";
import { PostLoginHandoff } from "@/components/layout/post-login-handoff";
import { PostLoginScrollRestore } from "@/components/layout/post-login-scroll-restore";
import { ThemePreferenceScript } from "@/components/layout/theme-preference-script";
import { ThemePreferenceSync } from "@/components/layout/theme-preference-sync";
import { requireAuthenticatedUser } from "@/lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireAuthenticatedUser();

  return (
    <div className="app-workspace min-h-screen">
      <ThemePreferenceScript themePreference={profile.theme_preference ?? "dark"} />
      <a href="#main-content" className="skip-to-content">Skip to main content</a>
      <PostHogIdentify
        id={profile.id}
        email={profile.email}
        fullName={profile.full_name}
        role={profile.role}
      />
      <ThemePreferenceSync themePreference={profile.theme_preference ?? "dark"} />
      <InactivitySignOut
        userId={profile.id}
        inactivityTimeoutMinutes={profile.inactivity_timeout_minutes}
      />
      <PostLoginScrollRestore />
      <PostLoginHandoff />
      <AppHeader profile={profile} />
      <main id="main-content" tabIndex={-1} className="mx-auto w-full min-w-0 max-w-[1600px] px-4 py-6 outline-none md:px-8 md:py-8">
        {children}
      </main>
    </div>
  );
}
