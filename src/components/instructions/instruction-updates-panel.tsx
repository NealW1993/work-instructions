"use client";

import { useMemo, useState } from "react";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { cn } from "@/lib/utils";

export interface InstructionUpdateEvent {
  id: string;
  eventType: "created" | "updated";
  detail: string;
  occurredAt: string;
  actorName: string;
}

interface InstructionUpdatesPanelProps {
  events: InstructionUpdateEvent[];
}

interface InstructionUpdateTag {
  id: string;
  label: string;
  actorName: string;
  occurredAt: string;
}

function splitUpdateDetailSegments(detail: string) {
  const normalized = detail.trim();
  if (!normalized) {
    return [];
  }

  const segments = normalized
    .split(";")
    .map((segment) => segment.trim().replace(/\.+$/, ""))
    .filter((segment) => segment.length > 0);

  return segments.length > 0 ? segments : [normalized.replace(/\.+$/, "")];
}

function getTagTone(label: string) {
  const normalized = label.toLowerCase();

  if (normalized.includes("added") || normalized.includes("created")) {
    return "added";
  }

  if (normalized.includes("removed") || normalized.includes("deleted")) {
    return "removed";
  }

  if (normalized.includes("revision")) {
    return "revision";
  }

  return "updated";
}

function formatTagTooltip(actorName: string, occurredAt: string) {
  const parsed = new Date(occurredAt);
  const formattedOccurredAt = Number.isNaN(parsed.getTime())
    ? occurredAt
    : parsed.toLocaleString();
  return `Updated by ${actorName} on ${formattedOccurredAt}`;
}

export function InstructionUpdatesPanel({ events }: InstructionUpdatesPanelProps) {
  const [showUpdates, setShowUpdates] = useState(false);

  const sortedEvents = useMemo(
    () =>
      [...events].sort(
        (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
      ),
    [events],
  );

  const updateEvents = useMemo(
    () => sortedEvents.filter((event) => event.eventType === "updated"),
    [sortedEvents],
  );

  const updateTags = useMemo<InstructionUpdateTag[]>(() => {
    return updateEvents.flatMap((event) => {
      const segments = splitUpdateDetailSegments(event.detail);
      return segments.map((segment) => ({
        id: `${event.id}:${segment.toLowerCase()}`,
        label: segment,
        actorName: event.actorName,
        occurredAt: event.occurredAt,
      }));
    });
  }, [updateEvents]);

  if (events.length === 0) {
    return null;
  }

  return (
    <section className="grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-xl font-bold">Instruction Updates</h2>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {updateEvents.length} update event{updateEvents.length === 1 ? "" : "s"} captured
            since original.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowUpdates((current) => !current)}
          className={cn(
            "inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
            showUpdates
              ? "border-cyan-500/45 bg-cyan-500/15 text-cyan-800 dark:text-cyan-200"
              : "border-slate-400/45 bg-slate-900/10 text-slate-700 hover:bg-slate-900/15 dark:text-slate-200 dark:hover:bg-white/10",
          )}
        >
          Updates: {showUpdates ? "On" : "Off"}
        </button>
      </div>

      {showUpdates ? (
        updateEvents.length === 0 ? (
          <p className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
            No updates were recorded after the original version.
          </p>
        ) : (
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              {updateTags.map((tag) => {
                const tone = getTagTone(tag.label);
                return (
                  <span
                    key={tag.id}
                    title={formatTagTooltip(tag.actorName, tag.occurredAt)}
                    className={cn(
                      "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                      tone === "added" &&
                        "border-emerald-500/50 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
                      tone === "removed" &&
                        "border-rose-500/50 bg-rose-500/15 text-rose-800 dark:text-rose-200",
                      tone === "revision" &&
                        "border-amber-500/50 bg-amber-500/15 text-amber-900 dark:text-amber-200",
                      tone === "updated" &&
                        "border-cyan-500/50 bg-cyan-500/15 text-cyan-900 dark:text-cyan-200",
                    )}
                  >
                    {tag.label}
                  </span>
                );
              })}
            </div>

            <div className="grid gap-2">
              {[...updateEvents].reverse().map((event) => (
                <article
                  key={event.id}
                  className="rounded-xl border border-slate-300/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50"
                >
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    <LocalDateTime value={event.occurredAt} mode="dateTime" /> by{" "}
                    <span className="font-semibold text-slate-800 dark:text-slate-100">
                      {event.actorName}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                    {event.detail}
                  </p>
                </article>
              ))}
            </div>
          </div>
        )
      ) : null}
    </section>
  );
}
