import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { expectFullWidthShell } from "./helpers/layout";

// CRM-03 browser proof: custom fields, saved views, filters, columns and grid keyboard editing.
const expect = baseExpect.configure({ timeout: 20_000 });
const evidence = "docs/screenshots/crm03";
test.use({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 }, timezoneId: "Europe/Berlin", actionTimeout: 20_000, navigationTimeout: 60_000 });

async function setMode(page: Page, mode: "light" | "dark") {
  await expect(page.locator('[data-slot="sidebar-wrapper"]')).toHaveAttribute("data-hydrated", "true");
  if (await page.locator("html").getAttribute("data-theme") === mode) return;
  const toggle = page.getByRole("button", { name: new RegExp(`^Switch to ${mode}`) }).first();
  if (await toggle.isVisible()) await toggle.click();
  else { await page.evaluate((value) => localStorage.setItem("harvest-color-mode", value), mode); await page.reload(); }
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
}
async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.locator("body").innerText()).not.toContain("MISSING_MESSAGE");
  const size = page.viewportSize()!;
  const overflow = await page.evaluate(() => { const main = document.querySelector("main"); return main ? main.scrollHeight - main.clientHeight : 0; });
  if (overflow > 0) await page.setViewportSize({ width: size.width, height: size.height + overflow });
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true, animations: "disabled" });
  if (overflow > 0) await page.setViewportSize(size);
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), name).toEqual([]);
}
async function both(page: Page, name: string) {
  for (const mode of ["light", "dark"] as const) { await setMode(page, mode); await capture(page, `${name}-${mode}`); }
  await setMode(page, "light");
}
async function api(page: Page, method: "get" | "post" | "put" | "patch", path: string, data?: unknown) {
  const response = await page.request[method](path, { headers: { origin }, data });
  return { status: response.status(), body: await response.json().catch(() => ({})) };
}
/** The grid never makes its card scroll sideways: trailing columns hide instead. */
async function expectNoSidewaysScroll(page: Page) {
  const metrics = await page.evaluate(() => {
    const grid = document.querySelector('[role="grid"]'), container = grid?.closest('[data-slot="table-container"]');
    return { page: document.documentElement.scrollWidth - window.innerWidth, table: container ? container.scrollWidth - container.clientWidth : 0 };
  });
  expect(metrics.page).toBeLessThanOrEqual(0);
  expect(metrics.table).toBeLessThanOrEqual(1);
}

test("CRM-03: custom fields, saved views, filters, columns and keyboard grid editing", async ({ page, browser }) => {
  test.setTimeout(420_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  const workspace = await api(page, "post", "/api/workspaces", { name: "Harvest CRM-03 browser workspace" });
  expect(workspace.status).toBe(201);
  const tenantId = workspace.body.tenantId as string, root = `/workspaces/${tenantId}`, apiRoot = `/api${root}`;
  const company = await api(page, "post", `${apiRoot}/companies`, { name: "Synthetic Riverside Fellowship", domain: "riverside.example" });
  expect(company.status).toBe(201);
  for (const [index, name] of ["Synthetic Ada Mensah", "Synthetic Ben Okoro", "Synthetic Chloe Park", "Synthetic Dan Weiss"].entries()) {
    expect((await api(page, "post", `${apiRoot}/contacts`, { name, ...(index < 3 ? { email: `person${index}@example.test` } : {}), ...(index % 2 === 0 ? { companyId: company.body.id } : {}) })).status).toBe(201);
  }

  // Fields settings: empty state, then create a select field through the dialog.
  await page.goto(`${root}/crm/people`);
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("link", { name: "CRM fields" }).click();
  await expect(page).toHaveURL(`${root}/crm/settings/fields`);
  await expect(page.getByRole("heading", { name: "No custom fields for People" })).toBeVisible();
  await page.getByRole("button", { name: "New field" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Label").fill("Volunteer tier");
  await expect(dialog.getByLabel("Key")).toHaveValue("volunteer_tier");
  await dialog.getByLabel("Type").selectOption("select");
  for (const [index, option] of ["Core", "Occasional", "Lapsed"].entries()) {
    await dialog.getByRole("button", { name: "Add option" }).click();
    await dialog.getByRole("textbox", { name: `Option ${index + 1}` }).fill(option);
  }
  await capture(page, "fields-create-dialog-light");
  await dialog.getByRole("button", { name: "Create field" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("row").filter({ hasText: "Volunteer tier" })).toBeVisible();
  // A text and a number field through the API (same validated endpoint).
  expect((await api(page, "post", `${apiRoot}/crm/fields`, { objectType: "person", label: "Home group", type: "text" })).status).toBe(201);
  expect((await api(page, "post", `${apiRoot}/crm/fields`, { objectType: "person", label: "Years serving", type: "number" })).status).toBe(201);
  expect((await api(page, "post", `${apiRoot}/crm/fields`, { objectType: "company", label: "Partner since", type: "date" })).status).toBe(201);
  await page.reload();
  await both(page, "fields-settings");
  await page.getByRole("tab", { name: "Organizations" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Partner since" })).toBeVisible();

  // Record page: set custom values (select saves on change, text via the inline field).
  await page.goto(`${root}/crm/people`);
  await page.getByRole("grid", { name: "People" }).getByRole("link", { name: /Synthetic Ada Mensah/ }).click();
  await expect(page.getByRole("heading", { name: "Synthetic Ada Mensah" })).toBeVisible();
  await page.getByLabel("Volunteer tier").selectOption("core");
  await expect(page.getByLabel("Volunteer tier")).toHaveValue("core");
  await page.getByRole("button", { name: "Edit Home group: Empty" }).click();
  await page.getByRole("textbox", { name: "Home group" }).fill("Northside");
  await page.getByRole("textbox", { name: "Home group" }).press("Enter");
  await expect(page.getByRole("button", { name: "Edit Home group: Northside" })).toBeVisible();
  await page.getByRole("button", { name: "Edit Years serving: Empty" }).click();
  await page.getByRole("spinbutton", { name: "Years serving" }).fill("7");
  await page.getByRole("spinbutton", { name: "Years serving" }).press("Enter");
  await expect(page.getByRole("button", { name: "Edit Years serving: 7" })).toBeVisible();
  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(page.getByText(/updated Years serving/)).toBeVisible();
  await both(page, "record-custom-fields");

  // List: build a personal view with a custom-field filter and custom columns.
  await page.goto(`${root}/crm/people`);
  const grid = page.getByRole("grid", { name: "People" });
  await expect(grid).toBeVisible();
  await page.getByRole("button", { name: "Columns" }).click();
  // Columns are URL state: the checkbox reflects the new URL once navigation lands.
  await page.getByRole("checkbox", { name: "Volunteer tier" }).click();
  await expect(page.getByRole("checkbox", { name: "Volunteer tier" })).toBeChecked();
  await page.getByRole("checkbox", { name: "Phone" }).click();
  await expect(page.getByRole("checkbox", { name: "Phone" })).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/cols=company%2Cemail%2Cmarketing%2Ccreated%2Ccf%3Avolunteer_tier/);
  await expect(grid.getByRole("columnheader", { name: "Volunteer tier" })).toBeVisible();
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("option", { name: /Volunteer tier/ }).click();
  await page.getByRole("checkbox", { name: "Core" }).check();
  await page.getByRole("button", { name: "Apply filter" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Volunteer tier is any of Core" })).toBeVisible();
  await expect(grid.getByRole("row")).toHaveCount(2);
  await expect(page.getByText("Edited")).toBeVisible();
  await page.getByRole("button", { name: "Save as new view" }).click();
  await page.getByRole("dialog").getByLabel("View name").fill("Core volunteers");
  await page.getByRole("dialog").getByRole("button", { name: "Save view" }).click();
  await expect(page).toHaveURL(/view=[0-9a-f-]{36}/);
  await expect(page.getByRole("button", { name: /^Core volunteers/ })).toBeVisible();
  await expect(page.getByText("Edited")).toBeHidden();
  await both(page, "people-saved-view");
  const savedUrl = new URL(page.url()), viewId = savedUrl.searchParams.get("view")!;
  // The view id alone restores the whole saved state.
  await page.goto(`${root}/crm/people?view=${viewId}`);
  await expect(grid.getByRole("row")).toHaveCount(2);
  await expect(grid.getByRole("columnheader", { name: "Volunteer tier" })).toBeVisible();

  // Apply a built-in workspace view; Reset returns to the saved state.
  await page.getByRole("button", { name: /^Core volunteers/ }).click();
  await page.getByRole("menuitem", { name: "No organization" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Organization is empty" })).toBeVisible();
  await expect(grid.getByRole("row")).toHaveCount(3);
  await page.getByRole("button", { name: /^No organization/ }).click();
  await page.getByRole("menuitem", { name: "Email subscribers" }).click();
  await expect(page.getByRole("heading", { name: "No matching people" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Reset view" })).toBeVisible();
  await both(page, "people-no-matches");

  // An unknown or foreign view id falls back to the default view with a notice.
  await page.goto(`${root}/crm/people?view=00000000-0000-4000-8000-000000000000`);
  await expect(page.getByText("That view is not available, so the default view is shown.")).toBeVisible();
  await expect(grid.getByRole("row")).toHaveCount(5);
  await page.goto(`${root}/crm/people?f=cf:nope~is~x`);
  await expect(page.getByText("This view has settings that are no longer valid")).toBeVisible();

  // Keyboard: arrow to the Email cell, Enter edits, Escape cancels, Tab commits and moves.
  await page.goto(`${root}/crm/people`);
  await grid.getByRole("gridcell").first().focus();
  await expect(grid.getByRole("gridcell").first()).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(grid.getByRole("gridcell", { name: "Synthetic Riverside Fellowship", exact: true }).first()).toBeFocused();
  await page.keyboard.press("ArrowRight");
  const emailCell = grid.getByRole("gridcell", { name: "person0@example.test", exact: true });
  await expect(emailCell).toBeFocused();
  // Arrow navigation schedules focus in requestAnimationFrame; wait for each
  // destination before Enter so a pending focus callback cannot steal editor focus.
  await emailCell.press("Enter");
  const editor = page.getByRole("textbox", { name: "Edit Email for Synthetic Ada Mensah" });
  await expect(editor).toBeEditable();
  await expect(editor).toBeFocused();
  await editor.fill("discard@example.test");
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expect(grid.getByRole("gridcell", { name: "person0@example.test" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(editor).toBeEditable();
  await expect(editor).toBeFocused();
  await editor.fill("ada@example.test");
  await page.keyboard.press("Tab");
  await expect(editor).toBeHidden();
  await expect(grid.getByRole("gridcell", { name: "ada@example.test" })).toBeVisible();
  // Tab committed and moved focus to the next cell (Phone) in the same row.
  await expect(grid.getByRole("gridcell", { name: "Not provided" }).first()).toBeFocused();
  expect((await api(page, "get", `${apiRoot}/contacts?q=ada%40example.test`)).body.total).toBe(1);

  // No sideways scroll at tablet width with the sidebar expanded, nor on a phone.
  for (const viewport of [{ width: 1024, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`${root}/crm/people?view=${viewId}`);
    await expect(grid).toBeVisible();
    if (viewport.width >= 1024) await expect(page.locator('[data-slot="sidebar"][data-state="expanded"]')).toBeVisible();
    await expectFullWidthShell(page);
    await expectNoSidewaysScroll(page);
    await capture(page, `people-${viewport.width}-light`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${root}/crm/companies`);
  await both(page, "companies-list");

  // A viewer reads views and values but cannot save views, change values or definitions.
  const viewerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const viewer = await viewerContext.newPage();
  const viewerEmail = await signIn(viewer);
  expect((await api(page, "put", `${apiRoot}/members`, { email: viewerEmail, role: "viewer" })).status).toBe(200);
  // The owner's personal view is private: for the viewer it is simply not available.
  await viewer.goto(`${root}/crm/people?view=${viewId}`);
  await expect(viewer.getByText("That view is not available, so the default view is shown.")).toBeVisible();
  await expect(viewer.getByRole("grid", { name: "People" }).getByRole("row")).toHaveCount(5);
  // Built-in views still apply; viewers can browse but never save.
  await viewer.getByRole("button", { name: /^All people/ }).click();
  await expect(viewer.getByRole("menuitem", { name: "Save as new view" })).toHaveCount(0);
  await viewer.getByRole("menuitem", { name: "No organization" }).click();
  await expect(viewer.getByRole("grid", { name: "People" }).getByRole("row")).toHaveCount(3);
  await expect(viewer.getByRole("button", { name: "Save as new view" })).toHaveCount(0);
  await viewer.goto(`${root}/crm/people`);
  await viewer.getByRole("grid", { name: "People" }).getByRole("link", { name: /Synthetic Ada Mensah/ }).click();
  await expect(viewer.getByText("Northside")).toBeVisible();
  await expect(viewer.getByLabel("Volunteer tier")).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: /^Edit Home group/ })).toHaveCount(0);
  await capture(viewer, "record-custom-fields-viewer-light");
  await viewer.goto(`${root}/crm/settings/fields`);
  await expect(viewer.getByText("Only workspace owners and admins can change custom fields.")).toBeVisible();
  await expect(viewer.getByRole("button", { name: "New field" })).toHaveCount(0);
  const person = (await api(viewer, "get", `${apiRoot}/contacts?q=Ada`)).body.rows[0];
  expect((await api(viewer, "patch", `${apiRoot}/contacts/${person.id}/fields`, { version: person.version, values: { home_group: "Denied" } })).status).toBe(403);
  expect((await api(viewer, "post", `${apiRoot}/crm/views?object=person`, { objectType: "person", name: "Denied", state: {} })).status).toBe(403);
  expect((await api(viewer, "post", `${apiRoot}/crm/fields`, { objectType: "person", label: "Denied", type: "text" })).status).toBe(403);
  await viewerContext.close();
  expect(pageErrors).toEqual([]);
});
