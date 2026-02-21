import { redirect } from "next/navigation";

import { LoginPanel } from "@/components/auth/login-panel";
import { getCurrentUserWithProfile } from "@/lib/auth";

export default async function LoginPage() {
  const { user } = await getCurrentUserWithProfile();

  if (user) {
    redirect("/dashboard");
  }

  return <LoginPanel />;
}