/* eslint-disable @next/next/no-img-element */

"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Trash2, UploadCloud } from "lucide-react";

import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { InstructionMedia } from "@/lib/types";
import { sanitizeFileName } from "@/lib/utils";

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
    media: InstructionMedia[];
  };
}

interface PendingUpload {
  id: string;
  file: File;
  caption: string;
  previewUrl: string;
  mediaType: "image" | "video";
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

function revokePendingUploadPreviews(uploads: PendingUpload[]) {
  for (const upload of uploads) {
    URL.revokeObjectURL(upload.previewUrl);
  }
}

const DEFAULT_PART_NUMBER = "GENERAL";
const DEFAULT_MOLD_NUMBER = "";

export function InstructionEditor({ mode, initialData }: InstructionEditorProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [itemTitle, setItemTitle] = useState(initialData?.itemTitle ?? "");
  const [bodyMarkdown, setBodyMarkdown] = useState(
    normalizeEditorContent(initialData?.bodyMarkdown ?? ""),
  );
  const [revision, setRevision] = useState(initialData?.revision ?? 1);
  const [selectedUploads, setSelectedUploads] = useState<PendingUpload[]>([]);
  const [existingMedia, setExistingMedia] = useState(initialData?.media ?? []);
  const [existingCaptionDrafts, setExistingCaptionDrafts] = useState<
    Record<string, string>
  >(() => {
    const entries = initialData?.media ?? [];
    return Object.fromEntries(entries.map((media) => [media.id, media.caption ?? ""]));
  });

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => revokePendingUploadPreviews(selectedUploads), [selectedUploads]);

  function handlePendingFiles(fileList: FileList | null) {
    setSelectedUploads((current) => {
      revokePendingUploadPreviews(current);

      if (!fileList || fileList.length === 0) {
        return [];
      }

      return Array.from(fileList).map((file) => ({
        id: crypto.randomUUID(),
        file,
        caption: "",
        previewUrl: URL.createObjectURL(file),
        mediaType: file.type.startsWith("video/") ? "video" : "image",
      }));
    });
  }

  function updatePendingCaption(id: string, caption: string) {
    setSelectedUploads((current) =>
      current.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              caption,
            }
          : entry,
      ),
    );
  }

  async function handleRemoveMedia(media: InstructionMedia) {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const { error: storageError } = await supabase
        .storage
        .from("instruction-media")
        .remove([media.storage_path]);

      if (storageError) {
        throw new Error(storageError.message);
      }

      const { error: deleteError } = await supabase
        .from("instruction_media")
        .delete()
        .eq("id", media.id);

      if (deleteError) {
        throw new Error(deleteError.message);
      }

      setExistingMedia((current) => current.filter((entry) => entry.id !== media.id));
      setExistingCaptionDrafts((current) => {
        const next = { ...current };
        delete next[media.id];
        return next;
      });
      setMessage("Media deleted.");
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to remove media";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveMediaCaption(mediaId: string) {
    if (busy) {
      return;
    }

    const draft = (existingCaptionDrafts[mediaId] ?? "").trim();

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const { error: captionError } = await supabase
        .from("instruction_media")
        .update({
          caption: draft || null,
        })
        .eq("id", mediaId);

      if (captionError) {
        throw new Error(captionError.message);
      }

      setExistingMedia((current) =>
        current.map((entry) =>
          entry.id === mediaId
            ? {
                ...entry,
                caption: draft || null,
              }
            : entry,
        ),
      );
      setMessage("Media description updated.");
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to update media description";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }

  async function uploadNewFiles(instructionId: string, userId: string) {
    if (selectedUploads.length === 0) {
      return;
    }

    for (let index = 0; index < selectedUploads.length; index += 1) {
      const upload = selectedUploads[index];
      const file = upload.file;
      const storagePath = `${instructionId}/${crypto.randomUUID()}-${sanitizeFileName(
        file.name,
      )}`;

      const { error: uploadError } = await supabase
        .storage
        .from("instruction-media")
        .upload(storagePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("instruction-media").getPublicUrl(storagePath);

      const mediaType = file.type.startsWith("video/") ? "video" : "image";

      const { error: mediaInsertError } = await supabase.from("instruction_media").insert({
        instruction_id: instructionId,
        storage_path: storagePath,
        public_url: publicUrl,
        media_type: mediaType,
        caption: upload.caption.trim() || file.name,
        sort_order: existingMedia.length + index,
        created_by: userId,
      });

      if (mediaInsertError) {
        throw new Error(mediaInsertError.message);
      }
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setBusy(true);
    setMessage(null);
    setError(null);

    try {
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

      const effectivePartNumber = initialData?.partNumber?.trim() || DEFAULT_PART_NUMBER;
      const effectiveMoldNumber = initialData?.moldNumber?.trim() || DEFAULT_MOLD_NUMBER;
      const workItemPayload: {
        id?: string;
        part_number: string;
        mold_number: string;
        item_title: string;
        created_by: string;
      } = {
        part_number: effectivePartNumber,
        mold_number: effectiveMoldNumber,
        item_title: itemTitle.trim(),
        created_by: user.id,
      };

      if (initialData?.workItemId) {
        workItemPayload.id = initialData.workItemId;
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

      await uploadNewFiles(instructionId, user.id);

      setSelectedUploads((current) => {
        revokePendingUploadPreviews(current);
        return [];
      });
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
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Work Item Title</span>
          <input
            required
            placeholder="Example: Daily Setup Sequence"
            value={itemTitle}
            onChange={(event) => setItemTitle(event.target.value)}
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
            onChange={(event) =>
              setRevision(Number.parseInt(event.target.value || "1", 10))
            }
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

        <div className="grid gap-2">
          <label className="text-sm font-semibold">Media Upload (Image/Video)</label>
          <input
            type="file"
            accept="image/*,video/*"
            capture="environment"
            multiple
            onChange={(event) => handlePendingFiles(event.target.files)}
            className="rounded-xl border border-dashed border-slate-400 bg-white/70 px-3 py-3 text-sm dark:border-slate-600 dark:bg-slate-900/60"
          />
          {selectedUploads.length > 0 ? (
            <ul className="grid gap-3 text-xs text-slate-600 dark:text-slate-300">
              {selectedUploads.map((upload) => (
                <li
                  key={upload.id}
                  className="grid gap-2 rounded-xl border border-slate-300/70 bg-white/70 p-2 dark:border-slate-700 dark:bg-slate-950/60"
                >
                  {upload.mediaType === "video" ? (
                    <video
                      src={upload.previewUrl}
                      controls
                      className="max-h-56 w-full rounded-lg bg-black"
                    />
                  ) : (
                    <img
                      src={upload.previewUrl}
                      alt={upload.file.name}
                      className="max-h-56 w-full rounded-lg object-cover"
                    />
                  )}
                  <span className="font-medium">{upload.file.name}</span>
                  <input
                    value={upload.caption}
                    onChange={(event) => updatePendingCaption(upload.id, event.target.value)}
                    placeholder="Describe this image/video (optional)"
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {existingMedia.length > 0 ? (
          <div className="grid gap-3">
            <p className="text-sm font-semibold">Existing Media</p>
            <div className="grid gap-3 md:grid-cols-2">
              {existingMedia.map((media) => (
                <div
                  key={media.id}
                  className="overflow-hidden rounded-2xl border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950"
                >
                  {media.media_type === "video" ? (
                    <video src={media.public_url} controls className="max-h-64 w-full" />
                  ) : (
                    <img
                      src={media.public_url}
                      alt={media.caption ?? "Instruction media"}
                      className="max-h-64 w-full object-cover"
                    />
                  )}
                  <div className="grid gap-2 p-2 text-xs">
                    <input
                      value={existingCaptionDrafts[media.id] ?? ""}
                      onChange={(event) =>
                        setExistingCaptionDrafts((current) => ({
                          ...current,
                          [media.id]: event.target.value,
                        }))
                      }
                      placeholder="Describe this image/video"
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => void handleSaveMediaCaption(media.id)}
                        className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 px-2 py-1 text-cyan-700 transition hover:bg-cyan-500/10 dark:text-cyan-300"
                      >
                        <Save size={12} />
                        Save description
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRemoveMedia(media)}
                        className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 px-2 py-1 text-rose-700 transition hover:bg-rose-500/10 dark:text-rose-300"
                      >
                        <Trash2 size={12} />
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

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
