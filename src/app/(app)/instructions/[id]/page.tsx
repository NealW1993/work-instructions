import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import sanitizeHtml from "sanitize-html";

import { InstructionActionMenu } from "@/components/instructions/instruction-action-menu";
import { DeleteInstructionButton } from "@/components/instructions/delete-instruction-button";
import { InstructionBackButton } from "@/components/instructions/instruction-back-button";
import { InstructionArchivedRedirectGuard } from "@/components/instructions/instruction-archived-redirect-guard";
import { InstructionBodyLightbox } from "@/components/instructions/instruction-body-lightbox";
import { InstructionMediaSection } from "@/components/instructions/instruction-media-section";
import { InstructionForkMergeControl } from "@/components/instructions/instruction-fork-merge-control";
import {
  type InstructionRevisionHistoryEntry,
  InstructionRevisionHistoryControl,
} from "@/components/instructions/instruction-revision-history-control";
import { InstructionReviewControls } from "@/components/instructions/instruction-review-controls";
import {
  type SuggestedToolOption,
  SuggestedToolsDropdown,
} from "@/components/instructions/suggested-tools-dropdown";
import { InstructionViewTracker } from "@/components/instructions/instruction-view-tracker";
import { LikeInstructionButton } from "@/components/instructions/like-instruction-button";
import { PinInstructionButton } from "@/components/instructions/pin-instruction-button";
import { PrintInstructionButton } from "@/components/instructions/print-instruction-button";
import { PrintMediaIsolator } from "@/components/instructions/print-media-isolator";
import { RestoreArchivedInstructionButton } from "@/components/instructions/restore-archived-instruction-button";
import {
  type InstructionUpdateEvent,
  type InstructionUpdateSourcePayload,
  InstructionUpdatesPanel,
} from "@/components/instructions/instruction-updates-panel";
import { LocalDateTime } from "@/components/ui/local-date-time";
import { requireAuthenticatedUser } from "@/lib/auth";
import {
  type MediaUrlRuntimeContext,
  getMediaUrlRuntimeFromHeaders,
  resolveAccessibleMediaUrl,
  rewriteLoopbackMediaUrlsInHtml,
} from "@/lib/media-url";
import { canEditInstructions, isSystemAdmin } from "@/lib/roles";
import type { InstructionMedia } from "@/lib/types";
import { inferVideoMimeType, normalizeVideoMarkupForPlayback } from "@/lib/video";

interface InstructionPageProps {
  params: Promise<{
    id: string;
  }>;
}

interface InstructionRecord {
  id: string;
  work_item_id: string;
  fork_root_instruction_id: string | null;
  fork_number: number | null;
  merged_into_root_at: string | null;
  merge_count: number;
  is_archived: boolean;
  body_markdown: string;
  uncommon_tools: string;
  ai_assisted: boolean;
  ai_assisted_at: string | null;
  last_change_summary: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  work_items:
      | {
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
      | Array<{
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
      }>;
  instruction_media: InstructionMedia[];
}

interface ForkFamilyRow {
  id: string;
  fork_number: number | null;
  is_archived: boolean;
  merged_into_root_at: string | null;
  created_at: string;
}

interface MergePreviewMediaRow {
  public_url: string;
  media_type: "image" | "video";
  caption: string | null;
  sort_order: number;
}

interface ForkRootLookupRow {
  id: string;
  body_markdown: string;
  revision: number;
  work_items:
    | {
        part_id: string;
        item_title: string;
        department_id: string;
        departments:
          | {
              name: string;
            }
          | Array<{
              name: string;
            }>
          | null;
      }
    | Array<{
        part_id: string;
        item_title: string;
        department_id: string;
        departments:
          | {
              name: string;
            }
          | Array<{
              name: string;
            }>
          | null;
      }>
    | null;
  instruction_media: MergePreviewMediaRow[] | null;
}

interface InstructionChangeEventRow {
  id: string;
  event_type: "created" | "updated" | string;
  detail: string | null;
  occurred_at: string;
  actor_user_id: string;
  revision: number | null;
  source_payload: unknown;
}

interface InstructionRevisionHistoryRow {
  id: string;
  revision: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

interface InstructionRevisionHistoryLookupRow extends InstructionRevisionHistoryRow {
  work_items:
    | {
        part_id: string;
        item_title: string;
        department_id: string;
      }
    | Array<{
        part_id: string;
        item_title: string;
        department_id: string;
      }>
    | null;
}

interface InstructionReviewSettingsRow {
  review_window_days: number;
}

interface InstructionReviewStatusRow {
  instruction_id: string;
  status: "up_to_date" | "needs_review";
  last_calibrated_at: string;
  flagged_at: string | null;
  updated_by: string;
}

interface SuggestedToolRow {
  id: string;
  name: string;
  category_id: string;
  subcategory_id: string | null;
  suggested_tool_categories:
    | {
        name: string;
      }
    | Array<{
        name: string;
      }>
    | null;
  suggested_tool_subcategories:
    | {
        name: string;
      }
    | Array<{
        name: string;
      }>
    | null;
}

interface InstructionSuggestedToolLinkRow {
  suggested_tool_id: string;
}

const DEFAULT_REVIEW_WINDOW_DAYS = 30;

function normalizeReviewWindowDays(value: unknown) {
  if (!Number.isInteger(value)) {
    return null;
  }

  const parsed = Number(value);
  return parsed >= 1 && parsed <= 365 ? parsed : null;
}

function toElapsedCalendarDaysUtc(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const today = new Date();
  const valueStart = Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  );
  const todayStart = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const elapsed = todayStart - valueStart;
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return null;
  }

  return Math.round(elapsed / (1000 * 60 * 60 * 24));
}

function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function sanitizeRichHtml(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "mark",
      "ul",
      "ol",
      "li",
      "blockquote",
      "code",
      "pre",
      "h1",
      "h2",
      "h3",
      "hr",
      "span",
      "div",
      "figure",
      "img",
      "video",
      "source",
      "label",
      "input",
    ],
    allowedAttributes: {
      figure: ["data-type", "data-align", "data-width", "style", "class"],
      img: ["src", "alt", "title", "width", "height", "style", "class"],
      video: ["src", "controls", "width", "height", "style", "class", "playsinline", "preload", "data-mime-type"],
      source: ["src", "type"],
      span: ["style"],
      div: ["style", "data-type"],
      p: ["style"],
      h1: ["style"],
      h2: ["style"],
      h3: ["style"],
      ul: ["data-type"],
      li: ["data-type", "data-checked"],
      label: ["contenteditable"],
      input: ["type", "checked", "disabled"],
      mark: ["style", "data-color"],
      "*": ["class", "style"],
    },
    allowedSchemes: ["http", "https", "data"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
      video: ["http", "https", "data"],
    },
    allowedStyles: {
      "*": {
        "text-align": [/^left$/, /^right$/, /^center$/, /^justify$/],
        display: [/^block$/, /^inline-block$/],
        width: [/^[0-9.]+(px|%)$/],
        height: [/^[0-9.]+(px|%)$/, /^auto$/],
        "max-width": [/^[0-9.]+(px|%)$/],
        "margin-left": [/^auto$/, /^[0-9.]+(px|%)$/],
        "margin-right": [/^auto$/, /^[0-9.]+(px|%)$/],
      },
      span: {
        color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb\([0-9,\s.]+\)$/],
        "font-size": [/^[0-9]+(px|em|rem|%)$/],
      },
      mark: {
        "background-color": [/^#[0-9a-fA-F]{3,8}$/, /^rgb\([0-9,\s.]+\)$/],
      },
    },
  });
}

function getWorkItem(relation: InstructionRecord["work_items"]) {
  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }

  return relation;
}

function getDepartmentName(
  relation:
    | {
        name: string;
      }
    | Array<{
        name: string;
      }>
    | null
    | undefined,
) {
  if (!relation) {
    return "Unknown";
  }

  if (Array.isArray(relation)) {
    return relation[0]?.name ?? "Unknown";
  }

  return relation.name;
}

function normalizeLookupValue(value: string) {
  return value.trim().toLowerCase();
}

function parseToolNames(value: string | null | undefined) {
  const dedupedByName = new Map<string, string>();

  for (const rawEntry of (value ?? "").split(/[\r\n,;]+/)) {
    const normalizedEntry = rawEntry.trim();
    if (!normalizedEntry) {
      continue;
    }

    const key = normalizedEntry.toLowerCase();
    if (!dedupedByName.has(key)) {
      dedupedByName.set(key, normalizedEntry);
    }
  }

  return Array.from(dedupedByName.values());
}

function normalizeRevisionHistoryLookupWorkItem(
  relation: InstructionRevisionHistoryLookupRow["work_items"],
) {
  if (!relation) {
    return null;
  }

  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }

  return relation;
}

function normalizeForkRootWorkItem(
  relation: ForkRootLookupRow["work_items"],
) {
  if (!relation) {
    return null;
  }

  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }

  return relation;
}

function normalizeMergePreviewMediaRows(
  rows: MergePreviewMediaRow[] | InstructionMedia[] | null | undefined,
  mediaUrlRuntime?: MediaUrlRuntimeContext,
) {
  if (!rows || rows.length === 0) {
    return [] as Array<{
      type: "image" | "video";
      src: string;
      caption: string | null;
      sortOrder: number;
    }>;
  }

  return rows
    .map((row) => {
      const source = resolveAccessibleMediaUrl(row.public_url, mediaUrlRuntime);
      if (!source) {
        return null;
      }

      return {
        type: row.media_type,
        src: source,
        caption: row.caption ?? null,
        sortOrder: row.sort_order,
      };
    })
    .filter(
      (
        row,
      ): row is {
        type: "image" | "video";
        src: string;
        caption: string | null;
        sortOrder: number;
      } => row !== null,
    );
}

function revisionHistoryRowSortValue(row: InstructionRevisionHistoryRow) {
  const updatedAtValue = Date.parse(row.updated_at);
  return Number.isFinite(updatedAtValue) ? updatedAtValue : 0;
}

function renderInstructionContent(
  value: string,
  mediaUrlRuntime?: MediaUrlRuntimeContext,
) {
  if (!value.trim()) {
    return null;
  }

  if (looksLikeHtml(value)) {
    const sanitizedMarkup = sanitizeRichHtml(value);
    const normalizedMarkup = rewriteLoopbackMediaUrlsInHtml(
      normalizeVideoMarkupForPlayback(sanitizedMarkup),
      mediaUrlRuntime,
    );
    return (
      <div
        className="prose-markdown"
        dangerouslySetInnerHTML={{ __html: normalizedMarkup }}
      />
    );
  }

  return (
    <div className="prose-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
    </div>
  );
}

interface PrintMediaItem {
  type: "image" | "video";
  src: string;
  caption: string | null;
}

function stripHtmlTags(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function readHtmlAttribute(tagMarkup: string, attributeName: string) {
  const attributePattern = new RegExp(
    `${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i",
  );
  const match = tagMarkup.match(attributePattern);
  return (match?.[1] ?? match?.[2] ?? "").trim();
}

function collectPrintMediaFromHtmlSnippet(
  snippet: string,
  fallbackCaption: string | null,
  dedupeKeys: Set<string>,
  results: PrintMediaItem[],
) {
  const imgTagPattern = /<img\b[^>]*>/gi;
  let imgMatch: RegExpExecArray | null = imgTagPattern.exec(snippet);
  while (imgMatch) {
    const tagMarkup = imgMatch[0];
    const source = readHtmlAttribute(tagMarkup, "src");
    if (source) {
      const dedupeKey = `image|${source}`;
      if (!dedupeKeys.has(dedupeKey)) {
        dedupeKeys.add(dedupeKey);
        const altCaption = readHtmlAttribute(tagMarkup, "alt");
        const titleCaption = readHtmlAttribute(tagMarkup, "title");
        const caption =
          fallbackCaption ?? (altCaption || titleCaption ? altCaption || titleCaption : null);
        results.push({
          type: "image",
          src: source,
          caption: caption?.trim() ? caption.trim() : null,
        });
      }
    }

    imgMatch = imgTagPattern.exec(snippet);
  }

  const videoTagPattern = /<video\b[^>]*>/gi;
  let videoMatch: RegExpExecArray | null = videoTagPattern.exec(snippet);
  while (videoMatch) {
    const tagMarkup = videoMatch[0];
    const source = readHtmlAttribute(tagMarkup, "src");
    if (source) {
      const dedupeKey = `video|${source}`;
      if (!dedupeKeys.has(dedupeKey)) {
        dedupeKeys.add(dedupeKey);
        results.push({
          type: "video",
          src: source,
          caption: fallbackCaption?.trim() ? fallbackCaption.trim() : null,
        });
      }
    }

    videoMatch = videoTagPattern.exec(snippet);
  }
}

function extractPrintMediaFromBody(value: string) {
  const dedupeKeys = new Set<string>();
  const results: PrintMediaItem[] = [];

  if (!value.trim()) {
    return results;
  }

  const figurePattern = /<figure\b[\s\S]*?<\/figure>/gi;
  let figureMatch: RegExpExecArray | null = figurePattern.exec(value);
  while (figureMatch) {
    const figureMarkup = figureMatch[0];
    const captionMatch = figureMarkup.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
    const figureCaption = captionMatch ? stripHtmlTags(captionMatch[1]) : null;
    collectPrintMediaFromHtmlSnippet(figureMarkup, figureCaption, dedupeKeys, results);
    figureMatch = figurePattern.exec(value);
  }

  collectPrintMediaFromHtmlSnippet(value, null, dedupeKeys, results);

  const markdownImagePattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let markdownMatch: RegExpExecArray | null = markdownImagePattern.exec(value);
  while (markdownMatch) {
    const normalizedSource = markdownMatch[2].trim().replace(/^<|>$/g, "");
    if (normalizedSource) {
      const dedupeKey = `image|${normalizedSource}`;
      if (!dedupeKeys.has(dedupeKey)) {
        dedupeKeys.add(dedupeKey);
        const altText = markdownMatch[1]?.trim() ?? "";
        results.push({
          type: "image",
          src: normalizedSource,
          caption: altText || null,
        });
      }
    }

    markdownMatch = markdownImagePattern.exec(value);
  }

  return results;
}

function normalizeInstructionMediaForPrint(
  media: InstructionMedia[],
  mediaUrlRuntime?: MediaUrlRuntimeContext,
) {
  return [...media]
    .sort((first, second) => first.sort_order - second.sort_order)
    .map((mediaItem) => ({
      type: mediaItem.media_type,
      src: resolveAccessibleMediaUrl(mediaItem.public_url, mediaUrlRuntime),
      caption: mediaItem.caption?.trim() || null,
    }))
    .filter((mediaItem) => mediaItem.src.length > 0);
}

function mergePrintMediaGroups(...groups: PrintMediaItem[][]) {
  const dedupedMediaByKey = new Map<string, PrintMediaItem>();

  for (const group of groups) {
    for (const mediaItem of group) {
      const key = `${mediaItem.type}|${mediaItem.src}`;
      if (!dedupedMediaByKey.has(key)) {
        dedupedMediaByKey.set(key, mediaItem);
      }
    }
  }

  return Array.from(dedupedMediaByKey.values());
}

function normalizeInstructionUpdateSourcePayload(
  value: unknown,
  mediaUrlRuntime?: MediaUrlRuntimeContext,
): InstructionUpdateSourcePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const isReviewState = (state: unknown): state is "up_to_date" | "needs_review" =>
    state === "up_to_date" || state === "needs_review";
  const normalizeMediaList = (
    mediaValue: unknown,
  ): Array<{ type: "image" | "video"; src: string }> => {
    if (!Array.isArray(mediaValue)) {
      return [];
    }

    return mediaValue
      .map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return null;
        }

        const mediaEntry = entry as Record<string, unknown>;
        const type = mediaEntry.type === "video" ? "video" : mediaEntry.type === "image" ? "image" : null;
        const src =
          typeof mediaEntry.src === "string"
            ? resolveAccessibleMediaUrl(mediaEntry.src, mediaUrlRuntime)
            : "";

        if (!type || !src) {
          return null;
        }

        return { type, src };
      })
      .filter((entry): entry is { type: "image" | "video"; src: string } => entry !== null);
  };

  const reviewStateChange =
    candidate.kind === "instruction_review_state" && isReviewState(candidate.nextStatus)
      ? (() => {
          const normalizedReviewOrigin: "user" | "system" =
            candidate.reviewOrigin === "system" ? "system" : "user";
          return {
            previousStatus: isReviewState(candidate.previousStatus)
              ? candidate.previousStatus
              : null,
            nextStatus: candidate.nextStatus,
            reviewOrigin: normalizedReviewOrigin,
            note:
              typeof candidate.note === "string" && candidate.note.trim().length > 0
                ? candidate.note.trim()
                : undefined,
          };
        })()
      : undefined;

  const normalizedPayload: InstructionUpdateSourcePayload = {
    addedTextSnippet:
      typeof candidate.addedTextSnippet === "string" ? candidate.addedTextSnippet : undefined,
    removedTextSnippet:
      typeof candidate.removedTextSnippet === "string"
        ? candidate.removedTextSnippet
        : undefined,
    addedMedia: normalizeMediaList(candidate.addedMedia),
    removedMedia: normalizeMediaList(candidate.removedMedia),
    previousRevision:
      typeof candidate.previousRevision === "number"
        ? candidate.previousRevision
        : undefined,
    nextRevision:
      typeof candidate.nextRevision === "number" ? candidate.nextRevision : undefined,
    mediaFormattingUpdated:
      typeof candidate.mediaFormattingUpdated === "boolean"
        ? candidate.mediaFormattingUpdated
        : undefined,
    reviewStateChange,
  };

  const hasPayloadData =
    Boolean(normalizedPayload.addedTextSnippet) ||
    Boolean(normalizedPayload.removedTextSnippet) ||
    (normalizedPayload.addedMedia?.length ?? 0) > 0 ||
    (normalizedPayload.removedMedia?.length ?? 0) > 0 ||
    normalizedPayload.mediaFormattingUpdated === true ||
    normalizedPayload.previousRevision !== undefined ||
    normalizedPayload.nextRevision !== undefined ||
    normalizedPayload.reviewStateChange !== undefined;

  return hasPayloadData ? normalizedPayload : null;
}

export default async function InstructionDetailsPage({ params }: InstructionPageProps) {
  const { id } = await params;
  const requestHeaders = await headers();
  const mediaUrlRuntime = getMediaUrlRuntimeFromHeaders(requestHeaders);
  const { supabase, profile } = await requireAuthenticatedUser();

  const { data, error } = await supabase
    .from("work_instructions")
    .select(
      "id, work_item_id, fork_root_instruction_id, fork_number, merged_into_root_at, merge_count, is_archived, body_markdown, uncommon_tools, ai_assisted, ai_assisted_at, last_change_summary, revision, created_at, updated_at, created_by, updated_by, work_items(id, department_id, part_id, item_title, departments(name)), instruction_media(id, instruction_id, storage_path, public_url, media_type, caption, sort_order, created_by, created_at)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    notFound();
  }

  const instruction = data as InstructionRecord;
  const workItem = getWorkItem(instruction.work_items);
  const departmentName = getDepartmentName(workItem?.departments);
  const instructionForkNumber =
    Number.isInteger(instruction.fork_number) && Number(instruction.fork_number) > 0
      ? Number(instruction.fork_number)
      : null;
  const isForkInstruction =
    Boolean(instruction.fork_root_instruction_id) && instructionForkNumber !== null;
  const forkFamilyRootId = isForkInstruction
    ? (instruction.fork_root_instruction_id as string)
    : instruction.id;

  if (!workItem) {
    notFound();
  }

  const [
    { data: forkFamilyData, error: forkFamilyError },
    { data: forkRootLookupData, error: forkRootLookupError },
  ] = await Promise.all([
    supabase
      .from("work_instructions")
      .select("id, fork_number, is_archived, merged_into_root_at, created_at")
      .eq("fork_root_instruction_id", forkFamilyRootId)
      .order("fork_number", { ascending: true }),
    isForkInstruction
      ? supabase
          .from("work_instructions")
          .select(
            "id, body_markdown, revision, work_items(part_id, item_title, department_id, departments(name)), instruction_media(public_url, media_type, caption, sort_order)",
          )
          .eq("id", forkFamilyRootId)
          .maybeSingle<ForkRootLookupRow>()
      : Promise.resolve({
          data: null as ForkRootLookupRow | null,
          error: null as { message?: string } | null,
        }),
  ]);

  if (forkFamilyError) {
    throw new Error(forkFamilyError.message);
  }

  if (forkRootLookupError) {
    throw new Error(forkRootLookupError.message ?? "Unable to load fork root instruction.");
  }

  const forkFamilyRows = (forkFamilyData ?? []) as ForkFamilyRow[];
  const forkRootLookup = (forkRootLookupData ?? null) as ForkRootLookupRow | null;
  const instructionMedia = instruction.instruction_media.map((mediaItem) => ({
    ...mediaItem,
    public_url: resolveAccessibleMediaUrl(mediaItem.public_url, mediaUrlRuntime),
  }));
  const forkRootWorkItem = normalizeForkRootWorkItem(forkRootLookup?.work_items ?? null);
  const forkRootMedia = normalizeMergePreviewMediaRows(
    forkRootLookup?.instruction_media ?? null,
    mediaUrlRuntime,
  );
  const forkInstructionMedia = normalizeMergePreviewMediaRows(
    instructionMedia,
    mediaUrlRuntime,
  );
  const forkRootDepartmentName = getDepartmentName(forkRootWorkItem?.departments);
  const forkCount = forkFamilyRows.length;

  const [
    { data: revisionHistoryByWorkItemData, error: revisionHistoryByWorkItemError },
    {
      data: revisionHistoryByPartAndDepartmentData,
      error: revisionHistoryByPartAndDepartmentError,
    },
  ] = await Promise.all([
    isForkInstruction
      ? supabase
          .from("work_instructions")
          .select("id, revision, is_archived, created_at, updated_at, updated_by")
          .eq("fork_root_instruction_id", forkFamilyRootId)
          .eq("fork_number", instructionForkNumber as number)
          .order("revision", { ascending: false })
          .order("updated_at", { ascending: false })
      : supabase
          .from("work_instructions")
          .select("id, revision, is_archived, created_at, updated_at, updated_by")
          .eq("work_item_id", instruction.work_item_id)
          .is("fork_root_instruction_id", null)
          .order("revision", { ascending: false })
          .order("updated_at", { ascending: false }),
    isForkInstruction
      ? Promise.resolve({
          data: null as InstructionRevisionHistoryLookupRow[] | null,
          error: null as { message?: string } | null,
        })
      : supabase
          .from("work_instructions")
          .select(
            "id, revision, is_archived, created_at, updated_at, updated_by, work_items!inner(part_id, item_title, department_id)",
          )
          .eq("work_items.department_id", workItem.department_id)
          .is("fork_root_instruction_id", null),
  ]);

  if (revisionHistoryByWorkItemError) {
    throw new Error(revisionHistoryByWorkItemError.message);
  }

  if (revisionHistoryByPartAndDepartmentError) {
    throw new Error(revisionHistoryByPartAndDepartmentError.message);
  }

  const normalizedWorkItemPartId = normalizeLookupValue(workItem.part_id);
  const normalizedWorkItemItemTitle = normalizeLookupValue(workItem.item_title);
  const revisionHistoryRowsByWorkItem =
    (revisionHistoryByWorkItemData ?? []) as InstructionRevisionHistoryRow[];
  const revisionHistoryRowsByPartAndDepartment =
    (revisionHistoryByPartAndDepartmentData ?? []) as InstructionRevisionHistoryLookupRow[];

  const revisionHistoryById = new Map<string, InstructionRevisionHistoryRow>();
  for (const row of revisionHistoryRowsByWorkItem) {
    revisionHistoryById.set(row.id, row);
  }

  for (const row of revisionHistoryRowsByPartAndDepartment) {
    const rowWorkItem = normalizeRevisionHistoryLookupWorkItem(row.work_items);
    if (!rowWorkItem) {
      continue;
    }

    if (
      normalizeLookupValue(rowWorkItem.part_id) !== normalizedWorkItemPartId ||
      normalizeLookupValue(rowWorkItem.item_title) !== normalizedWorkItemItemTitle
    ) {
      continue;
    }

    revisionHistoryById.set(row.id, {
      id: row.id,
      revision: row.revision,
      is_archived: row.is_archived,
      created_at: row.created_at,
      updated_at: row.updated_at,
      updated_by: row.updated_by,
    });
  }

  const revisionHistoryRows = [...revisionHistoryById.values()].sort((first, second) => {
    if (second.revision !== first.revision) {
      return second.revision - first.revision;
    }

    if (first.is_archived !== second.is_archived) {
      return Number(first.is_archived) - Number(second.is_archived);
    }

    return revisionHistoryRowSortValue(second) - revisionHistoryRowSortValue(first);
  });

  const dedupedRevisionHistoryRowsByRevision = new Map<number, InstructionRevisionHistoryRow>();
  for (const row of revisionHistoryRows) {
    if (!dedupedRevisionHistoryRowsByRevision.has(row.revision)) {
      dedupedRevisionHistoryRowsByRevision.set(row.revision, row);
    }
  }

  const dedupedRevisionHistoryRows = [...dedupedRevisionHistoryRowsByRevision.values()].sort(
    (first, second) => {
      if (second.revision !== first.revision) {
        return second.revision - first.revision;
      }

      if (first.is_archived !== second.is_archived) {
        return Number(first.is_archived) - Number(second.is_archived);
      }

      return revisionHistoryRowSortValue(second) - revisionHistoryRowSortValue(first);
    },
  );

  const { data: instructionChangeEventsData } = await supabase
    .from("instruction_change_events")
    .select("id, event_type, detail, occurred_at, actor_user_id, revision, source_payload")
    .eq("instruction_id", instruction.id)
    .order("occurred_at", { ascending: true })
    .limit(400);

  const rawInstructionChangeEvents =
    (instructionChangeEventsData ?? []) as InstructionChangeEventRow[];

  const profileIds = new Set<string>([instruction.created_by, instruction.updated_by]);
  for (const revisionHistoryRow of dedupedRevisionHistoryRows) {
    profileIds.add(revisionHistoryRow.updated_by);
  }
  for (const changeEvent of rawInstructionChangeEvents) {
    profileIds.add(changeEvent.actor_user_id);
  }

  const profileIdList = Array.from(profileIds);
  const { data: users } =
    profileIdList.length > 0
      ? await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", profileIdList)
      : { data: null };

  const userMap = new Map((users ?? []).map((entry) => [entry.id, entry.full_name]));
  const revisionHistoryEntries: InstructionRevisionHistoryEntry[] =
    dedupedRevisionHistoryRows.map((entry) => ({
      id: entry.id,
      revision: entry.revision,
      isArchived: entry.is_archived,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
      updatedByName: userMap.get(entry.updated_by) ?? "Unknown",
    }));

  const instructionUpdateEvents: InstructionUpdateEvent[] =
    rawInstructionChangeEvents.length > 0
      ? rawInstructionChangeEvents.map((changeEvent) => ({
          id: changeEvent.id,
          eventType: changeEvent.event_type === "created" ? "created" : "updated",
          detail:
            changeEvent.detail?.trim() ||
            (changeEvent.event_type === "created"
              ? `Revision ${changeEvent.revision ?? instruction.revision} created.`
              : `Revision ${changeEvent.revision ?? instruction.revision} updated.`),
          occurredAt: changeEvent.occurred_at,
          actorName: userMap.get(changeEvent.actor_user_id) ?? "Unknown",
          sourcePayload: normalizeInstructionUpdateSourcePayload(
            changeEvent.source_payload,
            mediaUrlRuntime,
          ),
        }))
      : (() => {
          const fallbackEvents: InstructionUpdateEvent[] = [
            {
              id: `created:${instruction.id}:${instruction.created_at}`,
              eventType: "created",
              detail: "Instruction created.",
              occurredAt: instruction.created_at,
              actorName: userMap.get(instruction.created_by) ?? "Unknown",
              sourcePayload: null,
            },
          ];

          const createdTimestamp = new Date(instruction.created_at).getTime();
          const updatedTimestamp = new Date(instruction.updated_at).getTime();
          const shouldIncludeUpdateEvent =
            updatedTimestamp > createdTimestamp + 1000 ||
            instruction.updated_by !== instruction.created_by ||
            instruction.revision > 1;

          if (shouldIncludeUpdateEvent) {
            fallbackEvents.push({
              id: `updated:${instruction.id}:${instruction.updated_at}`,
              eventType: "updated",
              detail:
                instruction.last_change_summary?.trim() || "Instruction content updated.",
              occurredAt: instruction.updated_at,
              actorName: userMap.get(instruction.updated_by) ?? "Unknown",
              sourcePayload: null,
            });
          }

          return fallbackEvents;
        })();
  const instructionUpdatedEventCount = instructionUpdateEvents.filter(
    (event) => event.eventType === "updated",
  ).length;

  const [
    { data: pinnedInstruction },
    { data: likedInstruction },
    { count: instructionLikeCount },
    { data: reviewSettingsData, error: reviewSettingsError },
    { data: reviewStatusData, error: reviewStatusError },
    { data: suggestedToolLinkData, error: suggestedToolLinkError },
  ] = await Promise.all([
    supabase
      .from("user_pinned_instructions")
      .select("instruction_id")
      .eq("user_id", profile.id)
      .eq("instruction_id", instruction.id)
      .maybeSingle(),
    supabase
      .from("instruction_likes")
      .select("instruction_id")
      .eq("user_id", profile.id)
      .eq("instruction_id", instruction.id)
      .maybeSingle(),
    supabase
      .from("instruction_likes")
      .select("*", { count: "exact", head: true })
      .eq("instruction_id", instruction.id),
    supabase
      .from("instruction_review_settings")
      .select("review_window_days")
      .eq("id", true)
      .maybeSingle<InstructionReviewSettingsRow>(),
    supabase
      .from("instruction_review_status")
      .select("instruction_id, status, last_calibrated_at, flagged_at, updated_by")
      .eq("instruction_id", instruction.id)
      .maybeSingle<InstructionReviewStatusRow>(),
    supabase
      .from("instruction_suggested_tools")
      .select("suggested_tool_id")
      .eq("instruction_id", instruction.id),
  ]);

  let suggestedTools: SuggestedToolOption[] = [];

  if (suggestedToolLinkError) {
    throw new Error(suggestedToolLinkError.message);
  }

  const linkedToolIds = ((suggestedToolLinkData ?? []) as InstructionSuggestedToolLinkRow[])
    .map((link) => link.suggested_tool_id)
    .filter((value) => value.trim().length > 0);
  const uncommonToolNames = parseToolNames(instruction.uncommon_tools);

  if (linkedToolIds.length > 0) {
    const { data: suggestedToolsData, error: suggestedToolsError } = await supabase
      .from("suggested_tools")
      .select(
        "id, name, category_id, subcategory_id, suggested_tool_categories(name), suggested_tool_subcategories(name)",
      )
      .in("id", linkedToolIds)
      .order("name", { ascending: true });

    if (suggestedToolsError) {
      throw new Error(suggestedToolsError.message);
    }

    const getRelatedName = (
      relation:
        | {
            name: string;
          }
        | Array<{
            name: string;
          }>
        | null
        | undefined,
    ) => {
      if (!relation) {
        return "";
      }

      if (Array.isArray(relation)) {
        return relation[0]?.name ?? "";
      }

      return relation.name;
    };

    suggestedTools = ((suggestedToolsData ?? []) as SuggestedToolRow[])
      .map((tool) => ({
        id: tool.id,
        name: tool.name.trim(),
        categoryName: getRelatedName(tool.suggested_tool_categories).trim() || "General",
        subcategoryName: (() => {
          const normalized = getRelatedName(tool.suggested_tool_subcategories).trim();
          return normalized.length > 0 ? normalized : null;
        })(),
      }))
      .filter((tool) => tool.name.length > 0);
  }

  if (uncommonToolNames.length > 0) {
    const existingToolNames = new Set(
      suggestedTools.map((tool) => tool.name.trim().toLowerCase()),
    );

    for (const [index, toolName] of uncommonToolNames.entries()) {
      const normalizedToolName = toolName.toLowerCase();
      if (existingToolNames.has(normalizedToolName)) {
        continue;
      }

      suggestedTools.push({
        id: `manual-tool-${instruction.id}-${index}`,
        name: toolName,
        categoryName: "General",
        subcategoryName: null,
      });
      existingToolNames.add(normalizedToolName);
    }
  }

  const reviewWindowDays =
    !reviewSettingsError
      ? normalizeReviewWindowDays(reviewSettingsData?.review_window_days) ??
        DEFAULT_REVIEW_WINDOW_DAYS
      : DEFAULT_REVIEW_WINDOW_DAYS;
  const reviewStatus = {
    status:
      !reviewStatusError && reviewStatusData?.status === "needs_review"
        ? "needs_review"
        : "up_to_date",
    lastCalibratedAt:
      !reviewStatusError && reviewStatusData?.last_calibrated_at
        ? reviewStatusData.last_calibrated_at
        : instruction.updated_at,
    flaggedAt:
      !reviewStatusError && reviewStatusData?.status === "needs_review"
        ? reviewStatusData.flagged_at
        : null,
  } as const;
  const reviewStatusUpdatedById =
    !reviewStatusError && reviewStatusData?.updated_by
      ? reviewStatusData.updated_by
      : instruction.updated_by;
  const { data: reviewStatusUpdatedByProfile } =
    reviewStatusUpdatedById && !userMap.has(reviewStatusUpdatedById)
      ? await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", reviewStatusUpdatedById)
          .maybeSingle<{ full_name: string }>()
      : { data: null };
  const reviewLastReviewedByName =
    userMap.get(reviewStatusUpdatedById) ??
    reviewStatusUpdatedByProfile?.full_name ??
    "Unknown";
  const reviewAgeDays = toElapsedCalendarDaysUtc(reviewStatus.lastCalibratedAt);
  const reviewIsOutOfRange =
    reviewAgeDays !== null && reviewAgeDays >= reviewWindowDays;
  const showReviewIndicator =
    reviewStatus.status === "needs_review" || reviewIsOutOfRange;
  const instructionIsArchived = instruction.is_archived;
  const showCompactEditorInstructionActions =
    canEditInstructions(profile.role) && !instructionIsArchived;
  const canPromoteArchivedRevision = canEditInstructions(profile.role);
  const printToolNamesByKey = new Map<string, string>();

  for (const tool of suggestedTools) {
    const normalizedToolName = tool.name.trim();
    if (!normalizedToolName) {
      continue;
    }

    const normalizedToolKey = normalizedToolName.toLowerCase();
    if (!printToolNamesByKey.has(normalizedToolKey)) {
      printToolNamesByKey.set(normalizedToolKey, normalizedToolName);
    }
  }

  const printToolNames = Array.from(printToolNamesByKey.values()).sort((first, second) =>
    first.localeCompare(second),
  );
  const printBodyMedia = extractPrintMediaFromBody(
    rewriteLoopbackMediaUrlsInHtml(instruction.body_markdown, mediaUrlRuntime),
  );
  const printInstructionMedia = normalizeInstructionMediaForPrint(
    instructionMedia,
    mediaUrlRuntime,
  );
  const printMedia = mergePrintMediaGroups(printBodyMedia, printInstructionMedia);

  return (
    <article className="grid min-w-0 gap-5">
      <InstructionArchivedRedirectGuard
        instructionId={instruction.id}
        instructionIsArchived={instructionIsArchived}
      />
      <InstructionViewTracker instructionId={instruction.id} />
      <PrintMediaIsolator
        mode="from-document"
        proseSelector=".print-work-instructions-body .prose, .print-work-instructions-body .prose-markdown"
      />
      <style>
        {`.print-preview-sheet {
          position: fixed;
          left: -100000px;
          top: 0;
          width: 1px;
          height: 1px;
          overflow: hidden;
          opacity: 0;
          pointer-events: none;
        }
        @media print {
          .print-preview-sheet {
            position: static !important;
            left: auto !important;
            top: auto !important;
            width: auto !important;
            height: auto !important;
            overflow: visible !important;
            opacity: 1 !important;
            pointer-events: auto !important;
          }
          html:not([data-print-media-mode="append-to-end"]) .print-media-end-section {
            display: none !important;
          }
          html:not([data-print-media-mode="append-to-end"]) .print-media-block {
            break-before: page !important;
            page-break-before: always !important;
            break-after: page !important;
            page-break-after: always !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          html:not([data-print-media-mode="append-to-end"]) .print-media-block img,
          html:not([data-print-media-mode="append-to-end"]) .print-media-block video,
          html:not([data-print-media-mode="append-to-end"]) img.print-media-block,
          html:not([data-print-media-mode="append-to-end"]) video.print-media-block {
            display: block !important;
            width: auto !important;
            height: auto !important;
            max-width: 100% !important;
            max-height: 9in !important;
            margin: 0 auto !important;
            object-fit: contain !important;
          }
          html[data-print-media-mode="append-to-end"] .print-work-instructions-body .print-media-block {
            display: none !important;
          }
          html[data-print-media-mode="append-to-end"] .print-media-end-section {
            break-before: page !important;
            page-break-before: always !important;
          }
          html[data-print-media-mode="append-to-end"] .print-media-end-section[data-has-media="false"] {
            display: none !important;
          }
          html[data-print-media-mode="append-to-end"] .print-media-end-item {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          html[data-print-media-mode="append-to-end"] .print-media-end-item + .print-media-end-item {
            break-before: page !important;
            page-break-before: always !important;
          }
          html[data-print-media-mode="append-to-end"] .print-media-end-item img,
          html[data-print-media-mode="append-to-end"] .print-media-end-item video {
            display: block !important;
            width: auto !important;
            height: auto !important;
            max-width: 100% !important;
            max-height: 9in !important;
            margin: 0 auto !important;
            object-fit: contain !important;
          }
          html[data-print-media-mode="append-to-end"] .print-media-end-caption {
            margin-top: 0.3rem;
            text-align: center;
            font-size: 0.8rem;
            color: #334155;
          }
          html[data-print-media-mode="append-to-end"] .print-media-end-target {
            display: grid !important;
            gap: 0.5rem !important;
          }
        }`}
      </style>

      <section className="print-preview-sheet print:bg-white print:text-slate-900">
        <h1 className="text-3xl font-extrabold text-slate-900">{workItem.item_title}</h1>
        <p className="mt-1 text-sm text-slate-700">
          Revision <span className="font-semibold">{instruction.revision}</span>
        </p>

        <section className="mt-6 grid gap-2">
          <h2 className="text-xl font-bold text-slate-900">Tool List</h2>
          {printToolNames.length === 0 ? (
            <p className="text-sm text-slate-700">No tools listed.</p>
          ) : (
            <ul className="list-disc pl-5 text-sm text-slate-800">
              {printToolNames.map((toolName) => (
                <li key={toolName}>{toolName}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6 grid gap-2">
          <h2 className="text-xl font-bold text-slate-900">Work Instructions</h2>
          <div className="print-work-instructions-body rounded-xl border border-slate-300 bg-white p-4">
            {renderInstructionContent(instruction.body_markdown, mediaUrlRuntime)}
          </div>
        </section>

        <section
          className="print-media-end-section mt-6 grid gap-2"
          data-has-media={printMedia.length > 0 ? "true" : "false"}
        >
          <h2 className="text-xl font-bold text-slate-900">Media</h2>
          <div className="print-media-end-target grid gap-2">
            {printMedia.map((mediaItem, index) => (
              <figure
                key={`${mediaItem.type}-${mediaItem.src}-${index}`}
                className="print-media-end-item"
              >
                {mediaItem.type === "video" ? (
                  <video controls playsInline preload="metadata">
                    <source
                      src={mediaItem.src}
                      type={inferVideoMimeType(mediaItem.src) ?? undefined}
                    />
                    Video playback unavailable on this device.
                  </video>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaItem.src}
                    alt={mediaItem.caption ?? "Instruction media"}
                    loading="eager"
                  />
                )}
                {mediaItem.caption ? (
                  <figcaption className="print-media-end-caption">
                    {mediaItem.caption}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        </section>
      </section>

      <div className="grid gap-5 print:hidden">
        <InstructionBackButton
          fallbackHref={instructionIsArchived ? "/instructions/archived" : "/dashboard"}
        />

        <header className="relative z-20 min-w-0 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7">
        {!instructionIsArchived && showReviewIndicator ? (
          <div
            className={`mb-4 rounded-2xl border px-4 py-3 ${
              reviewStatus.status === "needs_review"
                ? "border-amber-500/45 bg-amber-500/12"
                : "border-cyan-500/45 bg-cyan-500/12"
            }`}
          >
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {reviewStatus.status === "needs_review"
                ? "Needs Review flagged"
                : "Review check due"}
            </p>
            <p className="text-xs text-slate-700 dark:text-slate-200">
              {reviewStatus.status === "needs_review"
                ? "This instruction has been flagged for review. It remains available for use while clarity or accuracy updates are assessed."
                : `This instruction is outside the ${reviewWindowDays}-day review range. It remains available for use, and should be confirmed as Up To Date.`}
            </p>
          </div>
        ) : null}

        {instructionIsArchived ? (
          <div className="mb-4 rounded-2xl border border-amber-500/45 bg-amber-500/12 px-4 py-3">
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
              This instruction is currently archived.
            </p>
            <p className="text-xs text-slate-700 dark:text-slate-200">
              This revision is stored in history and hidden from dashboard/search.
            </p>
          </div>
        ) : null}

        {isForkInstruction ? (
          <div className="mb-4 rounded-2xl border border-cyan-500/45 bg-cyan-500/12 px-4 py-3">
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Fork {instructionForkNumber}
            </p>
            <p className="text-xs text-slate-700 dark:text-slate-200">
              This is a forked instruction branch. Merges always apply to the original instruction.
              {forkRootLookup ? (
                <>
                  {" "}
                  <Link
                    href={`/instructions/${forkFamilyRootId}`}
                    className="font-semibold text-cyan-800 underline underline-offset-2 transition hover:text-cyan-700 dark:text-cyan-200"
                  >
                    Open original
                  </Link>
                  .
                </>
              ) : null}
            </p>
            {instruction.merged_into_root_at ? (
              <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                Last merged into original on{" "}
                <LocalDateTime value={instruction.merged_into_root_at} mode="dateTime" />.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100">
                {workItem.item_title}
              </h1>
              {isForkInstruction ? (
                <span className="inline-flex items-center rounded-full border border-cyan-500/45 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-800 dark:text-cyan-100">
                  Fork {instructionForkNumber}
                </span>
              ) : forkCount > 0 ? (
                <span className="inline-flex items-center rounded-full border border-violet-500/45 bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-100">
                  Original | {forkCount} Fork{forkCount === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Part ID: <strong>{workItem.part_id}</strong> | Department:{" "}
              <strong>{departmentName}</strong> | Revision{" "}
              <strong>{instruction.revision}</strong>
              {instruction.ai_assisted ? (
                <span className="ml-2 inline-flex items-center rounded-full border border-cyan-500/45 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-800 dark:text-cyan-100">
                  Created With AI
                </span>
              ) : null}
              <span className="ml-1 inline-flex items-center gap-1 align-middle">
                <InstructionRevisionHistoryControl
                  currentInstructionId={instruction.id}
                  entries={revisionHistoryEntries}
                  canPromoteArchivedRevision={canPromoteArchivedRevision}
                  hideBaseRevision={instructionIsArchived}
                />
                {instructionIsArchived && canPromoteArchivedRevision ? (
                  <RestoreArchivedInstructionButton
                    instructionId={instruction.id}
                    revision={instruction.revision}
                    partId={workItem.part_id}
                    departmentName={departmentName}
                  />
                ) : null}
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Created by {userMap.get(instruction.created_by) ?? "Unknown"} on{" "}
              <LocalDateTime value={instruction.created_at} mode="dateTime" /> | Updated by{" "}
              {userMap.get(instruction.updated_by) ?? "Unknown"} on{" "}
              <LocalDateTime value={instruction.updated_at} mode="dateTime" />
            </p>
          </div>
          <div className="grid gap-2 md:justify-items-end">
            <div className="flex flex-wrap items-center justify-end gap-2">
              {!instructionIsArchived ? (
                <InstructionReviewControls
                  instructionId={instruction.id}
                  instructionUpdatedAt={instruction.updated_at}
                  reviewWindowDays={reviewWindowDays}
                  lastReviewedByName={reviewLastReviewedByName}
                  initialStatus={reviewStatus.status}
                  initialLastCalibratedAt={reviewStatus.lastCalibratedAt}
                  initialFlaggedAt={reviewStatus.flaggedAt}
                  className="shrink-0"
                />
              ) : null}
              <SuggestedToolsDropdown
                tools={suggestedTools}
                className="shrink-0"
              />
              {!instructionIsArchived ? (
                <LikeInstructionButton
                  instructionId={instruction.id}
                  userId={profile.id}
                  initialLiked={Boolean(likedInstruction)}
                  initialLikeCount={instructionLikeCount ?? 0}
                  className="justify-center"
                />
              ) : null}
              <InstructionActionMenu badgeCount={instructionUpdatedEventCount}>
                <InstructionUpdatesPanel
                  events={instructionUpdateEvents}
                  className="h-fit w-full justify-center self-start"
                />
                {instructionIsArchived ? (
                  <PrintInstructionButton className="w-full" />
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <PrintInstructionButton className="w-full" />
                    <PinInstructionButton
                      instructionId={instruction.id}
                      userId={profile.id}
                      initialPinned={Boolean(pinnedInstruction)}
                      className="w-full justify-center px-2 py-1.5"
                    />
                  </div>
                )}
                {showCompactEditorInstructionActions ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Link
                      href={`/instructions/${instruction.id}/fork`}
                      className="inline-flex items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-2 py-1.5 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/20 dark:text-cyan-200"
                    >
                      Fork
                    </Link>
                    <Link
                      href={`/instructions/${instruction.id}/edit`}
                      className="inline-flex items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-2 py-1.5 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/20 dark:text-cyan-200"
                    >
                      Edit
                    </Link>
                  </div>
                ) : null}
                {showCompactEditorInstructionActions && isForkInstruction && instructionForkNumber ? (
                  <InstructionForkMergeControl
                    forkInstructionId={instruction.id}
                    forkNumber={instructionForkNumber}
                    rootInstructionId={forkFamilyRootId}
                    forkPartId={workItem.part_id}
                    rootPartId={forkRootWorkItem?.part_id ?? workItem.part_id}
                    forkItemTitle={workItem.item_title}
                    rootItemTitle={forkRootWorkItem?.item_title ?? workItem.item_title}
                    forkDepartmentName={departmentName}
                    rootDepartmentName={forkRootDepartmentName}
                    forkBodyMarkdown={instruction.body_markdown}
                    rootBodyMarkdown={forkRootLookup?.body_markdown ?? ""}
                    forkRevision={instruction.revision}
                    rootRevision={forkRootLookup?.revision ?? instruction.revision}
                    forkMedia={forkInstructionMedia}
                    rootMedia={forkRootMedia}
                    className="w-full justify-center px-3 py-1.5 text-xs"
                  />
                ) : null}
                {isSystemAdmin(profile.role) && !instructionIsArchived ? (
                  <DeleteInstructionButton
                    instructionId={instruction.id}
                    className="w-full justify-center px-3 py-1.5 text-xs"
                  />
                ) : null}
              </InstructionActionMenu>
            </div>
          </div>
        </div>
        </header>

        <section className="grid min-w-0 gap-4 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7">
          <h2 className="text-xl font-bold">Work Instructions</h2>
          <div className="screen-work-instructions-body min-w-0 max-w-full">
            <InstructionBodyLightbox>
              {renderInstructionContent(instruction.body_markdown, mediaUrlRuntime)}
            </InstructionBodyLightbox>
          </div>
        </section>

        {instructionMedia.length > 0 ? (
          <section className="grid min-w-0 gap-4 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7">
            <h2 className="text-xl font-bold">Media</h2>
            <InstructionMediaSection media={instructionMedia} />
          </section>
        ) : null}

        {isForkInstruction || forkCount > 0 ? (
          <section className="grid min-w-0 gap-4 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7">
            <div className="grid gap-1">
              <h2 className="text-xl font-bold">Fork Branches</h2>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Branches are numbered per original instruction and always merge back to the original.
              </p>
            </div>

            <div className="grid gap-2">
              {isForkInstruction ? (
                <Link
                  href={`/instructions/${forkFamilyRootId}`}
                  className="grid gap-1 rounded-xl border border-violet-500/40 bg-violet-500/10 px-3 py-2 transition hover:bg-violet-500/15"
                >
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Original Instruction
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    {forkRootWorkItem?.part_id ?? workItem.part_id} |{" "}
                    {forkRootWorkItem?.item_title ?? workItem.item_title} | {forkRootDepartmentName}
                  </p>
                </Link>
              ) : null}

              {forkFamilyRows.length > 0 ? (
                forkFamilyRows.map((forkRow) => {
                  const isCurrentFork = forkRow.id === instruction.id;
                  const forkStatusLabel = forkRow.merged_into_root_at
                    ? "Merged"
                    : isCurrentFork
                      ? "Currently Open"
                      : "Open Branch";
                  const forkStatusClassName = forkRow.merged_into_root_at
                    ? "border-emerald-500/45 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                    : isCurrentFork
                      ? "border-amber-500/45 bg-amber-500/15 text-amber-800 dark:text-amber-200"
                      : "border-sky-500/45 bg-sky-500/15 text-sky-800 dark:text-sky-200";

                  return (
                    <Link
                      key={forkRow.id}
                      href={`/instructions/${forkRow.id}`}
                      className="grid gap-1 rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-3 py-2 transition hover:bg-cyan-500/15"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          Fork {forkRow.fork_number ?? "?"}
                        </p>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${forkStatusClassName}`}
                        >
                          {forkStatusLabel}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        Created <LocalDateTime value={forkRow.created_at} mode="dateTime" />
                        {forkRow.merged_into_root_at ? (
                          <>
                            {" "}
                            | Last merged{" "}
                            <LocalDateTime value={forkRow.merged_into_root_at} mode="dateTime" />
                          </>
                        ) : null}
                        {forkRow.is_archived ? " | Archived" : ""}
                      </p>
                    </Link>
                  );
                })
              ) : (
                <p className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                  No fork branches have been created yet.
                </p>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </article>
  );
}
