"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UploadCloud } from "lucide-react";

import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { escapeLikeQuery } from "@/lib/utils";

interface InstructionEditorProps {
  mode: "create" | "edit";
  initialData?: {
    instructionId: string;
    workItemId: string;
    partNumber: string;
    moldNumber: string;
    itemTitle: string;
    bodyMarkdown: string;
    revision: number;
  };
}

interface WorkItemSearchResult {
  id: string;
  part_number: string;
  mold_number: string;
  item_title: string;
}

function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function plainTextToHtml(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function normalizeEditorContent(value: string): string {
  if (!value.trim()) {
    return "";
  }

  if (looksLikeHtml(value)) {
    return value;
  }

  return plainTextToHtml(value);
}

function richTextToPlain(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function summarizePartMold(partNumber: string, moldNumber: string) {
  const part = partNumber.trim();
  const mold = moldNumber.trim();

  if (part && mold) {
    return `${part} | ${mold}`;
  }

  return part || mold || "";
}

export function InstructionEditor({ mode, initialData }: InstructionEditorProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [partNumber, setPartNumber] = useState(initialData?.partNumber ?? "");
  const [moldNumber, setMoldNumber] = useState(initialData?.moldNumber ?? "");
  const [partOrMoldSearch, setPartOrMoldSearch] = useState(
    summarizePartMold(initialData?.partNumber ?? "", initialData?.moldNumber ?? ""),
  );
  const [matchedWorkItems, setMatchedWorkItems] = useState<WorkItemSearchResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const [workItemId, setWorkItemId] = useState<string | null>(
    initialData?.workItemId ?? null,
  );
  const [itemTitle, setItemTitle] = useState(initialData?.itemTitle ?? "");
  const [bodyMarkdown, setBodyMarkdown] = useState(
    normalizeEditorContent(initialData?.bodyMarkdown ?? ""),
  );
  const [revision, setRevision] = useState(initialData?.revision ?? 1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmedQuery = partOrMoldSearch.trim();
    if (trimmedQuery.length < 2) {
      setMatchedWorkItems([]);
      setSearchBusy(false);
      return;
    }

    let isActive = true;
    const timer = setTimeout(() => {
      void (async () => {
        setSearchBusy(true);
        try {
          const safeQuery = escapeLikeQuery(trimmedQuery);
          const { data, error: searchError } = await supabase
            .from("work_items")
            .select("id, part_number, mold_number, item_title")
            .or(`part_number.ilike.%${safeQuery}%,mold_number.ilike.%${safeQuery}%`)
            .order("updated_at", { ascending: false })
            .limit(8);

          if (!isActive) {
            return;
          }

          if (searchError) {
            throw searchError;
          }

          setMatchedWorkItems((data ?? []) as WorkItemSearchResult[]);
          setSearchOpen(true);
        } catch {
          if (!isActive) {
            return;
          }

          setMatchedWorkItems([]);
        } finally {
          if (isActive) {
            setSearchBusy(false);
          }
        }
      })();
    }, 220);

    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [partOrMoldSearch, supabase]);

  function handleSelectWorkItem(result: WorkItemSearchResult) {
    setPartNumber(result.part_number);
    setMoldNumber(result.mold_number);
    setItemTitle(result.item_title);
    setWorkItemId(result.id);
    setPartOrMoldSearch(summarizePartMold(result.part_number, result.mold_number));
    setMatchedWorkItems([]);
    setSearchOpen(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      const normalizedPartNumber = partNumber.trim();
      const normalizedMoldNumber = moldNumber.trim();

      if (!normalizedPartNumber && !normalizedMoldNumber) {
        throw new Error("Part # or Mold # is required.");
      }

      if (!itemTitle.trim()) {
        throw new Error("Work item title is required.");
      }

      if (!richTextToPlain(bodyMarkdown)) {
        throw new Error("Instruction steps are required.");
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("You must be signed in.");
      }

      const workItemPayload: {
        id?: string;
        part_number: string;
        mold_number: string;
        item_title: string;
        created_by: string;
      } = {
        part_number: normalizedPartNumber,
        mold_number: normalizedMoldNumber,
        item_title: itemTitle.trim(),
        created_by: user.id,
      };

      if (workItemId) {
        workItemPayload.id = workItemId;
      }

      const { data: workItem, error: workItemError } = await supabase
        .from("work_items")
        .upsert(workItemPayload, {
          onConflict: "part_number,mold_number,item_title",
        })
        .select("id")
        .single();

      const typedWorkItem = workItem as { id: string } | null;

      if (workItemError || !typedWorkItem) {
        throw new Error(workItemError?.message ?? "Unable to save work item.");
      }

      let instructionId = initialData?.instructionId ?? "";

      if (mode === "create") {
        const { data: insertedInstruction, error: insertInstructionError } = await supabase
          .from("work_instructions")
          .insert({
            work_item_id: typedWorkItem.id,
            body_markdown: bodyMarkdown,
            notes_markdown: "",
            revision,
            created_by: user.id,
            updated_by: user.id,
          })
          .select("id")
          .single();

        const typedInstruction = insertedInstruction as { id: string } | null;

        if (insertInstructionError || !typedInstruction) {
          throw new Error(
            insertInstructionError?.message ?? "Unable to create instruction.",
          );
        }

        instructionId = typedInstruction.id;
      } else {
        const { error: updateInstructionError } = await supabase
          .from("work_instructions")
          .update({
            work_item_id: typedWorkItem.id,
            body_markdown: bodyMarkdown,
            notes_markdown: "",
            revision,
            updated_by: user.id,
          })
          .eq("id", instructionId);

        if (updateInstructionError) {
          throw new Error(updateInstructionError.message);
        }
      }

      setMessage(
        mode === "create"
          ? "Instruction created successfully."
          : "Instruction updated successfully.",
      );

      router.push(`/instructions/${instructionId}`);
      router.refresh();
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Save failed";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-5">
      {message ? (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-200">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      <form
        onSubmit={handleSubmit}
        className="grid min-w-0 gap-4 overflow-hidden rounded-3xl border border-white/30 bg-white/75 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7"
      >
        <div className="grid gap-2">
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Mold # or Part #</span>
            <div className="relative">
              <input
                value={partOrMoldSearch}
                placeholder="Type a part # or mold # to find existing records"
                onFocus={() => {
                  if (matchedWorkItems.length > 0) {
                    setSearchOpen(true);
                  }
                }}
                onBlur={() => {
                  window.setTimeout(() => setSearchOpen(false), 120);
                }}
                onChange={(event) => {
                  setPartOrMoldSearch(event.target.value);
                  setSearchOpen(true);
                }}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
              />
              {searchOpen ? (
                <div className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-20 max-h-60 overflow-auto rounded-xl border border-slate-300 bg-white/95 p-1 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-950/95">
                  {searchBusy ? (
                    <p className="px-2 py-2 text-xs text-slate-500 dark:text-slate-300">
                      Searching...
                    </p>
                  ) : matchedWorkItems.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-slate-500 dark:text-slate-300">
                      No matches yet.
                    </p>
                  ) : (
                    matchedWorkItems.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          handleSelectWorkItem(result);
                        }}
                        className="grid w-full gap-0.5 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-cyan-500/10"
                      >
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          {summarizePartMold(result.part_number, result.mold_number)}
                        </span>
                        <span className="text-slate-500 dark:text-slate-300">
                          {result.item_title}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </label>
          <p className="text-xs text-slate-500 dark:text-slate-300">
            Selecting a match autofills the part, mold, and work item title.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-semibold">Part #</span>
              <input
                value={partNumber}
                placeholder="Example: PART-123"
                onChange={(event) => {
                  setPartNumber(event.target.value);
                  setWorkItemId(null);
                }}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-semibold">Mold #</span>
              <input
                value={moldNumber}
                placeholder="Example: MOLD-4"
                onChange={(event) => {
                  setMoldNumber(event.target.value);
                  setWorkItemId(null);
                }}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
          </div>
        </div>

        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Work Item Title</span>
          <input
            required
            placeholder="Example: Daily Setup Sequence"
            value={itemTitle}
            onChange={(event) => {
              setItemTitle(event.target.value);
              setWorkItemId(null);
            }}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
          />
        </label>

        <label className="grid max-w-[140px] min-w-0 gap-1 text-sm">
          <span className="font-semibold">Revision</span>
          <input
            required
            min={1}
            type="number"
            value={revision}
            onChange={(event) => setRevision(Number.parseInt(event.target.value || "1", 10))}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
          />
        </label>

        <RichTextEditor
          label="Work Instructions (Rich Text)"
          value={bodyMarkdown}
          onChange={setBodyMarkdown}
          placeholder="Type work instructions here. Use toolbar buttons for formatting and inline media."
          minHeightClassName="min-h-72"
        />

        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
          {mode === "create" ? "Create Instruction" : "Save Changes"}
        </button>
      </form>
    </div>
  );
}
