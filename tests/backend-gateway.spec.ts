import { expect, test } from "@playwright/test";
import { backendLocation, browserBackendUrl, validBackendPath } from "../src/lib/backend-url";
import { resolveAccessibleMediaUrl } from "../src/lib/media-url";

test("HTTPS browser routes private and insecure backends through its own origin", () => {
  const tablet = { origin: "https://instructions.example.com", protocol: "https:" };
  for (const backend of ["http://127.0.0.1:56321", "http://192.168.1.20:8000", "http://supabase-kong:8000", "http://nas.example.com:8000"]) {
    expect(browserBackendUrl(backend, tablet)).toBe("https://instructions.example.com/api/backend");
  }
  expect(browserBackendUrl("https://project.supabase.co", tablet)).toBe("https://project.supabase.co");
});

test("historical NAS media loses private host and port while keeping storage identity", () => {
  expect(resolveAccessibleMediaUrl("http://127.0.0.1:56321/storage/v1/object/public/instruction-media/photo.png", { hostname: "instructions.example.com", protocol: "https" }))
    .toBe("/api/backend/storage/v1/object/public/instruction-media/photo.png");
  expect(resolveAccessibleMediaUrl("http://192.168.1.20:8000/storage/v1/object/public/instruction-media/capture.mp4?download=1", { hostname: "instructions.example.com", protocol: "https" }))
    .toBe("/api/backend/storage/v1/object/public/instruction-media/capture.mp4?download=1");
});

test("gateway accepts backend services and rejects direct and encoded path traversal", () => {
  expect(validBackendPath(["storage", "v1", "upload", "resumable", "session-1"])).toBe(true);
  expect(validBackendPath(["rest", "v1", "work_instructions"])).toBe(true);
  for (const path of [
    ["api", "v1", "users"], ["auth", "v2", "user"], ["storage", "v1", ".."],
    ["storage", "v1", "%2e%2e"], ["storage", "v1", "%252e%252e"],
    ["storage", "v1", "file%2f.."], ["storage", "v1", "file\\name"],
    ["storage", "v1", "file%00name"], ["storage", "v1", "%zz"],
  ]) expect(validBackendPath(path)).toBe(false);
});

test("TUS Location never exposes a backend host or sends the upload to another origin", () => {
  expect(backendLocation("http://supabase-kong:8000/storage/v1/upload/resumable/session-1", "http://supabase-kong:8000/storage/v1/upload/resumable"))
    .toBe("/api/backend/storage/v1/upload/resumable/session-1");
  expect(backendLocation("http://storage:5000/upload/resumable/session-1", "http://supabase-kong:8000/storage/v1/upload/resumable"))
    .toBe("/api/backend/storage/v1/upload/resumable/session-1");
  expect(backendLocation("https://unexpected.example/collect-token", "http://supabase-kong:8000")).toBeNull();
});
