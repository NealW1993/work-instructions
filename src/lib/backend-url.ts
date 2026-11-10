export const BACKEND_GATEWAY_PATH = "/api/backend";

export function isLocalBackendHostname(hostname: string) {
  return ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]", "host.docker.internal"].includes(hostname) ||
    /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname) ||
    (!hostname.includes(".") && !hostname.includes(":"));
}

/** Keep private/local backends behind the application's HTTPS reverse proxy. */
export function browserBackendUrl(configured: string, location?: { origin: string; protocol: string }) {
  if (!configured || !location) return configured;
  try {
    const backend = new URL(configured);
    if (isLocalBackendHostname(backend.hostname) || (location.protocol === "https:" && backend.protocol === "http:")) {
      return `${location.origin}${BACKEND_GATEWAY_PATH}`;
    }
    return configured;
  } catch {
    return configured;
  }
}

export function validBackendPath(segments: string[]) {
  if (segments.length < 2 || !["auth", "rest", "storage"].includes(segments[0]) || segments[1] !== "v1") return false;
  return segments.every((segment) => {
    try {
      let decoded = segment;
      for (let index = 0; index < 4; index += 1) {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      }
      return decoded.length > 0 && !/^\.{1,2}$/.test(decoded) && !/[\\/?#\u0000-\u001f\u007f]/.test(decoded);
    } catch {
      return false;
    }
  });
}

/** TUS upload URLs must stay on the public application origin, including NAS TLS. */
export function backendLocation(value: string, upstream: string) {
  try {
    const location = new URL(value, upstream);
    let path = location.pathname;
    if (path.startsWith("/upload/resumable")) path = `/storage/v1${path}`;
    const segments = path.split("/").slice(1).map(decodeURIComponent);
    if (!validBackendPath(segments)) return null;
    return `${BACKEND_GATEWAY_PATH}${path}${location.search}`;
  } catch {
    return null;
  }
}
