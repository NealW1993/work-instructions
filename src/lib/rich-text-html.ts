import sanitizeHtml from "sanitize-html";
import { DomUtils, parseDocument } from "htmlparser2";
import serializeHtml from "dom-serializer";
import { normalizeEditorContent } from "@/lib/editor-content";
import { buildChartHtml, normalizeChartData } from "@/lib/instruction-chart";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function plainTextToHtml(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function normalizeEditorHtml(value: string): string {
  return normalizeEditorContent(value);
}

/** Sanitizes pasted or imported HTML without treating it as Markdown (no chart regeneration). */
export function sanitizeHtmlFragment(html: string): string {
  return sanitizeHtml(html, RICH_HTML_SANITIZE_OPTIONS);
}

/** The single display sanitizer: renders Markdown or legacy HTML, then applies the shared allowlist. */
export function sanitizeRichHtml(value: string): string {
  const sanitized = sanitizeHtml(normalizeEditorHtml(value), RICH_HTML_SANITIZE_OPTIONS);
  return regenerateCharts(sanitized);
}

const RICH_HTML_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
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
      "h4",
      "h5",
      "h6",
      "hr",
      "span",
      "div",
      "section",
      "figure",
      "figcaption",
      "aside",
      "a",
      "img",
      "video",
      "source",
      "label",
      "input",
      "table",
      "caption",
      "colgroup",
      "col",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "svg",
      "defs",
      "marker",
      "g",
      "path",
      "rect",
      "circle",
      "line",
      "polyline",
      "polygon",
      "text",
      "tspan",
    ],
    allowedAttributes: {
      figure: ["data-type", "data-align", "data-width", "data-document-cover", "data-chart-type", "data-chart-title", "data-chart-data", "style", "class"],
      aside: ["data-type", "data-tone", "class"],
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "style", "class"],
      video: ["src", "controls", "width", "height", "style", "class", "playsinline", "preload", "data-mime-type"],
      source: ["src", "type"],
      span: ["style"],
      div: ["style", "data-type"],
      section: ["data-document-header", "data-document-footer", "style", "class"],
      p: ["style"],
      h1: ["style"],
      h2: ["style"],
      h3: ["style"],
      h4: ["style"],
      h5: ["style"],
      h6: ["style"],
      ol: ["start", "type"],
      ul: ["data-type"],
      li: ["data-type", "data-checked"],
      label: ["contenteditable"],
      input: ["type", "checked", "disabled"],
      mark: ["style", "data-color"],
      table: ["style"],
      th: ["style", "colspan", "rowspan", "colwidth", "scope"],
      td: ["style", "colspan", "rowspan", "colwidth"],
      col: ["style", "width", "span"],
      svg: [
        "xmlns",
        "role",
        "aria-label",
        "viewBox",
        "viewbox",
        "width",
        "height",
        "preserveAspectRatio",
        "preserveaspectratio",
      ],
      marker: ["id", "markerWidth", "markerwidth", "markerHeight", "markerheight", "refX", "refx", "refY", "refy", "orient"],
      path: ["d", "fill", "stroke", "stroke-width", "stroke-dasharray"],
      rect: ["x", "y", "width", "height", "rx", "fill", "fill-opacity", "stroke", "stroke-width"],
      circle: ["cx", "cy", "r", "fill", "fill-opacity", "stroke", "stroke-width"],
      line: ["x1", "y1", "x2", "y2", "stroke", "stroke-width", "stroke-dasharray", "marker-end"],
      polyline: ["points", "fill", "stroke", "stroke-width"],
      polygon: ["points", "fill", "stroke", "stroke-width"],
      text: [
        "x",
        "y",
        "text-anchor",
        "font-family",
        "font-size",
        "font-weight",
        "fill",
      ],
      tspan: ["x", "y", "dx", "dy", "fill", "font-size", "font-weight"],
      "*": ["class", "style", "aria-label"],
    },
    // Imported content must not activate application layout, visibility, or overlay utilities.
    // Print-media markers are added by the print controller after sanitization, never persisted.
    allowedClasses: {
      "*": [],
      figure: ["instruction-chart"],
      aside: ["instruction-callout"],
      code: [/^language-[a-z0-9_+-]{1,80}$/i],
    },
    allowedSchemes: ["http", "https", "data"],
    allowedSchemesByTag: {
      a: ["http", "https", "mailto", "tel"],
      img: ["http", "https", "data"],
      video: ["http", "https", "data"],
      source: ["http", "https", "data"],
    },
    transformTags: {
      input: (_tagName, attributes) => ({
        tagName: "input",
        attribs: { type: "checkbox", disabled: "", ...(attributes.checked !== undefined ? { checked: "" } : {}) },
      }),
      a: (_tagName, attributes) => ({
        tagName: "a",
        attribs: { ...attributes, ...(attributes.target === "_blank" ? { rel: "noopener noreferrer" } : {}) },
      }),
    },
    allowedStyles: {
      "*": {
        "text-align": [/^left$/, /^right$/, /^center$/, /^justify$/],
        display: [/^block$/, /^inline-block$/, /^table$/, /^table-row$/, /^table-cell$/],
        width: [/^[0-9.]+(px|%)$/],
        height: [/^[0-9.]+(px|%)$/, /^auto$/],
        "max-width": [/^[0-9.]+(px|%)$/],
        "margin-left": [/^auto$/, /^[0-9.]+(px|%)$/],
        "margin-right": [/^auto$/, /^[0-9.]+(px|%)$/],
        "border-collapse": [/^collapse$/],
        border: [/^[0-9.]+px\s+solid\s+#[0-9a-fA-F]{3,8}$/],
        padding: [/^[0-9.]+(px|rem|em)$/],
        "min-width": [/^[0-9.]+(px|%)$/],
        "background-color": [/^#[0-9a-fA-F]{3,8}$/, /^rgb\([0-9,\s.]+\)$/],
        "vertical-align": [/^top$/, /^middle$/, /^bottom$/],
      },
      span: {
        color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb\([0-9,\s.]+\)$/],
        "font-size": [/^[0-9]+(px|em|rem|%)$/],
      },
      mark: {
        "background-color": [/^#[0-9a-fA-F]{3,8}$/, /^rgb\([0-9,\s.]+\)$/],
      },
    },
};

/** Chart graphics and tables are rebuilt from validated data so stored markup cannot misstate results. */
function regenerateCharts(sanitized: string): string {
  if (!sanitized.includes("instruction-chart")) return sanitized;
  const document = parseDocument(sanitized);
  const charts = DomUtils.findAll((element) => element.name === "figure" && element.attribs["data-type"] === "instruction-chart", document.children);
  for (const figure of charts) {
    const type = figure.attribs["data-chart-type"];
    const data = normalizeChartData(figure.attribs["data-chart-data"]);
    const title = figure.attribs["data-chart-title"] || "Process chart";
    const replacement = data && (type === "bar" || type === "line")
      ? buildChartHtml({ type, title, data })
      : '<aside data-type="callout" data-tone="warning"><p><strong>Chart unavailable</strong></p><p>This chart contains invalid or incomplete data. Review the source values before using this instruction.</p></aside>';
    const node = parseDocument(replacement).children[0];
    if (node) DomUtils.replaceElement(figure, node);
  }
  return serializeHtml(document, { encodeEntities: "utf8" });
}

export function extractTextFromHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6|blockquote|pre|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasMeaningfulRichText(value: string): boolean {
  return extractTextFromHtml(value).length > 0;
}

/** Searchable text for a body stored as Markdown or legacy HTML. */
export function extractTextFromContent(value: string): string {
  return extractTextFromHtml(normalizeEditorHtml(value).replace(/<svg[\s\S]*?<\/svg>/gi, " "));
}
