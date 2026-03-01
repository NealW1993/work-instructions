"use client";

import { useEffect } from "react";

export function AutoPrintTrigger({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      window.print();
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [enabled]);

  return null;
}
