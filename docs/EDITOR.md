# Markdown instruction editor

Work instructions and controlled documents (header, body and footer) are written in Markdown. The editor is a plain text area with a formatting toolbar and a live preview, so typing, spell-check and undo behave the same with a physical keyboard or a tablet's on-screen keyboard. The preview uses the same renderer as the instruction viewer, print view and downloads, so what you see while writing is what operators see.

## Writing

Type Markdown directly or use the toolbar. Toolbar buttons insert the Markdown for you and, when text is selected, wrap or prefix the selection. A second click on Bold, Italic, a list or a heading removes it again.

| You type | You get |
| --- | --- |
| `## Section` / `### Sub-section` | Headings |
| `**bold**`, `*italic*`, `~~removed~~` | Emphasis |
| `1. Step` | Numbered step |
| `- Item` | Bulleted list |
| `- [ ] Check` / `- [x] Done` | Checklist item |
| `> [!CAUTION]` then `> text` | Safety callout |
| `[Drawing](https://…)` | Link |
| `![Caption](photo.jpg "Shown under the photo")` | Photo or video |
| `\| A \| B \|` rows | Table |
| `---` | Divider |

- **Enter** continues a numbered, bulleted or checklist list (and a callout). Pressing **Enter** on an empty item ends the list and leaves a blank line, so the next paragraph is not absorbed into the last step.
- **Tab** / **Shift+Tab** nest or lift a list item. Outside lists, Tab moves keyboard focus as usual.
- **Ctrl+B**, **Ctrl+I** and **Ctrl+K** apply bold, italic and a link. Undo and Redo are on the toolbar and use the browser's own history.
- **Write / Split / Preview** switch views. Split is the default on wide screens; narrow screens use Write with a Preview tab. The choice is remembered on the device.
- **More → Markdown guide** shows the syntax table. **More → Import .md file** inserts a Markdown file at the cursor; **Download .md file** saves the current text.

Pasting from Word or a web page converts tables, lists, headings, links and code to Markdown. Plain text pastes unchanged.

## Callouts

Callouts use the GitHub alert syntax and render with a coloured, labelled box on screen and in print:

```
> [!CAUTION]
> Lock out the press before reaching into the mold.
```

| Type | Use for |
| --- | --- |
| `CAUTION` | Risk of injury — safety-critical (red) |
| `WARNING` | Risk of equipment damage or a defect (amber) |
| `IMPORTANT` | Information operators must not miss (violet) |
| `NOTE` | Helpful background (blue) |
| `TIP` | A better or faster way (green) |

## Charts

A fenced `chart` block plots 1–24 labelled values and keeps every exact value in a table below the chart for review and printing:

````
```chart
type: bar
title: Scrap by shift (pcs)
Shift 1: 3
Shift 2: 0
Shift 3: 5
```
````

`type` is `bar` (default) or `line`; put units in the title. Each row is `Label: number` (a comma, `|` or `=` also works). The **Insert chart** button builds the block from a form. If a value is not a number, the preview and viewer show *Chart unavailable* with the line that needs fixing — the chart is never drawn from guessed data.

## Photos and videos

Use **Take photo** or **Record video** (rear camera on tablets), **Upload photos or videos**, paste an image, or drag files onto the editor. Uploads show progress and can be cancelled; saving waits until they finish. Each finished upload is inserted as `![name](url)`. A link to an MP4, MOV or WebM file plays inline. Photos keep their natural size up to the column width and never crop; in the viewer, select a photo to open a large view.

## Earlier rich-text instructions

Instructions saved by the previous rich-text editor are stored as HTML. They keep their original formatting when viewed or printed. When an author opens one for editing it is converted to Markdown and a notice explains the conversion:

- Headings, lists, checklists, tables, links, callouts, charts, photos and videos convert directly.
- Colours, font sizes and alignment are not part of Markdown. Coloured or highlighted text becomes **bold** so emphasis is kept; underlined text becomes *italic*.
- Tables with merged cells stay as embedded HTML because Markdown cannot express them.

Opening a converted instruction does not count as a change; it is saved as Markdown only when the author saves. Controlled documents are stored as sanitized HTML for their revision history and downloads; the editor converts them to Markdown when opened and back to HTML when saved.

## AI assistance and document control

AI suggestions are shown side by side with the current draft. Applying one converts it to Markdown in the editor; it does not approve or release the instruction. The server refuses a suggestion that changes, omits or invents chart data or an image/video source, and a suggestion that arrives after the draft was edited cannot overwrite those edits. The responsible engineer must still verify wording, sequence, values, units, limits and safety requirements before release.

All rendered content passes through one sanitizer. Scripts, embedded frames, event handlers and unsafe links are removed, and chart graphics are regenerated from validated values so stored markup cannot misstate results.
