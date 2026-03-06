const VIDEO_MIME_TYPE_BY_EXTENSION = {
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".ogg": "video/ogg",
} as const;

const MOBILE_SAFE_VIDEO_MIME_TYPES = new Set<string>([
  "video/mp4",
  "video/x-m4v",
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
  const pattern = new RegExp(`\\b${attributeName}\\b`, "i");
  if (pattern.test(tagAttributes)) {
    return tagAttributes;
  }

  return `${tagAttributes} ${attributeName}`;
}

function ensureValueAttribute(tagAttributes: string, attributeName: string, attributeValue: string) {
  const pattern = new RegExp(`\\b${attributeName}\\s*=`, "i");
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

export function isMobileSafeVideoUpload(file: { name: string; type?: string | null }) {
  const normalizedMimeType = normalizeMimeType(file.type);
  if (MOBILE_SAFE_VIDEO_MIME_TYPES.has(normalizedMimeType)) {
    return true;
  }

  const inferredMimeType = inferVideoMimeType(file.name);
  return inferredMimeType !== null && MOBILE_SAFE_VIDEO_MIME_TYPES.has(inferredMimeType);
}

export function getUnsupportedVideoUploadMessage(fileName: string) {
  return `${fileName} is not a mobile-safe video upload. Use MP4 video encoded with H.264/AAC.`;
}

export function normalizeVideoMarkupForPlayback(value: string) {
  return value.replace(
    /<video\b([^>]*)>([\s\S]*?)<\/video>/gi,
    (fullMarkup, rawAttributes: string, rawInnerMarkup: string) => {
      const sourceMarkup = rawInnerMarkup.match(/<source\b[^>]*>/i)?.[0] ?? "";
      const sourceTypeMatch = sourceMarkup.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const sourceSrcMatch = sourceMarkup.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const videoSrcMatch = rawAttributes.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const resolvedSource =
        sourceSrcMatch?.[1] ??
        sourceSrcMatch?.[2] ??
        videoSrcMatch?.[1] ??
        videoSrcMatch?.[2] ??
        "";

      if (!resolvedSource) {
        return fullMarkup;
      }

      const inferredMimeType =
        sourceTypeMatch?.[1] ??
        sourceTypeMatch?.[2] ??
        inferVideoMimeType(resolvedSource) ??
        "";

      let normalizedAttributes = rawAttributes
        .replace(/\bsrc\s*=\s*(?:"[^"]*"|'[^']*')/i, "")
        .trim();

      normalizedAttributes = ensureBooleanAttribute(normalizedAttributes, "controls");
      normalizedAttributes = ensureBooleanAttribute(normalizedAttributes, "playsinline");
      normalizedAttributes = ensureValueAttribute(normalizedAttributes, "preload", "metadata");

      const normalizedInnerMarkup = rawInnerMarkup.replace(/<source\b[^>]*>\s*/gi, "").trim();
      const fallbackMarkup =
        normalizedInnerMarkup.length > 0
          ? normalizedInnerMarkup
          : "Video playback unavailable on this device.";
      const sourceTag = `<source src="${resolvedSource}"${
        inferredMimeType ? ` type="${inferredMimeType}"` : ""
      }>`;

      return `<video ${normalizedAttributes}>${sourceTag}${fallbackMarkup}</video>`;
    },
  );
}
