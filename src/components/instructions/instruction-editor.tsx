/* eslint-disable @next/next/no-img-element */

"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, UploadCloud } from "lucide-react";

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
    description: string;
    instructionTitle: string;
    bodyMarkdown: string;
    notesMarkdown: string;
    version: number;
    media: InstructionMedia[];
  };
}

export function InstructionEditor({ mode, initialData }: InstructionEditorProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [partNumber, setPartNumber] = useState(initialData?.partNumber ?? "");
  const [moldNumber, setMoldNumber] = useState(initialData?.moldNumber ?? "");
  const [itemTitle, setItemTitle] = useState(initialData?.itemTitle ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [instructionTitle, setInstructionTitle] = useState(
    initialData?.instructionTitle ?? "",
  );
  const [bodyMarkdown, setBodyMarkdown] = useState(initialData?.bodyMarkdown ?? "");
  const [notesMarkdown, setNotesMarkdown] = useState(
    initialData?.notesMarkdown ?? "",
  );
  const [version, setVersion] = useState(initialData?.version ?? 1);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [existingMedia, setExistingMedia] = useState(initialData?.media ?? []);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setMessage("Media deleted.");
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to remove media";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }

  async function uploadNewFiles(instructionId: string, userId: string) {
    if (selectedFiles.length === 0) {
      return;
    }

    for (let index = 0; index < selectedFiles.length; index += 1) {
      const file = selectedFiles[index];
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
        caption: file.name,
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
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("You must be signed in.");
      }

      const moldNumberValue = moldNumber.trim();

      const { data: workItem, error: workItemError } = await supabase
        .from("work_items")
        .upsert(
          {
            id: initialData?.workItemId,
            part_number: partNumber.trim(),
            mold_number: moldNumberValue,
            item_title: itemTitle.trim(),
            description: description.trim() || null,
            created_by: user.id,
          },
          {
            onConflict: "part_number,mold_number,item_title",
          },
        )
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
            title: instructionTitle.trim(),
            body_markdown: bodyMarkdown,
            notes_markdown: notesMarkdown,
            version,
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
            title: instructionTitle.trim(),
            body_markdown: bodyMarkdown,
            notes_markdown: notesMarkdown,
            version,
            updated_by: user.id,
          })
          .eq("id", instructionId);

        if (updateInstructionError) {
          throw new Error(updateInstructionError.message);
        }
      }

      await uploadNewFiles(instructionId, user.id);

      setSelectedFiles([]);
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
    <div className="grid gap-5">
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

      <form onSubmit={handleSubmit} className="grid gap-4 rounded-3xl border border-white/30 bg-white/75 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Part Number</span>
            <input
              required
              value={partNumber}
              onChange={(event) => setPartNumber(event.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Mold Number</span>
            <input
              value={moldNumber}
              onChange={(event) => setMoldNumber(event.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
        </div>

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

        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Work Item Description</span>
          <textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
          />
        </label>

        <div className="grid gap-3 md:grid-cols-[1fr_130px]">
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Instruction Title</span>
            <input
              required
              value={instructionTitle}
              onChange={(event) => setInstructionTitle(event.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Version</span>
            <input
              required
              min={1}
              type="number"
              value={version}
              onChange={(event) =>
                setVersion(Number.parseInt(event.target.value || "1", 10))
              }
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
        </div>

        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Instruction Steps (Markdown)</span>
          <textarea
            required
            rows={12}
            value={bodyMarkdown}
            onChange={(event) => setBodyMarkdown(event.target.value)}
            placeholder="# Step 1\n- Do this\n- Do that"
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Notes (Markdown)</span>
          <textarea
            rows={6}
            value={notesMarkdown}
            onChange={(event) => setNotesMarkdown(event.target.value)}
            placeholder="## Safety\nWear PPE at all times."
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
          />
        </label>

        <div className="grid gap-2">
          <label className="text-sm font-semibold">Media Upload (Image/Video)</label>
          <input
            type="file"
            accept="image/*,video/*"
            capture="environment"
            multiple
            onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))}
            className="rounded-xl border border-dashed border-slate-400 bg-white/70 px-3 py-3 text-sm dark:border-slate-600 dark:bg-slate-900/60"
          />
          {selectedFiles.length > 0 ? (
            <ul className="grid gap-1 text-xs text-slate-600 dark:text-slate-300">
              {selectedFiles.map((file) => (
                <li key={file.name + file.size}>{file.name}</li>
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
                  <div className="flex items-center justify-between gap-2 p-2 text-xs">
                    <span className="line-clamp-1">{media.caption ?? "Media"}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveMedia(media)}
                      className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 px-2 py-1 text-rose-700 transition hover:bg-rose-500/10 dark:text-rose-300"
                    >
                      <Trash2 size={12} />
                      Remove
                    </button>
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
