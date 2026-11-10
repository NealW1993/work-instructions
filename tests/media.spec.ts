import { expect, test } from "@playwright/test";
import { inferVideoMimeType, isSupportedVideoUpload, normalizeVideoMarkupForPlayback } from "../src/lib/video";
import { getImageMimeType, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, RESUMABLE_CHUNK_BYTES } from "../src/lib/media-upload";

test("tablet capture containers are accepted without misclassifying other file types", () => {
  for (const file of [
    { name: "capture.MOV", type: "video/quicktime" },
    { name: "capture.mp4", type: "video/mp4; codecs=avc1" },
    { name: "capture.webm", type: "video/webm" },
    { name: "capture.M4V", type: "" },
  ]) expect(isSupportedVideoUpload(file)).toBe(true);
  expect(isSupportedVideoUpload({ name: "capture.mp4", type: "text/html" })).toBe(false);
  expect(isSupportedVideoUpload({ name: "capture.exe", type: "" })).toBe(false);
  expect(isSupportedVideoUpload({ name: "capture.avi", type: "video/x-msvideo" })).toBe(false);
});

test("video type inference handles signed URLs and does not guess unknown codecs", () => {
  expect(inferVideoMimeType("https://media.example/file.MP4?token=abc#position")).toBe("video/mp4");
  expect(inferVideoMimeType("video/webm; codecs=vp8")).toBe("video/webm");
  expect(inferVideoMimeType("https://media.example/unknown")).toBeNull();
});

test("legacy video markup receives native controls and inline tablet playback", () => {
  const result = normalizeVideoMarkupForPlayback('<video width="500"><source src="https://media.example/clip.mp4" type="video/mp4"></video>');
  expect(result).toContain("controls");
  expect(result).toContain("playsinline");
  expect(result).toContain('preload="metadata"');
  expect(result).toContain('src="https://media.example/clip.mp4"');
  expect(result.match(/<source /g)).toHaveLength(1);
  expect(normalizeVideoMarkupForPlayback(result)).toBe(result);
});

test("image uploads reject active content and unrenderable camera formats", () => {
  expect(getImageMimeType({ name: "camera.JPG", type: "" })).toBe("image/jpeg");
  expect(getImageMimeType({ name: "camera.png", type: "image/png" })).toBe("image/png");
  expect(getImageMimeType({ name: "unsafe.svg", type: "image/svg+xml" })).toBeNull();
  expect(getImageMimeType({ name: "unsafe.jpg", type: "text/html" })).toBeNull();
  expect(getImageMimeType({ name: "camera.heic", type: "image/heic" })).toBeNull();
  expect(MAX_IMAGE_BYTES).toBe(20 * 1024 * 1024);
  expect(MAX_VIDEO_BYTES).toBe(1024 * 1024 * 1024);
  expect(RESUMABLE_CHUNK_BYTES).toBe(6 * 1024 * 1024);
});

test("video normalization preserves source precedence and codec alternatives", () => {
  const explicit = normalizeVideoMarkupForPlayback('<video data-src="ignored.webm" src="current.mp4"><source src="old.webm" type="video/webm"></video>');
  expect(explicit).toContain('src="current.mp4"');
  expect(explicit).toContain('type="video/mp4"');
  expect(explicit).not.toContain('src="old.webm"');
  const alternatives = normalizeVideoMarkupForPlayback('<video><source src="clip.webm" type="video/webm"><source src="clip.mp4" type="video/mp4"></video>');
  expect(alternatives.match(/<source /g)).toHaveLength(2);
  expect(alternatives).not.toMatch(/<video[^>]*\ssrc=/);
  expect(normalizeVideoMarkupForPlayback(alternatives)).toBe(alternatives);
  expect(normalizeVideoMarkupForPlayback('<video data-controls="custom" src="clip.mp4"></video>')).toContain(' controls');
});
