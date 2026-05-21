import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { hasFullAccess } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type FormulaType = "oee" | "capability" | "dpmo" | "takt";

interface FormulaRequestBody {
  name?: unknown;
  formulaType?: unknown;
  payload?: unknown;
}

interface FormulaRow {
  id: string;
  owner_user_id: string;
  name: string;
  formula_type: FormulaType;
  payload: unknown;
  created_at: string;
  updated_at: string;
}

function isFormulaType(value: unknown): value is FormulaType {
  return value === "oee" || value === "capability" || value === "dpmo" || value === "takt";
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
  const updates: Record<string, unknown> = {};

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
  }

  if (body.payload !== undefined) {
    const payload = normalizePayload(body.payload);
    if (!payload) {
      return NextResponse.json({ error: "Formula payload is required." }, { status: 400 });
    }
    updates.payload = payload;
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
