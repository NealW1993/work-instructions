"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArchiveRestore, Eye, Loader2, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { InstructionBackButton } from "@/components/instructions/instruction-back-button";
import { LocalDateTime } from "@/components/ui/local-date-time";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

interface ArchivedInstructionWorkItemSummary {
  department_name: string;
  part_id: string;
  item_title: string;
}

export interface ArchivedInstructionListItem {
  id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  creator_name: string;
  updated_by_name: string;
  fork_number: number | null;
  workItem: ArchivedInstructionWorkItemSummary;
}

interface ArchivedInstructionsPanelProps {
  initialInstructions: ArchivedInstructionListItem[];
}

interface DepartmentFilterOption {
  name: string;
  count: number;
}

interface RestoreConflictPayload {
  existingInstructionId: string;
  existingRevision: number;
  restoringRevision: number;
  hasNewerRevision: boolean;
}

interface RestoreConflictModalState {
  instruction: ArchivedInstructionListItem;
  conflict: RestoreConflictPayload;
}

interface RestoreResponsePayload {
  error?: string;
  conflict?: RestoreConflictPayload;
  swappedOutInstructionIds?: string[];
}

function getPartIdLabel(workItem: ArchivedInstructionWorkItemSummary) {
  const partId = workItem.part_id?.trim();
  if (!partId) {
    return "N/A";
  }

  return partId;
}

function ArchivedCardHeading({ workItem }: { workItem: ArchivedInstructionWorkItemSummary }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
        {getPartIdLabel(workItem)}
      </span>
      <span className="text-base font-semibold text-slate-600 dark:text-slate-300">
        | {workItem.department_name}
      </span>
    </span>
  );
}

function normalizeSearchValue(instruction: ArchivedInstructionListItem) {
  return [
    instruction.workItem.department_name,
    instruction.workItem.part_id,
    instruction.workItem.item_title,
    instruction.creator_name,
    instruction.updated_by_name,
    `revision ${instruction.revision}`,
    instruction.fork_number ? `fork ${instruction.fork_number}` : "",
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
  const [selectedInstructionIds, setSelectedInstructionIds] = useState<string[]>([]);

  const [busyInstructionId, setBusyInstructionId] = useState<string | null>(null);

  const [confirmInstruction, setConfirmInstruction] =
    useState<ArchivedInstructionListItem | null>(null);
  const [restoreConflictModal, setRestoreConflictModal] =
    useState<RestoreConflictModalState | null>(null);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    setSelectedInstructionIds((current) =>
      current.filter((id) => instructions.some((instruction) => instruction.id === id)),
    );
  }, [instructions]);

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

  const selectedInstructionIdSet = useMemo(
    () => new Set(selectedInstructionIds),
    [selectedInstructionIds],
  );
  const selectedCount = selectedInstructionIds.length;
  const allFilteredSelected =
    filteredInstructions.length > 0 &&
    filteredInstructions.every((instruction) => selectedInstructionIdSet.has(instruction.id));
  const anyActionBusy = Boolean(busyInstructionId);

  function toggleInstructionSelection(instructionId: string) {
    setSelectedInstructionIds((current) => {
      if (current.includes(instructionId)) {
        return current.filter((id) => id !== instructionId);
      }
      return [...current, instructionId];
    });
  }

  function toggleSelectAllFiltered() {
    if (filteredInstructions.length === 0) {
      return;
    }

    setSelectedInstructionIds((current) => {
      const currentSet = new Set(current);
      const filteredIds = filteredInstructions.map((instruction) => instruction.id);
      const isFullySelected = filteredIds.every((id) => currentSet.has(id));

      if (isFullySelected) {
        return current.filter((id) => !filteredIds.includes(id));
      }

      for (const id of filteredIds) {
        currentSet.add(id);
      }

      return [...currentSet];
    });
  }

  async function handleRestore(
    instruction: ArchivedInstructionListItem,
    options?: { forceSwap?: boolean },
  ) {
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
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          forceSwap: options?.forceSwap === true,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as RestoreResponsePayload;

      if (response.status === 409 && payload.conflict) {
        setConfirmInstruction(null);
        setRestoreConflictModal({
          instruction,
          conflict: payload.conflict,
        });
        return;
      }

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to restore instruction.");
      }

      setInstructions((current) => current.filter((entry) => entry.id !== instruction.id));
      setSelectedInstructionIds((current) => current.filter((id) => id !== instruction.id));
      setConfirmInstruction(null);
      setRestoreConflictModal(null);

      if ((payload.swappedOutInstructionIds?.length ?? 0) > 0 || options?.forceSwap) {
        setMessage("Instruction restored and the currently active revision was archived.");
      } else {
        setMessage("Instruction restored to active status.");
      }

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
      <section className="grid gap-4 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7">
        <header className="flex flex-wrap items-start gap-3">
          <InstructionBackButton fallbackHref="/dashboard" />
          <div className="grid min-w-0 gap-1">
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
              Archived Work Instructions
            </h1>
          </div>
        </header>

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
                placeholder="Search by Part ID, title, department, or user"
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

      <section className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/30 bg-white/75 p-3 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            disabled={filteredInstructions.length === 0 || anyActionBusy}
            onClick={toggleSelectAllFiltered}
            className="rounded-lg border border-slate-400/40 bg-slate-900/10 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-900/15 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-200 dark:hover:bg-white/10"
          >
            {allFilteredSelected ? "Clear shown selection" : "Select all shown"}
          </button>
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            {selectedCount} selected
          </span>
        </div>

        <button
          type="button"
          disabled
          title="Permanent deletion is disabled for ISO document-control retention."
          className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl border border-slate-400/45 bg-slate-500/10 px-3 py-1.5 text-xs font-semibold text-slate-600 opacity-70 dark:text-slate-300"
        >
          <Trash2 size={14} />
          Retention Locked
        </button>
      </section>

      {filteredInstructions.length === 0 ? (
        <section className="rounded-3xl border border-white/30 bg-white/80 p-6 text-sm text-slate-600 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 dark:text-slate-300">
          {instructions.length === 0
            ? "No archived instructions found."
            : "No archived instructions match your current filters."}
        </section>
      ) : (
        <section className="grid gap-3 md:grid-cols-2">
          {filteredInstructions.map((instruction) => {
            const checked = selectedInstructionIdSet.has(instruction.id);
            const restoringThisInstruction = busyInstructionId === instruction.id;

            return (
              <article
                key={instruction.id}
                className="grid gap-3 rounded-2xl border border-white/30 bg-white/80 p-4 shadow-lg transition hover:-translate-y-0.5 hover:border-cyan-500/40 hover:shadow-2xl dark:border-white/10 dark:bg-slate-900/70"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p>
                      <ArchivedCardHeading workItem={instruction.workItem} />
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      {instruction.workItem.item_title}
                    </p>
                  </div>
                  <div className="grid justify-items-end gap-2">
                    <span className="rounded-full border border-amber-500/35 bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-200">
                      Archived
                    </span>
                    {instruction.fork_number ? (
                      <span className="rounded-full border border-cyan-500/35 bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-800 dark:text-cyan-200">
                        Fork {instruction.fork_number}
                      </span>
                    ) : null}
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-400/35 bg-slate-900/8 px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-900/12 dark:text-slate-200 dark:hover:bg-white/10">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={anyActionBusy}
                        onChange={() => toggleInstructionSelection(instruction.id)}
                        className="h-3.5 w-3.5 rounded border-slate-400 text-cyan-600 focus:ring-cyan-500"
                      />
                      Select
                    </label>
                  </div>
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

                <div className="flex flex-wrap justify-end gap-2">
                  <Link
                    href={`/instructions/${instruction.id}`}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-400/45 bg-slate-900/10 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-900/15 dark:text-slate-100 dark:hover:bg-white/10"
                  >
                    <Eye size={14} />
                    View
                  </Link>
                  <button
                    type="button"
                    disabled={anyActionBusy}
                    onClick={() => {
                      setError(null);
                      setMessage(null);
                      setConfirmInstruction(instruction);
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/45 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-cyan-100"
                  >
                    {restoringThisInstruction ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <ArchiveRestore size={14} />
                    )}
                    Restore
                  </button>
                  <button
                    type="button"
                    disabled
                    title="Permanent deletion is disabled for ISO document-control retention."
                    className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl border border-slate-400/45 bg-slate-500/10 px-3 py-2 text-sm font-semibold text-slate-600 opacity-70 dark:text-slate-300"
                  >
                    <Trash2 size={14} />
                    Retention Locked
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {confirmInstruction && portalReady
        ? createPortal(
            <div className="app-modal-shell fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
              <div className="grid w-full max-w-md gap-4 rounded-2xl border border-cyan-500/45 bg-slate-950/95 p-5 shadow-2xl">
                <div className="grid gap-1">
                  <h3 className="text-lg font-bold text-slate-100">Restore Instruction?</h3>
                  <p className="text-sm text-slate-300">
                    {getPartIdLabel(confirmInstruction.workItem)} |{" "}
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

      {restoreConflictModal && portalReady
        ? createPortal(
            <div className="app-modal-shell fixed inset-0 z-[121] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
              <div className="grid w-full max-w-xl gap-4 rounded-2xl border border-cyan-500/45 bg-slate-950/95 p-5 shadow-2xl">
                <div className="grid gap-2">
                  <h3 className="text-lg font-bold text-slate-100">
                    Active revision already exists
                  </h3>
                  <p className="text-sm text-slate-300">
                    {getPartIdLabel(restoreConflictModal.instruction.workItem)} |{" "}
                    {restoreConflictModal.instruction.workItem.department_name}
                  </p>
                  <p className="text-sm text-slate-300">
                    {restoreConflictModal.conflict.hasNewerRevision
                      ? `Revision ${restoreConflictModal.conflict.existingRevision} is currently active and newer than archived revision ${restoreConflictModal.conflict.restoringRevision}.`
                      : `Revision ${restoreConflictModal.conflict.existingRevision} is currently active while archived revision ${restoreConflictModal.conflict.restoringRevision} is being restored.`}
                  </p>
                  <p className="text-sm text-slate-300">
                    Would you like to view the active revision first or swap them out?
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    disabled={Boolean(busyInstructionId)}
                    onClick={() => setRestoreConflictModal(null)}
                    className="rounded-xl border border-slate-600 bg-slate-900/70 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const existingInstructionId =
                        restoreConflictModal.conflict.existingInstructionId;
                      window.open(
                        `/instructions/${existingInstructionId}`,
                        "_blank",
                        "noopener,noreferrer",
                      );
                    }}
                    className="rounded-xl border border-cyan-500/45 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25"
                  >
                    View Existing
                  </button>
                  <button
                    type="button"
                    disabled={busyInstructionId === restoreConflictModal.instruction.id}
                    onClick={() =>
                      void handleRestore(restoreConflictModal.instruction, {
                        forceSwap: true,
                      })
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/45 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {busyInstructionId === restoreConflictModal.instruction.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <ArchiveRestore size={14} />
                    )}
                    Swap and Restore
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

