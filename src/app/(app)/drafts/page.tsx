import Link from "next/link";

import { InstructionBackButton } from "@/components/instructions/instruction-back-button";
import { requireAuthenticatedUser } from "@/lib/auth";
import {
  type ProcessDocumentStatus,
  type ProcessDocumentType,
  getProcessDocumentStatusLabel,
  getProcessDocumentTypeLabel,
} from "@/lib/process-documents";
import type { InstructionApprovalStatus } from "@/lib/types";

interface WorkInstructionDraftRow {
  id: string;
  revision: number;
  approval_status: InstructionApprovalStatus | null;
  updated_at: string;
  work_items:
    | {
        part_id: string;
        item_title: string;
        departments: { name: string } | { name: string }[] | null;
      }
    | Array<{
        part_id: string;
        item_title: string;
        departments: { name: string } | { name: string }[] | null;
      }>
    | null;
}

interface ProcessDocumentDraftRow {
  id: string;
  document_number: string;
  title: string;
  document_type: ProcessDocumentType;
  status: ProcessDocumentStatus;
  updated_at: string;
}

interface FormulaDraftRow {
  id: string;
  name: string;
  payload: unknown;
  updated_at: string;
}

function normalizeRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function getInstructionStatusLabel(status: InstructionApprovalStatus | null | undefined) {
  switch (status) {
    case "pending_review":
      return "Pending Review";
    case "rejected":
      return "Rejected";
    case "approved":
      return "Approved";
    case "draft":
    default:
      return "Draft";
  }
}

function getFormulaApprovalStatus(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "draft";
  }

  const customFormula = (payload as Record<string, unknown>).customFormula;
  if (!customFormula || typeof customFormula !== "object" || Array.isArray(customFormula)) {
    return "draft";
  }

  const status = (customFormula as Record<string, unknown>).approvalStatus;
  return status === "pending_review" ||
    status === "approved" ||
    status === "rejected" ||
    status === "draft"
    ? status
    : "draft";
}

function DraftCard({
  title,
  subtitle,
  status,
  updatedAt,
  href,
}: {
  title: string;
  subtitle: string;
  status: string;
  updatedAt: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="grid min-w-0 gap-2 overflow-hidden rounded-xl border border-slate-300/70 bg-white/85 p-4 shadow-sm transition hover:border-cyan-500/50 hover:bg-cyan-500/5 dark:border-slate-700 dark:bg-slate-950/70 dark:hover:border-cyan-400/45"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-extrabold leading-snug text-slate-950 [overflow-wrap:anywhere] dark:text-slate-50">
            {title}
          </h2>
          <p className="text-sm text-slate-600 [overflow-wrap:anywhere] dark:text-slate-300">
            {subtitle}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-cyan-800 dark:text-cyan-100">
          {status}
        </span>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Updated {new Date(updatedAt).toLocaleString()}
      </p>
    </Link>
  );
}

export default async function DraftsPage() {
  const { profile, supabase } = await requireAuthenticatedUser();
  const [
    { data: instructionRows },
    { data: documentRows },
    { data: formulaRows },
    { data: publishedInstructionRows },
    { data: publishedDocumentRows },
  ] = await Promise.all([
    supabase
      .from("work_instructions")
      .select("id, revision, approval_status, updated_at, work_items(part_id, item_title, departments(name))")
      .eq("is_archived", false)
      .in("approval_status", ["draft", "pending_review", "rejected"])
      .or(`created_by.eq.${profile.id},updated_by.eq.${profile.id},submitted_by.eq.${profile.id}`)
      .order("updated_at", { ascending: false })
      .range(0, 99),
    supabase
      .from("process_documents")
      .select("id, document_number, title, document_type, status, updated_at")
      .in("status", ["draft", "in_review"])
      .or(`created_by.eq.${profile.id},owner_user_id.eq.${profile.id}`)
      .order("updated_at", { ascending: false })
      .range(0, 99),
    supabase
      .from("process_map_formulas")
      .select("id, name, payload, updated_at")
      .eq("owner_user_id", profile.id)
      .eq("formula_type", "custom")
      .order("updated_at", { ascending: false })
      .range(0, 99),
    supabase
      .from("work_instructions")
      .select("id, revision, approval_status, approved_at, updated_at, work_items(part_id, item_title, departments(name))")
      .eq("is_archived", false)
      .eq("approval_status", "approved")
      .or(`created_by.eq.${profile.id},updated_by.eq.${profile.id},submitted_by.eq.${profile.id},approved_by.eq.${profile.id}`)
      .order("updated_at", { ascending: false })
      .range(0, 99),
    supabase
      .from("process_documents")
      .select("id, document_number, title, document_type, status, approved_at, updated_at")
      .eq("status", "approved")
      .or(`created_by.eq.${profile.id},owner_user_id.eq.${profile.id},updated_by.eq.${profile.id},approved_by.eq.${profile.id}`)
      .order("updated_at", { ascending: false })
      .range(0, 99),
  ]);

  const instructionDrafts = ((instructionRows ?? []) as WorkInstructionDraftRow[]).map((row) => {
    const workItem = normalizeRelation(row.work_items);
    const department = normalizeRelation(workItem?.departments);
    return {
      id: row.id,
      title: workItem?.item_title ?? "Untitled instruction",
      subtitle: `${workItem?.part_id || "No Part ID"} | ${department?.name ?? "Unknown Department"} | Rev ${row.revision}`,
      status: getInstructionStatusLabel(row.approval_status),
      updatedAt: row.updated_at,
      href: row.approval_status === "pending_review" ? `/instructions/${row.id}` : `/instructions/${row.id}/edit`,
    };
  });
  const documentDrafts = ((documentRows ?? []) as ProcessDocumentDraftRow[]).map((row) => ({
    id: row.id,
    title: `${row.document_number} | ${row.title}`,
    subtitle: getProcessDocumentTypeLabel(row.document_type),
    status: getProcessDocumentStatusLabel(row.status),
    updatedAt: row.updated_at,
    href: `/process-documents?doc=${row.id}`,
  }));
  const formulaDrafts = ((formulaRows ?? []) as FormulaDraftRow[])
    .filter((row) => getFormulaApprovalStatus(row.payload) !== "approved")
    .map((row) => ({
      id: row.id,
      title: row.name,
      subtitle: "Formula draft",
      status: getFormulaApprovalStatus(row.payload).replace("_", " "),
      updatedAt: row.updated_at,
      href: `/process-maps/formulas?formula=${row.id}`,
    }));
  const publishedInstructions = ((publishedInstructionRows ?? []) as WorkInstructionDraftRow[]).map((row) => {
    const workItem = normalizeRelation(row.work_items);
    const department = normalizeRelation(workItem?.departments);
    return {
      id: row.id,
      title: workItem?.item_title ?? "Untitled instruction",
      subtitle: `${workItem?.part_id || "No Part ID"} | ${department?.name ?? "Unknown Department"} | Rev ${row.revision}`,
      status: "Published",
      updatedAt: row.updated_at,
      href: `/instructions/${row.id}`,
    };
  });
  const publishedDocuments = ((publishedDocumentRows ?? []) as ProcessDocumentDraftRow[]).map((row) => ({
    id: row.id,
    title: `${row.document_number} | ${row.title}`,
    subtitle: getProcessDocumentTypeLabel(row.document_type),
    status: "Published",
    updatedAt: row.updated_at,
    href: `/process-documents?doc=${row.id}`,
  }));
  const publishedFormulas = ((formulaRows ?? []) as FormulaDraftRow[])
    .filter((row) => getFormulaApprovalStatus(row.payload) === "approved")
    .map((row) => ({
      id: row.id,
      title: row.name,
      subtitle: "Formula",
      status: "Published",
      updatedAt: row.updated_at,
      href: `/process-maps/formulas?formula=${row.id}`,
    }));
  const totalDrafts = instructionDrafts.length + documentDrafts.length + formulaDrafts.length;
  const totalPublished =
    publishedInstructions.length + publishedDocuments.length + publishedFormulas.length;

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <InstructionBackButton fallbackHref="/dashboard" />
        <div className="grid min-w-0 gap-1">
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100">
            My Drafts
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Work instructions, controlled documents, and formula drafts owned by your account.
          </p>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-300/70 bg-white/85 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/75">
        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
          {totalDrafts} active draft{totalDrafts === 1 ? "" : "s"}
        </p>
      </section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[repeat(3,minmax(0,1fr))]">
        <section className="grid min-w-0 content-start gap-3">
          <h2 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">
            Work Instructions
          </h2>
          {instructionDrafts.length > 0 ? (
            instructionDrafts.map((draft) => <DraftCard key={draft.id} {...draft} />)
          ) : (
            <p className="rounded-xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-400">
              No work instruction drafts.
            </p>
          )}
        </section>
        <section className="grid min-w-0 content-start gap-3">
          <h2 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">
            Documents
          </h2>
          {documentDrafts.length > 0 ? (
            documentDrafts.map((draft) => <DraftCard key={draft.id} {...draft} />)
          ) : (
            <p className="rounded-xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-400">
              No document drafts.
            </p>
          )}
        </section>
        <section className="grid min-w-0 content-start gap-3">
          <h2 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">
            Formulas
          </h2>
          {formulaDrafts.length > 0 ? (
            formulaDrafts.map((draft) => <DraftCard key={draft.id} {...draft} />)
          ) : (
            <p className="rounded-xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-400">
              No formula drafts.
            </p>
          )}
        </section>
      </div>

      <section className="mt-4 grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
              My Published
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Approved work instructions, controlled documents, and formulas published by your account.
            </p>
          </div>
          <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-100">
            {totalPublished} published
          </span>
        </div>

        <div className="grid min-w-0 gap-4 xl:grid-cols-[repeat(3,minmax(0,1fr))]">
          <section className="grid min-w-0 content-start gap-3">
            <h3 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">
              Work Instructions
            </h3>
            {publishedInstructions.length > 0 ? (
              publishedInstructions.map((item) => <DraftCard key={item.id} {...item} />)
            ) : (
              <p className="min-w-0 rounded-xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-400">
                No published work instructions.
              </p>
            )}
          </section>
          <section className="grid min-w-0 content-start gap-3">
            <h3 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">
              Documents
            </h3>
            {publishedDocuments.length > 0 ? (
              publishedDocuments.map((item) => <DraftCard key={item.id} {...item} />)
            ) : (
              <p className="min-w-0 rounded-xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-400">
                No published documents.
              </p>
            )}
          </section>
          <section className="grid min-w-0 content-start gap-3">
            <h3 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">
              Formulas
            </h3>
            {publishedFormulas.length > 0 ? (
              publishedFormulas.map((item) => <DraftCard key={item.id} {...item} />)
            ) : (
              <p className="min-w-0 rounded-xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-400">
                No published formulas.
              </p>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
