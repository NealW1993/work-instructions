"use client";

import { Upload } from "tus-js-client";
import { clientEnv } from "@/lib/env.client";
import { getBrowserSupabaseUrl, getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { inferVideoMimeType } from "@/lib/video";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
export const RESUMABLE_CHUNK_BYTES = 6 * 1024 * 1024;

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif",
};

export function getImageMimeType(file: { name: string; type?: string }) {
  const declared = file.type?.split(";")[0].trim().toLowerCase();
  if (declared && declared !== "application/octet-stream") return Object.values(IMAGE_MIME_BY_EXTENSION).includes(declared) ? declared : null;
  return IMAGE_MIME_BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

export async function uploadInstructionMedia(file: File, path: string, {
  signal, onProgress,
}: { signal: AbortSignal; onProgress: (percent: number) => void }) {
  const supabase = getSupabaseBrowserClient();
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) throw new Error("Your session expired. Sign in again before uploading.");
  const baseUrl = getBrowserSupabaseUrl().replace(/\/$/, "");
  const contentType = getImageMimeType(file) ?? inferVideoMimeType(file.type) ?? inferVideoMimeType(file.name) ?? "application/octet-stream";
  const headers = { authorization: `Bearer ${session.access_token}`, apikey: clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY };
  if (signal.aborted) throw new DOMException("Upload cancelled", "AbortError");

  if (file.size > RESUMABLE_CHUNK_BYTES) {
    await new Promise<void>((resolve, reject) => {
      let completed = false;
      const finish = (error?: Error) => {
        if (completed) return;
        completed = true;
        signal.removeEventListener("abort", cancel);
        if (error) reject(error); else resolve();
      };
      const upload = new Upload(file, {
        endpoint: `${baseUrl}/storage/v1/upload/resumable`,
        headers: { ...headers, "x-upsert": "false" },
        chunkSize: RESUMABLE_CHUNK_BYTES,
        retryDelays: [0, 1000, 3000, 5000, 10000],
        removeFingerprintOnSuccess: true,
        metadata: { bucketName: "instruction-media", objectName: path, contentType, cacheControl: "3600" },
        onProgress: (sent, total) => onProgress(total ? Math.min(100, Math.round(sent / total * 100)) : 0),
        onError: (error) => finish(error),
        onSuccess: () => finish(),
      });
      function cancel() {
        void upload.abort().catch(() => undefined);
        finish(new DOMException("Upload cancelled", "AbortError"));
      }
      signal.addEventListener("abort", cancel, { once: true });
      upload.start();
    });
  } else {
    await new Promise<void>((resolve, reject) => {
      const request = new XMLHttpRequest();
      const cancel = () => request.abort();
      const finish = (error?: Error) => {
        signal.removeEventListener("abort", cancel);
        if (error) reject(error); else resolve();
      };
      request.open("POST", `${baseUrl}/storage/v1/object/instruction-media/${path.split("/").map(encodeURIComponent).join("/")}`);
      Object.entries({ ...headers, "Content-Type": contentType, "cache-control": "max-age=3600", "x-upsert": "false" }).forEach(([key, value]) => request.setRequestHeader(key, value));
      request.timeout = 120000;
      request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.min(100, Math.round(event.loaded / event.total * 100))); };
      request.onload = () => {
        if (request.status >= 200 && request.status < 300) return finish();
        let message = `Upload failed (${request.status}).`;
        try { message = JSON.parse(request.responseText).message || message; } catch { /* Keep readable HTTP status. */ }
        finish(new Error(message));
      };
      request.onerror = () => finish(new Error("Connection interrupted. Check your network and retry the upload."));
      request.ontimeout = () => finish(new Error("Upload timed out. Check your network and retry."));
      request.onabort = () => finish(new DOMException("Upload cancelled", "AbortError"));
      signal.addEventListener("abort", cancel, { once: true });
      request.send(file);
    });
  }
  onProgress(100);
  return supabase.storage.from("instruction-media").getPublicUrl(path).data.publicUrl;
}
