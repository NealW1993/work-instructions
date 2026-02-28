const LAST_ROUTE_STORAGE_KEY_PREFIX = "__autoLogoutLastRoute";
const POST_LOGIN_SCROLL_STORAGE_KEY = "__postLoginScrollRestore";
const MAX_STORED_ROUTE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_POST_LOGIN_SCROLL_AGE_MS = 5 * 60 * 1000;

export interface StoredAutoLogoutRoute {
  path: string;
  scrollX: number;
  scrollY: number;
  savedAt: number;
}

export interface PostLoginScrollRestore {
  path: string;
  scrollX: number;
  scrollY: number;
  savedAt: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeStoredPath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  if (trimmed.startsWith("/api") || trimmed.startsWith("/_next")) {
    return null;
  }

  return trimmed;
}

function getAutoLogoutRouteStorageKey(userId: string) {
  return `${LAST_ROUTE_STORAGE_KEY_PREFIX}.${userId}`;
}

function parseStoredAutoLogoutRoute(raw: string | null): StoredAutoLogoutRoute | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredAutoLogoutRoute>;
    const path = normalizeStoredPath(parsed.path);
    const scrollX = isFiniteNumber(parsed.scrollX) ? Math.max(0, parsed.scrollX) : null;
    const scrollY = isFiniteNumber(parsed.scrollY) ? Math.max(0, parsed.scrollY) : null;
    const savedAt = isFiniteNumber(parsed.savedAt) ? parsed.savedAt : null;
    if (!path || scrollX === null || scrollY === null || savedAt === null) {
      return null;
    }

    if (Date.now() - savedAt > MAX_STORED_ROUTE_AGE_MS) {
      return null;
    }

    return {
      path,
      scrollX,
      scrollY,
      savedAt,
    };
  } catch {
    return null;
  }
}

function parsePostLoginScrollRestore(raw: string | null): PostLoginScrollRestore | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PostLoginScrollRestore>;
    const path = normalizeStoredPath(parsed.path);
    const scrollX = isFiniteNumber(parsed.scrollX) ? Math.max(0, parsed.scrollX) : null;
    const scrollY = isFiniteNumber(parsed.scrollY) ? Math.max(0, parsed.scrollY) : null;
    const savedAt = isFiniteNumber(parsed.savedAt) ? parsed.savedAt : null;
    if (!path || scrollX === null || scrollY === null || savedAt === null) {
      return null;
    }

    if (Date.now() - savedAt > MAX_POST_LOGIN_SCROLL_AGE_MS) {
      return null;
    }

    return {
      path,
      scrollX,
      scrollY,
      savedAt,
    };
  } catch {
    return null;
  }
}

export function getCurrentBrowserPathWithSearch() {
  if (typeof window === "undefined") {
    return null;
  }

  const path = `${window.location.pathname}${window.location.search}`;
  return normalizeStoredPath(path);
}

export function saveAutoLogoutRouteForUser(userId: string, path: string, scrollX: number, scrollY: number) {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedPath = normalizeStoredPath(path);
  if (!normalizedPath) {
    return;
  }

  const payload: StoredAutoLogoutRoute = {
    path: normalizedPath,
    scrollX: Math.max(0, Number.isFinite(scrollX) ? scrollX : 0),
    scrollY: Math.max(0, Number.isFinite(scrollY) ? scrollY : 0),
    savedAt: Date.now(),
  };

  try {
    window.localStorage.setItem(getAutoLogoutRouteStorageKey(userId), JSON.stringify(payload));
  } catch {
    // Persistence is best-effort.
  }
}

export function popAutoLogoutRouteForUser(userId: string): StoredAutoLogoutRoute | null {
  if (typeof window === "undefined") {
    return null;
  }

  const key = getAutoLogoutRouteStorageKey(userId);
  let parsed: StoredAutoLogoutRoute | null = null;
  try {
    parsed = parseStoredAutoLogoutRoute(window.localStorage.getItem(key));
  } catch {
    parsed = null;
  } finally {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Cleanup is best-effort.
    }
  }

  return parsed;
}

export function savePendingPostLoginScrollRestore(path: string, scrollX: number, scrollY: number) {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedPath = normalizeStoredPath(path);
  if (!normalizedPath) {
    return;
  }

  const payload: PostLoginScrollRestore = {
    path: normalizedPath,
    scrollX: Math.max(0, Number.isFinite(scrollX) ? scrollX : 0),
    scrollY: Math.max(0, Number.isFinite(scrollY) ? scrollY : 0),
    savedAt: Date.now(),
  };

  try {
    window.sessionStorage.setItem(POST_LOGIN_SCROLL_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Persistence is best-effort.
  }
}

export function takePendingPostLoginScrollRestoreForPath(path: string): PostLoginScrollRestore | null {
  if (typeof window === "undefined") {
    return null;
  }

  const normalizedPath = normalizeStoredPath(path);
  if (!normalizedPath) {
    return null;
  }

  let parsed: PostLoginScrollRestore | null = null;
  try {
    parsed = parsePostLoginScrollRestore(window.sessionStorage.getItem(POST_LOGIN_SCROLL_STORAGE_KEY));
  } catch {
    parsed = null;
  }

  if (!parsed || parsed.path !== normalizedPath) {
    return null;
  }

  try {
    window.sessionStorage.removeItem(POST_LOGIN_SCROLL_STORAGE_KEY);
  } catch {
    // Cleanup is best-effort.
  }

  return parsed;
}
