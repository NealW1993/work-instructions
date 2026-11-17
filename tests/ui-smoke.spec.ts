import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
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

const signInCookie = (context: BrowserContext) => context.addCookies([{ name: "work-instructions-auth-token", value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`, url: "http://127.0.0.1:3100", sameSite: "Lax" }]);
const instructionEditor = (page: Page) => page.getByRole("textbox", { name: "Work Instructions", exact: true });
const instructionEditorGroup = (page: Page) => page.getByRole("group", { name: "Work Instructions editor", exact: true });
const workspaceTabs = (page: Page) => page.getByRole("navigation", { name: "Workspace navigation", exact: true });
const moreDetails = (page: Page) => page.locator("details").filter({ hasText: "More details" });

/** Empties a formatted editor, then types each line as its own paragraph, as an author would. */
async function retype(editor: Locator, ...lines: string[]) {
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.press("Backspace");
  for (const [index, line] of lines.entries()) {
    if (index > 0) await editor.press("Enter");
    await editor.pressSequentially(line);
  }
}

/** The Markdown an editor saves, read the way an author can: More options, then Download .md file. */
async function savedMarkdown(group: Locator) {
  const downloaded = group.page().waitForEvent("download");
  await group.getByRole("button", { name: "More options", exact: true }).click();
  await group.getByRole("menuitem", { name: "Download .md file", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  return readFileSync(await download.path(), "utf8");
}

/** The optional "More details" section starts collapsed; open it to fill in its fields. */
async function openMoreDetails(page: Page) {
  const section = moreDetails(page);
  if (!(await section.evaluate((element) => (element as HTMLDetailsElement).open))) await section.locator("summary").click();
  await expect(page.getByRole("textbox", { name: "Where this applies", exact: true })).toBeVisible();
}

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
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Tablet first article inspection");
  await openMoreDetails(page);
  await page.getByRole("textbox", { name: "Where this applies", exact: true }).fill("Cell MFG-02 setup after tool change.");
  await page.getByRole("textbox", { name: "What good looks like", exact: true }).fill("Verify the drawing tolerance and approved torque.");
  await page.getByRole("textbox", { name: "Records to fill out", exact: true }).fill("First article inspection form and lot record.");
  const editor = instructionEditor(page);
  await editor.fill("Inspect the locating surfaces, load the part, and verify the first article before releasing production.");
  await photo.setInputFiles({ name: "unsafe.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg></svg>") });
  await expect(page.getByRole("alert").filter({ hasText: "unsafe.svg is unsupported" })).toBeVisible();
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN3sAAAAASUVORK5CYII=", "base64");
  await photo.setInputFiles({ name: "capture.png", mimeType: "image/png", buffer: image });
  // The photo appears in place, as operators will see it.
  const placed = editor.locator("figure img");
  await expect(placed).toHaveAttribute("alt", "capture");
  await expect(placed).toHaveAttribute("src", /capture\.png/);
  await expect(submit).toBeEnabled();
  const saved = page.waitForRequest((request) => request.url().endsWith("/rest/v1/rpc/save_work_instruction_controlled"));
  await submit.click();
  const payload = (await saved).postDataJSON().p_payload;
  expect(payload.partId).toBe("MFG-CAMERA-TEST");
  expect(payload.bodyMarkdown).toMatch(/^Inspect the locating surfaces[^\n]*\n\n!\[capture\]\(http[^)]+capture\.png\)$/);
  expect(payload.verificationRecords).toContain("lot record");
  await expect(page).toHaveURL(new RegExp(`/instructions/${instructionId}$`), { timeout: 30_000 });
  await expect(page.locator(".screen-work-instructions-body")).toBeVisible();
  await expect(page.locator(".screen-work-instructions-body img")).toHaveCount(1);
});

test("a new instruction needs only a part, a title and steps; tools and extra details are optional", async ({ page, context }) => {
  await signInCookie(context);
  await page.goto("/instructions/new", { waitUntil: "networkidle" });
  const section = moreDetails(page);
  await expect(section).toHaveJSProperty("open", false);
  await expect(section).toContainText("(optional)");
  await expect(page.getByRole("textbox", { name: "Where this applies", exact: true })).toBeHidden();
  await expect(page.locator("main").getByText(/\bISO\b/)).toHaveCount(0);
  await page.getByRole("textbox", { name: "Part ID", exact: true }).fill("MFG-SIMPLE");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Simple setup check");
  await instructionEditor(page).fill("Verify the fixture before the first part.");

  // Clicking anywhere in the tools field puts the cursor in it; typing and Enter adds a tool.
  const tools = page.getByRole("combobox", { name: /^Tools needed/ });
  await page.locator("[data-tools-field]").click({ position: { x: 12, y: 12 } });
  await expect(tools).toBeFocused();
  await tools.pressSequentially("Torque wrench");
  await tools.press("Enter");
  await expect(page.locator('[data-tool-chip="Torque wrench"]')).toBeVisible();
  await expect(tools).toHaveValue("");
  await expect(tools).toBeFocused();
  await tools.pressSequentially("10 mm socket");
  await page.getByRole("button", { name: "Add tool", exact: true }).click();
  await expect(page.locator("[data-tool-chip] > span:first-child")).toHaveText(["Torque wrench", "10 mm socket"]);
  await tools.pressSequentially("torque wrench");
  await tools.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "already in the list" })).toBeVisible();
  await page.getByRole("button", { name: "Remove 10 mm socket", exact: true }).click();
  await expect(page.locator("[data-tool-chip] > span:first-child")).toHaveText(["Torque wrench"]);
  // A tool that was typed but not added yet is still saved.
  await tools.fill("Feeler gauge");

  const saved = page.waitForRequest((request) => request.url().endsWith("/rest/v1/rpc/save_work_instruction_controlled"));
  await page.getByRole("button", { name: "Create Instruction", exact: true }).click();
  const payload = (await saved).postDataJSON().p_payload;
  expect(payload.partId).toBe("MFG-SIMPLE");
  expect(payload.uncommonTools).toBe("Torque wrench, Feeler gauge");
  expect([payload.processScope, payload.acceptanceCriteria, payload.verificationRecords, payload.riskControls]).toEqual(["", "", "", ""]);
  await expect(page).toHaveURL(new RegExp(`/instructions/${instructionId}$`), { timeout: 30_000 });
});

test("large video uploads use resumable chunks and play inline with seeking", async ({ page, context }) => {
  await signInCookie(context);
  await page.goto("/instructions/new", { waitUntil: "networkidle" });
  const recording = readFileSync("public/header-light.mp4");
  await page.getByLabel("Record a video with the rear camera", { exact: true }).setInputFiles({ name: "capture.mp4", mimeType: "video/mp4", buffer: recording });
  await expect(page.getByRole("button", { name: "Create Instruction", exact: true })).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "Uploading capture.mp4" })).toBeVisible();
  // The finished upload plays in place inside the editor.
  const video = instructionEditor(page).locator("figure video");
  await expect(video).toHaveCount(1, { timeout: 60_000 });
  expect(await savedMarkdown(instructionEditorGroup(page))).toMatch(/!\[capture\]\(http[^)]+capture\.mp4\)/);
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
  await expect(editor).toHaveText("Keep this text.");
  await expect(editor.locator('figure, [data-type="upload-placeholder"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create Instruction", exact: true })).toBeEnabled();
});

test("the toolbar formats text in place and a second click removes the format", async ({ page, context }) => {
  await signInCookie(context);
  await page.goto("/instructions/new", { waitUntil: "networkidle" });
  const editor = instructionEditor(page);
  const group = instructionEditorGroup(page);
  for (const { name, tag } of [
    { name: "Bold", tag: "strong" },
    { name: "Italic", tag: "em" },
    { name: "Strikethrough", tag: "s" },
  ]) {
    await test.step(name, async () => {
      await retype(editor, "Verify the approved drawing");
      await editor.press("ControlOrMeta+a");
      const button = group.getByRole("button", { name, exact: true });
      await button.click();
      await expect(editor.locator(tag)).toHaveText("Verify the approved drawing");
      await expect(button).toHaveAttribute("aria-pressed", "true");
      // The selection stays on the text, so a second click removes the format.
      await button.click();
      await expect(editor.locator(tag)).toHaveCount(0);
      await expect(editor).toHaveText("Verify the approved drawing");
    });
  }
  for (const { name, item } of [
    { name: "Numbered list", item: "ol > li" },
    { name: "Bulleted list", item: "ul:not([data-type]) > li" },
    // A checklist item's text sits beside its checkbox, whose accessible label repeats the text.
    { name: "Checklist", item: 'ul[data-type="taskList"] > li > div' },
    { name: "Quote", item: "blockquote > p" },
  ]) {
    await test.step(name, async () => {
      await retype(editor, "Clean the fixture", "Load the part");
      await editor.press("ControlOrMeta+a");
      const button = group.getByRole("button", { name, exact: true });
      await button.click();
      await expect(editor.locator(item)).toHaveText(["Clean the fixture", "Load the part"]);
      await button.click();
      await expect(editor.locator(item)).toHaveCount(0);
      // The editor keeps an empty last line below lists; only the written lines count here.
      await expect(editor.locator(":scope > p").filter({ hasText: /\S/ })).toHaveText(["Clean the fixture", "Load the part"]);
    });
  }
  await test.step("Headings", async () => {
    await retype(editor, "Setup requirements");
    await group.getByRole("button", { name: "Heading 2", exact: true }).click();
    await expect(editor.locator("h2")).toHaveText("Setup requirements");
    await group.getByRole("button", { name: "Heading 3", exact: true }).click();
    await expect(editor.locator("h3")).toHaveText("Setup requirements");
    await expect(editor.locator("h2")).toHaveCount(0);
  });
  await test.step("Safety callouts", async () => {
    await retype(editor, "Stop the press before clearing a jam.");
    await editor.press("ControlOrMeta+a");
    await group.getByRole("button", { name: "Callout", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Caution/ }).click();
    const callout = editor.locator('aside[data-type="callout"]');
    await expect(callout).toHaveAttribute("data-tone", "danger");
    await expect(callout).toHaveText("Stop the press before clearing a jam.");
    await editor.press("ControlOrMeta+a");
    await editor.press("ControlOrMeta+b");
    await expect(callout.locator("strong")).toHaveText("Stop the press before clearing a jam.");
    await editor.press("ControlOrMeta+z");
    await expect(callout.locator("strong")).toHaveCount(0);
    expect(await savedMarkdown(group)).toBe("> [!CAUTION]\n> Stop the press before clearing a jam.");
    // The menu changes the kind of the callout around the cursor, or removes it.
    await callout.click();
    await group.getByRole("button", { name: "Callout", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Warning/ }).click();
    await expect(callout).toHaveAttribute("data-tone", "warning");
    await group.getByRole("button", { name: "Callout", exact: true }).click();
    await page.getByRole("menuitem", { name: "Remove callout", exact: true }).click();
    await expect(callout).toHaveCount(0);
    await expect(editor.locator(":scope > p").filter({ hasText: /\S/ })).toHaveText(["Stop the press before clearing a jam."]);
  });
});

test("Markdown shortcuts format as you type; Enter continues lists, a second Enter ends them, and Tab nests items", async ({ page, context }) => {
  await signInCookie(context);
  await page.goto("/instructions/new", { waitUntil: "networkidle" });
  const editor = instructionEditor(page);
  await editor.click();
  await editor.pressSequentially("## Setup requirements");
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
  await expect(editor.locator("h2")).toHaveText("Setup requirements");
  await expect(editor.locator(":scope > ol > li > p")).toHaveText(["Verify the approved drawing.", "Load the part.", "Close the guard."]);
  await expect(editor.locator("ol ol > li")).toHaveText("Notch first.");
  await expect(editor.locator(":scope > p > strong")).toHaveText("Acceptance criteria");
  expect(await savedMarkdown(instructionEditorGroup(page))).toBe("## Setup requirements\n\n1. Verify the approved drawing.\n2. Load the part.\n   1. Notch first.\n3. Close the guard.\n\n**Acceptance criteria**");
  // Markdown pasted as plain text (for example from a .md file) arrives formatted, not as symbols.
  await editor.locator("h2").first().click();
  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  await editor.evaluate((element) => {
    const data = new DataTransfer();
    data.setData("text/plain", "## Records\n\n- Keep the traveler\n- File the audit sheet");
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(editor.locator("h2")).toHaveText(["Setup requirements", "Records"]);
  await expect(editor.locator(":scope > ul > li")).toHaveText(["Keep the traveler", "File the audit sheet"]);
});

test("imported Markdown, callouts and charts survive saving, viewing, printing and reopening", async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signInCookie(context);
  await page.goto("/instructions/new", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Part ID", exact: true }).fill("MFG-RICH-CONTENT");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Rich content setup validation");
  await openMoreDetails(page);
  await page.getByRole("textbox", { name: "Where this applies", exact: true }).fill("Approved fixture setup.");
  await page.getByRole("textbox", { name: "What good looks like", exact: true }).fill("Use drawing requirements; no invented limits.");
  await page.getByRole("textbox", { name: "Records to fill out", exact: true }).fill("Retain the first article record.");
  const editor = instructionEditor(page);
  const group = instructionEditorGroup(page);
  await editor.click();
  const markdownText = "## Setup checks\n\n**Inspect the locating surfaces.**\n\n- Verify the released drawing.\n- Record the first article.\n\n| Check | Reference |\n| --- | --- |\n| Torque | Released drawing |\n\nRetain the setup record.\n";
  const chooser = page.waitForEvent("filechooser");
  await group.getByRole("button", { name: "More options", exact: true }).click();
  await group.getByRole("menuitem", { name: "Import .md file", exact: true }).click();
  await (await chooser).setFiles({ name: "fixture-setup.md", mimeType: "text/markdown", buffer: Buffer.from(markdownText) });
  // The file opens formatted, ready to edit.
  await expect(editor.locator("h2")).toHaveText("Setup checks");
  await expect(editor.locator(":scope > ul > li")).toHaveText(["Verify the released drawing.", "Record the first article."]);
  await expect(editor.locator("td")).toHaveText(["Torque", "Released drawing"]);

  // A safety callout after the last line; Enter on its empty last line continues below it.
  await editor.press("ControlOrMeta+End");
  await group.getByRole("button", { name: "Callout", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Warning/ }).click();
  await page.keyboard.type("Stop if the fixture is damaged.");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(editor.locator('aside[data-tone="warning"]')).toHaveText("Stop if the fixture is damaged.");

  await group.getByRole("button", { name: "Insert chart", exact: true }).click();
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
  await expect(chart).toHaveCount(0);
  const placedChart = editor.locator('figure[data-type="instruction-chart"]');
  await expect(placedChart).toHaveAttribute("data-chart-type", "line");
  await expect(placedChart.locator("figcaption")).toHaveText("Observed checks by stage");

  // Charts are changed through the same dialog; a typo is explained instead of plotting a wrong value.
  await editor.getByRole("button", { name: "Edit chart", exact: true }).click();
  await expect(chart.getByLabel("Chart data", { exact: true })).toHaveValue("First article, 3\nProduction, 8\nFinal review, 5");
  await chart.getByLabel("Chart data", { exact: true }).fill("First article, 3\nProduction, eight\nFinal review, 5");
  await chart.getByRole("button", { name: "Update chart", exact: true }).click();
  await expect(chart.getByRole("alert")).toBeVisible();
  await chart.getByLabel("Chart data", { exact: true }).fill("First article, 3\nProduction, 9\nFinal review, 5");
  await chart.getByRole("button", { name: "Update chart", exact: true }).click();
  await expect(chart).toHaveCount(0);
  await expect(placedChart.locator("td")).toHaveText(["3", "9", "5"]);

  const markdown = await savedMarkdown(group);
  expect(markdown).toMatch(/^## Setup checks\n\n\*\*Inspect the locating surfaces\.\*\*\n\n- Verify the released drawing\.\n- Record the first article\.\n\n\| Check +\| Reference +\|\n/);
  expect(markdown).toMatch(/\n\nRetain the setup record\.\n\n> \[!WARNING\]\n> Stop if the fixture is damaged\.\n\n```chart\ntype: line\ntitle: Observed checks by stage\nFirst article: 3\nProduction: 9\nFinal review: 5\n```$/);
  await group.screenshot({ path: testInfo.outputPath("markdown-editor-desktop.png"), style: "header { visibility: hidden !important; }" });
  await page.setViewportSize({ width: 768, height: 1024 });
  await group.screenshot({ path: testInfo.outputPath("markdown-editor-tablet.png"), style: "header { visibility: hidden !important; }" });
  await page.setViewportSize({ width: 1440, height: 1000 });

  const saved = page.waitForRequest((request) => request.url().endsWith("/rest/v1/rpc/save_work_instruction_controlled"));
  await page.getByRole("button", { name: "Create Instruction", exact: true }).click();
  const payload = (await saved).postDataJSON().p_payload;
  expect(payload.bodyMarkdown).toBe(markdown);
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
  await expect(editor.locator("h2").first()).toHaveText("Setup checks");
  await expect(editor.locator(":scope > p > strong").first()).toHaveText("Inspect the locating surfaces.");
  await expect(editor.locator('aside[data-tone="warning"]')).toContainText("Stop if the fixture is damaged.");
  await expect(editor.locator('figure[data-type="instruction-chart"] figcaption')).toHaveText("Observed checks by stage");
  // Clicking into a saved instruction is not an edit: leaving does not ask to discard changes.
  await editor.locator("h2").first().click();
  await editor.press("ControlOrMeta+End");
  await workspaceTabs(page).getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Discard unsaved changes?", exact: true })).toHaveCount(0);
});

test("AI instruction previews and applied suggestions become formatted, editable content", async ({ page, context }) => {
  await signInCookie(context);
  const enhancedContent = '<h2>Safety and preparation</h2><aside data-type="callout" data-tone="warning"><p><strong>Stop if the fixture or part is damaged.</strong></p></aside><h2>Method</h2><ol><li><p>Verify the released drawing and fixture condition.</p></li><li><p>Record the first article result before release.</p></li></ol><h2>Acceptance and records</h2><table><tbody><tr><th><p>Characteristic</p></th><th><p>Requirement</p></th></tr><tr><td><p>Torque</p></td><td><p>Use the released drawing.</p></td></tr></tbody></table>';
  await page.route("**/api/instructions/enhance", async (route) => {
    const request = route.request().postDataJSON();
    expect(request.instructionBody).toBe("Check the fixture and drawing. Record first article results.");
    await route.fulfill({ json: { originalContent: request.instructionBody, enhancedContent, enhancementNotes: "Organized the supplied content. Requirements still require engineering review.", generationId: null } });
  });
  await page.goto("/instructions/new", { waitUntil: "networkidle" });
  const editor = instructionEditor(page);
  const group = instructionEditorGroup(page);
  await editor.fill("Check the fixture and drawing. Record first article results.");
  await page.getByRole("button", { name: "Enhance instructions with AI", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Compare Instruction Versions", exact: true })).toBeVisible();
  await expect(page.locator('aside[data-tone="warning"]')).toContainText("Stop if the fixture or part is damaged.");
  await expect(page.getByRole("cell", { name: "Use the released drawing.", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use AI Enhanced Version", exact: true }).click();
  await expect(editor.locator("h2")).toHaveText(["Safety and preparation", "Method", "Acceptance and records"]);
  await expect(editor.locator('aside[data-tone="warning"] strong')).toHaveText("Stop if the fixture or part is damaged.");
  await expect(editor.locator("ol > li")).toHaveText(["Verify the released drawing and fixture condition.", "Record the first article result before release."]);
  expect(await savedMarkdown(group)).toBe("## Safety and preparation\n\n> [!WARNING]\n> **Stop if the fixture or part is damaged.**\n\n## Method\n\n1. Verify the released drawing and fixture condition.\n2. Record the first article result before release.\n\n## Acceptance and records\n\n| Characteristic | Requirement |\n| --- | --- |\n| Torque | Use the released drawing. |");
  // There is always a line below a final table to keep writing on.
  await editor.locator("h2").first().click();
  await editor.press("ControlOrMeta+End");
  await editor.pressSequentially("Engineering review complete.");
  await expect(editor.locator(":scope > p").last()).toHaveText("Engineering review complete.");
  expect(await savedMarkdown(group)).toMatch(/\| Torque +\| Use the released drawing\. \|\n\nEngineering review complete\.$/);
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
  await openMoreDetails(page);
  await page.getByRole("textbox", { name: "What good looks like", exact: true }).fill("Verify the current drawing tolerance.");
  releaseResponse();
  const comparison = page.getByRole("dialog", { name: "Compare Instruction Versions", exact: true });
  await expect(comparison.getByRole("alert")).toContainText("Your draft changed");
  await expect(comparison.getByRole("button", { name: "Use AI Enhanced Version", exact: true })).toBeDisabled();
  await comparison.getByRole("button", { name: "Keep My Version", exact: true }).click();
  await expect(editor).toHaveText("Check the fixture. Preserve the engineering update.");
  await expect(page.getByRole("textbox", { name: "What good looks like", exact: true })).toHaveValue("Verify the current drawing tolerance.");
});

test("controlled document header, body, and footer editors format independently", async ({ page, context }) => {
  await signInCookie(context);
  await page.goto("/process-documents", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "New document", exact: true }).first().click();
  await page.getByRole("checkbox", { name: "Header", exact: true }).check();
  await page.getByRole("checkbox", { name: "Footer", exact: true }).check();
  const editors = [
    { label: "Header", content: "Controlled manufacturing procedure", format: "Bold", tag: "strong", markdown: "**Controlled manufacturing procedure**" },
    { label: "Document Body", content: "Verify requirements before release.", format: "Italic", tag: "em", markdown: "*Verify requirements before release.*" },
    { label: "Footer", content: "Verify the approved revision before use.", format: "Strikethrough", tag: "s", markdown: "~~Verify the approved revision before use.~~" },
  ];
  for (const { label, content, format, tag, markdown } of editors) {
    const group = page.getByRole("group", { name: `${label} editor`, exact: true });
    const editor = group.getByRole("textbox", { name: label, exact: true });
    await retype(editor, content);
    await editor.press("ControlOrMeta+a");
    await group.getByRole("button", { name: format, exact: true }).click();
    await expect(editor.locator(tag)).toHaveText(content);
    expect(await savedMarkdown(group)).toBe(markdown);
  }
  // Each editor keeps its own content and formatting.
  for (const { label, content, tag } of editors) {
    await expect(page.getByRole("textbox", { name: label, exact: true }).locator(tag)).toHaveText(content);
  }
  const body = page.getByRole("group", { name: "Document Body editor", exact: true });
  await body.getByRole("textbox", { name: "Document Body", exact: true }).click();
  await body.getByRole("button", { name: "Heading 3", exact: true }).click();
  await expect(body.getByRole("textbox", { name: "Document Body", exact: true }).locator("h3 em")).toHaveText("Verify requirements before release.");
  expect(await savedMarkdown(body)).toBe("### *Verify requirements before release.*");
});

test("links, undo and redo, and tables work in place and save as Markdown", async ({ page, context }) => {
  await signInCookie(context);
  await page.goto("/instructions/new", { waitUntil: "networkidle" });
  const editor = instructionEditor(page);
  const group = instructionEditorGroup(page);
  await editor.fill("Released drawing specification");
  await editor.press("ControlOrMeta+a");
  await group.getByRole("button", { name: "Link", exact: true }).click();
  const link = page.getByRole("dialog", { name: "Link", exact: true });
  await expect(link.getByRole("textbox", { name: "Link text", exact: true })).toHaveValue("Released drawing specification");
  await link.getByRole("textbox", { name: "Link URL", exact: true }).fill("javascript:alert(1)");
  await link.getByRole("button", { name: "Insert link", exact: true }).click();
  await expect(link.getByRole("alert")).toBeVisible();
  await expect(editor.getByRole("link")).toHaveCount(0);
  await link.getByRole("textbox", { name: "Link URL", exact: true }).fill("https://example.invalid/released-drawing");
  await link.getByRole("button", { name: "Insert link", exact: true }).click();
  const inserted = editor.getByRole("link", { name: "Released drawing specification", exact: true });
  await expect(inserted).toHaveAttribute("href", "https://example.invalid/released-drawing");
  await group.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor.getByRole("link")).toHaveCount(0);
  await expect(editor).toHaveText("Released drawing specification");
  await group.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(inserted).toHaveAttribute("href", "https://example.invalid/released-drawing");
  // Ctrl+K on a link opens it for editing.
  await inserted.click();
  await editor.press("ControlOrMeta+k");
  await expect(link.getByRole("textbox", { name: "Link URL", exact: true })).toHaveValue("https://example.invalid/released-drawing");
  await expect(link.getByRole("button", { name: "Remove link", exact: true })).toBeVisible();
  await link.getByRole("button", { name: "Cancel", exact: true }).click();

  // A new table starts with the cursor in its first empty cell.
  await editor.press("ControlOrMeta+End");
  await group.getByRole("button", { name: "Insert table", exact: true }).click();
  await page.keyboard.type("Torque");
  await expect(editor.locator("th")).toHaveText(["Step", "Check", "Result"]);
  await expect(editor.locator("tr").nth(1).locator("td").first()).toHaveText("Torque");
  const tableTools = group.getByRole("toolbar", { name: "Table", exact: true });
  await tableTools.getByRole("button", { name: "Add row", exact: true }).click();
  await expect(editor.locator("tr")).toHaveCount(4);
  await editor.locator("tr").nth(2).locator("td").first().click();
  await tableTools.getByRole("button", { name: "Delete row", exact: true }).click();
  await expect(editor.locator("tr")).toHaveCount(3);
  await expect(editor.locator("tr").nth(1).locator("td").first()).toHaveText("Torque");
  expect(await savedMarkdown(group)).toMatch(/^\[Released drawing specification\]\(https:\/\/example\.invalid\/released-drawing\)\n\n\| Step +\| Check +\| Result +\|\n\| -+ \| -+ \| -+ \|\n\| Torque +\|/);
});

test("unsaved instruction navigation can be cancelled or confirmed for links and browser back", async ({ page, context }) => {
  await signInCookie(context);
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "New Instruction", exact: true }).click();
  await expect(page).toHaveURL(/\/instructions\/new$/);
  const editor = instructionEditor(page);
  await editor.fill("Keep this draft until the author decides to leave.");
  await workspaceTabs(page).getByRole("link", { name: "Dashboard", exact: true }).click();
  const prompt = page.getByRole("heading", { name: "Discard unsaved changes?", exact: true });
  await expect(prompt).toBeVisible();
  await page.getByRole("button", { name: "Keep Editing", exact: true }).click();
  await expect(prompt).toHaveCount(0);
  await expect(editor).toHaveText("Keep this draft until the author decides to leave.");
  await page.evaluate(() => window.history.back());
  await expect(prompt).toBeVisible();
  await page.getByRole("button", { name: "Keep Editing", exact: true }).click();
  await expect(editor).toHaveText("Keep this draft until the author decides to leave.");
  await workspaceTabs(page).getByRole("link", { name: "Dashboard", exact: true }).click();
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

test("the header shows every workspace as a tab, with instruction shortcuts and the account menu", async ({ page, context }) => {
  await signInCookie(context);
  await page.goto("/doc-center", { waitUntil: "networkidle" });
  const tabs = workspaceTabs(page);
  await expect(tabs.getByRole("link")).toHaveText(["Dashboard", "Doc Center", "Process Docs", "Process Maps", "Formula Tools", "Groups"]);
  await expect(tabs.getByRole("link", { name: "Doc Center", exact: true })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "Formula Tools", exact: true }).click();
  await expect(page).toHaveURL(/\/process-maps\/formulas$/);
  await expect(tabs.getByRole("link", { name: "Formula Tools", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("link", { name: "Process Maps", exact: true })).not.toHaveAttribute("aria-current", "page");

  const options = page.getByRole("button", { name: "More instruction options", exact: true });
  await options.click();
  await expect(page.getByRole("link", { name: /^Import instruction/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^My drafts/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Archived instructions/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: /^Import instruction/ })).toHaveCount(0);
  await expect(options).toBeFocused();

  await page.getByRole("button", { name: /^Account: Quality Reviewer/ }).click();
  await expect(page.getByRole("link", { name: "Account settings", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();

  // On a phone the tabs stay on one row and scroll sideways instead of wrapping.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/groups", { waitUntil: "networkidle" });
  const groupsTab = tabs.getByRole("link", { name: "Groups", exact: true });
  await expect(groupsTab).toHaveAttribute("aria-current", "page");
  await expect(groupsTab).toBeInViewport();
  const rows = await tabs.getByRole("link").evaluateAll((links) => new Set(links.map((link) => Math.round(link.getBoundingClientRect().top))).size);
  expect(rows).toBe(1);
});

test("the header loop plays for the current theme, even with system animations off, and has its own switch", async ({ page, context }) => {
  await signInCookie(context);
  // The loop keeps streaming for a while, so wait for the page itself rather than a quiet network.
  await page.goto("/dashboard");
  // The test device starts with the animation switched off (see the Playwright config).
  await expect(page.locator("header video")).toHaveCount(0);
  await page.getByRole("button", { name: /^Account: / }).click();
  const animation = page.getByRole("switch", { name: "Header animation", exact: true });
  await expect(animation).toHaveAttribute("aria-checked", "false");
  await animation.click();
  await expect(animation).toHaveAttribute("aria-checked", "true");

  const video = page.locator("header video");
  await expect(video).toHaveCount(1);
  await expect(video).toHaveAttribute("loop", "");
  await expect(video).toHaveJSProperty("muted", true);
  const theme = await page.evaluate(() => (document.documentElement.classList.contains("dark") ? "dark" : "light"));
  await expect(video.locator("source")).toHaveAttribute("src", `/header-${theme}.mp4`);
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => !node.paused && node.currentTime > 0), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.playbackRate)).toBe(0.45);
  // Shop computers often have Windows animation effects turned off; the loop still plays.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(video).toHaveCount(1);
  // Changing the theme swaps the loop.
  const other = theme === "dark" ? "light" : "dark";
  await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), other === "dark");
  await expect(page.locator("header video source")).toHaveAttribute("src", `/header-${other}.mp4`);
  // The switch turns it off for this device, and the choice is remembered.
  await animation.click();
  await expect(page.locator("header video")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#main-content")).toBeVisible();
  await expect(page.locator("header video")).toHaveCount(0);
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
