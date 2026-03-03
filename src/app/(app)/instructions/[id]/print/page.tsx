import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import sanitizeHtml from "sanitize-html";

import { AutoPrintTrigger } from "@/components/instructions/auto-print-trigger";
import {
  PrintMediaIsolator,
  type PrintMediaMode,
} from "@/components/instructions/print-media-isolator";
import { PrintPageControls } from "@/components/instructions/print-page-controls";
import { requireAuthenticatedUser } from "@/lib/auth";

interface InstructionPrintPageProps {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    autoprint?: string;
    mediaMode?: string;
  }>;
}

interface InstructionPrintRecord {
  id: string;
  revision: number;
  body_markdown: string;
  uncommon_tools: string;
  instruction_media: InstructionPrintMediaRow[] | null;
  work_items:
    | {
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
      }>
    | null;
}

interface InstructionSuggestedToolLinkRow {
  suggested_tool_id: string;
}

interface SuggestedToolRow {
  id: string;
  name: string;
}

interface InstructionPrintMediaRow {
  public_url: string;
  media_type: "image" | "video";
  caption: string | null;
  sort_order: number;
}

interface PrintMediaItem {
  type: "image" | "video";
  src: string;
  caption: string | null;
}

function getWorkItem(relation: InstructionPrintRecord["work_items"]) {
  if (!relation) {
    return null;
  }

  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }

  return relation;
}

function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
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
  });
}

function renderInstructionContent(value: string) {
  if (looksLikeHtml(value)) {
    const sanitized = sanitizeRichHtml(value);
    return (
      <div
        className="prose prose-slate max-w-none dark:prose-invert"
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
    );
  }

  return (
    <div className="prose prose-slate max-w-none dark:prose-invert">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
    </div>
  );
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
  const imageTagPattern = /<img\b[^>]*>/gi;
  let imageMatch: RegExpExecArray | null = imageTagPattern.exec(snippet);
  while (imageMatch) {
    const tagMarkup = imageMatch[0];
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

    imageMatch = imageTagPattern.exec(snippet);
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

function normalizeInstructionMediaForPrint(media: InstructionPrintMediaRow[] | null | undefined) {
  if (!media || media.length === 0) {
    return [] as PrintMediaItem[];
  }

  return [...media]
    .sort((first, second) => first.sort_order - second.sort_order)
    .map((mediaItem) => ({
      type: mediaItem.media_type,
      src: mediaItem.public_url.trim(),
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

export default async function InstructionPrintPage({
  params,
  searchParams,
}: InstructionPrintPageProps) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const autoPrintEnabled =
    resolvedSearchParams.autoprint === "1" ||
    resolvedSearchParams.autoprint === "true";
  const printMediaMode: PrintMediaMode =
    resolvedSearchParams.mediaMode === "end" ||
    resolvedSearchParams.mediaMode === "append" ||
    resolvedSearchParams.mediaMode === "append-to-end"
      ? "append-to-end"
      : "paginate-inline";
  const printModeClassName =
    printMediaMode === "append-to-end" ? "print-mode-append" : "print-mode-inline";
  const { supabase } = await requireAuthenticatedUser();

  const { data, error } = await supabase
    .from("work_instructions")
    .select(
      "id, revision, body_markdown, uncommon_tools, instruction_media(public_url, media_type, caption, sort_order), work_items(part_id, item_title, departments(name))",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    notFound();
  }

  const instruction = data as InstructionPrintRecord;
  const workItem = getWorkItem(instruction.work_items);
  if (!workItem) {
    notFound();
  }

  const { data: toolLinks, error: toolLinkError } = await supabase
    .from("instruction_suggested_tools")
    .select("suggested_tool_id")
    .eq("instruction_id", instruction.id);

  if (toolLinkError) {
    throw new Error(toolLinkError.message);
  }

  const linkedToolIds = ((toolLinks ?? []) as InstructionSuggestedToolLinkRow[])
    .map((entry) => entry.suggested_tool_id)
    .filter((entry) => entry.trim().length > 0);

  const { data: toolRows, error: toolRowsError } =
    linkedToolIds.length > 0
      ? await supabase
          .from("suggested_tools")
          .select("id, name")
          .in("id", linkedToolIds)
          .order("name", { ascending: true })
      : { data: [], error: null };

  if (toolRowsError) {
    throw new Error(toolRowsError.message);
  }

  const linkedToolNames = ((toolRows ?? []) as SuggestedToolRow[])
    .map((entry) => entry.name.trim())
    .filter((entry) => entry.length > 0);
  const toolNamesByKey = new Map<string, string>();

  for (const toolName of [...linkedToolNames, ...parseToolNames(instruction.uncommon_tools)]) {
    const key = toolName.toLowerCase();
    if (!toolNamesByKey.has(key)) {
      toolNamesByKey.set(key, toolName);
    }
  }

  const toolNames = Array.from(toolNamesByKey.values()).sort((first, second) =>
    first.localeCompare(second),
  );
  const printBodyMedia = extractPrintMediaFromBody(instruction.body_markdown);
  const printInstructionMedia = normalizeInstructionMediaForPrint(instruction.instruction_media);
  const printMedia = mergePrintMediaGroups(printBodyMedia, printInstructionMedia);

  return (
    <>
      <AutoPrintTrigger
        enabled={autoPrintEnabled}
        waitForSelector={printMediaMode === "append-to-end" ? ".print-media-end-target" : undefined}
      />
      <PrintMediaIsolator
        mode="paginate-inline"
        proseSelector=".print-work-instructions-body .prose, .print-work-instructions-body .prose-markdown"
      />
      <style>
        {`@media print {
          @page { margin: 0.5in 0.6in; }
          header { display: none !important; }
          main {
            max-width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
            overflow: visible !important;
          }
          .print-toolbar { display: none !important; }
          .print-sheet {
            border: none !important;
            box-shadow: none !important;
            background: #fff !important;
            margin: 0 !important;
            padding: 0 !important;
            border-radius: 0 !important;
            overflow: visible !important;
            max-width: 100% !important;
          }
          .print-sheet * {
            overflow: visible !important;
          }
          .print-sheet .rounded-xl,
          .print-sheet .rounded-2xl {
            border-radius: 0 !important;
            border: none !important;
            padding: 0 !important;
          }
          table, pre, blockquote {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .print-sheet.print-mode-inline .print-media-end-section {
            display: none !important;
          }
          .print-sheet.print-mode-inline .print-media-block {
            break-before: page !important;
            page-break-before: always !important;
            break-after: page !important;
            page-break-after: always !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          .print-sheet.print-mode-inline .print-media-block img,
          .print-sheet.print-mode-inline .print-media-block video,
          .print-sheet.print-mode-inline img.print-media-block,
          .print-sheet.print-mode-inline video.print-media-block {
            display: block;
            max-width: 100% !important;
            max-height: 9in !important;
            width: auto !important;
            height: auto !important;
            margin: 0 auto;
            object-fit: contain;
          }
          .print-sheet.print-mode-append .print-work-instructions-body .print-media-block {
            display: none !important;
          }
          .print-sheet.print-mode-append .print-media-end-section[data-has-media="false"] {
            display: none !important;
          }
          .print-sheet.print-mode-append .print-media-end-section {
            break-before: page !important;
            page-break-before: always !important;
          }
          .print-sheet.print-mode-append .print-media-end-item {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          .print-sheet.print-mode-append .print-media-end-item + .print-media-end-item {
            break-before: page !important;
            page-break-before: always !important;
          }
          .print-sheet.print-mode-append .print-media-end-item img,
          .print-sheet.print-mode-append .print-media-end-item video {
            display: block;
            max-width: 100% !important;
            max-height: 9in !important;
            width: auto !important;
            height: auto !important;
            margin: 0 auto;
            object-fit: contain;
          }
          .print-sheet.print-mode-append .print-media-end-caption {
            margin-top: 0.3rem;
            text-align: center;
            font-size: 0.8rem;
            color: #334155;
          }
          h1, h2, h3 {
            break-after: avoid;
            page-break-after: avoid;
          }
          p, li {
            orphans: 3;
            widows: 3;
          }
          img, video {
            max-width: 100% !important;
            height: auto !important;
            display: block;
          }
        }`}
      </style>
      <article
        className={`print-sheet ${printModeClassName} mx-auto max-w-4xl rounded-2xl border border-slate-300/70 bg-white p-6 shadow-lg dark:border-slate-700 dark:bg-slate-950`}
      >
        <PrintPageControls instructionHref={`/instructions/${instruction.id}`} />

        <section className="border-b border-slate-300 pb-4 dark:border-slate-700">
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100">
            {workItem.item_title}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Revision <span className="font-semibold">{instruction.revision}</span>
          </p>
        </section>

        <section className="mt-5 grid gap-2">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Tool List</h2>
          {toolNames.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">No tools listed.</p>
          ) : (
            <ul className="list-disc pl-5 text-sm text-slate-800 dark:text-slate-200">
              {toolNames.map((toolName) => (
                <li key={toolName}>{toolName}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6 grid gap-2">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            Work Instructions
          </h2>
          <div className="print-work-instructions-body rounded-xl border border-slate-300/70 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
            {renderInstructionContent(instruction.body_markdown)}
          </div>
        </section>

        <section
          className="print-media-end-section mt-6 grid gap-2"
          data-has-media={printMedia.length > 0 ? "true" : "false"}
        >
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Media</h2>
          <div className="print-media-end-target grid gap-2">
            {printMedia.map((mediaItem, index) => (
              <figure
                key={`${mediaItem.type}-${mediaItem.src}-${index}`}
                className="print-media-end-item"
              >
                {mediaItem.type === "video" ? (
                  <video src={mediaItem.src} controls preload="auto" />
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
      </article>
    </>
  );
}
