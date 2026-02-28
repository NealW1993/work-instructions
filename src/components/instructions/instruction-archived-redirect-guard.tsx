"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { consumeArchivedInstructionRedirect } from "@/components/instructions/instruction-archived-redirect-state";

interface InstructionArchivedRedirectGuardProps {
  instructionId: string;
  instructionIsArchived: boolean;
}

function isBackForwardNavigation() {
  const navigationEntries = window.performance.getEntriesByType("navigation");
  const navigationEntry = navigationEntries[0];
  if (
    navigationEntry &&
    typeof (navigationEntry as PerformanceNavigationTiming).type === "string"
  ) {
    return (
      (navigationEntry as PerformanceNavigationTiming).type === "back_forward"
    );
  }

  const legacyNavigation = (window.performance as Performance & {
    navigation?: { type?: number };
  }).navigation;
  return legacyNavigation?.type === 2;
}

export function InstructionArchivedRedirectGuard({
  instructionId,
  instructionIsArchived,
}: InstructionArchivedRedirectGuardProps) {
  const router = useRouter();

  useEffect(() => {
    if (!instructionIsArchived) {
      return;
    }

    if (!isBackForwardNavigation()) {
      return;
    }

    const redirectTargetInstructionId = consumeArchivedInstructionRedirect(instructionId);
    if (!redirectTargetInstructionId || redirectTargetInstructionId === instructionId) {
      return;
    }

    router.replace(`/instructions/${redirectTargetInstructionId}`);
    router.refresh();
  }, [instructionId, instructionIsArchived, router]);

  return null;
}
