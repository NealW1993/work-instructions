import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import {
  normalizeOpenAiTokenUsage,
  recordAiUsageEvent,
  type OpenAiTokenUsage,
} from "@/lib/ai-usage";
import { serverEnv } from "@/lib/env.server";

interface PageExplainRequestBody {
  pageType?: unknown;
  context?: unknown;
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

  if (!serverEnv.OPENAI_API_KEY) {
    return NextResponse.json({
      explanation: fallbackExplanation(pageType, context),
      mode: "rules",
      warning: "OPENAI_API_KEY is not configured.",
    });
  }

  const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serverEnv.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: serverEnv.OPENAI_DIAGRAM_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        {
          role: "user",
          content: [
            `Page type: ${pageType}`,
            "Explain this page in simple terms using this context:",
            context || "No current page context was provided.",
          ].join("\n\n"),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "page_explanation",
          schema: {
            type: "object",
            properties: {
              explanation: { type: "string" },
            },
            required: ["explanation"],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  const payload = (await openAiResponse.json().catch(() => ({}))) as OpenAICompletionResponse;

  if (!openAiResponse.ok) {
    return NextResponse.json(
      {
        error: payload.error?.message ?? "Unable to explain this page right now.",
      },
      { status: openAiResponse.status },
    );
  }

  const rawContent = payload.choices?.[0]?.message?.content?.trim() ?? "";
  const explanation =
    normalizeString(parseExplainPayload(rawContent)?.explanation, 1800) ||
    fallbackExplanation(pageType, context);
  const tokenUsage = normalizeOpenAiTokenUsage(payload.usage);

  await recordAiUsageEvent({
    actorUserId: requester.id,
    feature: "page_explanation",
    action: "explain",
    mode: pageType,
    subjectType: pageType,
    model: serverEnv.OPENAI_DIAGRAM_MODEL,
    tokenInput: tokenUsage.tokenInput,
    tokenOutput: tokenUsage.tokenOutput,
    tokenTotal: tokenUsage.tokenTotal,
    metadata: {
      pageType,
      contextLength: context.length,
    },
  });

  return NextResponse.json({
    explanation,
    mode: "ai",
  });
}
