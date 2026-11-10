import { BACKEND_GATEWAY_PATH, isLocalBackendHostname } from "@/lib/backend-url";
import { clientEnv } from "@/lib/env.client";

export interface MediaUrlRuntimeContext {
  hostname?: string | null;
  protocol?: string | null;
}

function isLoopbackOnlyHostname(hostname: string) {
  return isLocalBackendHostname(hostname);
}

function normalizeRuntimeHostname(value: string | null | undefined) {
  const normalizedValue = value?.split(",")[0]?.trim() ?? "";
  if (!normalizedValue) {
    return "";
  }

  try {
    return new URL(`http://${normalizedValue}`).hostname;
  } catch {
    return normalizedValue;
  }
}

function normalizeRuntimeProtocol(value: string | null | undefined) {
  const normalizedValue = value?.split(",")[0]?.trim().toLowerCase() ?? "";
  if (normalizedValue === "http" || normalizedValue === "http:") {
    return "http:";
  }

  if (normalizedValue === "https" || normalizedValue === "https:") {
    return "https:";
  }

  return "";
}

function getBrowserRuntimeContext() {
  if (typeof window === "undefined") {
    return null;
  }

  return {
    hostname: window.location.hostname,
    protocol: window.location.protocol,
  } satisfies MediaUrlRuntimeContext;
}

function getResolvedRuntimeContext(runtime?: MediaUrlRuntimeContext) {
  const browserRuntime = getBrowserRuntimeContext();

  return {
    hostname: normalizeRuntimeHostname(runtime?.hostname ?? browserRuntime?.hostname),
    protocol: normalizeRuntimeProtocol(runtime?.protocol ?? browserRuntime?.protocol),
  };
}

export function getMediaUrlRuntimeFromHeaders(
  headers: Pick<Headers, "get">,
): MediaUrlRuntimeContext {
  return {
    hostname: normalizeRuntimeHostname(
      headers.get("x-forwarded-host") ?? headers.get("host"),
    ),
    protocol: normalizeRuntimeProtocol(headers.get("x-forwarded-proto")),
  };
}

export function resolveAccessibleMediaUrl(
  value: string | null | undefined,
  runtime?: MediaUrlRuntimeContext,
) {
  const normalizedValue = value?.trim() ?? "";
  if (!normalizedValue) {
    return "";
  }

  try {
    const parsedUrl = new URL(normalizedValue);
    const runtimeContext = getResolvedRuntimeContext(runtime);

    let configuredHost = "";
    try { configuredHost = new URL(clientEnv.NEXT_PUBLIC_SUPABASE_URL).hostname; } catch { /* Optional environment. */ }
    if (parsedUrl.pathname.startsWith("/storage/v1/") &&
      (isLocalBackendHostname(parsedUrl.hostname) ||
        (runtimeContext.protocol === "https:" && parsedUrl.protocol === "http:" && parsedUrl.hostname === configuredHost))) {
      return `${BACKEND_GATEWAY_PATH}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
    }

    if (
      !isLoopbackOnlyHostname(parsedUrl.hostname) ||
      !runtimeContext.hostname ||
      isLoopbackOnlyHostname(runtimeContext.hostname)
    ) {
      return parsedUrl.toString();
    }

    parsedUrl.hostname = runtimeContext.hostname;
    if (
      runtimeContext.protocol &&
      (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:")
    ) {
      parsedUrl.protocol = runtimeContext.protocol;
    }

    return parsedUrl.toString();
  } catch {
    return normalizedValue;
  }
}

export function rewriteLoopbackMediaUrlsInHtml(
  value: string,
  runtime?: MediaUrlRuntimeContext,
) {
  if (!value) {
    return value;
  }

  return value.replace(
    /\b(src|href)\s*=\s*(["'])([^"']+)\2/gi,
    (fullMatch, attributeName: string, quote: string, rawValue: string) => {
      const resolvedValue = resolveAccessibleMediaUrl(rawValue, runtime);
      if (!resolvedValue || resolvedValue === rawValue) {
        return fullMatch;
      }

      const escapedValue =
        quote === "\""
          ? resolvedValue.replace(/"/g, "&quot;")
          : resolvedValue.replace(/'/g, "&#39;");

      return `${attributeName}=${quote}${escapedValue}${quote}`;
    },
  );
}
