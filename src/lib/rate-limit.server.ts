import "server-only";

/*
 * In-process rate limiting for public endpoints. The app runs as a single container, so a memory
 * map is sufficient; the database lockout on each sign-in identifier remains the primary control.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function prune(now: number) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** The client address as seen by the reverse proxy, or a shared key when unknown. */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** True when the key has already used its allowance in the current window. Does not count. */
export function isRateLimited(key: string, limit: number): boolean {
  const bucket = buckets.get(key);
  return Boolean(bucket && bucket.resetAt > Date.now() && bucket.count >= limit);
}

/** Counts one event for the key and returns the seconds until the window resets. */
export function recordRateLimitedEvent(key: string, windowMs: number): number {
  const now = Date.now();
  prune(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return Math.ceil(windowMs / 1000);
  }
  bucket.count += 1;
  return Math.ceil((bucket.resetAt - now) / 1000);
}

/** Counts an event and reports whether the key is now over its limit. */
export function consumeRateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSeconds: number } {
  if (isRateLimited(key, limit)) {
    const bucket = buckets.get(key)!;
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - Date.now()) / 1000) };
  }
  const retryAfterSeconds = recordRateLimitedEvent(key, windowMs);
  return { allowed: true, retryAfterSeconds };
}
