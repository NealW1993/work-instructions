import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { expect, test } from "@playwright/test";

import { markdownToEditableHtml, markdownToEditorHtml } from "../src/lib/editor-content";
import { normalizeSerializedMarkdown, richEditorCoreExtensions, tableNeedsHtml } from "../src/lib/rich-editor-schema";

// The formatted editor stores Markdown. These checks cover how each editor block is written back.
const manager = new MarkdownManager({ extensions: richEditorCoreExtensions() });
const serialize = (content: JSONContent[]) => normalizeSerializedMarkdown(manager.serialize({ type: "doc", content }));
const text = (value: string, marks?: JSONContent["marks"]): JSONContent => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
const paragraph = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });

test("safety callouts are written as GitHub alerts and render back as callouts", () => {
  const markdown = serialize([
    { type: "callout", attrs: { kind: "CAUTION" }, content: [paragraph(text("Lock out the press.")), paragraph(text("Wear gloves."))] },
  ]);
  expect(markdown).toBe("> [!CAUTION]\n> Lock out the press.\n>\n> Wear gloves.");
  expect(markdownToEditorHtml(markdown)).toContain('data-tone="danger"');
});

test("numbered steps, nested items, checklists and emphasis keep their structure", () => {
  const markdown = serialize([
    {
      type: "orderedList",
      attrs: { start: 1 },
      content: [
        { type: "listItem", content: [paragraph(text("Clean the "), text("mold", [{ type: "bold" }])), { type: "bulletList", content: [{ type: "listItem", content: [paragraph(text("Use the brass brush"))] }] }] },
        { type: "listItem", content: [paragraph(text("Load the part"))] },
      ],
    },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [paragraph(text("Gloves"))] }, { type: "taskItem", attrs: { checked: false }, content: [paragraph(text("Glasses"))] }] },
  ]);
  expect(markdown).toBe("1. Clean the **mold**\n   - Use the brass brush\n2. Load the part\n\n- [x] Gloves\n- [ ] Glasses");
  const html = markdownToEditorHtml(markdown);
  expect(html).toMatch(/<ol>[\s\S]*<ul>[\s\S]*Use the brass brush/);
  expect(html).toContain('data-type="taskList"');
});

test("charts are written as chart blocks, and a chart with an error keeps its text", () => {
  const valid = serialize([{ type: "chartBlock", attrs: { chartType: "line", title: "Scrap (pcs)", data: JSON.stringify([{ label: "Shift 1", value: 3 }, { label: "Shift 2", value: 1.5 }]) } }]);
  expect(valid).toBe("```chart\ntype: line\ntitle: Scrap (pcs)\nShift 1: 3\nShift 2: 1.5\n```");
  const broken = serialize([{ type: "chartBlock", attrs: { source: "title: Torque\nStation A: lots" } }]);
  expect(broken).toBe("```chart\ntitle: Torque\nStation A: lots\n```");
});

test("loading for editing keeps each chart's text so it can be edited, including charts with errors", () => {
  const html = markdownToEditableHtml("```chart\ntitle: Torque (Nm)\nStation A: 12\n```\n\n```chart\nStation B: lots\n```");
  expect(html).toContain('data-chart-source="title: Torque (Nm)\nStation A: 12"');
  expect(html).toContain('data-chart-type="bar"');
  expect(html).toContain('data-chart-source="Station B: lots"');
  // The viewer still shows a warning instead of a broken chart.
  expect(markdownToEditorHtml("```chart\nStation B: lots\n```")).toContain("Chart unavailable");
});

test("photos and videos are written as image syntax with captions; uploads in progress are never saved", () => {
  const markdown = serialize([
    { type: "mediaFigure", attrs: { src: "https://files.example/inline/image/a.jpg", alt: "Fixture", caption: "Clamp side", kind: "image" } },
    { type: "uploadPlaceholder", attrs: { uploadId: "u1", label: "Pending" } },
    { type: "mediaFigure", attrs: { src: "https://files.example/object/clip", alt: "Changeover", caption: "", kind: "video" } },
    paragraph(text("See "), { type: "inlineImage", attrs: { src: "https://files.example/icon.png", alt: "icon" } }, text(" first.")),
  ]);
  expect(markdown).toBe(
    '![Fixture](https://files.example/inline/image/a.jpg "Clamp side")\n\n![Changeover](https://files.example/object/clip#video)\n\nSee ![icon](https://files.example/icon.png) first.',
  );
  const html = markdownToEditorHtml(markdown);
  expect(html).toContain("<figcaption>Clamp side</figcaption>");
  expect(html).toContain("<video");
});

test("simple tables become Markdown tables; tables with merged cells stay as HTML", () => {
  const cell = (type: "tableHeader" | "tableCell", value: string, attrs?: Record<string, unknown>): JSONContent => ({ type, ...(attrs ? { attrs } : {}), content: [paragraph(text(value))] });
  const simple: JSONContent = { type: "table", content: [{ type: "tableRow", content: [cell("tableHeader", "Step"), cell("tableHeader", "Check")] }, { type: "tableRow", content: [cell("tableCell", "1"), cell("tableCell", "Gap a | b")] }] };
  expect(tableNeedsHtml(simple)).toBe(false);
  expect(serialize([simple])).toBe("| Step | Check      |\n| ---- | ---------- |\n| 1    | Gap a \\| b |");
  const merged: JSONContent = { type: "table", content: [{ type: "tableRow", content: [cell("tableHeader", "Shift", { colspan: 2 })] }] };
  expect(tableNeedsHtml(merged)).toBe(true);
  expect(serialize([{ type: "rawHtmlBlock", attrs: { html: '<table><tbody><tr><th colspan="2">Shift</th></tr></tbody></table>' } }])).toBe('<table><tbody><tr><th colspan="2">Shift</th></tr></tbody></table>');
});

test("output is tidy: no blank-line markers and at most one blank line between blocks", () => {
  expect(normalizeSerializedMarkdown("\n\n## Setup\n\n\n\n&nbsp;\n\n\nText  \nmore\n\n\n")).toBe("## Setup\n\nText  \nmore");
  expect(normalizeSerializedMarkdown("&nbsp;\n\n")).toBe("");
});
