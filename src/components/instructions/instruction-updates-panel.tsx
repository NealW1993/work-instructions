"use client";

import { useEffect, useMemo, useState } from "react";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { cn } from "@/lib/utils";

interface InstructionUpdateSourceMedia {
  type: "image" | "video";
  src: string;
}

export interface InstructionUpdateSourcePayload {
  addedTextSnippet?: string;
  removedTextSnippet?: string;
  addedMedia?: InstructionUpdateSourceMedia[];
  removedMedia?: InstructionUpdateSourceMedia[];
  previousRevision?: number;
  nextRevision?: number;
  mediaFormattingUpdated?: boolean;
}

export interface InstructionUpdateEvent {
  id: string;
  eventType: "created" | "updated";
  detail: string;
  occurredAt: string;
  actorName: string;
  sourcePayload?: InstructionUpdateSourcePayload | null;
}

interface InstructionUpdatesPanelProps {
  events: InstructionUpdateEvent[];
}

const MAX_VISIBLE_UPDATE_CARDS = 5;

function hasSourcePayloadData(sourcePayload: InstructionUpdateSourcePayload | null | undefined) {
  if (!sourcePayload) {
    return false;
  }

  return Boolean(
    sourcePayload.addedTextSnippet ||
      sourcePayload.removedTextSnippet ||
      (sourcePayload.addedMedia?.length ?? 0) > 0 ||
      (sourcePayload.removedMedia?.length ?? 0) > 0 ||
      sourcePayload.mediaFormattingUpdated ||
      sourcePayload.previousRevision !== undefined ||
      sourcePayload.nextRevision !== undefined,
  );
}

interface SourceMediaPreviewProps {
  media: InstructionUpdateSourceMedia;
  tone: "added" | "removed";
}

function SourceMediaPreview({ media, tone }: SourceMediaPreviewProps) {
  const toneClasses =
    tone === "added"
      ? "border-emerald-500/35 bg-emerald-500/10"
      : "border-rose-500/35 bg-rose-500/10";

  const linkClasses = tone === "added" ? "text-emerald-100" : "text-rose-100";

  return (
    <figure className={cn("grid gap-2 rounded-lg border p-2", toneClasses)}>
      <div className="overflow-hidden rounded-md border border-white/15 bg-slate-950/60">
        {media.type === "video" ? (
          <video src={media.src} controls preload="metadata" className="max-h-64 w-full object-contain" />
        ) : (
          // Remote media URLs are dynamic and not known at build time.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={media.src}
            alt="Update media preview"
            loading="lazy"
            className="max-h-64 w-full object-contain"
          />
        )}
      </div>
      <a
        href={media.src}
        target="_blank"
        rel="noreferrer"
        className={cn("break-all text-xs underline underline-offset-2", linkClasses)}
      >
        {media.src}
      </a>
    </figure>
  );
}

export function InstructionUpdatesPanel({ events }: InstructionUpdatesPanelProps) {
  const [showUpdates, setShowUpdates] = useState(false);
  const [selectedSourceEventId, setSelectedSourceEventId] = useState<string | null>(null);

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

  const selectedSourceEvent = useMemo(
    () =>
      updateEvents.find((event) => event.id === selectedSourceEventId && event.eventType === "updated") ??
      null,
    [selectedSourceEventId, updateEvents],
  );

  useEffect(() => {
    if (!selectedSourceEventId) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedSourceEventId(null);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [selectedSourceEventId]);

  if (events.length === 0) {
    return null;
  }

  return (
    <>
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
            {showUpdates ? "Hide Updates" : "Show Updates"}
          </button>
        </div>

        {showUpdates ? (
          updateEvents.length === 0 ? (
            <p className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              No updates were recorded after the original version.
            </p>
          ) : (
            <div className="grid gap-3">
              <div
                className={cn(
                  "grid gap-2",
                  updateEvents.length > MAX_VISIBLE_UPDATE_CARDS ? "max-h-[32rem] overflow-y-auto pr-1" : "",
                )}
              >
                {[...updateEvents].reverse().map((event) => (
                  <article
                    key={event.id}
                    className="min-h-24 rounded-xl border border-slate-300/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        <LocalDateTime value={event.occurredAt} mode="dateTime" /> by{" "}
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          {event.actorName}
                        </span>
                      </p>
                      <button
                        type="button"
                        onClick={() => setSelectedSourceEventId(event.id)}
                        className={cn(
                          "inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-semibold transition",
                          hasSourcePayloadData(event.sourcePayload)
                            ? "border-cyan-500/45 bg-cyan-500/15 text-cyan-800 hover:bg-cyan-500/25 dark:text-cyan-200"
                            : "border-slate-400/45 bg-slate-900/10 text-slate-700 hover:bg-slate-900/15 dark:text-slate-200 dark:hover:bg-white/10",
                        )}
                      >
                        View Source
                      </button>
                    </div>
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

      {selectedSourceEvent ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={() => setSelectedSourceEventId(null)}
        >
          <article
            className="grid w-full max-w-3xl gap-3 rounded-2xl border border-white/20 bg-slate-950/95 p-5 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Update source details"
            onClick={(clickEvent) => clickEvent.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1">
                <h3 className="text-lg font-bold text-slate-100">Update Source</h3>
                <p className="text-xs text-slate-300">
                  <LocalDateTime value={selectedSourceEvent.occurredAt} mode="dateTime" /> by{" "}
                  <span className="font-semibold">{selectedSourceEvent.actorName}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSourceEventId(null)}
                className="inline-flex items-center rounded-lg border border-slate-500/45 bg-slate-900/40 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-slate-800/60"
              >
                Close
              </button>
            </div>

            {hasSourcePayloadData(selectedSourceEvent.sourcePayload) ? (
              <div className="grid gap-3">
                {selectedSourceEvent.sourcePayload?.addedTextSnippet ? (
                  <div className="grid gap-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                      Added Text
                    </p>
                    <pre className="max-h-48 overflow-auto rounded-lg border border-emerald-500/35 bg-emerald-500/10 p-3 text-sm text-emerald-100 whitespace-pre-wrap">
                      {selectedSourceEvent.sourcePayload.addedTextSnippet}
                    </pre>
                  </div>
                ) : null}

                {selectedSourceEvent.sourcePayload?.removedTextSnippet ? (
                  <div className="grid gap-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-rose-300">
                      Removed Text
                    </p>
                    <pre className="max-h-48 overflow-auto rounded-lg border border-rose-500/35 bg-rose-500/10 p-3 text-sm text-rose-100 whitespace-pre-wrap">
                      {selectedSourceEvent.sourcePayload.removedTextSnippet}
                    </pre>
                  </div>
                ) : null}

                {(selectedSourceEvent.sourcePayload?.addedMedia?.length ?? 0) > 0 ? (
                  <div className="grid gap-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                      Added Media
                    </p>
                    <div className="grid gap-2">
                      {selectedSourceEvent.sourcePayload?.addedMedia?.map((media, index) => (
                        <SourceMediaPreview
                          key={`${media.type}:${media.src}:${index}`}
                          media={media}
                          tone="added"
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {(selectedSourceEvent.sourcePayload?.removedMedia?.length ?? 0) > 0 ? (
                  <div className="grid gap-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-rose-300">
                      Removed Media
                    </p>
                    <p className="text-xs text-rose-100/85">
                      Some removed media may no longer be available to preview.
                    </p>
                    <div className="grid gap-2">
                      {selectedSourceEvent.sourcePayload?.removedMedia?.map((media, index) => (
                        <SourceMediaPreview
                          key={`${media.type}:${media.src}:${index}`}
                          media={media}
                          tone="removed"
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {(selectedSourceEvent.sourcePayload?.previousRevision !== undefined ||
                  selectedSourceEvent.sourcePayload?.nextRevision !== undefined) ? (
                  <p className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                    Revision {selectedSourceEvent.sourcePayload?.previousRevision ?? "?"} to{" "}
                    {selectedSourceEvent.sourcePayload?.nextRevision ?? "?"}
                  </p>
                ) : null}

                {selectedSourceEvent.sourcePayload?.mediaFormattingUpdated ? (
                  <p className="rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100">
                    Media formatting changed in this update.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="rounded-lg border border-slate-500/40 bg-slate-900/40 p-3 text-sm text-slate-300">
                Source snippets are not available for this update event.
              </p>
            )}
          </article>
        </div>
      ) : null}
    </>
  );
}
