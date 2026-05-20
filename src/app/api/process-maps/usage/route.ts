import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { recordAiUsageEvent } from "@/lib/ai-usage";

interface ProcessMapUsageRequestBody {
  action?: unknown;
  mode?: unknown;
  metadata?: unknown;
}

const ALLOWED_ACTIONS = new Set([
  "download_svg",
  "download_csv",
  "download_report",
  "print",
  "save_controlled_draft",
  "capability_analysis",
]);

function normalizeString(value: unknown, maxLength = 160) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  const requester = await getRequestProfile(request);

  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const requestBody = (await request.json().catch(() => ({}))) as ProcessMapUsageRequestBody;
  const action = normalizeString(requestBody.action, 80);

  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ error: "Unsupported process map usage action." }, { status: 400 });
  }

  const metadata = normalizeMetadata(requestBody.metadata);
  const mode = normalizeString(requestBody.mode, 80) || "manual";
  const feature = action === "capability_analysis" ? "capability_analysis" : "process_map_builder";

  await recordAiUsageEvent({
    actorUserId: requester.id,
    feature,
    action,
    mode,
    subjectType: "process_map",
    metadata,
  });

  return NextResponse.json({ ok: true });
}
