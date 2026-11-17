import { type AnyExtension, mergeAttributes, Node, type JSONContent } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";

import {
  CALLOUT_KINDS,
  calloutKindForTone,
  type CalloutKind,
  isVideoSource,
  markdownImage,
  serializeChartSource,
} from "@/lib/editor-content";
import { normalizeChartData, type ChartPoint, type InstructionChartType } from "@/lib/instruction-chart";
import { resolveAccessibleMediaUrl } from "@/lib/media-url";

/*
 * The blocks of the formatted instruction editor. Each block reads the HTML the viewer renders and writes
 * the same Markdown the app has always stored, so saved instructions, prints, downloads and AI help keep
 * working unchanged. On-screen views for charts and media are added in components/ui/rich-editor-extensions.
 */

/* Safety callouts: > [!CAUTION] / [!WARNING] / [!IMPORTANT] / [!NOTE] / [!TIP] */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      kind: {
        default: "NOTE",
        parseHTML: (element) => calloutKindForTone(element.getAttribute("data-tone")),
        renderHTML: (attributes) => ({ "data-tone": CALLOUT_KINDS[attributes.kind as CalloutKind]?.tone ?? "info" }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'aside[data-type="callout"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["aside", mergeAttributes(HTMLAttributes, { "data-type": "callout", class: "instruction-callout" }), 0];
  },
  renderMarkdown(node, helpers) {
    const kind = (node.attrs?.kind as CalloutKind) in CALLOUT_KINDS ? (node.attrs?.kind as CalloutKind) : "NOTE";
    const body = helpers.renderChildren(node.content ?? [], "\n\n").trim();
    const lines = body ? body.split("\n") : [""];
    return [`> [!${kind}]`, ...lines.map((line) => (line.trim() ? `> ${line.replace(/\s+$/, "")}` : ">"))].join("\n");
  },
  addKeyboardShortcuts() {
    return {
      // Like a list: Enter on an empty last line leaves the callout and continues below it.
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;
        let depth = $from.depth;
        while (depth > 0 && $from.node(depth).type.name !== this.name) depth -= 1;
        if (depth === 0 || $from.depth !== depth + 1) return false;
        const callout = $from.node(depth);
        const line = $from.parent;
        if (line.type.name !== "paragraph" || line.content.size !== 0) return false;
        if (callout.childCount < 2 || $from.index(depth) !== callout.childCount - 1) return false;
        const tr = state.tr.delete($from.before(depth + 1), $from.after(depth + 1));
        const below = tr.mapping.map($from.after(depth));
        // Continue on the empty line below the callout if there is one; otherwise add one.
        const next = tr.doc.nodeAt(below);
        if (!next || next.type.name !== "paragraph" || next.content.size !== 0) tr.insert(below, state.schema.nodes.paragraph.create());
        tr.setSelection(TextSelection.create(tr.doc, below + 1)).scrollIntoView();
        editor.view.dispatch(tr);
        return true;
      },
    };
  },
});

/* Charts: ```chart blocks, shown as the chart and edited with the chart dialog. */
export interface ChartAttributes {
  type: InstructionChartType;
  title: string;
  data: ChartPoint[];
}

export interface ChartEditRequest {
  pos: number;
  chart?: ChartAttributes;
}

/** Raised on the editor element when an author clicks a chart's Edit chart button. */
export const CHART_EDIT_EVENT = "work-instructions:edit-chart";

export function chartFromAttributes(attributes: Record<string, unknown> | undefined): ChartAttributes | null {
  if (!attributes) return null;
  const type = attributes.chartType === "line" ? "line" : attributes.chartType === "bar" ? "bar" : null;
  const data = normalizeChartData(attributes.data);
  if (!type || !data) return null;
  const title = typeof attributes.title === "string" && attributes.title.trim() ? attributes.title.trim() : "Process chart";
  return { type, title, data };
}

export const ChartBlockBase = Node.create({
  name: "chartBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      chartType: { default: "bar", parseHTML: (element) => element.getAttribute("data-chart-type") ?? "bar", renderHTML: (attributes) => ({ "data-chart-type": attributes.chartType }) },
      title: { default: "", parseHTML: (element) => element.getAttribute("data-chart-title") ?? "", renderHTML: (attributes) => ({ "data-chart-title": attributes.title }) },
      data: { default: "", parseHTML: (element) => element.getAttribute("data-chart-data") ?? "", renderHTML: (attributes) => ({ "data-chart-data": attributes.data }) },
      source: { default: "", parseHTML: (element) => element.getAttribute("data-chart-source") ?? "", renderHTML: (attributes) => (attributes.source ? { "data-chart-source": attributes.source } : {}) },
    };
  },
  parseHTML() {
    return [{ tag: 'figure[data-type="instruction-chart"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["figure", mergeAttributes(HTMLAttributes, { "data-type": "instruction-chart" })];
  },
  renderMarkdown(node) {
    const chart = chartFromAttributes(node.attrs);
    if (chart) return serializeChartSource(chart);
    // A chart with an error keeps its text exactly as written, so nothing is lost while it is fixed.
    const source = typeof node.attrs?.source === "string" ? node.attrs.source.trim() : "";
    return ["```chart", source, "```"].join("\n");
  },
});

/* Photos and videos: ![Name](url "Caption"). */
export const MediaFigureBase = Node.create({
  name: "mediaFigure",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { src: { default: "" }, alt: { default: "" }, caption: { default: "" }, kind: { default: "image" } };
  },
  parseHTML() {
    const caption = (element: HTMLElement) => element.querySelector("figcaption")?.textContent?.trim() ?? "";
    return [
      {
        tag: 'figure[data-type="resizable-image"]',
        getAttrs: (element) => {
          const image = element.querySelector("img");
          const src = image?.getAttribute("src");
          return src ? { src, alt: image?.getAttribute("alt") ?? "", caption: caption(element), kind: "image" } : false;
        },
      },
      {
        tag: 'figure[data-type="resizable-video"]',
        getAttrs: (element) => {
          const video = element.querySelector("video");
          const src = video?.getAttribute("src") || video?.querySelector("source")?.getAttribute("src");
          return src ? { src, alt: video?.getAttribute("aria-label") ?? "", caption: caption(element), kind: "video" } : false;
        },
      },
      {
        tag: "video",
        getAttrs: (element) => {
          const src = element.getAttribute("src") || element.querySelector("source")?.getAttribute("src");
          return src ? { src, alt: element.getAttribute("aria-label") ?? "", caption: "", kind: "video" } : false;
        },
      },
    ];
  },
  renderHTML({ node }) {
    const { src, alt, caption, kind } = node.attrs as { src: string; alt: string; caption: string; kind: string };
    const media = kind === "video"
      ? ["video", { src, controls: "true", playsinline: "true", preload: "metadata", "aria-label": alt || "Video" }]
      : ["img", { src, alt }];
    return ["figure", { "data-type": kind === "video" ? "resizable-video" : "resizable-image", "data-align": "center" }, media, ...(caption ? [["figcaption", {}, caption]] : [])];
  },
  renderMarkdown(node) {
    const { src, alt, caption, kind } = (node.attrs ?? {}) as { src?: string; alt?: string; caption?: string; kind?: string };
    if (!src) return "";
    const target = kind === "video" && !isVideoSource(src) ? `${src}#video` : src;
    return markdownImage(alt || (kind === "video" ? "Video" : "Photo"), target, caption);
  },
});

/* Pictures inside a line of text. */
export const InlineImage = Node.create({
  name: "inlineImage",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: "" }, alt: { default: "" }, title: { default: null } };
  },
  parseHTML() {
    return [{ tag: "img[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["img", HTMLAttributes];
  },
  renderMarkdown(node) {
    const { src, alt, title } = (node.attrs ?? {}) as { src?: string; alt?: string; title?: string | null };
    if (!src) return "";
    const safeAlt = (alt ?? "").replace(/[[\]\\]/g, "").replace(/\s+/g, " ").trim();
    return `![${safeAlt}](${src}${title ? ` "${String(title).replace(/"/g, "'")}"` : ""})`;
  },
  addNodeView() {
    return ({ node }) => {
      const image = document.createElement("img");
      image.src = resolveAccessibleMediaUrl(node.attrs.src);
      image.alt = node.attrs.alt ?? "";
      image.className = "editor-inline-image";
      return { dom: image };
    };
  },
});

/* Shown while a photo or video uploads; never saved. */
export const UploadPlaceholder = Node.create({
  name: "uploadPlaceholder",
  group: "block",
  atom: true,
  selectable: false,
  addAttributes() {
    return { uploadId: { default: "" }, label: { default: "" } };
  },
  parseHTML() {
    return [];
  },
  renderHTML({ node }) {
    return ["div", { "data-type": "upload-placeholder", class: "editor-upload-placeholder" }, `Uploading ${node.attrs.label}…`];
  },
  renderMarkdown() {
    return "";
  },
});

/* Holds HTML that Markdown cannot express (tables with merged cells); written back unchanged. */
export const RawHtmlBlock = Node.create({
  name: "rawHtmlBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return { html: { default: "" } };
  },
  parseHTML() {
    return [];
  },
  renderHTML() {
    return ["div", { "data-type": "raw-html" }];
  },
  renderMarkdown(node) {
    return typeof node.attrs?.html === "string" ? node.attrs.html : "";
  },
});

/** Tables with merged cells, or lists and pictures inside cells, cannot be written as Markdown tables. */
export function tableNeedsHtml(table: JSONContent): boolean {
  for (const row of table.content ?? []) {
    for (const cell of row.content ?? []) {
      const colspan = Number(cell.attrs?.colspan ?? 1);
      const rowspan = Number(cell.attrs?.rowspan ?? 1);
      if (colspan > 1 || rowspan > 1) return true;
      if ((cell.content ?? []).some((block) => block.type !== "paragraph")) return true;
    }
  }
  return false;
}

/** Everything the editor understands, minus the on-screen views (which the editor swaps in). */
export function richEditorCoreExtensions(overrides: { chartBlock?: AnyExtension; mediaFigure?: AnyExtension } = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      underline: false,
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false, autolink: true, defaultProtocol: "https", HTMLAttributes: { rel: "noopener noreferrer nofollow", target: null } },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Callout,
    overrides.chartBlock ?? ChartBlockBase,
    overrides.mediaFigure ?? MediaFigureBase,
    InlineImage,
    UploadPlaceholder,
    RawHtmlBlock,
  ];
}

/** Tidies the serializer's output: no stray blank-line markers, at most one blank line between blocks. */
export function normalizeSerializedMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/^[ \t]*(?:&nbsp;| )[ \t]*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s*\n/, "")
    .replace(/\s+$/, "");
}
