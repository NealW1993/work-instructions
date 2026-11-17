"use client";

import { CheckSquare, ChevronDown, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface SuggestedToolOption {
  id: string;
  name: string;
  categoryName: string;
  subcategoryName: string | null;
}

interface SuggestedToolsDropdownProps {
  tools: SuggestedToolOption[];
  className?: string;
}

/** The tools an operator needs for the job, as a checklist to tick off while gathering them. */
export function SuggestedToolsDropdown({ tools, className }: SuggestedToolsDropdownProps) {
  const [open, setOpen] = useState(false);
  const [checkedToolIds, setCheckedToolIds] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const sortedTools = useMemo(() => {
    return [...tools].sort((first, second) => first.name.localeCompare(second.name));
  }, [tools]);

  const totalCount = tools.length;

  function handleToolToggle(toolId: string) {
    setCheckedToolIds((current) =>
      current.includes(toolId)
        ? current.filter((currentToolId) => currentToolId !== toolId)
        : [...current, toolId],
    );
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={`Tools needed: ${totalCount}`}
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition",
          open
            ? "border-slate-400 bg-slate-100 text-slate-950 dark:border-slate-500 dark:bg-slate-800 dark:text-white"
            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800",
        )}
      >
        <Wrench size={15} aria-hidden="true" />
        <span aria-hidden="true">Tools</span>
        <span aria-hidden="true" className="rounded bg-slate-200/80 px-1.5 py-0.5 text-xs font-bold tabular-nums text-slate-700 dark:bg-slate-700 dark:text-slate-100">
          {totalCount}
        </span>
        <ChevronDown size={14} aria-hidden="true" className={cn("transition", open ? "rotate-180" : "rotate-0")} />
      </button>

      {open ? (
        <div className="fixed inset-x-4 bottom-4 z-40 grid max-h-[calc(100dvh-2rem)] gap-3 overflow-hidden rounded-lg border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900 sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-[calc(100%+0.5rem)] sm:w-[min(24rem,90vw)] sm:max-h-none">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Tools needed</p>
            {checkedToolIds.length > 0 ? (
              <button
                type="button"
                onClick={() => setCheckedToolIds([])}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Clear ticks
              </button>
            ) : null}
          </div>

          {sortedTools.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 px-2.5 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
              No tools are listed for this instruction.
            </p>
          ) : (
            <>
              <p className="text-xs text-slate-500 dark:text-slate-400">Tick each tool as you collect it.</p>
              <div className="grid max-h-[min(18rem,calc(100dvh-10rem))] gap-1.5 overflow-y-auto pr-1 sm:max-h-72">
                {sortedTools.map((tool) => (
                  <label
                    key={tool.id}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    <input
                      type="checkbox"
                      checked={checkedToolIds.includes(tool.id)}
                      onChange={() => handleToolToggle(tool.id)}
                      className="h-5 w-5 rounded border-slate-400 text-cyan-600 focus:ring-cyan-500"
                    />
                    <span className="flex-1">{tool.name}</span>
                    {checkedToolIds.includes(tool.id) ? (
                      <CheckSquare size={15} aria-hidden="true" className="text-emerald-600 dark:text-emerald-300" />
                    ) : null}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
