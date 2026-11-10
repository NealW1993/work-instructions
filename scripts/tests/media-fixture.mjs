import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const objects = new Map([["fixture.mp4", { body: readFileSync(resolve("public/header-light.mp4")), type: "video/mp4" }]]);
// A known repository asset supplies real image dimensions for viewer tests, not the upload allowlist.
objects.set("fixture-diagram.svg", { body: readFileSync(resolve("public/omni-technologies-logo.svg")), type: "image/svg+xml" });
const uploads = new Map();
let counter = 0;
const wait = () => new Promise((done) => setTimeout(done, 400));
export async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}
export async function handleMedia(request, response) {
  const url = new URL(request.url, "http://127.0.0.1:3900");
  if (url.pathname === "/__fixture/media") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ objects: [...objects].map(([name, value]) => ({ name, size: value.body.length, type: value.type })), uploads: [...uploads.values()].map(({ offset, length, chunks }) => ({ offset, length, chunks })) }));
    return true;
  }
  if (url.pathname.startsWith("/storage/v1/upload/resumable")) {
    response.setHeader("Tus-Resumable", "1.0.0");
    if (request.method === "POST") {
      const metadata = Object.fromEntries((request.headers["upload-metadata"] || "").split(",").map((item) => { const [key, value] = item.trim().split(" "); return [key, Buffer.from(value || "", "base64").toString()]; }));
      const id = String(++counter);
      const body = await readBody(request);
      uploads.set(id, { length: Number(request.headers["upload-length"]), offset: body.length, chunks: [], parts: body.length ? [body] : [], metadata });
      response.writeHead(201, { Location: `http://storage:5000/upload/resumable/${id}`, "Upload-Offset": String(body.length) });
      response.end();
      return true;
    }
    const upload = uploads.get(url.pathname.split("/").pop());
    if (!upload) { response.writeHead(404); response.end(); return true; }
    if (request.method === "HEAD") { response.writeHead(200, { "Upload-Offset": String(upload.offset), "Upload-Length": String(upload.length) }); response.end(); return true; }
    if (request.method === "PATCH") {
      const body = await readBody(request);
      if (Number(request.headers["upload-offset"]) !== upload.offset) { response.writeHead(409); response.end(); return true; }
      upload.parts.push(body); upload.chunks.push(body.length); upload.offset += body.length;
      if (upload.offset === upload.length) objects.set(upload.metadata.objectName, { body: Buffer.concat(upload.parts), type: upload.metadata.contentType });
      await wait();
      response.writeHead(204, { "Upload-Offset": String(upload.offset) }); response.end();
      return true;
    }
    response.writeHead(405); response.end(); return true;
  }
  const prefix = "/storage/v1/object/";
  if (!url.pathname.startsWith(prefix)) return false;
  const publicPath = `${prefix}public/instruction-media/`;
  if (["GET", "HEAD"].includes(request.method) && url.pathname.startsWith(publicPath)) {
    const object = objects.get(decodeURIComponent(url.pathname.slice(publicPath.length)));
    if (!object) { response.writeHead(404); response.end(); return true; }
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), object.body.length - 1) : object.body.length - 1;
    if (start > end || start >= object.body.length) { response.writeHead(416, { "Content-Range": `bytes */${object.body.length}` }); response.end(); return true; }
    const headers = { "Content-Type": object.type, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 };
    if (range) headers["Content-Range"] = `bytes ${start}-${end}/${object.body.length}`;
    response.writeHead(range ? 206 : 200, headers);
    response.end(request.method === "HEAD" ? undefined : object.body.subarray(start, end + 1));
    return true;
  }
  if (request.method === "POST" && url.pathname.startsWith(`${prefix}instruction-media/`)) {
    const name = decodeURIComponent(url.pathname.slice(`${prefix}instruction-media/`.length));
    const body = await readBody(request);
    objects.set(name, { body, type: request.headers["content-type"] || "application/octet-stream" });
    await wait();
    response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ Key: `instruction-media/${name}` }));
    return true;
  }
  response.writeHead(405); response.end(); return true;
}
