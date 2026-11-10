import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import {
  EXPORT_DATASET_OPTIONS,
  EXPORT_FORMAT_OPTIONS,
  type ExportDatasetId,
  isExportDatasetId,
  isExportFormat,
} from "@/lib/export-data";
import { hasFullAccess } from "@/lib/roles";
import { escapeDelimitedCell } from "@/lib/export-format";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface ExportRequestBody {
  format?: string;
  datasets?: string[];
  exportAll?: boolean;
}

type ExportRow = Record<string, string | number | boolean | null>;

function normalizeExportCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  return JSON.stringify(value);
}

function normalizeExportRows(rows: Array<Record<string, unknown>>): ExportRow[] {
  return rows.map((row) => {
    const normalizedRow: ExportRow = {};
    for (const [key, value] of Object.entries(row)) {
      normalizedRow[key] = normalizeExportCell(value);
    }
    return normalizedRow;
  });
}

function toDelimitedTable(rows: ExportRow[], delimiter: string) {
  const columns = Array.from(
    rows.reduce((allColumns, row) => {
      for (const key of Object.keys(row)) {
        allColumns.add(key);
      }
      return allColumns;
    }, new Set<string>()),
  );

  if (columns.length === 0) {
    return "";
  }

  const header = columns.map((column) => escapeDelimitedCell(column, delimiter)).join(delimiter);
  const rowLines = rows.map((row) =>
    columns
      .map((column) => {
        const raw = row[column];
        return escapeDelimitedCell(raw, delimiter);
      })
      .join(delimiter),
  );

  return [header, ...rowLines].join("\n");
}

function toTimestampToken(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

async function fetchDatasetPage(datasetId: ExportDatasetId, offset: number) {
  const supabaseAdmin = getSupabaseAdminClient();

  switch (datasetId) {
    case "work_instructions": {
      const { data, error } = await supabaseAdmin
        .from("work_instructions")
        .select(
          "id, work_item_id, fork_root_instruction_id, fork_number, merged_into_root_at, merge_count, is_archived, body_markdown, uncommon_tools, iso_clause_refs, process_scope, acceptance_criteria, verification_records, risk_controls, ai_assisted, ai_assisted_at, last_change_summary, revision, approval_status, submitted_by, submitted_at, approved_by, approved_at, rejected_by, rejected_at, approval_note, created_at, updated_at, created_by, updated_by",
        )
        .order("id", { ascending: true })
        .range(offset, offset + 499);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "work_items": {
      const { data, error } = await supabaseAdmin
        .from("work_items")
        .select("id, department_id, part_id, item_title, updated_at")
        .order("id", { ascending: true })
        .range(offset, offset + 499);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "departments": {
      const { data, error } = await supabaseAdmin
        .from("departments")
        .select("id, name, sort_order, color_hex, created_at, updated_at")
        .order("id", { ascending: true })
        .range(offset, offset + 499);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "instruction_change_events": {
      const { data, error } = await supabaseAdmin
        .from("instruction_change_events")
        .select("id, instruction_id, event_type, detail, occurred_at, actor_user_id, revision, source_payload")
        .order("id", { ascending: true })
        .range(offset, offset + 499);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "instruction_review_status": {
      const { data, error } = await supabaseAdmin
        .from("instruction_review_status")
        .select("instruction_id, status, last_calibrated_at, flagged_at, updated_by")
        .order("instruction_id", { ascending: true })
        .range(offset, offset + 499);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "process_documents": {
      const { data, error } = await supabaseAdmin
        .from("process_documents")
        .select(
          "id, document_number, title, document_type, status, department_id, owner_user_id, process_name, process_scope, process_inputs, process_outputs, process_risks, process_controls, related_instruction_ids, iso_clause_refs, current_revision, released_revision, released_snapshot, effective_at, next_review_at, approved_by, approved_at, obsoleted_by, obsoleted_at, created_by, updated_by, created_at, updated_at",
        )
        .order("id", { ascending: true })
        .range(offset, offset + 499);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "process_document_revisions": {
      const { data, error } = await supabaseAdmin
        .from("process_document_revisions")
        .select(
          "id, document_id, revision, title, body_html, change_summary, source_type, template_id, imported_file_name, imported_file_type, imported_file_size, metadata_snapshot, prepared_by, approved_by, approved_at, created_at",
        )
        .order("id", { ascending: true })
        .range(offset, offset + 499);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "process_document_audit_events": {
      const { data, error } = await supabaseAdmin
        .from("process_document_audit_events")
        .select(
          "id, document_id, revision_id, actor_user_id, event_type, detail, from_status, to_status, occurred_at, source_payload, created_at",
        )
        .order("id", { ascending: true })
        .range(offset, offset + 499);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "document_search_events": {
      const { data, error } = await supabaseAdmin
        .from("document_search_events")
        .select("id, actor_user_id, query, mode, result_count, created_at")
        .order("id", { ascending: true })
        .range(offset, offset + 499);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "ai_usage_events": {
      const { data, error } = await supabaseAdmin
        .from("ai_usage_events")
        .select(
          "id, actor_user_id, feature, action, mode, subject_type, subject_id, token_input, token_output, token_total, model, metadata, created_at",
        )
        .order("id", { ascending: true })
        .range(offset, offset + 499);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "process_map_formulas": {
      const { data, error } = await supabaseAdmin
        .from("process_map_formulas")
        .select("id, owner_user_id, name, formula_type, payload, created_at, updated_at")
        .order("id", { ascending: true })
        .range(offset, offset + 499);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "suggested_tools": {
      const { data, error } = await supabaseAdmin
        .from("suggested_tools")
        .select("id, name, category_id, subcategory_id, sort_order, is_active, created_at, updated_at")
        .order("id", { ascending: true })
        .range(offset, offset + 499);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "instruction_likes": {
      const { data, error } = await supabaseAdmin
        .from("instruction_likes")
        .select("instruction_id, user_id, created_at")
        .order("instruction_id", { ascending: true })
        .order("user_id", { ascending: true })
        .range(offset, offset + 499);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "user_pinned_instructions": {
      const { data, error } = await supabaseAdmin
        .from("user_pinned_instructions")
        .select("instruction_id, user_id, created_at")
        .order("instruction_id", { ascending: true })
        .order("user_id", { ascending: true })
        .range(offset, offset + 499);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "profiles": {
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select(
          "id, full_name, email, employee_id, role, is_active, created_at, updated_at, inactivity_timeout_minutes, active_session_started_at, total_signed_in_seconds",
        )
        .order("id", { ascending: true })
        .range(offset, offset + 499);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "work_instruction_import_files": {
      const { data, error } = await supabaseAdmin
        .from("work_instruction_import_files")
        .select("id, instruction_id, file_name, content_type, file_size, content_base64, created_by, created_at")
        .order("id", { ascending: true })
        .range(offset, offset + 499);
      if (error) throw new Error(error.message);
      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "process_document_import_files": {
      const { data, error } = await supabaseAdmin
        .from("process_document_import_files")
        .select("id, document_id, revision_id, file_name, content_type, file_size, file_sha256, content_base64, uploaded_by, created_at")
        .order("id", { ascending: true })
        .range(offset, offset + 499);
      if (error) throw new Error(error.message);
      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    default:
      return [];
  }
}

async function fetchDatasetRows(datasetId: ExportDatasetId) {
  const rows: ExportRow[] = [];
  // Advance by the returned count, since the project's API row cap may be smaller
  // than our requested page. Never return a silently truncated audit package.
  while (true) {
    const page = await fetchDatasetPage(datasetId, rows.length);
    if (page.length === 0) return rows;
    rows.push(...page);
    if (rows.length > 500_000) {
      throw new Error(`${datasetId} exceeds the interactive export size. Use a database backup for a complete audit extract.`);
    }
  }
}

export async function POST(request: NextRequest) {
  const profile = await getRequestProfile(request);

  if (!profile) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!hasFullAccess(profile.role)) {
    return NextResponse.json(
      { error: "Admin privileges are required to export data." },
      { status: 403 },
    );
  }

  const requestBody = (await request.json().catch(() => ({}))) as ExportRequestBody;
  const requestedFormat = typeof requestBody?.format === "string" ? requestBody.format.trim().toLowerCase() : "csv";
  const exportAll = requestBody?.exportAll === true;

  if (!isExportFormat(requestedFormat)) {
    return NextResponse.json({ error: "Unsupported export format." }, { status: 400 });
  }

  const requestedDatasets = Array.isArray(requestBody?.datasets)
    ? requestBody.datasets
        .filter((dataset): dataset is string => typeof dataset === "string")
        .map((dataset) => dataset.trim())
        .filter((dataset): dataset is string => dataset.length > 0)
    : [];

  const uniqueDatasetIds = Array.from(new Set(requestedDatasets));
  const selectedDatasets: ExportDatasetId[] = exportAll
    ? EXPORT_DATASET_OPTIONS.map((option) => option.id)
    : uniqueDatasetIds.filter(isExportDatasetId);

  if (selectedDatasets.length === 0) {
    return NextResponse.json(
      { error: "Select at least one dataset or choose Export All." },
      { status: 400 },
    );
  }

  try {
    const datasetPayload = await Promise.all(
      selectedDatasets.map(async (datasetId) => {
        const rows = await fetchDatasetRows(datasetId);
        const definition = EXPORT_DATASET_OPTIONS.find((entry) => entry.id === datasetId);
        return {
          id: datasetId,
          label: definition?.label ?? datasetId,
          rows,
        };
      }),
    );

    const formatDetails = EXPORT_FORMAT_OPTIONS.find((entry) => entry.id === requestedFormat);
    if (!formatDetails) {
      return NextResponse.json({ error: "Unsupported export format." }, { status: 400 });
    }

    const timestampToken = toTimestampToken();
    const datasetToken =
      datasetPayload.length === 1 ? datasetPayload[0]?.id ?? "dataset" : "all-datasets";
    const fileName = `export-${datasetToken}-${timestampToken}.${formatDetails.extension}`;

    if (requestedFormat === "json") {
      const payload = {
        exportedAt: new Date().toISOString(),
        exportedBy: {
          id: profile.id,
          name: profile.full_name,
          role: profile.role,
        },
        datasets: datasetPayload.reduce<Record<string, ExportRow[]>>((accumulator, dataset) => {
          accumulator[dataset.id] = dataset.rows;
          return accumulator;
        }, {}),
      };

      return new NextResponse(JSON.stringify(payload), {
        headers: {
          "Content-Type": formatDetails.contentType,
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const delimiter = formatDetails.delimiter;
    const hasMultipleDatasets = datasetPayload.length > 1;
    const textOutput = datasetPayload
      .map((dataset) => {
        const table = toDelimitedTable(dataset.rows, delimiter);

        if (!hasMultipleDatasets) {
          return table;
        }

        if (!table) {
          return `# Dataset: ${dataset.label} (${dataset.id})\n# No records`;
        }

        return `# Dataset: ${dataset.label} (${dataset.id})\n${table}`;
      })
      .join("\n\n");

    return new NextResponse(textOutput, {
      headers: {
        "Content-Type": formatDetails.contentType,
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (caughtError) {
    return NextResponse.json(
      {
        error:
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to export data.",
      },
      { status: 500 },
    );
  }
}
