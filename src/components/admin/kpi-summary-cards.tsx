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

const CARD_TONE_CLASSES: Record<KpiSummaryTone, string> = {
  cyan: "border-cyan-500/40 bg-cyan-500/10 text-cyan-900 transition hover:bg-cyan-500/15 dark:text-cyan-100",
  emerald:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 transition hover:bg-emerald-500/15 dark:text-emerald-100",
  amber:
    "border-amber-500/40 bg-amber-500/10 text-amber-900 transition hover:bg-amber-500/15 dark:text-amber-100",
  violet:
    "border-violet-500/40 bg-violet-500/10 text-violet-900 transition hover:bg-violet-500/15 dark:text-violet-100",
  rose: "border-rose-500/40 bg-rose-500/10 text-rose-900 transition hover:bg-rose-500/15 dark:text-rose-100",
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
              className={cn(
                "grid gap-1 rounded-2xl border p-4 text-left shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 dark:focus-visible:ring-cyan-300/70",
                CARD_TONE_CLASSES[card.tone],
              )}
              aria-haspopup={isScrollCard ? undefined : "dialog"}
            >
              <p className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide opacity-90">
                <Icon size={14} />
                {card.label}
              </p>
              <p className="text-2xl font-extrabold">{card.value}</p>
              <p className="text-[11px] font-semibold opacity-85">
                {isScrollCard ? "Click to jump" : "Click for details"}
              </p>
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
