import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

type PillTone = "amber" | "rose" | "cyan" | "slate" | "emerald" | "violet";

const PILL_TONES: Record<PillTone, string> = {
  amber: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200",
  rose: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-200",
  cyan: "border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-500/40 dark:bg-cyan-500/15 dark:text-cyan-200",
  slate: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200",
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200",
  violet: "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-200",
};

export function StatusPill({ tone = "slate", icon: Icon, children, title }: {
  tone?: PillTone;
  icon?: LucideIcon;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide", PILL_TONES[tone])}>
      {Icon ? <Icon size={12} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** A large, touch-friendly row that opens one work instruction. */
export function InstructionRow({
  href,
  partId,
  title,
  departmentName,
  departmentColor,
  revision,
  meta,
  badges,
  onClick,
  rowProps,
}: {
  href: string;
  partId: string;
  title: string;
  departmentName: string;
  departmentColor: string;
  revision?: number | null;
  meta?: ReactNode;
  badges?: ReactNode;
  onClick?: () => void;
  rowProps?: HTMLAttributes<HTMLAnchorElement> & Record<`data-${string}`, string>;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      {...rowProps}
      className="group relative flex min-h-[4.25rem] min-w-0 items-center gap-3 overflow-hidden rounded-md border border-slate-200 bg-white py-2.5 pl-4 pr-3 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700 dark:hover:bg-slate-900"
    >
      {/* The left edge carries the department colour, as on a colour-coded traveler. */}
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: departmentColor }} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-[15px] font-bold tracking-tight text-slate-950 dark:text-white">{partId || "No part #"}</span>
          {revision ? <span className="rounded border border-slate-300 px-1 text-[11px] font-semibold uppercase leading-4 tracking-wide text-slate-600 dark:border-slate-700 dark:text-slate-300">Rev {revision}</span> : null}
          {badges}
        </span>
        <span className="truncate text-base font-semibold text-slate-800 dark:text-slate-100">{title || "Untitled instruction"}</span>
        <span className="truncate text-sm text-slate-500 dark:text-slate-400">
          {departmentName}
          {meta ? <> · {meta}</> : null}
        </span>
      </span>
      <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-cyan-700 dark:text-slate-500 dark:group-hover:text-cyan-400" />
    </Link>
  );
}

export function WidgetEmptyState({ icon: Icon, title, children, action }: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="grid justify-items-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50/70 px-4 py-6 text-center dark:border-slate-700 dark:bg-slate-900/40">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
        <Icon size={20} aria-hidden="true" />
      </span>
      <p className="text-base font-semibold text-slate-800 dark:text-slate-100">{title}</p>
      {children ? <p className="max-w-sm text-sm text-slate-600 dark:text-slate-400">{children}</p> : null}
      {action}
    </div>
  );
}

export function QuickActionLink({ href, icon: Icon, label, description, primary = false }: {
  href: string;
  icon: LucideIcon;
  label: string;
  description: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex min-h-[4.25rem] items-center gap-3 rounded-lg border px-4 py-3 shadow-[0_1px_2px_rgb(15_23_42/0.05)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500",
        primary
          ? "border-cyan-800 bg-cyan-700 text-white hover:bg-cyan-800 dark:border-cyan-500 dark:bg-cyan-600 dark:hover:bg-cyan-500"
          : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:hover:border-slate-700 dark:hover:bg-slate-900",
      )}
    >
      <span className={cn("inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md", primary ? "bg-white/15" : "border border-slate-200 bg-slate-50 text-cyan-700 dark:border-slate-700 dark:bg-slate-900 dark:text-cyan-400")}>
        <Icon size={20} aria-hidden="true" />
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="text-[15px] font-semibold">{label}</span>
        <span className={cn("truncate text-sm", primary ? "text-cyan-50/90" : "text-slate-500 dark:text-slate-400")}>{description}</span>
      </span>
      <ChevronRight size={18} aria-hidden="true" className={cn("shrink-0 transition group-hover:translate-x-0.5", primary ? "text-white/70" : "text-slate-300 group-hover:text-cyan-700 dark:text-slate-600 dark:group-hover:text-cyan-400")} />
    </Link>
  );
}

export function formatRelativeDays(value: string, nowMs: number): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const minutes = Math.max(0, Math.round((nowMs - timestamp) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months <= 1 ? "a month ago" : `${months} months ago`;
}
