"use client";

import { CheckCircle2, ChevronDown, Loader2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

import { FloatingStatusNotices } from "@/components/ui/floating-status-notices";
import { LocalDateTime } from "@/components/ui/local-date-time";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

interface InstructionReviewControlsProps {
  instructionId: string;
  instructionUpdatedAt: string;
  reviewWindowDays: number;
  lastReviewedByName: string;
  initialStatus: "up_to_date" | "needs_review";
  initialLastCalibratedAt: string | null;
  initialFlaggedAt: string | null;
  /** Whether the periodic review check is already due (worked out on the server, so the first render matches). */
  initialReviewDue: boolean;
  className?: string;
}

interface InstructionReviewStatusPayload {
  instruction_id: string;
  status: "up_to_date" | "needs_review";
  last_calibrated_at: string;
  flagged_at: string | null;
  updated_at: string;
}

type InstructionReviewOrigin = "user" | "system";

const DEFAULT_REVIEW_WINDOW_DAYS = 30;
const REVIEW_MENU_ANIMATION_MS = 260;
const MAX_REVIEW_NOTE_CHARACTERS = 1200;

function normalizeReviewWindowDays(value: number) {
  if (!Number.isInteger(value)) {
    return DEFAULT_REVIEW_WINDOW_DAYS;
  }

  if (value < 1 || value > 365) {
    return DEFAULT_REVIEW_WINDOW_DAYS;
  }

  return value;
}

function toElapsedCalendarDays(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const today = new Date();
  const valueDayStart = new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
  ).getTime();
  const todayDayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const elapsed = todayDayStart - valueDayStart;
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return null;
  }

  return Math.round(elapsed / (1000 * 60 * 60 * 24));
}

function isInstructionReviewStatusPayload(value: unknown): value is InstructionReviewStatusPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.instruction_id === "string" &&
    (candidate.status === "up_to_date" || candidate.status === "needs_review") &&
    typeof candidate.last_calibrated_at === "string" &&
    (typeof candidate.flagged_at === "string" || candidate.flagged_at === null) &&
    typeof candidate.updated_at === "string"
  );
}

export function InstructionReviewControls({
  instructionId,
  instructionUpdatedAt,
  reviewWindowDays,
  lastReviewedByName,
  initialStatus,
  initialLastCalibratedAt,
  initialFlaggedAt,
  initialReviewDue,
  className,
}: InstructionReviewControlsProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  const menuCloseTimeoutRef = useRef<number | null>(null);
  const [status, setStatus] = useState<"up_to_date" | "needs_review">(initialStatus);
  const [lastCalibratedAt, setLastCalibratedAt] = useState<string>(
    initialLastCalibratedAt ?? instructionUpdatedAt,
  );
  const [flaggedAt, setFlaggedAt] = useState<string | null>(initialFlaggedAt);
  // A review check that is past due needs review, exactly like an instruction someone flagged.
  const [reviewDue, setReviewDue] = useState(initialReviewDue);
  const needsReview = status === "needs_review" || reviewDue;
  const [busyStatus, setBusyStatus] = useState<InstructionReviewStatusPayload["status"] | null>(
    null,
  );
  const [stateMenuOpen, setStateMenuOpen] = useState(false);
  const [menuMounted, setMenuMounted] = useState(false);
  const [menuEntered, setMenuEntered] = useState(false);
  const [needsReviewModalOpen, setNeedsReviewModalOpen] = useState(false);
  const [needsReviewNote, setNeedsReviewNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const normalizedReviewWindowDays = normalizeReviewWindowDays(reviewWindowDays);
  const daysSinceCalibration = toElapsedCalendarDays(lastCalibratedAt);
  const daysUntilDue =
    daysSinceCalibration === null
      ? null
      : Math.max(0, normalizedReviewWindowDays - daysSinceCalibration);

  const closeStateMenu = useCallback(() => {
    if (menuCloseTimeoutRef.current !== null) {
      window.clearTimeout(menuCloseTimeoutRef.current);
      menuCloseTimeoutRef.current = null;
    }

    setMenuEntered(false);
    setStateMenuOpen(false);
    menuCloseTimeoutRef.current = window.setTimeout(() => {
      setMenuMounted(false);
      menuCloseTimeoutRef.current = null;
    }, REVIEW_MENU_ANIMATION_MS);
  }, []);

  const openStateMenu = useCallback(() => {
    if (menuCloseTimeoutRef.current !== null) {
      window.clearTimeout(menuCloseTimeoutRef.current);
      menuCloseTimeoutRef.current = null;
    }

    setMenuMounted(true);
    setStateMenuOpen(true);
    window.requestAnimationFrame(() => {
      setMenuEntered(true);
    });
  }, []);

  const closeNeedsReviewModal = useCallback(() => {
    if (busyStatus) {
      return;
    }

    setNeedsReviewModalOpen(false);
    setNeedsReviewNote("");
  }, [busyStatus]);

  async function getAuthHeaders() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Missing session token. Please sign in again.");
    }

    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    };
  }

  async function updateInstructionReviewStatus(
    nextStatus: "up_to_date" | "needs_review",
    options?: {
      note?: string | null;
      reviewOrigin?: InstructionReviewOrigin;
    },
  ) {
    if (busyStatus) {
      return false;
    }

    // Confirming "Up To Date" when the check is due is a real action even though nothing was flagged.
    const confirmingDueCheck = nextStatus === "up_to_date" && reviewDue;
    if (nextStatus === status && !confirmingDueCheck) {
      closeStateMenu();
      return true;
    }

    closeStateMenu();
    setBusyStatus(nextStatus);
    setError(null);
    setMessage(null);

    try {
      const normalizedNote =
        nextStatus === "needs_review"
          ? options?.note?.trim()
            ? options.note.trim()
            : null
          : null;
      const reviewOrigin = options?.reviewOrigin ?? "user";
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/instructions/${instructionId}/review`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status: nextStatus,
          reviewOrigin: nextStatus === "needs_review" ? reviewOrigin : undefined,
          note: nextStatus === "needs_review" ? normalizedNote : undefined,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        reviewStatus?: unknown;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update review status.");
      }

      const serverReviewStatus = isInstructionReviewStatusPayload(payload.reviewStatus)
        ? payload.reviewStatus
        : null;

      if (nextStatus === "up_to_date") {
        setReviewDue(false);
      }

      if (serverReviewStatus) {
        setStatus(serverReviewStatus.status);
        setLastCalibratedAt(serverReviewStatus.last_calibrated_at);
        setFlaggedAt(serverReviewStatus.flagged_at);
      } else if (nextStatus === "up_to_date") {
        const nowIso = new Date().toISOString();
        setStatus("up_to_date");
        setLastCalibratedAt(nowIso);
        setFlaggedAt(null);
      } else {
        setStatus("needs_review");
        setFlaggedAt(new Date().toISOString());
      }

      setMessage(
        nextStatus === "up_to_date"
          ? "Instruction marked Up To Date."
          : "Instruction marked Needs Review.",
      );
      if (nextStatus === "needs_review") {
        setNeedsReviewModalOpen(false);
        setNeedsReviewNote("");
      }
      router.refresh();
      return true;
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to update review status.",
      );
      return false;
    } finally {
      setBusyStatus(null);
    }
  }

  async function submitNeedsReviewUpdate() {
    if (busyStatus) {
      return;
    }

    await updateInstructionReviewStatus("needs_review", {
      note: needsReviewNote,
      reviewOrigin: "user",
    });
  }

  useEffect(() => {
    if (!stateMenuOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && menuRootRef.current?.contains(target)) {
        return;
      }

      closeStateMenu();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeStateMenu();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [closeStateMenu, stateMenuOpen]);

  useEffect(
    () => () => {
      if (menuCloseTimeoutRef.current !== null) {
        window.clearTimeout(menuCloseTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!needsReviewModalOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeNeedsReviewModal();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [closeNeedsReviewModal, needsReviewModalOpen]);

  const statusSummary =
    status === "needs_review"
      ? "Someone flagged this instruction for review. It is still available for use."
      : reviewDue
        ? `The review check is due (checks are every ${normalizedReviewWindowDays} days). Make sure the instruction is still correct, then choose Up To Date.`
        : daysUntilDue === null
          ? "Review timing is unavailable."
          : null;

  const nextReviewCheckLabel = reviewDue
    ? "Review check is due now."
    : daysUntilDue === null
      ? "Next review check unavailable."
      : daysUntilDue === 0
        ? "Next review check due today."
        : `Next review check in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}.`;
  const canUsePortal = typeof document !== "undefined";

  return (
    <>
      <FloatingStatusNotices
        notices={[
          message && {
            id: "instruction-review-message",
            tone: "success",
            message,
            onDismiss: () => setMessage(null),
          },
          error && {
            id: "instruction-review-error",
            tone: "error",
            message: error,
            onDismiss: () => setError(null),
          },
        ]}
      />
      <div ref={menuRootRef} className={cn("relative inline-flex", className)}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={stateMenuOpen}
          aria-label={`Review status: ${needsReview ? "Needs Review" : "Up To Date"}. Change review status.`}
          disabled={busyStatus !== null}
          onClick={() => {
            if (stateMenuOpen) {
              closeStateMenu();
              return;
            }

            openStateMenu();
          }}
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
            needsReview
              ? "border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-100 dark:hover:bg-amber-500/25"
              : "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:border-emerald-500/45 dark:bg-emerald-500/15 dark:text-emerald-100 dark:hover:bg-emerald-500/25",
          )}
        >
          {busyStatus ? (
            <Loader2 size={15} className="animate-spin" aria-hidden="true" />
          ) : needsReview ? (
            <TriangleAlert size={15} aria-hidden="true" />
          ) : (
            <CheckCircle2 size={15} aria-hidden="true" />
          )}
          <span aria-hidden="true">{needsReview ? "Needs Review" : "Up To Date"}</span>
          <ChevronDown size={14} aria-hidden="true" className={cn("transition", stateMenuOpen ? "rotate-180" : "")} />
        </button>

        {menuMounted ? (
          <div
            className={cn(
              "fixed inset-x-4 bottom-4 z-[80] grid max-h-[calc(100dvh-2rem)] gap-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 text-slate-800 shadow-xl transition-[opacity,transform] duration-200 ease-out dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-[calc(100%+0.35rem)] sm:w-80 sm:max-h-none",
              menuEntered ? "pointer-events-auto" : "pointer-events-none",
            )}
            style={{
              opacity: menuEntered ? 1 : 0,
              transform: menuEntered ? "translateY(0px)" : "translateY(-6px)",
              transformOrigin: "top right",
            }}
          >
            {statusSummary ? (
              <p className={cn(
                "rounded-md px-2.5 py-2 text-xs font-medium",
                needsReview ? "bg-amber-50 text-amber-900 dark:bg-amber-500/15 dark:text-amber-100" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
              )}>
                {statusSummary}
              </p>
            ) : null}

            <button
              type="button"
              disabled={!needsReview || busyStatus !== null}
              onClick={() => void updateInstructionReviewStatus("up_to_date")}
              className="flex min-h-11 items-center gap-2.5 rounded-md px-2.5 text-left text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-45 dark:text-emerald-200 dark:hover:bg-emerald-500/10"
            >
              <CheckCircle2 size={16} aria-hidden="true" />
              <span className="grid">
                <span>Up To Date</span>
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">I checked it and it is still correct</span>
              </span>
            </button>
            <button
              type="button"
              disabled={status === "needs_review" || busyStatus !== null}
              onClick={() => {
                closeStateMenu();
                setError(null);
                setMessage(null);
                setNeedsReviewModalOpen(true);
                setNeedsReviewNote("");
              }}
              className="flex min-h-11 items-center gap-2.5 rounded-md px-2.5 text-left text-sm font-semibold text-amber-800 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-45 dark:text-amber-200 dark:hover:bg-amber-500/10"
            >
              <TriangleAlert size={16} aria-hidden="true" />
              <span className="grid">
                <span>Needs Review</span>
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">Something looks wrong or out of date</span>
              </span>
            </button>

            <div className="mt-1 border-t border-slate-200 px-2.5 pt-2 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
              <p className="font-semibold">{nextReviewCheckLabel}</p>
              <p className="mt-1">
                Last checked by <span className="font-semibold">{lastReviewedByName}</span> on{" "}
                <LocalDateTime value={lastCalibratedAt} mode="dateTime" />
              </p>
              {flaggedAt ? (
                <p>
                  Flagged for review on <LocalDateTime value={flaggedAt} mode="dateTime" />
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {canUsePortal && needsReviewModalOpen
        ? createPortal(
            <div
              className="review-note-modal-shell app-modal-shell fixed inset-0 z-[125] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
              role="presentation"
              onClick={closeNeedsReviewModal}
            >
              <div
                className="grid w-full max-w-md gap-4 rounded-2xl border border-amber-500/45 bg-slate-950/95 p-5 shadow-2xl"
                role="dialog"
                aria-modal="true"
                aria-label="Optional review note"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="grid gap-1.5">
                  <h3 className="text-lg font-bold text-slate-100">Mark Needs Review</h3>
                  <p className="text-sm text-slate-300">
                    Add an optional note explaining what should be reviewed.
                  </p>
                </div>

                <label className="grid gap-1.5 text-sm text-slate-200">
                  <span className="font-semibold text-slate-200">Why does this need review? (Optional)</span>
                  <textarea
                    value={needsReviewNote}
                    maxLength={MAX_REVIEW_NOTE_CHARACTERS}
                    onChange={(event) => setNeedsReviewNote(event.target.value)}
                    placeholder="Example: Step order may be outdated after line 3."
                    className="min-h-28 w-full resize-y rounded-xl border border-slate-500/55 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-amber-500/60"
                  />
                  <p className="text-[11px] text-slate-400">
                    {needsReviewNote.length}/{MAX_REVIEW_NOTE_CHARACTERS}
                  </p>
                </label>

                {error ? (
                  <p className="rounded-lg border border-rose-500/45 bg-rose-500/15 px-2.5 py-1.5 text-xs text-rose-100">
                    {error}
                  </p>
                ) : null}

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    disabled={busyStatus !== null}
                    onClick={closeNeedsReviewModal}
                    className="rounded-xl border border-slate-600 bg-slate-900/70 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busyStatus !== null}
                    onClick={() => void submitNeedsReviewUpdate()}
                    className="inline-flex items-center gap-2 rounded-xl border border-amber-500/50 bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {busyStatus === "needs_review" ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <TriangleAlert size={14} />
                    )}
                    Mark Needs Review
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

