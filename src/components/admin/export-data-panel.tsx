"use client";

import { Download, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

import {
  EXPORT_DATASET_OPTIONS,
  EXPORT_FORMAT_OPTIONS,
  type ExportDatasetId,
  type ExportFormat,
} from "@/lib/export-data";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

type BusyAction = "selected" | "all" | null;

function parseFileNameFromDisposition(
  contentDisposition: string | null,
  fallbackName: string,
) {
  if (!contentDisposition) {
    return fallbackName;
  }

  const utfMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    return decodeURIComponent(utfMatch[1]);
  }

  const match = contentDisposition.match(/filename="?([^"]+)"?/i);
  if (match?.[1]) {
    return match[1];
  }

  return fallbackName;
}

export function ExportDataPanel() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [selectedDatasets, setSelectedDatasets] = useState<ExportDatasetId[]>(
    () => ["work_instructions", "work_items", "instruction_change_events"],
  );
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function toggleDataset(datasetId: ExportDatasetId) {
    setSelectedDatasets((current) =>
      current.includes(datasetId)
        ? current.filter((entry) => entry !== datasetId)
        : [...current, datasetId],
    );
  }

  async function downloadExport(exportAll: boolean) {
    setBusyAction(exportAll ? "all" : "selected");
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Missing session token. Please sign in again.");
      }

      if (!exportAll && selectedDatasets.length === 0) {
        throw new Error("Select at least one dataset before exporting.");
      }

      const response = await fetch("/api/admin/export-data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          format,
          datasets: exportAll ? [] : selectedDatasets,
          exportAll,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Unable to export data.");
      }

      const exportBlob = await response.blob();
      const fallbackFileName = `export.${format}`;
      const fileName = parseFileNameFromDisposition(
        response.headers.get("content-disposition"),
        fallbackFileName,
      );
      const objectUrl = window.URL.createObjectURL(exportBlob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(objectUrl);

      setStatusMessage(
        exportAll
          ? "Exported all available datasets."
          : `Exported ${selectedDatasets.length} dataset${
              selectedDatasets.length === 1 ? "" : "s"
            }.`,
      );
    } catch (caughtError) {
      setErrorMessage(
        caughtError instanceof Error ? caughtError.message : "Unable to export data.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="grid gap-4 rounded-3xl border border-white/20 bg-white/70 p-5 shadow-xl backdrop-blur-sm dark:border-white/10 dark:bg-slate-900/55">
      <header className="grid gap-1">
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Export Data</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Select datasets and format, then export selected data or a full export package.
        </p>
      </header>

      {errorMessage ? (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200">
          {errorMessage}
        </p>
      ) : null}

      {statusMessage ? (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
          {statusMessage}
        </p>
      ) : null}

      <section className="grid gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Data Sets
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {EXPORT_DATASET_OPTIONS.map((dataset) => {
            const selected = selectedDatasets.includes(dataset.id);
            return (
              <label
                key={dataset.id}
                className={cn(
                  "grid cursor-pointer gap-1 rounded-xl border px-3 py-2 transition",
                  selected
                    ? "border-cyan-500/45 bg-cyan-500/12"
                    : "border-slate-300/70 bg-white/70 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/50 dark:hover:bg-slate-900",
                )}
              >
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleDataset(dataset.id)}
                    className="h-4 w-4 rounded border-slate-400 accent-cyan-600"
                  />
                  {dataset.label}
                </span>
                <span className="text-xs text-slate-600 dark:text-slate-300">
                  {dataset.description}
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="grid gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Format
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {EXPORT_FORMAT_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFormat(option.id)}
              className={cn(
                "grid gap-0.5 rounded-xl border px-3 py-2 text-left transition",
                format === option.id
                  ? "border-cyan-500/45 bg-cyan-500/15 text-cyan-900 dark:text-cyan-100"
                  : "border-slate-300/70 bg-white/70 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-200 dark:hover:bg-slate-900",
              )}
            >
              <span className="text-sm font-semibold">{option.label}</span>
              <span className="text-xs opacity-80">{option.description}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={busyAction !== null}
          onClick={() => void downloadExport(false)}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-500/45 bg-cyan-500/15 px-4 py-2.5 text-sm font-semibold text-cyan-900 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60 dark:text-cyan-100"
        >
          {busyAction === "selected" ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          Export Selected
        </button>
        <button
          type="button"
          disabled={busyAction !== null}
          onClick={() => void downloadExport(true)}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-violet-500/45 bg-violet-500/15 px-4 py-2.5 text-sm font-semibold text-violet-900 transition hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-60 dark:text-violet-100"
        >
          {busyAction === "all" ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          Export All
        </button>
      </div>
    </div>
  );
}
