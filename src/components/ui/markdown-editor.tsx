"use client";

import { type Editor, type JSONContent } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { DOMSerializer, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { AllSelection, NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import {
  Bold,
  Camera,
  ChartColumn,
  CheckSquare,
  ChevronDown,
  Columns3,
  FileDown,
  FileUp,
  Heading2,
  Heading3,
  HelpCircle,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  MoreHorizontal,
  Quote,
  Redo2,
  Rows3,
  ShieldAlert,
  Strikethrough,
  Table2,
  Trash2,
  Undo2,
  Upload,
  Video,
} from "lucide-react";
import { type ChangeEvent, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { ChartDialog, type ChartValue, EditorDialog } from "@/components/ui/editor-blocks";
import { ChartBlock, MediaFigure } from "@/components/ui/rich-editor-extensions";
import { CALLOUT_KINDS, type CalloutKind, isVideoSource, markdownToEditableHtml } from "@/lib/editor-content";
import { sanitizeHtmlFragment } from "@/lib/rich-text-html";
import { CHART_EDIT_EVENT, type ChartEditRequest, normalizeSerializedMarkdown, richEditorCoreExtensions, tableNeedsHtml } from "@/lib/rich-editor-schema";
import { getImageMimeType, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, uploadInstructionMedia } from "@/lib/media-upload";
import { cn, sanitizeFileName } from "@/lib/utils";
import { getUnsupportedVideoUploadMessage, isSupportedVideoUpload } from "@/lib/video";

/*
 * The instruction and document editor. Authors see formatting as they type (headings, lists, safety
 * callouts, tables, charts, photos and videos), using the toolbar or familiar shortcuts. Content is
 * still stored as Markdown, so saved records, prints, downloads and AI help work as before.
 */

interface MarkdownEditorProps {
  label: string;
  /** The content as Markdown. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeightClassName?: string;
  hasError?: boolean;
  focusRequestKey?: number;
  /** Extra toolbar actions (for example AI assistance), shown after undo and redo. */
  toolbarAfterRedoContent?: ReactNode;
  /** Actions aligned to the end of the toolbar. */
  toolbarEndContent?: ReactNode;
  /** Panels shown between the toolbar and the writing area. */
  aboveEditorContent?: ReactNode;
  /** A message shown above the writing area, such as a format-conversion notice. */
  notice?: ReactNode;
  onUploadStateChange?: (uploading: boolean) => void;
}

const DEFAULT_PLACEHOLDER = "Write the steps here. Use the toolbar for headings, numbered steps, safety callouts, tables and photos.";

const CALLOUT_OPTIONS: Array<{ kind: CalloutKind; description: string; placeholder: string; swatch: string }> = [
  { kind: "CAUTION", description: "Risk of injury. Safety-critical.", placeholder: "Describe the hazard and the required protection.", swatch: "bg-rose-600" },
  { kind: "WARNING", description: "Risk of equipment damage or a defect.", placeholder: "Describe the risk and how to avoid it.", swatch: "bg-amber-500" },
  { kind: "IMPORTANT", description: "Information operators must not miss.", placeholder: "State the requirement.", swatch: "bg-violet-600" },
  { kind: "NOTE", description: "Helpful background information.", placeholder: "Add the note.", swatch: "bg-sky-600" },
  { kind: "TIP", description: "A better or faster way to do the step.", placeholder: "Share the tip.", swatch: "bg-emerald-600" },
];

const HELP_ROWS: Array<[string, string]> = [
  ["Toolbar", "Headings, bold, lists, checklists, safety callouts, links, tables, charts, photos and videos."],
  ["Type ## then a space", "Section heading (### for a smaller one)."],
  ["Type 1. then a space", "Numbered steps. Press Enter for the next step, Enter twice to stop."],
  ["Type - then a space", "Bulleted list. Tab and Shift+Tab nest or un-nest an item."],
  ["Type [ ] then a space", "Checklist item."],
  ["Type > then a space", "Quote."],
  ["Ctrl+B · Ctrl+I · Ctrl+K", "Bold · italic · link."],
  ["Enter on an empty line", "Leaves a list, checklist or callout and continues below it."],
  ["Shift+Enter", "New line without starting a new paragraph or step."],
  ["Paste or drop", "Photos and videos upload automatically. Formatted text from Word or web pages keeps its headings, lists and tables."],
];

function buildMediaStoragePath(file: File, mediaType: "image" | "video") {
  const safeName = sanitizeFileName(file.name || `${mediaType}.bin`);
  const uniqueId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `inline/${mediaType}/${new Date().toISOString().slice(0, 10)}/${uniqueId}-${safeName}`;
}

function mediaLabel(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[[\]\\]/g, "").replace(/\s+/g, " ").trim() || "Photo";
}

function isMediaFile(file: File) {
  return Boolean(getImageMimeType(file)) || isSupportedVideoUpload(file);
}

/** Plain text that is clearly Markdown (a pasted .md document) is formatted instead of pasted literally. */
function looksLikeMarkdown(text: string) {
  return text.includes("\n") && /^(?:#{1,6}\s|>\s|[-*+]\s+\S|\d+[.)]\s+\S|\|.+\|\s*$|```)/m.test(text);
}

function countWords(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Markdown to the HTML the editor loads, through the same sanitizer the viewer uses. */
function toEditorHtml(markdown: string) {
  return sanitizeHtmlFragment(markdownToEditableHtml(markdown));
}

/** Converts what the editor holds into the stored Markdown. */
function serializeDocument(editor: Editor): string {
  const replaceComplexTables = (node: JSONContent): JSONContent => {
    if (node.type === "table" && tableNeedsHtml(node)) {
      try {
        const container = document.createElement("div");
        container.appendChild(DOMSerializer.fromSchema(editor.schema).serializeNode(editor.schema.nodeFromJSON(node)));
        // Editor-only layout attributes are not part of the record.
        container.querySelectorAll("colgroup").forEach((element) => element.remove());
        container.querySelectorAll("table").forEach((element) => element.removeAttribute("style"));
        return { type: "rawHtmlBlock", attrs: { html: container.innerHTML } };
      } catch {
        return node;
      }
    }
    return node.content ? { ...node, content: node.content.map(replaceComplexTables) } : node;
  };
  const json = replaceComplexTables(editor.getJSON());
  return normalizeSerializedMarkdown(editor.markdown ? editor.markdown.serialize(json) : editor.getMarkdown());
}

function isEmptyParagraph(node: ProseMirrorNode) {
  return node.type.name === "paragraph" && node.content.size === 0;
}

/**
 * Whether two documents hold the same content. Empty lines at the end are ignored: the editor keeps one
 * below a final table, chart or photo so authors can type there, and adding it is not an edit.
 */
function sameContent(a: ProseMirrorNode, b: ProseMirrorNode) {
  const contentLength = (doc: ProseMirrorNode) => {
    let count = doc.childCount;
    while (count > 0 && isEmptyParagraph(doc.child(count - 1))) count -= 1;
    return count;
  };
  const count = contentLength(a);
  if (count !== contentLength(b)) return false;
  for (let index = 0; index < count; index += 1) {
    if (!a.child(index).eq(b.child(index))) return false;
  }
  return true;
}

/**
 * Ctrl+A selects the whole document, which list, quote and callout commands do not treat as being inside
 * a list or callout (so a second click would not remove it). Narrow it to the text it covers first.
 */
function narrowSelectAll(editor: Editor) {
  const { state } = editor;
  if (!(state.selection instanceof AllSelection)) return;
  const start = Selection.findFrom(state.doc.resolve(0), 1, true);
  const end = Selection.findFrom(state.doc.resolve(state.doc.content.size), -1, true);
  if (!start || !end || start.from > end.to) return;
  editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, start.from, end.to)));
}

/**
 * Puts the cursor on the line below the block at `pos` (adding an empty line if none follows), so typing
 * after inserting a chart or photo never replaces it and further photos follow in order.
 */
function moveCursorBelow(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const after = pos + node.nodeSize;
  const tr = editor.state.tr;
  if (!tr.doc.nodeAt(after)?.isTextblock) tr.insert(after, editor.schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView();
  editor.view.dispatch(tr);
}

function findUploadPlaceholder(doc: ProseMirrorNode, uploadId: string) {
  let found: { pos: number; size: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === "uploadPlaceholder" && node.attrs.uploadId === uploadId) {
      found = { pos, size: node.nodeSize };
      return false;
    }
    return true;
  });
  return found as { pos: number; size: number } | null;
}

function ToolbarButton({ label, shortcut, onClick, disabled, children, pressed }: {
  label: string; shortcut?: string; onClick: () => void; disabled?: boolean; children: ReactNode; pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-700 transition hover:bg-slate-200/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:bg-cyan-500/15 aria-pressed:text-cyan-800 dark:text-slate-200 dark:hover:bg-slate-800 dark:aria-pressed:text-cyan-200"
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <span aria-hidden="true" className="mx-0.5 h-6 w-px shrink-0 bg-slate-300 dark:bg-slate-700" />;
}

function TableActionButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
    >
      {children}
      {label}
    </button>
  );
}

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

export function MarkdownEditor({
  label,
  value,
  onChange,
  placeholder,
  minHeightClassName = "min-h-72",
  hasError = false,
  focusRequestKey = 0,
  toolbarAfterRedoContent,
  toolbarEndContent,
  aboveEditorContent,
  notice,
  onUploadStateChange,
}: MarkdownEditorProps) {
  const helpId = useId();
  const photoCaptureRef = useRef<HTMLInputElement>(null);
  const videoCaptureRef = useRef<HTMLInputElement>(null);
  const filePickerRef = useRef<HTMLInputElement>(null);
  const markdownFileRef = useRef<HTMLInputElement>(null);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const [calloutMenuOpen, setCalloutMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [linkDialog, setLinkDialog] = useState<{ text: string; url: string; error: string; from: number; to: number; editing: boolean } | null>(null);
  const [chartDialog, setChartDialog] = useState<{ pos?: number; initial?: ChartValue } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ name: string; percent: number; index: number; total: number } | null>(null);
  const closeCalloutMenu = useCallback(() => setCalloutMenuOpen(false), []);
  const closeMoreMenu = useCallback(() => setMoreMenuOpen(false), []);
  const calloutMenuRef = useDismiss(calloutMenuOpen, closeCalloutMenu);
  const moreMenuRef = useDismiss(moreMenuOpen, closeMoreMenu);

  // The editor reports Markdown upward only for the author's own edits. If the document returns to how it
  // was loaded, the original text is reported, so undoing changes never leaves a false "unsaved" state.
  const onChangeRef = useRef(onChange);
  const lastValueRef = useRef(value);
  const baselineRef = useRef<{ doc: ProseMirrorNode; value: string } | null>(null);
  const hasFocusedRef = useRef(false);
  const uploadFilesRef = useRef<(files: File[], requested?: "image" | "video") => void>(() => undefined);
  const openLinkDialogRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const extensions = useMemo(() => [
    ...richEditorCoreExtensions({
      chartBlock: ChartBlock,
      mediaFigure: MediaFigure,
    }),
    Placeholder.configure({ placeholder: placeholder || DEFAULT_PLACEHOLDER }),
    Markdown,
  ], [placeholder]);

  const editorProps = useMemo(() => ({
    attributes: {
      "aria-label": label,
      "aria-multiline": "true",
      "aria-describedby": helpId,
      "aria-invalid": hasError ? "true" : "false",
      role: "textbox",
      spellcheck: "true",
      class: cn("prose-markdown rich-editor-content", minHeightClassName),
    },
    handlePaste: (_view: EditorView, event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter(isMediaFile);
      if (files.length > 0) {
        event.preventDefault();
        uploadFilesRef.current(files);
        return true;
      }
      const html = event.clipboardData?.getData("text/html") ?? "";
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!html && looksLikeMarkdown(text)) {
        event.preventDefault();
        editorRef.current?.chain().focus().insertContent(toEditorHtml(text.replace(/\r\n/g, "\n"))).run();
        return true;
      }
      return false;
    },
    handleDrop: (_view: EditorView, event: DragEvent, _slice: unknown, moved: boolean) => {
      if (moved) return false;
      const files = Array.from(event.dataTransfer?.files ?? []).filter(isMediaFile);
      if (files.length === 0) return false;
      event.preventDefault();
      uploadFilesRef.current(files);
      return true;
    },
    handleKeyDown: (_view: EditorView, event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openLinkDialogRef.current();
        return true;
      }
      return false;
    },
  }), [hasError, helpId, label, minHeightClassName]);

  const editorRef = useRef<Editor | null>(null);
  const editor = useEditor({
    extensions,
    content: toEditorHtml(value),
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps,
    onCreate: ({ editor: created }) => {
      editorRef.current = created;
      baselineRef.current = { doc: created.state.doc, value };
      lastValueRef.current = value;
      // Add the empty last line below a final table, chart or photo right away (outside undo history), so
      // there is always somewhere to click or press Ctrl+End to keep writing. It is not an edit.
      created.view.dispatch(created.state.tr.setMeta("addToHistory", false));
    },
    onFocus: () => {
      hasFocusedRef.current = true;
    },
    onUpdate: ({ editor: updated }) => {
      const baseline = baselineRef.current;
      const next = baseline && sameContent(updated.state.doc, baseline.doc) ? baseline.value : serializeDocument(updated);
      if (next === lastValueRef.current) return;
      lastValueRef.current = next;
      onChangeRef.current(next);
    },
  }, [extensions]);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Keep accessibility attributes (such as the error state) current.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setOptions({ editorProps });
  }, [editor, editorProps]);

  // Content replaced from outside, such as an applied AI suggestion, reloads the editor.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (value.trim() === lastValueRef.current.trim()) return;
    editor.commands.setContent(toEditorHtml(value), { emitUpdate: false });
    baselineRef.current = { doc: editor.state.doc, value };
    lastValueRef.current = value;
  }, [editor, value]);

  useEffect(() => {
    if (!editor || focusRequestKey <= 0) return;
    editor.commands.focus("end");
  }, [editor, focusRequestKey]);

  useEffect(() => () => uploadControllerRef.current?.abort(), []);

  const toolbar = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      return {
        bold: current.isActive("bold"),
        italic: current.isActive("italic"),
        strike: current.isActive("strike"),
        h2: current.isActive("heading", { level: 2 }),
        h3: current.isActive("heading", { level: 3 }),
        ordered: current.isActive("orderedList"),
        bullet: current.isActive("bulletList"),
        task: current.isActive("taskList"),
        quote: current.isActive("blockquote"),
        link: current.isActive("link"),
        table: current.isActive("table"),
        canUndo: current.can().undo(),
        canRedo: current.can().redo(),
        words: countWords(current.getText({ blockSeparator: " " })),
      };
    },
  });

  /**
   * Inserts a block where the author is working, or at the end if they have not clicked in yet. Inside a
   * table the block goes after the table, because table cells hold text only.
   */
  const insertBlock = useCallback((content: JSONContent | string) => {
    const current = editorRef.current;
    if (!current) return;
    if (!hasFocusedRef.current) {
      current.chain().insertContentAt(current.state.doc.content.size, content).run();
      return;
    }
    const { $from } = current.state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if ($from.node(depth).type.name === "table") {
        current.chain().focus().insertContentAt($from.after(depth), content).run();
        return;
      }
    }
    current.chain().focus().insertContent(content).run();
  }, []);

  const replaceUploadPlaceholder = useCallback((uploadId: string, replacement: JSONContent | null) => {
    const current = editorRef.current;
    if (!current || current.isDestroyed) return;
    const found = findUploadPlaceholder(current.state.doc, uploadId);
    if (!found) return;
    const tr = current.state.tr;
    if (replacement) tr.replaceWith(found.pos, found.pos + found.size, current.schema.nodeFromJSON(replacement));
    else tr.delete(found.pos, found.pos + found.size);
    current.view.dispatch(tr);
  }, []);

  const uploadFiles = useCallback(async (files: File[], requested?: "image" | "video") => {
    if (files.length === 0) return;
    if (uploadControllerRef.current) {
      setMessage("Wait for the current upload to finish before adding more media.");
      return;
    }
    setMessage(null);
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    onUploadStateChange?.(true);
    try {
      for (const [index, file] of files.entries()) {
        if (controller.signal.aborted) break;
        const kind = getImageMimeType(file) ? "image" : isSupportedVideoUpload(file) ? "video" : null;
        if (!kind || (requested && kind !== requested)) {
          setMessage(requested === "video" || (!requested && file.type.startsWith("video/"))
            ? getUnsupportedVideoUploadMessage(file.name)
            : `${file.name} is unsupported. Use JPEG, PNG, WebP, GIF or AVIF photos, or MP4, MOV or WebM videos. For iPad HEIC photos, export as JPEG or use Take photo.`);
          continue;
        }
        if (!file.size) {
          setMessage(`${file.name} is empty. Capture or choose another file.`);
          continue;
        }
        const limit = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
        if (file.size > limit) {
          setMessage(`${file.name} is too large. The limit is ${Math.round(limit / (1024 * 1024))} MB.`);
          continue;
        }
        const uploadId = Math.random().toString(36).slice(2, 10);
        const name = mediaLabel(file.name);
        insertBlock({ type: "uploadPlaceholder", attrs: { uploadId, label: name } });
        const placed = editorRef.current ? findUploadPlaceholder(editorRef.current.state.doc, uploadId) : null;
        if (editorRef.current && placed) moveCursorBelow(editorRef.current, placed.pos);
        setUploadProgress({ name: file.name, percent: 0, index: index + 1, total: files.length });
        try {
          let url = await uploadInstructionMedia(file, buildMediaStoragePath(file, kind), {
            signal: controller.signal,
            onProgress: (percent) => setUploadProgress({ name: file.name, percent, index: index + 1, total: files.length }),
          });
          if (!url) throw new Error(`Unable to resolve a public address for ${file.name}.`);
          if (kind === "video" && !isVideoSource(url)) url = `${url}#video`;
          replaceUploadPlaceholder(uploadId, { type: "mediaFigure", attrs: { src: url, alt: name, caption: "", kind } });
        } catch (error) {
          replaceUploadPlaceholder(uploadId, null);
          if (controller.signal.aborted) {
            setMessage("Upload cancelled. Media that finished uploading stays in the instructions.");
            break;
          }
          setMessage(error instanceof Error ? error.message : `Unable to upload ${file.name}.`);
        }
      }
    } finally {
      uploadControllerRef.current = null;
      setUploadProgress(null);
      onUploadStateChange?.(false);
    }
  }, [insertBlock, onUploadStateChange, replaceUploadPlaceholder]);

  const openLinkDialog = useCallback(() => {
    const current = editorRef.current;
    if (!current) return;
    if (current.isActive("link")) current.chain().extendMarkRange("link").run();
    const { from, to } = current.state.selection;
    const selected = current.state.doc.textBetween(from, to, " ");
    const existing = current.getAttributes("link").href as string | undefined;
    const isUrl = /^(https?:\/\/|mailto:|tel:)/i.test(selected.trim());
    setLinkDialog({ text: isUrl ? "" : selected, url: existing ?? (isUrl ? selected.trim() : ""), error: "", from, to, editing: Boolean(existing) });
  }, []);

  useEffect(() => {
    uploadFilesRef.current = (files, requested) => {
      void uploadFiles(files, requested);
    };
    openLinkDialogRef.current = openLinkDialog;
  }, [openLinkDialog, uploadFiles]);

  // A chart's Edit chart button opens the chart dialog for that chart.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const element = editor.view.dom;
    const onEditChart = (event: Event) => {
      const request = (event as CustomEvent<ChartEditRequest>).detail;
      setChartDialog({ pos: request.pos, initial: request.chart });
    };
    element.addEventListener(CHART_EDIT_EVENT, onEditChart);
    return () => element.removeEventListener(CHART_EDIT_EVENT, onEditChart);
  }, [editor]);

  function handleFileInput(event: ChangeEvent<HTMLInputElement>, requested?: "image" | "video") {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void uploadFiles(files, requested);
  }

  function applyLink() {
    if (!linkDialog || !editor) return;
    const url = linkDialog.url.trim();
    if (!/^(https?:\/\/[^\s]+|mailto:[^\s]+|tel:[^\s]+)$/i.test(url)) {
      setLinkDialog({ ...linkDialog, error: "Enter a complete link starting with https://, http://, mailto: or tel:." });
      return;
    }
    const { from, to } = linkDialog;
    const text = linkDialog.text.trim() || url;
    setLinkDialog(null);
    const chain = editor.chain().focus().setTextSelection({ from, to });
    if (from === to || linkDialog.text.trim() !== editor.state.doc.textBetween(from, to, " ").trim()) {
      chain.insertContent({ type: "text", text, marks: [{ type: "link", attrs: { href: url } }] }).run();
    } else {
      chain.setLink({ href: url }).run();
    }
  }

  function removeLink() {
    if (!linkDialog || !editor) return;
    const { from, to } = linkDialog;
    setLinkDialog(null);
    editor.chain().focus().setTextSelection({ from, to }).extendMarkRange("link").unsetLink().run();
  }

  function insertTable() {
    insertBlock(
      "<table><tbody><tr><th><p>Step</p></th><th><p>Check</p></th><th><p>Result</p></th></tr>"
      + "<tr><td><p></p></td><td><p></p></td><td><p></p></td></tr>"
      + "<tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>",
    );
    // Start in the first empty cell so the author can fill in the table straight away.
    const current = editorRef.current;
    if (!current) return;
    const { $from } = current.state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const table = $from.node(depth);
      if (table.type.name !== "table") continue;
      const tableStart = $from.start(depth);
      let cellStart = -1;
      table.descendants((node, pos) => {
        if (cellStart >= 0) return false;
        if (node.type.name === "tableCell") {
          cellStart = tableStart + pos;
          return false;
        }
        return true;
      });
      if (cellStart >= 0) current.chain().focus().setTextSelection(cellStart + 2).run();
      return;
    }
  }

  /** Changes the callout around the cursor, wraps a selection, or adds a new callout ready to type in. */
  function insertCallout(option: (typeof CALLOUT_OPTIONS)[number]) {
    setCalloutMenuOpen(false);
    if (!editor) return;
    if (editor.isActive("callout")) {
      editor.chain().focus().updateAttributes("callout", { kind: option.kind }).run();
      return;
    }
    const { state } = editor;
    if (!state.selection.empty) {
      editor.chain().focus().wrapIn("callout", { kind: option.kind }).run();
      return;
    }
    const { schema } = state;
    const callout = schema.nodes.callout.create(
      { kind: option.kind },
      schema.nodes.paragraph.create(null, schema.text(option.placeholder)),
    );
    const { $from } = state.selection;
    const tr = state.tr;
    let insertAt: number;
    if (!hasFocusedRef.current) {
      insertAt = state.doc.content.size;
      tr.insert(insertAt, callout);
    } else if ($from.depth >= 1) {
      const block = $from.node(1);
      const start = $from.before(1);
      if (block.type.name === "paragraph" && block.content.size === 0) {
        insertAt = start;
        tr.replaceWith(start, $from.after(1), callout);
      } else {
        insertAt = $from.after(1);
        tr.insert(insertAt, callout);
      }
    } else {
      insertAt = state.selection.to;
      tr.insert(insertAt, callout);
    }
    tr.setSelection(TextSelection.create(tr.doc, insertAt + 2, insertAt + 2 + option.placeholder.length)).scrollIntoView();
    editor.view.dispatch(tr);
    editor.view.focus();
    hasFocusedRef.current = true;
  }

  function saveChart(chart: ChartValue) {
    if (!editor) return;
    const attributes = { chartType: chart.type, title: chart.title, data: JSON.stringify(chart.data), source: "" };
    const pos = chartDialog?.pos;
    if (typeof pos === "number") {
      editor.chain().focus().command(({ tr }) => {
        tr.setNodeMarkup(pos, undefined, attributes);
        return true;
      }).run();
      return;
    }
    insertBlock({ type: "chartBlock", attrs: attributes });
    // The new chart is left selected; continue below it instead.
    const { selection } = editor.state;
    if (selection instanceof NodeSelection && selection.node.type.name === "chartBlock") moveCursorBelow(editor, selection.from);
  }

  function downloadMarkdown() {
    setMoreMenuOpen(false);
    const url = URL.createObjectURL(new Blob([value], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${sanitizeFileName(label) || "instructions"}.md`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importMarkdownFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setMessage("Markdown files must be 2 MB or smaller.");
      return;
    }
    try {
      const text = (await file.text()).replace(/\r\n/g, "\n").trim();
      if (!text) {
        setMessage(`${file.name} is empty.`);
        return;
      }
      insertBlock(toEditorHtml(text));
      setMessage(null);
    } catch {
      setMessage("Unable to read this Markdown file.");
    }
  }

  const run = (command: (current: Editor) => void) => {
    if (editor) command(editor);
  };
  const uploading = uploadProgress !== null;
  const ready = Boolean(editor && toolbar);

  return (
    <div role="group" aria-label={`${label} editor`} className="grid min-w-0 gap-2 text-sm">
      <div className="grid gap-0.5">
        <span className="text-sm font-semibold">{label}</span>
        <span id={helpId} className="text-xs text-slate-500 dark:text-slate-400">
          Formatting shows as you type · press Enter for the next step · paste or drop photos
        </span>
      </div>

      <div
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer.types).includes("Files")) setDragActive(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
        }}
        onDrop={() => setDragActive(false)}
        className={cn(
          "rich-editor min-w-0 rounded-xl border bg-white shadow-sm transition dark:bg-slate-950",
          hasError ? "border-rose-500 ring-2 ring-rose-500/25" : "border-slate-300 focus-within:border-cyan-500 focus-within:ring-2 focus-within:ring-cyan-500/20 dark:border-slate-700",
          dragActive ? "border-cyan-500 ring-4 ring-cyan-500/25" : "",
        )}
      >
        <div role="toolbar" aria-label={`${label} formatting`} className="flex min-w-0 flex-wrap items-center gap-0.5 rounded-t-xl border-b border-slate-200 bg-slate-50 px-1.5 py-1 dark:border-slate-800 dark:bg-slate-900/70">
          <ToolbarButton label="Heading 2" disabled={!ready} pressed={toolbar?.h2} onClick={() => run((current) => current.chain().focus().toggleHeading({ level: 2 }).run())}><Heading2 size={18} /></ToolbarButton>
          <ToolbarButton label="Heading 3" disabled={!ready} pressed={toolbar?.h3} onClick={() => run((current) => current.chain().focus().toggleHeading({ level: 3 }).run())}><Heading3 size={18} /></ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton label="Bold" shortcut="Ctrl+B" disabled={!ready} pressed={toolbar?.bold} onClick={() => run((current) => current.chain().focus().toggleBold().run())}><Bold size={18} /></ToolbarButton>
          <ToolbarButton label="Italic" shortcut="Ctrl+I" disabled={!ready} pressed={toolbar?.italic} onClick={() => run((current) => current.chain().focus().toggleItalic().run())}><Italic size={18} /></ToolbarButton>
          <ToolbarButton label="Strikethrough" disabled={!ready} pressed={toolbar?.strike} onClick={() => run((current) => current.chain().focus().toggleStrike().run())}><Strikethrough size={18} /></ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton label="Numbered list" disabled={!ready} pressed={toolbar?.ordered} onClick={() => run((current) => { narrowSelectAll(current); current.chain().focus().toggleOrderedList().run(); })}><ListOrdered size={18} /></ToolbarButton>
          <ToolbarButton label="Bulleted list" disabled={!ready} pressed={toolbar?.bullet} onClick={() => run((current) => { narrowSelectAll(current); current.chain().focus().toggleBulletList().run(); })}><List size={18} /></ToolbarButton>
          <ToolbarButton label="Checklist" disabled={!ready} pressed={toolbar?.task} onClick={() => run((current) => { narrowSelectAll(current); current.chain().focus().toggleTaskList().run(); })}><CheckSquare size={18} /></ToolbarButton>
          <ToolbarButton label="Quote" disabled={!ready} pressed={toolbar?.quote} onClick={() => run((current) => { narrowSelectAll(current); current.chain().focus().toggleBlockquote().run(); })}><Quote size={18} /></ToolbarButton>
          <ToolbarDivider />
          <div ref={calloutMenuRef} className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={calloutMenuOpen}
              disabled={!ready}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setCalloutMenuOpen((open) => !open)}
              className="inline-flex h-11 items-center gap-1.5 rounded-lg px-2.5 font-semibold text-slate-700 transition hover:bg-slate-200/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <ShieldAlert size={18} className="text-amber-600 dark:text-amber-400" />
              Callout
              <ChevronDown size={14} />
            </button>
            {calloutMenuOpen ? (
              <div role="menu" aria-label="Insert callout" className="absolute left-0 top-full z-30 mt-1 grid w-72 gap-0.5 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                {CALLOUT_OPTIONS.map((option) => (
                  <button
                    key={option.kind}
                    type="button"
                    role="menuitem"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertCallout(option)}
                    className="flex min-h-11 items-start gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <span className={cn("mt-1 h-3 w-3 shrink-0 rounded-full", option.swatch)} />
                    <span className="grid">
                      <span className="font-semibold">{CALLOUT_KINDS[option.kind].label}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{option.description}</span>
                    </span>
                  </button>
                ))}
                {editor?.isActive("callout") ? (
                  <button
                    type="button"
                    role="menuitem"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setCalloutMenuOpen(false);
                      narrowSelectAll(editor);
                      editor.chain().focus().lift("callout").run();
                    }}
                    className="flex min-h-11 items-center gap-3 rounded-lg px-2.5 py-2 text-left font-semibold text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40"
                  >
                    Remove callout
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <ToolbarButton label="Link" shortcut="Ctrl+K" disabled={!ready} pressed={toolbar?.link} onClick={openLinkDialog}><Link2 size={18} /></ToolbarButton>
          <ToolbarButton label="Insert table" disabled={!ready} onClick={insertTable}><Table2 size={18} /></ToolbarButton>
          <ToolbarButton label="Insert chart" disabled={!ready} onClick={() => setChartDialog({})}><ChartColumn size={18} /></ToolbarButton>
          <ToolbarButton label="Divider" disabled={!ready} onClick={() => run((current) => current.chain().focus().setHorizontalRule().run())}><Minus size={18} /></ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton label="Take photo" disabled={!ready || uploading} onClick={() => photoCaptureRef.current?.click()}><Camera size={18} /></ToolbarButton>
          <ToolbarButton label="Record video" disabled={!ready || uploading} onClick={() => videoCaptureRef.current?.click()}><Video size={18} /></ToolbarButton>
          <ToolbarButton label="Upload photos or videos" disabled={!ready || uploading} onClick={() => filePickerRef.current?.click()}><Upload size={18} /></ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton label="Undo" shortcut="Ctrl+Z" disabled={!toolbar?.canUndo} onClick={() => run((current) => current.chain().focus().undo().run())}><Undo2 size={18} /></ToolbarButton>
          <ToolbarButton label="Redo" shortcut="Ctrl+Y" disabled={!toolbar?.canRedo} onClick={() => run((current) => current.chain().focus().redo().run())}><Redo2 size={18} /></ToolbarButton>
          {toolbarAfterRedoContent ? <div className="inline-flex items-center px-0.5">{toolbarAfterRedoContent}</div> : null}
          <div ref={moreMenuRef} className="relative">
            <ToolbarButton label="More options" onClick={() => setMoreMenuOpen((open) => !open)}><MoreHorizontal size={18} /></ToolbarButton>
            {moreMenuOpen ? (
              <div role="menu" aria-label="More editor options" className="absolute right-0 top-full z-30 mt-1 grid w-60 gap-0.5 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl sm:left-0 sm:right-auto dark:border-slate-700 dark:bg-slate-900">
                <button type="button" role="menuitem" onClick={() => { setMoreMenuOpen(false); setHelpOpen(true); }} className="flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"><HelpCircle size={16} />Formatting help</button>
                <button type="button" role="menuitem" disabled={!ready} onClick={() => { setMoreMenuOpen(false); markdownFileRef.current?.click(); }} className="flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-left hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"><FileUp size={16} />Import .md file</button>
                <button type="button" role="menuitem" disabled={!value.trim()} onClick={downloadMarkdown} className="flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-left hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"><FileDown size={16} />Download .md file</button>
              </div>
            ) : null}
          </div>
          {toolbarEndContent ? <div className="ml-auto inline-flex items-center justify-end pl-1">{toolbarEndContent}</div> : null}
        </div>

        {toolbar?.table ? (
          <div role="toolbar" aria-label="Table" className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50/70 px-2 py-1.5 dark:border-slate-800 dark:bg-slate-900/50">
            <span className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Table</span>
            <TableActionButton label="Add row" onClick={() => run((current) => current.chain().focus().addRowAfter().run())}><Rows3 size={14} /></TableActionButton>
            <TableActionButton label="Add column" onClick={() => run((current) => current.chain().focus().addColumnAfter().run())}><Columns3 size={14} /></TableActionButton>
            <TableActionButton label="Delete row" onClick={() => run((current) => current.chain().focus().deleteRow().run())}><Trash2 size={14} /></TableActionButton>
            <TableActionButton label="Delete column" onClick={() => run((current) => current.chain().focus().deleteColumn().run())}><Trash2 size={14} /></TableActionButton>
            <TableActionButton label="Delete table" onClick={() => run((current) => current.chain().focus().deleteTable().run())}><Trash2 size={14} /></TableActionButton>
          </div>
        ) : null}

        {uploadProgress ? (
          <div role="status" className="grid gap-2 border-b border-cyan-500/30 bg-cyan-500/5 px-3 py-2.5 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 break-all font-medium">Uploading {uploadProgress.name} · {uploadProgress.index}/{uploadProgress.total} · {uploadProgress.percent}%</span>
              <button type="button" className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 font-semibold dark:border-slate-700 dark:bg-slate-900" onClick={() => uploadControllerRef.current?.abort()}>Cancel upload</button>
            </div>
            <progress value={uploadProgress.percent} max={100} aria-label={`Upload progress for ${uploadProgress.name}`} className="h-2 w-full accent-cyan-600" />
          </div>
        ) : null}

        {message ? (
          <div role="alert" className="flex items-start justify-between gap-3 border-b border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
            <span>{message}</span>
            <button type="button" onClick={() => setMessage(null)} className="shrink-0 rounded px-2 font-semibold underline-offset-2 hover:underline">Dismiss</button>
          </div>
        ) : null}

        {notice ? <div className="border-b border-sky-400/40 bg-sky-50 px-3 py-2.5 text-sm text-sky-950 dark:bg-sky-950/40 dark:text-sky-100">{notice}</div> : null}
        {aboveEditorContent ? <div className="grid gap-3 border-b border-slate-200 p-3 dark:border-slate-800">{aboveEditorContent}</div> : null}

        {editor ? (
          <EditorContent editor={editor} className="rich-editor-surface min-w-0" />
        ) : (
          <div aria-hidden="true" className={cn("prose-markdown rich-editor-content text-slate-400", minHeightClassName)}>Loading editor…</div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500 dark:text-slate-400">
        <button type="button" onClick={() => setHelpOpen(true)} className="inline-flex min-h-8 items-center gap-1 rounded font-medium text-cyan-700 underline-offset-2 hover:underline dark:text-cyan-300">
          <HelpCircle size={14} />
          Formatting help
        </button>
        <span aria-live="polite">{toolbar?.words ?? 0} {(toolbar?.words ?? 0) === 1 ? "word" : "words"}</span>
      </div>

      <input ref={photoCaptureRef} type="file" accept="image/*" capture="environment" aria-label="Take a photo with the rear camera" className="hidden" onChange={(event) => handleFileInput(event, "image")} />
      <input ref={videoCaptureRef} type="file" accept="video/*" capture="environment" aria-label="Record a video with the rear camera" className="hidden" onChange={(event) => handleFileInput(event, "video")} />
      <input ref={filePickerRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm" aria-label="Choose photos or videos to upload" className="hidden" onChange={(event) => handleFileInput(event)} />
      <input ref={markdownFileRef} type="file" accept=".md,.markdown,text/markdown,text/plain" aria-label="Import Markdown file" className="hidden" onChange={(event) => { void importMarkdownFile(event); }} />

      {linkDialog ? (
        <EditorDialog title="Link" onClose={() => setLinkDialog(null)}>
          <label className="grid gap-1 text-sm font-medium">Link text
            <input autoFocus value={linkDialog.text} placeholder="Released drawing" onChange={(event) => setLinkDialog({ ...linkDialog, text: event.target.value })} className="min-h-11 rounded-lg border border-slate-300 bg-transparent px-3 dark:border-slate-700" />
          </label>
          <label className="grid gap-1 text-sm font-medium">Link URL
            <input type="url" value={linkDialog.url} placeholder="https://example.com/drawing.pdf" onChange={(event) => setLinkDialog({ ...linkDialog, url: event.target.value, error: "" })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyLink(); } }} className="min-h-11 rounded-lg border border-slate-300 bg-transparent px-3 dark:border-slate-700" />
          </label>
          {linkDialog.error ? <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{linkDialog.error}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            {linkDialog.editing ? <button type="button" onClick={removeLink} className="mr-auto min-h-11 rounded-lg border border-rose-500/40 px-4 font-semibold text-rose-700 dark:text-rose-300">Remove link</button> : null}
            <button type="button" onClick={() => setLinkDialog(null)} className="min-h-11 rounded-lg border px-4">Cancel</button>
            <button type="button" onClick={applyLink} className="min-h-11 rounded-lg bg-cyan-700 px-4 font-semibold text-white">{linkDialog.editing ? "Update link" : "Insert link"}</button>
          </div>
        </EditorDialog>
      ) : null}

      {chartDialog ? (
        <ChartDialog initial={chartDialog.initial} onClose={() => setChartDialog(null)} onSave={saveChart} />
      ) : null}

      {helpOpen ? (
        <EditorDialog title="Formatting help" wide onClose={() => setHelpOpen(false)}>
          <p className="text-sm text-slate-600 dark:text-slate-300">What you see while writing is what operators see. Use the toolbar, or these shortcuts.</p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900">
                <tr><th scope="col" className="px-3 py-2">Do this</th><th scope="col" className="px-3 py-2">To get</th></tr>
              </thead>
              <tbody>
                {HELP_ROWS.map(([action, result]) => (
                  <tr key={action} className="border-t border-slate-200 align-top dark:border-slate-800">
                    <td className="px-3 py-2 font-semibold">{action}</td>
                    <td className="px-3 py-2">{result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Safety callouts, charts and tables have their own toolbar buttons. Click a chart&apos;s Edit chart button to change its data.</p>
        </EditorDialog>
      ) : null}
    </div>
  );
}
