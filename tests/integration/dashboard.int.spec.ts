import { expect, test } from "@playwright/test";
import { captureRuntimeErrors, createReleasedInstruction, serviceClient, signIn, waitForDashboard } from "./helpers";

const studio = (page: import("@playwright/test").Page) => page.locator('[data-dashboard-layout-studio="true"]');

test("operators get a focused homepage: big search, department filter, and the shortcuts their role allows", async ({ page, request }) => {
  // Department chips list only departments that have released instructions.
  await createReleasedInstruction(request, { department: "Assembly", title: "Gearbox torque sequence" });
  const errors = captureRuntimeErrors(page);
  await signIn(page, "operator");
  await page.goto("/dashboard");
  await waitForDashboard(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^(Good (morning|afternoon|evening)|Welcome), Olive$/);

  // Contributors may submit new instructions for review, so they get the same create shortcuts.
  const quickActions = page.getByRole("navigation", { name: "Quick actions" });
  await expect(quickActions.getByRole("link", { name: /Document center/ })).toBeVisible();
  await expect(quickActions.getByRole("link", { name: /New instruction/ })).toBeVisible();
  await expect(quickActions.getByRole("link", { name: /My drafts/ })).toBeVisible();

  // Department chips filter every list on the page.
  const departments = page.getByRole("group", { name: "Filter by department" });
  const assembly = departments.getByRole("button", { name: /^Assembly/ });
  await assembly.click();
  await expect(assembly).toHaveAttribute("aria-pressed", "true");
  const newest = page.locator("#homepage-widget-newest");
  const rows = newest.getByRole("link");
  await expect(rows.first()).toBeVisible();
  for (const text of await rows.allInnerTexts()) expect(text).toContain("Assembly");
  await departments.getByRole("button", { name: /^All departments/ }).click();

  const search = page.getByRole("searchbox", { name: "Search for anything" });
  await search.fill("zz-no-such-part-zz");
  await expect(page.getByText("No matching instructions")).toBeVisible();
  await expect(page.getByLabel("Homepage widgets")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(search).toHaveValue("");
  await expect(page.getByLabel("Homepage widgets")).toBeVisible();
  expect(errors).toEqual([]);
});

test("homepage layout changes persist for the user after a reload", async ({ page }) => {
  const admin = serviceClient();
  await admin.from("profiles").update({ dashboard_layout: [] }).eq("employee_id", "900002");
  await signIn(page, "admin");
  await page.goto("/dashboard");
  await waitForDashboard(page);
  await expect(page.locator("#homepage-widget-recent_updates")).toBeVisible();

  await page.getByRole("button", { name: "Customize homepage", exact: true }).click();
  await expect(studio(page)).toBeVisible();
  // The search is always on top, so it is not offered as a removable widget.
  await expect(studio(page).getByText("Search Entire System")).toHaveCount(0);
  await studio(page).getByRole("button", { name: "Remove Recently changed from layout", exact: true }).click();
  await studio(page).getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(studio(page)).toBeHidden({ timeout: 30_000 });

  await page.reload();
  await waitForDashboard(page);
  await expect(page.locator("#homepage-widget-pinned")).toBeVisible();
  await expect(page.locator("#homepage-widget-recent_updates")).toHaveCount(0);

  await page.getByRole("button", { name: "Customize homepage", exact: true }).click();
  await studio(page).getByRole("button", { name: "Reset layout", exact: true }).click();
  await studio(page).getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(studio(page)).toBeHidden({ timeout: 30_000 });
  await page.reload();
  await waitForDashboard(page);
  await expect(page.locator("#homepage-widget-recent_updates")).toBeVisible();
});
