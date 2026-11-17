"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { Activity, BarChart3, FileText, ThumbsUp, Users, X } from "lucide-react";

import { cn } from "@/lib/utils";

type KpiSummaryTone = "cyan" | "emerald" | "amber" | "violet" | "rose";

export interface KpiSummaryCardConfig {
  id:
    | "active-users"
    | "active-instructions"
    | "total-likes"
    | "updates-all-time"
    | "total-active-user-time";
  label: string;
  value: string;
  tone: KpiSummaryTone;
  details: string[];
  scrollTargetId?: string;
}

// Each figure keeps a small colour cue on its icon; the cards themselves stay neutral.
const ICON_TONE_CLASSES: Record<KpiSummaryTone, string> = {
  cyan: "bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
  emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  violet: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  rose: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};

const ICON_BY_CARD_ID: Record<KpiSummaryCardConfig["id"], LucideIcon> = {
  "active-users": Users,
  "active-instructions": FileText,
  "total-likes": ThumbsUp,
  "updates-all-time": Activity,
  "total-active-user-time": BarChart3,
};

export function KpiSummaryCards({ cards }: { cards: KpiSummaryCardConfig[] }) {
  const [selectedCardId, setSelectedCardId] = useState<KpiSummaryCardConfig["id"] | null>(null);
  const selectedCard = useMemo(
    () => cards.find((entry) => entry.id === selectedCardId) ?? null,
    [cards, selectedCardId],
  );
  const shouldScrollDetails = (selectedCard?.details.length ?? 0) > 5;
  const canUsePortal = typeof document !== "undefined";

  useEffect(() => {
    if (!selectedCardId) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedCardId(null);
      }
    };
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [selectedCardId]);

  function handleCardClick(card: KpiSummaryCardConfig) {
    if (!card.scrollTargetId) {
      setSelectedCardId(card.id);
      return;
    }

    const target = document.getElementById(card.scrollTargetId);
    if (!target) {
      setSelectedCardId(card.id);
      return;
    }

    target.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => {
          const Icon = ICON_BY_CARD_ID[card.id];
          const isScrollCard = Boolean(card.scrollTargetId);
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => handleCardClick(card)}
              className="group grid gap-3 rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700 dark:hover:bg-slate-900"
              aria-haspopup={isScrollCard ? undefined : "dialog"}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-600 dark:text-slate-300">{card.label}</span>
                <span aria-hidden="true" className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md", ICON_TONE_CLASSES[card.tone])}>
                  <Icon size={16} />
                </span>
              </span>
              <span className="text-3xl font-semibold tabular-nums tracking-tight text-slate-950 dark:text-white">{card.value}</span>
              <span className="text-xs font-medium text-slate-500 transition group-hover:text-cyan-700 dark:text-slate-400 dark:group-hover:text-cyan-300">
                {isScrollCard ? "Jump to the breakdown" : "View details"}
              </span>
            </button>
          );
        })}
      </div>

      {canUsePortal && selectedCard
        ? createPortal(
            <div
              className="app-modal-shell fixed inset-0 z-[230] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
              role="presentation"
              onClick={() => setSelectedCardId(null)}
            >
              <article
                className="w-full max-w-xl rounded-2xl border border-white/20 bg-slate-950/96 shadow-2xl"
                role="dialog"
                aria-modal="true"
                aria-label={`${selectedCard.label} details`}
                onClick={(event) => event.stopPropagation()}
              >
                <header className="flex items-start justify-between gap-3 border-b border-white/10 p-5">
                  <div className="grid gap-1">
                    <h2 className="text-lg font-bold text-slate-100">{selectedCard.label}</h2>
                    <p className="text-3xl font-extrabold text-slate-100">{selectedCard.value}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedCardId(null)}
                    aria-label="Close KPI detail modal"
                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
                  >
                    <X size={18} />
                  </button>
                </header>

                <div className="p-5">
                  <div
                    className={cn(
                      "grid gap-2",
                      shouldScrollDetails ? "max-h-[18rem] overflow-y-auto pr-1" : "",
                    )}
                  >
                    {selectedCard.details.map((detail, index) => (
                      <p
                        key={`${selectedCard.id}-detail-${index}`}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200"
                      >
                        {detail}
                      </p>
                    ))}
                  </div>
                </div>
              </article>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
