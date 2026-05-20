import "server-only";

import sanitizeHtml from "sanitize-html";

function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

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
  if (!value.trim()) {
    return "";
  }

  return looksLikeHtml(value) ? value : plainTextToHtml(value);
}

export function sanitizeRichHtml(value: string): string {
  return sanitizeHtml(normalizeEditorHtml(value), {
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
      "section",
      "figure",
      "img",
      "video",
      "label",
      "input",
      "table",
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
      figure: ["data-type", "data-align", "data-width", "data-document-cover", "style", "class"],
      img: ["src", "alt", "title", "width", "height", "style", "class"],
      video: ["src", "controls", "width", "height", "style", "class"],
      span: ["style"],
      div: ["style", "data-type"],
      section: ["data-document-header", "data-document-footer", "style", "class"],
      p: ["style"],
      h1: ["style"],
      h2: ["style"],
      h3: ["style"],
      ul: ["data-type"],
      li: ["data-type", "data-checked"],
      label: ["contenteditable"],
      input: ["type", "checked", "disabled"],
      mark: ["style", "data-color"],
      table: ["style"],
      th: ["style", "colspan", "rowspan"],
      td: ["style", "colspan", "rowspan"],
      svg: [
        "xmlns",
        "role",
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
        display: [/^block$/, /^inline-block$/, /^table$/, /^table-row$/, /^table-cell$/],
        width: [/^[0-9.]+(px|%)$/],
        height: [/^[0-9.]+(px|%)$/, /^auto$/],
        "max-width": [/^[0-9.]+(px|%)$/],
        "margin-left": [/^auto$/, /^[0-9.]+(px|%)$/],
        "margin-right": [/^auto$/, /^[0-9.]+(px|%)$/],
        "border-collapse": [/^collapse$/],
        border: [/^[0-9.]+px\s+solid\s+#[0-9a-fA-F]{3,8}$/],
        padding: [/^[0-9.]+(px|rem|em)$/],
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
