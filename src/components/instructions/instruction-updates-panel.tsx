"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

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
  className?: string;
}

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

function normalizeSnippetForComparison(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function shouldSuppressRemovedSnippet(
  sourcePayload: InstructionUpdateSourcePayload | null | undefined,
) {
  const addedSnippet = sourcePayload?.addedTextSnippet?.trim();
  const removedSnippet = sourcePayload?.removedTextSnippet?.trim();
  if (!addedSnippet || !removedSnippet) {
    return false;
  }

  const normalizedAdded = normalizeSnippetForComparison(addedSnippet);
  const normalizedRemoved = normalizeSnippetForComparison(removedSnippet);
  if (!normalizedAdded || !normalizedRemoved) {
    return false;
  }

  return (
    normalizedAdded !== normalizedRemoved &&
    normalizedAdded.includes(normalizedRemoved)
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

export function InstructionUpdatesPanel({ events, className }: InstructionUpdatesPanelProps) {
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
      updateEvents.find(
        (event) => event.id === selectedSourceEventId && event.eventType === "updated",
      ) ?? null,
    [selectedSourceEventId, updateEvents],
  );

  useEffect(() => {
    if (!showUpdates && !selectedSourceEventId) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (selectedSourceEventId) {
        setSelectedSourceEventId(null);
        return;
      }

      setShowUpdates(false);
    };

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [selectedSourceEventId, showUpdates]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    if (!showUpdates && !selectedSourceEventId) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [selectedSourceEventId, showUpdates]);

  if (events.length === 0) {
    return null;
  }

  const updatesModal = showUpdates ? (
    <div
      className="dark fixed inset-0 z-[210] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={() => {
        setShowUpdates(false);
        setSelectedSourceEventId(null);
      }}
    >
      <article
        className="flex w-full max-w-3xl max-h-[76dvh] flex-col overflow-hidden rounded-2xl border border-white/20 bg-slate-950/96 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Instruction updates"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-4 md:px-5">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-slate-100">Instruction Updates</h2>
            <p className="text-xs text-slate-300">
              {updateEvents.length} update event{updateEvents.length === 1 ? "" : "s"} captured
              since original.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowUpdates(false);
              setSelectedSourceEventId(null);
            }}
            className="inline-flex items-center rounded-lg border border-slate-500/45 bg-slate-900/40 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-slate-800/60"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
          {updateEvents.length === 0 ? (
            <p className="rounded-xl border border-slate-500/40 bg-slate-900/40 p-3 text-sm text-slate-300">
              No updates were recorded after the original version.
            </p>
          ) : (
            <div className="grid gap-2">
              {[...updateEvents].reverse().map((event) => (
                <article
                  key={event.id}
                  className="min-h-24 rounded-xl border border-slate-300/40 bg-slate-900/45 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-slate-300">
                      <LocalDateTime value={event.occurredAt} mode="dateTime" /> by{" "}
                      <span className="font-semibold text-slate-100">{event.actorName}</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => setSelectedSourceEventId(event.id)}
                      className={cn(
                        "inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-semibold transition",
                        hasSourcePayloadData(event.sourcePayload)
                          ? "border-cyan-500/45 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25"
                          : "border-slate-500/45 bg-slate-900/30 text-slate-200 hover:bg-slate-800/60",
                      )}
                    >
                      View Source
                    </button>
                  </div>
                  <p className="mt-1 text-sm text-slate-200">{event.detail}</p>
                </article>
              ))}
            </div>
          )}
        </div>
      </article>
    </div>
  ) : null;

  const sourceModal = selectedSourceEvent ? (
    <div
      className="dark fixed inset-0 z-[220] overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={() => setSelectedSourceEventId(null)}
    >
      <div className="flex min-h-full items-start justify-center py-2 md:py-6">
        <article
          className="grid w-full max-w-3xl gap-3 rounded-2xl border border-white/20 bg-slate-950/95 p-5 shadow-2xl md:max-h-[calc(100dvh-3rem)] md:overflow-y-auto"
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

              {selectedSourceEvent.sourcePayload?.removedTextSnippet &&
              !shouldSuppressRemovedSnippet(selectedSourceEvent.sourcePayload) ? (
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
    </div>
  ) : null;

  const canUsePortal = typeof document !== "undefined";

  return (
    <>
      <button
        type="button"
        onClick={() => setShowUpdates(true)}
        className={cn(
          "inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
          "border-slate-400/45 bg-slate-900/10 text-slate-700 hover:bg-slate-900/15 dark:text-slate-200 dark:hover:bg-white/10",
          className,
        )}
      >
        Show Updates
      </button>

      {canUsePortal && updatesModal ? createPortal(updatesModal, document.body) : null}
      {canUsePortal && sourceModal ? createPortal(sourceModal, document.body) : null}
    </>
  );
}
