import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import sanitizeHtml from "sanitize-html";

import { AutoPrintTrigger } from "@/components/instructions/auto-print-trigger";
import { PrintPageControls } from "@/components/instructions/print-page-controls";
import { requireAuthenticatedUser } from "@/lib/auth";

interface InstructionPrintPageProps {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    autoprint?: string;
  }>;
}

interface InstructionPrintRecord {
  id: string;
  revision: number;
  body_markdown: string;
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

export default async function InstructionPrintPage({
  params,
  searchParams,
}: InstructionPrintPageProps) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const autoPrintEnabled =
    resolvedSearchParams.autoprint === "1" ||
    resolvedSearchParams.autoprint === "true";
  const { supabase } = await requireAuthenticatedUser();

  const { data, error } = await supabase
    .from("work_instructions")
    .select("id, revision, body_markdown, work_items(part_id, item_title, departments(name))")
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

  const toolNames = ((toolRows ?? []) as SuggestedToolRow[])
    .map((entry) => entry.name.trim())
    .filter((entry) => entry.length > 0);

  return (
    <>
      <AutoPrintTrigger enabled={autoPrintEnabled} />
      <style>
        {`@media print {
          header { display: none !important; }
          main {
            max-width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .print-toolbar { display: none !important; }
          .print-sheet {
            border: none !important;
            box-shadow: none !important;
            background: #fff !important;
            margin: 0 !important;
            padding: 0 !important;
          }
        }`}
      </style>
      <article className="print-sheet mx-auto max-w-4xl rounded-2xl border border-slate-300/70 bg-white p-6 shadow-lg dark:border-slate-700 dark:bg-slate-950">
        <PrintPageControls instructionHref={`/instructions/${instruction.id}`} />

        <header className="border-b border-slate-300 pb-4 dark:border-slate-700">
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100">
            {workItem.item_title}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Revision <span className="font-semibold">{instruction.revision}</span>
          </p>
        </header>

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
          <div className="rounded-xl border border-slate-300/70 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
            {renderInstructionContent(instruction.body_markdown)}
          </div>
        </section>
      </article>
    </>
  );
}
