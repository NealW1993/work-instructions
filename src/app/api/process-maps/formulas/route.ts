import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
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
  | "control_limits";

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
  return (
    value === "oee" ||
    value === "capability" ||
    value === "dpmo" ||
    value === "takt" ||
    value === "yield" ||
    value === "little_law" ||
    value === "normal_curve" ||
    value === "control_limits"
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

export async function GET(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const includeAll =
    request.nextUrl.searchParams.get("includeAll") === "true" &&
    hasFullAccess(requester.role);
  const supabaseAdmin = getSupabaseAdminClient();
  let query = supabaseAdmin
    .from("process_map_formulas")
    .select("id, owner_user_id, name, formula_type, payload, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(100);

  if (!includeAll) {
    query = query.eq("owner_user_id", requester.id);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    formulas: ((data ?? []) as FormulaRow[]).map(toFormula),
  });
}

export async function POST(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as FormulaRequestBody;
  const name = normalizeName(body.name);
  const formulaType = body.formulaType;
  const payload = normalizePayload(body.payload);

  if (!name) {
    return NextResponse.json({ error: "Formula name is required." }, { status: 400 });
  }

  if (!isFormulaType(formulaType)) {
    return NextResponse.json({ error: "Valid formulaType is required." }, { status: 400 });
  }

  if (!payload) {
    return NextResponse.json({ error: "Formula payload is required." }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from("process_map_formulas")
    .insert({
      owner_user_id: requester.id,
      name,
      formula_type: formulaType,
      payload,
    })
    .select("id, owner_user_id, name, formula_type, payload, created_at, updated_at")
    .maybeSingle<FormulaRow>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ formula: data ? toFormula(data) : null });
}
