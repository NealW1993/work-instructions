/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import sanitizeHtml from "sanitize-html";

import { DeleteInstructionButton } from "@/components/instructions/delete-instruction-button";
import { InstructionBackButton } from "@/components/instructions/instruction-back-button";
import {
  type InstructionRevisionHistoryEntry,
  InstructionRevisionHistoryControl,
} from "@/components/instructions/instruction-revision-history-control";
import { InstructionReviewControls } from "@/components/instructions/instruction-review-controls";
import { LikeInstructionButton } from "@/components/instructions/like-instruction-button";
import { PinInstructionButton } from "@/components/instructions/pin-instruction-button";
import { RestoreArchivedInstructionButton } from "@/components/instructions/restore-archived-instruction-button";
import {
  type InstructionUpdateEvent,
  type InstructionUpdateSourcePayload,
  InstructionUpdatesPanel,
} from "@/components/instructions/instruction-updates-panel";
import { LocalDateTime } from "@/components/ui/local-date-time";
import { requireAuthenticatedUser } from "@/lib/auth";
import { canEditInstructions, isSystemAdmin } from "@/lib/roles";
import type { InstructionMedia } from "@/lib/types";

interface InstructionPageProps {
  params: Promise<{
    id: string;
  }>;
}

interface InstructionRecord {
  id: string;
  work_item_id: string;
  is_archived: boolean;
  body_markdown: string;
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
      "label",
      "input",
    ],
    allowedAttributes: {
      figure: ["data-type", "data-align", "data-width", "style", "class"],
      img: ["src", "alt", "title", "width", "height", "style", "class"],
      video: ["src", "controls", "width", "height", "style", "class"],
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

function revisionHistoryRowSortValue(row: InstructionRevisionHistoryRow) {
  const updatedAtValue = Date.parse(row.updated_at);
  return Number.isFinite(updatedAtValue) ? updatedAtValue : 0;
}

function renderInstructionContent(value: string) {
  if (!value.trim()) {
    return null;
  }

  if (looksLikeHtml(value)) {
    return (
      <div
        className="prose-markdown"
        dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(value) }}
      />
    );
  }

  return (
    <div className="prose-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
    </div>
  );
}

function normalizeInstructionUpdateSourcePayload(
  value: unknown,
): InstructionUpdateSourcePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
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
        const src = typeof mediaEntry.src === "string" ? mediaEntry.src.trim() : "";

        if (!type || !src) {
          return null;
        }

        return { type, src };
      })
      .filter((entry): entry is { type: "image" | "video"; src: string } => entry !== null);
  };

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
  };

  const hasPayloadData =
    Boolean(normalizedPayload.addedTextSnippet) ||
    Boolean(normalizedPayload.removedTextSnippet) ||
    (normalizedPayload.addedMedia?.length ?? 0) > 0 ||
    (normalizedPayload.removedMedia?.length ?? 0) > 0 ||
    normalizedPayload.mediaFormattingUpdated === true ||
    normalizedPayload.previousRevision !== undefined ||
    normalizedPayload.nextRevision !== undefined;

  return hasPayloadData ? normalizedPayload : null;
}

export default async function InstructionDetailsPage({ params }: InstructionPageProps) {
  const { id } = await params;
  const { supabase, profile } = await requireAuthenticatedUser();

  const { data, error } = await supabase
    .from("work_instructions")
    .select(
      "id, work_item_id, is_archived, body_markdown, last_change_summary, revision, created_at, updated_at, created_by, updated_by, work_items(id, department_id, part_id, item_title, departments(name)), instruction_media(id, instruction_id, storage_path, public_url, media_type, caption, sort_order, created_by, created_at)",
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

  if (!workItem) {
    notFound();
  }

  const [
    { data: revisionHistoryByWorkItemData, error: revisionHistoryByWorkItemError },
    { data: revisionHistoryByPartAndDepartmentData, error: revisionHistoryByPartAndDepartmentError },
  ] = await Promise.all([
    supabase
      .from("work_instructions")
      .select("id, revision, is_archived, created_at, updated_at, updated_by")
      .eq("work_item_id", instruction.work_item_id)
      .order("revision", { ascending: false })
      .order("updated_at", { ascending: false }),
    supabase
      .from("work_instructions")
      .select(
        "id, revision, is_archived, created_at, updated_at, updated_by, work_items!inner(part_id, item_title, department_id)",
      )
      .eq("work_items.department_id", workItem.department_id),
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
          sourcePayload: normalizeInstructionUpdateSourcePayload(changeEvent.source_payload),
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

  const [
    { data: pinnedInstruction },
    { data: likedInstruction },
    { count: instructionLikeCount },
    { data: reviewSettingsData, error: reviewSettingsError },
    { data: reviewStatusData, error: reviewStatusError },
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
      .select("instruction_id, status, last_calibrated_at, flagged_at")
      .eq("instruction_id", instruction.id)
      .maybeSingle<InstructionReviewStatusRow>(),
  ]);

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
  const reviewAgeDays = toElapsedCalendarDaysUtc(reviewStatus.lastCalibratedAt);
  const reviewIsOutOfRange =
    reviewAgeDays !== null && reviewAgeDays >= reviewWindowDays;
  const showReviewIndicator =
    reviewStatus.status === "needs_review" || reviewIsOutOfRange;
  const instructionIsArchived = instruction.is_archived;
  const showCompactEditorInstructionActions =
    canEditInstructions(profile.role) && !instructionIsArchived;
  const canPromoteArchivedRevision = canEditInstructions(profile.role);

  return (
    <article className="grid gap-5">
      <InstructionBackButton
        fallbackHref={instructionIsArchived ? "/instructions/archived" : "/dashboard"}
      />

      <header className="rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7">
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

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100">
              {workItem.item_title}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Part ID: <strong>{workItem.part_id}</strong> | Department:{" "}
              <strong>{departmentName}</strong> | Revision{" "}
              <strong>{instruction.revision}</strong>
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
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
              {!instructionIsArchived ? (
                <InstructionReviewControls
                  instructionId={instruction.id}
                  instructionUpdatedAt={instruction.updated_at}
                  reviewWindowDays={reviewWindowDays}
                  initialStatus={reviewStatus.status}
                  initialLastCalibratedAt={reviewStatus.lastCalibratedAt}
                  initialFlaggedAt={reviewStatus.flaggedAt}
                />
              ) : null}

              <div className="grid w-full max-w-[14rem] justify-items-stretch gap-2 md:w-[14rem]">
                <InstructionUpdatesPanel
                  events={instructionUpdateEvents}
                  className="h-fit w-full justify-center self-start"
                />
                {!instructionIsArchived ? (
                  <div className="grid grid-cols-2 gap-2">
                    <LikeInstructionButton
                      instructionId={instruction.id}
                      userId={profile.id}
                      initialLiked={Boolean(likedInstruction)}
                      initialLikeCount={instructionLikeCount ?? 0}
                      className="w-full justify-center px-2 py-1.5"
                    />
                    <PinInstructionButton
                      instructionId={instruction.id}
                      userId={profile.id}
                      initialPinned={Boolean(pinnedInstruction)}
                      className="w-full justify-center px-2 py-1.5"
                    />
                  </div>
                ) : null}
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
                {isSystemAdmin(profile.role) && !instructionIsArchived ? (
                  <DeleteInstructionButton
                    instructionId={instruction.id}
                    className="w-full justify-center px-3 py-1.5 text-xs"
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="grid gap-4 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7">
        <h2 className="text-xl font-bold">Work Instructions</h2>
        {renderInstructionContent(instruction.body_markdown)}
      </section>

      {instruction.instruction_media.length > 0 ? (
        <section className="grid gap-4 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7">
          <h2 className="text-xl font-bold">Media</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {instruction.instruction_media
              .slice()
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((media) => (
                <figure
                  key={media.id}
                  className="overflow-hidden rounded-2xl border border-slate-300/70 bg-slate-50 dark:border-slate-700 dark:bg-slate-950"
                >
                  {media.media_type === "video" ? (
                    <video
                      src={media.public_url}
                      controls
                      className="max-h-[420px] w-full bg-black"
                    />
                  ) : (
                    <img
                      src={media.public_url}
                      alt={media.caption ?? "Instruction media"}
                      className="max-h-[420px] w-full object-cover"
                    />
                  )}
                  {media.caption ? (
                    <figcaption className="p-2 text-xs text-slate-600 dark:text-slate-300">
                      {media.caption}
                    </figcaption>
                  ) : null}
                </figure>
              ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}
