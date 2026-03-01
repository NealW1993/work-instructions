export const EXPORT_DATASET_OPTIONS = [
  {
    id: "work_instructions",
    label: "Work Instructions",
    description: "Instruction records, revisions, and archive state.",
  },
  {
    id: "work_items",
    label: "Work Items",
    description: "Part IDs, item titles, and department mappings.",
  },
  {
    id: "departments",
    label: "Departments",
    description: "Department names, sort order, and colors.",
  },
  {
    id: "instruction_change_events",
    label: "Instruction Change Events",
    description: "Create/update history events for instructions.",
  },
  {
    id: "instruction_review_status",
    label: "Instruction Review Status",
    description: "Review status, calibration dates, and flags.",
  },
  {
    id: "suggested_tools",
    label: "Suggested Tools",
    description: "Tool library with category and subcategory assignments.",
  },
  {
    id: "instruction_likes",
    label: "Instruction Likes",
    description: "User likes linked to instructions.",
  },
  {
    id: "user_pinned_instructions",
    label: "Pinned Instructions",
    description: "User pin relationships to instructions.",
  },
  {
    id: "profiles",
    label: "User Profiles",
    description: "Account users and role metadata.",
  },
] as const;

export type ExportDatasetId = (typeof EXPORT_DATASET_OPTIONS)[number]["id"];

export const EXPORT_FORMAT_OPTIONS = [
  {
    id: "csv",
    label: "CSV",
    description: "Best for Excel and spreadsheets.",
    extension: "csv",
    contentType: "text/csv; charset=utf-8",
    delimiter: ",",
  },
  {
    id: "tsv",
    label: "TSV",
    description: "Tab-separated text for data tools.",
    extension: "tsv",
    contentType: "text/tab-separated-values; charset=utf-8",
    delimiter: "\t",
  },
  {
    id: "json",
    label: "JSON",
    description: "Structured format for integrations and backups.",
    extension: "json",
    contentType: "application/json; charset=utf-8",
    delimiter: ",",
  },
] as const;

export type ExportFormat = (typeof EXPORT_FORMAT_OPTIONS)[number]["id"];

export function isExportDatasetId(value: string): value is ExportDatasetId {
  return EXPORT_DATASET_OPTIONS.some((option) => option.id === value);
}

export function isExportFormat(value: string): value is ExportFormat {
  return EXPORT_FORMAT_OPTIONS.some((option) => option.id === value);
}
