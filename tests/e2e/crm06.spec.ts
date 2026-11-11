import { mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect as baseExpect, test, type Download, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { expectFullWidthShell } from "./helpers/layout";

// CRM-06 browser proof: CSV upload → map → preview (with conflicts) → import → results and problem
// report; filtered export matching the list; rollback; explicit merge; viewer limits; isolation; layout.
const expect = baseExpect.configure({ timeout: 20_000 });
const evidence = "docs/screenshots/crm06";
test.use({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 }, timezoneId: "Europe/Berlin", actionTimeout: 20_000, navigationTimeout: 60_000, acceptDownloads: true });

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
  await page.waitForFunction(() => document.getAnimations().every((animation) => !(animation instanceof CSSTransition) || animation.playState !== "running"));
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), name).toEqual([]);
}
async function both(page: Page, name: string) {
  for (const mode of ["light", "dark"] as const) { await setMode(page, mode); await capture(page, `${name}-${mode}`); }
  await setMode(page, "light");
}
/** Navigate and wait for the header bell's first fetch: it runs in an effect, so the page has hydrated. */
async function gotoHydrated(page: Page, url: string) {
  const ready = page.waitForResponse((response) => response.url().includes("/crm/notifications") && response.request().method() === "GET");
  await page.goto(url); await ready;
}
async function api(page: Page, method: "get" | "post" | "put" | "patch", path: string, data?: unknown) {
  const response = await page.request[method](path, { headers: { origin }, data });
  return { status: response.status(), body: await response.json().catch(() => ({})) };
}
async function text(download: Download) { return (await readFile((await download.path())!, "utf8")).replace(/^﻿/, ""); }
const lines = (csv: string) => csv.split(/\r\n/).filter(Boolean);
/** Results-page actions must be comfortable to tap: at least 44px tall at every width. */
async function expectResultTargets(page: Page) {
  for (const link of [page.getByRole("link", { name: "Download problem report" }), page.getByRole("link", { name: "Open People" })]) {
    await expect(link).toBeVisible();
    const box = (await link.boundingBox())!;
    expect(box.height, await link.innerText()).toBeGreaterThanOrEqual(44);
  }
}

test("CRM-06: CSV import with mapping, preview and problem report; filtered export; rollback; merge", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  const workspace = await api(page, "post", "/api/workspaces", { audience: "church", name: "Harvest CRM-06 browser workspace" });
  expect(workspace.status).toBe(201);
  const tenantId = workspace.body.tenantId as string, root = `/workspaces/${tenantId}`, apiRoot = `/api${root}`;
  expect((await api(page, "post", `${apiRoot}/companies`, { name: "Synthetic Hope Chapel", domain: "hope.example" })).status).toBe(201);
  const existing = (await api(page, "post", `${apiRoot}/contacts`, { name: "Synthetic Existing", email: "existing@example.test" })).body.id as string;
  const twin = (await api(page, "post", `${apiRoot}/contacts`, { name: "Synthetic Existing", phone: "+4915100000009" })).body.id as string;

  // From People: Import opens the upload dialog for people.
  await gotoHydrated(page, `${root}/crm/people`);
  await page.getByRole("link", { name: "Import", exact: true }).click();
  await expect(page).toHaveURL(`${root}/crm/imports?entity=person`);
  const upload = page.getByRole("dialog", { name: "Import a CSV file" });
  await expect(upload.getByRole("radio", { name: "People" })).toBeChecked();
  const csv = ["Full name,E-mail,Mobile,Church,Role",
    "Synthetic Ruth Okafor,ruth@example.test,+4915112340001,hope.example,Elder",
    "Synthetic Existing,EXISTING@example.test,,,",
    "Synthetic Boaz,boaz-at-example,,,",
    "Synthetic Naomi,naomi@example.test,,Nowhere Fellowship,",
    "Synthetic Ruth Again,ruth@example.test,,,"].join("\n");
  await upload.getByLabel("CSV file").setInputFiles({ name: "synthetic-people.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await capture(page, "import-upload-light");
  await page.setViewportSize({ width: 320, height: 844 });
  await capture(page, "import-upload-320-light");
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Keyboard from here: focus the button and press Enter.
  await upload.getByRole("button", { name: "Upload and map" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Import synthetic-people.csv" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Import steps" }).locator('[aria-current="step"]')).toHaveText(/Map columns/);
  for (const [column, value] of [["Full name", "name"], ["E-mail", "email"], ["Mobile", "phone"], ["Church", "company"], ["Role", "title"]]) {
    await expect(page.getByLabel(`Harvest field for ${column}`)).toHaveValue(value);
  }
  await both(page, "import-map");
  const mapUrl = page.url();
  for (const viewport of [{ width: 320, height: 844 }, { width: 1024, height: 900 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    await gotoHydrated(page, `${root}/crm/imports`);
    if (viewport.width >= 1024) await expect(page.locator('[data-slot="sidebar"][data-state]')).toHaveAttribute("data-state", "expanded");
    await expectFullWidthShell(page);
    await gotoHydrated(page, mapUrl);
    await expectFullWidthShell(page);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("radio", { name: "Fill empty fields" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByText("Saved")).toBeVisible();
  await page.getByRole("radio", { name: "Skip it" }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Preview import" }).focus();
  await page.keyboard.press("Enter");

  // Preview: nothing saved yet; two new, one skipped, two problems.
  await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible();
  const counts = page.locator("dl");
  await expect(counts).toContainText("New2");
  await expect(counts).toContainText("Skipped1");
  await expect(counts).toContainText("Problems2");
  expect((await api(page, "get", `${apiRoot}/contacts?q=ruth`)).body.total ?? 0).toBe(0);
  const rows = page.getByRole("table", { name: "Rows in synthetic-people.csv" });
  await expect(rows.getByText("Matches Synthetic Existing")).toBeVisible();
  await expect(rows.getByText(/No organization matches/).last()).toBeVisible();
  await both(page, "import-preview");
  await page.getByRole("navigation", { name: "Rows in synthetic-people.csv" }).getByRole("link", { name: /Problems/ }).click();
  await expect(page).toHaveURL(/outcome=problem/);
  await expect(rows.getByRole("row")).toHaveCount(3);
  await expect(rows.getByText("An earlier row in this file has the same email, phone, handle or domain.").last()).toBeVisible();
  await expect(rows.getByText("The email address is not valid.").last()).toBeVisible();
  await capture(page, "import-preview-conflicts-light");

  // Import with real progress, then results.
  await page.getByRole("button", { name: "Import 2 rows" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
  await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible();
  await expect(page.locator("dl")).toContainText("Created2");
  await expect(page.locator("dl")).toContainText("Not imported2");
  await both(page, "import-results");
  await expectResultTargets(page);
  const reportDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download problem report" }).click();
  const report = lines(await text(await reportDownload));
  expect(report[0]).toBe("Row,Full name,E-mail,Mobile,Church,Role,Problem");
  expect(report.slice(1).map((line) => line.split(",")[0])).toEqual(["3", "5"]);

  // The imported people are on the list, linked to the company by domain.
  await gotoHydrated(page, `${root}/crm/people?q=Synthetic%20Ruth`);
  await expect(page.getByRole("link", { name: "Synthetic Ruth Okafor" }).first()).toBeVisible();
  const ruth = (await api(page, "get", `${apiRoot}/contacts?q=ruth%40example.test`)).body;
  expect(ruth.total).toBe(1);

  // Export the filtered view: header and row count match the list.
  await gotoHydrated(page, `${root}/crm/people?q=Synthetic`);
  const listTotal = (await api(page, "get", `${apiRoot}/contacts?q=Synthetic`)).body.total as number;
  await page.getByRole("button", { name: "Export" }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export People" });
  await expect(exportDialog.getByText(`${listTotal} records will be exported.`)).toBeVisible();
  await capture(page, "export-dialog-light");
  await setMode(page, "dark");
  if (!(await exportDialog.isVisible())) await page.getByRole("button", { name: "Export" }).click();
  await expect(exportDialog.getByText(`${listTotal} records will be exported.`)).toBeVisible();
  await capture(page, "export-dialog-dark");
  await setMode(page, "light");
  if (!(await exportDialog.isVisible())) await page.getByRole("button", { name: "Export" }).click();
  await expect(exportDialog.getByText(`${listTotal} records will be exported.`)).toBeVisible();
  const exportDownload = page.waitForEvent("download");
  await exportDialog.getByRole("link", { name: "Download CSV" }).click();
  const exported = lines(await text(await exportDownload));
  expect(exported[0]).toBe("Name,Email,Phone,Social handle,Organization,Job title,Email marketing,Created,Updated,Notes");
  expect(exported.length - 1).toBe(listTotal);
  expect(exported.find((line) => line.startsWith("Synthetic Ruth Okafor"))).toContain("'+4915112340001");
  await page.keyboard.press("Escape");

  // Explicit merge from the same-name suggestion: preview, then confirm.
  await gotoHydrated(page, `${root}/crm/people/${existing}`);
  await page.getByRole("button", { name: "Merge Synthetic Existing into this person" }).click();
  const merge = page.getByRole("dialog", { name: "Merge into Synthetic Existing" });
  await expect(merge.getByText("Merges and erases Synthetic Existing")).toBeVisible();
  await expect(merge.getByText(/1 email, phone or handle: \+4915100000009/)).toBeVisible();
  await capture(page, "merge-dialog-light");
  await merge.getByRole("button", { name: "Merge and erase duplicate" }).click();
  await expect(merge).toBeHidden();
  await expect(page.getByText(/possible duplicate/i)).toHaveCount(0);
  expect((await api(page, "get", `${apiRoot}/contacts/${twin}`)).status).toBe(404);
  expect((await api(page, "get", `${apiRoot}/contacts/${existing}`)).body.identifiers.map((item: { value: string }) => item.value).sort()).toEqual(["+4915100000009", "existing@example.test"]);

  // Roll back the import: the two people it created (untouched since) are removed.
  const imports = (await api(page, "get", `${apiRoot}/crm/imports`)).body as { id: string }[];
  await gotoHydrated(page, `${root}/crm/imports/${imports[0].id}`);
  await page.getByRole("button", { name: "Roll back import" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Roll back import" }).click();
  await expect(page.getByText(/This import was rolled back: 2 removed, 0 reverted, 0 kept/)).toBeVisible();
  await capture(page, "import-rolled-back-light");
  expect((await api(page, "get", `${apiRoot}/contacts?q=ruth%40example.test`)).body.total).toBe(0);
  await gotoHydrated(page, `${root}/crm/imports`);
  await expect(page.getByRole("table", { name: "Import history" }).getByText("Rolled back")).toBeVisible();
  await both(page, "imports-history");

  // A second account: isolation both ways, then viewer limits.
  const otherContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", timezoneId: "Europe/Berlin" });
  const other = await otherContext.newPage();
  const otherEmail = await signIn(other);
  const own = (await api(other, "post", "/api/workspaces", { audience: "church", name: `CRM-06 second tenant ${randomUUID().slice(0, 8)}` })).body.tenantId as string;
  const otherImport = (await api(other, "post", `/api/workspaces/${own}/crm/imports`, { entity: "person", clientKey: randomUUID(), fileName: "b.csv", csv: "Name\nSynthetic B" })).body.id as string;
  expect((await api(other, "get", `${apiRoot}/crm/imports/${imports[0].id}`)).status).toBe(403);
  expect((await api(other, "get", `/api/workspaces/${own}/crm/imports/${imports[0].id}`)).status).toBe(404);
  expect((await api(page, "get", `${apiRoot}/crm/imports/${otherImport}`)).status).toBe(404);
  expect((await api(page, "post", `${apiRoot}/crm/imports/${otherImport}/commit`)).status).toBe(404);
  expect((await other.request.get(`${apiRoot}/crm/export?entity=person`)).status()).toBe(403);
  expect((await api(page, "put", `${apiRoot}/members`, { email: otherEmail, role: "viewer" })).status).toBe(200);
  await gotoHydrated(other, `${root}/crm/people`);
  await expect(other.getByRole("button", { name: "Export" })).toHaveCount(0);
  await expect(other.getByRole("link", { name: "Import", exact: true })).toHaveCount(0);
  await expect(other.getByRole("navigation", { name: "Workspace navigation" }).getByRole("link", { name: "Imports" })).toHaveCount(0);
  expect((await api(other, "get", `${apiRoot}/crm/imports`)).status).toBe(403);
  expect((await api(other, "post", `${apiRoot}/crm/imports`, { entity: "person", clientKey: randomUUID(), fileName: "v.csv", csv: "Name\nX" })).status).toBe(403);
  expect((await other.request.get(`${apiRoot}/crm/export?entity=person`)).status()).toBe(403);
  expect((await api(other, "get", `${apiRoot}/contacts/${existing}/merge?sourceId=${randomUUID()}`)).status).toBe(403);
  await otherContext.close();

  // Layout: the wizard and the lists keep the full-width shell on a phone and at 1440.
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    await gotoHydrated(page, `${root}/crm/imports/${imports[0].id}`);
    await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
    await expectFullWidthShell(page);
    await expectResultTargets(page);
    if (viewport.width === 390) await capture(page, "import-390-light");
    for (const list of ["people", "companies", "tasks"]) { await gotoHydrated(page, `${root}/crm/${list}`); await expectFullWidthShell(page); }
  }
  expect(pageErrors).toEqual([]);
});
