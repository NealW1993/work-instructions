import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { getAiConfig, requestStructuredJson } from "@/lib/ai-provider.server";
import {
  normalizeOpenAiTokenUsage,
  recordAiUsageEvent,
  type OpenAiTokenUsage,
} from "@/lib/ai-usage";
import {
  DIAGRAM_DEFINITIONS,
  type DiagramRecommendation,
  type DiagramType,
  type DmaicPhase,
  isDiagramType,
  isDmaicPhase,
  recommendDiagramByRules,
} from "@/lib/process-map-tools";

interface RecommendationRequestBody {
  prompt?: unknown;
  dmaicPhase?: unknown;
  dmaicEnabled?: unknown;
  processArea?: unknown;
}

interface OpenAIRecommendationPayload {
  diagramType?: string;
  dmaicPhase?: string;
  confidence?: number;
  reason?: string;
  suggestedTitle?: string;
  starterItems?: string[];
  keyFields?: string[];
  setupSteps?: string[];
  formulaTool?: string;
  metricRows?: string[];
  specLower?: number | null;
  specUpper?: number | null;
  target?: number | null;
  layerSuggestions?: string[];
}

function normalizeString(value: unknown, maxLength = 4000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseOpenAIRecommendation(rawContent: string): OpenAIRecommendationPayload | null {
  if (!rawContent.trim()) {
    return null;
  }

  try {
    return JSON.parse(rawContent) as OpenAIRecommendationPayload;
  } catch {
    return null;
  }
}

function normalizeOpenAIRecommendation(
  parsed: OpenAIRecommendationPayload | null,
  fallback: DiagramRecommendation,
): DiagramRecommendation {
  if (!parsed) {
    return fallback;
  }

  const diagramType: DiagramType = isDiagramType(parsed.diagramType)
    ? parsed.diagramType
    : fallback.diagramType;
  const dmaicPhase: DmaicPhase = isDmaicPhase(parsed.dmaicPhase)
    ? parsed.dmaicPhase
    : fallback.dmaicPhase;
  const definition =
    DIAGRAM_DEFINITIONS.find((entry) => entry.id === diagramType) ??
    DIAGRAM_DEFINITIONS[0];
  const starterItems =
    Array.isArray(parsed.starterItems) && parsed.starterItems.length > 0
      ? parsed.starterItems.map((item) => normalizeString(item, 120)).filter(Boolean).slice(0, 8)
      : definition.starterItems;
  const keyFields =
    Array.isArray(parsed.keyFields) && parsed.keyFields.length > 0
      ? parsed.keyFields.map((item) => normalizeString(item, 120)).filter(Boolean).slice(0, 8)
      : definition.keyFields;
  const setupSteps =
    Array.isArray(parsed.setupSteps) && parsed.setupSteps.length > 0
      ? parsed.setupSteps.map((item) => normalizeString(item, 180)).filter(Boolean).slice(0, 5)
      : fallback.setupSteps;
  const formulaTool =
    parsed.formulaTool === "capability" ||
    parsed.formulaTool === "dpmo" ||
    parsed.formulaTool === "takt_time" ||
    parsed.formulaTool === "control_limits" ||
    parsed.formulaTool === "oee"
      ? parsed.formulaTool
      : fallback.formulaTool ?? "none";
  const metricRows =
    Array.isArray(parsed.metricRows) && parsed.metricRows.length > 0
      ? parsed.metricRows.map((item) => normalizeString(item, 160)).filter(Boolean).slice(0, 50)
      : fallback.metricRows ?? [];
  const layerSuggestions =
    Array.isArray(parsed.layerSuggestions) && parsed.layerSuggestions.length > 0
      ? parsed.layerSuggestions
          .map((item) => normalizeString(item, 100))
          .filter(Boolean)
          .slice(0, 8)
      : fallback.layerSuggestions ?? [];
  const specLower = Number.isFinite(parsed.specLower) ? Number(parsed.specLower) : fallback.specLower ?? null;
  const specUpper = Number.isFinite(parsed.specUpper) ? Number(parsed.specUpper) : fallback.specUpper ?? null;
  const target = Number.isFinite(parsed.target) ? Number(parsed.target) : fallback.target ?? null;

  return {
    diagramType,
    dmaicPhase,
    confidence: Math.max(1, Math.min(100, Math.round(Number(parsed.confidence ?? 86)))),
    reason: normalizeString(parsed.reason, 500) || fallback.reason,
    suggestedTitle:
      normalizeString(parsed.suggestedTitle, 120) || `${definition.shortLabel} Draft`,
    starterItems,
    keyFields,
    setupSteps,
    formulaTool,
    metricRows,
    specLower,
    specUpper,
    target,
    layerSuggestions,
    mode: "ai",
    openAiConfigured: true,
  };
}

function buildSystemPrompt() {
  return [
    "You recommend one process documentation diagram or Six Sigma chart type.",
    "Pick the chart that best fits the user's selected method and intent.",
    "For Define, prefer SIPOC, DMAIC Project Charter, CTQ Tree, or high-level Process Map.",
    "For Measure, prefer data collection views, Run Chart, Control Chart, Histogram, Pareto, or Value Stream Map.",
    "For Analyze, prefer Fishbone, Pareto, Scatter Plot, FMEA, or detailed Flowchart.",
    "For Improve, prefer Solution Selection Matrix, future-state Flowchart, Swimlane, or Value Stream Map.",
    "For Control, prefer Control Plan or Control Chart.",
    "If the user asks for Cp, Cpk, process capability, tolerance, LSL, USL, or specification limits, choose histogram or control_chart and set formulaTool to capability.",
    "If the user asks for OEE or overall equipment effectiveness, choose control_chart or run_chart and set formulaTool to oee.",
    "When capability is requested, infer specLower, specUpper, and target only if they are clearly stated. Otherwise return null.",
    "For metricRows, return rows as 'label,value,secondary value'. For capability data, use sample labels and the measurement value as the second field.",
    "Return only JSON that matches the schema. Do not include markdown.",
  ].join("\n");
}

function buildUserPrompt(input: {
  prompt: string;
  dmaicPhase: DmaicPhase;
  processArea: string;
}) {
  const diagramOptions = DIAGRAM_DEFINITIONS.map(
    (definition) =>
      `${definition.id}: ${definition.label} | DMAIC: ${definition.dmaicPhases.join(", ")} | ${definition.whenToUse}`,
  ).join("\n");

  return [
    "Improvement method: DMAIC",
    `DMAIC phase: ${input.dmaicPhase}`,
    `Process area: ${input.processArea || "Not specified"}`,
    `User request: ${input.prompt}`,
    "",
    "Allowed diagram types:",
    diagramOptions,
  ].join("\n");
}

async function recordRecommendationUsage(input: {
  requesterId: string;
  prompt: string;
  processArea: string;
  recommendation: DiagramRecommendation;
  model?: string;
  usage?: OpenAiTokenUsage | null;
  warning?: string | null;
}) {
  const tokenUsage = normalizeOpenAiTokenUsage(input.usage);

  await recordAiUsageEvent({
    actorUserId: input.requesterId,
    feature: "process_map_recommendation",
    action: "recommend",
    mode: input.recommendation.mode,
    model: input.recommendation.mode === "ai" ? input.model ?? "" : "",
    tokenInput: tokenUsage.tokenInput,
    tokenOutput: tokenUsage.tokenOutput,
    tokenTotal: tokenUsage.tokenTotal,
    metadata: {
      promptLength: input.prompt.length,
      processArea: input.processArea,
      diagramType: input.recommendation.diagramType,
      dmaicPhase: input.recommendation.dmaicPhase,
      formulaTool: input.recommendation.formulaTool ?? "none",
      usesCapability: input.recommendation.formulaTool === "capability",
      usesOee: input.recommendation.formulaTool === "oee",
      confidence: input.recommendation.confidence,
      warning: input.warning ?? null,
    },
  });
}

export async function POST(request: NextRequest) {
  const requester = await getRequestProfile(request);

  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const requestBody = (await request.json().catch(() => ({}))) as RecommendationRequestBody;
  const prompt = normalizeString(requestBody.prompt, 2000);
  const processArea = normalizeString(requestBody.processArea, 200);
  const dmaicEnabled = true;
  const dmaicPhase: DmaicPhase = isDmaicPhase(requestBody.dmaicPhase)
    ? requestBody.dmaicPhase
    : "define";

  if (prompt.length < 8) {
    return NextResponse.json(
      { error: "Describe the process, problem, or Six Sigma question first." },
      { status: 400 },
    );
  }

  const fallback = recommendDiagramByRules({
    prompt,
    processArea,
    dmaicPhase,
    dmaicEnabled,
  });

  const aiConfig = await getAiConfig("diagram");
  if (!aiConfig) {
    await recordRecommendationUsage({
      requesterId: requester.id,
      prompt,
      processArea,
      recommendation: fallback,
      warning: "AI is not configured.",
    });

    return NextResponse.json({
      ...fallback,
      openAiConfigured: false,
      warning: "AI is not configured, so a rules-based chart recommendation was used.",
    });
  }

  const result = await requestStructuredJson(aiConfig, {
    system: buildSystemPrompt(),
    user: buildUserPrompt({ prompt, processArea, dmaicPhase }),
    schemaName: "diagram_recommendation",
    schema: {
      type: "object",
      properties: {
        diagramType: {
          type: "string",
          enum: DIAGRAM_DEFINITIONS.map((definition) => definition.id),
        },
        dmaicPhase: {
          type: "string",
          enum: ["define", "measure", "analyze", "improve", "control"],
        },
        confidence: {
          type: "number",
        },
        reason: {
          type: "string",
        },
        suggestedTitle: {
          type: "string",
        },
        starterItems: {
          type: "array",
          items: { type: "string" },
        },
        keyFields: {
          type: "array",
          items: { type: "string" },
        },
        setupSteps: {
          type: "array",
          items: { type: "string" },
        },
        formulaTool: {
          type: "string",
          enum: ["none", "capability", "dpmo", "takt_time", "control_limits", "oee"],
        },
        metricRows: {
          type: "array",
          items: { type: "string" },
        },
        specLower: {
          type: ["number", "null"],
        },
        specUpper: {
          type: ["number", "null"],
        },
        target: {
          type: ["number", "null"],
        },
        layerSuggestions: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: [
        "diagramType",
        "dmaicPhase",
        "confidence",
        "reason",
        "suggestedTitle",
        "starterItems",
        "keyFields",
        "setupSteps",
        "formulaTool",
        "metricRows",
        "specLower",
        "specUpper",
        "target",
        "layerSuggestions",
      ],
      additionalProperties: false,
    },
    temperature: 0.1,
    maxTokens: 4096,
  });

  if (!result.ok) {
    const warning = `${result.error} A rules-based recommendation was used.`;

    await recordRecommendationUsage({
      requesterId: requester.id,
      prompt,
      processArea,
      recommendation: fallback,
      warning,
    });

    return NextResponse.json({
      ...fallback,
      openAiConfigured: true,
      warning,
    });
  }

  const parsed = parseOpenAIRecommendation(result.content);
  const recommendation = normalizeOpenAIRecommendation(parsed, fallback);

  await recordRecommendationUsage({
    requesterId: requester.id,
    prompt,
    processArea,
    recommendation,
    model: result.model,
    usage: result.usage,
  });

  return NextResponse.json(recommendation);
}
