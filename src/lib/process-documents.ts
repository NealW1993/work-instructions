export type ProcessDocumentType =
  | "process_map"
  | "procedure"
  | "work_instruction"
  | "form"
  | "quality_record"
  | "policy"
  | "specification"
  | "template";

export type ProcessDocumentStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "obsolete";

export type ProcessDocumentSourceType = "manual" | "template" | "import";

export const PROCESS_DOCUMENT_TYPE_OPTIONS: Array<{
  id: ProcessDocumentType;
  label: string;
}> = [
  { id: "process_map", label: "Process Map" },
  { id: "procedure", label: "Procedure" },
  { id: "work_instruction", label: "Work Instruction" },
  { id: "form", label: "Form" },
  { id: "quality_record", label: "Quality Record" },
  { id: "policy", label: "Policy" },
  { id: "specification", label: "Specification" },
  { id: "template", label: "Template" },
];

export const PROCESS_DOCUMENT_STATUS_OPTIONS: Array<{
  id: ProcessDocumentStatus;
  label: string;
}> = [
  { id: "draft", label: "Draft" },
  { id: "in_review", label: "In Review" },
  { id: "approved", label: "Approved" },
  { id: "obsolete", label: "Obsolete" },
];

export const ISO_9001_CLAUSE_OPTIONS = [
  "4.3 QMS scope",
  "4.4 QMS processes",
  "5.2 Quality policy",
  "6.2 Quality objectives",
  "7.1 Resources",
  "7.2 Competence",
  "7.3 Awareness",
  "7.4 Communication",
  "7.5 Documented information",
  "8.1 Operational planning and control",
  "8.5 Production and service provision",
  "8.6 Release of products and services",
  "8.7 Control of nonconforming outputs",
  "9.1 Monitoring, measurement, analysis and evaluation",
  "9.2 Internal audit",
  "9.3 Management review",
  "10.2 Nonconformity and corrective action",
  "10.3 Continual improvement",
] as const;

export function isProcessDocumentType(value: unknown): value is ProcessDocumentType {
  return PROCESS_DOCUMENT_TYPE_OPTIONS.some((option) => option.id === value);
}

export function isProcessDocumentStatus(value: unknown): value is ProcessDocumentStatus {
  return PROCESS_DOCUMENT_STATUS_OPTIONS.some((option) => option.id === value);
}

export function getProcessDocumentTypeLabel(type: ProcessDocumentType | string) {
  return PROCESS_DOCUMENT_TYPE_OPTIONS.find((option) => option.id === type)?.label ?? type;
}

export function getProcessDocumentStatusLabel(status: ProcessDocumentStatus | string) {
  return PROCESS_DOCUMENT_STATUS_OPTIONS.find((option) => option.id === status)?.label ?? status;
}

export function normalizeIsoClauseRefs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const allowed = new Set<string>(ISO_9001_CLAUSE_OPTIONS);
  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0 && allowed.has(entry)),
    ),
  );
}
