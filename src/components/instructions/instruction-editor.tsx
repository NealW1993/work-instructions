"use client";

import { useHydrated } from "@/lib/use-hydrated";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Loader2,
  Sparkles,
  Wrench,
  UploadCloud,
} from "lucide-react";
import { createPortal } from "react-dom";

import { FloatingStatusNotices } from "@/components/ui/floating-status-notices";
import { hasMeaningfulContent, isHtmlContent, normalizeEditorContent, toMarkdownSource } from "@/lib/editor-content";
import { sanitizeRichHtml } from "@/lib/rich-text-html";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { EditorDialog } from "@/components/ui/editor-blocks";
import { registerArchivedInstructionRedirect } from "@/components/instructions/instruction-archived-redirect-state";
import { ISO_9001_CLAUSE_OPTIONS } from "@/lib/process-documents";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn, drainResponse, escapeLikeQuery } from "@/lib/utils";

interface InstructionEditorProps {
  mode: "create" | "edit" | "fork";
  initialData?: {
    instructionId?: string;
    updatedAt?: string;
    approvalStatus?: string;
    sourceInstructionId?: string;
    forkRootInstructionId?: string | null;
    forkNumber?: number | null;
    mergedIntoRootAt?: string | null;
    mergeCount?: number;
    workItemId?: string;
    departmentId?: string;
    partId: string;
    itemTitle: string;
    bodyMarkdown: string;
    revision: number;
    suggestedToolIds?: string[];
    uncommonTools?: string;
    isoClauseRefs?: string[];
    processScope?: string;
    acceptanceCriteria?: string;
    verificationRecords?: string;
    riskControls?: string;
  };
}

interface WorkItemSearchResult {
  id: string;
  department_id: string;
  part_id: string;
  item_title: string;
  departments:
    | {
        name: string;
      }
    | Array<{
        name: string;
      }>
    | null;
}

interface DepartmentOption {
  id: string;
  name: string;
}

interface EditorSnapshot {
  departmentId: string;
  partId: string;
  itemTitle: string;
  bodyMarkdown: string;
  revision: number;
  selectedToolIds: string[];
  uncommonTools: string;
  isoClauseRefs: string[];
  processScope: string;
  acceptanceCriteria: string;
  verificationRecords: string;
  riskControls: string;
}

interface SuggestedToolOption {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

interface InstructionChangeSourceMedia {
  type: "image" | "video";
  src: string;
}

interface InstructionChangeSourceFieldChange {
  label: string;
  previousValue: string;
  nextValue: string;
}

interface InstructionChangeSourcePayload {
  addedTextSnippet?: string;
  removedTextSnippet?: string;
  addedMedia?: InstructionChangeSourceMedia[];
  removedMedia?: InstructionChangeSourceMedia[];
  previousRevision?: number;
  nextRevision?: number;
  mediaFormattingUpdated?: boolean;
  fieldChanges?: InstructionChangeSourceFieldChange[];
}

interface InstructionChangeComputation {
  summary: string;
  sourcePayload: InstructionChangeSourcePayload | null;
}

type PendingNavigation =
  | {
      kind: "history-back";
    }
  | {
      kind: "internal-link";
      href: string;
    }
  | {
      kind: "external-link";
      href: string;
    };

interface RevisionConflictModalState {
  existingInstructionId: string;
  existingRevision: number;
  requestedRevision: number;
  partId: string;
  itemTitle: string;
  departmentName: string;
}

interface RevisionBumpConfirmationState {
  currentRevision: number;
  nextRevision: number;
}

interface FieldErrors {
  department: boolean;
  partId: boolean;
  itemTitle: boolean;
  revision: boolean;
  body: boolean;
}

interface EnhanceInstructionResponse {
  generationId?: string;
  enhancedContent?: string;
  originalContent?: string;
  enhancementNotes?: string;
  error?: string;
}

interface EnhancementComparisonState {
  generationId: string | null;
  originalContent: string;
  enhancedContent: string;
  enhancementNotes: string;
  sourceSnapshot: string;
}

type PendingCommonToolChange = "save" | "remove";
interface PendingCommonToolChangeEntry {
  name: string;
  change: PendingCommonToolChange;
}

const DEFAULT_FIELD_ERRORS: FieldErrors = {
  department: false,
  partId: false,
  itemTitle: false,
  revision: false,
  body: false,
};

const DEFAULT_INSTRUCTION_ISO_CLAUSES = [
  "7.5 Documented information",
  "8.5 Production and service provision",
  "8.6 Release of products and services",
];

const HISTORY_GUARD_STATE_KEY = "__instructionEditorUnsavedGuard";

function richTextToPlain(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

const MAX_LINE_DIFF_ITEMS = 400;

function normalizeDiffLine(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function getOrderedListIndex(item: Element) {
  const parent = item.parentElement;
  if (!parent) {
    return 1;
  }

  const listItems = Array.from(parent.children).filter((child) => child.tagName === "LI");
  const index = listItems.indexOf(item);
  return index >= 0 ? index + 1 : 1;
}

function extractSemanticDiffLines(content: string) {
  const normalizedContent = normalizeEditorContent(content);
  if (!normalizedContent) {
    return [] as string[];
  }

  const fallbackLines = richTextToPlain(normalizedContent)
    .split(/\r?\n+/)
    .map(normalizeDiffLine)
    .filter(Boolean);

  if (typeof DOMParser === "undefined") {
    return fallbackLines;
  }

  try {
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(
      `<article>${normalizedContent}</article>`,
      "text/html",
    );
    const root = documentNode.body.firstElementChild;
    if (!root) {
      return fallbackLines;
    }

    const lines: string[] = [];
    const lineNodes = root.querySelectorAll("h1,h2,h3,p,blockquote,pre,li");

    for (const node of lineNodes) {
      const tagName = node.tagName.toUpperCase();
      if (tagName !== "LI") {
        const inListItem = node.parentElement?.closest("li");
        if (inListItem) {
          continue;
        }
      }

      if (tagName === "LI") {
        const clone = node.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("ol,ul").forEach((listNode) => listNode.remove());
        const listItemText = normalizeDiffLine(clone.textContent ?? "");
        if (!listItemText) {
          continue;
        }

        const isTaskItem = node.getAttribute("data-type") === "taskItem";
        if (isTaskItem) {
          const taskMarker = node.getAttribute("data-checked") === "true" ? "[x]" : "[ ]";
          lines.push(`${taskMarker} ${listItemText}`);
          continue;
        }

        const parentTagName = node.parentElement?.tagName.toUpperCase();
        const marker =
          parentTagName === "OL"
            ? `${getOrderedListIndex(node)}.`
            : parentTagName === "UL"
              ? "-"
              : "";
        lines.push(marker ? `${marker} ${listItemText}` : listItemText);
        continue;
      }

      if (tagName === "PRE") {
        const codeLines = (node.textContent ?? "")
          .replace(/\u00a0/g, " ")
          .split(/\r?\n+/)
          .map((line) => line.trimEnd())
          .filter((line) => line.trim().length > 0);
        for (const codeLine of codeLines) {
          lines.push(codeLine);
        }
        continue;
      }

      const text = normalizeDiffLine(node.textContent ?? "");
      if (!text) {
        continue;
      }

      if (tagName === "H1" || tagName === "H2" || tagName === "H3") {
        const level = Number.parseInt(tagName.slice(1), 10);
        lines.push(`${"#".repeat(Number.isFinite(level) ? level : 1)} ${text}`);
        continue;
      }

      if (tagName === "BLOCKQUOTE") {
        lines.push(`> ${text}`);
        continue;
      }

      lines.push(text);
    }

    return lines.length > 0 ? lines : fallbackLines;
  } catch {
    return fallbackLines;
  }
}

function formatPartId(partId: string) {
  return partId.trim();
}

function normalizeSubmissionError(error: unknown) {
  return error instanceof Error ? error.message : "Save failed";
}

function normalizeSnapshotValue(value: string) {
  return value.trim();
}

function normalizeInstructionIsoClauseRefs(value: string[] | null | undefined) {
  const allowed = new Set<string>(ISO_9001_CLAUSE_OPTIONS);
  return Array.from(
    new Set((value ?? []).map((entry) => entry.trim()).filter((entry) => allowed.has(entry))),
  );
}

function normalizeInstructionIsoClauseRefsOrDefault(value: string[] | null | undefined) {
  const normalized = normalizeInstructionIsoClauseRefs(value);

  return normalized.length > 0 ? normalized : DEFAULT_INSTRUCTION_ISO_CLAUSES;
}

function parseToolNameList(value: string) {
  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const name of parsed) {
    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(name);
  }

  return deduped;
}

function mergeToolNameLists(current: string[], additions: string[]) {
  const merged: string[] = [...current];
  const seen = new Set(current.map((entry) => entry.trim().toLowerCase()).filter(Boolean));

  for (const name of additions) {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(name.trim());
  }

  return merged;
}

function serializeToolNameList(value: string[]) {
  return value.map((entry) => entry.trim()).filter(Boolean).join(", ");
}

function normalizeToolName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function compareToolNames(firstName: string, secondName: string) {
  const firstStartsWithNumber = /^\d/.test(firstName.trim());
  const secondStartsWithNumber = /^\d/.test(secondName.trim());
  if (firstStartsWithNumber !== secondStartsWithNumber) {
    return firstStartsWithNumber ? -1 : 1;
  }

  return firstName.localeCompare(secondName, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function buildSnapshot(data: {
  departmentId: string;
  partId: string;
  itemTitle: string;
  bodyMarkdown: string;
  revision: number;
  selectedToolIds: string[];
  uncommonTools: string;
  isoClauseRefs: string[];
  processScope: string;
  acceptanceCriteria: string;
  verificationRecords: string;
  riskControls: string;
}): EditorSnapshot {
  const normalizedToolIds = Array.from(
    new Set(data.selectedToolIds.map((value) => value.trim()).filter(Boolean)),
  ).sort((first, second) => first.localeCompare(second));

  return {
    departmentId: normalizeSnapshotValue(data.departmentId),
    partId: normalizeSnapshotValue(data.partId),
    itemTitle: normalizeSnapshotValue(data.itemTitle),
    bodyMarkdown: toMarkdownSource(data.bodyMarkdown).trimEnd(),
    revision: data.revision,
    selectedToolIds: normalizedToolIds,
    uncommonTools: normalizeSnapshotValue(data.uncommonTools),
    isoClauseRefs: normalizeInstructionIsoClauseRefs(data.isoClauseRefs).sort((first, second) =>
      first.localeCompare(second),
    ),
    processScope: normalizeSnapshotValue(data.processScope),
    acceptanceCriteria: normalizeSnapshotValue(data.acceptanceCriteria),
    verificationRecords: normalizeSnapshotValue(data.verificationRecords),
    riskControls: normalizeSnapshotValue(data.riskControls),
  };
}

function extractInlineMediaDetails(content: string) {
  const normalizedContent = normalizeEditorContent(content);
  const imageSources = new Set<string>();
  const videoSources = new Set<string>();
  const mediaPattern = /<(img|video)\b[^>]*\bsrc=(["'])(.*?)\2[^>]*>/gi;

  let match = mediaPattern.exec(normalizedContent);
  while (match) {
    const mediaTag = match[1]?.toLowerCase();
    const source = match[3]?.trim();
    if (source) {
      if (mediaTag === "img") {
        imageSources.add(source);
      } else if (mediaTag === "video") {
        videoSources.add(source);
      }
    }

    match = mediaPattern.exec(normalizedContent);
  }

  return {
    imageSources,
    videoSources,
    allSources: new Set([...imageSources, ...videoSources]),
  };
}

function extractMediaMarkupSignatures(content: string) {
  const normalizedContent = normalizeEditorContent(content);
  const mediaMarkupPattern = /<(figure|img|video)\b[^>]*>/gi;
  const signatures: string[] = [];

  let match = mediaMarkupPattern.exec(normalizedContent);
  while (match) {
    signatures.push((match[0] ?? "").replace(/\s+/g, " ").trim());
    match = mediaMarkupPattern.exec(normalizedContent);
  }

  return signatures;
}

function collectAddedMedia(
  nextSources: Set<string>,
  previousSources: Set<string>,
  mediaType: "image" | "video",
) {
  const added: InstructionChangeSourceMedia[] = [];
  for (const source of nextSources) {
    if (!previousSources.has(source)) {
      added.push({
        type: mediaType,
        src: source,
      });
    }
  }
  return added;
}

function collectRemovedMedia(
  previousSources: Set<string>,
  nextSources: Set<string>,
  mediaType: "image" | "video",
) {
  const removed: InstructionChangeSourceMedia[] = [];
  for (const source of previousSources) {
    if (!nextSources.has(source)) {
      removed.push({
        type: mediaType,
        src: source,
      });
    }
  }
  return removed;
}

function extractTextChangeSnippet(previousBody: string, nextBody: string) {
  const previousLines = extractSemanticDiffLines(previousBody);
  const nextLines = extractSemanticDiffLines(nextBody);

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
      addedTextSnippet: nextLines.join("\n").trim(),
      removedTextSnippet: previousLines.join("\n").trim(),
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
    addedTextSnippet: addedLines.join("\n").trim(),
    removedTextSnippet: removedLines.join("\n").trim(),
  };
}

function hasSourcePayloadData(sourcePayload: InstructionChangeSourcePayload) {
  return Boolean(
    sourcePayload.addedTextSnippet ||
      sourcePayload.removedTextSnippet ||
      (sourcePayload.addedMedia?.length ?? 0) > 0 ||
      (sourcePayload.removedMedia?.length ?? 0) > 0 ||
      (sourcePayload.fieldChanges?.length ?? 0) > 0 ||
      sourcePayload.mediaFormattingUpdated ||
      sourcePayload.previousRevision !== undefined ||
      sourcePayload.nextRevision !== undefined,
  );
}

function countAddedMedia(nextSources: Set<string>, previousSources: Set<string>) {
  let count = 0;
  for (const source of nextSources) {
    if (!previousSources.has(source)) {
      count += 1;
    }
  }
  return count;
}

function countRemovedMedia(previousSources: Set<string>, nextSources: Set<string>) {
  let count = 0;
  for (const source of previousSources) {
    if (!nextSources.has(source)) {
      count += 1;
    }
  }
  return count;
}

function summarizeListForAudit(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean).join(", ") || "None";
}

function summarizeValueForAudit(value: string) {
  return value.trim() || "Blank";
}

function addFieldChange(
  fieldChanges: InstructionChangeSourceFieldChange[],
  label: string,
  previousValue: string,
  nextValue: string,
) {
  const normalizedPrevious = previousValue.trim().replace(/\s+/g, " ");
  const normalizedNext = nextValue.trim().replace(/\s+/g, " ");
  if (normalizedPrevious === normalizedNext) {
    return;
  }

  fieldChanges.push({
    label,
    previousValue: summarizeValueForAudit(previousValue),
    nextValue: summarizeValueForAudit(nextValue),
  });
}

function buildInstructionUpdateSummary(params: {
  previousBody: string;
  nextBody: string;
  previousRevision: number;
  nextRevision: number;
  previousDepartmentId: string;
  nextDepartmentId: string;
  previousPartId: string;
  nextPartId: string;
  previousItemTitle: string;
  nextItemTitle: string;
  previousIsoClauseRefs: string[];
  nextIsoClauseRefs: string[];
  previousProcessScope: string;
  nextProcessScope: string;
  previousAcceptanceCriteria: string;
  nextAcceptanceCriteria: string;
  previousVerificationRecords: string;
  nextVerificationRecords: string;
  previousRiskControls: string;
  nextRiskControls: string;
  previousSuggestedToolIds: string[];
  nextSuggestedToolIds: string[];
  previousUncommonTools: string;
  nextUncommonTools: string;
}): InstructionChangeComputation {
  const previousNormalized = normalizeEditorContent(params.previousBody);
  const nextNormalized = normalizeEditorContent(params.nextBody);
  const summaryParts: string[] = [];
  const sourcePayload: InstructionChangeSourcePayload = {};

  const previousPlainTextRaw = richTextToPlain(previousNormalized);
  const nextPlainTextRaw = richTextToPlain(nextNormalized);
  const previousPlainText = previousPlainTextRaw.replace(/\s+/g, " ").trim();
  const nextPlainText = nextPlainTextRaw.replace(/\s+/g, " ").trim();
  const characterDelta = nextPlainText.length - previousPlainText.length;
  const previousSemanticText = extractSemanticDiffLines(previousNormalized).join("\n");
  const nextSemanticText = extractSemanticDiffLines(nextNormalized).join("\n");

  if (previousSemanticText !== nextSemanticText) {
    const textSnippet = extractTextChangeSnippet(previousNormalized, nextNormalized);
    if (textSnippet.addedTextSnippet) {
      sourcePayload.addedTextSnippet = textSnippet.addedTextSnippet;
    }
    if (textSnippet.removedTextSnippet) {
      sourcePayload.removedTextSnippet = textSnippet.removedTextSnippet;
    }

    if (characterDelta > 0) {
      summaryParts.push(`${characterDelta} characters added`);
    } else if (characterDelta < 0) {
      summaryParts.push(`${Math.abs(characterDelta)} characters removed`);
    } else {
      summaryParts.push("Instruction text edited");
    }
  }

  const previousMedia = extractInlineMediaDetails(previousNormalized);
  const nextMedia = extractInlineMediaDetails(nextNormalized);

  const addedImages = countAddedMedia(nextMedia.imageSources, previousMedia.imageSources);
  const removedImages = countRemovedMedia(previousMedia.imageSources, nextMedia.imageSources);
  const addedVideos = countAddedMedia(nextMedia.videoSources, previousMedia.videoSources);
  const removedVideos = countRemovedMedia(previousMedia.videoSources, nextMedia.videoSources);
  const addedMediaCount = addedImages + addedVideos;
  const removedMediaCount = removedImages + removedVideos;
  const addedMedia = [
    ...collectAddedMedia(nextMedia.imageSources, previousMedia.imageSources, "image"),
    ...collectAddedMedia(nextMedia.videoSources, previousMedia.videoSources, "video"),
  ];
  const removedMedia = [
    ...collectRemovedMedia(previousMedia.imageSources, nextMedia.imageSources, "image"),
    ...collectRemovedMedia(previousMedia.videoSources, nextMedia.videoSources, "video"),
  ];

  if (addedMedia.length > 0) {
    sourcePayload.addedMedia = addedMedia;
  }
  if (removedMedia.length > 0) {
    sourcePayload.removedMedia = removedMedia;
  }

  if (addedImages > 0) {
    summaryParts.push(`Image${addedImages === 1 ? "" : "s"} added (+${addedImages})`);
  }
  if (removedImages > 0) {
    summaryParts.push(`Image${removedImages === 1 ? "" : "s"} removed (-${removedImages})`);
  }
  if (addedVideos > 0) {
    summaryParts.push(`Video${addedVideos === 1 ? "" : "s"} added (+${addedVideos})`);
  }
  if (removedVideos > 0) {
    summaryParts.push(`Video${removedVideos === 1 ? "" : "s"} removed (-${removedVideos})`);
  }

  const previousMediaMarkupSignatures = extractMediaMarkupSignatures(previousNormalized);
  const nextMediaMarkupSignatures = extractMediaMarkupSignatures(nextNormalized);
  const mediaMarkupChanged =
    previousMediaMarkupSignatures.length === nextMediaMarkupSignatures.length
      ? previousMediaMarkupSignatures.some(
          (signature, index) => signature !== nextMediaMarkupSignatures[index],
        )
      : previousMediaMarkupSignatures.length !== nextMediaMarkupSignatures.length;

  if (
    (previousMedia.allSources.size > 0 || nextMedia.allSources.size > 0) &&
    mediaMarkupChanged &&
    addedMediaCount === 0 &&
    removedMediaCount === 0
  ) {
    summaryParts.push("Media formatting updated");
    sourcePayload.mediaFormattingUpdated = true;
  }

  const fieldChanges: InstructionChangeSourceFieldChange[] = [];
  addFieldChange(
    fieldChanges,
    "Department",
    params.previousDepartmentId,
    params.nextDepartmentId,
  );
  addFieldChange(fieldChanges, "Part ID", params.previousPartId, params.nextPartId);
  addFieldChange(fieldChanges, "Work Item Title", params.previousItemTitle, params.nextItemTitle);
  addFieldChange(
    fieldChanges,
    "ISO 9001 clauses",
    summarizeListForAudit(normalizeInstructionIsoClauseRefs(params.previousIsoClauseRefs)),
    summarizeListForAudit(normalizeInstructionIsoClauseRefs(params.nextIsoClauseRefs)),
  );
  addFieldChange(
    fieldChanges,
    "Process scope / applicability",
    params.previousProcessScope,
    params.nextProcessScope,
  );
  addFieldChange(
    fieldChanges,
    "Acceptance criteria",
    params.previousAcceptanceCriteria,
    params.nextAcceptanceCriteria,
  );
  addFieldChange(
    fieldChanges,
    "Verification records",
    params.previousVerificationRecords,
    params.nextVerificationRecords,
  );
  addFieldChange(fieldChanges, "Risk controls", params.previousRiskControls, params.nextRiskControls);
  addFieldChange(
    fieldChanges,
    "Suggested tools",
    summarizeListForAudit(params.previousSuggestedToolIds),
    summarizeListForAudit(params.nextSuggestedToolIds),
  );
  addFieldChange(
    fieldChanges,
    "Uncommon tools",
    params.previousUncommonTools,
    params.nextUncommonTools,
  );

  if (fieldChanges.length > 0) {
    sourcePayload.fieldChanges = fieldChanges;
    summaryParts.push(
      `${fieldChanges.length} instruction detail${fieldChanges.length === 1 ? "" : "s"} updated`,
    );
  }

  if (params.previousRevision !== params.nextRevision) {
    summaryParts.push(`Revision ${params.previousRevision} -> ${params.nextRevision}`);
    sourcePayload.previousRevision = params.previousRevision;
    sourcePayload.nextRevision = params.nextRevision;
  }

  if (summaryParts.length === 0) {
    summaryParts.push("Instruction details updated");
  }

  return {
    summary: `${summaryParts.join("; ")}.`,
    sourcePayload: hasSourcePayloadData(sourcePayload) ? sourcePayload : null,
  };
}

function buildInstructionCreateSummary(body: string, revision: number) {
  const normalizedBody = normalizeEditorContent(body);
  const mediaDetails = extractInlineMediaDetails(normalizedBody);
  const textLength = richTextToPlain(normalizedBody).replace(/\s+/g, " ").trim().length;
  const summaryParts: string[] = [`Revision ${revision} created`];

  if (textLength > 0) {
    summaryParts.push(`${textLength} characters in instruction text`);
  }

  if (mediaDetails.imageSources.size > 0) {
    summaryParts.push(
      `${mediaDetails.imageSources.size} image${mediaDetails.imageSources.size === 1 ? "" : "s"} added`,
    );
  }

  if (mediaDetails.videoSources.size > 0) {
    summaryParts.push(
      `${mediaDetails.videoSources.size} video${mediaDetails.videoSources.size === 1 ? "" : "s"} added`,
    );
  }

  return `${summaryParts.join("; ")}.`;
}

function snapshotsAreEqual(a: EditorSnapshot, b: EditorSnapshot) {
  return (
    a.departmentId === b.departmentId &&
    a.partId === b.partId &&
    a.itemTitle === b.itemTitle &&
    a.bodyMarkdown === b.bodyMarkdown &&
    a.revision === b.revision &&
    a.uncommonTools === b.uncommonTools &&
    a.processScope === b.processScope &&
    a.acceptanceCriteria === b.acceptanceCriteria &&
    a.verificationRecords === b.verificationRecords &&
    a.riskControls === b.riskControls &&
    a.isoClauseRefs.length === b.isoClauseRefs.length &&
    a.isoClauseRefs.every((value, index) => value === b.isoClauseRefs[index]) &&
    a.selectedToolIds.length === b.selectedToolIds.length &&
    a.selectedToolIds.every((value, index) => value === b.selectedToolIds[index])
  );
}

function getDepartmentNameFromRelation(
  relation: WorkItemSearchResult["departments"],
): string {
  if (!relation) {
    return "Unknown";
  }

  if (Array.isArray(relation)) {
    return relation[0]?.name ?? "Unknown";
  }

  return relation.name;
}

export function InstructionEditor({ mode, initialData }: InstructionEditorProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [departmentsBusy, setDepartmentsBusy] = useState(false);
  const [departmentId, setDepartmentId] = useState(initialData?.departmentId ?? "");
  const [departmentTouched, setDepartmentTouched] = useState(false);

  const [partId, setPartId] = useState(initialData?.partId ?? "");
  const [partSuggestions, setPartSuggestions] = useState<WorkItemSearchResult[]>([]);
  const [partSearchBusy, setPartSearchBusy] = useState(false);
  const [partSearchOpen, setPartSearchOpen] = useState(false);

  const [, setWorkItemId] = useState<string | null>(
    mode === "edit" ? (initialData?.workItemId ?? null) : null,
  );
  const [itemTitle, setItemTitle] = useState(initialData?.itemTitle ?? "");
  const [bodyMarkdown, setBodyMarkdown] = useState(
    toMarkdownSource(initialData?.bodyMarkdown ?? ""),
  );
  const [legacyBodyConverted] = useState(() => isHtmlContent(initialData?.bodyMarkdown ?? ""));
  const [uploadBusy, setUploadBusy] = useState(false);
  const [revisionReason, setRevisionReason] = useState("");
  const [revision, setRevision] = useState(initialData?.revision ?? 1);
  const [isoClauseRefs, setIsoClauseRefs] = useState<string[]>(() =>
    normalizeInstructionIsoClauseRefsOrDefault(initialData?.isoClauseRefs),
  );
  const [processScope, setProcessScope] = useState(initialData?.processScope ?? "");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(
    initialData?.acceptanceCriteria ?? "",
  );
  const [verificationRecords, setVerificationRecords] = useState(
    initialData?.verificationRecords ?? "",
  );
  const [riskControls, setRiskControls] = useState(initialData?.riskControls ?? "");
  const [suggestedTools, setSuggestedTools] = useState<SuggestedToolOption[]>([]);
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>(
    initialData?.suggestedToolIds ?? [],
  );
  const [uncommonToolList, setUncommonToolList] = useState<string[]>(() =>
    parseToolNameList(initialData?.uncommonTools ?? ""),
  );
  const [uncommonToolsInput, setUncommonToolsInput] = useState("");
  const [toolCatalogBusy, setToolCatalogBusy] = useState(false);
  const [toolCatalogError, setToolCatalogError] = useState<string | null>(null);
  const [toolSetupBusy, setToolSetupBusy] = useState(false);
  const [commonToolInputMode, setCommonToolInputMode] = useState<"type" | "select">("type");
  const [toolPickerToolId, setToolPickerToolId] = useState("");
  const [commonToolSearchInput, setCommonToolSearchInput] = useState("");
  const [commonToolSelectOpen, setCommonToolSelectOpen] = useState(false);
  const [duplicateToolNotice, setDuplicateToolNotice] = useState<string | null>(null);
  const [pendingCommonToolChanges, setPendingCommonToolChanges] = useState<
    Record<string, PendingCommonToolChangeEntry>
  >({});
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(DEFAULT_FIELD_ERRORS);
  const [bodyFocusRequestKey, setBodyFocusRequestKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const portalReady = useHydrated();
  const [navigationModalOpen, setNavigationModalOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [revisionConflictModal, setRevisionConflictModal] =
    useState<RevisionConflictModalState | null>(null);
  const [revisionBumpConfirmationModal, setRevisionBumpConfirmationModal] =
    useState<RevisionBumpConfirmationState | null>(null);
  const [enhanceBusy, setEnhanceBusy] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [enhancementComparison, setEnhancementComparison] =
    useState<EnhancementComparisonState | null>(null);
  const [enhancementModalOpen, setEnhancementModalOpen] = useState(false);
  const [editorParametersOpen, setEditorParametersOpen] = useState(false);
  const [pendingAiEnhancementId, setPendingAiEnhancementId] = useState<string | null>(null);

  const formRef = useRef<HTMLFormElement | null>(null);
  const partInputRef = useRef<HTMLInputElement | null>(null);
  const itemTitleInputRef = useRef<HTMLInputElement | null>(null);
  const commonToolSelectRef = useRef<HTMLDivElement | null>(null);
  const duplicateToolNoticeTimeoutRef = useRef<number | null>(null);
  const hasUnsavedChangesRef = useRef(false);
  const navigationModalOpenRef = useRef(false);
  const historyGuardActiveRef = useRef(false);
  const historyGuardReleaseRef = useRef<Promise<void> | null>(null);
  const suppressNextPopStateRef = useRef(false);
  const pendingNavigationRef = useRef<PendingNavigation | null>(null);
  const navigationBypassRef = useRef(false);
  const confirmedReplacementInstructionIdRef = useRef<string | null>(null);
  const confirmedRevisionBumpRef = useRef(false);

  const initialSnapshot = useMemo(
    () =>
      buildSnapshot({
        departmentId: initialData?.departmentId ?? "",
        partId: initialData?.partId ?? "",
        itemTitle: initialData?.itemTitle ?? "",
        bodyMarkdown: initialData?.bodyMarkdown ?? "",
        revision: initialData?.revision ?? 1,
        selectedToolIds: initialData?.suggestedToolIds ?? [],
        uncommonTools: serializeToolNameList(parseToolNameList(initialData?.uncommonTools ?? "")),
        isoClauseRefs: normalizeInstructionIsoClauseRefsOrDefault(initialData?.isoClauseRefs),
        processScope: initialData?.processScope ?? "",
        acceptanceCriteria: initialData?.acceptanceCriteria ?? "",
        verificationRecords: initialData?.verificationRecords ?? "",
        riskControls: initialData?.riskControls ?? "",
      }),
    [initialData],
  );

  const currentSnapshot = useMemo(
    () =>
      buildSnapshot({
        departmentId,
        partId,
        itemTitle,
        bodyMarkdown,
        revision,
        selectedToolIds,
        uncommonTools: serializeToolNameList(uncommonToolList),
        isoClauseRefs,
        processScope,
        acceptanceCriteria,
        verificationRecords,
        riskControls,
      }),
    [
      acceptanceCriteria,
      bodyMarkdown,
      departmentId,
      isoClauseRefs,
      itemTitle,
      partId,
      processScope,
      revision,
      riskControls,
      selectedToolIds,
      uncommonToolList,
      verificationRecords,
    ],
  );
  const hasPendingCommonToolChanges = useMemo(
    () => Object.keys(pendingCommonToolChanges).length > 0,
    [pendingCommonToolChanges],
  );

  const createModeHasMeaningfulChanges = useMemo(() => {
    const hasIsoContextChanges =
      currentSnapshot.isoClauseRefs.join("\n") !== initialSnapshot.isoClauseRefs.join("\n") ||
      currentSnapshot.processScope.length > 0 ||
      currentSnapshot.acceptanceCriteria.length > 0 ||
      currentSnapshot.verificationRecords.length > 0 ||
      currentSnapshot.riskControls.length > 0;
    const hasContentChanges =
      currentSnapshot.partId.length > 0 ||
      currentSnapshot.itemTitle.length > 0 ||
      currentSnapshot.revision !== initialSnapshot.revision ||
      currentSnapshot.selectedToolIds.length > 0 ||
      currentSnapshot.uncommonTools.length > 0 ||
      hasIsoContextChanges ||
      uncommonToolsInput.trim().length > 0 ||
      hasPendingCommonToolChanges ||
      currentSnapshot.bodyMarkdown.trim().length > 0;

    const hasDepartmentChange = departmentTouched
      ? currentSnapshot.departmentId !== initialSnapshot.departmentId
      : false;

    return hasContentChanges || hasDepartmentChange;
  }, [
    currentSnapshot,
    departmentTouched,
    initialSnapshot,
    hasPendingCommonToolChanges,
    uncommonToolsInput,
  ]);

  const hasUnsavedChanges = useMemo(() => {
    if (hasPendingCommonToolChanges || uploadBusy || revisionReason.trim()) {
      return true;
    }

    if (mode === "create") {
      return createModeHasMeaningfulChanges;
    }

    return !snapshotsAreEqual(currentSnapshot, initialSnapshot);
  }, [createModeHasMeaningfulChanges, currentSnapshot, hasPendingCommonToolChanges, initialSnapshot, mode, uploadBusy, revisionReason]);

  const selectedDepartmentName = useMemo(
    () => departments.find((department) => department.id === departmentId)?.name ?? "Unknown",
    [departmentId, departments],
  );

  const selectedToolSet = useMemo(() => new Set(selectedToolIds), [selectedToolIds]);

  function toggleIsoClauseRef(clause: string) {
    setIsoClauseRefs((current) => {
      const active = current.includes(clause);
      return active
        ? current.filter((entry) => entry !== clause)
        : [...current, clause];
    });
  }

  const commonToolOptions = useMemo(
    () =>
      suggestedTools
        .filter((tool) => tool.isActive)
        .sort((first, second) => compareToolNames(first.name, second.name)),
    [suggestedTools],
  );
  const commonToolIdByName = useMemo(
    () =>
      new Map(
        commonToolOptions.map((tool) => [tool.name.trim().toLowerCase(), tool.id] as const),
      ),
    [commonToolOptions],
  );
  const filteredCommonToolOptions = useMemo(() => {
    const query = commonToolSearchInput.trim().toLowerCase();
    if (!query) {
      return commonToolOptions;
    }

    return commonToolOptions.filter((tool) =>
      tool.name.trim().toLowerCase().includes(query),
    );
  }, [commonToolOptions, commonToolSearchInput]);

  const selectedTools = useMemo(
    () =>
      suggestedTools
        .filter((tool) => selectedToolSet.has(tool.id))
        .sort((first, second) => compareToolNames(first.name, second.name)),
    [selectedToolSet, suggestedTools],
  );
  const selectedToolNameSet = useMemo(
    () =>
      new Set(
        selectedTools.map((tool) => normalizeToolName(tool.name).toLowerCase()),
      ),
    [selectedTools],
  );
  const uncommonToolNameSet = useMemo(
    () =>
      new Set(
        uncommonToolList.map((toolName) => normalizeToolName(toolName).toLowerCase()),
      ),
    [uncommonToolList],
  );
  const selectedPickerTool = useMemo(
    () => commonToolOptions.find((tool) => tool.id === toolPickerToolId) ?? null,
    [commonToolOptions, toolPickerToolId],
  );
  const commonToolNameSet = useMemo(
    () =>
      new Set(
        commonToolOptions.map((tool) => normalizeToolName(tool.name).toLowerCase()),
      ),
    [commonToolOptions],
  );
  const toolListCount = selectedTools.length + uncommonToolList.length;
  const uncommonToolCandidates = useMemo(() => {
    return parseToolNameList(uncommonToolsInput);
  }, [uncommonToolsInput]);

  useEffect(
    () => () => {
      if (duplicateToolNoticeTimeoutRef.current !== null) {
        window.clearTimeout(duplicateToolNoticeTimeoutRef.current);
      }
    },
    [],
  );

  function openNavigationModal(nextNavigation: PendingNavigation) {
    pendingNavigationRef.current = nextNavigation;
    setPendingNavigation(nextNavigation);
    setNavigationModalOpen(true);
  }


  useEffect(() => {
    if (mode === "create") {
      void router.prefetch("/dashboard");
    }
  }, [mode, router]);

  const releaseHistoryGuard = useCallback(() => {
    if (historyGuardReleaseRef.current) {
      return historyGuardReleaseRef.current;
    }
    if (!historyGuardActiveRef.current) {
      return Promise.resolve();
    }

    suppressNextPopStateRef.current = true;
    historyGuardActiveRef.current = false;
    // History traversal completes asynchronously. Wait for the router to restore
    // that entry before starting a new navigation, or popstate can undo the save redirect.
    const released = new Promise<void>((resolve) => {
      window.addEventListener("popstate", () => {
        window.setTimeout(() => { historyGuardReleaseRef.current = null; resolve(); }, 0);
      }, { once: true });
    });
    historyGuardReleaseRef.current = released;
    window.history.back();
    return released;
  }, []);

  const navigateWithGuardReleased = useCallback(
    (navigate: () => void) => {
      void releaseHistoryGuard().then(navigate);
    },
    [releaseHistoryGuard],
  );

  const navigateToInstructionAfterSave = useCallback(
    (instructionId: string, mode: "push" | "replace") => {
      navigateWithGuardReleased(() => {
        const ensureTopScroll = () => {
          window.scrollTo({
            left: 0,
            top: 0,
            behavior: "auto",
          });
        };

        // Ensure the destination instruction page starts at the top after saves.
        ensureTopScroll();

        if (mode === "replace") {
          router.replace(`/instructions/${instructionId}`, { scroll: true });
        } else {
          router.push(`/instructions/${instructionId}`, { scroll: true });
        }

        router.refresh();
        window.requestAnimationFrame(() => {
          ensureTopScroll();
        });
        window.setTimeout(ensureTopScroll, 120);
        window.setTimeout(ensureTopScroll, 320);
      });
    },
    [navigateWithGuardReleased, router],
  );

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    navigationModalOpenRef.current = navigationModalOpen;
  }, [navigationModalOpen]);

  useEffect(() => {
    pendingNavigationRef.current = pendingNavigation;
  }, [pendingNavigation]);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      if (historyGuardActiveRef.current) {
        releaseHistoryGuard();
      }

      pendingNavigationRef.current = null;
      const timer = window.setTimeout(() => {
        setNavigationModalOpen(false);
        setPendingNavigation(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    if (!historyGuardActiveRef.current) {
      window.history.pushState({ [HISTORY_GUARD_STATE_KEY]: true }, "", window.location.href);
      historyGuardActiveRef.current = true;
    }
  }, [hasUnsavedChanges, releaseHistoryGuard]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChangesRef.current || navigationBypassRef.current) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      if (suppressNextPopStateRef.current) {
        suppressNextPopStateRef.current = false;
        return;
      }

      if (!hasUnsavedChangesRef.current || navigationBypassRef.current) {
        historyGuardActiveRef.current = false;
        return;
      }

      if (navigationModalOpenRef.current) {
        window.history.pushState({ [HISTORY_GUARD_STATE_KEY]: true }, "", window.location.href);
        historyGuardActiveRef.current = true;
        return;
      }

      window.history.pushState({ [HISTORY_GUARD_STATE_KEY]: true }, "", window.location.href);
      historyGuardActiveRef.current = true;
      openNavigationModal({ kind: "history-back" });
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    const handleDocumentNavigation = (event: MouseEvent) => {
      if (!hasUnsavedChangesRef.current || navigationBypassRef.current) {
        return;
      }

      if (event.defaultPrevented || event.button !== 0) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const target = event.target as Element | null;
      const anchor = target?.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      if (anchor.target && anchor.target !== "_self") {
        return;
      }

      if (anchor.hasAttribute("download")) {
        return;
      }

      let destination: URL;
      try {
        destination = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      if (destination.href === window.location.href) {
        return;
      }

      event.preventDefault();

      if (destination.origin === window.location.origin) {
        openNavigationModal({ kind: "internal-link", href: destination.href });
      } else {
        openNavigationModal({ kind: "external-link", href: destination.href });
      }
    };

    document.addEventListener("click", handleDocumentNavigation, true);
    return () => {
      document.removeEventListener("click", handleDocumentNavigation, true);
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    void (async () => {
      try {
        const { data, error: departmentsError } = await supabase
          .from("departments")
          .select("id, name")
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true });

        if (!isActive) {
          return;
        }

        if (departmentsError) {
          throw departmentsError;
        }

        const resolvedDepartments = (data ?? []) as DepartmentOption[];
        setDepartments(resolvedDepartments);
        setDepartmentId((current) => current || resolvedDepartments[0]?.id || "");
      } catch {
        if (!isActive) {
          return;
        }
        setDepartments([]);
      } finally {
        if (isActive) {
          setDepartmentsBusy(false);
        }
      }
    })();

    return () => {
      isActive = false;
    };
  }, [supabase]);


  const loadSuggestedTools = useCallback(
    async (preservedToolIds: string[] = []) => {
      const { data: activeToolData, error: activeToolError } = await supabase
        .from("suggested_tools")
        .select("id, name, sort_order, is_active")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (activeToolError) {
        throw activeToolError;
      }

      const activeRows = (activeToolData ?? []) as Array<{
        id: string;
        name: string;
        sort_order: number;
        is_active: boolean;
      }>;
      const missingSelectedIds = preservedToolIds.filter(
        (toolId) => !activeRows.some((tool) => tool.id === toolId),
      );

      let preservedRows: Array<{
        id: string;
        name: string;
        sort_order: number;
        is_active: boolean;
      }> = [];

      if (missingSelectedIds.length > 0) {
        const { data: selectedToolData, error: selectedToolError } = await supabase
          .from("suggested_tools")
          .select("id, name, sort_order, is_active")
          .in("id", missingSelectedIds);

        if (selectedToolError) {
          throw selectedToolError;
        }

        preservedRows = (selectedToolData ?? []) as Array<{
          id: string;
          name: string;
          sort_order: number;
          is_active: boolean;
        }>;
      }

      const mergedRows = [...activeRows];
      for (const row of preservedRows) {
        if (!mergedRows.some((tool) => tool.id === row.id)) {
          mergedRows.push(row);
        }
      }

      const nextTools = mergedRows
        .map((tool) => ({
          id: tool.id,
          name: tool.name,
          sortOrder: tool.sort_order ?? 0,
          isActive: tool.is_active !== false,
        }))
        .sort(
          (first, second) =>
            first.sortOrder - second.sortOrder || first.name.localeCompare(second.name),
        );

      setSuggestedTools(nextTools);
      setSelectedToolIds((current) =>
        current.filter((toolId) => nextTools.some((tool) => tool.id === toolId)),
      );

      return nextTools;
    },
    [supabase],
  );

  useEffect(() => {
    let isActive = true;
    void (async () => {
      await Promise.resolve();
      if (!isActive) return;
      setToolCatalogBusy(true);
      setToolCatalogError(null);
      try {
        const nextTools = await loadSuggestedTools(initialData?.suggestedToolIds ?? []);
        if (!isActive) {
          return;
        }

        setToolPickerToolId((current) =>
          current && nextTools.some((tool) => tool.id === current) ? current : "",
        );
      } catch {
        if (!isActive) {
          return;
        }

        setSuggestedTools([]);
        setToolCatalogError("Unable to load common tools.");
      } finally {
        if (isActive) {
          setToolCatalogBusy(false);
        }
      }
    })();

    return () => {
      isActive = false;
    };
  }, [initialData?.suggestedToolIds, loadSuggestedTools]);


  useEffect(() => {
    if (!commonToolSelectOpen || commonToolInputMode !== "select") {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!commonToolSelectRef.current || !target || commonToolSelectRef.current.contains(target)) {
        return;
      }

      setCommonToolSelectOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCommonToolSelectOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [commonToolInputMode, commonToolSelectOpen]);


  useEffect(() => {
    const query = partId.trim();
    if (query.length < 2) {
      return;
    }

    let isActive = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        setPartSearchBusy(true);
        try {
          const safeQuery = escapeLikeQuery(query);
          const { data, error: searchError } = await supabase
            .from("work_items")
            .select(
              "id, department_id, part_id, item_title, departments(name), work_instructions!inner(id)",
            )
            .ilike("part_id", `%${safeQuery}%`)
            .eq("work_instructions.is_archived", false)
            .order("part_id", { ascending: false })
            .order("updated_at", { ascending: false })
            .limit(8);

          if (!isActive) {
            return;
          }

          if (searchError) {
            throw searchError;
          }

          setPartSuggestions((data ?? []) as WorkItemSearchResult[]);
        } catch {
          if (!isActive) {
            return;
          }

          setPartSuggestions([]);
        } finally {
          if (isActive) {
            setPartSearchBusy(false);
          }
        }
      })();
    }, 200);

    return () => {
      isActive = false;
      window.clearTimeout(timer);
    };
  }, [partId, supabase]);

  function applySuggestedWorkItem(result: WorkItemSearchResult) {
    setDepartmentTouched(true);
    setDepartmentId(result.department_id);
    setPartId(result.part_id);
    setItemTitle(result.item_title);
    setWorkItemId(result.id);
    setPartSearchOpen(false);
    setFieldErrors((current) => ({
      ...current,
      department: false,
      partId: false,
      itemTitle: false,
    }));
  }

  function setPartIdErrorAndFocus() {
    setFieldErrors((current) => ({
      ...current,
      partId: true,
    }));
    partInputRef.current?.focus();
  }

  function toggleSelectedTool(toolId: string) {
    setSelectedToolIds((current) =>
      current.includes(toolId)
        ? current.filter((currentToolId) => currentToolId !== toolId)
        : [...current, toolId],
    );
  }

  function showDuplicateToolNotice() {
    setDuplicateToolNotice("Can't add duplicates");
    if (duplicateToolNoticeTimeoutRef.current !== null) {
      window.clearTimeout(duplicateToolNoticeTimeoutRef.current);
    }
    duplicateToolNoticeTimeoutRef.current = window.setTimeout(() => {
      setDuplicateToolNotice(null);
      duplicateToolNoticeTimeoutRef.current = null;
    }, 2000);
  }

  function resolveCommonToolSelectionId() {
    if (commonToolInputMode === "select") {
      return commonToolOptions.some((tool) => tool.id === toolPickerToolId) ? toolPickerToolId : "";
    }

    if (toolPickerToolId && commonToolOptions.some((tool) => tool.id === toolPickerToolId)) {
      return toolPickerToolId;
    }

    const normalizedQuery = commonToolSearchInput.trim().toLowerCase();
    if (!normalizedQuery) {
      return "";
    }

    const exactMatchId = commonToolIdByName.get(normalizedQuery);
    if (exactMatchId) {
      return exactMatchId;
    }

    return filteredCommonToolOptions[0]?.id ?? "";
  }

  function addCommonToolToToolList() {
    const resolvedToolId = resolveCommonToolSelectionId();
    if (!resolvedToolId) {
      return;
    }

    const selectedTool = commonToolOptions.find((tool) => tool.id === resolvedToolId);
    if (selectedToolIds.includes(resolvedToolId)) {
      showDuplicateToolNotice();
      return;
    }
    if (selectedTool && uncommonToolNameSet.has(normalizeToolName(selectedTool.name).toLowerCase())) {
      showDuplicateToolNotice();
      return;
    }

    setCommonToolSearchInput("");
    setToolPickerToolId("");
    setCommonToolSelectOpen(false);
    setSelectedToolIds((current) =>
      current.includes(resolvedToolId) ? current : [...current, resolvedToolId],
    );
  }

  function addUncommonToolsToToolList() {
    setToolCatalogError(null);
    const parsedCandidates = uncommonToolCandidates.map((candidate) => normalizeToolName(candidate));
    if (parsedCandidates.length === 0) {
      return;
    }

    const filteredToAdd: string[] = [];
    const seenInBatch = new Set<string>();
    let blockedDuplicate = false;

    for (const candidate of parsedCandidates) {
      const normalizedKey = candidate.toLowerCase();
      if (
        !normalizedKey ||
        seenInBatch.has(normalizedKey) ||
        uncommonToolNameSet.has(normalizedKey) ||
        selectedToolNameSet.has(normalizedKey)
      ) {
        blockedDuplicate = true;
        continue;
      }

      seenInBatch.add(normalizedKey);
      filteredToAdd.push(candidate);
    }

    if (filteredToAdd.length > 0) {
      setUncommonToolList((current) => mergeToolNameLists(current, filteredToAdd));
      setUncommonToolsInput("");
    }

    if (blockedDuplicate) {
      showDuplicateToolNotice();
    }

    if (filteredToAdd.length === 0) {
      return;
    }
  }

  function removeUncommonToolFromList(toolName: string) {
    const key = toolName.trim().toLowerCase();
    if (!key) {
      return;
    }

    setUncommonToolList((current) =>
      current.filter((entry) => entry.trim().toLowerCase() !== key),
    );
  }

  function isToolSavedToCommonList(toolName: string) {
    const normalizedKey = normalizeToolName(toolName).toLowerCase();
    if (!normalizedKey) {
      return false;
    }

    const pendingChange = pendingCommonToolChanges[normalizedKey]?.change;
    if (pendingChange === "save") {
      return true;
    }
    if (pendingChange === "remove") {
      return false;
    }

    return commonToolNameSet.has(normalizedKey);
  }

  function toggleCommonToolSavedState(rawToolName: string) {
    setToolCatalogError(null);
    const normalizedName = normalizeToolName(rawToolName);
    if (!normalizedName) {
      return;
    }

    const normalizedKey = normalizedName.toLowerCase();
    const persistedSavedState = commonToolNameSet.has(normalizedKey);
    const pendingChange = pendingCommonToolChanges[normalizedKey]?.change;
    const effectiveSavedState =
      pendingChange === "save" ? true : pendingChange === "remove" ? false : persistedSavedState;
    const nextSavedState = !effectiveSavedState;

    setPendingCommonToolChanges((current) => {
      const next = { ...current };
      if (nextSavedState === persistedSavedState) {
        delete next[normalizedKey];
      } else {
        next[normalizedKey] = {
          name: normalizedName,
          change: nextSavedState ? "save" : "remove",
        };
      }
      return next;
    });
  }

  async function syncPendingCommonToolChanges() {
    const pendingEntries = Object.entries(pendingCommonToolChanges);
    if (pendingEntries.length === 0) {
      return;
    }

    setToolCatalogError(null);
    setToolSetupBusy(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("Missing session token. Please sign in again.");
      }

      const latestTools = await loadSuggestedTools(selectedToolIds);
      const toolByNormalizedName = new Map(
        latestTools.map((tool) => [normalizeToolName(tool.name).toLowerCase(), tool] as const),
      );
      const activeCommonToolNames = new Set(
        latestTools
          .filter((tool) => tool.isActive)
          .map((tool) => normalizeToolName(tool.name).toLowerCase()),
      );
      let nextSortOrder =
        latestTools.reduce((max, tool) => Math.max(max, tool.sortOrder), -1) + 1;
      for (const [, pendingEntry] of pendingEntries) {
        const normalizedName = normalizeToolName(pendingEntry.name);
        const normalizedNameKey = normalizedName.toLowerCase();
        if (!normalizedNameKey) {
          continue;
        }

        const matchingTool = toolByNormalizedName.get(normalizedNameKey) ?? null;

        if (pendingEntry.change === "save") {
          if (activeCommonToolNames.has(normalizedNameKey)) {
            continue;
          }

          if (matchingTool && !matchingTool.isActive) {
            const reactivateResponse = await fetch(`/api/suggested-tools/${matchingTool.id}`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({
                isActive: true,
              }),
            });

            const reactivatePayload = (await reactivateResponse.json().catch(() => ({}))) as {
              error?: string;
            };
            if (!reactivateResponse.ok) {
              throw new Error(reactivatePayload.error ?? "Unable to reactivate common tool.");
            }

            activeCommonToolNames.add(normalizedNameKey);
            continue;
          }

          const createResponse = await fetch("/api/suggested-tools", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              name: normalizedName,
              sortOrder: nextSortOrder,
            }),
          });

          const createPayload = (await createResponse.json().catch(() => ({}))) as {
            error?: string;
          };
          if (!createResponse.ok && createResponse.status !== 409) {
            throw new Error(createPayload.error ?? "Unable to save tool to common list.");
          }
          activeCommonToolNames.add(normalizedNameKey);
          nextSortOrder += 1;
          continue;
        }

        if (!activeCommonToolNames.has(normalizedNameKey) || !matchingTool?.isActive) {
          continue;
        }

        const disableResponse = await fetch(`/api/suggested-tools/${matchingTool.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            isActive: false,
          }),
        });

        const disablePayload = (await disableResponse.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!disableResponse.ok) {
          throw new Error(disablePayload.error ?? "Unable to remove tool from common list.");
        }

        activeCommonToolNames.delete(normalizedNameKey);
      }

      const nextTools = await loadSuggestedTools(selectedToolIds);
      const resolvedToolId = resolveCommonToolSelectionId();
      if (resolvedToolId && nextTools.some((tool) => tool.id === resolvedToolId)) {
        setToolPickerToolId(resolvedToolId);
      } else if (!nextTools.some((tool) => tool.id === toolPickerToolId)) {
        setToolPickerToolId("");
      }
      setPendingCommonToolChanges({});
    } finally {
      setToolSetupBusy(false);
    }
  }

  function closeNavigationModal() {
    pendingNavigationRef.current = null;
    setNavigationModalOpen(false);
    setPendingNavigation(null);
  }


  function handleCancelNavigationAway() {
    if (
      pendingNavigationRef.current?.kind === "history-back" &&
      hasUnsavedChangesRef.current &&
      !historyGuardActiveRef.current
    ) {
      window.history.pushState({ [HISTORY_GUARD_STATE_KEY]: true }, "", window.location.href);
      historyGuardActiveRef.current = true;
    }

    navigationBypassRef.current = false;
    closeNavigationModal();
  }

  function handleConfirmNavigationAway() {
    const navigation = pendingNavigationRef.current;
    if (!navigation) {
      closeNavigationModal();
      return;
    }

    navigationBypassRef.current = true;
    closeNavigationModal();

    if (navigation.kind === "history-back") {
      navigateWithGuardReleased(() => {
        if (window.history.length <= 2) {
          router.push("/dashboard");
          return;
        }

        router.back();
      });
      return;
    }

    window.location.assign(navigation.href);
  }

  async function updateEnhancementOutcome(
    enhancementId: string,
    outcome: "applied" | "discarded",
    instructionId?: string | null,
  ) {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`/api/instructions/enhance/${enhancementId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        outcome,
        instructionId: instructionId ?? null,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Unable to update AI enhancement usage status.");
    }
  }

  function handleCloseEnhancementModal() {
    if (enhancementComparison?.generationId) {
      void updateEnhancementOutcome(enhancementComparison.generationId, "discarded").catch(
        (caughtError) => {
          const normalizedMessage =
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to update AI enhancement usage status.";
          setEnhanceError(normalizedMessage);
        },
      );
    }

    setEnhancementModalOpen(false);
    setEnhancementComparison(null);
  }

  function handleKeepOriginalInstructions() {
    if (enhancementComparison?.generationId) {
      void updateEnhancementOutcome(enhancementComparison.generationId, "discarded").catch(
        (caughtError) => {
          const normalizedMessage =
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to update AI enhancement usage status.";
          setEnhanceError(normalizedMessage);
        },
      );
    }

    setEnhancementModalOpen(false);
    setEnhancementComparison(null);
  }

  function handleApplyEnhancedInstructions() {
    if (!enhancementComparison) {
      return;
    }
    if (enhancementComparison.sourceSnapshot !== JSON.stringify(currentSnapshot)) {
      setEnhanceError("Your draft changed while AI was preparing its suggestion. Your edits are preserved. Run AI Enhance again to use the latest draft.");
      handleCloseEnhancementModal();
      return;
    }

    // Suggestions arrive as HTML; the editor keeps Markdown.
    const enhancedMarkdown = toMarkdownSource(enhancementComparison.enhancedContent);
    setBodyMarkdown(enhancedMarkdown);
    setEnhancementModalOpen(false);
    if (hasMeaningfulContent(enhancedMarkdown)) {
      setFieldErrors((current) => ({
        ...current,
        body: false,
      }));
    }

    const generationId = enhancementComparison.generationId;
    setPendingAiEnhancementId(generationId);
    setEnhancementComparison(null);
    if (generationId) {
      const currentInstructionId =
        mode === "edit" ? (initialData?.instructionId ?? null) : null;
      void updateEnhancementOutcome(
        generationId,
        "applied",
        currentInstructionId,
      ).catch((caughtError) => {
        const normalizedMessage =
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to update AI enhancement usage status.";
        setEnhanceError(normalizedMessage);
      });
    }
  }

  async function handleEnhanceInstruction() {
    const normalizedBody = bodyMarkdown;

    if (!hasMeaningfulContent(normalizedBody)) {
      setFieldErrors((current) => ({
        ...current,
        body: true,
      }));
      setEnhanceError("Add instruction content before running AI Enhance.");
      setBodyFocusRequestKey((current) => current + 1);
      return;
    }

    setEnhanceBusy(true);
    setEnhanceError(null);
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Missing session token. Please sign in again.");
      }

      const response = await fetch("/api/instructions/enhance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          instructionBody: normalizedBody,
          partId: partId.trim(),
          itemTitle: itemTitle.trim(),
          departmentName: selectedDepartmentName,
          revision,
          isoClauseRefs,
          processScope: processScope.trim(),
          acceptanceCriteria: acceptanceCriteria.trim(),
          verificationRecords: verificationRecords.trim(),
          riskControls: riskControls.trim(),
          instructionId: initialData?.instructionId ?? null,
          sourceInstructionId: initialData?.sourceInstructionId ?? null,
          mode,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as EnhanceInstructionResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to enhance instructions right now.");
      }

      const nextEnhancedContent = sanitizeRichHtml(payload.enhancedContent ?? "");
      if (!hasMeaningfulContent(nextEnhancedContent)) {
        throw new Error("AI enhancement returned empty content. Please try again.");
      }

      const nextOriginalContent = sanitizeRichHtml(
        payload.originalContent ?? normalizedBody,
      );

      setEnhancementComparison({
        generationId: payload.generationId ?? null,
        originalContent: nextOriginalContent,
        enhancedContent: nextEnhancedContent,
        enhancementNotes: payload.enhancementNotes?.trim() ?? "",
        sourceSnapshot: JSON.stringify(currentSnapshot),
      });
      setEnhancementModalOpen(true);
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to enhance instructions right now.";
      setEnhanceError(normalizedMessage);
      setEnhancementModalOpen(false);
    } finally {
      setEnhanceBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (uploadBusy) {
      setError("Wait for the media upload to finish before submitting the instruction.");
      return;
    }

    setBusy(true);
    setMessage(null);
    setError(null);
    setEnhanceError(null);
    setFieldErrors(DEFAULT_FIELD_ERRORS);
    setRevisionConflictModal(null);
    setRevisionBumpConfirmationModal(null);

    const normalizedPartId = partId.trim();
    const normalizedDepartmentId = departmentId.trim();
    const currentRevision = initialData?.revision ?? revision;
    const hasEditRevisionBump =
      mode === "edit" &&
      Boolean(initialData?.instructionId) &&
      revision > currentRevision;

    if (!normalizedDepartmentId) {
      setFieldErrors((current) => ({
        ...current,
        department: true,
      }));
      setError("Department is required.");
      setBusy(false);
      return;
    }

    if (!normalizedPartId) {
      setPartIdErrorAndFocus();
      setError("Part ID is required.");
      setBusy(false);
      return;
    }

    if (!itemTitle.trim()) {
      setFieldErrors((current) => ({
        ...current,
        itemTitle: true,
      }));
      setError("Work item title is required.");
      itemTitleInputRef.current?.focus();
      setBusy(false);
      return;
    }

    if (!Number.isSafeInteger(revision) || revision < 1 || (mode === "edit" && revision < (initialData?.revision ?? 1) + (initialData?.approvalStatus === "approved" ? 1 : 0))) {
      setFieldErrors((current) => ({
        ...current,
        revision: true,
      }));
      setError(initialData?.approvalStatus === "approved" ? "Increase the revision number to revise a released instruction." : "Revision must be a whole number and cannot decrease.");
      setBusy(false);
      return;
    }

    if (!hasMeaningfulContent(bodyMarkdown)) {
      setFieldErrors((current) => ({
        ...current,
        body: true,
      }));
      setError("Instruction steps are required.");
      setBodyFocusRequestKey((current) => current + 1);
      setBusy(false);
      return;
    }

    if (!processScope.trim()) {
      setError("Process scope / applicability is required before an instruction can be submitted for review.");
      setBusy(false);
      return;
    }

    if (!acceptanceCriteria.trim()) {
      setError("Acceptance criteria is required before an instruction can be submitted for review.");
      setBusy(false);
      return;
    }

    if (!verificationRecords.trim()) {
      setError("Verification records are required before an instruction can be submitted for review.");
      setBusy(false);
      return;
    }

    if (hasEditRevisionBump && !confirmedRevisionBumpRef.current) {
      if (!revisionReason.trim()) {
        setError("Describe what changed and why before creating the next controlled revision.");
        setBusy(false);
        return;
      }
      setRevisionBumpConfirmationModal({
        currentRevision,
        nextRevision: revision,
      });
      setBusy(false);
      return;
    }

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("You must be signed in.");
      }

      const isEditRevisionBump = mode === "edit" && revision > (initialData?.revision ?? revision);
      const changeComputation = mode === "edit"
        ? buildInstructionUpdateSummary({
            previousBody: initialData?.bodyMarkdown ?? "", nextBody: bodyMarkdown,
            previousRevision: initialData?.revision ?? revision, nextRevision: revision,
            previousDepartmentId: initialData?.departmentId ?? "", nextDepartmentId: normalizedDepartmentId,
            previousPartId: initialData?.partId ?? "", nextPartId: normalizedPartId,
            previousItemTitle: initialData?.itemTitle ?? "", nextItemTitle: itemTitle.trim(),
            previousIsoClauseRefs: normalizeInstructionIsoClauseRefsOrDefault(initialData?.isoClauseRefs), nextIsoClauseRefs: isoClauseRefs,
            previousProcessScope: initialData?.processScope ?? "", nextProcessScope: processScope.trim(),
            previousAcceptanceCriteria: initialData?.acceptanceCriteria ?? "", nextAcceptanceCriteria: acceptanceCriteria.trim(),
            previousVerificationRecords: initialData?.verificationRecords ?? "", nextVerificationRecords: verificationRecords.trim(),
            previousRiskControls: initialData?.riskControls ?? "", nextRiskControls: riskControls.trim(),
            previousSuggestedToolIds: initialData?.suggestedToolIds ?? [], nextSuggestedToolIds: selectedToolIds,
            previousUncommonTools: initialData?.uncommonTools ?? "", nextUncommonTools: serializeToolNameList(uncommonToolList),
          })
        : { summary: buildInstructionCreateSummary(bodyMarkdown, revision) };
      const { data, error: saveError } = await supabase.rpc("save_work_instruction_controlled", {
        p_payload: {
          mode, instructionId: initialData?.instructionId ?? null,
          sourceInstructionId: initialData?.sourceInstructionId ?? null,
          expectedUpdatedAt: initialData?.updatedAt ?? null,
          replacementInstructionId: confirmedReplacementInstructionIdRef.current,
          departmentId: normalizedDepartmentId, partId: normalizedPartId, itemTitle: itemTitle.trim(),
          bodyMarkdown, revision, isoClauseRefs, processScope: processScope.trim(),
          acceptanceCriteria: acceptanceCriteria.trim(), verificationRecords: verificationRecords.trim(),
          riskControls: riskControls.trim(), uncommonTools: serializeToolNameList(uncommonToolList),
          suggestedToolIds: selectedToolIds, changeSummary: revisionReason.trim() || changeComputation.summary,
          aiEnhancementId: pendingAiEnhancementId,
        },
      });
      if (saveError) throw new Error(saveError.message);
      const result = data as {
        conflict?: boolean; existingInstructionId?: string; existingRevision?: number;
        instructionId?: string; forkNumber?: number; archivedInstructionId?: string;
      } | null;
      if (result?.conflict && result.existingInstructionId) {
        setRevisionConflictModal({
          existingInstructionId: result.existingInstructionId,
          existingRevision: result.existingRevision ?? revision, requestedRevision: revision,
          partId: normalizedPartId, itemTitle: itemTitle.trim(), departmentName: selectedDepartmentName,
        });
        return;
      }
      if (!result?.instructionId) throw new Error("The save did not return an instruction. Refresh before retrying.");
      const instructionId = result.instructionId;
      const createdForkNumber = result.forkNumber;
      if (result.archivedInstructionId) registerArchivedInstructionRedirect(result.archivedInstructionId, instructionId);
      confirmedReplacementInstructionIdRef.current = null;
      setPendingAiEnhancementId(null);

      // Optional tool preferences must not turn a committed save into a failed save.
      await syncPendingCommonToolChanges().catch(() => undefined);

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.access_token) {
          await drainResponse(await fetch("/api/notifications/work-instruction-submitted", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ instructionId }),
          }));
        }
      } catch {
        // Email notification delivery is best-effort and should not block saves.
      }

      setMessage(
        isEditRevisionBump
          ? "New revision submitted for review."
          : mode === "edit"
            ? "Instruction changes submitted for review."
            : mode === "fork"
            ? `Fork ${createdForkNumber ?? "?"} submitted for review.`
            : "Instruction submitted for review.",
      );

      navigationBypassRef.current = true;
      navigateToInstructionAfterSave(
        instructionId,
        isEditRevisionBump ? "replace" : "push",
      );
    } catch (caughtError) {
      confirmedRevisionBumpRef.current = false;
      confirmedReplacementInstructionIdRef.current = null;
      setError(normalizeSubmissionError(caughtError));
      navigationBypassRef.current = false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-5">
      <FloatingStatusNotices
        notices={[
          message && {
            id: "instruction-editor-message",
            tone: "success",
            message,
            onDismiss: () => setMessage(null),
          },
          error && {
            id: "instruction-editor-error",
            tone: "error",
            message: error,
            onDismiss: () => setError(null),
          },
        ]}
      />

      <form
        ref={formRef}
        noValidate
        onSubmit={handleSubmit}
        className="grid min-w-0 gap-5 overflow-hidden rounded-3xl border border-white/30 bg-white/75 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7"
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)_100px] md:items-end md:gap-4">
          <label className="grid min-w-0 gap-1.5 text-sm">
            <span className="font-semibold">Part ID</span>
            <div className="relative">
              <input
                ref={partInputRef}
                value={partId}
                aria-invalid={fieldErrors.partId}
                placeholder="Example: SK-12345"
                onFocus={() => {
                  if (partId.trim().length >= 2 && partSuggestions.length > 0) {
                    setPartSearchOpen(true);
                  }
                }}
                onBlur={() => {
                  window.setTimeout(() => setPartSearchOpen(false), 120);
                }}
                onChange={(event) => {
                  setPartId(event.target.value);
                  setPartSearchOpen(true);
                  setWorkItemId(null);
                  if (fieldErrors.partId) {
                    setFieldErrors((current) => ({
                      ...current,
                      partId: false,
                    }));
                  }
                }}
                className={cn(
                  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950",
                  fieldErrors.partId ? "border-rose-500 ring-2 ring-rose-500/30" : "",
                )}
              />
              {partSearchOpen && partId.trim().length >= 2 ? (
                <div className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-20 max-h-60 overflow-auto rounded-xl border border-slate-300 bg-white/95 p-1 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-950/95">
                  {partSearchBusy ? (
                    <p className="px-2 py-2 text-xs text-slate-500 dark:text-slate-300">
                      Searching...
                    </p>
                  ) : partSuggestions.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-slate-500 dark:text-slate-300">
                      No Part ID matches.
                    </p>
                  ) : (
                    partSuggestions.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applySuggestedWorkItem(result)}
                        className="grid w-full gap-0.5 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-cyan-500/10"
                      >
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          {result.part_id}
                        </span>
                        <span className="text-slate-500 dark:text-slate-300">
                          {getDepartmentNameFromRelation(result.departments)} | {result.item_title}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold">Work Item Title</span>
            <input
              ref={itemTitleInputRef}
              placeholder="Example: Pouring Procedure"
              value={itemTitle}
              aria-invalid={fieldErrors.itemTitle}
              onChange={(event) => {
                setItemTitle(event.target.value);
                setWorkItemId(null);
                if (fieldErrors.itemTitle) {
                  setFieldErrors((current) => ({
                    ...current,
                    itemTitle: false,
                  }));
                }
              }}
              className={cn(
                "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950",
                fieldErrors.itemTitle ? "border-rose-500 ring-2 ring-rose-500/30" : "",
              )}
            />
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold">Department</span>
            <select
              value={departmentId}
              aria-invalid={fieldErrors.department}
              onChange={(event) => {
                setDepartmentTouched(true);
                setDepartmentId(event.target.value);
                setWorkItemId(null);
                if (fieldErrors.department) {
                  setFieldErrors((current) => ({
                    ...current,
                    department: false,
                  }));
                }
              }}
              className={cn(
                "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-950",
                fieldErrors.department ? "border-rose-500 ring-2 ring-rose-500/30" : "",
              )}
              disabled={departmentsBusy || departments.length === 0}
            >
              {departmentsBusy ? (
                <option value="">Loading...</option>
              ) : departments.length === 0 ? (
                <option value="">No departments configured</option>
              ) : null}
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid min-w-0 gap-1.5 text-sm">
            <span className="font-semibold">Revision</span>
            <input
              min={mode === "edit" ? (initialData?.revision ?? 1) + (initialData?.approvalStatus === "approved" ? 1 : 0) : 1}
              step={1}
              type="number"
              value={revision}
              aria-invalid={fieldErrors.revision}
              onChange={(event) => {
                setRevision(Number(event.target.value));
                confirmedRevisionBumpRef.current = false;
                if (fieldErrors.revision) {
                  setFieldErrors((current) => ({
                    ...current,
                    revision: false,
                  }));
                }
              }}
              className={cn(
                "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950",
                fieldErrors.revision ? "border-rose-500 ring-2 ring-rose-500/30" : "",
              )}
            />
          </label>
        </div>

        {mode === "edit" ? (
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold">Change summary {revision > (initialData?.revision ?? revision) ? "(required for a new revision)" : "(optional)"}</span>
            <input value={revisionReason} onChange={(event) => setRevisionReason(event.target.value)} maxLength={1200} placeholder="What changed and why?" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950" />
            <span className="text-xs text-slate-500 dark:text-slate-400">Retained in the revision history with your identity and the save time.</span>
          </label>
        ) : null}

        <details
          open
          className="group rounded-2xl border border-slate-300/70 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/50"
        >
          <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                ISO / Control Context
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Capture the audit-sensitive scope, acceptance criteria, records, and reaction controls for this instruction.
              </p>
            </div>
            <ChevronDown
              size={18}
              className="mt-1 shrink-0 text-slate-500 transition group-open:rotate-180"
            />
          </summary>

          <div className="mt-3 grid gap-3">
            <fieldset className="grid gap-2">
              <legend className="text-sm font-semibold">ISO 9001 Clauses</legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {ISO_9001_CLAUSE_OPTIONS.map((clause) => (
                  <label key={clause} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={isoClauseRefs.includes(clause)}
                      onChange={() => toggleIsoClauseRef(clause)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                    />
                    <span>{clause}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1.5 text-sm">
                <span className="font-semibold">Process scope / applicability</span>
                <textarea
                  value={processScope}
                  onChange={(event) => setProcessScope(event.target.value)}
                  rows={3}
                  className="resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-semibold">Acceptance criteria</span>
                <textarea
                  value={acceptanceCriteria}
                  onChange={(event) => setAcceptanceCriteria(event.target.value)}
                  rows={3}
                  className="resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-semibold">Verification records</span>
                <textarea
                  value={verificationRecords}
                  onChange={(event) => setVerificationRecords(event.target.value)}
                  rows={3}
                  className="resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-semibold">Risks, controls, and reaction plan</span>
                <textarea
                  value={riskControls}
                  onChange={(event) => setRiskControls(event.target.value)}
                  rows={3}
                  className="resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
            </div>
          </div>
        </details>

        <MarkdownEditor
          onUploadStateChange={setUploadBusy}
          label="Work Instructions"
          value={bodyMarkdown}
          onChange={(nextValue) => {
            setBodyMarkdown(nextValue);
            if (fieldErrors.body && hasMeaningfulContent(nextValue)) {
              setFieldErrors((current) => ({
                ...current,
                body: false,
              }));
            }
          }}
          minHeightClassName="min-h-80"
          hasError={fieldErrors.body}
          focusRequestKey={bodyFocusRequestKey}
          notice={legacyBodyConverted ? (
            <p>
              <strong>Converted to Markdown.</strong> This instruction was written in the previous editor. Colours,
              font sizes and alignment are not part of Markdown, so coloured or highlighted text is now <strong>bold</strong>.
              Check the preview before saving.
            </p>
          ) : null}
          toolbarAfterRedoContent={
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                void handleEnhanceInstruction();
              }}
              disabled={busy || enhanceBusy}
              aria-label={enhanceBusy ? "Enhancing instructions" : "Enhance instructions with AI"}
              title={enhanceBusy ? "Enhancing..." : "AI Enhance"}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-fuchsia-500/45 bg-fuchsia-500/15 text-fuchsia-800 transition hover:bg-fuchsia-500/25 dark:text-fuchsia-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {enhanceBusy ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Sparkles size={16} />
              )}
            </button>
          }
          toolbarEndContent={
            <button
              type="button"
              onClick={() => setEditorParametersOpen((current) => !current)}
              aria-expanded={editorParametersOpen}
              aria-label="Toggle tool list panel"
              title="Tool List"
              className="inline-flex h-9 min-w-20 items-center justify-center gap-1.5 rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-2 text-cyan-800 transition hover:bg-cyan-500/20 dark:text-cyan-100"
            >
              <Wrench size={14} />
              <span className="rounded-full bg-slate-900/15 px-2 py-0.5 text-xs font-bold dark:bg-white/20">
                {toolListCount}
              </span>
              <ChevronDown
                size={13}
                className={cn("transition", editorParametersOpen ? "rotate-180" : "rotate-0")}
              />
            </button>
          }
          aboveEditorContent={
            editorParametersOpen ? (
              <>
                <div className="grid gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/5 px-3 py-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      Tool List
                    </p>
                    <span className="rounded-full border border-cyan-500/40 bg-cyan-500/15 px-2 py-0.5 text-[11px] font-semibold text-cyan-800 dark:text-cyan-200">
                      {toolListCount} in Tool List
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Search common tools with auto-suggest and add both common and uncommon tools
                    into the Tool List.
                  </p>

                  <div className="inline-flex w-fit items-center rounded-lg border border-slate-300/80 bg-white/90 p-0.5 text-xs dark:border-slate-700 dark:bg-slate-950/70">
                    <button
                      type="button"
                      onClick={() => setCommonToolInputMode("type")}
                      className={cn(
                        "rounded-md px-2.5 py-1 font-semibold transition",
                        commonToolInputMode === "type"
                          ? "bg-cyan-500/20 text-cyan-800 dark:text-cyan-100"
                          : "text-slate-700 hover:bg-slate-200/80 dark:text-slate-300 dark:hover:bg-slate-800",
                      )}
                    >
                      Type
                    </button>
                    <button
                      type="button"
                      onClick={() => setCommonToolInputMode("select")}
                      className={cn(
                        "rounded-md px-2.5 py-1 font-semibold transition",
                        commonToolInputMode === "select"
                          ? "bg-cyan-500/20 text-cyan-800 dark:text-cyan-100"
                          : "text-slate-700 hover:bg-slate-200/80 dark:text-slate-300 dark:hover:bg-slate-800",
                      )}
                    >
                      Select
                    </button>
                  </div>

                  {toolCatalogError ? (
                    <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
                      {toolCatalogError}
                    </p>
                  ) : null}

                  <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                    <label className="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                      <span>
                        {commonToolInputMode === "type"
                          ? "Search Common Tools"
                          : "Select Common Tool"}
                      </span>
                      {commonToolInputMode === "type" ? (
                        <>
                          <input
                            list="instruction-common-tool-options"
                            value={commonToolSearchInput}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              setCommonToolSearchInput(nextValue);
                              const normalizedQuery = nextValue.trim().toLowerCase();
                              const matchedToolId =
                                commonToolIdByName.get(normalizedQuery) ??
                                commonToolOptions.find((tool) =>
                                  tool.name.trim().toLowerCase().includes(normalizedQuery),
                                )?.id ??
                                "";
                              setToolPickerToolId(matchedToolId);
                            }}
                            onKeyDown={(event) => {
                              const shouldAddTool =
                                event.key === "Enter" ||
                                (event.key === "Tab" && !event.shiftKey);
                              if (!shouldAddTool || !resolveCommonToolSelectionId()) {
                                return;
                              }

                              event.preventDefault();
                              addCommonToolToToolList();
                            }}
                            placeholder="Start typing to auto-suggest common tools..."
                            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                            disabled={toolCatalogBusy || commonToolOptions.length === 0}
                          />
                          <datalist id="instruction-common-tool-options">
                            {filteredCommonToolOptions.map((tool) => (
                              <option key={tool.id} value={tool.name} />
                            ))}
                          </datalist>
                        </>
                      ) : (
                        <div ref={commonToolSelectRef} className="relative">
                          <button
                            type="button"
                            onClick={() => {
                              if (toolCatalogBusy || commonToolOptions.length === 0) {
                                return;
                              }
                              setCommonToolSelectOpen((current) => !current);
                            }}
                            className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-left outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                            disabled={toolCatalogBusy || commonToolOptions.length === 0}
                            aria-expanded={commonToolSelectOpen}
                            aria-haspopup="listbox"
                          >
                            <span className="truncate">
                              {selectedPickerTool?.name ?? "Select a common tool..."}
                            </span>
                            <ChevronDown
                              size={14}
                              className={cn("shrink-0 transition", commonToolSelectOpen ? "rotate-180" : "")}
                            />
                          </button>

                          {commonToolSelectOpen ? (
                            <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-30 rounded-lg border border-slate-300 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-950">
                              <div className="max-h-[18rem] overflow-y-auto">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setToolPickerToolId("");
                                    setCommonToolSearchInput("");
                                    setCommonToolSelectOpen(false);
                                  }}
                                  className={cn(
                                    "w-full px-2.5 py-1.5 text-left text-sm transition",
                                    toolPickerToolId
                                      ? "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
                                      : "bg-cyan-500/10 text-cyan-900 dark:text-cyan-100",
                                  )}
                                >
                                  Select a common tool...
                                </button>
                                {commonToolOptions.map((tool) => (
                                  <button
                                    key={tool.id}
                                    type="button"
                                    onClick={() => {
                                      setToolPickerToolId(tool.id);
                                      setCommonToolSearchInput(tool.name);
                                      setCommonToolSelectOpen(false);
                                    }}
                                    className={cn(
                                      "w-full px-2.5 py-1.5 text-left text-sm transition hover:bg-slate-100 dark:hover:bg-slate-900",
                                      toolPickerToolId === tool.id
                                        ? "bg-cyan-500/10 text-cyan-900 dark:text-cyan-100"
                                        : "text-slate-700 dark:text-slate-200",
                                    )}
                                  >
                                    {tool.name}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </label>

                    <button
                      type="button"
                      disabled={!resolveCommonToolSelectionId()}
                      onClick={addCommonToolToToolList}
                      className="rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60 dark:text-cyan-100"
                    >
                      Add
                    </button>
                  </div>

                  <div className="grid gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Tool List ({toolListCount})
                      </p>
                      <button
                        type="button"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-400/70 text-[10px] font-bold text-slate-600 dark:border-slate-600 dark:text-slate-300"
                        title="Bubble controls are staged until you save the instruction. Click a lit bubble to stage removal from Common Tools, or click an unlit bubble to stage adding it. Changes apply only after this instruction is saved."
                        aria-label="How common tool bubbles work"
                      >
                        ?
                      </button>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      Click a bubble to stage common-tool changes. Lit = will be in Common Tools
                      after instruction save. Unlit = will be removed/not added after instruction
                      save.
                    </p>
                    {duplicateToolNotice ? (
                      <p className="w-fit rounded-md border border-amber-500/45 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-100">
                        {duplicateToolNotice}
                      </p>
                    ) : null}
                    {toolListCount === 0 ? (
                      <p className="rounded-lg border border-slate-300/70 bg-white/80 px-2.5 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
                        No tools in the list yet.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedTools.map((tool) => {
                          const savedToCommonList = isToolSavedToCommonList(tool.name);
                          return (
                            <div
                              key={tool.id}
                              className="inline-flex items-center gap-1 rounded-full border border-cyan-500/45 bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-800 dark:text-cyan-100"
                            >
                              <span>{tool.name}</span>
                              {!tool.isActive ? (
                                <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-200">
                                  Hidden
                                </span>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => toggleSelectedTool(tool.id)}
                                className="opacity-70 transition hover:opacity-100"
                                title="Remove from Tool List"
                                aria-label={`Remove ${tool.name} from Tool List`}
                              >
                                x
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleCommonToolSavedState(tool.name)}
                                disabled={toolSetupBusy}
                                className={cn(
                                  "inline-flex h-4 w-4 items-center justify-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-60",
                                  savedToCommonList
                                    ? "border-emerald-500/70 bg-emerald-500/70"
                                    : "border-cyan-500/45 bg-white/40 hover:bg-cyan-500/20 dark:bg-slate-900/40",
                                )}
                                title={
                                  savedToCommonList
                                    ? "Saved in Common Tools"
                                    : "Save to Common Tools"
                                }
                                aria-label={
                                  savedToCommonList
                                    ? `${tool.name} is saved in Common Tools`
                                    : `Save ${tool.name} to Common Tools`
                                }
                                aria-pressed={savedToCommonList}
                              >
                                <span
                                  className={cn(
                                    "h-2 w-2 rounded-full transition",
                                    savedToCommonList ? "bg-white" : "bg-transparent",
                                  )}
                                />
                              </button>
                            </div>
                          );
                        })}
                        {uncommonToolList.map((toolName) => {
                          const savedToCommonList = isToolSavedToCommonList(toolName);
                          return (
                            <div
                              key={`uncommon:${toolName.toLowerCase()}`}
                              className="inline-flex items-center gap-1 rounded-full border border-amber-500/45 bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-100"
                            >
                              <span>{toolName}</span>
                              <button
                                type="button"
                                onClick={() => removeUncommonToolFromList(toolName)}
                                className="opacity-70 transition hover:opacity-100"
                                title="Remove from Tool List"
                                aria-label={`Remove ${toolName} from Tool List`}
                              >
                                x
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleCommonToolSavedState(toolName)}
                                disabled={toolSetupBusy}
                                className={cn(
                                  "inline-flex h-4 w-4 items-center justify-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-60",
                                  savedToCommonList
                                    ? "border-emerald-500/70 bg-emerald-500/70"
                                    : "border-amber-500/45 bg-white/40 hover:bg-amber-500/20 dark:bg-slate-900/40",
                                )}
                                title={
                                  savedToCommonList
                                    ? "Saved in Common Tools"
                                    : "Save to Common Tools"
                                }
                                aria-label={
                                  savedToCommonList
                                    ? `${toolName} is saved in Common Tools`
                                    : `Save ${toolName} to Common Tools`
                                }
                                aria-pressed={savedToCommonList}
                              >
                                <span
                                  className={cn(
                                    "h-2 w-2 rounded-full transition",
                                    savedToCommonList ? "bg-white" : "bg-transparent",
                                  )}
                                />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                    <label className="grid gap-1.5 text-sm">
                      <span className="font-semibold">Uncommon Tools</span>
                      <input
                        value={uncommonToolsInput}
                        onChange={(event) => setUncommonToolsInput(event.target.value)}
                        onKeyDown={(event) => {
                          const shouldAddTool =
                            event.key === "Enter" ||
                            (event.key === "Tab" && !event.shiftKey);
                          if (!shouldAddTool || uncommonToolCandidates.length === 0) {
                            return;
                          }

                          event.preventDefault();
                          addUncommonToolsToToolList();
                        }}
                        placeholder="Type uncommon tools here (comma separated if multiple)"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={toolSetupBusy || uncommonToolCandidates.length === 0}
                      onClick={addUncommonToolsToToolList}
                      className="rounded-lg border border-cyan-500/35 px-3 py-2 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:text-cyan-200"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </>
            ) : null
          }
        />

        {enhanceError ? (
          <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
            {enhanceError}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || uploadBusy}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
          {mode === "edit"
            ? "Save Changes"
            : mode === "fork"
              ? "Create Fork"
              : "Create Instruction"}
        </button>
      </form>

      {enhancementModalOpen && enhancementComparison && portalReady ? (
        <EditorDialog title="Compare Instruction Versions" wide onClose={handleCloseEnhancementModal}>
          <p className="text-sm text-slate-600 dark:text-slate-400">Review the suggestion against your draft. Verify all engineering requirements before applying or submitting for approval.</p>
          {enhancementComparison.enhancementNotes ? <p className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-sm text-cyan-800 dark:text-cyan-200">{enhancementComparison.enhancementNotes}</p> : null}
          {enhancementComparison.sourceSnapshot !== JSON.stringify(currentSnapshot) ? <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">Your draft changed while this suggestion was being prepared. Keep your current draft and run AI Enhance again to include those edits.</p> : null}
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <section className="grid min-w-0 content-start gap-3 rounded-xl border border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50">
              <h3 className="text-sm font-semibold">Your Version</h3>
              <div className="max-h-[52dvh] min-w-0 overflow-auto rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950"><div className="prose-markdown text-sm" dangerouslySetInnerHTML={{ __html: enhancementComparison.originalContent }} /></div>
            </section>
            <section className="grid min-w-0 content-start gap-3 rounded-xl border border-cyan-500/40 bg-cyan-500/5 p-3">
              <h3 className="text-sm font-semibold text-cyan-800 dark:text-cyan-200">AI Enhanced Version</h3>
              <div className="max-h-[52dvh] min-w-0 overflow-auto rounded-lg border border-cyan-500/30 bg-white p-4 dark:bg-slate-950"><div className="prose-markdown text-sm" dangerouslySetInnerHTML={{ __html: enhancementComparison.enhancedContent }} /></div>
            </section>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={handleKeepOriginalInstructions} className="min-h-11 rounded-lg border border-slate-300 px-4 font-semibold dark:border-slate-700">Keep My Version</button>
            <button type="button" disabled={enhancementComparison.sourceSnapshot !== JSON.stringify(currentSnapshot)} onClick={handleApplyEnhancedInstructions} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-cyan-700 px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><Sparkles size={16} />Use AI Enhanced Version</button>
          </div>
        </EditorDialog>
      ) : null}

      {revisionConflictModal && portalReady
        ? createPortal(
            <div className="app-modal-shell fixed inset-0 z-[112] flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm sm:p-6">
              <div className="grid w-full max-w-lg gap-4 rounded-2xl border border-cyan-500/45 bg-slate-950/95 p-5 shadow-2xl">
                <div className="grid gap-2">
                  <h3 className="text-lg font-bold text-slate-100">
                    Replace current active revision?
                  </h3>
                  <p className="text-sm text-slate-300">
                    {revisionConflictModal.itemTitle} | {revisionConflictModal.departmentName}
                  </p>
                  <p className="text-sm text-slate-300">
                    {formatPartId(revisionConflictModal.partId) || "Part ID not specified"}
                  </p>
                  <p className="text-sm text-slate-300">
                    Continuing will move revision {revisionConflictModal.existingRevision} into
                    storage and make revision {revisionConflictModal.requestedRevision} the current
                    active instruction.
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => {
                      confirmedReplacementInstructionIdRef.current = null;
                      setRevisionConflictModal(null);
                    }}
                    className="rounded-xl border border-slate-600 bg-slate-900/70 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const existingInstructionId = revisionConflictModal.existingInstructionId;
                      confirmedReplacementInstructionIdRef.current = null;
                      setRevisionConflictModal(null);
                      window.open(
                        `/instructions/${existingInstructionId}`,
                        "_blank",
                        "noopener,noreferrer",
                      );
                    }}
                    className="rounded-xl border border-cyan-500/45 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25"
                  >
                    View Existing
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      confirmedReplacementInstructionIdRef.current =
                        revisionConflictModal.existingInstructionId;
                      setRevisionConflictModal(null);
                      formRef.current?.requestSubmit();
                    }}
                    className="rounded-xl border border-emerald-500/45 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/30"
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {revisionBumpConfirmationModal && portalReady
        ? createPortal(
            <div className="app-modal-shell fixed inset-0 z-[112] flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm sm:p-6">
              <div className="grid w-full max-w-md gap-4 rounded-2xl border border-cyan-500/45 bg-slate-950/95 p-5 shadow-2xl">
                <div className="grid gap-2">
                  <h3 className="text-lg font-bold text-slate-100">Create new revision?</h3>
                  <p className="text-sm text-slate-300">
                    You are changing this instruction from revision{" "}
                    {revisionBumpConfirmationModal.currentRevision} to revision{" "}
                    {revisionBumpConfirmationModal.nextRevision}.
                  </p>
                  <p className="text-sm text-slate-300">
                    Saving creates a new revision for review. The approved revision remains
                    available until its replacement is approved.
                  </p>
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      confirmedRevisionBumpRef.current = false;
                      setRevisionBumpConfirmationModal(null);
                    }}
                    className="rounded-xl border border-slate-600 bg-slate-900/70 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      confirmedRevisionBumpRef.current = true;
                      setRevisionBumpConfirmationModal(null);
                      formRef.current?.requestSubmit();
                    }}
                    className="rounded-xl border border-emerald-500/45 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/30"
                  >
                    Continue and Save
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {navigationModalOpen && portalReady
        ? createPortal(
            <div className="app-modal-shell fixed inset-0 z-[111] flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm sm:p-6">
              <div className="grid w-full max-w-md gap-4 rounded-2xl border border-amber-500/45 bg-slate-950/95 p-5 shadow-2xl">
                <div className="grid gap-1">
                  <h3 className="text-lg font-bold text-slate-100">Discard unsaved changes?</h3>
                  <p className="text-sm text-slate-300">
                    You have unsaved changes. If you leave this page now, your updates will be
                    lost.
                  </p>
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleCancelNavigationAway}
                    className="rounded-xl border border-slate-600 bg-slate-900/70 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                  >
                    Keep Editing
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmNavigationAway}
                    className="rounded-xl border border-amber-500/45 bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/30"
                  >
                    Leave Without Saving
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

    </div>
  );
}

