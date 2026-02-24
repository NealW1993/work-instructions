const SESSION_START_KEY = "work_instructions_session_started_at";

function parseSessionStart(rawValue: string | null) {
  if (!rawValue) {
    return null;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export function setSessionStartNow() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SESSION_START_KEY, String(Date.now()));
}

export function clearSessionStart() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(SESSION_START_KEY);
}

export function getSessionStartTime() {
  if (typeof window === "undefined") {
    return null;
  }

  return parseSessionStart(window.localStorage.getItem(SESSION_START_KEY));
}

export function ensureSessionStartTime() {
  const existing = getSessionStartTime();
  if (existing) {
    return existing;
  }

  const now = Date.now();
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SESSION_START_KEY, String(now));
  }
  return now;
}

export function formatElapsedHhMmSs(elapsedMs: number) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}
