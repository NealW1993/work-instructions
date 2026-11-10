"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  BarChart3,
  Check,
  CheckCircle2,
  LayoutGrid,
  Loader2,
  Minus,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { useId, useState } from "react";

import type { DashboardLayoutStudioWidgetState } from "@/lib/dashboard-controls";
import type { DashboardWidgetId, DashboardWidgetSize } from "@/lib/dashboard-layout";
import { cn } from "@/lib/utils";

export interface DashboardStudioPreset {
  id: string;
  label: string;
  description?: string;
}

export interface DashboardLayoutStudioProps {
  widgets: DashboardLayoutStudioWidgetState[];
  presets: DashboardStudioPreset[];
  activePresetId: string | null;
  hasUnsavedChanges: boolean;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  error?: string | null;
  notice?: string | null;
  onSetVisibility: (id: DashboardWidgetId, visible: boolean) => void;
  onSizeChange: (id: DashboardWidgetId, size: DashboardWidgetSize) => void;
  onMove: (id: DashboardWidgetId, direction: "up" | "down" | "top") => void;
  onPreset: (id: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onLoadDefault?: () => void;
  onSaveDefault?: () => void;
}

const SIZE_OPTIONS: { value: DashboardWidgetSize; label: string; span: number }[] = [
  { value: "compact", label: "1/3 width", span: 2 },
  { value: "standard", label: "1/2 width", span: 3 },
  { value: "wide", label: "2/3 width", span: 4 },
  { value: "full", label: "Full width", span: 6 },
];

const PRESET_DESCRIPTIONS: Record<string, string> = {
  balanced: "Search, pinned work, reviews and recent activity in one workspace.",
  operations_live: "Activity and recent changes first, with quick access to daily work.",
  compact_grid: "Smaller cards keep more work and review summaries in view.",
  audit_review: "History, document changes and review queues take priority.",
};

const BUTTON_CLASS = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800";
const SMALL_BUTTON_CLASS = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-2 text-slate-600 transition hover:border-cyan-500 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-35 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-cyan-950/40";

export function DashboardLayoutStudio({
  widgets,
  presets,
  activePresetId,
  hasUnsavedChanges,
  busy,
  canUndo,
  canRedo,
  error,
  notice,
  onSetVisibility,
  onSizeChange,
  onMove,
  onPreset,
  onSave,
  onCancel,
  onUndo,
  onRedo,
  onReset,
  onLoadDefault,
  onSaveDefault,
}: DashboardLayoutStudioProps) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | "core" | "kpi">("all");
  const [availability, setAvailability] = useState<"all" | "added" | "available">("all");
  const visibleWidgets = widgets.filter((widget) => widget.visible);
  const availableCount = widgets.length - visibleWidgets.length;
  const searchTerm = search.trim().toLocaleLowerCase();
  const filteredWidgets = widgets.filter((widget) =>
    (category === "all" || widget.category === category) &&
    (availability === "all" || widget.visible === (availability === "added")) &&
    (!searchTerm || `${widget.title} ${widget.description}`.toLocaleLowerCase().includes(searchTerm)),
  );
  const statusLabel = busy ? "Saving layout…" : error ? "Save failed" : hasUnsavedChanges ? "Unsaved changes" : "Layout saved";
  const StatusIcon = busy ? Loader2 : error ? TriangleAlert : hasUnsavedChanges ? SlidersHorizontal : CheckCircle2;

  return (
    <section
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      aria-busy={busy}
      data-dashboard-layout-studio="true"
      className="min-w-0 overflow-clip rounded-2xl border border-cyan-300/80 bg-white shadow-sm dark:border-cyan-800 dark:bg-slate-950"
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-br from-cyan-50 via-white to-slate-50 p-4 sm:p-5 dark:border-slate-800 dark:from-cyan-950/35 dark:via-slate-950 dark:to-slate-900">
        <div className="min-w-0 max-w-2xl">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-800 dark:text-cyan-300">
            <SlidersHorizontal size={15} aria-hidden="true" />
            Your workspace
          </div>
          <h2 id={`${id}-title`} tabIndex={-1} className="text-xl font-bold text-slate-950 sm:text-2xl dark:text-slate-100">Customize homepage</h2>
          <p id={`${id}-description`} className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Choose the widgets you need, set their width and arrange their order. Preview changes below, then save your layout.
          </p>
        </div>
        <div role="status" aria-live="polite" aria-atomic="true" className={cn(
          "inline-flex min-h-10 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold",
          error ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200" :
            hasUnsavedChanges ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" :
              "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
        )}>
          <StatusIcon size={15} className={busy ? "animate-spin" : undefined} aria-hidden="true" />
          {statusLabel}
        </div>
      </header>

      <div className="grid min-w-0 gap-5 p-4 sm:p-5">
        {error ? <p role="alert" className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{error} Your changes are still available to retry.</p> : null}
        {notice && !error && !hasUnsavedChanges ? <p role="status" className="text-sm text-emerald-800 dark:text-emerald-300">{notice}</p> : null}

        <details open={visibleWidgets.length === 0 ? true : undefined} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <summary className="min-h-11 cursor-pointer text-sm font-semibold text-slate-900 dark:text-slate-100">
            Start with a layout <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">{presets.find((preset) => preset.id === activePresetId)?.label ?? "Choose a preset"}</span>
          </summary>
          <div className="mb-3 mt-1 flex flex-wrap items-baseline justify-between gap-2">
            <h3 id={`${id}-presets`} className="font-bold text-slate-900 dark:text-slate-100">Suggested layouts</h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">Presets can be changed before saving</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
            {presets.map((preset) => {
              const active = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={active}
                  aria-label={`Use ${preset.label} layout`}
                  disabled={busy}
                  onClick={() => onPreset(preset.id)}
                  className={cn(
                    "flex min-h-24 min-w-0 items-start gap-3 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45",
                    active ? "border-cyan-600 bg-cyan-50 ring-1 ring-cyan-600 dark:border-cyan-500 dark:bg-cyan-950/40 dark:ring-cyan-500" : "border-slate-200 bg-slate-50/70 hover:border-cyan-400 hover:bg-cyan-50/50 dark:border-slate-700 dark:bg-slate-900/50 dark:hover:border-cyan-700",
                  )}
                >
                  <span className={cn("mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", active ? "bg-cyan-600 text-white dark:bg-cyan-500 dark:text-slate-950" : "bg-white text-slate-500 dark:bg-slate-800 dark:text-slate-300")}>
                    {active ? <Check size={17} aria-hidden="true" /> : <LayoutGrid size={17} aria-hidden="true" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-slate-900 dark:text-slate-100">{preset.label}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-slate-600 dark:text-slate-300">{preset.description ?? PRESET_DESCRIPTIONS[preset.id] ?? "Use this arrangement as a starting point for your homepage."}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </details>

        <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section aria-labelledby={`${id}-library`} className="grid min-w-0 gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4 dark:border-slate-800 dark:bg-slate-900/30">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 id={`${id}-library`} className="font-bold text-slate-900 dark:text-slate-100">Widget library</h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Add work tools and manufacturing insights.</p>
              </div>
              <p className="flex flex-wrap gap-2 text-xs font-semibold">
                <span className="rounded-full bg-cyan-100 px-2 py-1 text-cyan-900 dark:bg-cyan-950 dark:text-cyan-200">{visibleWidgets.length} added</span>
                <span className="rounded-full bg-slate-200/80 px-2 py-1 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{availableCount} available</span>
              </p>
            </div>
            <label className="relative block">
              <span className="sr-only">Search widgets</span>
              <Search size={17} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" aria-hidden="true" />
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a widget…" className="min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div role="group" aria-label="Widget category" className="flex flex-wrap gap-1">
                {([{ value: "all", label: "All" }, { value: "core", label: "Work" }, { value: "kpi", label: "Insights" }] as const).map((option) => (
                  <button key={option.value} type="button" aria-pressed={category === option.value} onClick={() => setCategory(option.value)} className={cn("min-h-11 rounded-lg border px-3 py-2 text-xs font-semibold transition", category === option.value ? "border-slate-900 bg-slate-900 text-white dark:border-slate-200 dark:bg-slate-100 dark:text-slate-900" : "border-transparent text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800")}>
                    {option.label} <span className="ml-1 opacity-65">{option.value === "all" ? widgets.length : widgets.filter((widget) => widget.category === option.value).length}</span>
                  </button>
                ))}
              </div>
              <label className="flex min-w-0 items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <span>Show</span>
                <select aria-label="Widget availability" value={availability} onChange={(event) => setAvailability(event.target.value as typeof availability)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                  <option value="all">All widgets</option>
                  <option value="added">Added ({visibleWidgets.length})</option>
                  <option value="available">Available ({availableCount})</option>
                </select>
              </label>
            </div>
            <p role="status" className="text-xs text-slate-500 dark:text-slate-400">{filteredWidgets.length} {filteredWidgets.length === 1 ? "widget" : "widgets"} shown</p>
            <div className="grid max-h-[34rem] min-w-0 gap-2 overflow-y-auto overscroll-contain pr-1">
              {filteredWidgets.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center dark:border-slate-700">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No widgets match these filters</p>
                  <button type="button" onClick={() => { setSearch(""); setCategory("all"); setAvailability("all"); }} className="mt-2 min-h-11 rounded-lg px-3 py-2 text-sm font-semibold text-cyan-800 underline underline-offset-4 dark:text-cyan-300">Clear filters</button>
                </div>
              ) : filteredWidgets.map((widget) => (
                <article key={widget.id} className={cn("flex min-w-0 flex-wrap items-center gap-3 rounded-lg border bg-white p-3 dark:bg-slate-950", widget.visible ? "border-cyan-200 dark:border-cyan-900" : "border-slate-200 dark:border-slate-800")}>
                  <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 sm:inline-flex dark:bg-slate-800 dark:text-slate-400">{widget.category === "kpi" ? <BarChart3 size={17} aria-hidden="true" /> : <LayoutGrid size={17} aria-hidden="true" />}</span>
                  <div className="min-w-0 flex-1 basis-40">
                    <h4 className="break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{widget.title}</h4>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{widget.description}</p>
                  </div>
                  <button type="button" aria-label={`${widget.visible ? "Remove" : "Add"} ${widget.title}`} disabled={busy} onClick={() => onSetVisibility(widget.id, !widget.visible)} className={cn("inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-45", widget.visible ? "border-slate-300 bg-white text-slate-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-rose-800 dark:hover:bg-rose-950/40 dark:hover:text-rose-200" : "border-cyan-600 bg-cyan-600 text-white hover:bg-cyan-700 dark:border-cyan-500 dark:bg-cyan-500 dark:text-slate-950 dark:hover:bg-cyan-400")}>
                    {widget.visible ? <Minus size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
                    {widget.visible ? "Remove" : "Add"}
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby={`${id}-arrange`} className="grid min-w-0 gap-3 rounded-xl border border-slate-200 p-3 sm:p-4 dark:border-slate-800">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id={`${id}-arrange`} className="font-bold text-slate-900 dark:text-slate-100">Arrange your homepage</h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">{visibleWidgets.length} {visibleWidgets.length === 1 ? "widget" : "widgets"}</span>
            </div>
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">Read from top to bottom. Widths apply on large screens; cards stack on phones.</p>
            <details className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60" open>
              <summary className="min-h-11 cursor-pointer px-3 py-3 text-xs font-semibold text-slate-700 dark:text-slate-300">Large-screen preview</summary>
              <div aria-hidden="true" className="grid grid-cols-6 gap-1.5 border-t border-slate-200 p-2 dark:border-slate-700">
                {visibleWidgets.length === 0 ? <span className="col-span-6 px-2 py-4 text-center text-xs text-slate-500 dark:text-slate-400">Add a widget to start your layout</span> : visibleWidgets.map((widget, index) => (
                  <div key={widget.id} style={{ gridColumn: `span ${SIZE_OPTIONS.find((option) => option.value === widget.size)?.span ?? 6}` }} className={cn("flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-2", widget.category === "kpi" ? "border-violet-200 bg-violet-100/70 text-violet-950 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200" : "border-cyan-200 bg-cyan-100/70 text-cyan-950 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-200")}>
                    <span className="shrink-0 text-[10px] font-bold opacity-65">{index + 1}</span><span className="truncate text-[10px] font-medium">{widget.title}</span>
                  </div>
                ))}
              </div>
            </details>
            {visibleWidgets.length === 0 ? <p className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">Your homepage is empty. Add widgets from the library or choose a preset.</p> : (
              <ol className="grid max-h-[34rem] min-w-0 gap-2 overflow-y-auto overscroll-contain pr-1" aria-label="Homepage widget order">
                {visibleWidgets.map((widget, index) => (
                  <li key={widget.id} data-studio-widget-id={widget.id} className="grid min-w-0 gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 px-1 text-xs font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400" aria-label={`Position ${index + 1}`}>{index + 1}</span>
                      <h4 className="min-w-0 break-words pt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">{widget.title}</h4>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-end justify-between gap-2">
                      <label className="grid min-w-0 gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Width
                        <select aria-label={`Width of ${widget.title}`} value={widget.size} disabled={busy} onChange={(event) => onSizeChange(widget.id, event.target.value as DashboardWidgetSize)} className="min-h-11 rounded-lg border border-slate-300 bg-slate-50 px-2 text-sm font-semibold text-slate-700 disabled:opacity-45 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                          {SIZE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                      <div role="group" aria-label={`Position ${widget.title}`} className="flex flex-wrap gap-1">
                        <button type="button" aria-label={`Move ${widget.title} to top`} disabled={busy || index === 0} onClick={() => onMove(widget.id, "top")} className={cn(SMALL_BUTTON_CLASS, "gap-1 text-[11px] font-semibold")}><ArrowUpToLine size={15} aria-hidden="true" />Top</button>
                        <button type="button" aria-label={`Move ${widget.title} up`} disabled={busy || index === 0} onClick={() => onMove(widget.id, "up")} className={cn(SMALL_BUTTON_CLASS, "gap-1 text-[11px] font-semibold")}><ArrowUp size={15} aria-hidden="true" />Up</button>
                        <button type="button" aria-label={`Move ${widget.title} down`} disabled={busy || index === visibleWidgets.length - 1} onClick={() => onMove(widget.id, "down")} className={cn(SMALL_BUTTON_CLASS, "gap-1 text-[11px] font-semibold")}><ArrowDown size={15} aria-hidden="true" />Down</button>
                        <button type="button" aria-label={`Remove ${widget.title} from layout`} disabled={busy} onClick={() => onSetVisibility(widget.id, false)} className={cn(SMALL_BUTTON_CLASS, "gap-1 text-[11px] font-semibold")}><X size={15} aria-hidden="true" />Remove</button>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onUndo} disabled={busy || !canUndo} className={BUTTON_CLASS}><Undo2 size={16} aria-hidden="true" />Undo</button>
            <button type="button" onClick={onRedo} disabled={busy || !canRedo} className={BUTTON_CLASS}><Redo2 size={16} aria-hidden="true" />Redo</button>
            <button type="button" onClick={onReset} disabled={busy} className={BUTTON_CLASS} title="Stage the default Plant floor layout; save to keep it"><RotateCcw size={16} aria-hidden="true" />Reset layout</button>
          </div>
          {onLoadDefault || onSaveDefault ? <div className="flex flex-wrap gap-2">
            {onLoadDefault ? <button type="button" onClick={onLoadDefault} disabled={busy} className={BUTTON_CLASS}>Load my default</button> : null}
            {onSaveDefault ? <button type="button" onClick={onSaveDefault} disabled={busy} className={BUTTON_CLASS}>Save as my default</button> : null}
          </div> : null}
        </div>
      </div>

      <footer className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 shadow-[0_-4px_18px_rgb(15_23_42/0.06)] sm:px-5 dark:border-slate-800 dark:bg-slate-900">
        <p className="max-w-xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">{hasUnsavedChanges ? "Your changes are a preview. Save to use this layout next time." : "Your saved layout follows your account across devices."}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className={BUTTON_CLASS}>Cancel</button>
          <button type="button" onClick={onSave} disabled={busy || !hasUnsavedChanges} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-cyan-700 bg-cyan-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-45 dark:border-cyan-500 dark:bg-cyan-500 dark:text-slate-950 dark:hover:bg-cyan-400">
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
            {busy ? "Saving…" : "Save layout"}
          </button>
        </div>
      </footer>
    </section>
  );
}
