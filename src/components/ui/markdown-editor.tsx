"use client";

import {
  Bold,
  Camera,
  ChartColumn,
  CheckSquare,
  ChevronDown,
  Columns2,
  Eye,
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
  PenLine,
  Quote,
  Redo2,
  ShieldAlert,
  Strikethrough,
  Table2,
  Undo2,
  Upload,
  Video,
} from "lucide-react";
import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ChartDialog, EditorDialog } from "@/components/ui/editor-blocks";
import { CALLOUT_KINDS, type CalloutKind, isVideoSource, serializeChartSource, toEditorMarkdown } from "@/lib/editor-content";
import {
  continueMarkdownList,
  countMarkdownWords,
  indentMarkdownListLine,
  insertMarkdownBlock,
  insertMarkdownCallout,
  insertMarkdownText,
  type LinePrefixKind,
  type MarkdownEditState,
  toggleMarkdownLinePrefix,
  toggleMarkdownWrap,
} from "@/lib/markdown-commands";
import { getImageMimeType, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, uploadInstructionMedia } from "@/lib/media-upload";
import { rewriteLoopbackMediaUrlsInHtml } from "@/lib/media-url";
import { sanitizeHtmlFragment, sanitizeRichHtml } from "@/lib/rich-text-html";
import { useHydrated } from "@/lib/use-hydrated";
import { cn, sanitizeFileName } from "@/lib/utils";
import { getUnsupportedVideoUploadMessage, isSupportedVideoUpload, normalizeVideoMarkupForPlayback } from "@/lib/video";

type EditorMode = "write" | "split" | "preview";

interface MarkdownEditorProps {
  label: string;
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

const MODE_STORAGE_KEY = "wi.markdownEditor.mode";

const CALLOUT_OPTIONS: Array<{ kind: CalloutKind; description: string; placeholder: string; swatch: string }> = [
  { kind: "CAUTION", description: "Risk of injury. Safety-critical.", placeholder: "Describe the hazard and the required protection.", swatch: "bg-rose-600" },
  { kind: "WARNING", description: "Risk of equipment damage or a defect.", placeholder: "Describe the risk and how to avoid it.", swatch: "bg-amber-500" },
  { kind: "IMPORTANT", description: "Information operators must not miss.", placeholder: "State the requirement.", swatch: "bg-violet-600" },
  { kind: "NOTE", description: "Helpful background information.", placeholder: "Add the note.", swatch: "bg-sky-600" },
  { kind: "TIP", description: "A better or faster way to do the step.", placeholder: "Share the tip.", swatch: "bg-emerald-600" },
];

const GUIDE_ROWS: Array<[string, string]> = [
  ["## Section", "Section heading (### for a smaller one)"],
  ["**bold**  *italic*  ~~removed~~", "Text emphasis"],
  ["1. Step", "Numbered step; press Enter to add the next"],
  ["- Item", "Bulleted list"],
  ["- [ ] Check", "Checklist item ([x] when done)"],
  ["> [!CAUTION]\n> Text", "Safety callout: CAUTION, WARNING, IMPORTANT, NOTE or TIP"],
  ["[Drawing](https://…)", "Link"],
  ["![Caption](photo.jpg \"Shown under the photo\")", "Photo or video (use the camera or upload buttons)"],
  ["| A | B |\n| --- | --- |\n| 1 | 2 |", "Table"],
  ["```chart\ntitle: Scrap (pcs)\nShift 1: 3\n```", "Bar or line chart (type: line)"],
  ["---", "Divider"],
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

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
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
  // Text typed before hydration would never reach React state, so the editor accepts input only once it is live.
  const hydrated = useHydrated();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const photoCaptureRef = useRef<HTMLInputElement>(null);
  const videoCaptureRef = useRef<HTMLInputElement>(null);
  const filePickerRef = useRef<HTMLInputElement>(null);
  const markdownFileRef = useRef<HTMLInputElement>(null);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const [mode, setMode] = useState<EditorMode>("write");
  const [calloutMenuOpen, setCalloutMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [linkDialog, setLinkDialog] = useState<{ text: string; url: string; error: string } | null>(null);
  const [chartOpen, setChartOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ name: string; percent: number; index: number; total: number } | null>(null);
  const savedSelectionRef = useRef<MarkdownEditState | null>(null);
  const closeCalloutMenu = useCallback(() => setCalloutMenuOpen(false), []);
  const closeMoreMenu = useCallback(() => setMoreMenuOpen(false), []);
  const calloutMenuRef = useDismiss(calloutMenuOpen, closeCalloutMenu);
  const moreMenuRef = useDismiss(moreMenuOpen, closeMoreMenu);

  useEffect(() => () => uploadControllerRef.current?.abort(), []);

  useEffect(() => {
    let preferred: EditorMode | null = null;
    try {
      const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
      if (stored === "write" || stored === "split" || stored === "preview") preferred = stored;
    } catch {
      preferred = null;
    }
    const initial = preferred ?? (window.matchMedia("(min-width: 1280px)").matches ? "split" : "write");
    // Split view needs room; narrow screens fall back to writing with a Preview tab.
    const next = initial === "split" && !window.matchMedia("(min-width: 768px)").matches ? "write" : initial;
    const frame = window.requestAnimationFrame(() => setMode(next));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function chooseMode(next: EditorMode) {
    setMode(next);
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // Preference storage is optional.
    }
    if (next !== "preview") window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  useEffect(() => {
    if (focusRequestKey <= 0) return;
    // Validation can request focus while the preview is showing; switch back to writing first.
    let innerFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      setMode((current) => (current === "preview" ? "write" : current));
      innerFrame = window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(innerFrame);
    };
  }, [focusRequestKey]);

  // Grow with the content up to most of the viewport, then scroll.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || mode === "preview") return;
    textarea.style.height = "auto";
    const limit = Math.max(320, Math.round(window.innerHeight * 0.72));
    textarea.style.height = `${Math.min(textarea.scrollHeight + 2, limit)}px`;
  }, [value, mode]);

  // Uploads finish asynchronously, possibly while the preview is showing, so they read the latest props.
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  }, [value, onChange]);

  const readState = useCallback((): MarkdownEditState => {
    const textarea = textareaRef.current;
    if (!textarea) return { value: valueRef.current, start: valueRef.current.length, end: valueRef.current.length };
    return { value: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd };
  }, []);

  /** Applies an edit as one native, undoable change and restores the intended selection. */
  const applyEdit = useCallback((next: MarkdownEditState, options: { focus?: boolean } = {}) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      valueRef.current = next.value;
      onChangeRef.current(next.value);
      return;
    }
    const shouldFocus = options.focus !== false || document.activeElement === textarea;
    const previous = textarea.value;
    if (next.value !== previous) {
      let applied = false;
      if (shouldFocus) {
        let prefix = 0;
        const shortest = Math.min(previous.length, next.value.length);
        while (prefix < shortest && previous[prefix] === next.value[prefix]) prefix += 1;
        let suffix = 0;
        while (
          suffix < shortest - prefix
          && previous[previous.length - 1 - suffix] === next.value[next.value.length - 1 - suffix]
        ) suffix += 1;
        const replacement = next.value.slice(prefix, next.value.length - suffix);
        textarea.focus();
        textarea.setSelectionRange(prefix, previous.length - suffix);
        try {
          applied = replacement
            ? document.execCommand("insertText", false, replacement)
            : document.execCommand("delete", false);
        } catch {
          applied = false;
        }
        applied = applied && textarea.value === next.value;
      }
      if (!applied) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(textarea, next.value);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    if (shouldFocus) {
      textarea.focus();
      textarea.setSelectionRange(next.start, next.end);
    }
  }, []);

  const run = useCallback((command: (state: MarkdownEditState) => MarkdownEditState | null) => {
    const next = command(readState());
    if (next) applyEdit(next);
  }, [applyEdit, readState]);

  const replacePlaceholder = useCallback((placeholder: string, replacement: string) => {
    const textarea = textareaRef.current;
    const current = textarea?.value ?? valueRef.current;
    // A failed or cancelled upload removes its placeholder together with the blank line inserted before it.
    const target = replacement
      ? placeholder
      : [`\n\n${placeholder}`, `${placeholder}\n\n`, `\n${placeholder}`, placeholder].find((candidate) => current.includes(candidate)) ?? placeholder;
    const index = current.indexOf(target);
    if (index === -1) return;
    const nextValue = current.slice(0, index) + replacement + current.slice(index + target.length);
    const delta = nextValue.length - current.length;
    const adjust = (position: number) => (position > index ? Math.max(index, position + delta) : position);
    const start = textarea ? adjust(textarea.selectionStart) : nextValue.length;
    const end = textarea ? adjust(textarea.selectionEnd) : nextValue.length;
    applyEdit({ value: nextValue, start, end }, { focus: false });
  }, [applyEdit]);

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
        const token = Math.random().toString(36).slice(2, 10);
        const name = mediaLabel(file.name);
        const placeholder = `[Uploading ${name}…](#upload-${token})`;
        applyEdit(insertMarkdownBlock(readState(), placeholder), { focus: false });
        setUploadProgress({ name: file.name, percent: 0, index: index + 1, total: files.length });
        try {
          let url = await uploadInstructionMedia(file, buildMediaStoragePath(file, kind), {
            signal: controller.signal,
            onProgress: (percent) => setUploadProgress({ name: file.name, percent, index: index + 1, total: files.length }),
          });
          if (!url) throw new Error(`Unable to resolve a public address for ${file.name}.`);
          if (kind === "video" && !isVideoSource(url)) url = `${url}#video`;
          replacePlaceholder(placeholder, `![${name}](${url})`);
        } catch (error) {
          replacePlaceholder(placeholder, "");
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
  }, [applyEdit, onUploadStateChange, readState, replacePlaceholder]);

  function handleFileInput(event: ChangeEvent<HTMLInputElement>, requested?: "image" | "video") {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void uploadFiles(files, requested);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && !event.altKey && !event.shiftKey) {
      const key = event.key.toLowerCase();
      if (key === "b") {
        event.preventDefault();
        run((state) => toggleMarkdownWrap(state, "**", "bold text"));
        return;
      }
      if (key === "i") {
        event.preventDefault();
        run((state) => toggleMarkdownWrap(state, "*", "italic text"));
        return;
      }
      if (key === "k") {
        event.preventDefault();
        openLinkDialog();
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !modifier && !event.altKey) {
      const next = continueMarkdownList(readState());
      if (next) {
        event.preventDefault();
        applyEdit(next);
      }
      return;
    }
    if (event.key === "Tab" && !modifier && !event.altKey) {
      const state = readState();
      const next = indentMarkdownListLine(state, event.shiftKey);
      // Outside lists Tab keeps moving focus, so keyboard users are never trapped in the editor.
      if (next) {
        event.preventDefault();
        if (next.value !== state.value) applyEdit(next);
      }
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const media = Array.from(event.clipboardData.files).filter((file) => getImageMimeType(file) || isSupportedVideoUpload(file));
    if (media.length > 0) {
      event.preventDefault();
      void uploadFiles(media);
      return;
    }
    const html = event.clipboardData.getData("text/html");
    // Structured content from documents and web pages becomes Markdown; plain text pastes unchanged.
    if (html && /<(?:table|ul|ol|h[1-6]|pre)\b|<a\s[^>]*href=/i.test(html)) {
      const markdown = toEditorMarkdown(sanitizeHtmlFragment(html));
      if (markdown.trim()) {
        event.preventDefault();
        run((state) => insertMarkdownText(state, markdown));
      }
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    event.preventDefault();
    void uploadFiles(files);
  }

  function openLinkDialog() {
    const state = readState();
    savedSelectionRef.current = state;
    const selected = state.value.slice(state.start, state.end);
    const isUrl = /^(https?:\/\/|mailto:|tel:)/i.test(selected.trim());
    setLinkDialog({ text: isUrl ? "" : selected, url: isUrl ? selected.trim() : "", error: "" });
  }

  function applyLink() {
    if (!linkDialog) return;
    const url = linkDialog.url.trim();
    if (!/^(https?:\/\/[^\s]+|mailto:[^\s]+|tel:[^\s]+)$/i.test(url)) {
      setLinkDialog({ ...linkDialog, error: "Enter a complete link starting with https://, http://, mailto: or tel:." });
      return;
    }
    const text = linkDialog.text.trim().replace(/[[\]]/g, "") || url;
    const state = savedSelectionRef.current ?? readState();
    setLinkDialog(null);
    window.requestAnimationFrame(() => applyEdit(insertMarkdownText(state, `[${text}](${url.replace(/\)/g, "%29")})`)));
  }

  function insertTable() {
    const header = "| Step | Check | Result |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |";
    run((state) => insertMarkdownBlock(state, header, [2, 6]));
  }

  function insertCallout(option: (typeof CALLOUT_OPTIONS)[number]) {
    setCalloutMenuOpen(false);
    run((state) => insertMarkdownCallout(state, option.kind, option.placeholder));
  }

  function linePrefix(kind: LinePrefixKind) {
    run((state) => toggleMarkdownLinePrefix(state, kind));
  }

  function historyCommand(command: "undo" | "redo") {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    try {
      document.execCommand(command, false);
    } catch {
      setMessage(`Use ${command === "undo" ? "Ctrl+Z" : "Ctrl+Y"} to ${command} in this browser.`);
    }
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
      run((state) => insertMarkdownBlock(state, text));
      setMessage(null);
    } catch {
      setMessage("Unable to read this Markdown file.");
    }
  }

  const deferredValue = useDeferredValue(value);
  const previewHtml = useMemo(() => {
    if (mode === "write" || !deferredValue.trim()) return "";
    try {
      return normalizeVideoMarkupForPlayback(rewriteLoopbackMediaUrlsInHtml(sanitizeRichHtml(deferredValue)));
    } catch {
      return "<p>Preview unavailable for this content.</p>";
    }
  }, [deferredValue, mode]);
  const wordCount = useMemo(() => countMarkdownWords(deferredValue), [deferredValue]);

  function syncPreviewScroll() {
    const textarea = textareaRef.current;
    const preview = previewRef.current;
    if (!textarea || !preview || mode !== "split") return;
    const range = textarea.scrollHeight - textarea.clientHeight;
    const ratio = range > 0 ? textarea.scrollTop / range : 0;
    preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight);
  }

  const uploading = uploadProgress !== null;
  const modeButtons: Array<{ id: EditorMode; label: string; icon: ReactNode; className?: string }> = [
    { id: "write", label: "Write", icon: <PenLine size={16} /> },
    { id: "split", label: "Split", icon: <Columns2 size={16} />, className: "hidden md:inline-flex" },
    { id: "preview", label: "Preview", icon: <Eye size={16} /> },
  ];

  const preview = (
    <div
      ref={previewRef}
      aria-label={`${label} preview`}
      role="region"
      className={cn(
        "md-preview min-w-0 overflow-auto bg-white px-4 py-3 text-base dark:bg-slate-950",
        mode === "split" ? "absolute inset-0" : cn("rounded-b-xl", minHeightClassName),
      )}
    >
      {previewHtml ? (
        <div className="prose-markdown" dangerouslySetInnerHTML={{ __html: previewHtml }} />
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">Nothing to preview yet. Write in Markdown and the formatted result appears here.</p>
      )}
    </div>
  );

  return (
    <div role="group" aria-label={`${label} editor`} className="grid min-w-0 gap-2 text-sm">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="grid gap-0.5">
          <span className="text-sm font-semibold">{label}</span>
          <span id={helpId} className="text-xs text-slate-500 dark:text-slate-400">
            Markdown · press Enter to continue a list · paste or drop photos
          </span>
        </div>
        <div role="group" aria-label="Editor view" className="inline-flex rounded-xl border border-slate-300 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-900">
          {modeButtons.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={mode === option.id}
              onClick={() => chooseMode(option.id)}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-slate-600 transition dark:text-slate-300",
                mode === option.id ? "bg-white text-slate-950 shadow-sm dark:bg-slate-800 dark:text-white" : "hover:text-slate-900 dark:hover:text-white",
                option.className,
              )}
            >
              {option.icon}
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer.types).includes("Files")) {
            event.preventDefault();
            setDragActive(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
        }}
        onDrop={handleDrop}
        className={cn(
          "min-w-0 rounded-xl border bg-white shadow-sm transition dark:bg-slate-950",
          hasError ? "border-rose-500 ring-2 ring-rose-500/25" : "border-slate-300 focus-within:border-cyan-500 focus-within:ring-2 focus-within:ring-cyan-500/20 dark:border-slate-700",
          dragActive ? "border-cyan-500 ring-4 ring-cyan-500/25" : "",
        )}
      >
        {mode !== "preview" ? (
          <div role="toolbar" aria-label={`${label} formatting`} className="flex min-w-0 flex-wrap items-center gap-0.5 rounded-t-xl border-b border-slate-200 bg-slate-50 px-1.5 py-1 dark:border-slate-800 dark:bg-slate-900/70">
            <ToolbarButton label="Heading 2" onClick={() => linePrefix("h2")}><Heading2 size={18} /></ToolbarButton>
            <ToolbarButton label="Heading 3" onClick={() => linePrefix("h3")}><Heading3 size={18} /></ToolbarButton>
            <ToolbarDivider />
            <ToolbarButton label="Bold" shortcut="Ctrl+B" onClick={() => run((state) => toggleMarkdownWrap(state, "**", "bold text"))}><Bold size={18} /></ToolbarButton>
            <ToolbarButton label="Italic" shortcut="Ctrl+I" onClick={() => run((state) => toggleMarkdownWrap(state, "*", "italic text"))}><Italic size={18} /></ToolbarButton>
            <ToolbarButton label="Strikethrough" onClick={() => run((state) => toggleMarkdownWrap(state, "~~", "removed text"))}><Strikethrough size={18} /></ToolbarButton>
            <ToolbarDivider />
            <ToolbarButton label="Numbered list" onClick={() => linePrefix("ordered")}><ListOrdered size={18} /></ToolbarButton>
            <ToolbarButton label="Bulleted list" onClick={() => linePrefix("bullet")}><List size={18} /></ToolbarButton>
            <ToolbarButton label="Checklist" onClick={() => linePrefix("task")}><CheckSquare size={18} /></ToolbarButton>
            <ToolbarButton label="Quote" onClick={() => linePrefix("quote")}><Quote size={18} /></ToolbarButton>
            <ToolbarDivider />
            <div ref={calloutMenuRef} className="relative">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={calloutMenuOpen}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setCalloutMenuOpen((open) => !open)}
                className="inline-flex h-11 items-center gap-1.5 rounded-lg px-2.5 font-semibold text-slate-700 transition hover:bg-slate-200/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 dark:text-slate-200 dark:hover:bg-slate-800"
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
                </div>
              ) : null}
            </div>
            <ToolbarButton label="Link" shortcut="Ctrl+K" onClick={openLinkDialog}><Link2 size={18} /></ToolbarButton>
            <ToolbarButton label="Insert table" onClick={insertTable}><Table2 size={18} /></ToolbarButton>
            <ToolbarButton label="Insert chart" onClick={() => { savedSelectionRef.current = readState(); setChartOpen(true); }}><ChartColumn size={18} /></ToolbarButton>
            <ToolbarButton label="Divider" onClick={() => run((state) => insertMarkdownBlock(state, "---"))}><Minus size={18} /></ToolbarButton>
            <ToolbarDivider />
            <ToolbarButton label="Take photo" disabled={uploading} onClick={() => photoCaptureRef.current?.click()}><Camera size={18} /></ToolbarButton>
            <ToolbarButton label="Record video" disabled={uploading} onClick={() => videoCaptureRef.current?.click()}><Video size={18} /></ToolbarButton>
            <ToolbarButton label="Upload photos or videos" disabled={uploading} onClick={() => filePickerRef.current?.click()}><Upload size={18} /></ToolbarButton>
            <ToolbarDivider />
            <ToolbarButton label="Undo" shortcut="Ctrl+Z" onClick={() => historyCommand("undo")}><Undo2 size={18} /></ToolbarButton>
            <ToolbarButton label="Redo" shortcut="Ctrl+Y" onClick={() => historyCommand("redo")}><Redo2 size={18} /></ToolbarButton>
            {toolbarAfterRedoContent ? <div className="inline-flex items-center px-0.5">{toolbarAfterRedoContent}</div> : null}
            <div ref={moreMenuRef} className="relative">
              <ToolbarButton label="More options" onClick={() => setMoreMenuOpen((open) => !open)}><MoreHorizontal size={18} /></ToolbarButton>
              {moreMenuOpen ? (
                <div role="menu" aria-label="More editor options" className="absolute right-0 top-full z-30 mt-1 grid w-60 gap-0.5 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl sm:left-0 sm:right-auto dark:border-slate-700 dark:bg-slate-900">
                  <button type="button" role="menuitem" onClick={() => { setMoreMenuOpen(false); setGuideOpen(true); }} className="flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"><HelpCircle size={16} />Markdown guide</button>
                  <button type="button" role="menuitem" onClick={() => { setMoreMenuOpen(false); markdownFileRef.current?.click(); }} className="flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"><FileUp size={16} />Import .md file</button>
                  <button type="button" role="menuitem" disabled={!value.trim()} onClick={downloadMarkdown} className="flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-left hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"><FileDown size={16} />Download .md file</button>
                </div>
              ) : null}
            </div>
            {toolbarEndContent ? <div className="ml-auto inline-flex items-center justify-end pl-1">{toolbarEndContent}</div> : null}
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

        <div className={cn("min-w-0", mode === "split" ? "grid grid-cols-2" : "")}>
          {mode !== "preview" ? (
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onScroll={syncPreviewScroll}
              aria-label={label}
              aria-invalid={hasError}
              aria-describedby={helpId}
              readOnly={!hydrated}
              placeholder={placeholder || "## Before you start\n\n> [!CAUTION]\n> Lock out the machine.\n\n1. First step\n2. Next step"}
              spellCheck
              className={cn(
                "md-source block w-full min-w-0 resize-y bg-transparent px-4 py-3 font-mono text-[15px] leading-relaxed text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-600",
                minHeightClassName,
                mode === "split" ? "border-r border-slate-200 dark:border-slate-800" : "rounded-b-xl",
              )}
            />
          ) : null}
          {mode === "split" ? <div className="relative min-w-0">{preview}</div> : null}
          {mode === "preview" ? preview : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500 dark:text-slate-400">
        <button type="button" onClick={() => setGuideOpen(true)} className="inline-flex min-h-8 items-center gap-1 rounded font-medium text-cyan-700 underline-offset-2 hover:underline dark:text-cyan-300">
          <HelpCircle size={14} />
          Markdown guide
        </button>
        <span aria-live="polite">{wordCount} {wordCount === 1 ? "word" : "words"}</span>
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
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setLinkDialog(null)} className="min-h-11 rounded-lg border px-4">Cancel</button>
            <button type="button" onClick={applyLink} className="min-h-11 rounded-lg bg-cyan-700 px-4 font-semibold text-white">Insert link</button>
          </div>
        </EditorDialog>
      ) : null}

      {chartOpen ? (
        <ChartDialog
          onClose={() => setChartOpen(false)}
          onSave={(chart) => {
            const state = savedSelectionRef.current ?? readState();
            window.requestAnimationFrame(() => applyEdit(insertMarkdownBlock(state, serializeChartSource(chart))));
          }}
        />
      ) : null}

      {guideOpen ? (
        <EditorDialog title="Markdown guide" wide onClose={() => setGuideOpen(false)}>
          <p className="text-sm text-slate-600 dark:text-slate-300">Type these patterns, or use the toolbar to insert them. The preview shows exactly what operators will see.</p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900">
                <tr><th scope="col" className="px-3 py-2">You type</th><th scope="col" className="px-3 py-2">You get</th></tr>
              </thead>
              <tbody>
                {GUIDE_ROWS.map(([syntax, result]) => (
                  <tr key={syntax} className="border-t border-slate-200 align-top dark:border-slate-800">
                    <td className="px-3 py-2"><pre className="whitespace-pre-wrap font-mono text-[13px]">{syntax}</pre></td>
                    <td className="px-3 py-2">{result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Shortcuts: Ctrl+B bold · Ctrl+I italic · Ctrl+K link · Tab / Shift+Tab nest list items.</p>
        </EditorDialog>
      ) : null}
    </div>
  );
}
