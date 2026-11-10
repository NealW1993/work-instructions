export type UserSettings = Record<string, unknown>;

const USER_SETTINGS_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function isPlainObject(value: unknown): value is UserSettings {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeUserSettings(value: unknown): UserSettings {
  return isPlainObject(value) ? { ...value } : {};
}

export function parseUserSettingsPath(pathValue: unknown): string[] | null {
  if (typeof pathValue !== "string") {
    return null;
  }

  if (pathValue.length > 512) {
    return null;
  }

  const segments = pathValue
    .trim()
    .split(".")
    .map((segment) => segment.trim());

  if (segments.length === 0 || segments.length > 16) {
    return null;
  }

  if (
    segments.some((segment) =>
      !USER_SETTINGS_PATH_SEGMENT_PATTERN.test(segment) || UNSAFE_PATH_SEGMENTS.has(segment),
    )
  ) {
    return null;
  }

  return segments;
}

export function getUserSettingAtPath(
  settings: unknown,
  path: readonly string[],
): unknown {
  if (path.length === 0) {
    return normalizeUserSettings(settings);
  }

  let current: unknown = settings;
  for (const segment of path) {
    if (!isPlainObject(current)) {
      return undefined;
    }

    if (UNSAFE_PATH_SEGMENTS.has(segment) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
}

export function setUserSettingAtPath(
  settings: unknown,
  path: readonly string[],
  value: unknown,
): UserSettings {
  if (path.length === 0) {
    return normalizeUserSettings(settings);
  }

  const [segment, ...rest] = path;
  if (UNSAFE_PATH_SEGMENTS.has(segment)) {
    throw new Error("Invalid settings path.");
  }
  const base = normalizeUserSettings(settings);
  const next = { ...base };

  if (rest.length === 0) {
    next[segment] = value;
    return next;
  }

  next[segment] = setUserSettingAtPath(base[segment], rest, value);
  return next;
}
