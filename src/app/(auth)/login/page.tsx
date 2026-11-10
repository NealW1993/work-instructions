import { redirect } from "next/navigation";

import { LoginPanel } from "@/components/auth/login-panel";
import { getCurrentUserWithProfile } from "@/lib/auth";

export default async function LoginPage() {
  const { user, profile } = await getCurrentUserWithProfile();

  // Only an active account goes on to the app. A session for a deactivated account stays here
  // (the panel signs it out); redirecting it to the dashboard would bounce straight back.
  if (user && profile) {
    redirect("/dashboard");
  }

  return <LoginPanel inactiveSession={Boolean(user)} />;
}
