import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { AI_NOT_CONFIGURED_MESSAGE, getAiConfig, requestStructuredJson } from "@/lib/ai-provider.server";
import { normalizeOpenAiTokenUsage, recordAiUsageEvent } from "@/lib/ai-usage";

interface PageExplainRequestBody {
  pageType?: unknown;
  context?: unknown;
}

interface PageExplainPayload {
  explanation?: string;
}

function normalizeString(value: unknown, maxLength = 12_000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizePageType(value: unknown) {
  return value === "process_document" ? "process_document" : "process_map";
}

function parseExplainPayload(value: string): PageExplainPayload | null {
  try {
    return JSON.parse(value) as PageExplainPayload;
  } catch {
    return null;
  }
}

function fallbackExplanation(pageType: "process_map" | "process_document", context: string) {
  if (pageType === "process_document") {
    return [
      "This page is for controlled process documents. Use it to define the process, map ISO clauses, attach related work instructions, and save controlled revisions for review or approval.",
      context
        ? "The current document context is used to keep the title, scope, controls, related instructions, and revision evidence together."
        : "Start by choosing or creating a document, then fill in the process scope, controls, ISO clauses, and document body.",
    ].join(" ");
  }

  return [
    "This page helps turn a process problem into a diagram or chart. Describe the process, choose a diagram type, edit the steps or chart data, then open the large preview or save the result into controlled process documents.",
    context
      ? "The current title, prompt, selected diagram, steps, data rows, and recommendation are used to explain what the map is showing."
      : "Start with the prompt box, then use Recommend chart or choose a diagram manually.",
  ].join(" ");
}

function buildSystemPrompt() {
  return [
    "Explain manufacturing quality software screens in simple terms.",
    "Write for a shop-floor or quality user who wants to understand what this page is for.",
    "Return only JSON with one key: explanation.",
    "Keep the explanation concise, practical, and specific to the supplied page context.",
    "Do not mention implementation details, JSON, APIs, or hidden system behavior.",
  ].join("\n");
}

export async function POST(request: NextRequest) {
  const requester = await getRequestProfile(request);

  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const requestBody = (await request.json().catch(() => ({}))) as PageExplainRequestBody;
  const pageType = normalizePageType(requestBody.pageType);
  const context = normalizeString(requestBody.context);

  const aiConfig = await getAiConfig("diagram");
  if (!aiConfig) {
    return NextResponse.json({
      explanation: fallbackExplanation(pageType, context),
      mode: "rules",
      warning: AI_NOT_CONFIGURED_MESSAGE,
    });
  }

  const result = await requestStructuredJson(aiConfig, {
    system: buildSystemPrompt(),
    user: [
      `Page type: ${pageType}`,
      "Explain this page in simple terms using this context:",
      context || "No current page context was provided.",
    ].join("\n\n"),
    schemaName: "page_explanation",
    schema: {
      type: "object",
      properties: {
        explanation: { type: "string" },
      },
      required: ["explanation"],
      additionalProperties: false,
    },
    temperature: 0.2,
    maxTokens: 2048,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const explanation =
    normalizeString(parseExplainPayload(result.content)?.explanation, 1800) ||
    fallbackExplanation(pageType, context);
  const tokenUsage = normalizeOpenAiTokenUsage(result.usage);

  await recordAiUsageEvent({
    actorUserId: requester.id,
    feature: "page_explanation",
    action: "explain",
    mode: pageType,
    subjectType: pageType,
    model: result.model,
    tokenInput: tokenUsage.tokenInput,
    tokenOutput: tokenUsage.tokenOutput,
    tokenTotal: tokenUsage.tokenTotal,
    metadata: {
      pageType,
      contextLength: context.length,
      provider: result.provider,
    },
  });

  return NextResponse.json({
    explanation,
    mode: "ai",
  });
}
