import { expect, test } from "@playwright/test";
import {
  hasMeaningfulContent,
  isHtmlContent,
  markdownToEditorHtml,
  markdownToPlainText,
  normalizeEditorContent,
  parseChartSource,
  serializeChartSource,
  toEditorMarkdown,
  toMarkdownSource,
} from "../src/lib/editor-content";
import { buildChartHtml, normalizeChartData } from "../src/lib/instruction-chart";
import { sanitizeRichHtml } from "../src/lib/rich-text-html";
import { validateEnhancedInstructionAssets } from "../src/lib/instruction-enhancement";
import {
  continueMarkdownList,
  indentMarkdownListLine,
  insertMarkdownBlock,
  toggleMarkdownLinePrefix,
  toggleMarkdownWrap,
} from "../src/lib/markdown-commands";
import { DomUtils, parseDocument } from "htmlparser2";

const readings = [{ label: "Setup", value: 0 }, { label: "Check A", value: -2.5 }, { label: "Check B", value: 5 }];
const chart = () => buildChartHtml({ type: "bar", title: "Measured deviation (mm)", data: readings });
const render = (markdown: string) => sanitizeRichHtml(markdown);

test.describe("Markdown rendering", () => {
  test("headings, emphasis, links, code, and GFM measurement tables", () => {
    const html = markdownToEditorHtml('# Setup\n\n**Verify** the [drawing](https://example.com/drawing).\n\n| Check | Result |\n| --- | --- |\n| Diameter | 12.5 mm |\n\n```text\nM6 x 1\n```');
    expect(html).toContain("<h1>Setup</h1>");
    expect(html).toContain("<strong>Verify</strong>");
    expect(html).toContain('<a href="https://example.com/drawing">');
    expect(html).toContain("<table>");
    expect(html).toContain("12.5 mm");
    expect(html).toContain('<pre><code class="language-text">M6 x 1');
  });

  test("single line breaks are kept so operators' step lines do not run together", () => {
    expect(markdownToEditorHtml("Torque to 12 Nm\nMark the bolt")).toContain("<br>");
  });

  test("GitHub alert syntax becomes labelled callouts for every tone", () => {
    const html = render("> [!WARNING]\n> Hot surface. Wear **heat-resistant** gloves.\n\n> [!CAUTION]\n> Lock out the press.\n\n> [!NOTE]\n> Reference only.\n\n> [!TIP]\n> Use the go/no-go gauge.\n\n> [!IMPORTANT]\n> Record the lot number.");
    for (const tone of ["warning", "danger", "info", "success", "important"]) {
      expect(html).toContain(`data-tone="${tone}"`);
    }
    expect(html).toContain("<strong>heat-resistant</strong>");
    expect(html).not.toContain("[!WARNING]");
    expect(html.match(/<aside/g)).toHaveLength(5);
  });

  test("an ordinary quote stays a quote", () => {
    const html = render("> Measure twice.");
    expect(html).toContain("<blockquote>");
    expect(html).not.toContain("<aside");
  });

  test("chart blocks render a validated chart with an exact data table", () => {
    const html = render("```chart\ntype: line\ntitle: Torque by station (Nm)\nStation A: 12.5\nStation B: -3\nStation C: 0\n```");
    expect(html).toContain('data-type="instruction-chart"');
    expect(html).toContain('data-chart-type="line"');
    expect(html).toContain("<figcaption>Torque by station (Nm)</figcaption>");
    expect(html).toContain("<td>12.5</td>");
    expect(html).toContain("<td>-3</td>");
    expect(html).toContain("<td>0</td>");
    expect(html).toContain("<polyline");
  });

  test("invalid chart blocks explain the problem instead of inventing values", () => {
    const html = render("```chart\ntitle: Scrap\nShift 1: twelve\n```");
    expect(html).toContain("Chart unavailable");
    expect(html).toContain("Line 2");
    expect(html).not.toContain("<svg");
  });

  test("chart parsing accepts common separators, labels with colons, and rejects bad input", () => {
    expect(parseChartSource("Shift 1: Day: 12\nB, 3\nC | 4.5\nD = -1e2").chart?.data).toEqual([
      { label: "Shift 1: Day", value: 12 }, { label: "B", value: 3 }, { label: "C", value: 4.5 }, { label: "D", value: -100 },
    ]);
    expect(parseChartSource("type: pie\nA: 1").error).toContain("bar");
    expect(parseChartSource("").error).toBeTruthy();
    expect(parseChartSource(Array.from({ length: 25 }, (_, index) => `P${index}: 1`).join("\n")).error).toContain("24");
    const source = serializeChartSource({ type: "bar", title: "Scrap (pcs)", data: readings });
    expect(parseChartSource(source.replace(/^```chart\n|\n```$/g, "")).chart).toEqual({ type: "bar", title: "Scrap (pcs)", data: readings });
  });

  test("standalone images become figures, videos play inline, and titles become captions", () => {
    const html = render('![Fixture locator](https://example.com/media/fixture.png "Notch faces the operator")\n\n![Setup clip](https://example.com/media/setup.MOV)');
    expect(html).toContain('<figure data-type="resizable-image" data-align="center"><img src="https://example.com/media/fixture.png" alt="Fixture locator" />');
    expect(html).toContain("<figcaption>Notch faces the operator</figcaption>");
    expect(html).toMatch(/<figure data-type="resizable-video"[^>]*><video[^>]*controls[^>]*src="https:\/\/example.com\/media\/setup.MOV"/);
    expect(html).toContain('type="video/quicktime"');
  });

  test("unsafe Markdown links and images are removed by the shared sanitizer", () => {
    const html = render("[click](javascript:alert(1)) ![x](javascript:alert(1)) <img src=x onerror=alert(1)> <script>alert(1)</script>");
    expect(html).not.toMatch(/javascript:|onerror|<script/i);
  });

  test("task lists keep checked state, plain notes and nesting, including after a round trip", () => {
    const source = "- Plain setup note\n- [x] Setup complete\n  - [ ] Verify tool\n  - [x] Verify fixture\n- Plain reaction note\n- [ ] Check first part";
    const roundTripped = toEditorMarkdown(markdownToEditorHtml(source));
    expect(roundTripped).toBe(source);
    const document = parseDocument(markdownToEditorHtml(roundTripped));
    const tasks = DomUtils.findAll((element) => element.name === "li" && element.attribs["data-type"] === "taskItem", document.children);
    expect(tasks).toHaveLength(4);
    expect(tasks.filter((element) => element.attribs["data-checked"] === "true")).toHaveLength(2);
    const checkboxes = DomUtils.findAll((element) => element.name === "input", document.children);
    expect(checkboxes).toHaveLength(4);
    const notes = DomUtils.findAll((element) => element.name === "li" && !element.attribs["data-type"], document.children);
    expect(notes.map((element) => DomUtils.textContent(element).trim())).toEqual(["Plain setup note", "Plain reaction note"]);
    const setup = tasks.find((element) => DomUtils.textContent(element).includes("Setup complete"));
    const nested = DomUtils.findAll((element) => element.name === "li" && element.attribs["data-type"] === "taskItem", setup!.children);
    expect(nested.map((element) => DomUtils.textContent(element).trim())).toEqual(["Verify tool", "Verify fixture"]);
  });
});

test.describe("format detection", () => {
  test("legacy HTML is detected; Markdown that starts with an HTML block is not", () => {
    expect(isHtmlContent('<h2>Setup</h2><p><span style="color:#b91c1c">Keep</span></p>')).toBe(true);
    expect(isHtmlContent("## Setup\n\n- Verify tool")).toBe(false);
    expect(isHtmlContent('<table><tr><td colspan="2">A</td></tr></table>\n\n## After the table\n\n- Step')).toBe(false);
    expect(isHtmlContent("Plain text < 10 mm")).toBe(false);
  });

  test("legacy HTML renders unchanged while Markdown is rendered", () => {
    const html = '<h2>Setup</h2><p><span style="color:#b91c1c">Keep this format.</span></p>';
    expect(normalizeEditorContent(html)).toBe(html);
    expect(normalizeEditorContent("## Setup\n\n- Verify tool")).toContain("<h2>Setup</h2>");
    expect(normalizeEditorContent("Plain text < 10 mm")).toContain("&lt; 10 mm");
    const mixed = normalizeEditorContent('<table><tr><td colspan="2">A</td></tr></table>\n\n## After the table');
    expect(mixed).toContain("<h2>After the table</h2>");
  });

  test("plain text and meaningful-content checks see media and charts", () => {
    expect(markdownToPlainText("## Torque\n\n- **12 Nm**")).toBe("Torque\n12 Nm");
    expect(hasMeaningfulContent("![Photo](https://example.com/a.png)")).toBe(true);
    expect(hasMeaningfulContent("```chart\nA: 1\n```")).toBe(true);
    expect(hasMeaningfulContent("<p></p>")).toBe(false);
    expect(hasMeaningfulContent("   \n ")).toBe(false);
  });
});

test.describe("legacy HTML conversion", () => {
  test("rich-text records convert to clean Markdown without losing content", () => {
    const legacy = '<h2 style="text-align:center">Verify</h2><p><span style="color:#b91c1c;font-size:18px">Check 12.5 mm</span> and <mark>record it</mark>. <u>Never</u> skip.</p>'
      + '<aside data-type="callout" data-tone="warning"><p>Stop if outside tolerance.</p></aside>'
      + chart()
      + '<table><tbody><tr><th colspan="1" rowspan="1"><p>Check</p></th><th><p>Result</p></th></tr><tr><td style="background-color:#fef08a"><p>Diameter</p></td><td><p>12.5 mm</p></td></tr></tbody></table>'
      + '<figure data-type="resizable-image" data-width="520" data-align="center" style="width:520px"><img src="https://example.com/fixture.png" alt="Fixture"></figure>'
      + '<figure data-type="resizable-video" data-width="520"><video src="https://example.com/setup.mp4" controls playsinline><source src="https://example.com/setup.mp4" type="video/mp4"></video></figure>'
      + '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>Tool checked</p></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>First piece</p></div></li></ul>';
    const markdown = toEditorMarkdown(legacy);
    expect(markdown).toContain("## Verify");
    expect(markdown).toContain("**Check 12.5 mm**");
    expect(markdown).toContain("**record it**");
    expect(markdown).toContain("*Never*");
    expect(markdown).toContain("> [!WARNING]\n> Stop if outside tolerance.");
    expect(markdown).toContain("```chart\ntype: bar\ntitle: Measured deviation (mm)\nSetup: 0\nCheck A: -2.5\nCheck B: 5\n```");
    expect(markdown).toMatch(/\| Check \| Result \|\n\| --- \| --- \|\n\| Diameter \| 12\.5 mm \|/);
    expect(markdown).toContain("![Fixture](https://example.com/fixture.png)");
    expect(markdown).toContain("![Video](https://example.com/setup.mp4)");
    expect(markdown).toContain("- [x] Tool checked");
    expect(markdown).toContain("- [ ] First piece");
    expect(markdown).not.toMatch(/style=|<span|<mark|<u>|<figure|<aside/);

    const restored = sanitizeRichHtml(markdown);
    expect(restored).toContain('data-tone="warning"');
    expect(restored).toContain('data-type="instruction-chart"');
    expect(restored).toContain('src="https://example.com/fixture.png"');
    expect(restored).toContain("<video");
    expect(validateEnhancedInstructionAssets(sanitizeRichHtml(legacy), restored)).toBeNull();
  });

  test("nested editor lists convert to correctly indented Markdown", () => {
    const legacy = '<ol><li><p>Prepare</p><ul><li><p>Gloves</p></li><li><p>Glasses</p></li></ul></li><li><p>Load</p><ol><li><p>Notch first</p></li></ol></li></ol>'
      + '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>Setup</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>Verify tool</p></div></li></ul></div></li></ul>';
    expect(toEditorMarkdown(legacy)).toBe("1. Prepare\n   - Gloves\n   - Glasses\n2. Load\n   1. Notch first\n\n- [x] Setup\n  - [ ] Verify tool");
  });

  test("merged-cell tables stay embedded HTML because Markdown cannot express them", () => {
    const markdown = toEditorMarkdown('<p>Intro</p><table><tr><th colspan="2" style="width:200px">Acceptance</th></tr><tr><td>A</td><td>Pass</td></tr></table>');
    expect(markdown).toContain('<th colspan="2">Acceptance</th>');
    expect(markdown).not.toContain("style=");
    expect(sanitizeRichHtml(markdown)).toContain('colspan="2"');
  });

  test("gray or black text colours are not mistaken for emphasis", () => {
    expect(toEditorMarkdown('<p><span style="color:#0f172a">Body text</span></p>')).toBe("Body text");
    expect(toEditorMarkdown('<p><span style="color:rgb(100, 116, 139)">Muted</span></p>')).toBe("Muted");
  });

  test("toMarkdownSource converts HTML once and leaves Markdown untouched", () => {
    expect(toMarkdownSource("<h2>Setup</h2><ol><li><p>Clean</p></li><li><p>Load</p></li></ol>")).toBe("## Setup\n\n1. Clean\n2. Load");
    const markdown = "## Setup\n\n1. Clean\n2. Load";
    expect(toMarkdownSource(markdown)).toBe(markdown);
  });

  test("Markdown -> HTML -> Markdown is stable for every supported block", () => {
    const source = [
      "## Safety",
      "> [!CAUTION]\n> Lock out the press before reaching into the mold.",
      "1. Clean the locating surfaces.\n2. Load the part **notch first**.\n3. Torque to `12 Nm`.",
      "- [x] Gloves on\n- [ ] Guard closed",
      "| Check | Spec |\n| --- | --- |\n| Diameter | 12.5 ± 0.1 mm |",
      "![Locator](https://example.com/locator.png \"Notch faces the operator\")",
      "![Setup clip](https://example.com/setup.mp4)",
      "```chart\ntype: bar\ntitle: Scrap by shift (pcs)\nShift 1: 3\nShift 2: 0\n```",
      "---",
      "See [drawing](https://example.com/drawing.pdf).",
    ].join("\n\n");
    const once = toEditorMarkdown(sanitizeRichHtml(source));
    const twice = toEditorMarkdown(sanitizeRichHtml(once));
    expect(twice).toBe(once);
    for (const fragment of ["> [!CAUTION]", "1. Clean", "**notch first**", "- [x] Gloves on", "| Diameter |", "![Locator](https://example.com/locator.png \"Notch faces the operator\")", "![Setup clip](https://example.com/setup.mp4)", "```chart", "Shift 2: 0", "[drawing](https://example.com/drawing.pdf)"]) {
      expect(once).toContain(fragment);
    }
  });
});

test.describe("toolbar text commands", () => {
  test("wrapping toggles bold on and off and inserts a placeholder when nothing is selected", () => {
    const on = toggleMarkdownWrap({ value: "Torque 12 Nm", start: 7, end: 12 }, "**");
    expect(on.value).toBe("Torque **12 Nm**");
    expect(on.value.slice(on.start, on.end)).toBe("12 Nm");
    const off = toggleMarkdownWrap(on, "**");
    expect(off.value).toBe("Torque 12 Nm");
    const empty = toggleMarkdownWrap({ value: "A ", start: 2, end: 2 }, "**", "bold text");
    expect(empty.value).toBe("A **bold text**");
    expect(empty.value.slice(empty.start, empty.end)).toBe("bold text");
  });

  test("line prefixes apply to every selected line and toggle off", () => {
    const listed = toggleMarkdownLinePrefix({ value: "Clean\nLoad\nInspect", start: 0, end: 18 }, "ordered");
    expect(listed.value).toBe("1. Clean\n2. Load\n3. Inspect");
    expect(toggleMarkdownLinePrefix(listed, "ordered").value).toBe("Clean\nLoad\nInspect");
    expect(toggleMarkdownLinePrefix({ value: "Clean", start: 2, end: 2 }, "task").value).toBe("- [ ] Clean");
    expect(toggleMarkdownLinePrefix({ value: "# Title", start: 3, end: 3 }, "h2").value).toBe("## Title");
    expect(toggleMarkdownLinePrefix({ value: "## Title", start: 3, end: 3 }, "h2").value).toBe("Title");
    expect(toggleMarkdownLinePrefix({ value: "- Step", start: 3, end: 3 }, "bullet").value).toBe("Step");
  });

  test("Enter continues lists, numbers, tasks and quotes, and ends an empty item", () => {
    expect(continueMarkdownList({ value: "1. Clean", start: 8, end: 8 })?.value).toBe("1. Clean\n2. ");
    expect(continueMarkdownList({ value: "- [x] Done", start: 10, end: 10 })?.value).toBe("- [x] Done\n- [ ] ");
    expect(continueMarkdownList({ value: "> [!WARNING]\n> Hot", start: 18, end: 18 })?.value).toBe("> [!WARNING]\n> Hot\n> ");
    const ended = continueMarkdownList({ value: "- Step\n- ", start: 9, end: 9 });
    expect(ended?.value).toBe("- Step\n\n");
    expect(ended?.start).toBe(8);
    // The paragraph typed after ending the list must not become part of the last item.
    expect(markdownToEditorHtml(`${ended?.value}Next paragraph`)).toContain("<p>Next paragraph</p>");
    expect(continueMarkdownList({ value: "> [!CAUTION]\n> Hot\n> ", start: 21, end: 21 })?.value).toBe("> [!CAUTION]\n> Hot\n\n");
    expect(continueMarkdownList({ value: "Plain", start: 5, end: 5 })).toBeNull();
  });

  test("Tab nests a list item under its parent's content column and Shift+Tab lifts it", () => {
    const nested = indentMarkdownListLine({ value: "1. Clean\n2. Wipe", start: 12, end: 12 }, false);
    expect(nested?.value).toBe("1. Clean\n   1. Wipe");
    expect(indentMarkdownListLine({ value: "- Gloves\n- Liners", start: 12, end: 12 }, false)?.value).toBe("- Gloves\n  - Liners");
    expect(indentMarkdownListLine(nested!, true)?.value).toBe("1. Clean\n2. Wipe");
    expect(indentMarkdownListLine({ value: "Plain", start: 2, end: 2 }, false)).toBeNull();
  });

  test("blocks are separated from surrounding text by blank lines", () => {
    const inserted = insertMarkdownBlock({ value: "Intro\nOutro", start: 5, end: 5 }, "---");
    expect(inserted.value).toBe("Intro\n\n---\n\nOutro");
  });
});

test.describe("sanitizer and chart safety", () => {
  test("one sanitizer retains manufacturing formats and disables viewer task controls", () => {
    const safe = sanitizeRichHtml('<h2>Check</h2><p><a href="https://example.com" target="_blank">Drawing</a><span style="color:rgb(185, 28, 28);font-size:24px">Critical</span><mark style="background-color:#fef08a">Check</mark></p><table><tr><th scope="col">Size</th></tr><tr><td colspan="2" colwidth="120">12 mm</td></tr></table><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>Check</p></div></li></ul>');
    expect(safe).toContain("<table>");
    expect(safe).toContain('colwidth="120"');
    expect(safe).toContain("color:rgb(185, 28, 28)");
    expect(safe).toContain('rel="noopener noreferrer"');
    expect(safe).toMatch(/<input[^>]*disabled[^>]*checked/);
  });

  test("HTML imports cannot inject scripts, event handlers, active links, or SVG foreign content", () => {
    const safe = sanitizeRichHtml('<p onclick="alert(1)">Check<script>alert(1)</script><a href="javascript:alert(1)">unsafe</a><a href="data:text/html,boom">unsafe</a><img src="x" onerror="alert(1)"><span style="position:fixed;top:0;color:#b91c1c">Red</span></p><svg><foreignObject><iframe src="https://evil.example"></iframe></foreignObject><script>alert(1)</script><circle cx="1" cy="2" r="1" onload="alert(1)" /></svg>');
    expect(safe).not.toMatch(/<script|onerror|onclick|onload|javascript:|data:text\/html|foreignObject|iframe|position:fixed/i);
    expect(safe).toContain("color:#b91c1c");
    expect(safe).toContain("<circle");
  });

  test("imported CSS classes cannot overlay or hide the app while supported rich blocks retain formatting", () => {
    const html = '<div class="fixed inset-0 z-[9999] hidden print:hidden prose-markdown"><aside data-type="callout" data-tone="warning" class="instruction-callout fixed"><p class="print-media-inline-hidden invisible">Stop before adjustment.</p></aside><pre class="absolute"><code class="language-typescript fixed language-javascript:fixed">const size = 12.5;</code></pre><p class="instruction-callout"><span class="fixed" style="color:#b91c1c;font-size:18px">Critical</span></p><svg class="fixed inset-0"><rect x="1" y="2" width="3" height="4" fill="#0891b2" /></svg></div>' + chart();
    const safe = sanitizeRichHtml(html);
    const document = parseDocument(safe);
    const classElements = DomUtils.findAll((element) => Boolean(element.attribs.class), document.children);
    expect(classElements.map((element) => [element.name, element.attribs.class])).toEqual([
      ["aside", "instruction-callout"], ["code", "language-typescript"], ["figure", "instruction-chart"],
    ]);
    expect(safe).not.toMatch(/class="[^"]*(?:fixed|inset|z-\[|hidden|invisible|absolute|print-media)/);
    expect(safe).toContain("Stop before adjustment.");
    expect(safe).toContain('<rect x="1" y="2" width="3" height="4" fill="#0891b2"');
    expect(safe).toContain("<td>-2.5</td>");
  });

  test("chart data rejects incomplete, nonfinite, and oversized measurements instead of dropping rows", () => {
    expect(normalizeChartData(readings)).toEqual(readings);
    expect(normalizeChartData(JSON.stringify(readings))).toEqual(readings);
    for (const invalid of [[], [{ label: "Missing", value: "3" }], [{ label: "", value: 3 }], [{ label: "A", value: Infinity }], [{ label: "A", value: NaN }], Array.from({ length: 25 }, () => ({ label: "A", value: 1 })), "not JSON"]) {
      expect(normalizeChartData(invalid)).toBeNull();
    }
  });

  test("chart export is accessible, escaped, and retains exact negative and decimal values", () => {
    const html = buildChartHtml({ type: "line", title: 'Checks <script> "A"', data: [{ label: '<img onerror="run()">', value: -1.23456789 }, { label: "Zero", value: 0 }] });
    expect(html).toContain('role="img"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img ");
    expect(html).toContain("<td>-1.23456789</td>");
    expect(html).toContain("<td>0</td>");
    const sanitized = sanitizeRichHtml(html);
    expect(sanitized).toContain("<polyline");
    expect(sanitized).toContain("<figcaption>");
    expect(sanitized).toContain('data-chart-data="');
  });

  test("zero chart values never appear as nonzero bars", () => {
    const html = buildChartHtml({ type: "bar", title: "No defects", data: [{ label: "Shift 1", value: 0 }, { label: "Shift 2", value: 0 }] });
    expect(html.match(/<rect[^>]*height="0"/g)).toHaveLength(2);
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  test("viewers regenerate chart graphics and tables from validated values", () => {
    const misleading = chart().replace("<td>-2.5</td>", "<td>99999</td>").replace(/<rect\b[^>]*>/g, '<rect x="0" y="0" width="600" height="240" fill="#f00">');
    const canonical = sanitizeRichHtml(misleading);
    expect(canonical).toContain("<td>-2.5</td>");
    expect(canonical).not.toContain("99999");
    expect(canonical).toBe(sanitizeRichHtml(chart()));
    const invalid = sanitizeRichHtml('<figure data-type="instruction-chart" data-chart-type="bar" data-chart-data="invalid"><p>Fabricated results</p></figure>');
    expect(invalid).toContain("Chart unavailable");
    expect(invalid).not.toContain("Fabricated results");
  });

  test("AI review refuses omitted media, invented media, and changed chart measurements", () => {
    const source = `<p>Setup</p>${chart()}<img src="https://example.com/setup.png">`;
    expect(validateEnhancedInstructionAssets(source, source.replace("<p>Setup</p>", "<h2>Setup</h2>"))).toBeNull();
    expect(validateEnhancedInstructionAssets(source, source.replace('src="https://example.com/setup.png"', 'src="https://example.com/other.png"'))).not.toBeNull();
    expect(validateEnhancedInstructionAssets(source, "<h2>Setup</h2>" + chart())).not.toBeNull();
    const changed = `<h2>Setup</h2>${buildChartHtml({ type: "bar", title: "Measured deviation (mm)", data: [{ label: "Setup", value: 100 }] })}<img src="https://example.com/setup.png">`;
    expect(validateEnhancedInstructionAssets(source, changed)).not.toBeNull();
  });

  test("AI review accepts a Markdown original against the same assets in HTML", () => {
    const markdown = "Setup\n\n```chart\ntype: bar\ntitle: Measured deviation (mm)\nSetup: 0\nCheck A: -2.5\nCheck B: 5\n```\n\n![Setup](https://example.com/setup.png)";
    const html = `<h2>Setup</h2>${chart()}<figure data-type="resizable-image"><img src="https://example.com/setup.png" alt="Setup"></figure>`;
    expect(validateEnhancedInstructionAssets(sanitizeRichHtml(markdown), sanitizeRichHtml(html))).toBeNull();
  });
});
