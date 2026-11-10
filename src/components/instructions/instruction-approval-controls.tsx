"use client";

import { CheckCircle2, Loader2, RotateCcw, XCircle } from "lucide-react";
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

function statusLabel(status: InstructionApprovalStatus) {
  switch (status) {
    case "pending_review":
      return "Pending Review";
    case "rejected":
      return "Rejected";
    case "draft":
      return "Draft";
    case "approved":
    default:
      return "Approved";
  }
}

function statusTone(status: InstructionApprovalStatus) {
  switch (status) {
    case "pending_review":
      return "border-amber-500/45 bg-amber-500/15 text-amber-800 dark:text-amber-200";
    case "rejected":
      return "border-rose-500/45 bg-rose-500/15 text-rose-800 dark:text-rose-200";
    case "draft":
      return "border-slate-500/45 bg-slate-500/15 text-slate-700 dark:text-slate-300";
    case "approved":
    default:
      return "border-emerald-500/45 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200";
  }
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

  return (
    <div className={cn("grid gap-1", className)}>
      <div
        className={cn(
          "inline-flex overflow-hidden rounded-xl border text-sm font-semibold",
          statusTone(status),
        )}
      >
        <span className="inline-flex items-center gap-1.5 border-r border-current/25 px-3 py-1.5">
          {status === "approved" ? <CheckCircle2 size={14} /> : <RotateCcw size={14} />}
          {statusLabel(status)}
        </span>
        {canApprove && status === "pending_review" ? (
          <>
            <button
              type="button"
              disabled={busyStatus !== null}
              onClick={() => void updateApproval("approved")}
              className="inline-flex items-center px-2.5 transition hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
              aria-label="Approve instruction"
              title="Approve instruction"
            >
              {busyStatus === "approved" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <CheckCircle2 size={14} />
              )}
            </button>
            <button
              type="button"
              disabled={busyStatus !== null}
              onClick={() => void updateApproval("rejected")}
              className="inline-flex items-center px-2.5 transition hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
              aria-label="Reject instruction"
              title="Reject instruction"
            >
              {busyStatus === "rejected" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <XCircle size={14} />
              )}
            </button>
          </>
        ) : null}
      </div>
      {error ? <p role="alert" className="max-w-sm text-xs font-semibold text-rose-600 dark:text-rose-300">{error}</p> : null}
    </div>
  );
}
