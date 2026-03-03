import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import {
  EXPORT_DATASET_OPTIONS,
  EXPORT_FORMAT_OPTIONS,
  type ExportDatasetId,
  isExportDatasetId,
  isExportFormat,
} from "@/lib/export-data";
import { isSystemAdmin } from "@/lib/roles";
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

function csvEscape(value: string, delimiter: string) {
  if (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
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

  const header = columns.map((column) => csvEscape(column, delimiter)).join(delimiter);
  const rowLines = rows.map((row) =>
    columns
      .map((column) => {
        const raw = row[column];
        return csvEscape(raw === null ? "" : String(raw), delimiter);
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

async function fetchDatasetRows(datasetId: ExportDatasetId) {
  const supabaseAdmin = getSupabaseAdminClient();

  switch (datasetId) {
    case "work_instructions": {
      const { data, error } = await supabaseAdmin
        .from("work_instructions")
        .select(
          "id, work_item_id, fork_root_instruction_id, fork_number, merged_into_root_at, merge_count, is_archived, body_markdown, uncommon_tools, ai_assisted, ai_assisted_at, last_change_summary, revision, created_at, updated_at, created_by, updated_by",
        )
        .order("updated_at", { ascending: false })
        .range(0, 9999);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "work_items": {
      const { data, error } = await supabaseAdmin
        .from("work_items")
        .select("id, department_id, part_id, item_title, updated_at")
        .order("updated_at", { ascending: false })
        .range(0, 9999);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "departments": {
      const { data, error } = await supabaseAdmin
        .from("departments")
        .select("id, name, sort_order, color_hex, created_at, updated_at")
        .order("sort_order", { ascending: true })
        .range(0, 9999);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "instruction_change_events": {
      const { data, error } = await supabaseAdmin
        .from("instruction_change_events")
        .select("id, instruction_id, event_type, detail, occurred_at, actor_user_id, revision, source_payload")
        .order("occurred_at", { ascending: false })
        .range(0, 19999);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "instruction_review_status": {
      const { data, error } = await supabaseAdmin
        .from("instruction_review_status")
        .select("instruction_id, status, last_calibrated_at, flagged_at, updated_by")
        .range(0, 9999);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "suggested_tools": {
      const { data, error } = await supabaseAdmin
        .from("suggested_tools")
        .select("id, name, category_id, subcategory_id, sort_order, is_active, created_at, updated_at")
        .order("name", { ascending: true })
        .range(0, 9999);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "instruction_likes": {
      const { data, error } = await supabaseAdmin
        .from("instruction_likes")
        .select("instruction_id, user_id, created_at")
        .order("created_at", { ascending: false })
        .range(0, 19999);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    case "user_pinned_instructions": {
      const { data, error } = await supabaseAdmin
        .from("user_pinned_instructions")
        .select("instruction_id, user_id, created_at")
        .order("created_at", { ascending: false })
        .range(0, 19999);

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
        .order("created_at", { ascending: false })
        .range(0, 9999);

      if (error) {
        throw new Error(error.message);
      }

      return normalizeExportRows((data ?? []) as Array<Record<string, unknown>>);
    }

    default:
      return [];
  }
}

export async function POST(request: NextRequest) {
  const profile = await getRequestProfile(request);

  if (!profile) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!isSystemAdmin(profile.role)) {
    return NextResponse.json(
      { error: "System admin privileges are required to export data." },
      { status: 403 },
    );
  }

  const requestBody = (await request.json().catch(() => ({}))) as ExportRequestBody;
  const requestedFormat = (requestBody.format ?? "csv").trim().toLowerCase();
  const exportAll = requestBody.exportAll === true;

  if (!isExportFormat(requestedFormat)) {
    return NextResponse.json({ error: "Unsupported export format." }, { status: 400 });
  }

  const requestedDatasets = Array.isArray(requestBody.datasets)
    ? requestBody.datasets
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
