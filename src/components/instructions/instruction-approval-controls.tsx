"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { InstructionApprovalStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface InstructionApprovalControlsProps {
  instructionId: string;
  initialStatus: InstructionApprovalStatus;
  expectedUpdatedAt: string;
  canApprove: boolean;
  className?: string;
}

export function InstructionApprovalControls({
  instructionId,
  initialStatus,
  expectedUpdatedAt,
  canApprove,
  className,
}: InstructionApprovalControlsProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [decision, setDecision] = useState<{ version: string; status: InstructionApprovalStatus } | null>(null);
  const status = decision?.version === expectedUpdatedAt ? decision.status : initialStatus;
  const [busyStatus, setBusyStatus] = useState<InstructionApprovalStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateApproval(nextStatus: "approved" | "rejected") {
    if (!canApprove || busyStatus || status !== "pending_review") {
      return;
    }

    const enteredNote =
      nextStatus === "rejected"
        ? window.prompt("Reason for rejection or requested change?")
        : "";
    if (enteredNote === null) return;
    const note = enteredNote.trim();
    if (nextStatus === "rejected" && !note) {
      setError("Enter a rejection reason so the author knows what to change.");
      return;
    }

    setBusyStatus(nextStatus);
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Missing session token. Please sign in again.");
      }

      const response = await fetch(`/api/instructions/${instructionId}/approval`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ status: nextStatus, note, expectedUpdatedAt }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        status?: InstructionApprovalStatus;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update approval.");
      }

      setDecision({ version: expectedUpdatedAt, status: payload.status ?? nextStatus });
      router.refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to update approval.");
    } finally {
      setBusyStatus(null);
    }
  }

  const errorNote = error ? (
    <p role="alert" className="max-w-sm text-xs font-semibold text-rose-600 dark:text-rose-300">{error}</p>
  ) : null;

  // The status itself is shown beside the title. These buttons appear only when there is a decision to make.
  if (!canApprove || status !== "pending_review") {
    return errorNote;
  }

  return (
    <div className={cn("grid gap-1", className)}>
      <div className="inline-flex items-center gap-2">
        <button
          type="button"
          disabled={busyStatus !== null}
          onClick={() => void updateApproval("approved")}
          aria-label="Approve instruction"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
        >
          {busyStatus === "approved" ? (
            <Loader2 size={15} className="animate-spin" aria-hidden="true" />
          ) : (
            <CheckCircle2 size={15} aria-hidden="true" />
          )}
          <span aria-hidden="true">Approve</span>
        </button>
        <button
          type="button"
          disabled={busyStatus !== null}
          onClick={() => void updateApproval("rejected")}
          aria-label="Reject instruction"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-rose-300 bg-white px-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/40 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-500/10"
        >
          {busyStatus === "rejected" ? (
            <Loader2 size={15} className="animate-spin" aria-hidden="true" />
          ) : (
            <XCircle size={15} aria-hidden="true" />
          )}
          <span aria-hidden="true">Reject</span>
        </button>
      </div>
      {errorNote}
    </div>
  );
}
