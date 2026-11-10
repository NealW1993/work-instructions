import type { NextRequest } from "next/server";

import { backendLocation, validBackendPath } from "@/lib/backend-url";
import { serverEnv } from "@/lib/env.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUEST_HEADERS = new Set([
  "authorization", "apikey", "accept", "accept-profile", "content-profile", "content-type",
  "cache-control", "prefer", "range", "if-range", "if-match", "if-none-match", "if-modified-since", "if-unmodified-since",
  "x-upsert", "x-client-info", "x-signature", "x-region", "x-supabase-api-version",
]);
const RESPONSE_HEADERS = new Set([
  "content-type", "content-disposition", "content-range", "accept-ranges", "etag", "last-modified",
  "cache-control", "expires", "vary", "retry-after", "preference-applied", "x-total-count",
  "x-supabase-api-version", "x-supabase-api-version-deprecated-at", "x-supabase-api-version-sunset-at",
]);
const isUploadHeader = (name: string) => name.startsWith("tus-") || name.startsWith("upload-");

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (!validBackendPath(path)) return Response.json({ error: "Invalid backend path." }, { status: 400 });
  const origin = request.headers.get("origin");
  const publicOrigin = serverEnv.NEXT_PUBLIC_APP_URL;
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && origin &&
    origin !== request.nextUrl.origin && origin !== publicOrigin && origin !== publicOrigin.replace(/\/$/, "")) {
    return Response.json({ error: "Cross-origin backend writes are not allowed." }, { status: 403 });
  }
  const configured = serverEnv.SUPABASE_URL_INTERNAL || serverEnv.NEXT_PUBLIC_SUPABASE_URL;
  let target: URL;
  try {
    const base = new URL(configured);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.pathname.startsWith("/api/backend")) throw new Error("Invalid upstream");
    target = new URL(`${base.href.replace(/\/$/, "")}/${path.map(encodeURIComponent).join("/")}`);
    target.search = request.nextUrl.search;
  } catch {
    return Response.json({ error: "The backend connection is not configured." }, { status: 503 });
  }
  const headers = new Headers();
  request.headers.forEach((value, name) => {
    if (REQUEST_HEADERS.has(name) || isUploadHeader(name)) headers.set(name, value);
  });
  // Public media requests may not carry an API key. Never use the service key here.
  if (!headers.has("apikey")) headers.set("apikey", serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  // Node fetch transparently decompresses responses; keep their byte counts and video ranges exact.
  headers.set("accept-encoding", "identity");
  try {
    const response = await fetch(target, {
      method: request.method, headers, redirect: "manual", cache: "no-store",
      signal: request.signal,
      ...(!["GET", "HEAD"].includes(request.method) && request.body ? { body: request.body, duplex: "half" } : {}),
    } as RequestInit & { duplex?: "half" });
    const outgoing = new Headers();
    response.headers.forEach((value, name) => {
      if (RESPONSE_HEADERS.has(name) || isUploadHeader(name)) outgoing.set(name, value);
    });
    if ((!response.headers.get("content-encoding") || response.headers.get("content-encoding") === "identity") && response.headers.has("content-length")) {
      outgoing.set("content-length", response.headers.get("content-length")!);
    }
    const location = response.headers.get("location");
    if (location) {
      const rewritten = backendLocation(location, target.href);
      if (!rewritten) {
        await response.body?.cancel();
        return Response.json({ error: "The backend returned an unsupported redirect." }, { status: 502 });
      }
      outgoing.set("location", rewritten);
    }
    outgoing.set("x-content-type-options", "nosniff");
    if (!(request.method === "GET" && path[0] === "storage" && path[2] === "object" && path[3] === "public")) {
      outgoing.set("cache-control", "private, no-store");
    }
    return new Response(request.method === "HEAD" || [204, 205, 304].includes(response.status) ? null : response.body, {
      status: response.status, headers: outgoing,
    });
  } catch {
    return Response.json({ error: "The backend connection was interrupted. Please retry." }, { status: 502 });
  }
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
export const HEAD = forward;
export const OPTIONS = forward;
