"use client";

import { useRouter } from "next/navigation";
import { ArchiveRestore, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { InstructionBackButton } from "@/components/instructions/instruction-back-button";
import { LocalDateTime } from "@/components/ui/local-date-time";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

interface ArchivedInstructionWorkItemSummary {
  department_name: string;
  part_number: string;
  mold_number: string | null;
  item_title: string;
}

export interface ArchivedInstructionListItem {
  id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  creator_name: string;
  updated_by_name: string;
  workItem: ArchivedInstructionWorkItemSummary;
}

interface ArchivedInstructionsPanelProps {
  initialInstructions: ArchivedInstructionListItem[];
}

interface DepartmentFilterOption {
  name: string;
  count: number;
}

function getPrimaryPartOrMoldLabel(workItem: ArchivedInstructionWorkItemSummary) {
  const mold = workItem.mold_number?.trim();
  if (mold) {
    return `Mold # ${mold}`;
  }

  const part = workItem.part_number?.trim();
  if (part) {
    return `Part # ${part}`;
  }

  return "Part # N/A";
}

function normalizeSearchValue(instruction: ArchivedInstructionListItem) {
  return [
    instruction.workItem.department_name,
    instruction.workItem.part_number,
    instruction.workItem.mold_number ?? "",
    instruction.workItem.item_title,
    instruction.creator_name,
    instruction.updated_by_name,
    `revision ${instruction.revision}`,
  ]
    .join(" ")
    .toLowerCase();
}

export function ArchivedInstructionsPanel({
  initialInstructions,
}: ArchivedInstructionsPanelProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [portalReady, setPortalReady] = useState(false);
  const [instructions, setInstructions] = useState(initialInstructions);
  const [query, setQuery] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [busyInstructionId, setBusyInstructionId] = useState<string | null>(null);
  const [confirmInstruction, setConfirmInstruction] =
    useState<ArchivedInstructionListItem | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const departmentOptions = useMemo(() => {
    const departmentCounts = new Map<string, number>();

    for (const instruction of instructions) {
      const key = instruction.workItem.department_name || "Unknown";
      departmentCounts.set(key, (departmentCounts.get(key) ?? 0) + 1);
    }

    return Array.from(departmentCounts.entries())
      .map(
        ([name, count]) =>
          ({
            name,
            count,
          }) satisfies DepartmentFilterOption,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [instructions]);

  const filteredInstructions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return instructions.filter((instruction) => {
      if (
        selectedDepartment !== "all" &&
        instruction.workItem.department_name !== selectedDepartment
      ) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return normalizeSearchValue(instruction).includes(normalizedQuery);
    });
  }, [instructions, query, selectedDepartment]);

  async function handleRestore(instruction: ArchivedInstructionListItem) {
    setBusyInstructionId(instruction.id);
    setError(null);
    setMessage(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Missing session token. Please sign in again.");
      }

      const response = await fetch(`/api/instructions/${instruction.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to restore instruction.");
      }

      setInstructions((current) => current.filter((entry) => entry.id !== instruction.id));
      setConfirmInstruction(null);
      setMessage("Instruction restored to active status.");
      router.refresh();
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to restore instruction.";
      setError(normalizedMessage);
    } finally {
      setBusyInstructionId(null);
    }
  }

  return (
    <div className="grid gap-5">
      <InstructionBackButton fallbackHref="/dashboard" />

      <section className="grid gap-4 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7">
        <div className="grid gap-2">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
              Archived Work Instructions
            </h1>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_260px]">
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Search Archived Instructions</span>
            <div className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={query}
                autoComplete="off"
                spellCheck={false}
                placeholder="Search by part, mold, title, department, or user"
                onChange={(event) => setQuery(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Department</span>
            <select
              value={selectedDepartment}
              onChange={(event) => setSelectedDepartment(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="all">All Departments ({instructions.length})</option>
              {departmentOptions.map((department) => (
                <option key={department.name} value={department.name}>
                  {department.name} ({department.count})
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {message ? (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-200">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      {filteredInstructions.length === 0 ? (
        <section className="rounded-3xl border border-white/30 bg-white/80 p-6 text-sm text-slate-600 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 dark:text-slate-300">
          {instructions.length === 0
            ? "No archived instructions found."
            : "No archived instructions match your current filters."}
        </section>
      ) : (
        <section className="grid gap-3 md:grid-cols-2">
          {filteredInstructions.map((instruction) => (
            <article
              key={instruction.id}
              className="grid gap-3 rounded-2xl border border-white/30 bg-white/80 p-4 shadow-lg transition hover:-translate-y-0.5 hover:border-cyan-500/40 hover:shadow-2xl dark:border-white/10 dark:bg-slate-900/70"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    {getPrimaryPartOrMoldLabel(instruction.workItem)} |{" "}
                    {instruction.workItem.department_name}
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {instruction.workItem.item_title}
                  </p>
                </div>
                <span className="rounded-full border border-amber-500/35 bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-200">
                  Archived
                </span>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                Revision {instruction.revision} | Created{" "}
                <LocalDateTime value={instruction.created_at} mode="date" /> by{" "}
                {instruction.creator_name}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Archived <LocalDateTime value={instruction.updated_at} mode="dateTime" /> by{" "}
                {instruction.updated_by_name}
              </p>

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={Boolean(busyInstructionId)}
                  onClick={() => {
                    setError(null);
                    setMessage(null);
                    setConfirmInstruction(instruction);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/45 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-cyan-100"
                >
                  <ArchiveRestore size={14} />
                  Restore
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {confirmInstruction && portalReady
        ? createPortal(
            <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
              <div className="grid w-full max-w-md gap-4 rounded-2xl border border-cyan-500/45 bg-slate-950/95 p-5 shadow-2xl">
                <div className="grid gap-1">
                  <h3 className="text-lg font-bold text-slate-100">Restore Instruction?</h3>
                  <p className="text-sm text-slate-300">
                    {getPrimaryPartOrMoldLabel(confirmInstruction.workItem)} |{" "}
                    {confirmInstruction.workItem.department_name}
                  </p>
                  <p className="text-sm text-slate-300">
                    This will make it visible again on dashboard, search, and pinned views.
                  </p>
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    disabled={Boolean(busyInstructionId)}
                    onClick={() => setConfirmInstruction(null)}
                    className="rounded-xl border border-slate-600 bg-slate-900/70 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busyInstructionId === confirmInstruction.id}
                    onClick={() => void handleRestore(confirmInstruction)}
                    className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/50 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {busyInstructionId === confirmInstruction.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <ArchiveRestore size={14} />
                    )}
                    Restore
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
