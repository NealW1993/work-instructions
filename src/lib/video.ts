const VIDEO_MIME_TYPE_BY_EXTENSION = {
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".ogg": "video/ogg",
} as const;

const SUPPORTED_VIDEO_MIME_TYPES = new Set<string>([
  "video/mp4",
  "video/x-m4v",
  "video/quicktime",
  "video/webm",
]);

function normalizeMimeType(value: string | null | undefined) {
  const normalizedValue = value?.trim().toLowerCase() ?? "";
  if (!normalizedValue) {
    return "";
  }

  return normalizedValue.split(";")[0]?.trim() ?? "";
}

function readFileExtension(value: string) {
  const normalizedValue = value.trim().toLowerCase();
  if (!normalizedValue) {
    return "";
  }

  try {
    const parsedUrl = new URL(normalizedValue, "http://local.invalid");
    const pathname = parsedUrl.pathname.toLowerCase();
    const match = pathname.match(/\.[a-z0-9]+$/);
    return match?.[0] ?? "";
  } catch {
    const sanitizedValue = normalizedValue.split(/[?#]/)[0] ?? normalizedValue;
    const match = sanitizedValue.match(/\.[a-z0-9]+$/);
    return match?.[0] ?? "";
  }
}

function ensureBooleanAttribute(tagAttributes: string, attributeName: string) {
  const pattern = new RegExp(`(?:^|\\s)${attributeName}(?:\\s|=|$)`, "i");
  if (pattern.test(tagAttributes)) {
    return tagAttributes;
  }

  return `${tagAttributes} ${attributeName}`;
}

function ensureValueAttribute(tagAttributes: string, attributeName: string, attributeValue: string) {
  const pattern = new RegExp(`(?:^|\\s)${attributeName}\\s*=`, "i");
  if (pattern.test(tagAttributes)) {
    return tagAttributes;
  }

  return `${tagAttributes} ${attributeName}="${attributeValue}"`;
}

export function inferVideoMimeType(value: string | null | undefined) {
  const normalizedMimeType = normalizeMimeType(value);
  if (normalizedMimeType.startsWith("video/")) {
    return normalizedMimeType;
  }

  const extension = readFileExtension(value ?? "");
  if (!extension) {
    return null;
  }

  return VIDEO_MIME_TYPE_BY_EXTENSION[
    extension as keyof typeof VIDEO_MIME_TYPE_BY_EXTENSION
  ] ?? null;
}

export function isSupportedVideoUpload(file: { name: string; type?: string | null }) {
  const normalizedMimeType = normalizeMimeType(file.type);
  if (normalizedMimeType && normalizedMimeType !== "application/octet-stream") return SUPPORTED_VIDEO_MIME_TYPES.has(normalizedMimeType);

  const inferredMimeType = inferVideoMimeType(file.name);
  return inferredMimeType !== null && SUPPORTED_VIDEO_MIME_TYPES.has(inferredMimeType);
}

export function getUnsupportedVideoUploadMessage(fileName: string) {
  return `${fileName} is unsupported. Use MP4, MOV or WebM. MP4 with H.264/AAC provides the broadest playback compatibility.`;
}

export function normalizeVideoMarkupForPlayback(value: string) {
  return value.replace(
    /<video\b([^>]*)>([\s\S]*?)<\/video>/gi,
    (fullMarkup, rawAttributes: string, rawInnerMarkup: string) => {
      const sources = rawInnerMarkup.match(/<source\b[^>]*>/gi) ?? [];
      const sourceMarkup = sources[0] ?? "";
      const sourceTypeMatch = sourceMarkup.match(/\stype\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const sourceSrcMatch = sourceMarkup.match(/\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const videoSrcMatch = rawAttributes.match(/(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const resolvedSource =
        videoSrcMatch?.[1] ??
        videoSrcMatch?.[2] ??
        sourceSrcMatch?.[1] ??
        sourceSrcMatch?.[2] ??
        "";

      if (!resolvedSource) {
        return fullMarkup;
      }

      const inferredMimeType =
        (videoSrcMatch ? inferVideoMimeType(resolvedSource) : sourceTypeMatch?.[1] ?? sourceTypeMatch?.[2] ?? inferVideoMimeType(resolvedSource)) ??
        "";

      let normalizedAttributes = rawAttributes
        .replace(/(?:^|\s)src\s*=\s*(?:"[^"]*"|'[^']*')/i, "")
        .trim();

      normalizedAttributes = ensureBooleanAttribute(normalizedAttributes, "controls");
      normalizedAttributes = ensureBooleanAttribute(normalizedAttributes, "playsinline");
      normalizedAttributes = ensureValueAttribute(normalizedAttributes, "preload", "metadata");
      if (sources.length > 1 && !videoSrcMatch) {
        // Let the browser choose a supported codec rather than pinning it to the first source.
        return `<video ${normalizedAttributes.trim()}>${rawInnerMarkup}</video>`;
      }
      normalizedAttributes = ensureValueAttribute(normalizedAttributes, "src", resolvedSource);

      const normalizedInnerMarkup = rawInnerMarkup.replace(/<source\b[^>]*>\s*/gi, "").trim();
      const fallbackMarkup =
        normalizedInnerMarkup.length > 0
          ? normalizedInnerMarkup
          : "Video playback unavailable on this device.";
      const sourceTag = `<source src="${resolvedSource}"${
        inferredMimeType ? ` type="${inferredMimeType}"` : ""
      }>`;

      return `<video ${normalizedAttributes.trim()}>${sourceTag}${fallbackMarkup}</video>`;
    },
  );
}
