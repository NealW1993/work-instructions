import { expect, test } from "@playwright/test";

const endpoint = "/api/instructions/enhance";
const headers = { Authorization: "Bearer fixture-session-token" };

test("real enhancement route accepts null instruction IDs sent by new and forked drafts", async ({ request }) => {
  for (const mode of ["create", "fork"]) {
    const response = await request.post(endpoint, {
      headers,
      data: { instructionBody: "<h2>Setup</h2><p>Verify the approved fixture.</p>", partId: "MFG-2048", mode, instructionId: null, sourceInstructionId: null },
    });
    // The isolated server intentionally has no provider key. This branch proves auth and body validation passed.
    expect(response.status()).toBe(503);
    expect((await response.json()).error).toContain("AI is not set up");
  }
});

test("real enhancement route rejects malformed text and IDs before requesting an AI provider", async ({ request }) => {
  for (const data of [
    { instructionBody: "Check the fixture.", instructionId: { id: "invalid" } },
    { instructionBody: 42, instructionId: null },
    ["not an instruction object"],
  ]) {
    const response = await request.post(endpoint, { headers, data });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBeTruthy();
  }
});

test("real enhancement route requires authentication before accepting a draft", async ({ request }) => {
  const response = await request.post(endpoint, { data: { instructionBody: "Check the fixture.", instructionId: null } });
  expect(response.status()).toBe(401);
});
