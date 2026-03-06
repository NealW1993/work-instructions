"use client";

import { CheckCircle2, ChevronDown, Loader2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

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
  const reviewIsOutOfRange =
    daysSinceCalibration !== null && daysSinceCalibration >= normalizedReviewWindowDays;
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

    if (nextStatus === status) {
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
      ? "Needs review is flagged. This instruction is still available for use."
      : reviewIsOutOfRange
        ? `Review window has passed (${normalizedReviewWindowDays}-day range). Please re-check and confirm Up To Date.`
        : daysUntilDue === null
          ? "Review timing is unavailable."
          : daysUntilDue === 0
            ? "Review check is due today."
            : null;

  const nextReviewCheckLabel =
    daysUntilDue === null
      ? "Next review check unavailable."
      : daysUntilDue === 0
        ? "Next review check due today."
        : `Next review check in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}.`;
  const canUsePortal = typeof document !== "undefined";

  return (
    <>
      <div ref={menuRootRef} className={cn("relative inline-flex", className)}>
        <div
          className={cn(
            "inline-flex overflow-hidden rounded-xl border",
            status === "needs_review"
              ? "border-amber-500/45 bg-amber-500/12 text-amber-800 dark:text-amber-200"
              : "border-emerald-500/45 bg-emerald-500/12 text-emerald-800 dark:text-emerald-200",
          )}
        >
          <span className="inline-flex items-center gap-1.5 border-r border-current/25 px-3 py-1.5 text-sm font-semibold">
            {status === "needs_review" ? (
              <TriangleAlert size={14} />
            ) : (
              <CheckCircle2 size={14} />
            )}
            {status === "needs_review" ? "Needs Review" : "Up To Date"}
          </span>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={stateMenuOpen}
            disabled={busyStatus !== null}
            onClick={() => {
              if (stateMenuOpen) {
                closeStateMenu();
                return;
              }

              openStateMenu();
            }}
            className="inline-flex items-center px-2.5 transition hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-white/10"
          >
            {busyStatus ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <ChevronDown
                size={14}
                className={cn("transition", stateMenuOpen ? "rotate-180" : "")}
              />
            )}
          </button>
        </div>

        {menuMounted ? (
          <div
            className={cn(
              "fixed inset-x-4 bottom-4 z-[80] grid max-h-[calc(100dvh-2rem)] gap-2 overflow-y-auto rounded-xl border border-white/20 bg-slate-950/95 p-2 shadow-2xl backdrop-blur-xl transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-[calc(100%+0.35rem)] sm:min-w-[270px] sm:max-h-none",
              menuEntered ? "pointer-events-auto" : "pointer-events-none",
            )}
            style={{
              opacity: menuEntered ? 1 : 0,
              filter: menuEntered ? "blur(0px)" : "blur(6px)",
              transform: menuEntered ? "translateY(0px) scale(1)" : "translateY(-8px) scale(0.98)",
              transformOrigin: "top right",
            }}
          >
            <button
              type="button"
              disabled={status === "up_to_date" || busyStatus !== null}
              onClick={() => void updateInstructionReviewStatus("up_to_date")}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/45 bg-emerald-500/15 px-2.5 py-1.5 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 size={13} />
              Up To Date
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
              className="inline-flex items-center gap-2 rounded-lg border border-amber-500/45 bg-amber-500/15 px-2.5 py-1.5 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <TriangleAlert size={13} />
              Needs Review
            </button>

            <div className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-2 text-[11px] text-slate-200">
              <p className="font-semibold">{nextReviewCheckLabel}</p>
              <p className="mt-1 text-slate-300">
                Last reviewed by <span className="font-semibold">{lastReviewedByName}</span>
              </p>
              <p className="text-slate-400">
                Last review check: <LocalDateTime value={lastCalibratedAt} mode="dateTime" />
              </p>
              {flaggedAt ? (
                <p className="text-slate-400">
                  Latest needs-review flag: <LocalDateTime value={flaggedAt} mode="dateTime" />
                </p>
              ) : null}
            </div>

            {statusSummary ? (
              <p className="text-[11px] font-semibold text-slate-300">{statusSummary}</p>
            ) : null}
            {message ? (
              <p className="text-[11px] font-semibold text-emerald-300">{message}</p>
            ) : null}
            {error ? (
              <p className="text-[11px] font-semibold text-rose-300">{error}</p>
            ) : null}
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

