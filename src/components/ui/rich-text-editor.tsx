"use client";

import { Extension, mergeAttributes, Node } from "@tiptap/core";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import {
  EditorContent,
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  CheckSquare,
  Eraser,
  GripVertical,
  Heading1,
  Heading2,
  Highlighter,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  MoveDiagonal2,
  Pilcrow,
  Quote,
  Redo2,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
  Video,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  getUnsupportedVideoUploadMessage,
  inferVideoMimeType,
  isMobileSafeVideoUpload,
} from "@/lib/video";
import { cn, sanitizeFileName } from "@/lib/utils";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (fontSize: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
    resizableImage: {
      setResizableImage: (options: {
        src: string;
        alt?: string;
        width?: number;
        align?: MediaAlign;
      }) => ReturnType;
    };
    resizableVideo: {
      setResizableVideo: (options: {
        src: string;
        mimeType?: string | null;
        width?: number;
        align?: MediaAlign;
      }) => ReturnType;
    };
  }
}

interface RichTextEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeightClassName?: string;
  hasError?: boolean;
  focusRequestKey?: number;
  toolbarAfterRedoContent?: ReactNode;
  toolbarEndContent?: ReactNode;
  aboveEditorContent?: ReactNode;
}

interface ToolbarButtonProps {
  ariaLabel: string;
  onClick: () => void;
  children: ReactNode;
  isActive?: boolean;
  disabled?: boolean;
}

type MediaAlign = "left" | "center" | "right";

const FONT_SIZE_OPTIONS = ["12px", "14px", "16px", "18px", "24px", "32px"];
const DEFAULT_MEDIA_WIDTH = 520;
const MIN_MEDIA_WIDTH = 180;
const MAX_MEDIA_WIDTH = 1200;
const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_INLINE_VIDEO_BYTES = 1024 * 1024 * 1024;
const TAB_INDENT_CONTENT = "\u00a0\u00a0\u00a0\u00a0";

function clampColorChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toHexColor(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map((channel) => clampColorChannel(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function normalizeColorInputValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const hexMatch = value.trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (hexMatch) {
    const rawHex = hexMatch[1].toLowerCase();
    if (rawHex.length === 3) {
      return `#${rawHex
        .split("")
        .map((digit) => `${digit}${digit}`)
        .join("")}`;
    }

    if (rawHex.length === 8) {
      return `#${rawHex.slice(0, 6)}`;
    }

    return `#${rawHex}`;
  }

  const rgbMatch = value
    .trim()
    .match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*[0-9.]+\s*)?\)$/i);
  if (rgbMatch) {
    const red = Number.parseFloat(rgbMatch[1]);
    const green = Number.parseFloat(rgbMatch[2]);
    const blue = Number.parseFloat(rgbMatch[3]);
    if (Number.isFinite(red) && Number.isFinite(green) && Number.isFinite(blue)) {
      return toHexColor(red, green, blue);
    }
  }

  return null;
}

function clampMediaWidth(width: number) {
  return Math.max(MIN_MEDIA_WIDTH, Math.min(MAX_MEDIA_WIDTH, Math.round(width)));
}

function normalizeMediaAlign(value: string | null | undefined): MediaAlign {
  if (value === "left" || value === "right") {
    return value;
  }

  return "center";
}

function parseNumericWidth(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value.replace("px", ""), 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function getAlignMargins(align: MediaAlign) {
  if (align === "left") {
    return { marginLeft: "0", marginRight: "auto" };
  }

  if (align === "right") {
    return { marginLeft: "auto", marginRight: "0" };
  }

  return { marginLeft: "auto", marginRight: "auto" };
}

function getMediaFigureStyle(width: number, align: MediaAlign): string {
  const margins = getAlignMargins(align);
  return [
    `width:${width}px`,
    "max-width:100%",
    "display:block",
    `margin-left:${margins.marginLeft}`,
    `margin-right:${margins.marginRight}`,
  ].join(";");
}

function getMediaWidthFromElement(element: HTMLElement): number {
  const directWidth =
    parseNumericWidth(element.getAttribute("data-width")) ??
    parseNumericWidth(element.style.width || null) ??
    parseNumericWidth(element.getAttribute("width"));

  if (directWidth) {
    return clampMediaWidth(directWidth);
  }

  const nestedMedia = element.querySelector("img,video");
  if (nestedMedia instanceof HTMLElement) {
    const nestedWidth =
      parseNumericWidth(nestedMedia.getAttribute("data-width")) ??
      parseNumericWidth(nestedMedia.style.width || null) ??
      parseNumericWidth(nestedMedia.getAttribute("width"));

    if (nestedWidth) {
      return clampMediaWidth(nestedWidth);
    }
  }

  return DEFAULT_MEDIA_WIDTH;
}

function buildMediaStoragePath(file: File, mediaType: "image" | "video") {
  const safeName = sanitizeFileName(file.name || `${mediaType}.bin`);
  const uniqueId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const dateFolder = new Date().toISOString().slice(0, 10);

  return `inline/${mediaType}/${dateFolder}/${uniqueId}-${safeName}`;
}

function ToolbarButton({
  ariaLabel,
  onClick,
  children,
  isActive,
  disabled,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-50",
        isActive
          ? "border-cyan-500/70 bg-cyan-500/20 text-cyan-800 dark:text-cyan-200"
          : "border-slate-300 bg-white/80 text-slate-700 hover:bg-cyan-500/15 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200",
      )}
    >
      {children}
    </button>
  );
}

function MediaNodeView({ node, selected, updateAttributes, deleteNode }: NodeViewProps) {
  const mediaType: "image" | "video" =
    node.type.name === "resizableVideo" ? "video" : "image";
  const src = String(node.attrs.src ?? "");
  const alt = String(node.attrs.alt ?? "");
  const width = clampMediaWidth(Number(node.attrs.width ?? DEFAULT_MEDIA_WIDTH));
  const align = normalizeMediaAlign(node.attrs.align as string | undefined);
  const inferredVideoMimeType =
    mediaType === "video"
      ? inferVideoMimeType(String(node.attrs.mimeType ?? "")) ?? inferVideoMimeType(src)
      : null;

  const setAlign = (nextAlign: MediaAlign) => {
    updateAttributes({ align: nextAlign });
  };

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const pointerId = event.pointerId;
    const resizeHandleElement = event.currentTarget;
    const startX = event.clientX;
    const startWidth = width;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }

      moveEvent.preventDefault();
      const deltaX = moveEvent.clientX - startX;
      const nextWidth = clampMediaWidth(startWidth + deltaX);
      updateAttributes({ width: nextWidth });
    };

    const handlePointerEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) {
        return;
      }

      if (resizeHandleElement.hasPointerCapture(pointerId)) {
        resizeHandleElement.releasePointerCapture(pointerId);
      }

      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };

    resizeHandleElement.setPointerCapture(pointerId);
    window.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
  };

  const alignClassName =
    align === "left" ? "mr-auto" : align === "right" ? "ml-auto" : "mx-auto";

  return (
    <NodeViewWrapper
      as="figure"
      data-type={mediaType === "image" ? "resizable-image" : "resizable-video"}
      data-width={width}
      data-align={align}
      className={cn("group relative my-3 max-w-full", alignClassName)}
      style={{ width: `${width}px`, maxWidth: "100%" }}
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-lg border border-slate-300/70 bg-slate-900/10 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/40",
          selected ? "ring-2 ring-cyan-500/70" : "",
        )}
      >
        <button
          type="button"
          aria-label="Drag media"
          title="Drag media"
          contentEditable={false}
          data-drag-handle
          onMouseDown={(event) => event.preventDefault()}
          className="pointer-events-none absolute left-2 top-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/40 bg-slate-950/70 text-white opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
        >
          <GripVertical size={14} />
        </button>

        {mediaType === "video" ? (
          <video
            controls
            playsInline
            contentEditable={false}
            preload="metadata"
            src={src}
            className="block h-auto w-full bg-black"
          >
            <source src={src} type={inferredVideoMimeType ?? undefined} />
            Video playback unavailable on this device.
          </video>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt || "Inline media"} className="block h-auto w-full" />
        )}

        <div
          contentEditable={false}
          className="pointer-events-none absolute right-2 top-2 z-20 flex items-center gap-1 rounded-md border border-white/40 bg-slate-950/70 p-1 text-white opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
        >
          <button
            type="button"
            aria-label="Align media left"
            title="Align left"
            onMouseDown={(event) => {
              event.preventDefault();
              setAlign("left");
            }}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded",
              align === "left" ? "bg-cyan-500/60" : "hover:bg-white/20",
            )}
          >
            <AlignLeft size={14} />
          </button>
          <button
            type="button"
            aria-label="Align media center"
            title="Align center"
            onMouseDown={(event) => {
              event.preventDefault();
              setAlign("center");
            }}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded",
              align === "center" ? "bg-cyan-500/60" : "hover:bg-white/20",
            )}
          >
            <AlignCenter size={14} />
          </button>
          <button
            type="button"
            aria-label="Align media right"
            title="Align right"
            onMouseDown={(event) => {
              event.preventDefault();
              setAlign("right");
            }}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded",
              align === "right" ? "bg-cyan-500/60" : "hover:bg-white/20",
            )}
          >
            <AlignRight size={14} />
          </button>
        </div>

        <button
          type="button"
          contentEditable={false}
          aria-label="Resize media"
          title="Drag left or right to resize"
          onPointerDown={startResize}
          className={cn(
            "pointer-events-none absolute -right-4 top-1/2 z-30 inline-flex h-11 w-11 -translate-y-1/2 touch-none items-center justify-center rounded-full border border-white/55 bg-slate-950/80 text-white opacity-0 shadow-lg transition",
            selected
              ? "pointer-events-auto opacity-100"
              : "group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
          )}
        >
          <MoveDiagonal2 size={16} />
        </button>

        <button
          type="button"
          contentEditable={false}
          aria-label={`Delete ${mediaType}`}
          title="Delete media"
          onMouseDown={(event) => {
            event.preventDefault();
            deleteNode();
          }}
          className="absolute bottom-2 right-2 z-30 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/55 bg-rose-600/90 text-white shadow-lg transition hover:bg-rose-500"
        >
          <X size={16} />
        </button>
      </div>
    </NodeViewWrapper>
  );
}

const FontSize = Extension.create({
  name: "fontSize",

  addOptions() {
    return {
      types: ["textStyle"],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) {
                return {};
              }

              return {
                style: `font-size: ${attributes.fontSize}`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (fontSize: string) =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

const TabIndent = Extension.create({
  name: "tabIndent",

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const editor = this.editor;

        if (editor.isActive("listItem")) {
          return editor.commands.sinkListItem("listItem");
        }

        if (editor.isActive("taskItem")) {
          return editor.commands.sinkListItem("taskItem");
        }

        return editor.commands.insertContent(TAB_INDENT_CONTENT);
      },
      "Shift-Tab": () => {
        const editor = this.editor;

        if (editor.isActive("listItem")) {
          return editor.commands.liftListItem("listItem");
        }

        if (editor.isActive("taskItem")) {
          return editor.commands.liftListItem("taskItem");
        }

        return false;
      },
    };
  },
});

const ResizableImage = Node.create({
  name: "resizableImage",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: "",
        parseHTML: (element: HTMLElement) => {
          if (element.tagName === "IMG") {
            return element.getAttribute("src") ?? "";
          }

          return element.querySelector("img")?.getAttribute("src") ?? "";
        },
      },
      alt: {
        default: "",
        parseHTML: (element: HTMLElement) => {
          if (element.tagName === "IMG") {
            return element.getAttribute("alt") ?? "";
          }

          return element.querySelector("img")?.getAttribute("alt") ?? "";
        },
      },
      width: {
        default: DEFAULT_MEDIA_WIDTH,
        parseHTML: (element: HTMLElement) => getMediaWidthFromElement(element),
      },
      align: {
        default: "center",
        parseHTML: (element: HTMLElement) =>
          normalizeMediaAlign(element.getAttribute("data-align")),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'figure[data-type="resizable-image"]' },
      { tag: "img[src]" },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const src = String(HTMLAttributes.src ?? "");
    const alt = String(HTMLAttributes.alt ?? "");
    const width = clampMediaWidth(Number(HTMLAttributes.width ?? DEFAULT_MEDIA_WIDTH));
    const align = normalizeMediaAlign(String(HTMLAttributes.align ?? "center"));
    const figureAttributes = mergeAttributes(
      {
        "data-type": "resizable-image",
        "data-width": String(width),
        "data-align": align,
        style: getMediaFigureStyle(width, align),
      },
      this.options.HTMLAttributes,
    );

    return [
      "figure",
      figureAttributes,
      [
        "img",
        {
          src,
          alt,
          style: "display:block;width:100%;height:auto;",
        },
      ],
    ];
  },

  addCommands() {
    return {
      setResizableImage:
        (options) =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: {
                src: options.src,
                alt: options.alt ?? "",
                width: clampMediaWidth(options.width ?? DEFAULT_MEDIA_WIDTH),
                align: normalizeMediaAlign(options.align),
              },
            })
            .run(),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(MediaNodeView);
  },
});

const ResizableVideo = Node.create({
  name: "resizableVideo",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: "",
        parseHTML: (element: HTMLElement) => {
          if (element.tagName === "VIDEO") {
            return (
              element.getAttribute("src") ??
              element.querySelector("source")?.getAttribute("src") ??
              ""
            );
          }

          return (
            element.querySelector("video")?.getAttribute("src") ??
            element.querySelector("video source")?.getAttribute("src") ??
            ""
          );
        },
      },
      width: {
        default: DEFAULT_MEDIA_WIDTH,
        parseHTML: (element: HTMLElement) => getMediaWidthFromElement(element),
      },
      align: {
        default: "center",
        parseHTML: (element: HTMLElement) =>
          normalizeMediaAlign(element.getAttribute("data-align")),
      },
      mimeType: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          if (element.tagName === "VIDEO") {
            return (
              element.getAttribute("data-mime-type") ??
              element.querySelector("source")?.getAttribute("type") ??
              inferVideoMimeType(element.getAttribute("src") ?? "")
            );
          }

          return (
            element.getAttribute("data-mime-type") ??
            element.querySelector("source")?.getAttribute("type") ??
            inferVideoMimeType(
              element.querySelector("video")?.getAttribute("src") ??
                element.querySelector("video source")?.getAttribute("src") ??
                "",
            )
          );
        },
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'figure[data-type="resizable-video"]' },
      { tag: "video" },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const src = String(HTMLAttributes.src ?? "");
    const width = clampMediaWidth(Number(HTMLAttributes.width ?? DEFAULT_MEDIA_WIDTH));
    const align = normalizeMediaAlign(String(HTMLAttributes.align ?? "center"));
    const mimeType =
      inferVideoMimeType(String(HTMLAttributes.mimeType ?? "")) ?? inferVideoMimeType(src);
    const figureAttributes = mergeAttributes(
      {
        "data-type": "resizable-video",
        "data-width": String(width),
        "data-align": align,
        ...(mimeType ? { "data-mime-type": mimeType } : {}),
        style: getMediaFigureStyle(width, align),
      },
      this.options.HTMLAttributes,
    );

    return [
      "figure",
      figureAttributes,
      [
        "video",
        {
          controls: "true",
          playsinline: "true",
          preload: "metadata",
          src,
          style: "display:block;width:100%;height:auto;",
        },
        ["source", {
          src,
          ...(mimeType ? { type: mimeType } : {}),
        }],
        "Video playback unavailable on this device.",
      ],
    ];
  },

  addCommands() {
    return {
      setResizableVideo:
        (options) =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: {
                src: options.src,
                mimeType:
                  inferVideoMimeType(options.mimeType ?? "") ?? inferVideoMimeType(options.src),
                width: clampMediaWidth(options.width ?? DEFAULT_MEDIA_WIDTH),
                align: normalizeMediaAlign(options.align),
              },
            })
            .run(),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(MediaNodeView);
  },
});

export function RichTextEditor({
  label,
  value,
  onChange,
  placeholder,
  minHeightClassName = "min-h-52",
  hasError = false,
  focusRequestKey = 0,
  toolbarAfterRedoContent,
  toolbarEndContent,
  aboveEditorContent,
}: RichTextEditorProps) {
  const [, setToolbarRefreshCounter] = useState(0);
  const [toolbarMessage, setToolbarMessage] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const colorInputRef = useRef<HTMLInputElement | null>(null);
  const selectionRangeRef = useRef<{ from: number; to: number } | null>(null);
  const [lastPickedColor, setLastPickedColor] = useState("#dbeafe");
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const refreshToolbarState = useCallback(() => {
    setToolbarRefreshCounter((current) => current + 1);
  }, []);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({
        multicolor: true,
      }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "Start typing...",
      }),
      TabIndent,
      FontSize,
      ResizableImage,
      ResizableVideo,
    ],
    [placeholder],
  );

  const editor = useEditor(
    {
      extensions,
      content: value || "",
      editorProps: {
        attributes: {
          class: cn(
            "tiptap-editor-content w-full max-w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950 resize-y overflow-auto",
            hasError
              ? "border-rose-500 ring-2 ring-rose-500/30 focus:border-rose-500 focus:ring-rose-500/30"
              : "",
            minHeightClassName,
          ),
        },
      },
      onUpdate: ({ editor: nextEditor }) => {
        onChange(nextEditor.getHTML());
      },
      onTransaction: refreshToolbarState,
      onSelectionUpdate: refreshToolbarState,
      onFocus: refreshToolbarState,
      onBlur: refreshToolbarState,
    },
    [extensions, hasError, minHeightClassName, refreshToolbarState],
  );

  useEffect(() => {
    if (!editor) {
      return;
    }

    const currentValue = editor.getHTML();
    if (value !== currentValue) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  }, [editor, value]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    if (focusRequestKey > 0) {
      editor.commands.focus("end");
    }
  }, [editor, focusRequestKey]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const syncSelection = () => {
      const { from, to } = editor.state.selection;
      selectionRangeRef.current = { from, to };
    };

    syncSelection();
    editor.on("selectionUpdate", syncSelection);
    editor.on("transaction", syncSelection);

    return () => {
      editor.off("selectionUpdate", syncSelection);
      editor.off("transaction", syncSelection);
    };
  }, [editor]);

  const insertInlineMedia = useCallback(
    async (event: ChangeEvent<HTMLInputElement>, mediaType: "image" | "video") => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";

      if (!editor || files.length === 0) {
        return;
      }

      setToolbarMessage(null);

      for (const file of files) {
        const sizeLimit = mediaType === "image" ? MAX_INLINE_IMAGE_BYTES : MAX_INLINE_VIDEO_BYTES;
        if (file.size > sizeLimit) {
          setToolbarMessage(
            `${file.name} is too large for inline ${mediaType}. Max size is ${Math.round(
              sizeLimit / (1024 * 1024),
            )}MB.`,
          );
          continue;
        }

        if (mediaType === "video" && !isMobileSafeVideoUpload(file)) {
          setToolbarMessage(getUnsupportedVideoUploadMessage(file.name));
          continue;
        }

        try {
          const storagePath = buildMediaStoragePath(file, mediaType);
          const { error: uploadError } = await supabase.storage
            .from("instruction-media")
            .upload(storagePath, file, {
              cacheControl: "3600",
              upsert: false,
              contentType: file.type || undefined,
            });

          if (uploadError) {
            throw new Error(uploadError.message);
          }

          const { data: publicUrlData } = supabase.storage
            .from("instruction-media")
            .getPublicUrl(storagePath);

          const publicUrl = publicUrlData.publicUrl;
          if (!publicUrl) {
            throw new Error(`Unable to resolve public URL for ${file.name}.`);
          }

          const inserted =
            mediaType === "image"
              ? editor
                  .chain()
                  .focus()
                  .setResizableImage({
                    src: publicUrl,
                    alt: file.name,
                  })
                  .run()
              : editor
                  .chain()
                  .focus()
                  .setResizableVideo({
                    src: publicUrl,
                    mimeType: inferVideoMimeType(file.type) ?? inferVideoMimeType(file.name),
                  })
                  .run();

          if (!inserted) {
            setToolbarMessage(`Unable to insert ${file.name}.`);
          }
        } catch (caughtError) {
          const message =
            caughtError instanceof Error ? caughtError.message : `Unable to read ${file.name}.`;
          setToolbarMessage(message);
        }
      }

      refreshToolbarState();
    },
    [editor, refreshToolbarState, supabase],
  );

  if (!editor) {
    return (
      <div className="grid min-w-0 gap-1 text-sm">
        <span className="font-semibold">{label}</span>
        <div
          className={cn(
            "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950",
            hasError ? "border-rose-500 ring-2 ring-rose-500/30" : "",
            minHeightClassName,
          )}
        />
      </div>
    );
  }

  const hasStoredMark = (markName: string) =>
    Boolean(editor.state.storedMarks?.some((mark) => mark.type.name === markName));
  const isMarkActive = (markName: string) =>
    editor.isActive(markName) || hasStoredMark(markName);

  const activeFontSize = (editor.getAttributes("textStyle").fontSize as string) || "16px";
  const attributeColor = normalizeColorInputValue(
    editor.getAttributes("textStyle").color as string | undefined,
  );
  const activeColor = attributeColor ?? lastPickedColor;
  const runAndRefresh = (command: () => boolean) => {
    if (!editor.isFocused) {
      editor.commands.focus("end");
    }

    command();
    requestAnimationFrame(refreshToolbarState);
  };

  const applyColor = (nextColor: string) => {
    const normalizedColor = normalizeColorInputValue(nextColor);
    if (!normalizedColor) {
      return;
    }

    setLastPickedColor(normalizedColor);

    const fallbackSelection = editor.state.selection;
    const selection = selectionRangeRef.current ?? {
      from: fallbackSelection.from,
      to: fallbackSelection.to,
    };

    runAndRefresh(() =>
      editor
        .chain()
        .focus()
        .setTextSelection({
          from: selection.from,
          to: selection.to,
        })
        .setColor(normalizedColor)
        .run(),
    );
  };

  const applyFontSize = (nextFontSize: string | null) => {
    const fallbackSelection = editor.state.selection;
    const selection = selectionRangeRef.current ?? {
      from: fallbackSelection.from,
      to: fallbackSelection.to,
    };

    runAndRefresh(() => {
      const chain = editor.chain().focus().setTextSelection({
        from: selection.from,
        to: selection.to,
      });

      if (!nextFontSize) {
        return chain.unsetFontSize().run();
      }

      return chain.setFontSize(nextFontSize).run();
    });
  };

  return (
    <div className="grid min-w-0 gap-1 text-sm">
      <span className="font-semibold">{label}</span>

      <div
        className={cn(
          "flex w-full max-w-full min-w-0 flex-wrap items-center gap-1 overflow-x-auto rounded-xl border border-slate-300 bg-slate-100/70 p-2 dark:border-slate-700 dark:bg-slate-900/60",
          hasError ? "border-rose-500" : "",
        )}
      >
        <ToolbarButton
          ariaLabel="Bold"
          onClick={() => runAndRefresh(() => editor.chain().focus().toggleBold().run())}
          isActive={isMarkActive("bold")}
        >
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Italic"
          onClick={() => runAndRefresh(() => editor.chain().focus().toggleItalic().run())}
          isActive={isMarkActive("italic")}
        >
          <Italic size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Underline"
          onClick={() => runAndRefresh(() => editor.chain().focus().toggleUnderline().run())}
          isActive={isMarkActive("underline")}
        >
          <UnderlineIcon size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Strikethrough"
          onClick={() => runAndRefresh(() => editor.chain().focus().toggleStrike().run())}
          isActive={isMarkActive("strike")}
        >
          <Strikethrough size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Heading 1"
          onClick={() =>
            runAndRefresh(() => editor.chain().focus().toggleHeading({ level: 1 }).run())
          }
          isActive={editor.isActive("heading", { level: 1 })}
        >
          <Heading1 size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Heading 2"
          onClick={() =>
            runAndRefresh(() => editor.chain().focus().toggleHeading({ level: 2 }).run())
          }
          isActive={editor.isActive("heading", { level: 2 })}
        >
          <Heading2 size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Paragraph"
          onClick={() => runAndRefresh(() => editor.chain().focus().setParagraph().run())}
          isActive={editor.isActive("paragraph")}
        >
          <Pilcrow size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Bullet List"
          onClick={() => runAndRefresh(() => editor.chain().focus().toggleBulletList().run())}
          isActive={editor.isActive("bulletList")}
        >
          <List size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Numbered List"
          onClick={() => runAndRefresh(() => editor.chain().focus().toggleOrderedList().run())}
          isActive={editor.isActive("orderedList")}
        >
          <ListOrdered size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Task List"
          onClick={() => runAndRefresh(() => editor.chain().focus().toggleTaskList().run())}
          isActive={editor.isActive("taskList")}
        >
          <CheckSquare size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Block Quote"
          onClick={() => runAndRefresh(() => editor.chain().focus().toggleBlockquote().run())}
          isActive={editor.isActive("blockquote")}
        >
          <Quote size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Highlight"
          onClick={() => runAndRefresh(() => editor.chain().focus().toggleHighlight().run())}
          isActive={isMarkActive("highlight")}
        >
          <Highlighter size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Align Left"
          onClick={() => runAndRefresh(() => editor.chain().focus().setTextAlign("left").run())}
          isActive={editor.isActive({ textAlign: "left" })}
        >
          <AlignLeft size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Align Center"
          onClick={() =>
            runAndRefresh(() => editor.chain().focus().setTextAlign("center").run())
          }
          isActive={editor.isActive({ textAlign: "center" })}
        >
          <AlignCenter size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Align Right"
          onClick={() => runAndRefresh(() => editor.chain().focus().setTextAlign("right").run())}
          isActive={editor.isActive({ textAlign: "right" })}
        >
          <AlignRight size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Justify"
          onClick={() =>
            runAndRefresh(() => editor.chain().focus().setTextAlign("justify").run())
          }
          isActive={editor.isActive({ textAlign: "justify" })}
        >
          <AlignJustify size={14} />
        </ToolbarButton>

        <select
          value={activeFontSize}
          onMouseDown={() => {
            const { from, to } = editor.state.selection;
            selectionRangeRef.current = { from, to };
          }}
          onChange={(event) => {
            const selected = event.target.value;
            if (selected === "default") {
              applyFontSize(null);
              return;
            }

            applyFontSize(selected);
          }}
          className="h-8 shrink-0 rounded-lg border border-slate-300 bg-white px-2 text-xs outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
        >
          <option value="default">Default</option>
          {FONT_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>

        <ToolbarButton
          ariaLabel="Text color"
          onClick={() => {
            const { from, to } = editor.state.selection;
            selectionRangeRef.current = { from, to };
            colorInputRef.current?.click();
          }}
        >
          <span
            className="h-4 w-4 rounded border border-white/40"
            style={{ backgroundColor: activeColor }}
          />
        </ToolbarButton>

        <ToolbarButton
          ariaLabel="Insert Image"
          onClick={() => imageInputRef.current?.click()}
        >
          <ImagePlus size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Insert Video"
          onClick={() => videoInputRef.current?.click()}
        >
          <Video size={14} />
        </ToolbarButton>

        <ToolbarButton
          ariaLabel="Clear Formatting"
          onClick={() =>
            runAndRefresh(() =>
              editor
                .chain()
                .focus()
                .unsetColor()
                .unsetHighlight()
                .unsetFontSize()
                .unsetAllMarks()
                .run(),
            )
          }
        >
          <Eraser size={14} />
        </ToolbarButton>

        <ToolbarButton
          ariaLabel="Undo"
          onClick={() => runAndRefresh(() => editor.chain().focus().undo().run())}
          disabled={!editor.can().chain().focus().undo().run()}
        >
          <Undo2 size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Redo"
          onClick={() => runAndRefresh(() => editor.chain().focus().redo().run())}
          disabled={!editor.can().chain().focus().redo().run()}
        >
          <Redo2 size={14} />
        </ToolbarButton>

        {toolbarAfterRedoContent ? (
          <div className="inline-flex items-center">{toolbarAfterRedoContent}</div>
        ) : null}

        {toolbarEndContent ? (
          <div className="ml-auto inline-flex items-center justify-end">{toolbarEndContent}</div>
        ) : null}
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          void insertInlineMedia(event, "image");
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept=".mp4,.m4v,video/mp4,video/x-m4v"
        multiple
        className="hidden"
        onChange={(event) => {
          void insertInlineMedia(event, "video");
        }}
      />
      <input
        ref={colorInputRef}
        type="color"
        value={activeColor}
        className="hidden"
        onChange={(event) => {
          applyColor(event.target.value);
        }}
      />

      {toolbarMessage ? (
        <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          {toolbarMessage}
        </p>
      ) : null}

      {aboveEditorContent ? <div className="grid gap-3">{aboveEditorContent}</div> : null}

      <EditorContent editor={editor} />
    </div>
  );
}
