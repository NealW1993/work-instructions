const ARCHIVED_INSTRUCTION_REDIRECTS_SESSION_KEY =
  "instructions.archivedRedirectsById";
const ARCHIVED_INSTRUCTION_REDIRECT_TTL_MS = 30 * 60 * 1000;

interface ArchivedInstructionRedirectEntry {
  targetInstructionId: string;
  createdAt: number;
}

type ArchivedInstructionRedirectMap = Record<
  string,
  ArchivedInstructionRedirectEntry
>;

function normalizeRedirectMapValue(
  candidate: unknown,
  now: number,
): ArchivedInstructionRedirectMap {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {};
  }

  const normalizedMap: ArchivedInstructionRedirectMap = {};
  const entries = Object.entries(
    candidate as Record<string, unknown>,
  );

  for (const [archivedInstructionId, rawEntry] of entries) {
    if (
      !rawEntry ||
      typeof rawEntry !== "object" ||
      Array.isArray(rawEntry)
    ) {
      continue;
    }

    const entry = rawEntry as Partial<ArchivedInstructionRedirectEntry>;
    const targetInstructionId =
      typeof entry.targetInstructionId === "string"
        ? entry.targetInstructionId.trim()
        : "";
    const createdAt =
      typeof entry.createdAt === "number" &&
      Number.isFinite(entry.createdAt)
        ? entry.createdAt
        : 0;

    if (
      !archivedInstructionId ||
      !targetInstructionId ||
      targetInstructionId === archivedInstructionId
    ) {
      continue;
    }

    if (createdAt <= 0 || now - createdAt > ARCHIVED_INSTRUCTION_REDIRECT_TTL_MS) {
      continue;
    }

    normalizedMap[archivedInstructionId] = {
      targetInstructionId,
      createdAt,
    };
  }

  return normalizedMap;
}

function readRedirectMap(sessionStorage: Storage, now: number) {
  const raw = sessionStorage.getItem(ARCHIVED_INSTRUCTION_REDIRECTS_SESSION_KEY);
  if (!raw) {
    return {} as ArchivedInstructionRedirectMap;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeRedirectMapValue(parsed, now);
  } catch {
    return {} as ArchivedInstructionRedirectMap;
  }
}

function writeRedirectMap(
  sessionStorage: Storage,
  redirectsByArchivedId: ArchivedInstructionRedirectMap,
) {
  if (Object.keys(redirectsByArchivedId).length === 0) {
    sessionStorage.removeItem(ARCHIVED_INSTRUCTION_REDIRECTS_SESSION_KEY);
    return;
  }

  sessionStorage.setItem(
    ARCHIVED_INSTRUCTION_REDIRECTS_SESSION_KEY,
    JSON.stringify(redirectsByArchivedId),
  );
}

export function registerArchivedInstructionRedirect(
  archivedInstructionId: string,
  targetInstructionId: string,
) {
  if (typeof window === "undefined") {
    return;
  }

  const archivedId = archivedInstructionId.trim();
  const targetId = targetInstructionId.trim();
  if (!archivedId || !targetId || archivedId === targetId) {
    return;
  }

  try {
    const now = Date.now();
    const redirectsByArchivedId = readRedirectMap(window.sessionStorage, now);
    redirectsByArchivedId[archivedId] = {
      targetInstructionId: targetId,
      createdAt: now,
    };
    writeRedirectMap(window.sessionStorage, redirectsByArchivedId);
  } catch {
    // Session storage support is best-effort.
  }
}

export function consumeArchivedInstructionRedirect(
  archivedInstructionId: string,
) {
  if (typeof window === "undefined") {
    return null;
  }

  const archivedId = archivedInstructionId.trim();
  if (!archivedId) {
    return null;
  }

  try {
    const now = Date.now();
    const redirectsByArchivedId = readRedirectMap(window.sessionStorage, now);
    const redirectTarget =
      redirectsByArchivedId[archivedId]?.targetInstructionId ?? null;
    if (redirectTarget) {
      delete redirectsByArchivedId[archivedId];
    }
    writeRedirectMap(window.sessionStorage, redirectsByArchivedId);
    return redirectTarget;
  } catch {
    return null;
  }
}
