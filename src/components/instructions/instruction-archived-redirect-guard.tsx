"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { consumeArchivedInstructionRedirect } from "@/components/instructions/instruction-archived-redirect-state";

interface InstructionArchivedRedirectGuardProps {
  instructionId: string;
  instructionIsArchived: boolean;
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

    const redirectTargetInstructionId = consumeArchivedInstructionRedirect(instructionId);
    if (!redirectTargetInstructionId || redirectTargetInstructionId === instructionId) {
      return;
    }

    router.replace(`/instructions/${redirectTargetInstructionId}`);
    router.refresh();
  }, [instructionId, instructionIsArchived, router]);

  return null;
}
