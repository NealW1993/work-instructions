"use client";

import { CheckSquare, ChevronDown, Wrench, X } from "lucide-react";
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

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
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

  function clearCheckedTools() {
    setCheckedToolIds([]);
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition",
          open
            ? "border-cyan-500/45 bg-cyan-500/20 text-cyan-900 dark:text-cyan-100"
            : "border-cyan-500/30 bg-cyan-500/10 text-cyan-800 hover:bg-cyan-500/20 dark:text-cyan-200",
        )}
        aria-expanded={open}
      >
        <Wrench size={14} />
        Tool List
        <span className="inline-flex items-center gap-0.5 rounded-full border border-cyan-500/45 bg-cyan-500/15 px-1.5 py-0.5 text-[10px]">
          <span>{totalCount}</span>
          <X size={10} aria-hidden="true" className="opacity-80" />
        </span>
        <ChevronDown
          size={14}
          className={cn("transition", open ? "rotate-180" : "rotate-0")}
        />
      </button>

      {open ? (
        <div className="absolute right-0 z-40 mt-2 grid w-[min(24rem,90vw)] gap-3 rounded-xl border border-slate-300/80 bg-white/95 p-3 shadow-2xl backdrop-blur-xl dark:border-slate-700/80 dark:bg-slate-900/95">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Check List
            </p>
            <button
              type="button"
              onClick={clearCheckedTools}
              className="rounded-lg border border-slate-400/45 px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-200/60 dark:text-slate-200 dark:hover:bg-slate-700/70"
            >
              Clear
            </button>
          </div>

          {sortedTools.length === 0 ? (
            <p className="rounded-lg border border-slate-300/70 bg-slate-100/80 px-2.5 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
              No tools in this list yet.
            </p>
          ) : (
            <div className="grid max-h-72 gap-2 overflow-y-auto pr-1">
              {sortedTools.map((tool) => (
                <label
                  key={tool.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300/70 bg-slate-100/70 px-2.5 py-1.5 text-xs text-slate-700 transition hover:bg-slate-200/70 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-800/70"
                >
                  <input
                    type="checkbox"
                    checked={checkedToolIds.includes(tool.id)}
                    onChange={() => handleToolToggle(tool.id)}
                    className="h-4 w-4 rounded border-slate-400 text-cyan-600 focus:ring-cyan-500"
                  />
                  <span className="flex-1">{tool.name}</span>
                  {checkedToolIds.includes(tool.id) ? (
                    <CheckSquare size={13} className="text-emerald-600 dark:text-emerald-300" />
                  ) : null}
                </label>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
