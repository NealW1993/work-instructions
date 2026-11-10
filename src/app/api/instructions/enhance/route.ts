import { NextRequest, NextResponse } from "next/server";
import { normalizeEditorHtml as normalizeEditorContent, sanitizeRichHtml } from "@/lib/rich-text.server";
import { buildInstructionEnhancementSystemPrompt, validateEnhancedInstructionAssets } from "@/lib/instruction-enhancement";

import { getRequestProfile } from "@/lib/api-auth";
import { AI_NOT_CONFIGURED_MESSAGE, getAiConfig, requestStructuredJson } from "@/lib/ai-provider.server";
import { normalizeOpenAiTokenUsage, recordAiUsageEvent } from "@/lib/ai-usage";
import { ISO_9001_CLAUSE_OPTIONS } from "@/lib/process-documents";
import { canCreateInstructions } from "@/lib/roles";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface EnhanceInstructionRequestBody {
  instructionBody?: string;
  partId?: string;
  itemTitle?: string;
  departmentName?: string;
  revision?: number;
  isoClauseRefs?: unknown;
  processScope?: string;
  acceptanceCriteria?: string;
  verificationRecords?: string;
  riskControls?: string;
  instructionId?: string | null;
  sourceInstructionId?: string | null;
  mode?: "create" | "edit" | "fork" | string;
}

interface EnhanceInstructionResult {
  enhanced_html?: string;
  enhancement_notes?: string;
}

interface EnhancementInsertRow {
  id: string;
  generated_at: string;
}

const MAX_INPUT_CHARACTERS = 80_000;

function extractTextFromHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6|blockquote|pre|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMeaningfulContent(value: string): boolean {
  if (!value.trim()) {
    return false;
  }

  const plainText = extractTextFromHtml(value);
  return plainText.length > 0;
}

function buildUserPrompt(params: {
  instructionBody: string;
  partId: string;
  itemTitle: string;
  departmentName: string;
  revision: number | null;
  isoClauseRefs: string[];
  processScope: string;
  acceptanceCriteria: string;
  verificationRecords: string;
  riskControls: string;
  mode: string;
}) {
  return [
    "Enhance this work instruction.",
    `Mode: ${params.mode}`,
    `Part ID: ${params.partId || "Unknown"}`,
    `Work Item Title: ${params.itemTitle || "Untitled"}`,
    `Department: ${params.departmentName || "Unknown"}`,
    `Revision: ${params.revision ?? "Unknown"}`,
    `ISO 9001 clauses: ${params.isoClauseRefs.length > 0 ? params.isoClauseRefs.join("; ") : "None provided"}`,
    `Process scope / applicability: ${params.processScope || "Not provided"}`,
    `Acceptance criteria: ${params.acceptanceCriteria || "Not provided"}`,
    `Verification records: ${params.verificationRecords || "Not provided"}`,
    `Risks, controls, and reaction plan: ${params.riskControls || "Not provided"}`,
    "Source content (may include HTML):",
    params.instructionBody,
  ].join("\n\n");
}

function normalizeEnhancementMode(value: string | null | undefined): "create" | "edit" | "fork" {
  if (value === "edit" || value === "fork") {
    return value;
  }

  return "create";
}

function normalizeUuid(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function normalizeIsoClauseRefs(value: unknown): string[] {
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

function parseEnhancementResult(rawContent: string): EnhanceInstructionResult | null {
  const trimmed = rawContent.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as EnhanceInstructionResult;
    return parsed;
  } catch {
    // Fallback for unexpected model output despite JSON schema response format.
    return {
      enhanced_html: trimmed,
      enhancement_notes: "",
    };
  }
}

export async function POST(request: NextRequest) {
  const requester = await getRequestProfile(request);

  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!canCreateInstructions(requester.role)) {
    return NextResponse.json(
      { error: "You do not have permission to enhance work instructions." },
      { status: 403 },
    );
  }

  const rawBody: unknown = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return NextResponse.json({ error: "An instruction object is required." }, { status: 400 });
  }
  const requestBody = rawBody as EnhanceInstructionRequestBody;
  for (const key of ["instructionBody", "partId", "itemTitle", "departmentName", "processScope", "acceptanceCriteria", "verificationRecords", "riskControls", "instructionId", "sourceInstructionId", "mode"] as const) {
    if ((key === "instructionId" || key === "sourceInstructionId") && requestBody[key] === null) continue;
    if (requestBody[key] !== undefined && typeof requestBody[key] !== "string") {
      return NextResponse.json({ error: `${key} must be text.` }, { status: 400 });
    }
  }
  const instructionBody = requestBody.instructionBody?.trim() ?? "";
  const mode = normalizeEnhancementMode(requestBody.mode);

  if (!instructionBody) {
    return NextResponse.json(
      { error: "Instruction body is required for AI enhancement." },
      { status: 400 },
    );
  }

  if (instructionBody.length > MAX_INPUT_CHARACTERS) {
    return NextResponse.json(
      {
        error: `Instruction body is too large for AI enhancement (max ${MAX_INPUT_CHARACTERS.toLocaleString()} characters).`,
      },
      { status: 400 },
    );
  }

  const aiConfig = await getAiConfig("enhance");
  if (!aiConfig) {
    return NextResponse.json({ error: AI_NOT_CONFIGURED_MESSAGE }, { status: 503 });
  }

  const normalizedOriginalContent = sanitizeRichHtml(normalizeEditorContent(instructionBody));
  const isoClauseRefs = normalizeIsoClauseRefs(requestBody.isoClauseRefs);
  const processScope = requestBody.processScope?.trim().slice(0, 4000) ?? "";
  const acceptanceCriteria = requestBody.acceptanceCriteria?.trim().slice(0, 4000) ?? "";
  const verificationRecords = requestBody.verificationRecords?.trim().slice(0, 4000) ?? "";
  const riskControls = requestBody.riskControls?.trim().slice(0, 4000) ?? "";
  const userPrompt = buildUserPrompt({
    instructionBody: normalizedOriginalContent,
    partId: requestBody.partId?.trim() ?? "",
    itemTitle: requestBody.itemTitle?.trim() ?? "",
    departmentName: requestBody.departmentName?.trim() ?? "",
    revision:
      typeof requestBody.revision === "number" && Number.isInteger(requestBody.revision)
        ? requestBody.revision
        : null,
    isoClauseRefs,
    processScope,
    acceptanceCriteria,
    verificationRecords,
    riskControls,
    mode,
  });

  try {
    const aiResult = await requestStructuredJson(aiConfig, {
      system: buildInstructionEnhancementSystemPrompt(),
      user: userPrompt,
      schemaName: "instruction_enhancement",
      schema: {
        type: "object",
        properties: {
          enhanced_html: {
            type: "string",
          },
          enhancement_notes: {
            type: "string",
          },
        },
        required: ["enhanced_html", "enhancement_notes"],
        additionalProperties: false,
      },
      temperature: 0.2,
      maxTokens: 16_384,
      timeoutMs: 180_000,
    });

    if (!aiResult.ok) {
      return NextResponse.json({ error: aiResult.error }, { status: aiResult.status });
    }

    const enhancement = parseEnhancementResult(aiResult.content);
    const enhancedRaw = typeof enhancement?.enhanced_html === "string" ? enhancement.enhanced_html : "";
    if (enhancedRaw.length > 180_000) return NextResponse.json({ error: "AI returned too much content. Your original instructions are unchanged." }, { status: 502 });
    const normalizedEnhancedRaw = normalizeEditorContent(enhancedRaw);
    const sanitizedEnhancedContent = sanitizeRichHtml(normalizedEnhancedRaw).trim();

    if (!isMeaningfulContent(sanitizedEnhancedContent)) {
      return NextResponse.json(
        { error: "AI enhancement returned empty content. Please try again." },
        { status: 502 },
      );
    }

    const sanitizedOriginalContent = sanitizeRichHtml(normalizedOriginalContent).trim();
    const assetError = validateEnhancedInstructionAssets(sanitizedOriginalContent, sanitizedEnhancedContent);
    if (assetError) return NextResponse.json({ error: assetError }, { status: 502 });
    const supabaseAdmin = getSupabaseAdminClient();
    const instructionId = normalizeUuid(requestBody.instructionId);
    const sourceInstructionId = normalizeUuid(requestBody.sourceInstructionId);

    const { data: insertedEnhancement, error: insertedEnhancementError } = await supabaseAdmin
      .from("instruction_ai_enhancements")
      .insert({
        actor_user_id: requester.id,
        instruction_id: instructionId,
        source_instruction_id: sourceInstructionId,
        mode,
        part_id: requestBody.partId?.trim() ?? "",
        item_title: requestBody.itemTitle?.trim() ?? "",
        department_name: requestBody.departmentName?.trim() ?? "",
        revision:
          typeof requestBody.revision === "number" && Number.isInteger(requestBody.revision)
            ? requestBody.revision
            : null,
        outcome: "generated",
      })
      .select("id, generated_at")
      .single();

    const typedInsertedEnhancement = insertedEnhancement as EnhancementInsertRow | null;

    if (insertedEnhancementError || !typedInsertedEnhancement) {
      return NextResponse.json(
        {
          error:
            insertedEnhancementError?.message ??
            "Unable to record AI enhancement activity.",
        },
        { status: 500 },
      );
    }

    const tokenUsage = normalizeOpenAiTokenUsage(aiResult.usage);

    await recordAiUsageEvent({
      actorUserId: requester.id,
      feature: "instruction_enhancement",
      action: "generated",
      mode,
      subjectType: "work_instruction",
      subjectId: instructionId,
      model: aiResult.model,
      tokenInput: tokenUsage.tokenInput,
      tokenOutput: tokenUsage.tokenOutput,
      tokenTotal: tokenUsage.tokenTotal,
      metadata: {
        enhancementId: typedInsertedEnhancement.id,
        sourceInstructionId,
        partId: requestBody.partId?.trim() ?? "",
        itemTitle: requestBody.itemTitle?.trim() ?? "",
        departmentName: requestBody.departmentName?.trim() ?? "",
        isoClauseRefs,
        hasProcessScope: processScope.length > 0,
        hasAcceptanceCriteria: acceptanceCriteria.length > 0,
        hasVerificationRecords: verificationRecords.length > 0,
        hasRiskControls: riskControls.length > 0,
        revision:
          typeof requestBody.revision === "number" && Number.isInteger(requestBody.revision)
            ? requestBody.revision
            : null,
      },
      createdAt: typedInsertedEnhancement.generated_at,
    });

    return NextResponse.json({
      originalContent: sanitizedOriginalContent,
      enhancedContent: sanitizedEnhancedContent,
      enhancementNotes:
        (typeof enhancement?.enhancement_notes === "string" ? enhancement.enhancement_notes.trim().slice(0, 4000) : "") || "AI formatting and structure improvements prepared for review.",
      generationId: typedInsertedEnhancement.id,
    });
  } catch (caughtError) {
    const normalizedMessage =
      caughtError instanceof Error
        ? caughtError.message
        : "Unable to enhance instruction with AI.";

    return NextResponse.json({ error: normalizedMessage }, { status: 500 });
  }
}
