"use client";

import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

import { cn } from "@/lib/utils";

export interface FloatingStatusNotice {
  id: string;
  tone: "success" | "error" | "info";
  message: string;
  onDismiss?: () => void;
}

interface FloatingStatusNoticesProps {
  notices: Array<FloatingStatusNotice | null | undefined | false | string>;
  durationMs?: number;
}

function isFloatingStatusNotice(value: FloatingStatusNoticesProps["notices"][number]): value is FloatingStatusNotice {
  if (!value || typeof value !== "object") {
    return false;
  }

  return "message" in value;
}

export function FloatingStatusNotices({
  notices,
  durationMs = 4200,
}: FloatingStatusNoticesProps) {
  const visibleNotices = notices.filter(isFloatingStatusNotice);
  const noticeKey = visibleNotices.map((notice) => `${notice.id}:${notice.message}`).join("|");

  useEffect(() => {
    const timers = visibleNotices
      .filter((notice) => notice.onDismiss && notice.tone !== "error")
      .map((notice) =>
        window.setTimeout(() => {
          notice.onDismiss?.();
        }, durationMs),
      );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
    // visibleNotices is intentionally represented by noticeKey so timers do not reset on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs, noticeKey]);

  if (visibleNotices.length === 0) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 top-4 z-[100] grid w-[min(92vw,34rem)] -translate-x-1/2 gap-2"
    >
      {visibleNotices.map((notice) => {
        const Icon =
          notice.tone === "success"
            ? CheckCircle2
            : notice.tone === "error"
              ? AlertTriangle
              : Info;

        return (
          <div
            key={`${notice.id}:${notice.message}`}
            role={notice.tone === "error" ? "alert" : "status"}
            className={cn(
              "system-status-toast pointer-events-auto flex items-start gap-2 rounded-xl border px-4 py-3 text-sm font-semibold shadow-xl backdrop-blur-md",
              notice.tone === "success"
                ? "border-emerald-500/35 bg-emerald-50/95 text-emerald-900 dark:bg-emerald-950/95 dark:text-emerald-100"
                : notice.tone === "error"
                  ? "border-rose-500/35 bg-rose-50/95 text-rose-900 dark:bg-rose-950/95 dark:text-rose-100"
                  : "border-cyan-500/35 bg-cyan-50/95 text-cyan-950 dark:bg-slate-950/95 dark:text-cyan-100",
            )}
          >
            <Icon size={18} className="mt-0.5 shrink-0" />
            <span className="min-w-0">{notice.message}</span>
            {notice.onDismiss ? <button type="button" onClick={notice.onDismiss} aria-label="Dismiss notification" className="-my-2 -mr-2 ml-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current dark:hover:bg-white/10"><X size={16} /></button> : null}
          </div>
        );
      })}
    </div>
  );
}
