import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAppRestorePath } from "../../src/lib/last-route-restore.ts";
import { readAllRows } from "../../src/lib/supabase/read-all-rows.ts";

test("post-login restore accepts app routes and retains search and fragment", () => {
  for (const value of ["/dashboard", "/instructions/abc?rev=2", "/process-documents?doc=abc#history", "/groups"]) {
    assert.equal(normalizeAppRestorePath(value), value);
  }
  assert.equal(normalizeAppRestorePath("/instructions/../dashboard"), "/dashboard");
});

test("post-login restore rejects external, malformed, and reserved destinations", () => {
  for (const value of [
    "https://example.com", "//example.com", "/\\example.com", "/%2f%2fexample.com",
    "/%5cexample.com", "/dashboard\n//example.com", "/api/auth", "/%61pi/auth",
    "/instructions/../api/users", "/_next/static/chunk.js", "/login?next=/dashboard", "/%zz", null,
  ]) {
    assert.equal(normalizeAppRestorePath(value), null, `must reject ${JSON.stringify(value)}`);
  }
});

test("batched reads retain all rows beyond PostgREST limits", async () => {
  const rows = Array.from({ length: 1255 }, (_, id) => ({ id }));
  const ranges = [];
  const result = await readAllRows(async (from, to) => {
    ranges.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  });
  assert.equal(result.error, null);
  assert.equal(result.data.length, rows.length);
  assert.equal(result.data[1254].id, 1254);
  assert.deepEqual(ranges, [[0, 499], [500, 999], [1000, 1499], [1255, 1754]]);
});

test("batched reads respect server caps smaller than the requested batch", async () => {
  const rows = Array.from({ length: 255 }, (_, id) => ({ id }));
  const offsets = [];
  const result = await readAllRows(async (from) => {
    offsets.push(from);
    return { data: rows.slice(from, from + 100), error: null };
  });
  assert.equal(result.error, null);
  assert.equal(result.data.length, 255);
  assert.deepEqual(offsets, [0, 100, 200, 255]);
});

test("batched reads expose failures instead of presenting incomplete data as complete", async () => {
  const rows = Array.from({ length: 500 }, (_, id) => ({ id }));
  const error = { message: "Network unavailable" };
  const result = await readAllRows(async (from) => from === 0 ? { data: rows, error: null } : { data: null, error });
  assert.equal(result.data.length, 500);
  assert.equal(result.error, error);
});

test("batched reads stop with an error when a backend ignores the requested offset", async () => {
  let calls = 0;
  // A misconfigured backend that returns the same row for every page must not hang the page load.
  const result = await readAllRows(async () => {
    calls += 1;
    return { data: [{ id: 1 }], error: null };
  });
  assert.equal(calls, 2000);
  assert.match(result.error.message, /Stopped reading after 2000 pages/);
});
