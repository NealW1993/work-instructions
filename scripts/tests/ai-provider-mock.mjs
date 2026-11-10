// A local stand-in for AI providers, used by the integration suite so tests never call a real
// provider or spend money. It accepts Anthropic Messages and OpenAI-style chat completion requests,
// answers with data shaped like the requested JSON schema, and remembers the last request so tests
// can confirm which provider, key and model the app used. Keys starting with "reject-" are refused.
import { createServer } from "node:http";

/** Builds a small value that satisfies a JSON schema. */
function sampleFor(schema) {
  if (!schema || typeof schema !== "object") return null;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type.find((entry) => entry !== "null") ?? "null" : schema.type;
  switch (type) {
    case "object": {
      const result = {};
      for (const [name, property] of Object.entries(schema.properties ?? {})) result[name] = sampleFor(property);
      return result;
    }
    case "array":
      return [];
    case "string":
      return "Mock provider answer.";
    case "number":
    case "integer":
      return 1;
    case "boolean":
      return true;
    default:
      return null;
  }
}

function readBody(request) {
  return new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
  });
}

function send(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

export function startAiProviderMock(port) {
  let lastRequest = null;
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/__last") return send(response, 200, lastRequest ?? {});
    if (request.method !== "POST") return send(response, 404, { error: { message: "Not found" } });

    const body = JSON.parse((await readBody(request)) || "{}");
    const isAnthropic = request.url === "/v1/messages";
    const apiKey = isAnthropic
      ? String(request.headers["x-api-key"] ?? "")
      : String(request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const schema = isAnthropic ? body.tools?.[0]?.input_schema : body.response_format?.json_schema?.schema;
    const schemaName = isAnthropic ? body.tools?.[0]?.name : body.response_format?.json_schema?.name;
    lastRequest = { path: request.url, apiKey, model: body.model, schemaName, anthropicVersion: request.headers["anthropic-version"] ?? null };

    if (!apiKey || apiKey.startsWith("reject-")) {
      return send(response, 401, { error: { message: `Invalid API key: ${apiKey}` } });
    }
    const answer = sampleFor(schema);
    if (isAnthropic) {
      return send(response, 200, {
        id: "msg_mock",
        type: "message",
        role: "assistant",
        model: body.model,
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "toolu_mock", name: schemaName, input: answer }],
        usage: { input_tokens: 12, output_tokens: 7 },
      });
    }
    if (request.url !== "/v1/chat/completions") return send(response, 404, { error: { message: "Not found" } });
    return send(response, 200, {
      id: "chatcmpl_mock",
      object: "chat.completion",
      model: body.model,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(answer) } }],
      usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
    });
  });
  server.listen(port, "127.0.0.1");
  return server;
}
