# Instruction editor

Work instructions and controlled documents (header, body and footer) are written in a formatted editor: headings, steps, safety callouts, tables, charts and photos look the way operators will see them while you type, so there is no separate preview. Content is still stored as Markdown, so saved records, prints, downloads, imports and AI assistance work as before.

## The instruction form

A new instruction needs only a **Part ID**, a **Title**, a **Department** and its steps. Everything else is optional:

- **Tools needed**: click anywhere in the field and start typing. Pick a match from the shared list or press **Enter** to add your own; anything typed but not yet added is saved with the instruction. Admins can star a tool to add it to the shared list.
- **More details (optional)**, below the steps: Where this applies, What good looks like, Records to fill out, and Safety and what to do if something goes wrong. The section opens by itself when an instruction already has details. Quality-system clause references are not edited here; each revision keeps its existing references.

## Writing

Use the toolbar, the usual keyboard shortcuts, or type a Markdown shortcut at the start of a line; it becomes formatting as you type.

| Do this | To get |
| --- | --- |
| Type `## ` (or `### `) | Section heading (or a smaller heading) |
| Type `1. ` | Numbered steps |
| Type `- ` | Bulleted list |
| Type `[ ] ` | Checklist item |
| Type `> ` | Quote |
| Type `**bold**`, `*italic*`, `~~removed~~` | Emphasis |
| Ctrl+B · Ctrl+I · Ctrl+K | Bold · italic · link |
| Toolbar | Headings, emphasis, lists, checklists, quotes, safety callouts, links, tables, charts, dividers, photos and videos |

- **Enter** starts the next step, bullet, checklist item or callout line. **Enter on an empty line** leaves the list or callout and continues below it.
- **Tab** / **Shift+Tab** nest or lift a list item. In a table, Tab moves to the next cell.
- **Shift+Enter** starts a new line without starting a new paragraph or step.
- A second click on Bold, Italic, a list, a quote or a heading removes it again, including after **Ctrl+A** has selected everything.
- **Undo** and **Redo** are on the toolbar (Ctrl+Z / Ctrl+Y).
- **More options** holds *Formatting help*, *Import .md file* (inserts a Markdown file, formatted, at the cursor) and *Download .md file* (saves the content as Markdown).

Pasting from Word or a web page keeps headings, lists, tables and links. Plain text that is clearly Markdown, for example copied from a `.md` file, is formatted instead of being pasted as symbols. There is always an empty line below a final table, chart or photo, so you can click there or press Ctrl+End to keep writing.

## Safety callouts

The **Callout** menu adds a coloured, labelled box that operators cannot miss on screen or in print. With text selected it wraps the selection; with the cursor inside a callout it changes the callout's kind or removes it.

| Type | Use for |
| --- | --- |
| Caution | Risk of injury: safety-critical (red) |
| Warning | Risk of equipment damage or a defect (amber) |
| Important | Information operators must not miss (violet) |
| Note | Helpful background (blue) |
| Tip | A better or faster way (green) |

Callouts are stored in the GitHub alert format:

```
> [!CAUTION]
> Lock out the press before reaching into the mold.
```

## Tables

**Insert table** adds a table with *Step / Check / Result* headings and puts the cursor in the first empty cell. While the cursor is in a table, a table toolbar adds or deletes rows and columns, or deletes the table. Simple tables are stored as Markdown tables. Tables with merged cells, for example from older instructions, are kept as HTML because Markdown cannot express them.

## Charts

**Insert chart** opens a form: a title (include the units), bar or line, and 1–24 `Label, value` rows. The chart appears in place with every exact value in a table below it for review and printing. Select **Edit chart** on a chart to change it. A value that is not a number is refused with an explanation; a chart is never drawn from guessed data. Charts are stored as a fenced `chart` block:

````
```chart
type: bar
title: Scrap by shift (pcs)
Shift 1: 3
Shift 2: 0
Shift 3: 5
```
````

A chart block that contains an error, for example after a downloaded file was edited by hand, opens with a warning and its original text, and the viewer shows *Chart unavailable* until it is fixed.

## Photos and videos

Use **Take photo** or **Record video** (rear camera on tablets), **Upload photos or videos**, paste an image, or drag files onto the editor. Uploads show progress and can be cancelled; saving waits until they finish. Each photo or video appears in place with an optional caption, and the cursor continues on the line below it, so several uploads stay in order. MP4, MOV and WebM videos play inline. Photos keep their natural size up to the column width and are never cropped; in the viewer, select a photo to open a large view.

## Earlier rich-text instructions

Instructions saved by the original rich-text editor are stored as HTML. They keep their original formatting when viewed or printed. When an author opens one for editing, it is converted for this editor and a notice explains the change:

- Headings, lists, checklists, tables, links, callouts, charts, photos and videos carry over directly.
- Colours, font sizes and alignment are not kept. Coloured or highlighted text becomes **bold** so the emphasis is not lost, and underlined text becomes *italic*.
- Tables with merged cells stay as embedded HTML.

Controlled documents are stored as sanitized HTML for their revision history and downloads; the editor converts them when they are opened and back to HTML when they are saved.

## Unsaved changes

Opening an instruction or document, or clicking into it, is not an edit, so leaving does not ask to discard changes. The editor reports a change only when the content itself changes, and undoing back to the original clears it again. A converted instruction is saved in the new format only when the author saves it.

## AI assistance and document control

AI suggestions are shown side by side with the current draft. Applying one loads it into the editor, formatted; it does not approve or release the instruction. The server refuses a suggestion that changes, omits or invents chart data or an image or video source, and a suggestion that arrives after the draft was edited cannot overwrite those edits. The responsible engineer must still verify wording, sequence, values, units, limits and safety requirements before release.

All rendered content passes through one sanitizer. Scripts, embedded frames, event handlers and unsafe links are removed, and chart graphics are regenerated from validated values so stored markup cannot misstate results.

## How content is stored (for maintainers)

- Markdown is turned into HTML by the viewer's own renderer (`markdownToEditableHtml` in `src/lib/editor-content.ts`, which also keeps each chart's text so it can be edited), sanitized, and loaded into the editor.
- The editor is built on TipTap (ProseMirror) in `src/components/ui/markdown-editor.tsx`. Its blocks are defined in `src/lib/rich-editor-schema.ts`, and each one writes back the same Markdown the app has always stored. The on-screen chart and media views are in `src/components/ui/rich-editor-extensions.tsx`.
- Changes are reported upward only for the author's own edits. If the document returns to how it was loaded (ignoring the empty last line the editor keeps), the original text is reported, so formatting differences never cause a false "unsaved" state.
- `tests/rich-editor-markdown.spec.ts` checks how each block is written back; `tests/ui-smoke.spec.ts` and the integration suite check editing in the browser.
