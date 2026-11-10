/*
 * Pure text commands for the Markdown editor. Each takes the current text and selection and returns
 * the next text and selection, so the editor can apply them as a single undoable edit.
 */

export interface MarkdownEditState {
  value: string;
  start: number;
  end: number;
}

export type LinePrefixKind = "h1" | "h2" | "h3" | "bullet" | "ordered" | "task" | "quote";

const HEADING = /^(#{1,6})[ \t]+/;
const TASK = /^(\s*)([-*+])[ \t]+\[[ xX]\][ \t]+/;
const BULLET = /^(\s*)([-*+])[ \t]+/;
const ORDERED = /^(\s*)(\d{1,9})([.)])[ \t]+/;
const QUOTE = /^((?:[ \t]*>)+[ \t]?)/;

function lineStartOf(value: string, position: number) {
  return position <= 0 ? 0 : value.lastIndexOf("\n", position - 1) + 1;
}

function lineBounds(value: string, start: number, end: number) {
  const lineStart = lineStartOf(value, start);
  // A selection that ends at the very start of a line does not include that line.
  const effectiveEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const nextBreak = value.indexOf("\n", effectiveEnd);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  return { lineStart, lineEnd };
}

function replaceRange(state: MarkdownEditState, from: number, to: number, text: string, selection?: [number, number]): MarkdownEditState {
  const value = state.value.slice(0, from) + text + state.value.slice(to);
  const [start, end] = selection ?? [from + text.length, from + text.length];
  return { value, start, end };
}

/** Wraps the selection in a delimiter such as ** or *, or removes it when already wrapped. */
export function toggleMarkdownWrap(state: MarkdownEditState, delimiter: string, placeholder = "text"): MarkdownEditState {
  const { value, start, end } = state;
  const size = delimiter.length;
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);
  const isOnlyDelimiter = (text: string, atEnd: boolean) => {
    if (!(atEnd ? text.endsWith(delimiter) : text.startsWith(delimiter))) return false;
    if (delimiter !== "*") return true;
    // A single * next to ** belongs to bold, not italic, unless it is ***.
    const window = atEnd ? text.slice(-3) : text.slice(0, 3);
    return !(window.includes("**") && window !== "***");
  };

  if (selected.length >= size * 2 && selected.startsWith(delimiter) && selected.endsWith(delimiter)) {
    const inner = selected.slice(size, selected.length - size);
    return replaceRange(state, start, end, inner, [start, start + inner.length]);
  }
  if (isOnlyDelimiter(before, true) && isOnlyDelimiter(after, false)) {
    const from = start - size;
    const to = end + size;
    return replaceRange(state, from, to, selected, [from, from + selected.length]);
  }
  if (!selected) {
    const text = `${delimiter}${placeholder}${delimiter}`;
    return replaceRange(state, start, end, text, [start + size, start + size + placeholder.length]);
  }
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(selected)!;
  const core = match[2] || placeholder;
  const text = `${match[1]}${delimiter}${core}${delimiter}${match[3]}`;
  const coreStart = start + match[1].length + size;
  return replaceRange(state, start, end, text, [coreStart, coreStart + core.length]);
}

function stripListPrefix(line: string) {
  const task = TASK.exec(line);
  if (task) return { indent: task[1], body: line.slice(task[0].length) };
  const ordered = ORDERED.exec(line);
  if (ordered) return { indent: ordered[1], body: line.slice(ordered[0].length) };
  const bullet = BULLET.exec(line);
  if (bullet) return { indent: bullet[1], body: line.slice(bullet[0].length) };
  const indent = /^\s*/.exec(line)![0];
  return { indent, body: line.slice(indent.length) };
}

function lineHasKind(line: string, kind: LinePrefixKind) {
  switch (kind) {
    case "h1": return HEADING.exec(line)?.[1].length === 1;
    case "h2": return HEADING.exec(line)?.[1].length === 2;
    case "h3": return HEADING.exec(line)?.[1].length === 3;
    case "task": return TASK.test(line);
    case "bullet": return BULLET.test(line) && !TASK.test(line);
    case "ordered": return ORDERED.test(line);
    case "quote": return QUOTE.test(line);
  }
}

/** Applies or removes a heading, list, checklist, or quote prefix on every selected line. */
export function toggleMarkdownLinePrefix(state: MarkdownEditState, kind: LinePrefixKind): MarkdownEditState {
  const { value, start, end } = state;
  const { lineStart, lineEnd } = lineBounds(value, start, end);
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const targets = lines.length === 1 ? lines.map(() => true) : lines.map((line) => line.trim().length > 0);
  const removing = lines.every((line, index) => !targets[index] || lineHasKind(line, kind));
  let counter = 0;
  const next = lines.map((line, index) => {
    if (!targets[index]) return line;
    if (kind === "h1" || kind === "h2" || kind === "h3") {
      const body = line.replace(HEADING, "");
      return removing ? body : `${"#".repeat(Number(kind.slice(1)))} ${body}`;
    }
    if (kind === "quote") {
      return removing ? line.replace(QUOTE, "") : `> ${line}`;
    }
    const { indent, body } = stripListPrefix(line);
    if (removing) return `${indent}${body}`;
    counter += 1;
    const marker = kind === "bullet" ? "- " : kind === "task" ? "- [ ] " : `${counter}. `;
    return `${indent}${marker}${body}`;
  });
  const text = next.join("\n");
  if (lines.length === 1) {
    const delta = text.length - lines[0].length;
    const clamp = (position: number) => Math.max(lineStart, Math.min(lineStart + text.length, position));
    const cursor = clamp(end + delta);
    const anchor = start === end ? cursor : start === lineStart ? lineStart : clamp(start + delta);
    return replaceRange(state, lineStart, lineEnd, text, [anchor, cursor]);
  }
  return replaceRange(state, lineStart, lineEnd, text, [lineStart, lineStart + text.length]);
}

/** Enter inside a list or quote: continue it, or end it when the current item is empty. */
export function continueMarkdownList(state: MarkdownEditState): MarkdownEditState | null {
  const { value, start, end } = state;
  if (start !== end) return null;
  const lineStart = lineStartOf(value, start);
  const lineEndIndex = value.indexOf("\n", start);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const line = value.slice(lineStart, lineEnd);
  const task = TASK.exec(line);
  const ordered = task ? null : ORDERED.exec(line);
  const bullet = task || ordered ? null : BULLET.exec(line);
  const quote = task || ordered || bullet ? null : QUOTE.exec(line);
  const marker = task?.[0] ?? ordered?.[0] ?? bullet?.[0] ?? quote?.[0];
  if (!marker || start - lineStart < marker.length) return null;
  const body = line.slice(marker.length);
  if (!body.trim() && start === lineEnd && !/\[![A-Z]+\]/.test(line)) {
    // Leave a blank line after the list or quote; otherwise the next paragraph would continue its last item.
    const previousLineBlank = lineStart < 2 || value[lineStart - 2] === "\n";
    const replacement = previousLineBlank ? "" : "\n";
    return replaceRange(state, lineStart, lineEnd, replacement, [lineStart + replacement.length, lineStart + replacement.length]);
  }
  let nextMarker = marker;
  if (task) nextMarker = `${task[1]}${task[2]} [ ] `;
  else if (ordered) nextMarker = `${ordered[1]}${Number(ordered[2]) + 1}${ordered[3]} `;
  else if (bullet) nextMarker = `${bullet[1]}${bullet[2]} `;
  else if (quote) nextMarker = quote[0].endsWith(" ") ? quote[0] : `${quote[0]} `;
  const text = `\n${nextMarker}`;
  return replaceRange(state, start, end, text);
}

interface ListLine { index: number; indent: number; width: number; ordered: boolean; number: number }

function readListLine(line: string, index: number): ListLine | null {
  const ordered = ORDERED.exec(line);
  if (ordered) return { index, indent: ordered[1].length, width: ordered[2].length + 2, ordered: true, number: Number(ordered[2]) };
  const bullet = BULLET.exec(line);
  if (bullet) return { index, indent: bullet[1].length, width: 2, ordered: false, number: 0 };
  return null;
}

/** Tab / Shift+Tab on a list item: nest it under the previous item's content, or lift it out one level. */
export function indentMarkdownListLine(state: MarkdownEditState, outdent: boolean): MarkdownEditState | null {
  const { value, start, end } = state;
  const lines = value.split("\n");
  const lineIndex = value.slice(0, start).split("\n").length - 1;
  const current = readListLine(lines[lineIndex], lineIndex);
  if (!current) return null;
  const previous: ListLine[] = [];
  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    const entry = readListLine(lines[index], index);
    if (entry) previous.push(entry);
    else if (!lines[index].trim()) break;
  }
  let targetIndent: number;
  if (outdent) {
    if (current.indent === 0) return null;
    targetIndent = previous.find((entry) => entry.indent < current.indent)?.indent ?? 0;
  } else {
    const parent = previous.find((entry) => entry.indent <= current.indent);
    if (!parent || parent.indent + parent.width <= current.indent) return state;
    targetIndent = parent.indent + parent.width;
  }
  let body = lines[lineIndex].slice(current.indent);
  if (current.ordered) {
    const sibling = previous.find((entry) => entry.indent <= targetIndent);
    const number = sibling && sibling.indent === targetIndent && sibling.ordered ? sibling.number + 1 : 1;
    body = body.replace(/^\d{1,9}/, String(number));
  }
  const nextLine = `${" ".repeat(targetIndent)}${body}`;
  const lineOffset = lines.slice(0, lineIndex).reduce((total, line) => total + line.length + 1, 0);
  const delta = nextLine.length - lines[lineIndex].length;
  const nextValue = value.slice(0, lineOffset) + nextLine + value.slice(lineOffset + lines[lineIndex].length);
  return { value: nextValue, start: Math.max(lineOffset, start + delta), end: Math.max(lineOffset, end + delta) };
}

/** Inserts a block, separated from neighbouring text by blank lines. Optionally selects a range inside it. */
export function insertMarkdownBlock(state: MarkdownEditState, block: string, selectWithinBlock?: [number, number]): MarkdownEditState {
  const before = state.value.slice(0, state.start);
  const after = state.value.slice(state.end);
  const prefix = !before || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const suffix = !after ? "" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const text = `${prefix}${block}${suffix}`;
  const blockStart = state.start + prefix.length;
  const selection: [number, number] = selectWithinBlock
    ? [blockStart + selectWithinBlock[0], blockStart + selectWithinBlock[1]]
    : [blockStart + block.length, blockStart + block.length];
  return replaceRange(state, state.start, state.end, text, selection);
}

/** Replaces the selection with text and places the cursor after it (or selects part of it). */
export function insertMarkdownText(state: MarkdownEditState, text: string, selectWithinText?: [number, number]): MarkdownEditState {
  const selection: [number, number] | undefined = selectWithinText
    ? [state.start + selectWithinText[0], state.start + selectWithinText[1]]
    : undefined;
  return replaceRange(state, state.start, state.end, text, selection);
}

/** Turns the selected lines into a callout, or inserts an empty callout ready for typing. */
export function insertMarkdownCallout(state: MarkdownEditState, kind: string, placeholder: string): MarkdownEditState {
  const selected = state.value.slice(state.start, state.end).trim();
  const body = selected || placeholder;
  const quoted = body.split("\n").map((line) => (line.trim() ? `> ${line}` : ">")).join("\n");
  const block = `> [!${kind}]\n${quoted}`;
  const bodyStart = `> [!${kind}]\n> `.length;
  return insertMarkdownBlock(state, block, selected ? undefined : [bodyStart, bodyStart + placeholder.length]);
}

/** Counts words in Markdown source, ignoring syntax characters and URLs. */
export function countMarkdownWords(value: string): number {
  const text = value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[![A-Z]+\]/g, " ")
    .replace(/[#>*_`~|\-[\]()]/g, " ");
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}
