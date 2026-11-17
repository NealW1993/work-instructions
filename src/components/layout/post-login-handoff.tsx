"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { FloatingStatusNotices } from "@/components/ui/floating-status-notices";
import { takePendingPostLoginResumeRoute, takePostLoginWelcome } from "@/lib/last-route-restore";

/**
 * Finishes what the sign-in page started. Signing in is a full page load, so anything that should
 * happen on the first page after it is handed over through the tab's session storage: a welcome for
 * a new account, and the page an automatic sign-out interrupted.
 */
export function PostLoginHandoff() {
  const router = useRouter();
  const [welcome, setWelcome] = useState<string | null>(null);

  useEffect(() => {
    // Deferred so React's development double-run does not take the hand-over twice.
    const timer = window.setTimeout(() => {
      const greeting = takePostLoginWelcome();
      if (greeting) {
        const name = greeting.name ? `, ${greeting.name}` : "";
        setWelcome(
          greeting.promoted
            ? `Welcome${name}! Your account is ready. As the first account, it has system admin access.`
            : `Welcome${name}! Your account is ready and you are signed in.`,
        );
      }

      const resumePath = takePendingPostLoginResumeRoute();
      if (resumePath && resumePath !== `${window.location.pathname}${window.location.search}`) {
        router.push(resumePath);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [router]);

  return (
    <FloatingStatusNotices
      notices={[
        welcome && {
          id: "post-login-welcome",
          tone: "success",
          message: welcome,
          onDismiss: () => setWelcome(null),
        },
      ]}
    />
  );
}
