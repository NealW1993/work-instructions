"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FilePlus2,
  FileText,
  Loader2,
  Search,
  ShieldCheck,
  Upload,
  UserRound,
} from "lucide-react";
import {
  type ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import {
  ISO_9001_CLAUSE_OPTIONS,
  PROCESS_DOCUMENT_STATUS_OPTIONS,
  PROCESS_DOCUMENT_TYPE_OPTIONS,
  type ProcessDocumentSourceType,
  type ProcessDocumentStatus,
  type ProcessDocumentType,
  getProcessDocumentStatusLabel,
  getProcessDocumentTypeLabel,
} from "@/lib/process-documents";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

export interface ProcessDocumentListItem {
  id: string;
  document_number: string;
  title: string;
  document_type: ProcessDocumentType;
  status: ProcessDocumentStatus;
  department_id: string | null;
  owner_user_id: string | null;
  process_name: string;
  process_scope: string;
  process_inputs: string;
  process_outputs: string;
  process_risks: string;
  process_controls: string;
  related_instruction_ids: string[];
  iso_clause_refs: string[];
  current_revision: number;
  effective_at: string | null;
  next_review_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  obsoleted_by: string | null;
  obsoleted_at: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  department_name: string | null;
  department_color: string | null;
  owner_name: string | null;
  updated_by_name: string | null;
  approved_by_name: string | null;
}

export interface ProcessDocumentRevisionItem {
  id: string;
  document_id: string;
  revision: number;
  title: string;
  body_html: string;
  change_summary: string;
  source_type: ProcessDocumentSourceType;
  template_id: string | null;
  imported_file_name: string | null;
  imported_file_type: string | null;
  imported_file_size: number | null;
  prepared_by: string;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  prepared_by_name: string | null;
  approved_by_name: string | null;
}

export interface ProcessDocumentAuditItem {
  id: string;
  document_id: string;
  revision_id: string | null;
  actor_user_id: string;
  event_type: string;
  detail: string;
  from_status: ProcessDocumentStatus | null;
  to_status: ProcessDocumentStatus | null;
  occurred_at: string;
  actor_name: string | null;
}

export interface ProcessDocumentTemplateItem {
  id: string;
  slug: string;
  name: string;
  document_type: ProcessDocumentType;
  description: string;
  body_html: string;
}

export interface ProcessDocumentDepartmentOption {
  id: string;
  name: string;
  color_hex: string | null;
}

export interface ProcessDocumentProfileOption {
  id: string;
  full_name: string;
  email: string;
}

export interface ProcessDocumentInstructionOption {
  id: string;
  revision: number;
  part_id: string;
  item_title: string;
  department_name: string;
}

interface ProcessDocumentsClientProps {
  canEdit: boolean;
  isSystemAdmin: boolean;
  currentUserId: string;
  initialDocumentId: string | null;
  documents: ProcessDocumentListItem[];
  revisions: ProcessDocumentRevisionItem[];
  auditEvents: ProcessDocumentAuditItem[];
  templates: ProcessDocumentTemplateItem[];
  departments: ProcessDocumentDepartmentOption[];
  profiles: ProcessDocumentProfileOption[];
  instructions: ProcessDocumentInstructionOption[];
}

interface ProcessDocumentFormState {
  documentNumber: string;
  title: string;
  documentType: ProcessDocumentType;
  status: ProcessDocumentStatus;
  departmentId: string;
  ownerUserId: string;
  processName: string;
  processScope: string;
  processInputs: string;
  processOutputs: string;
  processRisks: string;
  processControls: string;
  relatedInstructionIds: string[];
  isoClauseRefs: string[];
  bodyHtml: string;
  documentHeader: string;
  documentFooter: string;
  changeSummary: string;
  sourceType: ProcessDocumentSourceType;
  templateId: string | null;
  importedFileName: string | null;
  importedFileType: string | null;
  importedFileSize: number | null;
}

interface ImportReport {
  fileName: string;
  fileType: string;
  fileSize: number;
  textLength: number;
  warnings: string[];
}

const EMPTY_FORM: ProcessDocumentFormState = {
  documentNumber: "",
  title: "",
  documentType: "procedure",
  status: "draft",
  departmentId: "",
  ownerUserId: "",
  processName: "",
  processScope: "",
  processInputs: "",
  processOutputs: "",
  processRisks: "",
  processControls: "",
  relatedInstructionIds: [],
  isoClauseRefs: ["4.4 QMS processes", "7.5 Documented information"],
  bodyHtml: "",
  documentHeader: "",
  documentFooter: "",
  changeSummary: "",
  sourceType: "manual",
  templateId: null,
  importedFileName: null,
  importedFileType: null,
  importedFileSize: null,
};

function statusTone(status: ProcessDocumentStatus) {
  switch (status) {
    case "approved":
      return "border-emerald-500/45 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200";
    case "in_review":
      return "border-amber-500/45 bg-amber-500/15 text-amber-800 dark:text-amber-200";
    case "obsolete":
      return "border-slate-500/45 bg-slate-500/15 text-slate-700 dark:text-slate-300";
    case "draft":
    default:
      return "border-cyan-500/45 bg-cyan-500/15 text-cyan-800 dark:text-cyan-200";
  }
}

function formatFileSize(bytes: number | null) {
  if (!bytes || bytes <= 0) {
    return "";
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getSourceTypeLabel(sourceType: ProcessDocumentSourceType) {
  switch (sourceType) {
    case "import":
      return "Imported";
    case "template":
      return "Template";
    case "manual":
    default:
      return "Manual";
  }
}

function getReviewStatus(document: ProcessDocumentListItem) {
  if (document.status === "obsolete") {
    return {
      label: "Obsolete",
      tone: "border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-300",
    };
  }

  if (document.status !== "approved") {
    return {
      label: "Not effective",
      tone: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
    };
  }

  if (!document.next_review_at) {
    return {
      label: "Review date missing",
      tone: "border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-200",
    };
  }

  const reviewTime = new Date(document.next_review_at).getTime();
  if (!Number.isFinite(reviewTime)) {
    return {
      label: "Review date invalid",
      tone: "border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-200",
    };
  }

  const daysUntilReview = Math.ceil((reviewTime - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysUntilReview < 0) {
    return {
      label: `Overdue by ${Math.abs(daysUntilReview)} day${
        Math.abs(daysUntilReview) === 1 ? "" : "s"
      }`,
      tone: "border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-200",
    };
  }

  if (daysUntilReview <= 30) {
    return {
      label: `Due in ${daysUntilReview} day${daysUntilReview === 1 ? "" : "s"}`,
      tone: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
    };
  }

  return {
    label: "Review scheduled",
    tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  };
}

function normalizeDateTimestamp(value: string | null) {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractVisibleText(html: string) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createBlankDocumentNumber(count: number) {
  return `QMS-${String(count + 1).padStart(3, "0")}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildDocumentChrome(kind: "header" | "footer", text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }

  const label = kind === "header" ? "Document Header" : "Document Footer";
  const borderClass = kind === "header" ? "border-bottom:1px solid #cbd5e1;" : "border-top:1px solid #cbd5e1;";

  return `<section data-document-${kind}="true" style="${borderClass}margin:${kind === "header" ? "0 0 16px" : "16px 0 0"};padding:${kind === "header" ? "0 0 10px" : "10px 0 0"};color:#475569;font-size:12px;"><strong>${label}:</strong> ${escapeHtml(trimmed).replace(/\n/g, "<br />")}</section>`;
}

function composeDocumentBodyHtml(form: ProcessDocumentFormState) {
  return [
    buildDocumentChrome("header", form.documentHeader),
    form.bodyHtml,
    buildDocumentChrome("footer", form.documentFooter),
  ]
    .filter(Boolean)
    .join("\n");
}

export function ProcessDocumentsClient({
  canEdit,
  isSystemAdmin,
  currentUserId,
  initialDocumentId,
  documents,
  revisions,
  auditEvents,
  templates,
  departments,
  profiles,
  instructions,
}: ProcessDocumentsClientProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    initialDocumentId && documents.some((document) => document.id === initialDocumentId)
      ? initialDocumentId
      : null,
  );
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ProcessDocumentFormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const revisionsByDocumentId = useMemo(() => {
    const map = new Map<string, ProcessDocumentRevisionItem[]>();
    for (const revision of revisions) {
      const list = map.get(revision.document_id) ?? [];
      list.push(revision);
      map.set(revision.document_id, list);
    }

    for (const list of map.values()) {
      list.sort((a, b) => b.revision - a.revision);
    }

    return map;
  }, [revisions]);

  const auditEventsByDocumentId = useMemo(() => {
    const map = new Map<string, ProcessDocumentAuditItem[]>();
    for (const event of auditEvents) {
      const list = map.get(event.document_id) ?? [];
      list.push(event);
      map.set(event.document_id, list);
    }

    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          normalizeDateTimestamp(b.occurred_at) - normalizeDateTimestamp(a.occurred_at),
      );
    }

    return map;
  }, [auditEvents]);

  const selectedDocument = useMemo(
    () =>
      creating
        ? null
        : documents.find((document) => document.id === selectedDocumentId) ?? null,
    [creating, documents, selectedDocumentId],
  );

  const selectedRevisions = selectedDocument
    ? revisionsByDocumentId.get(selectedDocument.id) ?? []
    : [];
  const selectedRevision =
    selectedDocument && selectedRevisions.length > 0
      ? selectedRevisions.find(
          (revision) => revision.revision === selectedDocument.current_revision,
        ) ?? selectedRevisions[0]
      : null;
  const selectedAuditEvents = selectedDocument
    ? auditEventsByDocumentId.get(selectedDocument.id) ?? []
    : [];
  const selectedReviewStatus = selectedDocument ? getReviewStatus(selectedDocument) : null;

  const approvalReadinessIssues = useMemo(() => {
    const issues: string[] = [];
    const bodyText = extractVisibleText(form.bodyHtml);

    if (!form.documentNumber.trim()) {
      issues.push("Document number");
    }
    if (!form.title.trim()) {
      issues.push("Title");
    }
    if (!form.ownerUserId.trim()) {
      issues.push("Owner");
    }
    if (!bodyText) {
      issues.push("Document body");
    }
    if (!form.isoClauseRefs.includes("7.5 Documented information")) {
      issues.push("ISO 9001 clause 7.5");
    }
    if (!form.processScope.trim()) {
      issues.push("Process scope");
    }
    if (!form.processControls.trim()) {
      issues.push("Controls and measures");
    }
    if (form.sourceType === "import" && !form.importedFileName) {
      issues.push("Imported source file");
    }
    if (!creating && !form.changeSummary.trim()) {
      issues.push("Change summary");
    }

    return issues;
  }, [creating, form]);

  const filteredDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return documents;
    }

    return documents.filter((document) => {
      const haystack = [
        document.document_number,
        document.title,
        getProcessDocumentTypeLabel(document.document_type),
        getProcessDocumentStatusLabel(document.status),
        document.department_name,
        document.owner_name,
        document.process_name,
        ...document.iso_clause_refs,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [documents, query]);

  const documentDashboardStats = useMemo(() => {
    const statusCounts = {
      draft: 0,
      in_review: 0,
      approved: 0,
      obsolete: 0,
    } satisfies Record<ProcessDocumentStatus, number>;
    let overdueReviews = 0;
    let dueSoonReviews = 0;

    for (const document of documents) {
      statusCounts[document.status] += 1;
      const reviewLabel = getReviewStatus(document).label;
      if (reviewLabel.startsWith("Overdue")) {
        overdueReviews += 1;
      } else if (reviewLabel.startsWith("Due in")) {
        dueSoonReviews += 1;
      }
    }

    return {
      total: documents.length,
      statusCounts,
      overdueReviews,
      dueSoonReviews,
      importedRevisions: revisions.filter((revision) => revision.source_type === "import").length,
      templatedRevisions: revisions.filter((revision) => revision.source_type === "template").length,
      recentDocuments: [...documents]
        .sort(
          (a, b) =>
            normalizeDateTimestamp(b.updated_at) - normalizeDateTimestamp(a.updated_at),
        )
        .slice(0, 5),
    };
  }, [documents, revisions]);

  useEffect(() => {
    setImportReport(null);

    if (creating) {
      setForm({
        ...EMPTY_FORM,
        documentNumber: createBlankDocumentNumber(documents.length),
        ownerUserId: currentUserId,
      });
      return;
    }

    if (!selectedDocument) {
      return;
    }

    setForm({
      documentNumber: selectedDocument.document_number,
      title: selectedDocument.title,
      documentType: selectedDocument.document_type,
      status: selectedDocument.status,
      departmentId: selectedDocument.department_id ?? "",
      ownerUserId: selectedDocument.owner_user_id ?? currentUserId,
      processName: selectedDocument.process_name,
      processScope: selectedDocument.process_scope,
      processInputs: selectedDocument.process_inputs,
      processOutputs: selectedDocument.process_outputs,
      processRisks: selectedDocument.process_risks,
      processControls: selectedDocument.process_controls,
      relatedInstructionIds: selectedDocument.related_instruction_ids ?? [],
      isoClauseRefs: selectedDocument.iso_clause_refs ?? [],
      bodyHtml: selectedRevision?.body_html ?? "",
      documentHeader: "",
      documentFooter: "",
      changeSummary: "",
      sourceType: "manual",
      templateId: null,
      importedFileName: null,
      importedFileType: null,
      importedFileSize: null,
    });
  }, [creating, currentUserId, documents.length, selectedDocument, selectedRevision]);

  function updateForm<K extends keyof ProcessDocumentFormState>(
    key: K,
    value: ProcessDocumentFormState[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Missing session token. Please sign in again.");
    }

    return session.access_token;
  }

  async function saveDocument(nextStatus: ProcessDocumentStatus) {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const token = await getAccessToken();
      const payload = {
        ...form,
        status: nextStatus,
        bodyHtml: composeDocumentBodyHtml(form),
        departmentId: form.departmentId || null,
        ownerUserId: form.ownerUserId || currentUserId,
      };
      const endpoint = creating
        ? "/api/process-documents"
        : `/api/process-documents/${selectedDocument?.id}`;
      const response = await fetch(endpoint, {
        method: creating ? "POST" : "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const responsePayload = (await response.json().catch(() => ({}))) as {
        error?: string;
        documentId?: string;
      };

      if (!response.ok) {
        throw new Error(responsePayload.error ?? "Unable to save controlled document.");
      }

      const nextDocumentId = responsePayload.documentId ?? selectedDocument?.id ?? null;
      setMessage("Controlled document saved.");
      setCreating(false);
      if (nextDocumentId) {
        setSelectedDocumentId(nextDocumentId);
        router.replace(`/process-documents?doc=${nextDocumentId}`);
      }
      router.refresh();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save controlled document.",
      );
    } finally {
      setBusy(false);
    }
  }

  function applyTemplate(templateId: string) {
    if (!templateId) {
      setForm((current) => ({
        ...current,
        sourceType: "manual",
        templateId: null,
      }));
      return;
    }

    const template = templates.find((entry) => entry.id === templateId);
    if (!template) {
      return;
    }

    setImportReport(null);
    setForm((current) => ({
      ...current,
      documentType: template.document_type,
      bodyHtml: template.body_html,
      sourceType: "template",
      templateId: template.id,
      importedFileName: null,
      importedFileType: null,
      importedFileSize: null,
    }));
  }

  function startNewDocument() {
    setCreating(true);
    setSelectedDocumentId(null);
    setImportReport(null);
    setMessage(null);
    setError(null);
    router.replace("/process-documents", { scroll: false });
  }

  function selectDocument(documentId: string) {
    setCreating(false);
    setSelectedDocumentId(documentId);
    setImportReport(null);
    setMessage(null);
    setError(null);
    router.replace(`/process-documents?doc=${documentId}`, {
      scroll: false,
    });
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) {
      return;
    }

    setImportBusy(true);
    setError(null);
    setMessage(null);

    try {
      const token = await getAccessToken();
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/process-documents/import", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        convertedHtml?: string;
        fileName?: string;
        fileType?: string;
        fileSize?: number;
        textLength?: number;
        warnings?: string[];
        error?: string;
      };

      if (!response.ok || !payload.convertedHtml) {
        throw new Error(payload.error ?? "Unable to import the selected document.");
      }

      setForm((current) => ({
        ...current,
        bodyHtml: payload.convertedHtml ?? "",
        sourceType: "import",
        templateId: null,
        importedFileName: payload.fileName ?? file.name,
        importedFileType: payload.fileType ?? file.type,
        importedFileSize: payload.fileSize ?? file.size,
      }));
      setMessage(
        payload.warnings?.length
          ? `Imported with ${payload.warnings.length} conversion warning${
              payload.warnings.length === 1 ? "" : "s"
            }.`
          : "Document imported.",
      );
      setImportReport({
        fileName: payload.fileName ?? file.name,
        fileType: payload.fileType ?? file.type,
        fileSize: payload.fileSize ?? file.size,
        textLength: payload.textLength ?? extractVisibleText(payload.convertedHtml ?? "").length,
        warnings: payload.warnings ?? [],
      });
    } catch (caughtError) {
      setImportReport(null);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to import the selected document.",
      );
    } finally {
      setImportBusy(false);
    }
  }

  function toggleClause(clause: string) {
    setForm((current) => {
      const active = current.isoClauseRefs.includes(clause);
      return {
        ...current,
        isoClauseRefs: active
          ? current.isoClauseRefs.filter((entry) => entry !== clause)
          : [...current.isoClauseRefs, clause],
      };
    });
  }

  function handleRelatedInstructionChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextIds = Array.from(event.currentTarget.selectedOptions).map(
      (option) => option.value,
    );
    updateForm("relatedInstructionIds", nextIds);
  }

  const canApprove = canEdit;
  const canApproveCurrentForm = canApprove && approvalReadinessIssues.length === 0;
  const canObsolete = isSystemAdmin && Boolean(selectedDocument);
  const showEditor = canEdit && (creating || selectedDocument);

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-950 dark:text-slate-50">
            Process Documentation
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Controlled QMS documents, revisions, approvals, and audit evidence.
          </p>
        </div>

        {canEdit ? (
          <button
            type="button"
            onClick={startNewDocument}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/45 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-500/25 dark:text-cyan-100"
          >
            <FilePlus2 size={16} />
            New Controlled Document
          </button>
        ) : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(280px,0.35fr)_minmax(0,1fr)]">
        <aside className="grid h-fit gap-3 rounded-xl border border-slate-300/70 bg-white/85 p-3 shadow-sm dark:border-slate-700 dark:bg-slate-950/75">
          <label className="relative block">
            <span className="sr-only">Search controlled documents</span>
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search documents"
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>

          <div className="grid max-h-[72vh] gap-2 overflow-y-auto pr-1">
            {filteredDocuments.length === 0 ? (
              <p className="rounded-lg border border-slate-300/70 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
                No controlled documents found.
              </p>
            ) : (
              filteredDocuments.map((document) => (
                <button
                  key={document.id}
                  type="button"
                  onClick={() => selectDocument(document.id)}
                  className={cn(
                    "grid gap-1 rounded-lg border p-3 text-left transition hover:bg-cyan-500/10",
                    selectedDocument?.id === document.id && !creating
                      ? "border-cyan-500/55 bg-cyan-500/15"
                      : "border-slate-300/70 bg-white/70 dark:border-slate-700 dark:bg-slate-900/40",
                  )}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                      {document.document_number}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        statusTone(document.status),
                      )}
                    >
                      {getProcessDocumentStatusLabel(document.status)}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {document.title}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Rev {document.current_revision} |{" "}
                    {getProcessDocumentTypeLabel(document.document_type)}
                  </p>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="grid min-w-0 gap-4">
          {message ? (
            <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
              {error}
            </p>
          ) : null}

          {selectedDocument ? (
            <section className="grid gap-3 rounded-xl border border-slate-300/70 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/80">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-500/15 text-cyan-700 dark:text-cyan-200">
                    <ShieldCheck size={18} />
                  </span>
                  <div>
                    <h2 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">
                      Document Control
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Current revision, approval evidence, retention status, and review timing.
                    </p>
                  </div>
                </div>
                {selectedReviewStatus ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide",
                      selectedReviewStatus.tone,
                    )}
                  >
                    <CalendarClock size={13} />
                    {selectedReviewStatus.label}
                  </span>
                ) : null}
              </div>

              <dl className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Document
                  </dt>
                  <dd className="font-bold text-slate-900 dark:text-slate-100">
                    {selectedDocument.document_number} | Rev {selectedDocument.current_revision}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Type
                  </dt>
                  <dd className="font-bold text-slate-900 dark:text-slate-100">
                    {getProcessDocumentTypeLabel(selectedDocument.document_type)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Source
                  </dt>
                  <dd className="font-bold text-slate-900 dark:text-slate-100">
                    {selectedRevision ? getSourceTypeLabel(selectedRevision.source_type) : "Manual"}
                    {selectedRevision?.imported_file_name
                      ? ` | ${selectedRevision.imported_file_name}`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Status
                  </dt>
                  <dd>
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
                        statusTone(selectedDocument.status),
                      )}
                    >
                      {getProcessDocumentStatusLabel(selectedDocument.status)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Owner
                  </dt>
                  <dd className="inline-flex items-center gap-1 font-bold text-slate-900 dark:text-slate-100">
                    <UserRound size={13} />
                    {selectedDocument.owner_name ?? "Unassigned"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Department
                  </dt>
                  <dd className="font-bold text-slate-900 dark:text-slate-100">
                    {selectedDocument.department_name ?? "Unassigned"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Effective
                  </dt>
                  <dd className="font-bold text-slate-900 dark:text-slate-100">
                    {selectedDocument.effective_at ? (
                      <LocalDateTime value={selectedDocument.effective_at} mode="date" />
                    ) : (
                      "Not effective"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Next Review
                  </dt>
                  <dd className="font-bold text-slate-900 dark:text-slate-100">
                    {selectedDocument.next_review_at ? (
                      <LocalDateTime value={selectedDocument.next_review_at} mode="date" />
                    ) : (
                      "Not scheduled"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Approved By
                  </dt>
                  <dd className="font-bold text-slate-900 dark:text-slate-100">
                    {selectedDocument.approved_by_name ?? "Pending"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Approved At
                  </dt>
                  <dd className="font-bold text-slate-900 dark:text-slate-100">
                    {selectedDocument.approved_at ? (
                      <LocalDateTime value={selectedDocument.approved_at} mode="dateTime" />
                    ) : (
                      "Pending"
                    )}
                  </dd>
                </div>
                <div className="md:col-span-2">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    ISO Clauses
                  </dt>
                  <dd className="font-bold text-slate-900 dark:text-slate-100">
                    {selectedDocument.iso_clause_refs.length > 0
                      ? selectedDocument.iso_clause_refs.join(", ")
                      : "Not mapped"}
                  </dd>
                </div>
              </dl>
            </section>
          ) : null}

          {!showEditor && selectedDocument && selectedRevision ? (
            <section className="grid gap-4 rounded-xl border border-slate-300/70 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/80">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {selectedDocument.document_number} | Rev {selectedDocument.current_revision}
                  </p>
                  <h2 className="text-2xl font-extrabold text-slate-950 dark:text-slate-50">
                    {selectedDocument.title}
                  </h2>
                </div>
                <span
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide",
                    statusTone(selectedDocument.status),
                  )}
                >
                  {getProcessDocumentStatusLabel(selectedDocument.status)}
                </span>
              </div>

              <div
                className="tiptap-editor-content max-w-none rounded-lg border border-slate-300/70 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-950"
                dangerouslySetInnerHTML={{ __html: selectedRevision.body_html }}
              />
            </section>
          ) : null}

          {showEditor ? (
            <section className="grid gap-4 rounded-xl border border-slate-300/70 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/80">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-500/15 text-cyan-700 dark:text-cyan-200">
                    <ClipboardList size={18} />
                  </span>
                  <div>
                    <h2 className="text-xl font-extrabold text-slate-950 dark:text-slate-50">
                      {creating ? "New Controlled Document" : "Controlled Revision"}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {creating
                        ? "Revision 1"
                        : `Current revision ${selectedDocument?.current_revision ?? 1}`}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <select
                    value={form.templateId ?? ""}
                    onChange={(event) => applyTemplate(event.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                    aria-label="Apply template"
                  >
                    <option value="">Apply template</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={importBusy}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                  >
                    {importBusy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                    Import
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".docx,.html,.htm,.txt,.md,.markdown,text/html,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={(event) => void handleImportFile(event)}
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  <span className="font-semibold">Document Number</span>
                  <input
                    value={form.documentNumber}
                    onChange={(event) => updateForm("documentNumber", event.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>

                <label className="grid gap-1 text-sm">
                  <span className="font-semibold">Title</span>
                  <input
                    value={form.title}
                    onChange={(event) => updateForm("title", event.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>

                <label className="grid gap-1 text-sm">
                  <span className="font-semibold">Document Type</span>
                  <select
                    value={form.documentType}
                    onChange={(event) =>
                      updateForm("documentType", event.target.value as ProcessDocumentType)
                    }
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                  >
                    {PROCESS_DOCUMENT_TYPE_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm">
                  <span className="font-semibold">Department</span>
                  <select
                    value={form.departmentId}
                    onChange={(event) => updateForm("departmentId", event.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="">Unassigned</option>
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm">
                  <span className="font-semibold">Owner</span>
                  <select
                    value={form.ownerUserId}
                    onChange={(event) => updateForm("ownerUserId", event.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value={currentUserId}>Current user</option>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.full_name || profile.email}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm">
                  <span className="font-semibold">Process Name</span>
                  <input
                    value={form.processName}
                    onChange={(event) => updateForm("processName", event.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  <span className="font-semibold">Scope</span>
                  <textarea
                    value={form.processScope}
                    onChange={(event) => updateForm("processScope", event.target.value)}
                    rows={3}
                    className="resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-semibold">Inputs</span>
                  <textarea
                    value={form.processInputs}
                    onChange={(event) => updateForm("processInputs", event.target.value)}
                    rows={3}
                    className="resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-semibold">Outputs</span>
                  <textarea
                    value={form.processOutputs}
                    onChange={(event) => updateForm("processOutputs", event.target.value)}
                    rows={3}
                    className="resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-semibold">Risks</span>
                  <textarea
                    value={form.processRisks}
                    onChange={(event) => updateForm("processRisks", event.target.value)}
                    rows={3}
                    className="resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
                <label className="grid gap-1 text-sm md:col-span-2">
                  <span className="font-semibold">Controls and Measures</span>
                  <textarea
                    value={form.processControls}
                    onChange={(event) => updateForm("processControls", event.target.value)}
                    rows={3}
                    className="resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
              </div>

              <div className="grid gap-3 lg:grid-cols-[1fr_0.8fr]">
                <fieldset className="grid gap-2 rounded-lg border border-slate-300/70 p-3 dark:border-slate-700">
                  <legend className="px-1 text-sm font-semibold">ISO 9001 Clauses</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {ISO_9001_CLAUSE_OPTIONS.map((clause) => (
                      <label key={clause} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={form.isoClauseRefs.includes(clause)}
                          onChange={() => toggleClause(clause)}
                          className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                        />
                        <span>{clause}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <label className="grid gap-1 text-sm">
                  <span className="font-semibold">Related Work Instructions</span>
                  <select
                    multiple
                    value={form.relatedInstructionIds}
                    onChange={handleRelatedInstructionChange}
                    className="min-h-44 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                  >
                    {instructions.map((instruction) => (
                      <option key={instruction.id} value={instruction.id}>
                        {instruction.part_id} | {instruction.department_name} |{" "}
                        {instruction.item_title} | Rev {instruction.revision}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <section className="grid gap-3 rounded-lg border border-slate-300/70 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/45">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Header and Footer
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Add controlled-document context that will be included with saved revisions,
                    imported files, template documents, printouts, and exports.
                  </p>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <label className="grid gap-1 text-sm">
                    <span className="font-semibold">Header</span>
                    <textarea
                      value={form.documentHeader}
                      onChange={(event) => updateForm("documentHeader", event.target.value)}
                      rows={2}
                      placeholder="Company, document owner, site, confidentiality, or release note"
                      className="min-w-0 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="font-semibold">Footer</span>
                    <textarea
                      value={form.documentFooter}
                      onChange={(event) => updateForm("documentFooter", event.target.value)}
                      rows={2}
                      placeholder="Retention rule, approval note, printed-copy warning, or revision reminder"
                      className="min-w-0 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                    />
                  </label>
                </div>
              </section>

              <RichTextEditor
                label="Document Body"
                value={form.bodyHtml}
                onChange={(value) => updateForm("bodyHtml", value)}
                placeholder="Write the controlled document..."
                minHeightClassName="min-h-[28rem]"
              />

              {form.importedFileName ? (
                <section className="grid gap-2 rounded-lg border border-slate-300/70 bg-slate-100/80 p-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
                  <div className="flex flex-wrap items-center gap-2 font-semibold">
                    <FileText size={14} />
                    Imported source: {form.importedFileName}
                    {form.importedFileSize ? ` (${formatFileSize(form.importedFileSize)})` : ""}
                  </div>
                  {importReport ? (
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full border border-slate-300 bg-white/70 px-2 py-0.5 dark:border-slate-700 dark:bg-slate-950/60">
                        {importReport.textLength.toLocaleString()} extracted characters
                      </span>
                      <span className="rounded-full border border-slate-300 bg-white/70 px-2 py-0.5 dark:border-slate-700 dark:bg-slate-950/60">
                        {importReport.fileType || "application/octet-stream"}
                      </span>
                    </div>
                  ) : null}
                  {importReport?.warnings.length ? (
                    <div className="grid gap-1 rounded-lg border border-amber-500/35 bg-amber-500/10 p-2 text-amber-800 dark:text-amber-200">
                      <div className="inline-flex items-center gap-1 font-semibold">
                        <AlertTriangle size={13} />
                        Conversion warnings
                      </div>
                      {importReport.warnings.slice(0, 3).map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {!creating ? (
                <label className="grid gap-1 text-sm">
                  <span className="font-semibold">Change Summary</span>
                  <textarea
                    value={form.changeSummary}
                    onChange={(event) => updateForm("changeSummary", event.target.value)}
                    rows={2}
                    className="resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                <div className="flex flex-wrap gap-2">
                  {PROCESS_DOCUMENT_STATUS_OPTIONS.map((option) => (
                    <span
                      key={option.id}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
                        option.id === form.status
                          ? statusTone(option.id)
                          : "border-slate-300/70 text-slate-500 dark:border-slate-700 dark:text-slate-400",
                      )}
                    >
                      {option.label}
                    </span>
                  ))}
                </div>

                {approvalReadinessIssues.length > 0 ? (
                  <p className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-200">
                    Approval needs: {approvalReadinessIssues.join(", ")}.
                  </p>
                ) : (
                  <p className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                    Ready for approval.
                  </p>
                )}

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveDocument("draft")}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                  >
                    {busy ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
                    Save Draft
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveDocument("in_review")}
                    className="inline-flex items-center gap-2 rounded-lg border border-amber-500/45 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-60 dark:text-amber-200"
                  >
                    <ShieldCheck size={15} />
                    Submit Review
                  </button>
                  {canApprove ? (
                    <button
                      type="button"
                      disabled={busy || !canApproveCurrentForm}
                      onClick={() => void saveDocument("approved")}
                      className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/45 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-200"
                    >
                      <CheckCircle2 size={15} />
                      Approve
                    </button>
                  ) : null}
                  {canObsolete ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void saveDocument("obsolete")}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-500/45 bg-slate-500/15 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-500/25 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-200"
                    >
                      Obsolete
                    </button>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {selectedDocument ? (
            <div className="grid gap-4 xl:grid-cols-2">
              <section className="grid gap-3 rounded-xl border border-slate-300/70 bg-white/85 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/75">
                <h3 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">
                  Revision History
                </h3>
                <div className="grid gap-2">
                  {selectedRevisions.map((revision) => (
                    <article
                      key={revision.id}
                      className="rounded-lg border border-slate-300/70 bg-white/70 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/50"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-bold text-slate-900 dark:text-slate-100">
                          Revision {revision.revision}
                        </p>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          <LocalDateTime value={revision.created_at} mode="dateTime" />
                        </span>
                      </div>
                      <p className="text-slate-700 dark:text-slate-300">
                        {revision.change_summary || "No summary recorded."}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Prepared by {revision.prepared_by_name ?? "Unknown"}
                        {revision.approved_by_name
                          ? ` | Approved by ${revision.approved_by_name}`
                          : ""}
                      </p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="grid gap-3 rounded-xl border border-slate-300/70 bg-white/85 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/75">
                <h3 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">
                  Audit Trail
                </h3>
                <div className="grid max-h-96 gap-2 overflow-y-auto pr-1">
                  {selectedAuditEvents.map((event) => (
                    <article
                      key={event.id}
                      className="rounded-lg border border-slate-300/70 bg-white/70 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/50"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-bold capitalize text-slate-900 dark:text-slate-100">
                          {event.event_type.replaceAll("_", " ")}
                        </p>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          <LocalDateTime value={event.occurred_at} mode="dateTime" />
                        </span>
                      </div>
                      <p className="text-slate-700 dark:text-slate-300">{event.detail}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Actor: {event.actor_name ?? "Unknown"}
                        {event.from_status && event.to_status
                          ? ` | ${getProcessDocumentStatusLabel(
                              event.from_status,
                            )} to ${getProcessDocumentStatusLabel(event.to_status)}`
                          : ""}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          ) : !showEditor ? (
            <section className="grid gap-4 rounded-xl border border-slate-300/70 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/80">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-500/15 text-cyan-700 dark:text-cyan-200">
                    <ShieldCheck size={20} />
                  </span>
                  <div>
                    <h2 className="text-xl font-extrabold text-slate-950 dark:text-slate-50">
                      Document Control Dashboard
                    </h2>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      Review controlled documents, approval status, template usage, imports, and
                      ISO review timing before opening a record.
                    </p>
                  </div>
                </div>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={startNewDocument}
                    className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/45 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-500/25 dark:text-cyan-100"
                  >
                    <FilePlus2 size={15} />
                    New Document
                  </button>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {[
                  ["Controlled", documentDashboardStats.total],
                  ["In Review", documentDashboardStats.statusCounts.in_review],
                  ["Approved", documentDashboardStats.statusCounts.approved],
                  ["Review Alerts", documentDashboardStats.overdueReviews + documentDashboardStats.dueSoonReviews],
                  ["Imports", documentDashboardStats.importedRevisions],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-lg border border-slate-300/70 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/50"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {label}
                    </p>
                    <p className="text-2xl font-extrabold text-slate-950 dark:text-slate-50">
                      {value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                <section className="grid gap-3 rounded-lg border border-slate-300/70 p-3 dark:border-slate-700">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-extrabold text-slate-950 dark:text-slate-50">
                      Recently Updated
                    </h3>
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {documentDashboardStats.templatedRevisions} template revision
                      {documentDashboardStats.templatedRevisions === 1 ? "" : "s"}
                    </span>
                  </div>
                  {documentDashboardStats.recentDocuments.length > 0 ? (
                    <div className="grid gap-2">
                      {documentDashboardStats.recentDocuments.map((document) => (
                        <button
                          key={document.id}
                          type="button"
                          onClick={() => selectDocument(document.id)}
                          className="grid gap-1 rounded-lg border border-slate-300/70 bg-white/70 p-3 text-left transition hover:border-cyan-500/45 hover:bg-cyan-500/10 dark:border-slate-700 dark:bg-slate-900/45"
                        >
                          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                            <p className="font-bold text-slate-950 dark:text-slate-50">
                              {document.document_number} | {document.title || "Untitled"}
                            </p>
                            <span
                              className={cn(
                                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                statusTone(document.status),
                              )}
                            >
                              {getProcessDocumentStatusLabel(document.status)}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Rev {document.current_revision} |{" "}
                            {getProcessDocumentTypeLabel(document.document_type)} | Updated{" "}
                            <LocalDateTime value={document.updated_at} mode="date" />
                          </p>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="grid gap-2 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
                      <FileText size={22} />
                      <p>No controlled documents are available yet.</p>
                    </div>
                  )}
                </section>

                <section className="grid content-start gap-3 rounded-lg border border-slate-300/70 p-3 text-sm dark:border-slate-700">
                  <h3 className="text-base font-extrabold text-slate-950 dark:text-slate-50">
                    ISO Readiness
                  </h3>
                  <div className="grid gap-2">
                    <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-900/50">
                      <CalendarClock size={16} className="mt-0.5 shrink-0 text-amber-600" />
                      <p>
                        {documentDashboardStats.overdueReviews} overdue review
                        {documentDashboardStats.overdueReviews === 1 ? "" : "s"} and{" "}
                        {documentDashboardStats.dueSoonReviews} review
                        {documentDashboardStats.dueSoonReviews === 1 ? "" : "s"} due within 30
                        days.
                      </p>
                    </div>
                    <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-900/50">
                      <ClipboardList size={16} className="mt-0.5 shrink-0 text-cyan-700" />
                      <p>
                        Use templates for standard procedure, work instruction, form, quality
                        record, and process-map structure before submitting for approval.
                      </p>
                    </div>
                    <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-900/50">
                      <Upload size={16} className="mt-0.5 shrink-0 text-emerald-700" />
                      <p>
                        Imported documents are preserved as controlled revisions with source
                        metadata, change summaries, and approval evidence.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href="/process-maps"
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                    >
                      Process Maps
                    </Link>
                    <Link
                      href="/dashboard"
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                    >
                      Dashboard
                    </Link>
                  </div>
                </section>
              </div>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}
