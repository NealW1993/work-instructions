import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { isDevHotReloadError } from "./page-errors";

const userId = "a1000000-0000-0000-0000-000000000001";
const instructionId = "a3000000-0000-0000-0000-000000000001";
const stamp = "2026-11-01T12:00:00Z";
const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", aud: "authenticated", exp: 2_000_000_000 })).toString("base64url")}.fixture-signature`;
const session = { access_token: token, refresh_token: "fixture-refresh", expires_in: 3600, expires_at: 2_000_000_000, token_type: "bearer", user: { id: userId, aud: "authenticated", role: "authenticated", email: "reviewer@example.invalid", created_at: stamp, app_metadata: { provider: "email" }, user_metadata: { full_name: "Quality Reviewer" } } };
const routes = ["/dashboard", "/doc-center", "/groups", "/account", "/admin/users", "/admin/export", "/admin/kpis", "/process-documents", "/process-maps", "/process-maps/formulas", "/drafts", "/instructions/new", "/instructions/import", "/instructions/archived", `/instructions/${instructionId}`, `/instructions/${instructionId}/edit`, `/instructions/${instructionId}/fork`, `/instructions/${instructionId}/print`];

for (const viewport of [{ width: 2560, height: 1440 }, { width: 1920, height: 1080 }, { width: 1440, height: 1000 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
  test(`authenticated pages render without horizontal page overflow at ${viewport.width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize(viewport);
    await context.addCookies([{ name: "work-instructions-auth-token", value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`, url: "http://127.0.0.1:3100", sameSite: "Lax" }]);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => { if (!isDevHotReloadError(error)) pageErrors.push(error.message); });
    for (const route of routes) {
      await test.step(route, async () => {
        const response = await page.goto(route, { waitUntil: "networkidle" });
        expect(response?.status(), route).toBeLessThan(400);
        await expect(page.locator("#main-content")).toBeVisible();
        await expect(page).not.toHaveURL(/\/login/);
        await expect(page.getByRole("heading", { name: "This page could not be loaded", exact: true })).toHaveCount(0);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${route} has ${overflow}px horizontal overflow at ${viewport.width}px`).toBeLessThanOrEqual(1);
        const clippedControls = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("main input, main select, main textarea, main button, main a")].filter((element) => {
          const rect = element.getBoundingClientRect();
          if (rect.width <= 2 || rect.height <= 2 || (rect.left >= -1 && rect.right <= window.innerWidth + 1)) return false;
          for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
            const overflowX = getComputedStyle(ancestor).overflowX;
            if (["auto", "scroll"].includes(overflowX) && ancestor.scrollWidth > ancestor.clientWidth) return false;
          }
          return true;
        }).map((element) => element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 80) || element.tagName));
        expect(clippedControls, `${route} has controls clipped outside the ${viewport.width}px viewport`).toEqual([]);
        if (["/dashboard", "/doc-center", "/groups", "/process-maps"].includes(route)) await page.screenshot({ path: testInfo.outputPath(`${route.slice(1)}-${viewport.width}.png`), fullPage: true });
      });
    }
    expect(pageErrors).toEqual([]);
  });
}

test("document library search, status filter, and pagination work together", async ({ page, context }) => {
  await context.addCookies([{ name: "work-instructions-auth-token", value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`, url: "http://127.0.0.1:3100" }]);
  await page.goto("/doc-center", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Doc Center", exact: true })).toBeVisible();
  await expect(page.getByText("Page 1 of 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Page 2 of 2", { exact: true })).toBeVisible();
  await page.getByPlaceholder(/search/i).fill("traceability");
  await expect(page.getByText("QMS-001 | Production release and traceability procedure", { exact: true })).toBeVisible();
  await expect(page.getByText("Manufacturing process control 2", { exact: false })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Approval status" }).selectOption("Approved");
  await expect(page.getByText("No matching documents", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).first().click();
  await expect(page.getByText("Page 1 of 2", { exact: true })).toBeVisible();
});

const signInCookie = (context: import("@playwright/test").BrowserContext) => context.addCookies([{ name: "work-instructions-auth-token", value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`, url: "http://127.0.0.1:3100", sameSite: "Lax" }]);
const instructionEditor = (page: import("@playwright/test").Page) => page.getByRole("textbox", { name: "Work Instructions", exact: true });
const instructionPreview = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Work Instructions preview", exact: true });

test("tablet captures and uploads a photo before submitting a complete instruction", async ({ page, context }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await signInCookie(context);
  await page.goto("/instructions/new", { waitUntil: "networkidle" });
  const photo = page.getByLabel("Take a photo with the rear camera", { exact: true });
  await expect(photo).toHaveAttribute("capture", "environment");
  await expect(page.getByLabel("Record a video with the rear camera", { exact: true })).toHaveAttribute("capture", "environment");
  await expect(page.getByLabel("Choose photos or videos to upload", { exact: true })).not.toHaveAttribute("capture");
  await expect(page.getByRole("combobox", { name: "Department", exact: true })).toHaveValue("a2000000-0000-0000-0000-000000000001");
  const submit = page.getByRole("button", { name: "Create Instruction", exact: true });
  await submit.click();
  const requiredNotice = page.getByRole("alert").filter({ hasText: "Part ID is required." });
  await expect(requiredNotice).toBeVisible();
  const partId = page.getByRole("textbox", { name: "Part ID", exact: true });
  await expect(partId).toHaveAttribute("aria-invalid", "true");
  const dismiss = requiredNotice.getByRole("button", { name: "Dismiss notification", exact: true });
  await dismiss.focus();
  await dismiss.press("Enter");
  await expect(requiredNotice).toHaveCount(0);
  await partId.fill("MFG-CAMERA-TEST");
  await expect(partId).toHaveAttribute("aria-invalid", "false");
  await page.getByRole("textbox", { name: "Work Item Title", exact: true }).fill("Tablet first article inspection");
  await page.getByRole("textbox", { name: "Process scope / applicability", exact: true }).fill("Cell MFG-02 setup after tool change.");
  await page.getByRole("textbox", { name: "Acceptance criteria", exact: true }).fill("Verify the drawing tolerance and approved torque.");
  await page.getByRole("textbox", { name: "Verification records", exact: true }).fill("First article inspection form and lot record.");
  const editor = instructionEditor(page);
  await editor.fill("Inspect the locating surfaces, load the part, and verify the first article before releasing production.");
  await photo.setInputFiles({ name: "unsafe.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg></svg>") });
  await expect(page.getByRole("alert").filter({ hasText: "unsafe.svg is unsupported" })).toBeVisible();
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN3sAAAAASUVORK5CYII=", "base64");
  await photo.setInputFiles({ name: "capture.png", mimeType: "image/png", buffer: image });
  await expect(editor).toHaveValue(/!\[capture\]\(http[^)]+capture\.png\)/);
  await expect(submit).toBeEnabled();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(instructionPreview(page).locator("figure img")).toHaveAttribute("alt", "capture");
  const saved = page.waitForRequest((request) => request.url().endsWith("/rest/v1/rpc/save_work_instruction_controlled"));
  await submit.click();
  const payload = (await saved).postDataJSON().p_payload;
  expect(payload.partId).toBe("MFG-CAMERA-TEST");
  expect(payload.bodyMarkdown).toMatch(/^Inspect the locating surfaces[^\n]*\n\n!\[capture\]\(/);
  expect(payload.verificationRecords).toContain("lot record");
  await expect(page).toHaveURL(new RegExp(`/instructions/${instructionId}$`), { timeout: 30_000 });
  await expect(page.locator(".screen-work-instructions-body")).toBeVisible();
  await expect(page.locator(".screen-work-instructions-body img")).toHaveCount(1);
});

test("large video uploads use resumable chunks and play inline with seeking", async ({ page, context }) => {
  await signInCookie(context);
  await page.goto("/instructions/new", { waitUntil: "networkidle" });
  const recording = readFileSync("public/header-light.mp4");
  await page.getByLabel("Record a video with the rear camera", { exact: true }).setInputFiles({ name: "capture.mp4", mimeType: "video/mp4", buffer: recording });
  await expect(page.getByRole("button", { name: "Create Instruction", exact: true })).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "Uploading capture.mp4" })).toBeVisible();
  await expect(instructionEditor(page)).toHaveValue(/!\[capture\]\(http[^)]+capture\.mp4\)/, { timeout: 60_000 });
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const video = instructionPreview(page).locator("video");
  await expect(video).toHaveCount(1);
  await expect(video).toHaveAttribute("playsinline", "");
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(1);
  await video.evaluate(async (node: HTMLVideoElement) => { node.muted = true; await node.play(); });
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0.2);
  await video.evaluate((node: HTMLVideoElement) => { node.pause(); node.currentTime = Math.min(node.duration / 2, 1); });
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.seeking)).toBe(false);
  const range = await page.request.get("/api/backend/storage/v1/object/public/instruction-media/fixture.mp4", { headers: { Range: "bytes=0-1023" } });
  expect(range.status()).toBe(206);
  expect(range.headers()["content-range"]).toMatch(/^bytes 0-1023\//);
  expect((await range.body()).length).toBe(1024);
  const summary = await (await page.request.get("http://127.0.0.1:3900/__fixture/media")).json();
  const upload = summary.uploads.find((entry: { offset: number; length: number }) => entry.offset === recording.length && entry.length === recording.length);
  expect(upload.chunks).toHaveLength(2);
  expect(upload.chunks[0]).toBe(6 * 1024 * 1024);
});

test("cancelled video uploads leave the editor usable without inserting partial media", async ({ page, context }) => {
  await signInCookie(context);
  await page.goto("/instructions/new", { waitUntil: "networkidle" });
  const editor = instructionEditor(page);
  await editor.fill("Keep this text.");
  await page.getByLabel("Choose photos or videos to upload", { exact: true }).setInputFiles({ name: "cancel.mp4", mimeType: "video/mp4", buffer: readFileSync("public/header-light.mp4") });
  await page.getByRole("button", { name: "Cancel upload", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Upload cancelled" })).toBeVisible();
  await expect(editor).toHaveValue("Keep this text.");
  await expect(page.getByRole("button", { name: "Create Instruction", exact: true })).toBeEnabled();
});

test("Markdown toolbar commands insert syntax and toggle off on a second click", async ({ page, context }) => {
  await signInCookie(context);
  await page.goto("/instructions/new", { waitUntil: "networkidle" });
  const editor = instructionEditor(page);
  for (const { name, wrapped } of [
    { name: "Bold", wrapped: "**Verify the approved drawing**" },
    { name: "Italic", wrapped: "*Verify the approved drawing*" },
    { name: "Strikethrough", wrapped: "~~Verify the approved drawing~~" },
  ]) {
    await test.step(name, async () => {
      await editor.fill("Verify the approved drawing");
      await editor.press("ControlOrMeta+a");
      const button = page.getByRole("button", { name, exact: true });
      await button.click();
      await expect(editor).toHaveValue(wrapped);
      // The selection stays on the text, so a second click removes the format.
      await button.click();
      await expect(editor).toHaveValue("Verify the approved drawing");
    });
  }
  for (const { name, value } of [
    { name: "Numbered list", value: "1. Clean the fixture\n2. Load the part" },
    { name: "Bulleted list", value: "- Clean the fixture\n- Load the part" },
    { name: "Checklist", value: "- [ ] Clean the fixture\n- [ ] Load the part" },
    { name: "Quote", value: "> Clean the fixture\n> Load the part" },
  ]) {
    await test.step(name, async () => {
      await editor.fill("Clean the fixture\nLoad the part");
      await editor.press("ControlOrMeta+a");
      await page.getByRole("button", { name, exact: true }).click();
      await expect(editor).toHaveValue(value);
      await page.getByRole("button", { name, exact: true }).click();
      await expect(editor).toHaveValue("Clean the fixture\nLoad the part");
    });
  }
  await editor.fill("Setup requirements");
  await page.getByRole("button", { name: "Heading 2", exact: true }).click();
  await expect(editor).toHaveValue("## Setup requirements");
  await page.getByRole("button", { name: "Heading 3", exact: true }).click();
  await expect(editor).toHaveValue("### Setup requirements");
  await editor.fill("Stop the press before clearing a jam.");
  await editor.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Callout", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Caution/ }).click();
  await expect(editor).toHaveValue("> [!CAUTION]\n> Stop the press before clearing a jam.");
  await editor.press("ControlOrMeta+a");
  await editor.press("ControlOrMeta+b");
  await expect(editor).toHaveValue("**> [!CAUTION]\n> Stop the press before clearing a jam.**");
  await editor.press("ControlOrMeta+z");
  await expect(editor).toHaveValue("> [!CAUTION]\n> Stop the press before clearing a jam.");
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(instructionPreview(page).locator('aside[data-tone="danger"]')).toContainText("Stop the press before clearing a jam.");
});

test("Enter continues Markdown lists, a second Enter ends them, and Tab nests list items", async ({ page, context }) => {
  await signInCookie(context);
  await page.goto("/instructions/new", { waitUntil: "networkidle" });
  const editor = instructionEditor(page);
  await editor.fill("");
  await editor.pressSequentially("## Setup requirements");
  await editor.press("Enter");
  await editor.press("Enter");
  await editor.pressSequentially("1. Verify the approved drawing.");
  await editor.press("Enter");
  await editor.pressSequentially("Load the part.");
  await editor.press("Enter");
  await editor.press("Tab");
  await editor.pressSequentially("Notch first.");
  await editor.press("Enter");
  await editor.press("Shift+Tab");
  await editor.pressSequentially("Close the guard.");
  await editor.press("Enter");
  await editor.press("Enter");
  await editor.pressSequentially("**Acceptance criteria**");
  await expect(editor).toHaveValue("## Setup requirements\n\n1. Verify the approved drawing.\n2. Load the part.\n   1. Notch first.\n3. Close the guard.\n\n**Acceptance criteria**");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = instructionPreview(page);
  await expect(preview.locator("h2")).toHaveText("Setup requirements");
  await expect(preview.locator("ol ol > li")).toHaveText("Notch first.");
  await expect(preview.locator("p > strong")).toHaveText("Acceptance criteria");
});

test("Markdown files, callouts, and charts survive saving, viewing, printing, and reopening", async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signInCookie(context);
  await page.goto("/instructions/new", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Part ID", exact: true }).fill("MFG-RICH-CONTENT");
  await page.getByRole("textbox", { name: "Work Item Title", exact: true }).fill("Rich content setup validation");
  await page.getByRole("textbox", { name: "Process scope / applicability", exact: true }).fill("Approved fixture setup.");
  await page.getByRole("textbox", { name: "Acceptance criteria", exact: true }).fill("Use drawing requirements; no invented limits.");
  await page.getByRole("textbox", { name: "Verification records", exact: true }).fill("Retain the first article record.");
  const editor = instructionEditor(page);
  await editor.click();
  const markdownText = "## Setup checks\n\n**Inspect the locating surfaces.**\n\n- Verify the released drawing.\n- Record the first article.\n\n| Check | Reference |\n| --- | --- |\n| Torque | Released drawing |\n\nRetain the setup record.\n";
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "More options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Import .md file", exact: true }).click();
  await (await chooser).setFiles({ name: "fixture-setup.md", mimeType: "text/markdown", buffer: Buffer.from(markdownText) });
  await expect(editor).toHaveValue(markdownText.trim());
  await editor.press("ControlOrMeta+End");
  await page.getByRole("button", { name: "Callout", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Warning/ }).click();
  await page.keyboard.type("Stop if the fixture is damaged.");
  await editor.press("ControlOrMeta+End");
  await page.getByRole("button", { name: "Insert chart", exact: true }).click();
  const chart = page.getByRole("dialog", { name: "Chart", exact: true });
  await chart.getByRole("button", { name: "Insert chart", exact: true }).click();
  await expect(chart.getByRole("alert")).toBeVisible();
  await chart.getByLabel("Chart title", { exact: true }).fill("Observed checks by stage");
  await chart.getByLabel("Chart data", { exact: true }).fill("First article, not a measurement");
  await chart.getByRole("button", { name: "Insert chart", exact: true }).click();
  await expect(chart.getByRole("alert")).toBeVisible();
  await chart.getByLabel("Chart data", { exact: true }).fill("First article, 3\nProduction, 8\nFinal review, 5");
  await chart.getByRole("combobox", { name: "Chart type", exact: true }).selectOption("line");
  await chart.getByRole("button", { name: "Insert chart", exact: true }).click();
  await expect(editor).toHaveValue(/> \[!WARNING\]\n> Stop if the fixture is damaged\.\n\n```chart\ntype: line\ntitle: Observed checks by stage\nFirst article: 3\nProduction: 8\nFinal review: 5\n```$/);
  // Charts are edited as text: a typo is explained in the preview instead of plotting a wrong value.
  await editor.fill((await editor.inputValue()).replace("Production: 8", "Production: eight"));
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(instructionPreview(page).getByText("Chart unavailable")).toBeVisible();
  await editor.fill((await editor.inputValue()).replace("Production: eight", "Production: 8"));
  await expect(instructionPreview(page).locator('figure[data-type="instruction-chart"]')).toHaveAttribute("data-chart-type", "line");
  await expect(instructionPreview(page).locator('figure[data-type="instruction-chart"] table')).toContainText("Final review");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "More options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Download .md file", exact: true }).click();
  expect((await downloadEvent).suggestedFilename()).toMatch(/\.md$/);
  await page.getByRole("group", { name: "Work Instructions editor", exact: true }).screenshot({ path: testInfo.outputPath("markdown-editor-desktop.png"), style: "header { visibility: hidden !important; }" });
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.getByRole("group", { name: "Work Instructions editor", exact: true }).screenshot({ path: testInfo.outputPath("markdown-editor-tablet.png"), style: "header { visibility: hidden !important; }" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const saved = page.waitForRequest((request) => request.url().endsWith("/rest/v1/rpc/save_work_instruction_controlled"));
  await page.getByRole("button", { name: "Create Instruction", exact: true }).click();
  const payload = (await saved).postDataJSON().p_payload;
  expect(payload.bodyMarkdown).toContain("```chart\ntype: line");
  expect(payload.bodyMarkdown).toContain("> [!WARNING]");
  expect(payload.bodyMarkdown).not.toContain("<");
  await expect(page).toHaveURL(new RegExp(`/instructions/${instructionId}$`), { timeout: 30_000 });
  const screenBody = page.locator(".screen-work-instructions-body");
  await expect(screenBody.locator('[data-type="instruction-chart"]')).toContainText("Observed checks by stage");
  await expect(screenBody.locator('aside[data-tone="warning"]')).toContainText("Stop if the fixture is damaged.");
  await expect(screenBody.locator("table").first()).toContainText("Released drawing");
  await page.goto(`/instructions/${instructionId}/print`, { waitUntil: "networkidle" });
  await expect(page.locator('[data-type="instruction-chart"]')).toContainText("Observed checks by stage");
  await expect(page.locator('aside[data-tone="warning"]')).toHaveCount(1);
  await page.goto(`/instructions/${instructionId}/edit`, { waitUntil: "networkidle" });
  await expect(editor).toHaveValue(/^## Setup checks\n\n\*\*Inspect the locating surfaces\.\*\*/);
  await expect(editor).toHaveValue(/```chart\ntype: line\ntitle: Observed checks by stage/);
});

test("AI instruction previews and applied suggestions become editable Markdown", async ({ page, context }) => {
  await signInCookie(context);
  const enhancedContent = '<h2>Safety and preparation</h2><aside data-type="callout" data-tone="warning"><p><strong>Stop if the fixture or part is damaged.</strong></p></aside><h2>Method</h2><ol><li><p>Verify the released drawing and fixture condition.</p></li><li><p>Record the first article result before release.</p></li></ol><h2>Acceptance and records</h2><table><tbody><tr><th><p>Characteristic</p></th><th><p>Requirement</p></th></tr><tr><td><p>Torque</p></td><td><p>Use the released drawing.</p></td></tr></tbody></table>';
  await page.route("**/api/instructions/enhance", async (route) => {
    const request = route.request().postDataJSON();
    expect(request.instructionBody).toBe("Check the fixture and drawing. Record first article results.");
    await route.fulfill({ json: { originalContent: request.instructionBody, enhancedContent, enhancementNotes: "Organized the supplied content. Requirements still require engineering review.", generationId: null } });
  });
  await page.goto("/instructions/new", { waitUntil: "networkidle" });
  const editor = instructionEditor(page);
  await editor.fill("Check the fixture and drawing. Record first article results.");
  await page.getByRole("button", { name: "Enhance instructions with AI", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Compare Instruction Versions", exact: true })).toBeVisible();
  await expect(page.locator('aside[data-tone="warning"]')).toContainText("Stop if the fixture or part is damaged.");
  await expect(page.getByRole("cell", { name: "Use the released drawing.", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use AI Enhanced Version", exact: true }).click();
  await expect(editor).toHaveValue("## Safety and preparation\n\n> [!WARNING]\n> **Stop if the fixture or part is damaged.**\n\n## Method\n\n1. Verify the released drawing and fixture condition.\n2. Record the first article result before release.\n\n## Acceptance and records\n\n| Characteristic | Requirement |\n| --- | --- |\n| Torque | Use the released drawing. |");
  await editor.press("ControlOrMeta+End");
  await editor.pressSequentially("\n\nEngineering review complete.");
  await expect(editor).toHaveValue(/Engineering review complete\.$/);
});

test("a delayed AI suggestion cannot overwrite edits made while it was being prepared", async ({ page, context }) => {
  await signInCookie(context);
  let releaseResponse = () => {};
  const responseReady = new Promise<void>((resolve) => { releaseResponse = resolve; });
  await page.route("**/api/instructions/enhance", async (route) => {
    const request = route.request().postDataJSON();
    await responseReady;
    await route.fulfill({ json: { originalContent: request.instructionBody, enhancedContent: "<h2>Method</h2><p>Check the fixture before releasing production.</p>", generationId: null } });
  });
  await page.goto("/instructions/new", { waitUntil: "networkidle" });
  const editor = instructionEditor(page);
  await editor.fill("Check the fixture.");
  const requested = page.waitForRequest("**/api/instructions/enhance");
  await page.getByRole("button", { name: "Enhance instructions with AI", exact: true }).click();
  await requested;
  await editor.press("ControlOrMeta+End");
  await editor.pressSequentially(" Preserve the engineering update.");
  await page.getByRole("textbox", { name: "Acceptance criteria", exact: true }).fill("Verify the current drawing tolerance.");
  releaseResponse();
  const comparison = page.getByRole("dialog", { name: "Compare Instruction Versions", exact: true });
  await expect(comparison.getByRole("alert")).toContainText("Your draft changed");
  await expect(comparison.getByRole("button", { name: "Use AI Enhanced Version", exact: true })).toBeDisabled();
  await comparison.getByRole("button", { name: "Keep My Version", exact: true }).click();
  await expect(editor).toHaveValue("Check the fixture. Preserve the engineering update.");
  await expect(page.getByRole("textbox", { name: "Acceptance criteria", exact: true })).toHaveValue("Verify the current drawing tolerance.");
});

test("controlled document header, body, and footer editors format independently", async ({ page, context }) => {
  await signInCookie(context);
  await page.goto("/process-documents", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "New document", exact: true }).first().click();
  await page.getByRole("checkbox", { name: "Header", exact: true }).check();
  await page.getByRole("checkbox", { name: "Footer", exact: true }).check();
  const formatted: Record<string, string> = {};
  for (const { label, content, format, expected } of [
    { label: "Header", content: "Controlled manufacturing procedure", format: "Bold", expected: "**Controlled manufacturing procedure**" },
    { label: "Document Body", content: "Verify requirements before release.", format: "Italic", expected: "*Verify requirements before release.*" },
    { label: "Footer", content: "Verify the approved revision before use.", format: "Strikethrough", expected: "~~Verify the approved revision before use.~~" },
  ]) {
    const group = page.getByRole("group", { name: `${label} editor`, exact: true });
    const editor = group.getByRole("textbox", { name: label, exact: true });
    await editor.fill(content);
    await editor.press("ControlOrMeta+a");
    await group.getByRole("button", { name: format, exact: true }).click();
    await expect(editor).toHaveValue(expected);
    formatted[label] = expected;
  }
  for (const [label, expected] of Object.entries(formatted)) {
    await expect(page.getByRole("textbox", { name: label, exact: true })).toHaveValue(expected);
  }
  const body = page.getByRole("group", { name: "Document Body editor", exact: true });
  await body.getByRole("button", { name: "Heading 3", exact: true }).click();
  await expect(body.getByRole("textbox", { name: "Document Body", exact: true })).toHaveValue("### *Verify requirements before release.*");
  await body.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(body.getByRole("region", { name: "Document Body preview", exact: true }).locator("h3 em")).toHaveText("Verify requirements before release.");
});

test("links, undo and redo, and tables insert valid Markdown", async ({ page, context }) => {
  await signInCookie(context);
  await page.goto("/instructions/new", { waitUntil: "networkidle" });
  const editor = instructionEditor(page);
  await editor.fill("Released drawing specification");
  await editor.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Link", exact: true }).click();
  const link = page.getByRole("dialog", { name: "Link", exact: true });
  await expect(link.getByRole("textbox", { name: "Link text", exact: true })).toHaveValue("Released drawing specification");
  await link.getByRole("textbox", { name: "Link URL", exact: true }).fill("javascript:alert(1)");
  await link.getByRole("button", { name: "Insert link", exact: true }).click();
  await expect(link.getByRole("alert")).toBeVisible();
  await expect(editor).toHaveValue("Released drawing specification");
  await link.getByRole("textbox", { name: "Link URL", exact: true }).fill("https://example.invalid/released-drawing");
  await link.getByRole("button", { name: "Insert link", exact: true }).click();
  await expect(editor).toHaveValue("[Released drawing specification](https://example.invalid/released-drawing)");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor).toHaveValue("Released drawing specification");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(editor).toHaveValue("[Released drawing specification](https://example.invalid/released-drawing)");
  await editor.press("ControlOrMeta+End");
  await page.getByRole("button", { name: "Insert table", exact: true }).click();
  await expect(editor).toHaveValue(/\n\n\| Step \| Check \| Result \|\n\| --- \| --- \| --- \|\n\|  \|  \|  \|\n\|  \|  \|  \|$/);
  await page.keyboard.type("Station");
  await expect(editor).toHaveValue(/\| Station \| Check \| Result \|/);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = instructionPreview(page);
  await expect(preview.getByRole("link", { name: "Released drawing specification" })).toHaveAttribute("href", "https://example.invalid/released-drawing");
  await expect(preview.locator("th")).toHaveText(["Station", "Check", "Result"]);
});

test("unsaved instruction navigation can be cancelled or confirmed for links and browser back", async ({ page, context }) => {
  await signInCookie(context);
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "New Instruction", exact: true }).click();
  await expect(page).toHaveURL(/\/instructions\/new$/);
  const editor = instructionEditor(page);
  await editor.fill("Keep this draft until the author decides to leave.");
  await page.getByRole("navigation", { name: "Workspace navigation", exact: true }).getByRole("link", { name: "Dashboard", exact: true }).click();
  const prompt = page.getByRole("heading", { name: "Discard unsaved changes?", exact: true });
  await expect(prompt).toBeVisible();
  await page.getByRole("button", { name: "Keep Editing", exact: true }).click();
  await expect(prompt).toHaveCount(0);
  await expect(editor).toHaveValue("Keep this draft until the author decides to leave.");
  await page.evaluate(() => window.history.back());
  await expect(prompt).toBeVisible();
  await page.getByRole("button", { name: "Keep Editing", exact: true }).click();
  await expect(editor).toHaveValue("Keep this draft until the author decides to leave.");
  await page.getByRole("navigation", { name: "Workspace navigation", exact: true }).getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(prompt).toBeVisible();
  await page.getByRole("button", { name: "Leave Without Saving", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  await page.getByRole("link", { name: "New Instruction", exact: true }).click();
  await expect(page).toHaveURL(/\/instructions\/new$/);
  await editor.fill("A second draft for browser back confirmation.");
  await page.evaluate(() => window.history.back());
  await expect(prompt).toBeVisible();
  await page.getByRole("button", { name: "Leave Without Saving", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
});

test("yield calculator distinguishes failed units from multiple defects on a unit", async ({ page, context }) => {
  await context.addCookies([{ name: "work-instructions-auth-token", value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`, url: "http://127.0.0.1:3100" }]);
  await page.goto("/process-maps/formulas", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Yield / RTY", exact: true }).click();
  await page.getByLabel("Units started", { exact: true }).fill("100");
  await page.getByLabel("Failed first-pass units", { exact: true }).fill("3");
  await page.getByLabel("Total defects", { exact: true }).fill("40");
  const firstPassResult = page.locator("dl > div").filter({ has: page.locator("dt").filter({ hasText: /^First pass yield$/ }) });
  const defectResult = page.locator("dl > div").filter({ has: page.locator("dt").filter({ hasText: /^Defects \/ unit$/ }) });
  await expect(firstPassResult.locator("dd").last()).toHaveText("97.00%");
  await expect(defectResult.locator("dd").last()).toHaveText("0.4000");
  await page.getByLabel("Failed first-pass units", { exact: true }).fill("101");
  await expect(firstPassResult.locator("dd").last()).toHaveText("N/A");
  await expect(defectResult.locator("dd").last()).toHaveText("0.4000");
});
