import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

/** Native disclosure keeps secondary tools accessible without crowding the workspace. */
export function DisclosureSection({
  title,
  description,
  children,
  open = false,
  id,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  open?: boolean;
  id?: string;
}) {
  return (
    <details id={id} open={open} className="workspace-disclosure group min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-4 py-4 text-left md:px-5">
        <span className="grid min-w-0 gap-1">
          <span className="font-semibold text-slate-900 dark:text-slate-100">{title}</span>
          {description ? <span className="text-sm font-normal text-slate-600 dark:text-slate-400">{description}</span> : null}
        </span>
        <ChevronDown aria-hidden="true" size={18} className="shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
      </summary>
      <div className="grid min-w-0 gap-4 border-t border-slate-200 p-4 dark:border-slate-800 md:p-5">
        {children}
      </div>
    </details>
  );
}
