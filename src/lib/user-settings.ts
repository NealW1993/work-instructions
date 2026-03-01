export type UserSettings = Record<string, unknown>;

const USER_SETTINGS_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

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

  const segments = pathValue
    .trim()
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return null;
  }

  if (
    segments.some((segment) => !USER_SETTINGS_PATH_SEGMENT_PATTERN.test(segment))
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
  const base = normalizeUserSettings(settings);
  const next = { ...base };

  if (rest.length === 0) {
    next[segment] = value;
    return next;
  }

  next[segment] = setUserSettingAtPath(base[segment], rest, value);
  return next;
}
