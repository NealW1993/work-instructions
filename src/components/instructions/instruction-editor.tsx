"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UploadCloud } from "lucide-react";

import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn, escapeLikeQuery } from "@/lib/utils";

interface InstructionEditorProps {
  mode: "create" | "edit" | "fork";
  initialData?: {
    instructionId?: string;
    sourceInstructionId?: string;
    workItemId?: string;
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

interface FieldErrors {
  partOrMold: boolean;
  itemTitle: boolean;
  body: boolean;
}

const DEFAULT_FIELD_ERRORS: FieldErrors = {
  partOrMold: false,
  itemTitle: false,
  body: false,
};

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

function normalizeSubmissionError(error: unknown) {
  return error instanceof Error ? error.message : "Save failed";
}

export function InstructionEditor({ mode, initialData }: InstructionEditorProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [partNumber, setPartNumber] = useState(initialData?.partNumber ?? "");
  const [moldNumber, setMoldNumber] = useState(initialData?.moldNumber ?? "");
  const [partSuggestions, setPartSuggestions] = useState<WorkItemSearchResult[]>([]);
  const [moldSuggestions, setMoldSuggestions] = useState<WorkItemSearchResult[]>([]);
  const [partSearchBusy, setPartSearchBusy] = useState(false);
  const [moldSearchBusy, setMoldSearchBusy] = useState(false);
  const [partSearchOpen, setPartSearchOpen] = useState(false);
  const [moldSearchOpen, setMoldSearchOpen] = useState(false);

  const [workItemId, setWorkItemId] = useState<string | null>(
    mode === "edit" ? (initialData?.workItemId ?? null) : null,
  );
  const [itemTitle, setItemTitle] = useState(initialData?.itemTitle ?? "");
  const [bodyMarkdown, setBodyMarkdown] = useState(
    normalizeEditorContent(initialData?.bodyMarkdown ?? ""),
  );
  const [revision, setRevision] = useState(initialData?.revision ?? 1);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(DEFAULT_FIELD_ERRORS);
  const [bodyFocusRequestKey, setBodyFocusRequestKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const partInputRef = useRef<HTMLInputElement | null>(null);
  const moldInputRef = useRef<HTMLInputElement | null>(null);
  const itemTitleInputRef = useRef<HTMLInputElement | null>(null);

  const initialForkSnapshot = useMemo(() => {
    if (mode !== "fork" || !initialData) {
      return null;
    }

    return {
      partNumber: initialData.partNumber.trim(),
      moldNumber: initialData.moldNumber.trim(),
      itemTitle: initialData.itemTitle.trim(),
      bodyMarkdown: normalizeEditorContent(initialData.bodyMarkdown),
      revision: initialData.revision,
    };
  }, [initialData, mode]);

  useEffect(() => {
    const query = partNumber.trim();
    if (query.length < 2) {
      setPartSuggestions([]);
      setPartSearchBusy(false);
      return;
    }

    let isActive = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        setPartSearchBusy(true);
        try {
          const safeQuery = escapeLikeQuery(query);
          const { data, error: searchError } = await supabase
            .from("work_items")
            .select("id, part_number, mold_number, item_title")
            .ilike("part_number", `%${safeQuery}%`)
            .order("updated_at", { ascending: false })
            .limit(8);

          if (!isActive) {
            return;
          }

          if (searchError) {
            throw searchError;
          }

          setPartSuggestions((data ?? []) as WorkItemSearchResult[]);
        } catch {
          if (!isActive) {
            return;
          }

          setPartSuggestions([]);
        } finally {
          if (isActive) {
            setPartSearchBusy(false);
          }
        }
      })();
    }, 200);

    return () => {
      isActive = false;
      window.clearTimeout(timer);
    };
  }, [partNumber, supabase]);

  useEffect(() => {
    const query = moldNumber.trim();
    if (query.length < 2) {
      setMoldSuggestions([]);
      setMoldSearchBusy(false);
      return;
    }

    let isActive = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        setMoldSearchBusy(true);
        try {
          const safeQuery = escapeLikeQuery(query);
          const { data, error: searchError } = await supabase
            .from("work_items")
            .select("id, part_number, mold_number, item_title")
            .ilike("mold_number", `%${safeQuery}%`)
            .order("updated_at", { ascending: false })
            .limit(8);

          if (!isActive) {
            return;
          }

          if (searchError) {
            throw searchError;
          }

          setMoldSuggestions((data ?? []) as WorkItemSearchResult[]);
        } catch {
          if (!isActive) {
            return;
          }

          setMoldSuggestions([]);
        } finally {
          if (isActive) {
            setMoldSearchBusy(false);
          }
        }
      })();
    }, 200);

    return () => {
      isActive = false;
      window.clearTimeout(timer);
    };
  }, [moldNumber, supabase]);

  function applySuggestedWorkItem(result: WorkItemSearchResult) {
    setPartNumber(result.part_number);
    setMoldNumber(result.mold_number);
    setItemTitle(result.item_title);
    setWorkItemId(result.id);
    setPartSearchOpen(false);
    setMoldSearchOpen(false);
    setFieldErrors((current) => ({
      ...current,
      partOrMold: false,
      itemTitle: false,
    }));
  }

  function setPartOrMoldErrorAndFocus() {
    setFieldErrors((current) => ({
      ...current,
      partOrMold: true,
    }));
    partInputRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setBusy(true);
    setMessage(null);
    setError(null);
    setFieldErrors(DEFAULT_FIELD_ERRORS);

    const normalizedPartNumber = partNumber.trim();
    const normalizedMoldNumber = moldNumber.trim();

    if (mode === "fork" && initialForkSnapshot) {
      const forkUnchanged =
        normalizedPartNumber === initialForkSnapshot.partNumber &&
        normalizedMoldNumber === initialForkSnapshot.moldNumber &&
        itemTitle.trim() === initialForkSnapshot.itemTitle &&
        bodyMarkdown === initialForkSnapshot.bodyMarkdown &&
        revision === initialForkSnapshot.revision;

      if (forkUnchanged) {
        setMessage("No changes detected. Fork canceled.");
        if (initialData?.sourceInstructionId) {
          router.push(`/instructions/${initialData.sourceInstructionId}`);
          router.refresh();
        }
        setBusy(false);
        return;
      }
    }

    if (!normalizedPartNumber && !normalizedMoldNumber) {
      setPartOrMoldErrorAndFocus();
      setError("Part # or Mold # is required.");
      setBusy(false);
      return;
    }

    if (!itemTitle.trim()) {
      setFieldErrors((current) => ({
        ...current,
        itemTitle: true,
      }));
      setError("Work item title is required.");
      itemTitleInputRef.current?.focus();
      setBusy(false);
      return;
    }

    if (!richTextToPlain(bodyMarkdown)) {
      setFieldErrors((current) => ({
        ...current,
        body: true,
      }));
      setError("Instruction steps are required.");
      setBodyFocusRequestKey((current) => current + 1);
      setBusy(false);
      return;
    }

    try {
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

      if (mode !== "fork") {
        let duplicateCheckRequest = supabase
          .from("work_instructions")
          .select("id")
          .eq("work_item_id", typedWorkItem.id)
          .limit(1);

        if (mode === "edit" && initialData?.instructionId) {
          duplicateCheckRequest = duplicateCheckRequest.neq("id", initialData.instructionId);
        }

        const { data: duplicateInstruction, error: duplicateCheckError } =
          await duplicateCheckRequest.maybeSingle();

        if (duplicateCheckError) {
          throw new Error(duplicateCheckError.message);
        }

        if (duplicateInstruction) {
          setFieldErrors((current) => ({
            ...current,
            itemTitle: true,
          }));
          itemTitleInputRef.current?.focus();
          throw new Error(
            "A work instruction with this title already exists for this Part/Mold. Open the existing instruction to edit it.",
          );
        }
      }

      let instructionId = initialData?.instructionId ?? "";

      if (mode === "create" || mode === "fork") {
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
        mode === "edit"
          ? "Instruction updated successfully."
          : mode === "fork"
            ? "Instruction fork created successfully."
            : "Instruction created successfully.",
      );

      router.push(`/instructions/${instructionId}`);
      router.refresh();
    } catch (caughtError) {
      setError(normalizeSubmissionError(caughtError));
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
        className="grid min-w-0 gap-5 overflow-hidden rounded-3xl border border-white/30 bg-white/75 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7"
      >
        <div className="grid gap-3 md:grid-cols-2 md:gap-4">
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold">Part #</span>
            <div className="relative">
              <input
                ref={partInputRef}
                value={partNumber}
                placeholder="Example: PART-123"
                onFocus={() => {
                  if (partSuggestions.length > 0) {
                    setPartSearchOpen(true);
                  }
                }}
                onBlur={() => {
                  window.setTimeout(() => setPartSearchOpen(false), 120);
                }}
                onChange={(event) => {
                  setPartNumber(event.target.value);
                  setPartSearchOpen(true);
                  setWorkItemId(null);
                  if (fieldErrors.partOrMold) {
                    setFieldErrors((current) => ({
                      ...current,
                      partOrMold: false,
                    }));
                  }
                }}
                className={cn(
                  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950",
                  fieldErrors.partOrMold ? "border-rose-500 ring-2 ring-rose-500/30" : "",
                )}
              />
              {partSearchOpen ? (
                <div className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-20 max-h-60 overflow-auto rounded-xl border border-slate-300 bg-white/95 p-1 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-950/95">
                  {partSearchBusy ? (
                    <p className="px-2 py-2 text-xs text-slate-500 dark:text-slate-300">
                      Searching...
                    </p>
                  ) : partSuggestions.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-slate-500 dark:text-slate-300">
                      No part matches.
                    </p>
                  ) : (
                    partSuggestions.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          applySuggestedWorkItem(result);
                        }}
                        className="grid w-full gap-0.5 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-cyan-500/10"
                      >
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          {result.part_number}
                        </span>
                        <span className="text-slate-500 dark:text-slate-300">
                          {summarizePartMold(result.part_number, result.mold_number)} |{" "}
                          {result.item_title}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold">Mold #</span>
            <div className="relative">
              <input
                ref={moldInputRef}
                value={moldNumber}
                placeholder="Example: MOLD-4"
                onFocus={() => {
                  if (moldSuggestions.length > 0) {
                    setMoldSearchOpen(true);
                  }
                }}
                onBlur={() => {
                  window.setTimeout(() => setMoldSearchOpen(false), 120);
                }}
                onChange={(event) => {
                  setMoldNumber(event.target.value);
                  setMoldSearchOpen(true);
                  setWorkItemId(null);
                  if (fieldErrors.partOrMold) {
                    setFieldErrors((current) => ({
                      ...current,
                      partOrMold: false,
                    }));
                  }
                }}
                className={cn(
                  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950",
                  fieldErrors.partOrMold ? "border-rose-500 ring-2 ring-rose-500/30" : "",
                )}
              />
              {moldSearchOpen ? (
                <div className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-20 max-h-60 overflow-auto rounded-xl border border-slate-300 bg-white/95 p-1 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-950/95">
                  {moldSearchBusy ? (
                    <p className="px-2 py-2 text-xs text-slate-500 dark:text-slate-300">
                      Searching...
                    </p>
                  ) : moldSuggestions.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-slate-500 dark:text-slate-300">
                      No mold matches.
                    </p>
                  ) : (
                    moldSuggestions.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          applySuggestedWorkItem(result);
                        }}
                        className="grid w-full gap-0.5 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-cyan-500/10"
                      >
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          {result.mold_number || "N/A"}
                        </span>
                        <span className="text-slate-500 dark:text-slate-300">
                          {summarizePartMold(result.part_number, result.mold_number)} |{" "}
                          {result.item_title}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </label>
        </div>

        <div className="grid gap-3 md:max-w-3xl md:grid-cols-[minmax(0,1fr)_140px] md:items-end md:gap-4">
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold">Work Item Title</span>
            <input
              ref={itemTitleInputRef}
              required
              placeholder="Example: Daily Setup Sequence"
              value={itemTitle}
              onChange={(event) => {
                setItemTitle(event.target.value);
                setWorkItemId(null);
                if (fieldErrors.itemTitle) {
                  setFieldErrors((current) => ({
                    ...current,
                    itemTitle: false,
                  }));
                }
              }}
              className={cn(
                "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950",
                fieldErrors.itemTitle ? "border-rose-500 ring-2 ring-rose-500/30" : "",
              )}
            />
          </label>

          <label className="grid min-w-0 gap-1.5 text-sm">
            <span className="font-semibold">Revision</span>
            <input
              required
              min={1}
              type="number"
              value={revision}
              onChange={(event) => setRevision(Number.parseInt(event.target.value || "1", 10))}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
        </div>

        <RichTextEditor
          label="Work Instructions (Rich Text)"
          value={bodyMarkdown}
          onChange={(nextValue) => {
            setBodyMarkdown(nextValue);
            if (fieldErrors.body && richTextToPlain(nextValue)) {
              setFieldErrors((current) => ({
                ...current,
                body: false,
              }));
            }
          }}
          placeholder="Type work instructions here. Use toolbar buttons for formatting and inline media."
          minHeightClassName="min-h-72"
          hasError={fieldErrors.body}
          focusRequestKey={bodyFocusRequestKey}
        />

        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
          {mode === "edit"
            ? "Save Changes"
            : mode === "fork"
              ? "Create Fork"
              : "Create Instruction"}
        </button>
      </form>
    </div>
  );
}
