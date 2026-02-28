"use client";

import { GitMerge, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

type ForkMergeMode = "selective" | "overwrite";

interface ForkMergeFieldSelection {
  department: boolean;
  partId: boolean;
  itemTitle: boolean;
  body: boolean;
  revision: boolean;
  media: boolean;
}

interface MergeForkResponsePayload {
  error?: string;
  rootInstructionId?: string;
}

interface InstructionForkMergeControlProps {
  forkInstructionId: string;
  forkNumber: number;
  rootInstructionId: string;
  rootPartId: string;
  rootItemTitle: string;
  rootDepartmentName: string;
  className?: string;
}

const DEFAULT_FIELDS: ForkMergeFieldSelection = {
  department: false,
  partId: false,
  itemTitle: false,
  body: true,
  revision: true,
  media: false,
};

export function InstructionForkMergeControl({
  forkInstructionId,
  forkNumber,
  rootInstructionId,
  rootPartId,
  rootItemTitle,
  rootDepartmentName,
  className,
}: InstructionForkMergeControlProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [portalReady, setPortalReady] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mergeMode, setMergeMode] = useState<ForkMergeMode>("selective");
  const [fields, setFields] = useState<ForkMergeFieldSelection>(DEFAULT_FIELDS);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  function closeModal() {
    if (busy) {
      return;
    }

    setModalOpen(false);
  }

  async function handleMerge() {
    if (busy) {
      return;
    }

    if (mergeMode === "selective" && !Object.values(fields).some(Boolean)) {
      setError("Select at least one field to merge, or choose Overwrite Original.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Missing session token. Please sign in again.");
      }

      const response = await fetch(`/api/instructions/${forkInstructionId}/merge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          mergeMode,
          fields,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as MergeForkResponsePayload;
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to merge this fork.");
      }

      const destinationInstructionId = payload.rootInstructionId ?? rootInstructionId;
      setModalOpen(false);
      router.push(`/instructions/${destinationInstructionId}`);
      router.refresh();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Unable to merge this fork.",
      );
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
          setMergeMode("selective");
          setFields(DEFAULT_FIELDS);
          setModalOpen(true);
        }}
        disabled={busy}
        className={cn(
          "inline-flex items-center gap-2 rounded-xl border border-emerald-500/45 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-70 dark:text-emerald-200",
          className,
        )}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <GitMerge size={14} />}
        Merge Fork
      </button>

      {modalOpen && portalReady
        ? createPortal(
            <div
              className="app-modal-shell fixed inset-0 z-[128] flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm sm:p-6"
              onClick={closeModal}
              role="presentation"
            >
              <div
                className="grid w-full max-w-xl gap-4 rounded-2xl border border-emerald-500/35 bg-slate-950/95 p-5 shadow-2xl"
                role="dialog"
                aria-modal="true"
                aria-label="Merge fork into original"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="grid gap-1">
                  <h3 className="text-lg font-bold text-slate-100">
                    Merge Fork {forkNumber} Into Original
                  </h3>
                  <p className="text-sm text-slate-300">
                    Original: {rootPartId} | {rootItemTitle} | {rootDepartmentName}
                  </p>
                </div>

                <div className="grid gap-2 rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                    Merge Mode
                  </p>
                  <label className="inline-flex items-start gap-2 text-sm text-slate-200">
                    <input
                      type="radio"
                      name="fork-merge-mode"
                      checked={mergeMode === "selective"}
                      onChange={() => setMergeMode("selective")}
                    />
                    <span>
                      Selective merge
                      <span className="block text-xs text-slate-400">
                        Choose exactly which details to merge.
                      </span>
                    </span>
                  </label>
                  <label className="inline-flex items-start gap-2 text-sm text-slate-200">
                    <input
                      type="radio"
                      name="fork-merge-mode"
                      checked={mergeMode === "overwrite"}
                      onChange={() => setMergeMode("overwrite")}
                    />
                    <span>
                      Overwrite original
                      <span className="block text-xs text-slate-400">
                        Replace original details with this fork version.
                      </span>
                    </span>
                  </label>
                </div>

                {mergeMode === "selective" ? (
                  <div className="grid gap-2 rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                      Select Details To Merge
                    </p>
                    <label className="inline-flex items-center gap-2 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={fields.body}
                        onChange={(event) =>
                          setFields((current) => ({
                            ...current,
                            body: event.target.checked,
                          }))
                        }
                      />
                      Instruction body
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={fields.revision}
                        onChange={(event) =>
                          setFields((current) => ({
                            ...current,
                            revision: event.target.checked,
                          }))
                        }
                      />
                      Revision number
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={fields.partId}
                        onChange={(event) =>
                          setFields((current) => ({
                            ...current,
                            partId: event.target.checked,
                          }))
                        }
                      />
                      Part ID
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={fields.itemTitle}
                        onChange={(event) =>
                          setFields((current) => ({
                            ...current,
                            itemTitle: event.target.checked,
                          }))
                        }
                      />
                      Work item title
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={fields.department}
                        onChange={(event) =>
                          setFields((current) => ({
                            ...current,
                            department: event.target.checked,
                          }))
                        }
                      />
                      Department
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={fields.media}
                        onChange={(event) =>
                          setFields((current) => ({
                            ...current,
                            media: event.target.checked,
                          }))
                        }
                      />
                      Media attachments
                    </label>
                  </div>
                ) : (
                  <p className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-100">
                    Overwrite merges all fork fields into the original instruction.
                  </p>
                )}

                {error ? (
                  <p className="rounded-lg border border-rose-500/45 bg-rose-500/15 px-3 py-2 text-sm text-rose-100">
                    {error}
                  </p>
                ) : null}

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={busy}
                    className="rounded-xl border border-slate-600 bg-slate-900/70 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleMerge()}
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/45 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <GitMerge size={14} />}
                    {mergeMode === "overwrite" ? "Overwrite Original" : "Merge Selected Details"}
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
