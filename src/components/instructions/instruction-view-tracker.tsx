"use client";

import { useEffect, useRef } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { drainResponse } from "@/lib/utils";

interface InstructionViewTrackerProps {
  instructionId: string;
}

export function InstructionViewTracker({ instructionId }: InstructionViewTrackerProps) {
  const hasTrackedViewRef = useRef(false);

  useEffect(() => {
    if (!instructionId || hasTrackedViewRef.current) {
      return;
    }

    hasTrackedViewRef.current = true;
    const supabase = getSupabaseBrowserClient();

    void (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.access_token) {
          return;
        }

        await drainResponse(await fetch(`/api/instructions/${instructionId}/views`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          keepalive: true,
        }));
      } catch {
        // Best effort tracking: ignore logging failures.
      }
    })();
  }, [instructionId]);

  return null;
}
