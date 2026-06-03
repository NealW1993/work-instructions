import { NextRequest, NextResponse } from "next/server";
import sanitizeHtml from "sanitize-html";

import { getRequestProfile } from "@/lib/api-auth";
import {
  normalizeOpenAiTokenUsage,
  recordAiUsageEvent,
  type OpenAiTokenUsage,
} from "@/lib/ai-usage";
import { serverEnv } from "@/lib/env.server";
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
  instructionId?: string;
  sourceInstructionId?: string;
  mode?: "create" | "edit" | "fork" | string;
}

interface EnhanceInstructionResult {
  enhanced_html?: string;
  enhancement_notes?: string;
}

interface OpenAICompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: OpenAiTokenUsage;
  error?: {
    message?: string;
  };
}

interface EnhancementInsertRow {
  id: string;
  generated_at: string;
}

const MAX_INPUT_CHARACTERS = 80_000;

function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function plainTextToHtml(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function normalizeEditorContent(value: string): string {
  if (!value.trim()) {
    return "";
  }

  if (looksLikeHtml(value)) {
    return value;
  }

  return plainTextToHtml(value);
}

function sanitizeRichHtml(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "mark",
      "ul",
      "ol",
      "li",
      "blockquote",
      "code",
      "pre",
      "h1",
      "h2",
      "h3",
      "hr",
      "span",
      "div",
      "figure",
      "img",
      "video",
      "source",
      "label",
      "input",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    allowedAttributes: {
      figure: ["data-type", "data-align", "data-width", "style", "class"],
      img: ["src", "alt", "title", "width", "height", "style", "class"],
      video: ["src", "controls", "width", "height", "style", "class", "playsinline", "preload", "data-mime-type"],
      source: ["src", "type"],
      span: ["style"],
      div: ["style", "data-type"],
      p: ["style"],
      h1: ["style"],
      h2: ["style"],
      h3: ["style"],
      ul: ["data-type"],
      li: ["data-type", "data-checked"],
      label: ["contenteditable"],
      input: ["type", "checked", "disabled"],
      mark: ["style", "data-color"],
      table: ["style"],
      th: ["style", "colspan", "rowspan"],
      td: ["style", "colspan", "rowspan"],
      "*": ["class", "style"],
    },
    allowedSchemes: ["http", "https", "data"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
      video: ["http", "https", "data"],
      source: ["http", "https", "data"],
    },
    allowedStyles: {
      "*": {
        "text-align": [/^left$/, /^right$/, /^center$/, /^justify$/],
        display: [/^block$/, /^inline-block$/, /^table$/, /^table-row$/, /^table-cell$/],
        width: [/^[0-9.]+(px|%)$/],
        height: [/^[0-9.]+(px|%)$/, /^auto$/],
        "max-width": [/^[0-9.]+(px|%)$/],
        "margin-left": [/^auto$/, /^[0-9.]+(px|%)$/],
        "margin-right": [/^auto$/, /^[0-9.]+(px|%)$/],
        "border-collapse": [/^collapse$/],
        border: [/^[0-9.]+px\s+solid\s+#[0-9a-fA-F]{3,8}$/],
        padding: [/^[0-9.]+(px|rem|em)$/],
      },
      span: {
        color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb\([0-9,\s.]+\)$/],
        "font-size": [/^[0-9]+(px|em|rem|%)$/],
      },
      mark: {
        "background-color": [/^#[0-9a-fA-F]{3,8}$/, /^rgb\([0-9,\s.]+\)$/],
      },
    },
  });
}

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

function buildSystemPrompt() {
  return [
    "You are an expert manufacturing technical writer improving work instructions.",
    "Transform the source into polished, professional instruction content for a rich text editor.",
    "Return only JSON with keys: enhanced_html and enhancement_notes.",
    "Requirements for enhanced_html:",
    "- Output valid HTML only (no markdown fences).",
    "- Use structured, left-aligned formatting: one clear h1, h2 sections, short paragraph intros, ordered procedure steps, and bullet lists where useful.",
    "- Use tables only when they improve scanability for tools, checks, acceptance criteria, records, responsibilities, or control plans. Tables must include a header row and concise cell text.",
    "- Keep spacing clean: no empty paragraphs, no decorative divs, no centered blocks, no all-caps paragraphs, and no inline widths except preserved media.",
    "- Keep important facts accurate. Do not invent missing measurements, part numbers, tools, or safety details.",
    "- Use any provided ISO/control context to preserve scope, acceptance criteria, verification records, and reaction controls without inventing missing criteria.",
    "- Preserve the instruction's intent and sequence while improving clarity and readability.",
    "- Preserve any existing image/video/figure tags when present, and keep them as indented standalone blocks.",
    "- Use only tags that are typical in rich text instruction editors: h1, h2, h3, p, ul, ol, li, blockquote, strong, em, u, s, mark, code, pre, figure, img, video, span, div, br, table, thead, tbody, tr, th, td.",
    "Requirements for enhancement_notes:",
    "- 1-2 concise sentences summarizing what improved.",
  ].join("\n");
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

  const requestBody = (await request.json().catch(() => ({}))) as EnhanceInstructionRequestBody;
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

  if (!serverEnv.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        error:
          "AI enhancement is not configured. Add OPENAI_API_KEY to your environment variables.",
      },
      { status: 503 },
    );
  }

  const normalizedOriginalContent = normalizeEditorContent(instructionBody);
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
    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serverEnv.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: serverEnv.OPENAI_ENHANCE_MODEL,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(),
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "instruction_enhancement",
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
          },
        },
      }),
    });

    const openAiPayload = (await openAiResponse.json().catch(() => ({}))) as OpenAICompletionResponse;

    if (!openAiResponse.ok) {
      return NextResponse.json(
        {
          error:
            openAiPayload.error?.message ??
            "OpenAI request failed while enhancing instructions.",
        },
        { status: openAiResponse.status },
      );
    }

    const rawMessageContent = openAiPayload.choices?.[0]?.message?.content?.trim() ?? "";
    const enhancement = parseEnhancementResult(rawMessageContent);
    const normalizedEnhancedRaw = normalizeEditorContent(enhancement?.enhanced_html ?? "");
    const sanitizedEnhancedContent = sanitizeRichHtml(normalizedEnhancedRaw).trim();

    if (!isMeaningfulContent(sanitizedEnhancedContent)) {
      return NextResponse.json(
        { error: "AI enhancement returned empty content. Please try again." },
        { status: 502 },
      );
    }

    const sanitizedOriginalContent = sanitizeRichHtml(normalizedOriginalContent).trim();
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

    const tokenUsage = normalizeOpenAiTokenUsage(openAiPayload.usage);

    await recordAiUsageEvent({
      actorUserId: requester.id,
      feature: "instruction_enhancement",
      action: "generated",
      mode,
      subjectType: "work_instruction",
      subjectId: instructionId,
      model: serverEnv.OPENAI_ENHANCE_MODEL,
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
        enhancement?.enhancement_notes?.trim() || "AI formatting and structure improvements applied.",
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
