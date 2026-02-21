"use client";

import { Extension } from "@tiptap/core";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  Heading1,
  Heading2,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Redo2,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (fontSize: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
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

interface RichTextEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeightClassName?: string;
}

interface ToolbarButtonProps {
  ariaLabel: string;
  onClick: () => void;
  children: ReactNode;
  isActive?: boolean;
  disabled?: boolean;
}

const FONT_SIZE_OPTIONS = ["12px", "14px", "16px", "18px", "24px", "32px"];

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
      onMouseDown={(event) => {
        event.preventDefault();
        onClick();
      }}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-50",
        isActive
          ? "border-cyan-500/70 bg-cyan-500/20 text-cyan-800 dark:text-cyan-200"
          : "border-slate-300 bg-white/80 text-slate-700 hover:bg-cyan-500/15 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200",
      )}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({
  label,
  value,
  onChange,
  placeholder,
  minHeightClassName = "min-h-52",
}: RichTextEditorProps) {
  const [, setToolbarRefreshCounter] = useState(0);
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
      FontSize,
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
            "tiptap-editor-content w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950",
            minHeightClassName,
          ),
        },
      },
      onUpdate: ({ editor: nextEditor }) => {
        onChange(nextEditor.getHTML());
      },
      onTransaction: refreshToolbarState,
      onSelectionUpdate: refreshToolbarState,
    },
    [extensions, minHeightClassName, refreshToolbarState],
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

  if (!editor) {
    return (
      <div className="grid gap-1 text-sm">
        <span className="font-semibold">{label}</span>
        <div
          className={cn(
            "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950",
            minHeightClassName,
          )}
        />
      </div>
    );
  }

  const activeFontSize = (editor.getAttributes("textStyle").fontSize as string) || "16px";
  const activeColor = (editor.getAttributes("textStyle").color as string) || "#0f172a";
  const runAndRefresh = (command: () => void) => {
    command();
    refreshToolbarState();
  };

  return (
    <div className="grid gap-1 text-sm">
      <span className="font-semibold">{label}</span>

      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-300 bg-slate-100/70 p-2 dark:border-slate-700 dark:bg-slate-900/60">
        <ToolbarButton
          ariaLabel="Bold"
          onClick={() => runAndRefresh(() => editor.chain().focus().toggleBold().run())}
          isActive={editor.isActive("bold")}
        >
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Italic"
          onClick={() => runAndRefresh(() => editor.chain().focus().toggleItalic().run())}
          isActive={editor.isActive("italic")}
        >
          <Italic size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Underline"
          onClick={() => runAndRefresh(() => editor.chain().focus().toggleUnderline().run())}
          isActive={editor.isActive("underline")}
        >
          <UnderlineIcon size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Strikethrough"
          onClick={() => runAndRefresh(() => editor.chain().focus().toggleStrike().run())}
          isActive={editor.isActive("strike")}
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
          onClick={() =>
            runAndRefresh(() => editor.chain().focus().toggleBulletList().run())
          }
          isActive={editor.isActive("bulletList")}
        >
          <List size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Numbered List"
          onClick={() =>
            runAndRefresh(() => editor.chain().focus().toggleOrderedList().run())
          }
          isActive={editor.isActive("orderedList")}
        >
          <ListOrdered size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Task List"
          onClick={() => runAndRefresh(() => editor.chain().focus().toggleTaskList().run())}
          isActive={editor.isActive("taskList")}
        >
          <ListOrdered size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Block Quote"
          onClick={() =>
            runAndRefresh(() => editor.chain().focus().toggleBlockquote().run())
          }
          isActive={editor.isActive("blockquote")}
        >
          <Quote size={14} />
        </ToolbarButton>
        <ToolbarButton
          ariaLabel="Highlight"
          onClick={() => runAndRefresh(() => editor.chain().focus().toggleHighlight().run())}
          isActive={editor.isActive("highlight")}
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
          onChange={(event) => {
            const selected = event.target.value;
            if (selected === "default") {
              runAndRefresh(() => editor.chain().focus().unsetFontSize().run());
              return;
            }

            runAndRefresh(() => editor.chain().focus().setFontSize(selected).run());
          }}
          className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
        >
          <option value="default">Default</option>
          {FONT_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>

        <input
          type="color"
          value={activeColor}
          onChange={(event) =>
            runAndRefresh(() => editor.chain().focus().setColor(event.target.value).run())
          }
          aria-label="Text color"
          className="h-8 w-10 cursor-pointer rounded border border-slate-300 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-950"
        />

        <ToolbarButton
          ariaLabel="Clear Formatting"
          onClick={() =>
            runAndRefresh(() =>
              editor.chain().focus().unsetColor().unsetHighlight().unsetAllMarks().run(),
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
      </div>

      <EditorContent editor={editor} />
    </div>
  );
}
