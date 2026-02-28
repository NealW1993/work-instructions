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

interface MergePreviewMedia {
  type: "image" | "video";
  src: string;
  caption?: string | null;
  sortOrder: number;
}

interface MergePreviewDiff {
  addedTextSnippet: string;
  removedTextSnippet: string;
  addedMedia: Array<{ type: "image" | "video"; src: string }>;
  removedMedia: Array<{ type: "image" | "video"; src: string }>;
  previousRevision?: number;
  nextRevision?: number;
  changeCount: number;
}

interface InstructionForkMergeControlProps {
  forkInstructionId: string;
  forkNumber: number;
  rootInstructionId: string;
  forkPartId: string;
  rootPartId: string;
  forkItemTitle: string;
  rootItemTitle: string;
  forkDepartmentName: string;
  rootDepartmentName: string;
  forkBodyMarkdown: string;
  rootBodyMarkdown: string;
  forkRevision: number;
  rootRevision: number;
  forkMedia: MergePreviewMedia[];
  rootMedia: MergePreviewMedia[];
  className?: string;
}

const DEFAULT_FIELDS: ForkMergeFieldSelection = {
  department: true,
  partId: true,
  itemTitle: true,
  body: true,
  revision: true,
  media: true,
};

const ALL_FIELDS: ForkMergeFieldSelection = {
  department: true,
  partId: true,
  itemTitle: true,
  body: true,
  revision: true,
  media: true,
};

const MAX_LINE_DIFF_ITEMS = 400;
const MAX_PREVIEW_LINES = 120;
const MAX_PREVIEW_MEDIA_ITEMS = 12;

function normalizeComparableText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeDiffLine(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function richTextToPlain(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function extractDiffLines(content: string) {
  return richTextToPlain(content)
    .split(/\r?\n+/)
    .map(normalizeDiffLine)
    .filter(Boolean);
}

function truncateSnippet(value: string) {
  const lines = value.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= MAX_PREVIEW_LINES) {
    return value;
  }

  return `${lines.slice(0, MAX_PREVIEW_LINES).join("\n")}\n... (${lines.length - MAX_PREVIEW_LINES} more line${lines.length - MAX_PREVIEW_LINES === 1 ? "" : "s"})`;
}

function extractTextChangeSnippet(previousBody: string, nextBody: string) {
  const previousLines = extractDiffLines(previousBody);
  const nextLines = extractDiffLines(nextBody);

  if (
    previousLines.length === nextLines.length &&
    previousLines.every((line, index) => line === nextLines[index])
  ) {
    return {
      addedTextSnippet: "",
      removedTextSnippet: "",
    };
  }

  if (
    previousLines.length > MAX_LINE_DIFF_ITEMS ||
    nextLines.length > MAX_LINE_DIFF_ITEMS
  ) {
    return {
      addedTextSnippet: truncateSnippet(nextLines.join("\n").trim()),
      removedTextSnippet: truncateSnippet(previousLines.join("\n").trim()),
    };
  }

  const previousLength = previousLines.length;
  const nextLength = nextLines.length;
  const lcs: number[][] = Array.from({ length: previousLength + 1 }, () =>
    Array.from({ length: nextLength + 1 }, () => 0),
  );

  for (let previousIndex = previousLength - 1; previousIndex >= 0; previousIndex -= 1) {
    for (let nextIndex = nextLength - 1; nextIndex >= 0; nextIndex -= 1) {
      if (previousLines[previousIndex] === nextLines[nextIndex]) {
        lcs[previousIndex]![nextIndex] = lcs[previousIndex + 1]![nextIndex + 1]! + 1;
      } else {
        lcs[previousIndex]![nextIndex] = Math.max(
          lcs[previousIndex + 1]![nextIndex]!,
          lcs[previousIndex]![nextIndex + 1]!,
        );
      }
    }
  }

  const addedLines: string[] = [];
  const removedLines: string[] = [];
  let previousIndex = 0;
  let nextIndex = 0;

  while (previousIndex < previousLength && nextIndex < nextLength) {
    if (previousLines[previousIndex] === nextLines[nextIndex]) {
      previousIndex += 1;
      nextIndex += 1;
      continue;
    }

    if (lcs[previousIndex + 1]![nextIndex]! >= lcs[previousIndex]![nextIndex + 1]!) {
      removedLines.push(previousLines[previousIndex]!);
      previousIndex += 1;
    } else {
      addedLines.push(nextLines[nextIndex]!);
      nextIndex += 1;
    }
  }

  while (previousIndex < previousLength) {
    removedLines.push(previousLines[previousIndex]!);
    previousIndex += 1;
  }

  while (nextIndex < nextLength) {
    addedLines.push(nextLines[nextIndex]!);
    nextIndex += 1;
  }

  return {
    addedTextSnippet: truncateSnippet(addedLines.join("\n").trim()),
    removedTextSnippet: truncateSnippet(removedLines.join("\n").trim()),
  };
}

function buildMediaComparisonKey(media: MergePreviewMedia) {
  const src = media.src.trim();
  const caption = media.caption?.trim() ?? "";
  return `${media.type}|${src}|${caption}|${media.sortOrder}`;
}

function normalizePreviewMedia(media: MergePreviewMedia) {
  const src = media.src.trim();
  if (!src) {
    return null;
  }

  return {
    type: media.type,
    src,
  } as const;
}

function buildMergePreviewDiff(params: {
  selectedFields: ForkMergeFieldSelection;
  forkPartId: string;
  rootPartId: string;
  forkItemTitle: string;
  rootItemTitle: string;
  forkDepartmentName: string;
  rootDepartmentName: string;
  forkBodyMarkdown: string;
  rootBodyMarkdown: string;
  forkRevision: number;
  rootRevision: number;
  forkMedia: MergePreviewMedia[];
  rootMedia: MergePreviewMedia[];
}): MergePreviewDiff {
  const addedTextLines: string[] = [];
  const removedTextLines: string[] = [];
  let changeCount = 0;

  if (params.selectedFields.partId) {
    const previousPartId = params.rootPartId.trim();
    const nextPartId = params.forkPartId.trim();
    if (normalizeComparableText(previousPartId) !== normalizeComparableText(nextPartId)) {
      removedTextLines.push(`Part ID: ${previousPartId || "(empty)"}`);
      addedTextLines.push(`Part ID: ${nextPartId || "(empty)"}`);
      changeCount += 1;
    }
  }

  if (params.selectedFields.itemTitle) {
    const previousItemTitle = params.rootItemTitle.trim();
    const nextItemTitle = params.forkItemTitle.trim();
    if (
      normalizeComparableText(previousItemTitle) !==
      normalizeComparableText(nextItemTitle)
    ) {
      removedTextLines.push(`Title: ${previousItemTitle || "(empty)"}`);
      addedTextLines.push(`Title: ${nextItemTitle || "(empty)"}`);
      changeCount += 1;
    }
  }

  if (params.selectedFields.department) {
    const previousDepartment = params.rootDepartmentName.trim();
    const nextDepartment = params.forkDepartmentName.trim();
    if (
      normalizeComparableText(previousDepartment) !==
      normalizeComparableText(nextDepartment)
    ) {
      removedTextLines.push(`Department: ${previousDepartment || "(empty)"}`);
      addedTextLines.push(`Department: ${nextDepartment || "(empty)"}`);
      changeCount += 1;
    }
  }

  if (params.selectedFields.body) {
    const bodySnippet = extractTextChangeSnippet(
      params.rootBodyMarkdown,
      params.forkBodyMarkdown,
    );

    if (bodySnippet.removedTextSnippet) {
      removedTextLines.push(bodySnippet.removedTextSnippet);
    }
    if (bodySnippet.addedTextSnippet) {
      addedTextLines.push(bodySnippet.addedTextSnippet);
    }

    if (bodySnippet.addedTextSnippet || bodySnippet.removedTextSnippet) {
      changeCount += 1;
    }
  }

  let previousRevision: number | undefined;
  let nextRevision: number | undefined;
  if (params.selectedFields.revision) {
    const previous = Math.max(1, params.rootRevision);
    const next = Math.max(1, params.forkRevision);
    if (previous !== next) {
      previousRevision = previous;
      nextRevision = next;
      changeCount += 1;
    }
  }

  const rootMediaByKey = new Map<string, { type: "image" | "video"; src: string }>();
  const forkMediaByKey = new Map<string, { type: "image" | "video"; src: string }>();

  if (params.selectedFields.media) {
    for (const media of params.rootMedia) {
      const normalizedMedia = normalizePreviewMedia(media);
      if (!normalizedMedia) {
        continue;
      }
      const key = buildMediaComparisonKey(media);
      if (!rootMediaByKey.has(key)) {
        rootMediaByKey.set(key, normalizedMedia);
      }
    }

    for (const media of params.forkMedia) {
      const normalizedMedia = normalizePreviewMedia(media);
      if (!normalizedMedia) {
        continue;
      }
      const key = buildMediaComparisonKey(media);
      if (!forkMediaByKey.has(key)) {
        forkMediaByKey.set(key, normalizedMedia);
      }
    }
  }

  const addedMedia =
    params.selectedFields.media
      ? Array.from(forkMediaByKey.entries())
          .filter(([key]) => !rootMediaByKey.has(key))
          .map(([, media]) => media)
      : [];

  const removedMedia =
    params.selectedFields.media
      ? Array.from(rootMediaByKey.entries())
          .filter(([key]) => !forkMediaByKey.has(key))
          .map(([, media]) => media)
      : [];

  if (params.selectedFields.media && (addedMedia.length > 0 || removedMedia.length > 0)) {
    changeCount += 1;
  }

  return {
    addedTextSnippet: addedTextLines.join("\n").trim(),
    removedTextSnippet: removedTextLines.join("\n").trim(),
    addedMedia,
    removedMedia,
    previousRevision,
    nextRevision,
    changeCount,
  };
}

export function InstructionForkMergeControl({
  forkInstructionId,
  forkNumber,
  rootInstructionId,
  forkPartId,
  rootPartId,
  forkItemTitle,
  rootItemTitle,
  forkDepartmentName,
  rootDepartmentName,
  forkBodyMarkdown,
  rootBodyMarkdown,
  forkRevision,
  rootRevision,
  forkMedia,
  rootMedia,
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
  const selectedFields = useMemo(
    () => (mergeMode === "overwrite" ? ALL_FIELDS : fields),
    [fields, mergeMode],
  );
  const selectedFieldCount = useMemo(
    () => Object.values(selectedFields).filter(Boolean).length,
    [selectedFields],
  );
  const mergePreview = useMemo(
    () =>
      buildMergePreviewDiff({
        selectedFields,
        forkPartId,
        rootPartId,
        forkItemTitle,
        rootItemTitle,
        forkDepartmentName,
        rootDepartmentName,
        forkBodyMarkdown,
        rootBodyMarkdown,
        forkRevision,
        rootRevision,
        forkMedia,
        rootMedia,
      }),
    [
      selectedFields,
      forkPartId,
      rootPartId,
      forkItemTitle,
      rootItemTitle,
      forkDepartmentName,
      rootDepartmentName,
      forkBodyMarkdown,
      rootBodyMarkdown,
      forkRevision,
      rootRevision,
      forkMedia,
      rootMedia,
    ],
  );
  const potentialMergePreview = useMemo(
    () =>
      buildMergePreviewDiff({
        selectedFields: ALL_FIELDS,
        forkPartId,
        rootPartId,
        forkItemTitle,
        rootItemTitle,
        forkDepartmentName,
        rootDepartmentName,
        forkBodyMarkdown,
        rootBodyMarkdown,
        forkRevision,
        rootRevision,
        forkMedia,
        rootMedia,
      }),
    [
      forkPartId,
      rootPartId,
      forkItemTitle,
      rootItemTitle,
      forkDepartmentName,
      rootDepartmentName,
      forkBodyMarkdown,
      rootBodyMarkdown,
      forkRevision,
      rootRevision,
      forkMedia,
      rootMedia,
    ],
  );

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
        {potentialMergePreview.changeCount > 0 ? (
          <span
            className="inline-flex min-w-[1.2rem] items-center justify-center rounded-full border border-emerald-500/45 bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold leading-none text-emerald-900 dark:text-emerald-100"
            title={`${potentialMergePreview.changeCount} change${potentialMergePreview.changeCount === 1 ? "" : "s"} detected`}
          >
            {potentialMergePreview.changeCount}
          </span>
        ) : null}
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

                <div className="grid gap-2 rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                    Merge Preview
                  </p>
                  <p className="text-xs text-slate-400">
                    Preview is based on the currently selected fields.
                  </p>
                  {selectedFieldCount === 0 ? (
                    <p className="rounded-lg border border-slate-600 bg-slate-900/70 px-3 py-2 text-sm text-slate-300">
                      Select at least one field to preview merge changes.
                    </p>
                  ) : mergePreview.changeCount === 0 ? (
                    <p className="rounded-lg border border-slate-600 bg-slate-900/70 px-3 py-2 text-sm text-slate-300">
                      No differences detected for the selected fields.
                    </p>
                  ) : (
                    <div className="grid gap-2">
                      {mergePreview.removedTextSnippet ? (
                        <div className="grid gap-1.5">
                          <p className="text-xs font-semibold uppercase tracking-wide text-rose-300">
                            Removed From Original
                          </p>
                          <pre className="max-h-40 overflow-auto rounded-lg border border-rose-500/35 bg-rose-500/10 p-3 text-xs text-rose-100 whitespace-pre-wrap">
                            {mergePreview.removedTextSnippet}
                          </pre>
                        </div>
                      ) : null}
                      {mergePreview.addedTextSnippet ? (
                        <div className="grid gap-1.5">
                          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                            Added From Fork
                          </p>
                          <pre className="max-h-40 overflow-auto rounded-lg border border-emerald-500/35 bg-emerald-500/10 p-3 text-xs text-emerald-100 whitespace-pre-wrap">
                            {mergePreview.addedTextSnippet}
                          </pre>
                        </div>
                      ) : null}

                      {mergePreview.previousRevision !== undefined &&
                      mergePreview.nextRevision !== undefined ? (
                        <p className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                          Revision {mergePreview.previousRevision} to {mergePreview.nextRevision}
                        </p>
                      ) : null}

                      {mergePreview.removedMedia.length > 0 ? (
                        <div className="grid gap-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-rose-300">
                            Removed Media ({mergePreview.removedMedia.length})
                          </p>
                          <ul className="grid gap-1">
                            {mergePreview.removedMedia
                              .slice(0, MAX_PREVIEW_MEDIA_ITEMS)
                              .map((media) => (
                                <li
                                  key={`remove:${media.type}:${media.src}`}
                                  className="truncate rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-100"
                                  title={media.src}
                                >
                                  {media.type.toUpperCase()} | {media.src}
                                </li>
                              ))}
                          </ul>
                          {mergePreview.removedMedia.length > MAX_PREVIEW_MEDIA_ITEMS ? (
                            <p className="text-xs text-rose-200/90">
                              +{mergePreview.removedMedia.length - MAX_PREVIEW_MEDIA_ITEMS} more
                              removed media item
                              {mergePreview.removedMedia.length - MAX_PREVIEW_MEDIA_ITEMS === 1
                                ? ""
                                : "s"}
                              .
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {mergePreview.addedMedia.length > 0 ? (
                        <div className="grid gap-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                            Added Media ({mergePreview.addedMedia.length})
                          </p>
                          <ul className="grid gap-1">
                            {mergePreview.addedMedia
                              .slice(0, MAX_PREVIEW_MEDIA_ITEMS)
                              .map((media) => (
                                <li
                                  key={`add:${media.type}:${media.src}`}
                                  className="truncate rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-100"
                                  title={media.src}
                                >
                                  {media.type.toUpperCase()} | {media.src}
                                </li>
                              ))}
                          </ul>
                          {mergePreview.addedMedia.length > MAX_PREVIEW_MEDIA_ITEMS ? (
                            <p className="text-xs text-emerald-200/90">
                              +{mergePreview.addedMedia.length - MAX_PREVIEW_MEDIA_ITEMS} more
                              added media item
                              {mergePreview.addedMedia.length - MAX_PREVIEW_MEDIA_ITEMS === 1
                                ? ""
                                : "s"}
                              .
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

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
