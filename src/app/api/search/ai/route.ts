import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import {
  getDashboardAiSearchEnabled,
  normalizeOpenAiTokenUsage,
  recordAiUsageEvent,
  type OpenAiTokenUsage,
} from "@/lib/ai-usage";
import { serverEnv } from "@/lib/env.server";
import {
  type ProcessDocumentStatus,
  type ProcessDocumentType,
  getProcessDocumentStatusLabel,
  getProcessDocumentTypeLabel,
} from "@/lib/process-documents";
import { canEditInstructions } from "@/lib/roles";
import { extractTextFromHtml } from "@/lib/rich-text.server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface AiSearchRequestBody {
  query?: unknown;
  departmentId?: unknown;
}

interface WorkInstructionRow {
  id: string;
  revision: number;
  body_markdown: string | null;
  notes_markdown: string | null;
  updated_at: string;
  work_items:
    | {
        department_id: string | null;
        part_id: string;
        item_title: string;
        departments: { name: string } | { name: string }[] | null;
      }
    | Array<{
        department_id: string | null;
        part_id: string;
        item_title: string;
        departments: { name: string } | { name: string }[] | null;
      }>
    | null;
}

interface ProcessDocumentRow {
  id: string;
  document_number: string;
  title: string;
  document_type: ProcessDocumentType;
  status: ProcessDocumentStatus;
  department_id: string | null;
  process_name: string | null;
  process_scope: string | null;
  process_inputs: string | null;
  process_outputs: string | null;
  process_risks: string | null;
  process_controls: string | null;
  iso_clause_refs: string[] | null;
  current_revision: number;
  updated_at: string;
  departments: { name: string } | { name: string }[] | null;
}

interface ProcessDocumentRevisionRow {
  document_id: string;
  revision: number;
  body_html: string | null;
}

interface RankedCandidate {
  id: string;
  type: "instruction" | "process_document";
  title: string;
  subtitle: string;
  href: string;
  searchableText: string;
  snippet: string;
  score: number;
  reason: string;
  updatedAt: string;
}

interface OpenAIRankedResult {
  id?: string;
  type?: "instruction" | "process_document";
  score?: number;
  reason?: string;
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

const MAX_QUERY_LENGTH = 240;
const MAX_CANDIDATES_FOR_AI = 36;
const MAX_RESULTS = 10;

function normalizeString(value: unknown, maxLength = MAX_QUERY_LENGTH) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeDepartmentId(value: unknown) {
  const normalized = normalizeString(value, 80);
  if (!normalized || normalized === "all") {
    return null;
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    normalized,
  )
    ? normalized
    : null;
}

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? value[0] ?? null : value;
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function truncate(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function scoreCandidate(candidate: Omit<RankedCandidate, "score" | "reason">, query: string) {
  const tokens = Array.from(new Set(tokenize(query)));
  if (tokens.length === 0) {
    return 0;
  }

  const haystack = candidate.searchableText.toLowerCase();
  const title = candidate.title.toLowerCase();
  const subtitle = candidate.subtitle.toLowerCase();
  let score = 0;

  for (const token of tokens) {
    if (title.includes(token)) {
      score += 8;
    }
    if (subtitle.includes(token)) {
      score += 5;
    }
    if (haystack.includes(token)) {
      score += 2;
    }
  }

  if (haystack.includes(query.toLowerCase())) {
    score += 12;
  }

  return score;
}

function lexicalRank(candidates: Array<Omit<RankedCandidate, "score" | "reason">>, query: string) {
  return candidates
    .map((candidate) => {
      const score = scoreCandidate(candidate, query);
      return {
        ...candidate,
        score,
        reason:
          score > 0
            ? "Matched document metadata or content terms."
            : "Included as a recent related document.",
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })
    .slice(0, MAX_RESULTS);
}

function buildOpenAISystemPrompt() {
  return [
    "You rank QMS documentation search results for a manufacturing work-instruction system.",
    "Prefer exact part, mold, process, department, quality, risk, control, procedure, and ISO clause matches.",
    "Return only JSON with a results array. Each result must include id, type, score from 0-100, and a concise reason.",
    "Only choose IDs from the provided candidates.",
  ].join("\n");
}

function buildOpenAIUserPrompt(query: string, candidates: RankedCandidate[]) {
  return [
    `Search query: ${query}`,
    "Candidates:",
    JSON.stringify(
      candidates.map((candidate) => ({
        id: candidate.id,
        type: candidate.type,
        title: candidate.title,
        subtitle: candidate.subtitle,
        snippet: truncate(candidate.snippet, 700),
      })),
    ),
  ].join("\n\n");
}

function parseOpenAIRanking(rawContent: string): OpenAIRankedResult[] {
  if (!rawContent.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawContent) as { results?: OpenAIRankedResult[] };
    return Array.isArray(parsed.results) ? parsed.results : [];
  } catch {
    return [];
  }
}

async function rankWithOpenAI(query: string, candidates: RankedCandidate[]) {
  const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serverEnv.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: serverEnv.OPENAI_SEARCH_MODEL,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: buildOpenAISystemPrompt(),
        },
        {
          role: "user",
          content: buildOpenAIUserPrompt(query, candidates),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "document_search_results",
          schema: {
            type: "object",
            properties: {
              results: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    type: {
                      type: "string",
                      enum: ["instruction", "process_document"],
                    },
                    score: { type: "number" },
                    reason: { type: "string" },
                  },
                  required: ["id", "type", "score", "reason"],
                  additionalProperties: false,
                },
              },
            },
            required: ["results"],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  const payload = (await openAiResponse.json().catch(() => ({}))) as OpenAICompletionResponse;

  if (!openAiResponse.ok) {
    throw new Error(payload.error?.message ?? "AI search ranking failed.");
  }

  return {
    ranking: parseOpenAIRanking(payload.choices?.[0]?.message?.content ?? ""),
    usage: payload.usage ?? null,
  };
}

export async function POST(request: NextRequest) {
  const requester = await getRequestProfile(request);

  if (!requester) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const requestBody = (await request.json().catch(() => ({}))) as AiSearchRequestBody;
  const query = normalizeString(requestBody.query);
  const departmentId = normalizeDepartmentId(requestBody.departmentId);

  if (query.length < 2) {
    return NextResponse.json(
      { error: "Enter at least two characters for AI search." },
      { status: 400 },
    );
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const canSeeDraftDocuments = canEditInstructions(requester.role);
  const dashboardAiSearchEnabled = await getDashboardAiSearchEnabled(supabaseAdmin);

  const [
    { data: instructionRows, error: instructionError },
    { data: documentRows, error: documentError },
  ] = await Promise.all([
    supabaseAdmin
      .from("work_instructions")
      .select(
        "id, revision, body_markdown, notes_markdown, updated_at, work_items(department_id, part_id, item_title, departments(name))",
      )
      .eq("is_archived", false)
      .order("updated_at", { ascending: false })
      .range(0, 499),
    supabaseAdmin
      .from("process_documents")
      .select(
        "id, document_number, title, document_type, status, department_id, process_name, process_scope, process_inputs, process_outputs, process_risks, process_controls, iso_clause_refs, current_revision, updated_at, departments(name)",
      )
      .in(
        "status",
        canSeeDraftDocuments
          ? ["draft", "in_review", "approved", "obsolete"]
          : ["approved"],
      )
      .order("updated_at", { ascending: false })
      .range(0, 499),
  ]);

  if (instructionError) {
    return NextResponse.json({ error: instructionError.message }, { status: 500 });
  }

  if (documentError) {
    return NextResponse.json({ error: documentError.message }, { status: 500 });
  }

  const processDocuments = (documentRows ?? []) as ProcessDocumentRow[];
  const processDocumentIds = processDocuments.map((document) => document.id);
  const { data: revisionRows } =
    processDocumentIds.length > 0
      ? await supabaseAdmin
          .from("process_document_revisions")
          .select("document_id, revision, body_html")
          .in("document_id", processDocumentIds)
          .order("revision", { ascending: false })
      : { data: [] };
  const latestRevisionTextByDocumentId = new Map<string, string>();

  for (const revision of (revisionRows ?? []) as ProcessDocumentRevisionRow[]) {
    if (latestRevisionTextByDocumentId.has(revision.document_id)) {
      continue;
    }

    latestRevisionTextByDocumentId.set(
      revision.document_id,
      extractTextFromHtml(revision.body_html ?? ""),
    );
  }

  const candidates: Array<Omit<RankedCandidate, "score" | "reason">> = [];

  for (const instruction of (instructionRows ?? []) as WorkInstructionRow[]) {
    const workItem = normalizeRelation(instruction.work_items);
    const department = normalizeRelation(workItem?.departments);

    if (!workItem) {
      continue;
    }

    if (departmentId && workItem.department_id !== departmentId) {
      continue;
    }

    const bodyText = extractTextFromHtml(
      `${instruction.body_markdown ?? ""} ${instruction.notes_markdown ?? ""}`,
    );
    const title = workItem.item_title || "Untitled Work Instruction";
    const subtitle = `${workItem.part_id || "N/A"} | ${department?.name ?? "Unknown"} | Rev ${
      instruction.revision
    }`;

    candidates.push({
      id: instruction.id,
      type: "instruction",
      title,
      subtitle,
      href: `/instructions/${instruction.id}`,
      searchableText: `${title} ${subtitle} ${bodyText}`,
      snippet: bodyText || title,
      updatedAt: instruction.updated_at,
    });
  }

  for (const document of processDocuments) {
    const department = normalizeRelation(document.departments);

    if (departmentId && document.department_id !== departmentId) {
      continue;
    }

    const revisionText = latestRevisionTextByDocumentId.get(document.id) ?? "";
    const typeLabel = getProcessDocumentTypeLabel(document.document_type);
    const statusLabel = getProcessDocumentStatusLabel(document.status);
    const subtitle = `${document.document_number} | ${typeLabel} | ${statusLabel} | Rev ${document.current_revision}`;
    const processMetadata = [
      document.process_name,
      document.process_scope,
      document.process_inputs,
      document.process_outputs,
      document.process_risks,
      document.process_controls,
      ...(document.iso_clause_refs ?? []),
      department?.name ?? "",
    ].join(" ");

    candidates.push({
      id: document.id,
      type: "process_document",
      title: document.title,
      subtitle,
      href: `/process-documents?doc=${document.id}`,
      searchableText: `${document.title} ${subtitle} ${processMetadata} ${revisionText}`,
      snippet: revisionText || processMetadata || document.title,
      updatedAt: document.updated_at,
    });
  }

  const lexicalCandidates = lexicalRank(candidates, query);
  let results: RankedCandidate[] = lexicalCandidates;
  let mode: "ai" | "lexical" = "lexical";
  let warning: string | null = null;
  let tokenUsage = normalizeOpenAiTokenUsage(null);

  if (dashboardAiSearchEnabled && serverEnv.OPENAI_API_KEY && lexicalCandidates.length > 0) {
    try {
      const candidatesForAi = lexicalCandidates.slice(0, MAX_CANDIDATES_FOR_AI);
      const candidateByKey = new Map(
        candidatesForAi.map((candidate) => [`${candidate.type}:${candidate.id}`, candidate]),
      );
      const aiResult = await rankWithOpenAI(query, candidatesForAi);
      const aiRanking = aiResult.ranking;
      tokenUsage = normalizeOpenAiTokenUsage(aiResult.usage);
      const rankedByAi = aiRanking
        .map((rankedResult) => {
          const candidate = candidateByKey.get(`${rankedResult.type}:${rankedResult.id}`);
          if (!candidate) {
            return null;
          }

          return {
            ...candidate,
            score: Math.max(0, Math.min(100, Number(rankedResult.score ?? candidate.score))),
            reason: normalizeString(rankedResult.reason, 220) || candidate.reason,
          };
        })
        .filter((candidate): candidate is RankedCandidate => candidate !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_RESULTS);

      if (rankedByAi.length > 0) {
        results = rankedByAi;
        mode = "ai";
      }
    } catch (caughtError) {
      warning =
        caughtError instanceof Error
          ? caughtError.message
          : "AI ranking failed; lexical results returned.";
    }
  } else if (!dashboardAiSearchEnabled && lexicalCandidates.length > 0) {
    warning =
      "Dashboard AI Search is turned off by a system admin, so controlled text ranking was used.";
  }

  const { data: insertedSearchEvent } = await supabaseAdmin
    .from("document_search_events")
    .insert({
      actor_user_id: requester.id,
      query,
      mode,
      result_count: results.length,
    })
    .select("id, created_at")
    .single<{ id: string; created_at: string }>();

  await recordAiUsageEvent({
    actorUserId: requester.id,
    feature: "dashboard_search",
    action: "query",
    mode,
    model: mode === "ai" ? serverEnv.OPENAI_SEARCH_MODEL : "",
    tokenInput: tokenUsage.tokenInput,
    tokenOutput: tokenUsage.tokenOutput,
    tokenTotal: tokenUsage.tokenTotal,
    metadata: {
      query,
      departmentId,
      resultCount: results.length,
      candidateCount: candidates.length,
      searchEventId: insertedSearchEvent?.id ?? null,
      openAiConfigured: Boolean(serverEnv.OPENAI_API_KEY),
      dashboardAiSearchEnabled,
    },
    createdAt: insertedSearchEvent?.created_at,
  });

  return NextResponse.json({
    mode,
    warning,
    openAiConfigured: Boolean(serverEnv.OPENAI_API_KEY),
    dashboardAiSearchEnabled,
    results: results.map((result) => ({
      id: result.id,
      type: result.type,
      title: result.title,
      subtitle: result.subtitle,
      href: result.href,
      score: result.score,
      reason: result.reason,
      snippet: truncate(result.snippet, 220),
    })),
  });
}
