import { ChevronDown, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Native disclosure keeps secondary tools accessible without crowding the workspace. */
export function DisclosureSection({
  title,
  description,
  children,
  open = false,
  id,
  icon: Icon,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  open?: boolean;
  id?: string;
  /** Shown in a small square before the title, like the other System Settings sections. */
  icon?: LucideIcon;
}) {
  return (
    <details id={id} open={open} className="workspace-disclosure group min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-4 py-4 text-left md:px-5">
        <span className="flex min-w-0 items-center gap-3">
          {Icon ? (
            <span aria-hidden="true" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-cyan-700 dark:border-slate-700 dark:bg-slate-900 dark:text-cyan-400">
              <Icon size={18} />
            </span>
          ) : null}
          <span className="grid min-w-0 gap-1">
            <span className="font-semibold text-slate-900 dark:text-slate-100">{title}</span>
            {description ? <span className="text-sm font-normal text-slate-600 dark:text-slate-400">{description}</span> : null}
          </span>
        </span>
        <ChevronDown aria-hidden="true" size={18} className="shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
      </summary>
      <div className="disclosure-body grid min-w-0 gap-4 border-t border-slate-200 p-4 dark:border-slate-800 md:p-5">
        {children}
      </div>
    </details>
  );
}
