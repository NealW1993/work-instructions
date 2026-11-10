import { Marked, type Tokens, type TokenizerAndRendererExtension } from "marked";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { parseDocument } from "htmlparser2";
import { buildChartHtml, normalizeChartData, type ChartPoint, type InstructionChartType } from "@/lib/instruction-chart";
import { inferVideoMimeType } from "@/lib/video";

/*
 * Instruction and document bodies are authored as Markdown (GitHub Flavored Markdown plus a few
 * manufacturing-friendly extensions). Records saved by the earlier rich-text editor are HTML; they
 * still render unchanged and convert to Markdown when an author opens them for editing.
 *
 * Extensions beyond GFM:
 *   > [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]   callout blocks (GitHub alert syntax)
 *   ```chart                                                       bar/line chart from "Label: value" rows
 *   ![Caption](clip.mp4)                                          image syntax with a video file plays inline
 */

export type CalloutKind = "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION";

export const CALLOUT_KINDS: Record<CalloutKind, { tone: string; label: string }> = {
  NOTE: { tone: "info", label: "Note" },
  TIP: { tone: "success", label: "Tip" },
  IMPORTANT: { tone: "important", label: "Important" },
  WARNING: { tone: "warning", label: "Warning" },
  CAUTION: { tone: "danger", label: "Caution" },
};

function calloutKindForTone(tone: string | null | undefined): CalloutKind {
  const match = (Object.entries(CALLOUT_KINDS) as Array<[CalloutKind, { tone: string }]>).find(([, value]) => value.tone === tone);
  return match?.[0] ?? "NOTE";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cleanUrl(href: string): string | null {
  try {
    return encodeURI(href.trim()).replace(/%25/g, "%");
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Chart blocks
 * ----------------------------------------------------------------------------------------------*/

export interface ChartSource {
  type: InstructionChartType;
  title: string;
  data: ChartPoint[];
}

export type ChartParseResult = { chart: ChartSource; error?: undefined } | { chart?: undefined; error: string };

const CHART_ROW_PATTERN = /^(.+?)\s*[:,|=]\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)\s*$/i;

/** Parses the body of a ```chart block. Settings come first; every other line is "Label: value". */
export function parseChartSource(source: string): ChartParseResult {
  let type: InstructionChartType = "bar";
  let title = "";
  const rows: Array<{ label: string; value: number }> = [];
  const lines = source.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const setting = /^(type|title)\s*:\s*(.*)$/i.exec(line);
    if (setting && rows.length === 0) {
      const key = setting[1].toLowerCase();
      const value = setting[2].trim();
      if (key === "title") {
        title = value;
        continue;
      }
      if (value.toLowerCase() === "bar" || value.toLowerCase() === "line") {
        type = value.toLowerCase() as InstructionChartType;
        continue;
      }
      if (!CHART_ROW_PATTERN.test(line)) return { error: `Line ${index + 1}: chart type must be "bar" or "line".` };
    }
    const row = CHART_ROW_PATTERN.exec(line);
    if (!row) return { error: `Line ${index + 1}: write each value as "Label: number", for example "Station A: 12.5".` };
    rows.push({ label: row[1].trim(), value: Number(row[2]) });
  }
  if (rows.length === 0) return { error: 'Add at least one data row, for example "Station A: 12".' };
  if (rows.length > 24) return { error: "Charts support up to 24 values." };
  const data = normalizeChartData(rows);
  if (!data) return { error: "Each label must be 1–80 characters and each value a finite number." };
  return { chart: { type, title: title.slice(0, 160) || "Process chart", data } };
}

export function serializeChartSource(chart: ChartSource): string {
  const rows = chart.data.map((point) => `${point.label.replace(/\s+/g, " ")}: ${point.value}`);
  return ["```chart", `type: ${chart.type}`, `title: ${chart.title.replace(/\s+/g, " ").trim() || "Process chart"}`, ...rows, "```"].join("\n");
}

function renderChartBlock(source: string): string {
  const parsed = parseChartSource(source);
  if (parsed.chart) return buildChartHtml(parsed.chart);
  return `<aside data-type="callout" data-tone="danger" class="instruction-callout"><p><strong>Chart unavailable</strong></p><p>${escapeHtml(parsed.error)}</p></aside>`;
}

/* ------------------------------------------------------------------------------------------------
 * Media
 * ----------------------------------------------------------------------------------------------*/

export function isVideoSource(src: string): boolean {
  return inferVideoMimeType(src) !== null || /#video$/i.test(src) || /\/inline\/video\//i.test(src);
}

function renderMediaFigure(token: Tokens.Image): string {
  const src = cleanUrl(token.href);
  if (!src) return escapeHtml(token.text);
  const caption = token.title?.trim() ? `<figcaption>${escapeHtml(token.title.trim())}</figcaption>` : "";
  if (isVideoSource(src)) {
    const mimeType = inferVideoMimeType(src);
    const label = token.text.trim() ? ` aria-label="${escapeHtml(token.text.trim())}"` : "";
    const typeAttribute = mimeType ? ` type="${mimeType}"` : "";
    return `<figure data-type="resizable-video" data-align="center"><video controls playsinline preload="metadata" src="${escapeHtml(src)}"${mimeType ? ` data-mime-type="${mimeType}"` : ""}${label}><source src="${escapeHtml(src)}"${typeAttribute}>Video playback unavailable on this device.</video>${caption}</figure>`;
  }
  return `<figure data-type="resizable-image" data-align="center"><img src="${escapeHtml(src)}" alt="${escapeHtml(token.text)}">${caption}</figure>`;
}

/* ------------------------------------------------------------------------------------------------
 * Markdown -> HTML
 * ----------------------------------------------------------------------------------------------*/

const ALERT_PATTERN = /^ {0,3}>[ \t]?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\r?\n|$)((?: {0,3}>[^\n]*(?:\r?\n|$))*)/i;

const calloutExtension: TokenizerAndRendererExtension = {
  name: "calloutAlert",
  level: "block",
  start(source: string) {
    return source.match(/^ {0,3}>[ \t]?\[!/m)?.index;
  },
  tokenizer(source: string) {
    const match = ALERT_PATTERN.exec(source);
    if (!match) return undefined;
    const body = match[2].replace(/^ {0,3}>[ \t]?/gm, "");
    const token = { type: "calloutAlert", raw: match[0], kind: match[1].toUpperCase(), tokens: [] as Tokens.Generic[] };
    this.lexer.blockTokens(body, token.tokens);
    return token;
  },
  renderer(token) {
    const kind = (token as unknown as { kind: CalloutKind }).kind;
    const tone = CALLOUT_KINDS[kind]?.tone ?? "info";
    return `<aside data-type="callout" data-tone="${tone}" class="instruction-callout">${this.parser.parse(token.tokens ?? [])}</aside>\n`;
  },
};

function createMarkdownParser() {
  return new Marked({
    gfm: true,
    breaks: true,
    extensions: [calloutExtension],
    renderer: {
      code(token) {
        if ((token.lang ?? "").trim().toLowerCase() === "chart") return renderChartBlock(token.text);
        return false;
      },
      paragraph(token) {
        const meaningful = token.tokens.filter((child) => child.type !== "br" && !(child.type === "text" && !child.raw.trim()));
        if (meaningful.length > 0 && meaningful.every((child) => child.type === "image")) {
          return `${meaningful.map((child) => renderMediaFigure(child as Tokens.Image)).join("\n")}\n`;
        }
        return false;
      },
      image(token) {
        const src = cleanUrl(token.href);
        if (!src) return escapeHtml(token.text);
        // A video cannot sit inside a paragraph, so inline references become links.
        if (isVideoSource(src)) return `<a href="${escapeHtml(src)}">${escapeHtml(token.text || "Video")}</a>`;
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(token.text)}"${token.title ? ` title="${escapeHtml(token.title)}"` : ""}>`;
      },
      list(token) {
        if (token.ordered || !token.items.some((item) => item.task)) return false;
        // Task and plain items render as separate list runs so notes are never turned into checkboxes.
        let html = "";
        let taskRun: boolean | null = null;
        for (const item of token.items) {
          const isTask = Boolean(item.task);
          if (taskRun !== isTask) {
            if (taskRun !== null) html += "</ul>\n";
            html += isTask ? '<ul data-type="taskList">' : "<ul>";
            taskRun = isTask;
          }
          html += isTask
            ? `<li data-type="taskItem" data-checked="${Boolean(item.checked)}"><label><input type="checkbox" disabled${item.checked ? " checked" : ""}></label><div>${this.parser.parse(item.tokens.filter((child) => child.type !== "checkbox"))}</div></li>`
            : this.listitem(item);
        }
        return `${html}</ul>\n`;
      },
    },
  });
}

let markdownParser: Marked | null = null;

/** Renders authored Markdown to (unsanitized) HTML. Always pass the result through sanitizeRichHtml for display. */
export function markdownToEditorHtml(value: string): string {
  if (!value.trim()) return "";
  markdownParser ??= createMarkdownParser();
  return markdownParser.parse(value, { async: false }).trim();
}

const HTML_BLOCK_START = /^\s*<(?:p|div|section|aside|figure|h[1-6]|ul|ol|blockquote|pre|table|hr|img|video|br)\b/i;

/**
 * True for documents saved as HTML by the earlier rich-text editor or by document import.
 * Markdown that merely begins with an embedded HTML block still contains top-level text and stays Markdown.
 */
export function isHtmlContent(value: string): boolean {
  if (!HTML_BLOCK_START.test(value)) return false;
  const document = parseDocument(value);
  return !document.children.some((node) => node.type === "text" && "data" in node && String(node.data).trim().length > 0);
}

/** HTML for rendering: legacy HTML passes through; Markdown is rendered. */
export function normalizeEditorContent(value: string): string {
  if (!value.trim()) return "";
  return isHtmlContent(value) ? value : markdownToEditorHtml(value);
}

/** Markdown for editing: Markdown passes through; legacy HTML is converted. */
export function toMarkdownSource(value: string): string {
  if (!value.trim()) return "";
  return isHtmlContent(value) ? toEditorMarkdown(value) : value;
}

/* ------------------------------------------------------------------------------------------------
 * HTML -> Markdown
 * ----------------------------------------------------------------------------------------------*/

function markdownImage(alt: string, src: string, caption?: string | null): string {
  const safeAlt = alt.replace(/[\[\]\\]/g, "").replace(/\s+/g, " ").trim();
  const target = /[\s()<>]/.test(src) ? `<${src.replace(/[<>]/g, "")}>` : src;
  const title = caption?.trim() ? ` "${caption.trim().replace(/"/g, "'")}"` : "";
  return `![${safeAlt}](${target}${title})`;
}

function parseColor(value: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/i.exec(value.trim());
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split("").map((digit) => digit + digit).join("") : hex[1];
    return [0, 2, 4].map((offset) => Number.parseInt(digits.slice(offset, offset + 2), 16)) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(value.trim());
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

/** Colored (not gray, near-black, or near-white) text was usually emphasis; keep it as bold. */
function isEmphasisColor(style: string): boolean {
  const match = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style);
  const rgb = match ? parseColor(match[1]) : null;
  if (!rgb) return false;
  const [red, green, blue] = rgb.map((channel) => channel / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
  return saturation > 0.3 && lightness > 0.15 && lightness < 0.85;
}

function wrapInline(content: string, delimiter: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(content);
  if (!match || !match[2]) return content;
  if (match[2].startsWith(delimiter) && match[2].endsWith(delimiter)) return content;
  return `${match[1]}${delimiter}${match[2]}${delimiter}${match[3]}`;
}

const BLOCK_TAGS = new Set(["P", "DIV", "UL", "OL", "TABLE", "PRE", "BLOCKQUOTE", "FIGURE", "IMG", "VIDEO", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "ASIDE"]);

function isComplexTable(table: HTMLElement): boolean {
  const cells = Array.from(table.querySelectorAll("th, td"));
  if (cells.length === 0) return true;
  return cells.some((cell) => {
    const spans = ["colspan", "rowspan"].some((name) => {
      const value = cell.getAttribute(name);
      return value !== null && value !== "" && value !== "1";
    });
    if (spans) return true;
    const blocks = Array.from(cell.children).filter((child) => BLOCK_TAGS.has(child.nodeName));
    return blocks.length > 1 || blocks.some((child) => child.nodeName !== "P" && child.nodeName !== "DIV");
  }) || Boolean(table.querySelector("table table"));
}

function cleanTableHtml(html: string): string {
  return html.replace(/\s(?:style|class|colwidth|width|data-[a-z-]+)="[^"]*"/gi, "");
}

let inlineConverter: TurndownService | null = null;

function cellToMarkdown(cell: Element): string {
  inlineConverter ??= createTurndown();
  return inlineConverter
    .turndown((cell as HTMLElement).innerHTML)
    .trim()
    .replace(/\n+/g, "<br>")
    .replace(/\|/g, "\\|");
}

function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
    hr: "---",
    br: "",
  });
  service.use(gfm);
  // Rules added later take precedence over earlier rules and the GFM plugin.
  service.addRule("list", {
    filter: ["ul", "ol"],
    replacement: (content, node) => {
      const list = node as HTMLElement;
      const parent = list.parentNode as HTMLElement | null;
      if (parent?.nodeName === "LI" && parent.lastElementChild === list) return `\n${content}`;
      // Task and note items render as adjacent <ul> runs; keep them one Markdown list.
      const joinsPrevious = list.nodeName === "UL" && list.previousElementSibling?.nodeName === "UL";
      const joinsNext = list.nodeName === "UL" && list.nextElementSibling?.nodeName === "UL";
      const items = content.replace(/^\n+/, "").replace(/\n+$/, "");
      return `${joinsPrevious ? "\n" : "\n\n"}${items}${joinsNext ? "\n" : "\n\n"}`;
    },
  });
  service.addRule("listItem", {
    filter: "li",
    replacement: (content, node) => {
      const item = node as HTMLElement;
      const parent = item.parentNode as HTMLElement | null;
      let marker = "- ";
      if (item.getAttribute("data-type") === "taskItem") {
        marker = `- [${item.getAttribute("data-checked") === "true" ? "x" : " "}] `;
      } else if (parent?.nodeName === "OL") {
        const siblings = Array.from(parent.children).filter((child) => child.nodeName === "LI");
        marker = `${(Number.parseInt(parent.getAttribute("start") ?? "1", 10) || 1) + siblings.indexOf(item)}. `;
      } else {
        const firstParagraph = Array.from(item.children).find((child) => child.nodeName === "P");
        const checkbox = [...Array.from(item.children), ...Array.from(firstParagraph?.children ?? [])]
          .find((child) => child.nodeName === "INPUT" && child.getAttribute("type") === "checkbox");
        if (checkbox) marker = `- [${checkbox.hasAttribute("checked") ? "x" : " "}] `;
      }
      // Editor list items wrap text in <p>; keep lists tight unless an item really has several paragraphs.
      const body = content
        .replace(/^\n+/, "")
        .replace(/\n+$/, "")
        .replace(/^\[[ xX]\]\s+/, "")
        .replace(/\n\n+(?=\s*(?:[-*+]|\d+[.)])\s)/g, "\n");
      const indent = item.getAttribute("data-type") === "taskItem" ? "  " : " ".repeat(marker.length);
      return `${marker}${body.replace(/\n(?!\n)/g, `\n${indent}`)}\n`;
    },
  });
  service.addRule("styledText", {
    filter: (node) => ["SPAN", "MARK", "U", "FONT"].includes(node.nodeName),
    replacement: (content, node) => {
      const element = node as HTMLElement;
      if (!content.trim()) return content;
      if (element.nodeName === "MARK" || element.getAttribute("color") || isEmphasisColor(element.getAttribute("style") ?? "")) {
        return wrapInline(content, "**");
      }
      if (element.nodeName === "U") return wrapInline(content, "*");
      return content;
    },
  });
  service.addRule("simpleTable", {
    filter: (node) => node.nodeName === "TABLE" && !isComplexTable(node as HTMLElement),
    replacement: (_content, node) => {
      const table = node as HTMLElement;
      const rows = Array.from(table.querySelectorAll("tr")).map((row) =>
        Array.from(row.children).filter((cell) => cell.nodeName === "TH" || cell.nodeName === "TD").map(cellToMarkdown),
      ).filter((row) => row.length > 0);
      if (rows.length === 0) return "";
      const width = Math.max(...rows.map((row) => row.length));
      const padded = rows.map((row) => [...row, ...Array.from({ length: width - row.length }, () => "")]);
      const caption = table.querySelector("caption")?.textContent?.trim();
      const lines = [
        `| ${padded[0].join(" | ")} |`,
        `| ${padded[0].map(() => "---").join(" | ")} |`,
        ...padded.slice(1).map((row) => `| ${row.join(" | ")} |`),
      ];
      return `\n\n${caption ? `**${caption}**\n\n` : ""}${lines.join("\n")}\n\n`;
    },
  });
  service.addRule("complexTable", {
    filter: (node) => node.nodeName === "TABLE" && isComplexTable(node as HTMLElement),
    replacement: (_content, node) => `\n\n${cleanTableHtml((node as HTMLElement).outerHTML)}\n\n`,
  });
  service.addRule("imageFigure", {
    filter: (node) => node.nodeName === "FIGURE" && node.getAttribute("data-type") !== "instruction-chart"
      && Boolean((node as HTMLElement).querySelector("img")) && !(node as HTMLElement).querySelector("video"),
    replacement: (_content, node) => {
      const figure = node as HTMLElement;
      const caption = figure.querySelector("figcaption")?.textContent;
      return Array.from(figure.querySelectorAll("img"))
        .map((image) => `\n\n${markdownImage(image.getAttribute("alt") ?? "", image.getAttribute("src") ?? "", caption)}\n\n`)
        .join("");
    },
  });
  service.addRule("video", {
    filter: (node) => node.nodeName === "VIDEO" || (node.nodeName === "FIGURE" && Boolean((node as HTMLElement).querySelector("video"))),
    replacement: (_content, node) => {
      const element = node as HTMLElement;
      const video = element.nodeName === "VIDEO" ? element : element.querySelector("video");
      let src = video?.getAttribute("src") || video?.querySelector("source")?.getAttribute("src") || "";
      if (!src) return "";
      if (!isVideoSource(src)) src = `${src.split("#")[0]}#video`;
      const caption = element.nodeName === "FIGURE" ? element.querySelector("figcaption")?.textContent : null;
      return `\n\n${markdownImage(video?.getAttribute("aria-label") || caption || "Video", src, caption)}\n\n`;
    },
  });
  service.addRule("chart", {
    filter: (node) => node.nodeName === "FIGURE" && node.getAttribute("data-type") === "instruction-chart",
    replacement: (_content, node) => {
      const figure = node as HTMLElement;
      const data = normalizeChartData(figure.getAttribute("data-chart-data"));
      if (!data) return "\n\n> [!CAUTION]\n> Chart unavailable: the original chart data was invalid.\n\n";
      const type: InstructionChartType = figure.getAttribute("data-chart-type") === "line" ? "line" : "bar";
      return `\n\n${serializeChartSource({ type, title: figure.getAttribute("data-chart-title") || "Process chart", data })}\n\n`;
    },
  });
  service.addRule("callout", {
    filter: (node) => node.nodeName === "ASIDE" && node.getAttribute("data-type") === "callout",
    replacement: (content, node) => {
      const kind = calloutKindForTone((node as HTMLElement).getAttribute("data-tone"));
      const body = content.trim().replace(/\n{3,}/g, "\n\n");
      const quoted = body ? body.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n") : ">";
      return `\n\n> [!${kind}]\n${quoted}\n\n`;
    },
  });
  return service;
}

let blockConverter: TurndownService | null = null;

/** Converts HTML (legacy records, imports, pasted content) to the Markdown authoring format. */
export function toEditorMarkdown(html: string): string {
  if (!html.trim()) return "";
  blockConverter ??= createTurndown();
  return blockConverter
    .turndown(html)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Plain text for search, counts and empty checks. */
export function markdownToPlainText(value: string): string {
  const html = normalizeEditorContent(value);
  return html
    .replace(/<(?:svg|style|script)[\s\S]*?<\/(?:svg|style|script)>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr|figcaption|aside)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** True when the content has text, media, or a chart worth saving. */
export function hasMeaningfulContent(value: string): boolean {
  if (!value.trim()) return false;
  const html = normalizeEditorContent(value);
  return markdownToPlainText(value).length > 0 || /<(?:img|video|svg)\b/i.test(html);
}
