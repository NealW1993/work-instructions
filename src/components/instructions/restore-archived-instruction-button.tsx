"use client";

import { useHydrated } from "@/lib/use-hydrated";

import { ArchiveRestore, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

interface RestoreConflictPayload {
  existingInstructionId: string;
  existingRevision: number;
  restoringRevision: number;
  hasNewerRevision: boolean;
}

interface RestoreResponsePayload {
  error?: string;
  conflict?: RestoreConflictPayload;
  swappedOutInstructionIds?: string[];
}

interface RestoreArchivedInstructionButtonProps {
  instructionId: string;
  revision: number;
  partId: string;
  departmentName: string;
}

export function RestoreArchivedInstructionButton({
  instructionId,
  revision,
  partId,
  departmentName,
}: RestoreArchivedInstructionButtonProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const portalReady = useHydrated();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<RestoreConflictPayload | null>(null);

  async function handleRestore(options?: { forceSwap?: boolean }) {
    setBusy(true);
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Missing session token. Please sign in again.");
      }

      const response = await fetch(`/api/instructions/${instructionId}`, {
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
        setConfirmOpen(false);
        setConflict(payload.conflict);
        return;
      }

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to restore instruction.");
      }

      setConfirmOpen(false);
      setConflict(null);
      router.refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to restore instruction.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConflict(null);
          setConfirmOpen(true);
        }}
        title="Restore this archived revision"
        aria-label="Restore this archived revision"
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/45 bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-200"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <ArchiveRestore size={14} />}
        <span>Restore</span>
      </button>

      {confirmOpen && portalReady
        ? createPortal(
            <div className="app-modal-shell fixed inset-0 z-[126] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
              <div className="grid w-full max-w-md gap-4 rounded-2xl border border-cyan-500/45 bg-slate-950/95 p-5 shadow-2xl">
                <div className="grid gap-1">
                  <h3 className="text-lg font-bold text-slate-100">Restore Instruction?</h3>
                  <p className="text-sm text-slate-300">
                    {partId} | {departmentName}
                  </p>
                  <p className="text-sm text-slate-300">
                    This will make revision {revision} visible again on dashboard/search.
                  </p>
                  {error ? (
                    <p className="rounded-lg border border-rose-500/45 bg-rose-500/15 px-2.5 py-1.5 text-xs text-rose-100">
                      {error}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmOpen(false)}
                    className="rounded-xl border border-slate-600 bg-slate-900/70 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleRestore()}
                    className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/50 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <ArchiveRestore size={14} />}
                    Restore
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {conflict && portalReady
        ? createPortal(
            <div className="app-modal-shell fixed inset-0 z-[127] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
              <div className="grid w-full max-w-xl gap-4 rounded-2xl border border-cyan-500/45 bg-slate-950/95 p-5 shadow-2xl">
                <div className="grid gap-2">
                  <h3 className="text-lg font-bold text-slate-100">
                    Active revision already exists
                  </h3>
                  <p className="text-sm text-slate-300">
                    {partId} | {departmentName}
                  </p>
                  <p className="text-sm text-slate-300">
                    {conflict.hasNewerRevision
                      ? `Revision ${conflict.existingRevision} is currently active and newer than archived revision ${conflict.restoringRevision}.`
                      : `Revision ${conflict.existingRevision} is currently active while archived revision ${conflict.restoringRevision} is being restored.`}
                  </p>
                  <p className="text-sm text-slate-300">
                    Would you like to view the active revision first or swap them out?
                  </p>
                  {error ? (
                    <p className="rounded-lg border border-rose-500/45 bg-rose-500/15 px-2.5 py-1.5 text-xs text-rose-100">
                      {error}
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConflict(null)}
                    className="rounded-xl border border-slate-600 bg-slate-900/70 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      window.open(
                        `/instructions/${conflict.existingInstructionId}`,
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
                    disabled={busy}
                    onClick={() => void handleRestore({ forceSwap: true })}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/45 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <ArchiveRestore size={14} />}
                    Swap and Restore
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

