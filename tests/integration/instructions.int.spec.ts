import { expect, test, type Page } from "@playwright/test";
import {
  captureRuntimeErrors,
  closeRoleContexts,
  openActionMenu,
  pageFor,
  searchDashboard,
  serviceClient,
  sessionFor,
  signIn,
  TINY_PNG,
  uniqueId,
} from "./helpers";

test.afterEach(closeRoleContexts);

async function fillInstructionHeader(page: Page, partId: string, title: string, department: string) {
  await page.getByRole("textbox", { name: "Part ID", exact: true }).fill(partId);
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await page.getByRole("combobox", { name: "Department" }).selectOption({ label: department });
  // Nothing else is required: tools and the "More details" section are optional.
}

async function readInstruction(id: string) {
  const { data, error } = await serviceClient()
    .from("work_instructions")
    .select("id, revision, approval_status, is_archived, body_markdown, revision_family_id, uncommon_tools, process_scope, acceptance_criteria, verification_records")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as { id: string; revision: number; approval_status: string; is_archived: boolean; body_markdown: string; revision_family_id: string; uncommon_tools: string; process_scope: string; acceptance_criteria: string; verification_records: string };
}

/** The rendered body. A hidden print copy also exists, so only the visible one counts. */
function instructionBody(page: Page) {
  return page.locator(".prose-markdown:visible").first();
}

function instructionIdFromUrl(page: Page) {
  const match = /\/instructions\/([0-9a-f-]{36})/.exec(page.url());
  expect(match, `instruction URL expected, got ${page.url()}`).not.toBeNull();
  return match![1];
}

test.describe.serial("work instruction lifecycle on the real backend", () => {
  const partId = uniqueId("INT");
  const title = "Integration gearbox torque sequence";
  let instructionId = "";
  let revisedInstructionId = "";

  test("an admin writes a new instruction with callouts, steps, a table, a chart and a photo", async ({ page }) => {
    const errors = captureRuntimeErrors(page);
    await signIn(page, "admin");
    await page.goto("/instructions/new");
    await fillInstructionHeader(page, partId, title, "Assembly");

    // Tools: type one and press Enter. One optional detail: what good looks like.
    const toolField = page.getByRole("combobox", { name: /^Tools needed/ });
    await toolField.click();
    await toolField.pressSequentially("Torque wrench");
    await toolField.press("Enter");
    await expect(page.locator('[data-tool-chip="Torque wrench"]')).toBeVisible();
    await page.locator("details").filter({ hasText: "More details" }).locator("summary").click();
    await page.getByRole("textbox", { name: "What good looks like", exact: true }).fill("Torque within the released drawing limits.");

    const editor = page.getByRole("textbox", { name: "Work Instructions", exact: true });
    const tools = page.getByRole("group", { name: "Work Instructions editor" });
    await editor.click();
    // Formatting appears as you type: "## " starts a heading and "1. " a numbered list.
    await page.keyboard.type("## Setup");
    await page.keyboard.press("Enter");
    await tools.getByRole("button", { name: "Callout" }).click();
    await page.getByRole("menuitem", { name: /Caution/ }).click();
    await page.keyboard.type("Lock out the press before starting.");
    // Enter adds a line inside the callout; Enter on that empty line continues below it.
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("## Steps");
    await page.keyboard.press("Enter");
    await page.keyboard.type("1. Hand-start all six bolts");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Torque to 12 Nm in a star pattern");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Mark each bolt ");
    await tools.getByRole("button", { name: "Bold", exact: true }).click();
    await page.keyboard.type("after torquing");
    await tools.getByRole("button", { name: "Bold", exact: true }).click();
    await page.keyboard.press("Enter");
    await tools.getByRole("button", { name: "Checklist" }).click();
    await page.keyboard.type("Paint mark visible");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Torque logged");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await tools.getByRole("button", { name: "Insert table" }).click();
    // A new table starts in its first empty cell; Tab moves to the next cell.
    await page.keyboard.type("1");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Torque sequence");
    await editor.press("Control+End");

    await tools.getByRole("button", { name: "Insert chart" }).click();
    const chartDialog = page.getByRole("dialog", { name: "Chart" });
    await chartDialog.getByLabel("Chart title").fill("Torque audit (Nm)");
    await chartDialog.getByRole("textbox", { name: "Chart data" }).fill("Bolt 1, 24\nBolt 2, 23.5");
    await chartDialog.getByRole("button", { name: "Insert chart" }).click();
    await expect(chartDialog).toBeHidden();
    await expect(editor.locator("figure[data-type='instruction-chart'] figcaption")).toHaveText("Torque audit (Nm)");

    await page.getByLabel("Choose photos or videos to upload").setInputFiles({ name: "locator.png", mimeType: "image/png", buffer: TINY_PNG });
    await expect(editor.locator('figure img[alt="locator"]')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Uploading locator\.png/)).toHaveCount(0);

    // What the author sees while writing is what operators will see.
    await expect(editor.locator('aside[data-tone="danger"]')).toContainText("Lock out the press before starting.");
    await expect(editor.locator("ol > li")).toHaveText(["Hand-start all six bolts", "Torque to 12 Nm in a star pattern"]);
    await expect(editor.locator('ul[data-type="taskList"] > li > div')).toHaveText(["Paint mark visible", "Torque logged"]);
    await expect(editor.locator("figure[data-type='instruction-chart'] svg")).toBeVisible();

    await page.getByRole("button", { name: "Create Instruction" }).click();
    await page.waitForURL(/\/instructions\/[0-9a-f-]{36}$/, { timeout: 90_000 });
    instructionId = instructionIdFromUrl(page);

    const content = instructionBody(page);
    await expect(content.getByRole("heading", { name: "Setup" })).toBeVisible();
    await expect(content.locator('aside[data-tone="danger"]')).toContainText("Lock out the press before starting.");
    await expect(content.locator("ol > li")).toHaveText(["Hand-start all six bolts", "Torque to 12 Nm in a star pattern"]);
    await expect(content.locator("strong", { hasText: "after torquing" })).toBeVisible();
    await expect(content.locator('li[data-type="taskItem"]')).toHaveCount(2);
    await expect(content.locator("figure[data-type='instruction-chart'] td").first()).toHaveText("24");
    const photo = content.locator('img[alt="locator"]');
    await expect(photo).toHaveAttribute("src", /instruction-media/);
    await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBeGreaterThan(0);

    // It is stored as Markdown.
    const stored = await readInstruction(instructionId);
    expect(stored.approval_status).toBe("pending_review");
    expect(stored.revision).toBe(1);
    expect(stored.body_markdown).toMatch(new RegExp([
      "^## Setup\\n\\n> \\[!CAUTION\\]\\n> Lock out the press before starting\\.\\n\\n",
      "## Steps\\n\\n1\\. Hand-start all six bolts\\n2\\. Torque to 12 Nm in a star pattern\\n\\n",
      "Mark each bolt \\*\\*after torquing\\*\\*\\n\\n",
      "- \\[ \\] Paint mark visible\\n- \\[ \\] Torque logged\\n\\n",
      "\\| Step +\\| Check +\\| Result +\\|\\n\\| -+ \\| -+ \\| -+ \\|\\n\\| 1 +\\| Torque sequence \\| +\\|",
    ].join("")));
    expect(stored.body_markdown).toMatch(/```chart\ntype: bar\ntitle: Torque audit \(Nm\)\nBolt 1: 24\nBolt 2: 23\.5\n```\n\n!\[locator\]\(http[^)\s]+\.png\)$/);
    // The tool and the one detail that was filled in are saved; the details left blank stay blank.
    expect(stored.uncommon_tools).toBe("Torque wrench");
    expect(stored.acceptance_criteria).toBe("Torque within the released drawing limits.");
    expect([stored.process_scope, stored.verification_records]).toEqual(["", ""]);
    // The detail is shown in its own box above the steps, not inside the steps text.
    const goodLooksLike = page.getByRole("complementary").filter({ has: page.getByRole("heading", { name: "What good looks like", exact: true }) });
    await expect(goodLooksLike).toContainText("Torque within the released drawing limits.");
    expect(errors).toEqual([]);
  });

  test("operators cannot see it until a system admin approves it", async ({ browser }) => {
    const operator = await pageFor(browser, "operator");
    await searchDashboard(operator, partId);
    await expect(operator.getByText("No matching instructions")).toBeVisible();

    const approver = await pageFor(browser, "systemAdmin");
    await approver.goto(`/instructions/${instructionId}`);
    await approver.getByRole("button", { name: "Approve instruction" }).click();
    await expect.poll(async () => (await readInstruction(instructionId)).approval_status, { timeout: 30_000 }).toBe("approved");

    await operator.reload();
    const search = await searchDashboard(operator, partId);
    await expect(operator.getByRole("heading", { name: new RegExp(`1 instruction for “${partId}”`, "i") })).toBeVisible();
    // A scanned part number with a single match opens the instruction directly.
    await search.press("Enter");
    await operator.waitForURL(new RegExp(`/instructions/${instructionId}$`));
    await expect(instructionBody(operator).getByRole("heading", { name: "Steps" })).toBeVisible();

    await openActionMenu(operator);
    await expect(operator.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(operator.getByRole("button", { name: "Archive Instruction" })).toHaveCount(0);
    await operator.getByRole("button", { name: "Pin instruction" }).click();
    await expect(operator.getByRole("button", { name: "Unpin instruction" })).toBeVisible();

    await operator.goto("/dashboard");
    const pinned = operator.locator("#homepage-widget-pinned");
    await expect(pinned.getByRole("link", { name: new RegExp(partId) })).toBeVisible();
  });

  test("an admin revises the released instruction; the editor opens it formatted and a new revision is created", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto(`/instructions/${instructionId}/edit`);
    const editor = page.getByRole("textbox", { name: "Work Instructions", exact: true });
    await expect(editor.getByRole("heading", { name: "Setup", exact: true })).toBeVisible();
    await expect(editor.locator('aside[data-tone="danger"]')).toContainText("Lock out the press before starting.");
    await expect(editor.locator('figure img[alt="locator"]')).toBeVisible();
    await expect(page.getByText("Updated for the new editor.")).toHaveCount(0);

    await page.getByRole("spinbutton", { name: "Revision" }).fill("2");
    await page.getByPlaceholder("What changed and why?").fill("Added the final verification step.");
    // The editor keeps an empty line below the final photo to continue writing on.
    await editor.press("Control+End");
    await page.keyboard.type("## Final check");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Verify the paint mark on every bolt.");
    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.getByRole("button", { name: "Continue and Save" }).click();
    await page.waitForURL((url) => /\/instructions\/[0-9a-f-]{36}$/.test(url.pathname), { timeout: 90_000 });
    await expect(instructionBody(page).getByRole("heading", { name: "Final check" })).toBeVisible();
    revisedInstructionId = instructionIdFromUrl(page);

    const revised = await readInstruction(revisedInstructionId);
    expect(revised.revision).toBe(2);
    expect(revised.approval_status).toBe("pending_review");
    expect(revised.body_markdown).toContain("## Final check\n\nVerify the paint mark on every bolt.");
    // The released revision stays in force for operators until the new one is approved.
    const released = await readInstruction(instructionId);
    expect(released.approval_status).toBe("approved");
    expect(released.is_archived).toBe(false);
    expect(released.body_markdown).not.toContain("Final check");
  });
});

test.describe.serial("deleting (archiving) and restoring an instruction", () => {
  const partId = uniqueId("DEL");
  let instructionId = "";

  test("an admin archives an instruction and it disappears from the dashboard and search", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/instructions/new");
    await fillInstructionHeader(page, partId, "Temporary trim check", "Trim");
    await page.getByRole("textbox", { name: "Work Instructions", exact: true }).pressSequentially("1. Inspect the trimmed edge.");
    await page.getByRole("button", { name: "Create Instruction" }).click();
    await page.waitForURL(/\/instructions\/[0-9a-f-]{36}$/, { timeout: 90_000 });
    instructionId = instructionIdFromUrl(page);

    await openActionMenu(page);
    await page.getByRole("button", { name: "Archive Instruction" }).click();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
    await expect.poll(async () => (await readInstruction(instructionId)).is_archived).toBe(true);

    await searchDashboard(page, partId);
    await expect(page.getByText("No matching instructions")).toBeVisible();
  });

  test("an archived instruction can be restored from the archive", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/instructions/archived");
    await page.getByRole("textbox", { name: "Search Archived Instructions" }).fill(partId);
    await expect(page.getByText(partId)).toBeVisible();
    // The search leaves only this instruction, so its row's Restore button is the only one.
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Restore Instruction?" })).toBeVisible();
    await page.getByRole("button", { name: "Restore", exact: true }).last().click();
    await expect.poll(async () => (await readInstruction(instructionId)).is_archived, { timeout: 30_000 }).toBe(false);

    await searchDashboard(page, partId);
    await expect(page.getByRole("link", { name: new RegExp(partId) })).toBeVisible();
  });
});

test("legacy rich-text instructions open in the editor without a false unsaved-changes prompt and save as Markdown", async ({ page }) => {
  const partId = uniqueId("LEG");
  const legacyHtml = '<h2>Legacy setup</h2><p><span style="color:#dc2626">Do not skip</span> the warm-up.</p>'
    + '<aside data-type="callout" data-tone="warning"><p>Hot surface.</p></aside>'
    + '<ol><li><p>Warm the mold</p></li><li><p>Run a test shot</p></li></ol>';
  const admin = serviceClient();
  const { data: department } = await admin.from("departments").select("id").eq("name", "Quality").single();
  const { data: profile } = await admin.from("profiles").select("id").eq("employee_id", "900002").single();
  const { data: workItem, error: workItemError } = await admin.from("work_items")
    .insert({ part_id: partId, item_title: "Legacy formatted instruction", department_id: department!.id, created_by: profile!.id })
    .select("id").single();
  expect(workItemError).toBeNull();
  const { data: legacy, error: legacyError } = await admin.from("work_instructions").insert({
    work_item_id: workItem!.id, body_markdown: legacyHtml, revision: 1, created_by: profile!.id, updated_by: profile!.id,
    process_scope: "Molding", acceptance_criteria: "Drawing", verification_records: "Traveler", approval_status: "pending_review",
    iso_clause_refs: ["7.5 Documented information"],
  }).select("id").single();
  expect(legacyError).toBeNull();

  await signIn(page, "admin");
  await page.goto(`/instructions/${legacy!.id}/edit`);
  const editor = page.getByRole("textbox", { name: "Work Instructions", exact: true });
  await expect(page.getByText("Updated for the new editor.")).toBeVisible();
  // Colour is not kept; the highlighted words become bold.
  await expect(editor.getByRole("heading", { name: "Legacy setup", exact: true })).toBeVisible();
  await expect(editor.locator("strong")).toHaveText("Do not skip");
  await expect(editor.locator('aside[data-tone="warning"]')).toHaveText("Hot surface.");
  await expect(editor.locator("ol > li")).toHaveText(["Warm the mold", "Run a test shot"]);

  // Opening a converted record is not an edit, so leaving must not ask to discard changes.
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("link", { name: "Dashboard", exact: true }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await expect(page.getByText("Discard unsaved changes?")).toHaveCount(0);

  await page.goto(`/instructions/${legacy!.id}/edit`);
  await editor.locator("ol > li").last().click();
  await page.keyboard.press("End");
  // Enter continues the numbered list.
  await page.keyboard.press("Enter");
  await page.keyboard.type("Record the first part");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await page.waitForURL((url) => /\/instructions\/[0-9a-f-]{36}$/.test(url.pathname), { timeout: 90_000 });
  const savedId = instructionIdFromUrl(page);
  const saved = await readInstruction(savedId);
  expect(saved.body_markdown).toBe("## Legacy setup\n\n**Do not skip** the warm-up.\n\n> [!WARNING]\n> Hot surface.\n\n1. Warm the mold\n2. Run a test shot\n3. Record the first part");
  await expect(instructionBody(page).locator('aside[data-tone="warning"]')).toContainText("Hot surface.");
});

test("saving over someone else's newer change is refused at once with a clear message", async () => {
  const admin = serviceClient();
  const { data: department } = await admin.from("departments").select("id").eq("name", "Quality").single();
  const { data: profile } = await admin.from("profiles").select("id").eq("employee_id", "900002").single();
  const { data: workItem } = await admin.from("work_items")
    .insert({ part_id: uniqueId("STALE"), item_title: "Concurrent edit probe", department_id: department!.id, created_by: profile!.id })
    .select("id, part_id").single();
  const { data: instruction, error } = await admin.from("work_instructions").insert({
    work_item_id: workItem!.id, body_markdown: "1. Original step", revision: 1, created_by: profile!.id, updated_by: profile!.id,
    process_scope: "Assembly", acceptance_criteria: "Drawing", verification_records: "Traveler", approval_status: "pending_review",
    iso_clause_refs: ["7.5 Documented information"],
  }).select("id").single();
  expect(error).toBeNull();

  // The browser editor calls this function directly, so a retried conflict would freeze the save.
  const { client } = await sessionFor("admin");
  const started = Date.now();
  const { error: saveError } = await client.rpc("save_work_instruction_controlled", {
    p_payload: {
      mode: "edit", instructionId: instruction!.id, expectedUpdatedAt: "2000-01-01T00:00:00Z",
      departmentId: department!.id, partId: workItem!.part_id, itemTitle: "Concurrent edit probe", revision: 1,
      bodyMarkdown: "1. Outdated copy", processScope: "Assembly", acceptanceCriteria: "Drawing", verificationRecords: "Traveler",
      isoClauseRefs: ["7.5 Documented information"], suggestedToolIds: [], changeSummary: "Outdated copy",
    },
  });
  expect(saveError?.code).toBe("PT409");
  expect(saveError?.message).toContain("Another user changed this instruction");
  expect(Date.now() - started).toBeLessThan(10_000);
});
