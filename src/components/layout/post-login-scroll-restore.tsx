"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import {
  takePendingPostLoginScrollRestoreForPath,
} from "@/lib/last-route-restore";

export function PostLoginScrollRestore() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const currentPath = `${pathname}${search ? `?${search}` : ""}`;
    const pendingRestore = takePendingPostLoginScrollRestoreForPath(currentPath);
    if (!pendingRestore) {
      return;
    }

    const applyScroll = () => {
      window.scrollTo({
        left: pendingRestore.scrollX,
        top: pendingRestore.scrollY,
        behavior: "auto",
      });
    };

    applyScroll();
    window.requestAnimationFrame(() => {
      applyScroll();
      window.requestAnimationFrame(() => {
        applyScroll();
      });
    });
  }, [pathname, search]);

  return null;
}
