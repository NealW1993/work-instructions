/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import sanitizeHtml from "sanitize-html";

import { DeleteInstructionButton } from "@/components/instructions/delete-instruction-button";
import { InstructionBackButton } from "@/components/instructions/instruction-back-button";
import { LikeInstructionButton } from "@/components/instructions/like-instruction-button";
import { PinInstructionButton } from "@/components/instructions/pin-instruction-button";
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
        part_number: string;
        mold_number: string;
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
        part_number: string;
        mold_number: string;
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
      "id, is_archived, body_markdown, last_change_summary, revision, created_at, updated_at, created_by, updated_by, work_items(id, part_number, mold_number, item_title, departments(name)), instruction_media(id, instruction_id, storage_path, public_url, media_type, caption, sort_order, created_by, created_at)",
    )
    .eq("id", id)
    .eq("is_archived", false)
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

  const { data: instructionChangeEventsData } = await supabase
    .from("instruction_change_events")
    .select("id, event_type, detail, occurred_at, actor_user_id, revision, source_payload")
    .eq("instruction_id", instruction.id)
    .order("occurred_at", { ascending: true })
    .limit(400);

  const rawInstructionChangeEvents =
    (instructionChangeEventsData ?? []) as InstructionChangeEventRow[];

  const profileIds = new Set<string>([instruction.created_by, instruction.updated_by]);
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
  ]);

  return (
    <article className="grid gap-5">
      <InstructionBackButton fallbackHref="/dashboard" />

      <header className="rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100">
              {workItem.item_title}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Part: <strong>{workItem.part_number}</strong> | Mold:{" "}
              <strong>{workItem.mold_number || "N/A"}</strong> | Department:{" "}
              <strong>{departmentName}</strong> | Revision{" "}
              <strong>{instruction.revision}</strong>
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Created by {userMap.get(instruction.created_by) ?? "Unknown"} on{" "}
              <LocalDateTime value={instruction.created_at} mode="dateTime" /> | Updated by{" "}
              {userMap.get(instruction.updated_by) ?? "Unknown"} on{" "}
              <LocalDateTime value={instruction.updated_at} mode="dateTime" />
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LikeInstructionButton
              instructionId={instruction.id}
              userId={profile.id}
              initialLiked={Boolean(likedInstruction)}
              initialLikeCount={instructionLikeCount ?? 0}
            />
            <PinInstructionButton
              instructionId={instruction.id}
              userId={profile.id}
              initialPinned={Boolean(pinnedInstruction)}
            />
            {canEditInstructions(profile.role) ? (
              <Link
                href={`/instructions/${instruction.id}/fork`}
                className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-500/20 dark:text-cyan-200"
              >
                Fork Instruction
              </Link>
            ) : null}
            {canEditInstructions(profile.role) ? (
              <Link
                href={`/instructions/${instruction.id}/edit`}
                className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-500/20 dark:text-cyan-200"
              >
                Edit Instruction
              </Link>
            ) : null}
            {isSystemAdmin(profile.role) ? (
              <DeleteInstructionButton instructionId={instruction.id} />
            ) : null}
          </div>
        </div>
      </header>

      <InstructionUpdatesPanel events={instructionUpdateEvents} />

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
