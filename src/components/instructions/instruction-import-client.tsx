"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2 } from "lucide-react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

interface DepartmentOption {
  id: string;
  name: string;
}

interface InstructionImportClientProps {
  departments: DepartmentOption[];
}

interface ImportResponse {
  instructionId?: string;
  error?: string;
}

const MAX_IMPORT_BYTES = 15 * 1024 * 1024;

function fileNameWithoutExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const [, base64 = ""] = result.split(",");
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read the selected file."));
    reader.readAsDataURL(file);
  });
}

export function InstructionImportClient({ departments }: InstructionImportClientProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? "");
  const [partId, setPartId] = useState("");
  const [itemTitle, setItemTitle] = useState("");
  const [revision, setRevision] = useState("1");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!file) {
      setError("Select a Word, Excel, PDF, image, or other source document to import.");
      return;
    }

    if (file.size > MAX_IMPORT_BYTES) {
      setError("Imported files must be 15 MB or smaller.");
      return;
    }

    const normalizedPartId = partId.trim();
    const normalizedTitle = itemTitle.trim() || fileNameWithoutExtension(file.name);
    if (!departmentId || !normalizedPartId || !normalizedTitle) {
      setError("Department, Part ID, and Work Item Title are required.");
      return;
    }

    const parsedRevision = Number.parseInt(revision, 10);
    if (!Number.isInteger(parsedRevision) || parsedRevision < 1) {
      setError("Revision must be a positive whole number.");
      return;
    }

    setBusy(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("Missing session token. Please sign in again.");
      }

      const contentBase64 = await readFileAsBase64(file);
      const response = await fetch("/api/instructions/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          departmentId,
          partId: normalizedPartId,
          itemTitle: normalizedTitle,
          revision: parsedRevision,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          fileSize: file.size,
          contentBase64,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as ImportResponse;

      if (!response.ok || !payload.instructionId) {
        throw new Error(payload.error ?? "Unable to import work instruction.");
      }

      router.push(`/instructions/${payload.instructionId}`);
      router.refresh();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Unable to import work instruction.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="grid gap-4 rounded-3xl border border-white/30 bg-white/85 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/75 md:p-7"
    >
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_12rem]">
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-slate-700 dark:text-slate-200">Part ID</span>
          <input
            value={partId}
            onChange={(event) => setPartId(event.target.value)}
            placeholder="Example: SK-12345"
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-slate-700 dark:text-slate-200">Work Item Title</span>
          <input
            value={itemTitle}
            onChange={(event) => setItemTitle(event.target.value)}
            placeholder={file ? fileNameWithoutExtension(file.name) : "Imported instruction title"}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-slate-700 dark:text-slate-200">Revision</span>
          <input
            value={revision}
            inputMode="numeric"
            onChange={(event) => setRevision(event.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
          />
        </label>
      </div>

      <label className="grid gap-1 text-sm">
        <span className="font-semibold text-slate-700 dark:text-slate-200">Department</span>
        <select
          value={departmentId}
          onChange={(event) => setDepartmentId(event.target.value)}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
        >
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
      </label>

      <label className="grid cursor-pointer gap-2 rounded-2xl border border-dashed border-slate-400/80 bg-slate-50/80 p-5 text-center transition hover:border-cyan-500 hover:bg-cyan-50/70 dark:border-slate-700 dark:bg-slate-950/60 dark:hover:bg-cyan-500/10">
        <FileUp className="mx-auto text-cyan-700 dark:text-cyan-200" />
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {file ? file.name : "Choose existing work instruction file"}
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Word, Excel, PDF, images, CSV, text, and other controlled source files are retained in
          their original format.
        </span>
        <input
          type="file"
          onChange={(event) => {
            const nextFile = event.target.files?.[0] ?? null;
            setFile(nextFile);
            if (nextFile && !itemTitle.trim()) {
              setItemTitle(fileNameWithoutExtension(nextFile.name));
            }
          }}
          className="sr-only"
        />
      </label>

      {error ? (
        <p className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="submit"
          disabled={busy || departments.length === 0}
          className="inline-flex items-center gap-2 rounded-xl border border-cyan-700 bg-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />}
          Import for review
        </button>
      </div>
    </form>
  );
}
