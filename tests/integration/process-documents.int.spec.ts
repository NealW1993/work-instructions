import { expect, test, type Page } from "@playwright/test";
import { captureRuntimeErrors, closeRoleContexts, pageFor, serviceClient, sessionFor, signIn, uniqueId } from "./helpers";

test.afterEach(closeRoleContexts);

async function readDocument(documentNumber: string) {
  const client = serviceClient();
  const { data: document, error } = await client
    .from("process_documents")
    .select("id, status, current_revision")
    .eq("document_number", documentNumber)
    .maybeSingle();
  if (error) throw error;
  if (!document) return null;
  const { data: revision } = await client
    .from("process_document_revisions")
    .select("revision, body_html, change_summary")
    .eq("document_id", document.id)
    .order("revision", { ascending: false })
    .limit(1)
    .single();
  return { ...document, latest: revision as { revision: number; body_html: string; change_summary: string } };
}

function documentBody(page: Page) {
  return page.getByRole("textbox", { name: "Document Body", exact: true });
}

test.describe.serial("controlled documents use the Markdown editor end to end", () => {
  const documentNumber = uniqueId("QMS");
  let documentId = "";

  test("an admin creates a document in Markdown and it is stored as sanitized HTML", async ({ page }) => {
    const errors = captureRuntimeErrors(page);
    await signIn(page, "admin");
    await page.goto("/process-documents");
    await page.getByRole("button", { name: "New document" }).first().click();
    await page.getByRole("textbox", { name: "Document Number", exact: true }).fill(documentNumber);
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Integration release procedure");

    const body = documentBody(page);
    await body.fill("");
    await body.click();
    await page.keyboard.type("## Purpose\n\nControl the release of finished goods.\n\n");
    const editorGroup = page.getByRole("group", { name: "Document Body editor" });
    await editorGroup.getByRole("button", { name: "Callout" }).click();
    await page.getByRole("menuitem", { name: /Warning/ }).click();
    await page.keyboard.type("Never ship without a signed traveler.");
    await page.keyboard.type("\n\n");
    await editorGroup.getByRole("button", { name: "Insert table" }).click();

    await page.getByRole("button", { name: "Save Draft" }).click();
    await page.waitForURL(/\/process-documents\?doc=[0-9a-f-]{36}/, { timeout: 90_000 });
    documentId = new URL(page.url()).searchParams.get("doc") ?? "";

    const stored = await readDocument(documentNumber);
    expect(stored?.id).toBe(documentId);
    expect(stored?.status).toBe("draft");
    expect(stored?.latest.body_html).toContain("<h2>Purpose</h2>");
    expect(stored?.latest.body_html).toContain('data-tone="warning"');
    expect(stored?.latest.body_html).toContain("<table>");
    expect(stored?.latest.body_html).not.toContain("[!WARNING]");
    expect(errors).toEqual([]);
  });

  test("reopening the document shows editable Markdown, and edits save as a new revision", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto(`/process-documents?doc=${documentId}`);
    const body = documentBody(page);
    await expect(body).toHaveValue(/^## Purpose\n\nControl the release of finished goods\.\n\n> \[!WARNING\]\n> Never ship without a signed traveler\.\n\n\| Step \| Check \| Result \|/);

    await body.click();
    await body.press("Control+End");
    await page.keyboard.type("\n\n## Records\n\nKeep the traveler for three years.");
    await page.getByRole("textbox", { name: "Change Summary", exact: true }).fill("Added the record retention section.");
    await page.getByRole("button", { name: "Save Draft" }).click();
    await expect.poll(async () => (await readDocument(documentNumber))?.latest.body_html ?? "", { timeout: 30_000 }).toContain("<h2>Records</h2>");
    const stored = await readDocument(documentNumber);
    expect(stored?.latest.change_summary).toBe("Added the record retention section.");
    expect(stored?.current_revision).toBeGreaterThanOrEqual(2);

    // Submitting straight after a save must use the new revision stamp, not the one loaded with the page.
    await page.getByRole("button", { name: "Submit for Review" }).click();
    await expect.poll(async () => (await readDocument(documentNumber))?.status, { timeout: 15_000 }).toBe("in_review");
    await expect(page.getByText("changed after you opened it")).toHaveCount(0);
  });

  test("a save based on an outdated copy is refused at once with a clear message", async ({ request }) => {
    const { token } = await sessionFor("admin");
    const started = Date.now();
    const response = await request.patch(`/api/process-documents/${documentId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        documentNumber, title: "Integration release procedure", documentType: "process_map", status: "draft",
        bodyHtml: "<p>Outdated copy</p>", expectedRevision: 1, expectedUpdatedAt: "2000-01-01T00:00:00Z",
      },
    });
    expect(response.status()).toBe(409);
    expect((await response.json()).error).toContain("changed after you opened it");
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  test("a system admin marks the document obsolete instead of deleting its retained evidence", async ({ browser }) => {
    const page = await pageFor(browser, "systemAdmin");
    await page.goto(`/process-documents?doc=${documentId}`);
    await page.getByRole("button", { name: "Obsolete", exact: true }).click();
    await expect.poll(async () => (await readDocument(documentNumber))?.status, { timeout: 30_000 }).toBe("obsolete");
    const { error } = await serviceClient().from("process_documents").delete().eq("id", documentId);
    expect(error?.message ?? "").toContain("retained");
  });
});
