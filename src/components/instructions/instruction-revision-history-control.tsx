"use client";

import { Eye, History, Loader2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export interface InstructionRevisionHistoryEntry {
  id: string;
  revision: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  updatedByName: string;
}

interface InstructionRevisionHistoryControlProps {
  currentInstructionId: string;
  entries: InstructionRevisionHistoryEntry[];
  canPromoteArchivedRevision: boolean;
  hideBaseRevision?: boolean;
}

interface PromoteInstructionResponse {
  success?: boolean;
  promotedInstructionId?: string;
  archivedInstructionIds?: string[];
  error?: string;
}

export function InstructionRevisionHistoryControl({
  currentInstructionId,
  entries,
  canPromoteArchivedRevision,
  hideBaseRevision = false,
}: InstructionRevisionHistoryControlProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [portalReady, setPortalReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busyRevisionId, setBusyRevisionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uniqueRevisionCount = useMemo(
    () => new Set(entries.map((entry) => entry.revision)).size,
    [entries],
  );
  const visibleEntries = useMemo(
    () =>
      entries
        .filter((entry) => (hideBaseRevision ? entry.revision > 1 : true))
        .sort((first, second) => {
          if (second.revision !== first.revision) {
            return second.revision - first.revision;
          }

          if (first.isArchived !== second.isArchived) {
            return Number(first.isArchived) - Number(second.isArchived);
          }

          const firstUpdatedAt = Date.parse(first.updatedAt);
          const secondUpdatedAt = Date.parse(second.updatedAt);
          if (Number.isFinite(firstUpdatedAt) && Number.isFinite(secondUpdatedAt)) {
            return secondUpdatedAt - firstUpdatedAt;
          }

          return 0;
        }),
    [entries, hideBaseRevision],
  );
  const activeEntryId = useMemo(() => {
    const activeEntries = visibleEntries.filter((entry) => !entry.isArchived);
    if (activeEntries.length > 0) {
      return activeEntries[0]?.id ?? null;
    }

    const activeEntriesFromAllRevisions = entries
      .filter((entry) => !entry.isArchived)
      .sort((first, second) => {
        if (second.revision !== first.revision) {
          return second.revision - first.revision;
        }

        const firstUpdatedAt = Date.parse(first.updatedAt);
        const secondUpdatedAt = Date.parse(second.updatedAt);
        if (Number.isFinite(firstUpdatedAt) && Number.isFinite(secondUpdatedAt)) {
          return secondUpdatedAt - firstUpdatedAt;
        }

        return 0;
      });

    if (activeEntriesFromAllRevisions.length > 0) {
      return activeEntriesFromAllRevisions[0]?.id ?? null;
    }

    return currentInstructionId;
  }, [currentInstructionId, entries, visibleEntries]);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  if (uniqueRevisionCount <= 1 || visibleEntries.length === 0) {
    return null;
  }

  async function handlePromoteRevision(revisionEntry: InstructionRevisionHistoryEntry) {
    setBusyRevisionId(revisionEntry.id);
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Missing session token. Please sign in again.");
      }

      const response = await fetch(`/api/instructions/${revisionEntry.id}/promote`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as PromoteInstructionResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to bring back this revision.");
      }

      const destinationInstructionId = payload.promotedInstructionId ?? revisionEntry.id;
      setMenuOpen(false);
      router.push(`/instructions/${destinationInstructionId}`);
      router.refresh();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Unable to bring back this revision.",
      );
    } finally {
      setBusyRevisionId(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setMenuOpen(true);
        }}
        title="View old revisions"
        aria-label="View old revisions"
        className="ml-1 inline-flex items-center justify-center rounded-md border border-cyan-500/40 bg-cyan-500/10 p-1 text-cyan-800 transition hover:bg-cyan-500/20 dark:text-cyan-200"
      >
        <History size={14} />
      </button>

      {menuOpen && portalReady
        ? createPortal(
            <div className="fixed inset-0 z-[125] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
              <div className="grid w-full max-w-xl gap-4 rounded-2xl border border-cyan-500/45 bg-slate-950/95 p-5 shadow-2xl">
                <div className="grid gap-1">
                  <h3 className="text-lg font-bold text-slate-100">Revision History</h3>
                  <p className="text-sm text-slate-300">
                    Select a revision to view. The active revision is marked Current.
                  </p>
                </div>

                {error ? (
                  <p className="rounded-xl border border-rose-500/45 bg-rose-500/15 px-3 py-2 text-sm text-rose-100">
                    {error}
                  </p>
                ) : null}

                <div className="grid max-h-[60vh] gap-2 overflow-y-auto pr-1">
                  {visibleEntries.map((entry) => {
                    const isCurrent = entry.id === activeEntryId;

                    return (
                      <article
                        key={entry.id}
                        className="grid gap-2 rounded-xl border border-white/15 bg-white/5 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-100">
                            Revision {entry.revision}
                          </p>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                              isCurrent
                                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                                : "border-amber-500/40 bg-amber-500/15 text-amber-200"
                            }`}
                          >
                            {isCurrent ? "Current" : entry.isArchived ? "Archived" : "Active"}
                          </span>
                        </div>

                        <p className="text-xs text-slate-300">
                          Updated <LocalDateTime value={entry.updatedAt} mode="dateTime" /> by{" "}
                          {entry.updatedByName}
                        </p>

                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setMenuOpen(false);
                              router.push(`/instructions/${entry.id}`);
                              router.refresh();
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-500/25"
                          >
                            <Eye size={12} />
                            View Revision
                          </button>

                          {canPromoteArchivedRevision && entry.isArchived && !isCurrent ? (
                            <button
                              type="button"
                              disabled={busyRevisionId === entry.id}
                              onClick={() => void handlePromoteRevision(entry)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/45 bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {busyRevisionId === entry.id ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <RotateCcw size={12} />
                              )}
                              Bring Back as Current
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setMenuOpen(false)}
                    className="rounded-xl border border-slate-600 bg-slate-900/70 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
