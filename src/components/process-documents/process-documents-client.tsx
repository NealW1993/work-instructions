"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  FilePlus2,
  FileText,
  Folder,
  ImagePlus,
  Link2,
  List,
  Loader2,
  Lock,
  MoreVertical,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Type,
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
  document_cover_image_data_url: string;
  document_cover_image_name: string;
  access_group_ids: string[];
  access_group_names: string[];
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
  import_file_id: string | null;
  import_file_sha256: string;
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

export interface ProcessDocumentAccessGroupOption {
  id: string;
  name: string;
  slug: string;
}

interface ProcessDocumentsClientProps {
  canEdit: boolean;
  canApprove: boolean;
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
  accessGroups: ProcessDocumentAccessGroupOption[];
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
  documentCoverImageDataUrl: string;
  documentCoverImageName: string;
  documentHeader: string;
  documentFooter: string;
  changeSummary: string;
  sourceType: ProcessDocumentSourceType;
  templateId: string | null;
  importedFileName: string | null;
  importedFileType: string | null;
  importedFileSize: number | null;
  importedFileDataBase64: string | null;
  importedFileSha256: string | null;
  accessGroupIds: string[];
}

interface ImportReport {
  fileName: string;
  fileType: string;
  fileSize: number;
  textLength: number;
  warnings: string[];
}

interface PageExplainResponse {
  explanation?: string;
  error?: string;
}

type TemplateStudioPreset =
  | "procedure"
  | "form"
  | "quality_record"
  | "process_map";

type EditorBlockType = "h1" | "h2" | "checklist" | "callout" | "control-table";

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
  documentCoverImageDataUrl: "",
  documentCoverImageName: "",
  documentHeader: "",
  documentFooter: "",
  changeSummary: "",
  sourceType: "manual",
  templateId: null,
  importedFileName: null,
  importedFileType: null,
  importedFileSize: null,
  importedFileDataBase64: null,
  importedFileSha256: null,
  accessGroupIds: [],
};

const PROCESS_DOCUMENT_AUTHORING_TYPE_OPTIONS = PROCESS_DOCUMENT_TYPE_OPTIONS.filter(
  (option) => option.id !== "work_instruction",
);

const MAX_COVER_IMAGE_BYTES = 350_000;

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

function extractHeadingOutline(html: string) {
  const matches = Array.from(html.matchAll(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi));

  return matches
    .map((match, index) => ({
      id: `doc-heading-${index}`,
      level: Number(match[1]),
      text: extractVisibleText(match[2] ?? ""),
    }))
    .filter((heading) => heading.text.length > 0);
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

function buildDocumentCoverImage(imageSrc: string) {
  const trimmed = imageSrc.trim();
  if (!trimmed) {
    return "";
  }

  return `<figure data-document-cover="true" style="margin:0 0 24px;overflow:hidden;border-radius:14px;border:1px solid #cbd5e1;"><img src="${escapeHtml(trimmed)}" alt="Document cover image" style="display:block;width:100%;max-height:260px;object-fit:cover;" /></figure>`;
}

function stripDocumentBuilderChrome(html: string) {
  return html
    .replace(/<figure\b[^>]*data-document-cover=["']true["'][\s\S]*?<\/figure>/gi, "")
    .replace(/<section\b[^>]*data-document-header=["']true["'][\s\S]*?<\/section>/gi, "")
    .replace(/<section\b[^>]*data-document-footer=["']true["'][\s\S]*?<\/section>/gi, "")
    .trim();
}

function composeDocumentBodyHtml(form: ProcessDocumentFormState) {
  return [
    buildDocumentCoverImage(form.documentCoverImageDataUrl),
    buildDocumentChrome("header", form.documentHeader),
    form.bodyHtml,
    buildDocumentChrome("footer", form.documentFooter),
  ]
    .filter(Boolean)
    .join("\n");
}

export function ProcessDocumentsClient({
  canEdit,
  canApprove,
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
  accessGroups,
}: ProcessDocumentsClientProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const coverImageInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState("all");
  const [followUpdates, setFollowUpdates] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
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
  const [pageExplainBusy, setPageExplainBusy] = useState(false);
  const [pageExplanation, setPageExplanation] = useState("");
  const [pageExplainError, setPageExplainError] = useState<string | null>(null);
  const [instructionSearchQuery, setInstructionSearchQuery] = useState("");
  const [instructionAiSearchEnabled, setInstructionAiSearchEnabled] = useState(false);

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

  const primaryChannels = useMemo(
    () => [
      {
        id: "all",
        label: "All controlled docs",
        count: documents.length,
      },
      {
        id: "owned",
        label: "My documents",
        count: documents.filter((document) => document.owner_user_id === currentUserId).length,
      },
      {
        id: "review",
        label: "Needs review",
        count: documents.filter((document) => document.status === "in_review").length,
      },
    ],
    [currentUserId, documents],
  );

  const typeChannels = useMemo(
    () =>
      PROCESS_DOCUMENT_AUTHORING_TYPE_OPTIONS.map((option) => ({
        id: `type:${option.id}`,
        label: option.label,
        count: documents.filter((document) => document.document_type === option.id).length,
      })).filter((channel) => channel.count > 0),
    [documents],
  );

  const departmentChannels = useMemo(
    () =>
      departments
        .map((department) => ({
          id: `department:${department.id}`,
          label: department.name,
          count: documents.filter((document) => document.department_id === department.id).length,
        }))
        .filter((channel) => channel.count > 0),
    [departments, documents],
  );

  const groupChannels = useMemo(
    () =>
      accessGroups
        .map((group) => ({
          id: `group:${group.id}`,
          label: group.name,
          count: documents.filter((document) => document.access_group_ids.includes(group.id))
            .length,
        }))
        .filter((channel) => channel.count > 0),
    [accessGroups, documents],
  );

  const authoringTemplates = useMemo(
    () => templates.filter((template) => template.document_type !== "work_instruction"),
    [templates],
  );

  const relatedInstructionOptions = useMemo(() => {
    const selectedIds = new Set(form.relatedInstructionIds);
    const typedQuery = instructionSearchQuery.trim().toLowerCase();
    const aiContext = [
      form.title,
      form.documentNumber,
      form.processName,
      form.processScope,
      form.processInputs,
      form.processOutputs,
      form.processControls,
      ...form.isoClauseRefs,
    ]
      .join(" ")
      .toLowerCase();
    const queryTokens = (typedQuery || (instructionAiSearchEnabled ? aiContext : ""))
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length > 1);

    if (!typedQuery && !instructionAiSearchEnabled) {
      return instructions.filter((instruction) => selectedIds.has(instruction.id)).slice(0, 20);
    }

    return instructions
      .map((instruction) => {
        const haystack = [
          instruction.part_id,
          instruction.department_name,
          instruction.item_title,
          `rev ${instruction.revision}`,
        ]
          .join(" ")
          .toLowerCase();
        const directMatch = typedQuery.length > 0 && haystack.includes(typedQuery);
        const tokenScore = queryTokens.reduce(
          (score, token) => score + (haystack.includes(token) ? 1 : 0),
          0,
        );
        const score = (selectedIds.has(instruction.id) ? 100 : 0) + (directMatch ? 50 : 0) + tokenScore;
        return { instruction, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((first, second) => second.score - first.score)
      .slice(0, 14)
      .map((entry) => entry.instruction);
  }, [
    form.documentNumber,
    form.isoClauseRefs,
    form.processControls,
    form.processInputs,
    form.processName,
    form.processOutputs,
    form.processScope,
    form.relatedInstructionIds,
    form.title,
    instructionAiSearchEnabled,
    instructionSearchQuery,
    instructions,
  ]);

  const filteredDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const channelDocuments = documents.filter((document) => {
      if (selectedChannelId === "owned") {
        return document.owner_user_id === currentUserId;
      }

      if (selectedChannelId === "review") {
        return document.status === "in_review";
      }

      if (selectedChannelId.startsWith("type:")) {
        return document.document_type === selectedChannelId.replace("type:", "");
      }

      if (selectedChannelId.startsWith("department:")) {
        return document.department_id === selectedChannelId.replace("department:", "");
      }

      if (selectedChannelId.startsWith("group:")) {
        return document.access_group_ids.includes(selectedChannelId.replace("group:", ""));
      }

      return true;
    });

    if (!normalizedQuery) {
      return channelDocuments;
    }

    return channelDocuments.filter((document) => {
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
  }, [currentUserId, documents, query, selectedChannelId]);

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
      bodyHtml: stripDocumentBuilderChrome(selectedRevision?.body_html ?? ""),
      documentCoverImageDataUrl: selectedDocument.document_cover_image_data_url ?? "",
      documentCoverImageName: selectedDocument.document_cover_image_name ?? "",
      documentHeader: "",
      documentFooter: "",
      changeSummary: "",
      sourceType: "manual",
      templateId: null,
      importedFileName: null,
      importedFileType: null,
      importedFileSize: null,
      importedFileDataBase64: null,
      importedFileSha256: null,
      accessGroupIds: selectedDocument.access_group_ids ?? [],
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

  async function explainProcessDocumentsPage() {
    setPageExplainBusy(true);
    setPageExplainError(null);

    try {
      const token = await getAccessToken();
      const selectedInstructions = instructions
        .filter((instruction) => form.relatedInstructionIds.includes(instruction.id))
        .map(
          (instruction) =>
            `${instruction.part_id} ${instruction.item_title} Rev ${instruction.revision}`,
        );
      const context = [
        `Document: ${form.documentNumber || selectedDocument?.document_number || "New document"}`,
        `Title: ${form.title || selectedDocument?.title || "Untitled"}`,
        `Type: ${getProcessDocumentTypeLabel(form.documentType)}`,
        `Status: ${getProcessDocumentStatusLabel(form.status)}`,
        `Process name: ${form.processName || "Not specified"}`,
        `Scope: ${form.processScope || "Not specified"}`,
        `Controls: ${form.processControls || "Not specified"}`,
        `ISO clauses: ${form.isoClauseRefs.join("; ") || "None selected"}`,
        `Related work instructions: ${selectedInstructions.join("; ") || "None selected"}`,
        `Visible body text: ${extractVisibleText(form.bodyHtml || (selectedRevision?.body_html ?? "")).slice(0, 1800)}`,
      ].join("\n");
      const response = await fetch("/api/page-explain", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          pageType: "process_document",
          context,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as PageExplainResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to explain this page.");
      }

      setPageExplanation(payload.explanation ?? "");
    } catch (caughtError) {
      setPageExplainError(
        caughtError instanceof Error ? caughtError.message : "Unable to explain this page.",
      );
    } finally {
      setPageExplainBusy(false);
    }
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

    const template = authoringTemplates.find((entry) => entry.id === templateId);
    if (!template) {
      setError("Work instructions are created from the Work Instruction page.");
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
      importedFileDataBase64: null,
      importedFileSha256: null,
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
        fileDataBase64?: string;
        fileSha256?: string;
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
        importedFileDataBase64: payload.fileDataBase64 ?? null,
        importedFileSha256: payload.fileSha256 ?? null,
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

  async function handleCoverImageFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setError("Choose an image file for the controlled document cover.");
      return;
    }

    if (file.size > MAX_COVER_IMAGE_BYTES) {
      setError(
        `Cover image is too large. Choose an image under ${formatFileSize(
          MAX_COVER_IMAGE_BYTES,
        )}.`,
      );
      return;
    }

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => {
          if (typeof reader.result === "string") {
            resolve(reader.result);
          } else {
            reject(new Error("Unable to read the selected image."));
          }
        });
        reader.addEventListener("error", () => {
          reject(new Error("Unable to read the selected image."));
        });
        reader.readAsDataURL(file);
      });

      updateForm("documentCoverImageDataUrl", dataUrl);
      updateForm("documentCoverImageName", file.name);
      setError(null);
      setMessage("Cover image added.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to read the selected cover image.",
      );
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

  function toggleRelatedInstruction(instructionId: string) {
    setForm((current) => {
      const selected = current.relatedInstructionIds.includes(instructionId);
      return {
        ...current,
        relatedInstructionIds: selected
          ? current.relatedInstructionIds.filter((id) => id !== instructionId)
          : [...current.relatedInstructionIds, instructionId],
      };
    });
  }

  function appendEditorBlock(blockType: EditorBlockType) {
    const snippets = {
      h1: "<h1>New controlled section</h1><p>Describe the purpose, scope, or expected outcome.</p>",
      h2: "<h2>Process detail</h2><p>Add the controlled requirement, method, or responsibility.</p>",
      checklist:
        "<h2>Verification checklist</h2><ul><li>Confirm the current revision is in use.</li><li>Record objective evidence.</li><li>Escalate exceptions to the process owner.</li></ul>",
      callout:
        '<blockquote><p><strong>Controlled note:</strong> Add a warning, quality requirement, or audit-sensitive instruction here.</p></blockquote>',
      "control-table":
        "<h2>Control table</h2><table><thead><tr><th>Control</th><th>Owner</th><th>Evidence</th><th>Frequency</th></tr></thead><tbody><tr><td>Process check</td><td>Owner</td><td>Record</td><td>Per use</td></tr></tbody></table>",
    } satisfies Record<EditorBlockType, string>;

    setForm((current) => ({
      ...current,
      bodyHtml: [current.bodyHtml, snippets[blockType]].filter(Boolean).join("\n"),
    }));
  }

  function applyTemplateStudioPreset(preset: TemplateStudioPreset) {
    const titles = {
      procedure: "Standard Procedure",
      form: "Controlled Form",
      quality_record: "Quality Record",
      process_map: "Process Map",
    } satisfies Record<TemplateStudioPreset, string>;
    const templateTitle = form.title.trim() || titles[preset];
    const bodyHtml = {
      procedure: `<h1>${escapeHtml(templateTitle)}</h1><p>Define the controlled process, responsibilities, and acceptance criteria.</p><h2>Purpose</h2><p>State why this procedure exists.</p><h2>Scope</h2><p>Define the departments, products, and records covered.</p><h2>Responsibilities</h2><table><thead><tr><th>Role</th><th>Responsibility</th></tr></thead><tbody><tr><td>Process owner</td><td>Maintains the procedure and review cadence.</td></tr><tr><td>Quality</td><td>Verifies compliance evidence.</td></tr></tbody></table><h2>Procedure</h2><ol><li>Start with the controlled input.</li><li>Perform the process step.</li><li>Record objective evidence.</li></ol><h2>Records</h2><p>List required records, retention, and storage location.</p>`,
      form: `<h1>${escapeHtml(templateTitle)}</h1><p>Controlled form for repeatable data collection.</p><h2>Form fields</h2><table><thead><tr><th>Field</th><th>Required</th><th>Instructions</th></tr></thead><tbody><tr><td>Date</td><td>Yes</td><td>Enter completion date.</td></tr><tr><td>Reviewed by</td><td>Yes</td><td>Record reviewer name.</td></tr></tbody></table><h2>Submission</h2><p>Define where the completed form is stored.</p>`,
      quality_record: `<h1>${escapeHtml(templateTitle)}</h1><p>Quality record template with traceability and retention details.</p><h2>Record identity</h2><table><thead><tr><th>Record field</th><th>Value</th></tr></thead><tbody><tr><td>Lot / job</td><td></td></tr><tr><td>Process</td><td></td></tr><tr><td>Reviewer</td><td></td></tr></tbody></table><h2>Objective evidence</h2><p>Attach or reference the evidence that proves the requirement was met.</p><h2>Retention</h2><p>Define retention period, storage location, and disposal rule.</p>`,
      process_map: `<h1>${escapeHtml(templateTitle)}</h1><p>Controlled process map summary.</p><h2>Inputs</h2><p>List trigger events, materials, data, and customer requirements.</p><h2>Process flow</h2><ol><li>Start event</li><li>Core process step</li><li>Decision or inspection</li><li>Controlled output</li></ol><h2>Outputs and customers</h2><p>Define the receiving process, records, and acceptance criteria.</p><h2>Measures</h2><table><thead><tr><th>Metric</th><th>Target</th><th>Owner</th></tr></thead><tbody><tr><td>Quality</td><td></td><td></td></tr></tbody></table>`,
    } satisfies Record<TemplateStudioPreset, string>;

    setImportReport(null);
    setForm((current) => ({
      ...current,
      title: current.title || templateTitle,
      documentType: preset,
      bodyHtml: bodyHtml[preset],
      sourceType: "template",
      templateId: null,
      importedFileName: null,
      importedFileType: null,
      importedFileSize: null,
      isoClauseRefs: Array.from(
        new Set([...current.isoClauseRefs, "4.4 QMS processes", "7.5 Documented information"]),
      ),
    }));
  }

  async function copyTextToClipboard(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(successMessage);
      setError(null);
      setActionsOpen(false);
    } catch {
      setError("Unable to copy to clipboard from this browser session.");
    }
  }

  function exportCurrentDocumentHtml() {
    const editing = Boolean(canEdit && (creating || selectedDocument));
    const html = editing ? composeDocumentBodyHtml(form) : selectedRevision?.body_html ?? "";
    const documentTitle =
      form.title.trim() || selectedDocument?.title || selectedRevision?.title || "controlled-document";
    const fileName = `${documentTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "controlled-document"}.html`;
    const blob = new Blob([`<!doctype html><html><body>${html}</body></html>`], {
      type: "text/html;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    setActionsOpen(false);
  }

  const canApproveCurrentForm = canApprove && approvalReadinessIssues.length === 0;
  const canObsolete = isSystemAdmin && Boolean(selectedDocument);
  const canEditSelectedDocument = Boolean(
    canEdit &&
      (creating ||
        !selectedDocument ||
        isSystemAdmin ||
        (selectedDocument.status !== "approved" &&
          (selectedDocument.created_by === currentUserId ||
            selectedDocument.owner_user_id === currentUserId))),
  );
  const showEditor = Boolean(canEditSelectedDocument && (creating || selectedDocument));
  const activeDocumentHtml = showEditor ? form.bodyHtml : selectedRevision?.body_html ?? "";
  const documentOutline = useMemo(
    () => extractHeadingOutline(activeDocumentHtml),
    [activeDocumentHtml],
  );
  const selectedChannelLabel =
    [...primaryChannels, ...typeChannels, ...departmentChannels, ...groupChannels].find(
      (channel) => channel.id === selectedChannelId,
    )?.label ?? "All controlled docs";
  const executiveStats = [
    ["Controlled", documentDashboardStats.total],
    ["Approved", documentDashboardStats.statusCounts.approved],
    ["In Review", documentDashboardStats.statusCounts.in_review],
    ["Review Alerts", documentDashboardStats.overdueReviews + documentDashboardStats.dueSoonReviews],
  ];

  return (
    <div className="process-workspace-shell process-documents-shell relative left-1/2 grid w-screen max-w-[1500px] -translate-x-1/2 gap-3 px-4 py-2 md:px-6">
      <div className="process-workbench-card overflow-hidden rounded-2xl p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-950 dark:text-slate-50">
            Process Documentation
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Controlled QMS documents, revisions, approvals, and audit evidence.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void explainProcessDocumentsPage()}
            disabled={pageExplainBusy}
            className="inline-flex items-center gap-2 rounded-lg border border-fuchsia-500/35 bg-fuchsia-500/10 px-3 py-2 text-xs font-semibold text-fuchsia-800 transition hover:bg-fuchsia-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-fuchsia-100"
          >
            {pageExplainBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            Explain
          </button>
          {canEdit ? (
            <button
              type="button"
              onClick={startNewDocument}
              className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/45 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/25 dark:text-cyan-100"
            >
              <FilePlus2 size={14} />
              New document
            </button>
          ) : null}
        </div>
        </div>
      </div>

      {pageExplainError ? (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {pageExplainError}
        </p>
      ) : null}
      {pageExplanation ? (
        <section className="rounded-2xl border border-fuchsia-500/25 bg-fuchsia-500/10 p-4 text-sm text-slate-700 shadow-sm dark:text-slate-200">
          <div className="mb-2 flex items-center gap-2 font-extrabold text-slate-950 dark:text-slate-50">
            <Sparkles size={16} className="text-fuchsia-700 dark:text-fuchsia-200" />
            Simple explanation
          </div>
          <p>{pageExplanation}</p>
        </section>
      ) : null}

      <section className="process-workbench-card grid gap-3 rounded-2xl p-3 md:grid-cols-[1fr_auto]">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {executiveStats.map(([label, value]) => (
            <div key={label} className="min-w-0 border-l-2 border-cyan-500/45 pl-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {label}
              </p>
              <p className="truncate text-sm font-extrabold text-slate-950 dark:text-slate-50">
                {value}
              </p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <button
            type="button"
            onClick={() => {
              document.getElementById("process-document-search")?.focus();
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white/80 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            <Search size={14} />
            Find
          </button>
        </div>
      </section>

      <div className="grid gap-3 xl:grid-cols-[16rem_minmax(0,1fr)] 2xl:grid-cols-[16rem_minmax(0,1fr)_17rem]">
        <aside id="doc-library" className="process-workbench-card grid h-fit scroll-mt-24 gap-3 rounded-2xl p-3 xl:sticky xl:top-24">
          <div className="grid gap-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Workspace
            </p>
            <h2 className="text-base font-extrabold text-slate-950 dark:text-slate-50">
              Controlled Documents
            </h2>
          </div>
          <label className="relative block">
            <span className="sr-only">Search controlled documents</span>
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              id="process-document-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search documents"
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
          {canEdit ? (
            <button
              type="button"
              onClick={startNewDocument}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-500/45 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-500/25 dark:text-cyan-100"
            >
              <FilePlus2 size={15} />
              New document
            </button>
          ) : null}

          <div className="grid gap-3 border-t border-slate-200 pt-3 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Channels
              </p>
              <Folder size={14} className="text-slate-400" />
            </div>
            <div className="grid gap-1">
              {primaryChannels.map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => setSelectedChannelId(channel.id)}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-semibold transition",
                    selectedChannelId === channel.id
                      ? "bg-cyan-500/15 text-cyan-900 dark:text-cyan-100"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900",
                  )}
                >
                  <span className="truncate">{channel.label}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                    {channel.count}
                  </span>
                </button>
              ))}
            </div>
            {typeChannels.length > 0 ? (
              <div className="grid gap-1">
                <p className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Document Types
                </p>
                {typeChannels.map((channel) => (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => setSelectedChannelId(channel.id)}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-semibold transition",
                      selectedChannelId === channel.id
                        ? "bg-cyan-500/15 text-cyan-900 dark:text-cyan-100"
                        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900",
                    )}
                  >
                    <span className="truncate">{channel.label}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                      {channel.count}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {departmentChannels.length > 0 ? (
              <div className="grid gap-1">
                <p className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Departments
                </p>
                {departmentChannels.map((channel) => (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => setSelectedChannelId(channel.id)}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-semibold transition",
                      selectedChannelId === channel.id
                        ? "bg-cyan-500/15 text-cyan-900 dark:text-cyan-100"
                        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900",
                    )}
                  >
                    <span className="truncate">{channel.label}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                      {channel.count}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {groupChannels.length > 0 ? (
              <div className="grid gap-1">
                <p className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Groups
                </p>
                {groupChannels.map((channel) => (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => setSelectedChannelId(channel.id)}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-semibold transition",
                      selectedChannelId === channel.id
                        ? "bg-cyan-500/15 text-cyan-900 dark:text-cyan-100"
                        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900",
                    )}
                  >
                    <span className="truncate">{channel.label}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                      {channel.count}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {selectedChannelLabel}
              </p>
              <span className="text-[11px] font-semibold text-slate-400">
                {filteredDocuments.length}
              </span>
            </div>
          </div>

          <div className="grid max-h-[44vh] gap-2 overflow-y-auto pr-1">
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
                  {document.access_group_names.length > 0 ? (
                    <p className="inline-flex min-w-0 items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-300">
                      <Lock size={12} className="shrink-0" />
                      <span className="truncate">{document.access_group_names.join(", ")}</span>
                    </p>
                  ) : null}
                </button>
              ))
            )}
          </div>
          <div className="grid gap-1 border-t border-slate-200 pt-3 text-sm dark:border-slate-800">
            <Link
              href="/process-maps"
              className="rounded-lg px-2 py-1.5 font-semibold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              Process Maps
            </Link>
            <Link
              href="/dashboard"
              className="rounded-lg px-2 py-1.5 font-semibold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              Dashboard
            </Link>
          </div>
        </aside>

        <main className="grid min-w-0 gap-3">
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
            <section id="doc-dashboard" className="process-workbench-card grid scroll-mt-24 gap-3 rounded-2xl p-4">
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

              <div className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/50">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Document
                  </p>
                  <p className="truncate font-bold text-slate-900 dark:text-slate-100">
                    {selectedDocument.document_number} | Rev {selectedDocument.current_revision}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/50">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Owner
                  </p>
                  <p className="truncate font-bold text-slate-900 dark:text-slate-100">
                    {selectedDocument.owner_name ?? "Unassigned"}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/50">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Status
                  </p>
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                      statusTone(selectedDocument.status),
                    )}
                  >
                    {getProcessDocumentStatusLabel(selectedDocument.status)}
                  </span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/50">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Next Review
                  </p>
                  <p className="truncate font-bold text-slate-900 dark:text-slate-100">
                    {selectedDocument.next_review_at ? (
                      <LocalDateTime value={selectedDocument.next_review_at} mode="date" />
                    ) : (
                      "Not scheduled"
                    )}
                  </p>
                </div>
              </div>

              <details className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950">
                <summary className="cursor-pointer font-bold text-slate-900 dark:text-slate-100">
                  Full control record
                </summary>
              <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
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
                <div className="md:col-span-2">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Group Visibility
                  </dt>
                  <dd className="font-bold text-slate-900 dark:text-slate-100">
                    {selectedDocument.access_group_names.length > 0
                      ? selectedDocument.access_group_names.join(", ")
                      : "All authorized users"}
                  </dd>
                </div>
              </dl>
              </details>
            </section>
          ) : null}

          {!showEditor && selectedDocument && selectedRevision ? (
            <section id="doc-editor" className="grid scroll-mt-24 gap-4 rounded-2xl border border-slate-300/70 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/80">
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
            <section id="doc-editor" className="grid scroll-mt-24 gap-4 rounded-2xl border border-slate-300/70 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/80">
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
                    {authoringTemplates.map((template) => (
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
                    {form.documentType === "work_instruction" ? (
                      <option value="work_instruction" disabled>
                        Work Instruction - use Work Instruction page
                      </option>
                    ) : null}
                    {PROCESS_DOCUMENT_AUTHORING_TYPE_OPTIONS.map((option) => (
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

                <fieldset className="grid gap-2 rounded-xl border border-slate-300/70 p-3 text-sm dark:border-slate-700 md:col-span-2">
                  <legend className="px-1 font-semibold">Group Visibility</legend>
                  {accessGroups.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      No access groups are available.
                    </p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {accessGroups.map((group) => {
                        const checked = form.accessGroupIds.includes(group.id);
                        return (
                          <label
                            key={group.id}
                            className={cn(
                              "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-semibold transition",
                              checked
                                ? "border-cyan-500/45 bg-cyan-500/15 text-cyan-900 dark:text-cyan-100"
                                : "border-slate-300/70 bg-white/70 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-300 dark:hover:bg-slate-900",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                updateForm(
                                  "accessGroupIds",
                                  checked
                                    ? form.accessGroupIds.filter((groupId) => groupId !== group.id)
                                    : [...form.accessGroupIds, group.id],
                                )
                              }
                              className="h-4 w-4 rounded border-slate-400 text-cyan-600 focus:ring-cyan-500"
                            />
                            <span className="truncate">{group.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </fieldset>

                <label className="grid gap-1 text-sm">
                  <span className="font-semibold">Process Name</span>
                  <input
                    value={form.processName}
                    onChange={(event) => updateForm("processName", event.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
              </div>

              <RichTextEditor
                label="Document Body"
                value={form.bodyHtml}
                onChange={(value) => updateForm("bodyHtml", value)}
                placeholder="Write the controlled document..."
                minHeightClassName="min-h-[34rem]"
              />

              <details className="rounded-xl border border-slate-300/70 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-950/55">
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
                  <div className="grid gap-1">
                    <span className="text-sm font-extrabold text-slate-950 dark:text-slate-50">
                      Document settings
                    </span>
                    <span className="text-xs text-slate-600 dark:text-slate-300">
                      Process metadata, ISO clauses, linked instructions, templates, and export context.
                    </span>
                  </div>
                  <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                    Advanced
                  </span>
                </summary>

                <div className="mt-4 grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm text-slate-700 dark:text-slate-200">
                <span className="inline-flex items-center gap-2">
                  <FileText size={15} className="text-cyan-700 dark:text-cyan-200" />
                  Work instructions are authored from the dedicated Work Instruction page and can be linked here as controlled references.
                </span>
                <Link
                  href="/instructions/new"
                  className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/35 bg-white px-3 py-1.5 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-50 dark:bg-slate-950 dark:text-cyan-100 dark:hover:bg-slate-900"
                >
                  Open Work Instruction
                </Link>
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

                <section className="grid gap-2 rounded-lg border border-slate-300/70 p-3 text-sm dark:border-slate-700">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">Related Work Instructions</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={instructionAiSearchEnabled}
                      onClick={() => setInstructionAiSearchEnabled((current) => !current)}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
                        instructionAiSearchEnabled
                          ? "border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-800 dark:text-fuchsia-100"
                          : "border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300",
                      )}
                    >
                      <Sparkles size={12} />
                      AI search
                    </button>
                  </div>
                  <label className="relative block">
                    <span className="sr-only">Search related work instructions</span>
                    <Search
                      size={15}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      value={instructionSearchQuery}
                      onChange={(event) => setInstructionSearchQuery(event.target.value)}
                      placeholder={
                        instructionAiSearchEnabled
                          ? "AI search from this document context..."
                          : "Search part, title, or department..."
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                    />
                  </label>
                  {form.relatedInstructionIds.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {instructions
                        .filter((instruction) => form.relatedInstructionIds.includes(instruction.id))
                        .map((instruction) => (
                          <button
                            key={instruction.id}
                            type="button"
                            onClick={() => toggleRelatedInstruction(instruction.id)}
                            className="rounded-full border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-900 transition hover:bg-cyan-500/20 dark:text-cyan-100"
                          >
                            {instruction.part_id} | Rev {instruction.revision} x
                          </button>
                        ))}
                    </div>
                  ) : null}
                  <div className="grid max-h-56 gap-2 overflow-y-auto pr-1">
                    {relatedInstructionOptions.length === 0 ? (
                      <p className="rounded-lg border border-slate-300/70 bg-slate-50 p-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-400">
                        {instructionSearchQuery || instructionAiSearchEnabled
                          ? "No matching work instructions found."
                          : "Search to find and link work instructions."}
                      </p>
                    ) : (
                      relatedInstructionOptions.map((instruction) => (
                        <label
                          key={instruction.id}
                          className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-300/70 bg-white/75 p-2 transition hover:border-cyan-400 hover:bg-cyan-500/10 dark:border-slate-700 dark:bg-slate-950/60"
                        >
                          <input
                            type="checkbox"
                            checked={form.relatedInstructionIds.includes(instruction.id)}
                            onChange={() => toggleRelatedInstruction(instruction.id)}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                          />
                          <span className="grid min-w-0 gap-0.5">
                            <span className="truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                              {instruction.part_id} | {instruction.item_title}
                            </span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              {instruction.department_name} | Rev {instruction.revision}
                            </span>
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </section>
              </div>

              <details className="rounded-xl border border-slate-300/70 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/45">
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
                  <div className="grid gap-1">
                    <div className="inline-flex items-center gap-2 text-sm font-extrabold text-slate-950 dark:text-slate-50">
                      <Sparkles size={16} className="text-cyan-700 dark:text-cyan-200" />
                      Template Builder
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      Optional presets, cover image, and reusable text blocks.
                    </p>
                  </div>
                  <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                    Open tools
                  </span>
                </summary>

                <div className="mt-4 grid gap-3 lg:grid-cols-[0.85fr_1.15fr]">
                  <div className="grid gap-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">Cover image</span>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => coverImageInputRef.current?.click()}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                        >
                          <ImagePlus size={14} />
                          Choose image
                        </button>
                        {form.documentCoverImageDataUrl ? (
                          <button
                            type="button"
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                documentCoverImageDataUrl: "",
                                documentCoverImageName: "",
                              }))
                            }
                            className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200"
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <input
                      ref={coverImageInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => void handleCoverImageFile(event)}
                    />
                    <div className="grid min-h-32 place-items-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-white/70 text-slate-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-400">
                      {form.documentCoverImageDataUrl.trim() ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={form.documentCoverImageDataUrl}
                          alt="Document cover preview"
                          className="h-32 w-full object-cover"
                        />
                      ) : (
                        <span className="inline-flex items-center gap-2 text-xs font-semibold">
                          <ImagePlus size={16} />
                          Add cover image
                        </span>
                      )}
                    </div>
                    {form.documentCoverImageName ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Stored with this document: {form.documentCoverImageName}
                      </p>
                    ) : null}
                  </div>

                  <div className="grid gap-3">
                    <div className="grid gap-2">
                      <p className="text-sm font-semibold">Preset layouts</p>
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {(
                          [
                            ["procedure", "Procedure"],
                            ["form", "Form"],
                            ["quality_record", "Quality Record"],
                            ["process_map", "Process Map"],
                          ] as const
                        ).map(([preset, label]) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => applyTemplateStudioPreset(preset)}
                            className={cn(
                              "inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition",
                              form.documentType === preset
                                ? "border-cyan-500/45 bg-cyan-500/15 text-cyan-900 dark:text-cyan-100"
                                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900",
                            )}
                          >
                            <FileText size={14} />
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <p className="text-sm font-semibold">Text blocks</p>
                      <div className="flex flex-wrap gap-2">
                        {(
                          [
                            ["h1", "H1"],
                            ["h2", "H2"],
                            ["checklist", "Checklist"],
                            ["callout", "Callout"],
                            ["control-table", "Control Table"],
                          ] as const
                        ).map(([blockType, label]) => (
                          <button
                            key={blockType}
                            type="button"
                            onClick={() => appendEditorBlock(blockType)}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                          >
                            <Type size={14} />
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </details>

              <details className="rounded-lg border border-slate-300/70 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/45">
                <summary className="cursor-pointer list-none">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Header and Footer
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Optional saved revision and export context.
                  </p>
                </summary>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
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
              </details>
                </div>
              </details>

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
                      {form.importedFileSha256 ? (
                        <span className="rounded-full border border-slate-300 bg-white/70 px-2 py-0.5 dark:border-slate-700 dark:bg-slate-950/60">
                          SHA-256 {form.importedFileSha256.slice(0, 12)}
                        </span>
                      ) : null}
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
            <div id="doc-history" className="grid scroll-mt-24 gap-4 xl:grid-cols-2">
              <section className="grid gap-3 rounded-2xl border border-slate-300/70 bg-white/85 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/75">
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
                      {revision.import_file_id ? (
                        <a
                          href={`/api/process-documents/files/${revision.import_file_id}`}
                          className="inline-flex w-fit items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                        >
                          <Download size={13} />
                          Source file
                          {revision.import_file_sha256
                            ? ` | SHA-256 ${revision.import_file_sha256.slice(0, 12)}`
                            : ""}
                        </a>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>

              <section className="grid gap-3 rounded-2xl border border-slate-300/70 bg-white/85 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/75">
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
            <section id="doc-dashboard" className="process-workbench-card grid scroll-mt-24 content-start gap-3 rounded-2xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Controlled Document Storage
                  </p>
                  <h2 className="mt-1 max-w-3xl text-2xl font-extrabold tracking-tight text-slate-950 dark:text-slate-50">
                    Process documentation workspace
                  </h2>
                  <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
                    Open a document from the library, filter by channel, or start a controlled
                    procedure, form, quality record, or process map.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => document.getElementById("process-document-search")?.focus()}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                  >
                    <Search size={14} />
                    Search library
                  </button>
                  {canEdit ? (
                  <button
                    type="button"
                    onClick={startNewDocument}
                    className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/45 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/25 dark:text-cyan-100"
                  >
                    <FilePlus2 size={14} />
                    New Document
                  </button>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
                <section className="grid content-start gap-3 rounded-xl border border-slate-300/70 p-3 dark:border-slate-700">
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
                          className="grid gap-1 rounded-lg border border-slate-300/70 bg-white/70 p-2.5 text-left transition hover:border-cyan-500/45 hover:bg-cyan-500/10 dark:border-slate-700 dark:bg-slate-900/45"
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
                      <p>No controlled documents are available yet.</p>
                    </div>
                  )}
                </section>

                <section className="grid content-start gap-3 rounded-xl border border-slate-300/70 p-3 text-sm dark:border-slate-700">
                  <h3 className="text-base font-extrabold text-slate-950 dark:text-slate-50">
                    ISO Readiness
                  </h3>
                  <div className="grid gap-2">
                    <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-900/50">
                      <CalendarClock size={16} className="mt-0.5 shrink-0 text-amber-600" />
                      <p>
                        {documentDashboardStats.overdueReviews} overdue review
                        {documentDashboardStats.overdueReviews === 1 ? "" : "s"} and{" "}
                        {documentDashboardStats.dueSoonReviews} review
                        {documentDashboardStats.dueSoonReviews === 1 ? "" : "s"} due within 30
                        days.
                      </p>
                    </div>
                    <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-900/50">
                      <ClipboardList size={16} className="mt-0.5 shrink-0 text-cyan-700" />
                      <p>
                        Use templates for standard procedure, work instruction, form, quality
                        record, and process-map structure before submitting for approval.
                      </p>
                    </div>
                    <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-900/50">
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

        <aside className="hidden h-fit gap-4 2xl:sticky 2xl:top-24 2xl:grid">
          <section className="grid gap-3 rounded-2xl border border-slate-300/70 bg-white/85 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/75">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BookOpen size={16} className="text-slate-500" />
                <h2 className="text-sm font-extrabold text-slate-950 dark:text-slate-50">
                  Table of Contents
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setActionsOpen((current) => !current)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
                aria-label="Open document options"
              >
                <MoreVertical size={16} />
              </button>
            </div>

            {actionsOpen ? (
              <div className="grid gap-1 rounded-xl border border-slate-300 bg-white p-2 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() =>
                    void copyTextToClipboard(
                      selectedDocument
                        ? `${window.location.origin}/process-documents?doc=${selectedDocument.id}`
                        : window.location.href,
                      "Document link copied.",
                    )
                  }
                  className="inline-flex items-center gap-2 rounded-lg px-2 py-2 text-left font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Link2 size={15} />
                  Copy link
                </button>
                <button
                  type="button"
                  disabled={!selectedDocument}
                  onClick={() =>
                    selectedDocument
                      ? void copyTextToClipboard(selectedDocument.id, "Document ID copied.")
                      : undefined
                  }
                  className="inline-flex items-center gap-2 rounded-lg px-2 py-2 text-left font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Copy size={15} />
                  Copy doc id
                </button>
                <button
                  type="button"
                  onClick={exportCurrentDocumentHtml}
                  className="inline-flex items-center gap-2 rounded-lg px-2 py-2 text-left font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Download size={15} />
                  Export HTML
                </button>
              </div>
            ) : null}

            {selectedReviewStatus ? (
              <span
                className={cn(
                  "inline-flex w-fit items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide",
                  selectedReviewStatus.tone,
                )}
              >
                <CheckCircle2 size={13} />
                {selectedReviewStatus.label}
              </span>
            ) : (
              <span className="inline-flex w-fit rounded-full border border-slate-300 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Workspace
              </span>
            )}

            {documentOutline.length > 0 ? (
              <nav className="grid gap-1">
                {documentOutline.map((heading) => (
                  <button
                    key={heading.id}
                    type="button"
                    onClick={() =>
                      document.getElementById("doc-editor")?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      })
                    }
                    className={cn(
                      "truncate rounded-lg py-1.5 text-left text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-slate-50",
                      heading.level === 1 && "px-2 font-bold",
                      heading.level === 2 && "pl-5 pr-2",
                      heading.level >= 3 && "pl-8 pr-2 text-xs",
                    )}
                    title={heading.text}
                  >
                    {heading.text}
                  </button>
                ))}
              </nav>
            ) : (
              <div className="grid gap-2 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <List size={22} />
                <p>Add H1, H2, H3, or H4 headings to generate a table of contents.</p>
              </div>
            )}
          </section>

          <section className="grid gap-2 rounded-2xl border border-slate-300/70 bg-white/85 p-4 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-950/75">
            <h2 className="text-sm font-extrabold text-slate-950 dark:text-slate-50">
              Document Options
            </h2>
            <button
              type="button"
              onClick={() => setFollowUpdates((current) => !current)}
              className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
            >
              <span className="inline-flex items-center gap-2">
                <Bell size={15} />
                Follow updates
              </span>
              <span
                className={cn(
                  "h-5 w-9 rounded-full border p-0.5 transition",
                  followUpdates
                    ? "border-cyan-500 bg-cyan-500/30"
                    : "border-slate-300 bg-slate-200 dark:border-slate-700 dark:bg-slate-800",
                )}
              >
                <span
                  className={cn(
                    "block h-3.5 w-3.5 rounded-full bg-white shadow transition",
                    followUpdates && "translate-x-4",
                  )}
                />
              </span>
            </button>
            <button
              type="button"
              onClick={() => document.getElementById("doc-history")?.scrollIntoView({ behavior: "smooth" })}
              className="inline-flex items-center gap-2 rounded-lg px-2 py-2 font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
            >
              <CalendarClock size={15} />
              History
            </button>
            <button
              type="button"
              onClick={() => document.getElementById("doc-library")?.scrollIntoView({ behavior: "smooth" })}
              className="inline-flex items-center gap-2 rounded-lg px-2 py-2 font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
            >
              <Search size={15} />
              Search library
            </button>
          </section>

          <section className="grid gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4 text-sm text-cyan-950 shadow-sm dark:text-cyan-100">
            <div className="inline-flex items-center gap-2 font-extrabold">
              <Sparkles size={16} />
              Template Builder
            </div>
            <p className="text-xs text-cyan-900/80 dark:text-cyan-100/75">
              Use the editor controls for cover image, preset layouts, headings, callouts,
              checklists, and control tables.
            </p>
            {canEdit ? (
              <button
                type="button"
                onClick={creating || selectedDocument ? undefined : startNewDocument}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-500/40 bg-white/70 px-3 py-2 text-xs font-semibold text-cyan-900 transition hover:bg-white dark:bg-slate-950/60 dark:text-cyan-100 dark:hover:bg-slate-900"
              >
                <Plus size={14} />
                {showEditor ? "Builder Active" : "Start Template"}
              </button>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
