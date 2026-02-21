import { redirect } from "next/navigation";

import { getCurrentUserWithProfile } from "@/lib/auth";

export default async function HomePage() {
  const { user } = await getCurrentUserWithProfile();

  if (user) {
    redirect("/dashboard");
  }

  redirect("/login");
}