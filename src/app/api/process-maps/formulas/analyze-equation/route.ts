import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { serverEnv } from "@/lib/env.server";

interface AnalyzeEquationBody {
  equation?: unknown;
  inputs?: unknown;
  outputs?: unknown;
}

interface OpenAICompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface AnalyzedInput {
  name: string;
  label: string;
  value: string;
}

interface AnalyzedOutput {
  name: string;
  label: string;
  expression: string;
}

interface AnalyzedFormula {
  description: string;
  inputs: AnalyzedInput[];
  outputs: AnalyzedOutput[];
  note: string;
  openAiConfigured?: boolean;
}

const RESERVED_TOKENS = new Set([
  "abs",
  "acos",
  "asin",
  "atan",
  "atan2",
  "cbrt",
  "ceil",
  "cos",
  "e",
  "exp",
  "floor",
  "log",
  "log10",
  "max",
  "min",
  "pi",
  "pow",
  "round",
  "sin",
  "sqrt",
  "tan",
  "trunc",
]);

const GREEK_NAME_MAP: Record<string, string> = {
  α: "alpha",
  β: "beta",
  γ: "gamma",
  δ: "delta",
  θ: "theta",
  λ: "lambda",
  μ: "mu",
  σ: "sigma",
  Σ: "sum",
  ω: "omega",
  Ω: "omega",
  π: "pi",
  Π: "pi",
};

function normalizeString(value: unknown, maxLength = 4000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function replaceNamedSymbols(value: string) {
  return Object.entries(GREEK_NAME_MAP).reduce(
    (current, [symbol, name]) => current.replaceAll(symbol, name),
    value,
  );
}

function normalizeName(value: unknown, fallback: string) {
  const normalized = replaceNamedSymbols(normalizeString(value, 80))
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^[^a-zA-Z_]+/, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  return normalized || fallback;
}

function normalizeExpression(value: unknown) {
  return replaceNamedSymbols(normalizeString(value, 500))
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/√\s*\(/g, "sqrt(")
    .replace(/\^/g, "**")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/≠/g, "!=")
    .replace(/[^\d+\-*/%().,\s_a-zA-Z]/g, "")
    .trim();
}

function titleFromName(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getVariableTokens(expression: string, outputName: string) {
  const matches = expression.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) ?? [];
  return Array.from(new Set(matches)).filter(
    (token) => token !== outputName && !RESERVED_TOKENS.has(token),
  );
}

function buildFallbackAnalysis(equation: string, note = "Rules-based interpretation used.") {
  const [rawLeft, ...rightParts] = equation.split("=");
  const hasAssignment = rightParts.length > 0;
  const rawExpression = hasAssignment ? rightParts.join("=") : equation;
  const outputName = normalizeName(hasAssignment ? rawLeft : "result", "result");
  const expression = normalizeExpression(rawExpression) || "0";
  const tokens = getVariableTokens(expression, outputName);
  const inputs = (tokens.length > 0 ? tokens : ["x"]).map((token) => ({
    name: normalizeName(token, token),
    label: titleFromName(normalizeName(token, token)),
    value: "",
  }));

  return {
    description: "Formula draft interpreted from equation text.",
    inputs,
    outputs: [
      {
        name: outputName,
        label: titleFromName(outputName),
        expression,
      },
    ],
    note,
  } satisfies AnalyzedFormula;
}

function normalizeAnalyzedFormula(value: unknown, fallback: AnalyzedFormula) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  const record = value as Record<string, unknown>;
  const inputs = Array.isArray(record.inputs)
    ? record.inputs
        .filter((input): input is Record<string, unknown> =>
          Boolean(input) && typeof input === "object" && !Array.isArray(input),
        )
        .map((input, index) => {
          const name = normalizeName(input.name, `input_${index + 1}`);
          return {
            name,
            label: normalizeString(input.label, 80) || titleFromName(name),
            value:
              typeof input.value === "string" || typeof input.value === "number"
                ? String(input.value)
                : "",
          };
        })
    : fallback.inputs;
  const outputs = Array.isArray(record.outputs)
    ? record.outputs
        .filter((output): output is Record<string, unknown> =>
          Boolean(output) && typeof output === "object" && !Array.isArray(output),
        )
        .map((output, index) => {
          const name = normalizeName(output.name, `output_${index + 1}`);
          return {
            name,
            label: normalizeString(output.label, 80) || titleFromName(name),
            expression: normalizeExpression(output.expression) || fallback.outputs[0]?.expression || "0",
          };
        })
    : fallback.outputs;

  return {
    description: normalizeString(record.description, 500) || fallback.description,
    inputs: inputs.length > 0 ? inputs : fallback.inputs,
    outputs: outputs.length > 0 ? outputs : fallback.outputs,
    note: normalizeString(record.note, 300) || "AI interpreted the equation. Review before saving.",
  } satisfies AnalyzedFormula;
}

function parseOpenAiContent(content: string, fallback: AnalyzedFormula) {
  try {
    return normalizeAnalyzedFormula(JSON.parse(content), fallback);
  } catch {
    return fallback;
  }
}

export async function POST(request: NextRequest) {
  const requester = await getRequestProfile(request);
  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as AnalyzeEquationBody;
  const equation = normalizeString(body.equation);
  if (!equation) {
    return NextResponse.json({ error: "Equation is required." }, { status: 400 });
  }

  const fallback = buildFallbackAnalysis(equation);
  if (!serverEnv.OPENAI_API_KEY) {
    return NextResponse.json({
      ...fallback,
      openAiConfigured: false,
      note: "AI is not configured, so a rules-based interpretation was used.",
    });
  }

  try {
    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serverEnv.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: serverEnv.OPENAI_ENHANCE_MODEL,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content:
              "Convert shop-floor equation text into a formula draft. Return only valid JSON. Use JavaScript-style math expressions with variable names, numbers, arithmetic operators, and helpers: sin, cos, tan, asin, acos, atan, atan2, sqrt, pow, abs, min, max, round, floor, ceil, log, log10, exp. Do not invent production facts.",
          },
          {
            role: "user",
            content: JSON.stringify({
              equation,
              existingInputs: body.inputs,
              existingOutputs: body.outputs,
            }),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "formula_interpretation",
            schema: {
              type: "object",
              properties: {
                description: { type: "string" },
                inputs: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      label: { type: "string" },
                      value: { type: "string" },
                    },
                    required: ["name", "label", "value"],
                    additionalProperties: false,
                  },
                },
                outputs: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      label: { type: "string" },
                      expression: { type: "string" },
                    },
                    required: ["name", "label", "expression"],
                    additionalProperties: false,
                  },
                },
                note: { type: "string" },
              },
              required: ["description", "inputs", "outputs", "note"],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    const openAiPayload = (await openAiResponse.json().catch(() => ({}))) as OpenAICompletionResponse;
    if (!openAiResponse.ok) {
      return NextResponse.json({
        ...buildFallbackAnalysis(
          equation,
          openAiPayload.error?.message ?? "AI analysis failed, so a rules-based interpretation was used.",
        ),
        openAiConfigured: true,
      });
    }

    const analyzed = parseOpenAiContent(
      openAiPayload.choices?.[0]?.message?.content?.trim() ?? "",
      fallback,
    );
    return NextResponse.json({ ...analyzed, openAiConfigured: true });
  } catch (caughtError) {
    return NextResponse.json({
      ...buildFallbackAnalysis(
        equation,
        caughtError instanceof Error
          ? caughtError.message
          : "AI analysis failed, so a rules-based interpretation was used.",
      ),
      openAiConfigured: true,
    });
  }
}
