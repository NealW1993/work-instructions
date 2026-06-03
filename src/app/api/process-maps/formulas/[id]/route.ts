import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import {
  sendNotificationEmailsToRoles,
  sendNotificationEmailsToUsers,
} from "@/lib/notification-email.server";
import { hasFullAccess } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type FormulaType =
  | "oee"
  | "capability"
  | "dpmo"
  | "takt"
  | "yield"
  | "little_law"
  | "normal_curve"
  | "control_limits"
  | "custom";

type CustomFormulaApprovalStatus = "draft" | "pending_review" | "approved" | "rejected";

interface FormulaRequestBody {
  name?: unknown;
  formulaType?: unknown;
  payload?: unknown;
}

interface FormulaRow {
  id: string;
  owner_user_id: string;
  updated_by?: string | null;
  name: string;
  formula_type: FormulaType;
  payload: unknown;
  created_at: string;
  updated_at: string;
}

function isFormulaType(value: unknown): value is FormulaType {
  return (
    value === "oee" ||
    value === "capability" ||
    value === "dpmo" ||
    value === "takt" ||
    value === "yield" ||
    value === "little_law" ||
    value === "normal_curve" ||
    value === "control_limits" ||
    value === "custom"
  );
}

function normalizeName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 120) : "";
}

function normalizePayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeCustomApprovalStatus(
  value: unknown,
  canApprove: boolean,
): CustomFormulaApprovalStatus | null {
  if (value === "draft" || value === "pending_review") {
    return value;
  }

  if (value === "approved" || value === "rejected") {
    return canApprove ? value : null;
  }

  return "draft";
}

function normalizeFormulaPayloadForRequester(
  formulaType: FormulaType,
  payload: Record<string, unknown>,
  canApprove: boolean,
) {
  if (formulaType !== "custom") {
    return payload;
  }

  const customFormula = isRecord(payload.customFormula) ? payload.customFormula : {};
  const approvalStatus = normalizeCustomApprovalStatus(
    customFormula.approvalStatus,
    canApprove,
  );

  if (!approvalStatus) {
    return null;
  }

  return {
    ...payload,
    customFormula: {
      ...customFormula,
      approvalStatus,
    },
  };
}

function getCustomApprovalStatus(payload: unknown): CustomFormulaApprovalStatus {
  if (!isRecord(payload)) {
    return "draft";
  }

  const customFormula = isRecord(payload.customFormula) ? payload.customFormula : {};
  const status = customFormula.approvalStatus;

  return status === "pending_review" ||
    status === "approved" ||
    status === "rejected" ||
    status === "draft"
    ? status
    : "draft";
}

function toFormula(row: FormulaRow) {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    formulaType: row.formula_type,
    payload: row.payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? value
    : null;
}

async function sendFormulaStatusEmails(
  supabaseAdmin: ReturnType<typeof getSupabaseAdminClient>,
  options: {
    formula: FormulaRow;
    previousStatus: CustomFormulaApprovalStatus | null;
    actorName: string;
  },
) {
  if (options.formula.formula_type !== "custom") {
    return;
  }

  const nextStatus = getCustomApprovalStatus(options.formula.payload);
  if (options.previousStatus === nextStatus) {
    return;
  }

  if (nextStatus === "pending_review") {
    await sendNotificationEmailsToRoles(supabaseAdmin, {
      roles: ["admin", "system_admin"],
      settingKey: "pendingApprovals",
      title: "Formula draft pending approval",
      body: `${options.formula.name} was saved for review.`,
      href: `/process-maps/formulas?formula=${options.formula.id}`,
      actorName: options.actorName,
    });
    return;
  }

  if (nextStatus === "approved" || nextStatus === "rejected") {
    const decisionLabel = nextStatus === "approved" ? "approved" : "denied";
    await sendNotificationEmailsToUsers(supabaseAdmin, {
      recipientUserIds: [options.formula.owner_user_id],
      settingKey: "formulaApprovals",
      title: `Formula ${decisionLabel}`,
      body: `${options.formula.name} was ${decisionLabel} by ${options.actorName}.`,
      href: `/process-maps/formulas?formula=${options.formula.id}`,
      actorName: options.actorName,
    });
  }
}

async function readFormulaForRequester(id: string, request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return {
      requester: null,
      formula: null,
      error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  const formulaId = normalizeUuid(id);
  if (!formulaId) {
    return {
      requester,
      formula: null,
      error: NextResponse.json({ error: "Invalid formula id." }, { status: 400 }),
    };
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from("process_map_formulas")
    .select("id, owner_user_id, name, formula_type, payload, created_at, updated_at")
    .eq("id", formulaId)
    .maybeSingle<FormulaRow>();

  if (error) {
    return {
      requester,
      formula: null,
      error: NextResponse.json({ error: error.message }, { status: 500 }),
    };
  }

  if (!data) {
    return {
      requester,
      formula: null,
      error: NextResponse.json({ error: "Formula not found." }, { status: 404 }),
    };
  }

  if (data.owner_user_id !== requester.id && !hasFullAccess(requester.role)) {
    return {
      requester,
      formula: null,
      error: NextResponse.json({ error: "Formula not found." }, { status: 404 }),
    };
  }

  return { requester, formula: data, error: null };
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const existing = await readFormulaForRequester(id, request);
  if (existing.error || !existing.formula) {
    return existing.error;
  }

  const body = (await request.json().catch(() => ({}))) as FormulaRequestBody;
  const updates: Record<string, unknown> = { updated_by: existing.requester.id };
  let nextFormulaType = existing.formula.formula_type;
  const previousCustomStatus =
    existing.formula.formula_type === "custom"
      ? getCustomApprovalStatus(existing.formula.payload)
      : null;

  if (body.name !== undefined) {
    const name = normalizeName(body.name);
    if (!name) {
      return NextResponse.json({ error: "Formula name is required." }, { status: 400 });
    }
    updates.name = name;
  }

  if (body.formulaType !== undefined) {
    if (!isFormulaType(body.formulaType)) {
      return NextResponse.json({ error: "Valid formulaType is required." }, { status: 400 });
    }
    updates.formula_type = body.formulaType;
    nextFormulaType = body.formulaType;
  }

  if (body.payload !== undefined) {
    const payload = normalizePayload(body.payload);
    if (!payload) {
      return NextResponse.json({ error: "Formula payload is required." }, { status: 400 });
    }
    const normalizedPayload = normalizeFormulaPayloadForRequester(
      nextFormulaType,
      payload,
      hasFullAccess(existing.requester.role),
    );
    if (!normalizedPayload) {
      return NextResponse.json(
        { error: "Only reviewers can approve or reject custom formulas." },
        { status: 403 },
      );
    }
    updates.payload = normalizedPayload;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ formula: toFormula(existing.formula) });
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from("process_map_formulas")
    .update(updates)
    .eq("id", existing.formula.id)
    .select("id, owner_user_id, name, formula_type, payload, created_at, updated_at")
    .maybeSingle<FormulaRow>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (data) {
    await sendFormulaStatusEmails(supabaseAdmin, {
      formula: data,
      previousStatus: previousCustomStatus,
      actorName: existing.requester.full_name || existing.requester.email,
    });
  }

  return NextResponse.json({ formula: data ? toFormula(data) : null });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const existing = await readFormulaForRequester(id, request);
  if (existing.error || !existing.formula) {
    return existing.error;
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { error } = await supabaseAdmin
    .from("process_map_formulas")
    .delete()
    .eq("id", existing.formula.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
