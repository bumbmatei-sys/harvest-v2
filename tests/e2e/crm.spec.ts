import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { expectBackLinkAligned, expectFullWidthShell } from "./helpers/layout";

// CRM-01/02 browser proof: real database, real routes, mocked email only.
const expect = baseExpect.configure({ timeout: 20_000 });
const evidence = "docs/screenshots/crm";
const desktop = { width: 1440, height: 1000 }, wide = { width: 1920, height: 1080 }, mobile = { width: 390, height: 844 };
test.use({ reducedMotion: "reduce", viewport: desktop, timezoneId: "Europe/Berlin" });

type Report = { screen: string; violations: number };
const report: Report[] = [];

async function setMode(page: Page, mode: "light" | "dark") {
  await expect(page.locator('[data-slot="sidebar-wrapper"]')).toHaveAttribute("data-hydrated", "true");
  if (await page.locator("html").getAttribute("data-theme") === mode) return;
  const toggle = page.getByRole("button", { name: new RegExp(`^Switch to ${mode}`) }).first();
  // Below 1024px the toggle lives in the closed sidebar sheet; use the stored preference it writes.
  if (await toggle.isVisible()) await toggle.click();
  else { await page.evaluate((value) => localStorage.setItem("harvest-color-mode", value), mode); await page.reload(); }
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
}
async function capture(page: Page, name: string, { axe = true } = {}) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveTitle(/Harvest/);
  expect(await page.locator("body").innerText()).not.toContain("MISSING_MESSAGE");
  // The shell scrolls inside <main>; grow the viewport so the capture holds the whole screen.
  const size = page.viewportSize()!;
  const overflow = await page.evaluate(() => { const main = document.querySelector("main"); return main ? main.scrollHeight - main.clientHeight : 0; });
  if (overflow > 0) await page.setViewportSize({ width: size.width, height: size.height + overflow });
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true, animations: "disabled" });
  if (overflow > 0) await page.setViewportSize(size);
  if (axe) {
    const result = await new AxeBuilder({ page }).analyze();
    report.push({ screen: name, violations: result.violations.length });
    expect(result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), name).toEqual([]);
  }
}
async function both(page: Page, name: string) {
  for (const mode of ["light", "dark"] as const) { await setMode(page, mode); await capture(page, `${name}-${mode}`); }
  await setMode(page, "light");
}
async function api(page: Page, method: "get" | "post" | "put" | "patch" | "delete", path: string, data?: unknown) {
  const response = await page.request[method](path, { headers: { origin }, data });
  return { status: response.status(), body: await response.json().catch(() => ({})) };
}

test("CRM: people and companies create, edit, link, filter, isolate and render in every state", async ({ page, browser }) => {
  test.setTimeout(420_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  const workspace = await api(page, "post", "/api/workspaces", { name: "Harvest CRM browser workspace" });
  expect(workspace.status).toBe(201);
  const tenantId = workspace.body.tenantId as string, root = `/workspaces/${tenantId}`, apiRoot = `/api${root}`;

  // Empty states and navigation.
  await page.goto(`${root}/contacts`);
  await expect(page).toHaveURL(`${root}/crm/people`);
  await expect(page.getByRole("heading", { name: "Every connection starts somewhere" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("link", { name: "People", exact: true })).toHaveAttribute("aria-current", "page");
  await both(page, "people-empty");
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("link", { name: "Companies", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No companies yet" })).toBeVisible();
  await both(page, "companies-empty");

  // Create a company through the dialog; the pasted URL is reduced to a domain.
  await page.getByRole("button", { name: "Add company" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Company name").fill("Riverside Community Trust");
  await dialog.getByLabel("Domain").fill("https://www.Riverside-Trust.example/about");
  await capture(page, "company-create-dialog-light");
  await dialog.getByRole("button", { name: "Save company" }).click();
  await expect(page).toHaveURL(new RegExp(`${root}/crm/companies/[0-9a-f-]{36}$`));
  const companyId = page.url().split("/").pop()!;
  await expect(page.getByRole("link", { name: "riverside-trust.example" })).toHaveAttribute("href", "https://riverside-trust.example");
  await expect(page.getByText("No people at this company yet")).toBeVisible();

  // Inline edit: description saves on blur, Escape cancels.
  await page.getByRole("button", { name: /^Edit Description/ }).click();
  await page.getByRole("textbox", { name: "Description" }).fill("Synthetic partner organisation for the CRM browser test.");
  await page.getByRole("textbox", { name: "Description" }).press("Control+Enter");
  await expect(page.getByRole("button", { name: /^Edit Description: Synthetic partner/ })).toBeVisible();
  await page.getByRole("heading", { name: "Riverside Community Trust" }).getByRole("button").click();
  await page.getByRole("textbox", { name: "Name" }).fill("Discarded name");
  await page.getByRole("textbox", { name: "Name" }).press("Escape");
  await expect(page.getByRole("heading", { name: "Riverside Community Trust" })).toBeVisible();

  // Create a person directly at this company, with a role.
  await page.getByRole("button", { name: "New person" }).click();
  await page.getByRole("dialog").getByLabel("Full name").fill("Synthetic Grace Okafor");
  await page.getByRole("dialog").getByLabel("Email address").fill("Grace@Example.test");
  await page.getByRole("dialog").getByLabel("Role at Riverside Community Trust").fill("Volunteer coordinator");
  await page.getByRole("dialog").getByRole("button", { name: "Save person" }).click();
  await expect(page.getByRole("table").getByRole("link", { name: /Synthetic Grace Okafor/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Volunteer coordinator" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "linked Synthetic Grace Okafor" })).toBeVisible();
  await both(page, "company-detail");

  // Person record: inline identifier edits, company linking with inline create, primary switch.
  await page.getByRole("link", { name: /Synthetic Grace Okafor/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`${root}/crm/people/[0-9a-f-]{36}$`));
  const personId = page.url().split("/").pop()!;
  await expect(page.getByRole("link", { name: "grace@example.test" })).toHaveAttribute("href", "mailto:grace@example.test");
  await page.getByRole("button", { name: "Edit Phone: Empty" }).click();
  await page.getByRole("textbox", { name: "Phone" }).fill("12345");
  await page.getByRole("textbox", { name: "Phone" }).press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "international phone number" })).toBeVisible();
  await page.getByRole("textbox", { name: "Phone" }).fill("+44 20 7946 0123");
  await page.getByRole("textbox", { name: "Phone" }).press("Enter");
  await expect(page.getByRole("link", { name: "+442079460123" })).toBeVisible();
  await page.getByRole("button", { name: "Link company" }).click();
  await page.getByPlaceholder("Search companies").fill("Northgate Fellowship");
  await page.getByRole("option", { name: "Create company “Northgate Fellowship”" }).click();
  await expect(page.getByRole("link", { name: "Northgate Fellowship" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Actions for Northgate Fellowship" }).click();
  await page.getByRole("menuitem", { name: "Make primary" }).click();
  await expect(page.getByRole("link", { name: "Northgate Fellowship" }).first()).toBeVisible();
  await expect(page.locator("main").getByText("Primary", { exact: true })).toHaveCount(1);
  await page.getByRole("textbox", { name: "Role at Northgate Fellowship" }).fill("Elder");
  await page.getByRole("textbox", { name: "Role at Northgate Fellowship" }).press("Enter");
  await expect(page.getByRole("link", { name: "Elder at Northgate Fellowship" })).toBeVisible();
  await page.getByRole("button", { name: "Edit Notes: Add a note…" }).click();
  await page.getByRole("textbox", { name: "Notes" }).fill("Met at the synthetic community lunch.");
  await page.getByRole("textbox", { name: "Notes" }).press("Control+Enter");
  await expect(page.getByRole("button", { name: /^Edit Notes: Met at/ })).toBeVisible();
  await expect(page.getByText("updated Phone")).toBeVisible();
  await both(page, "person-detail");

  // A duplicate identifier is rejected inline and nothing is merged.
  const other = await api(page, "post", `${apiRoot}/contacts`, { name: "Synthetic Grace Okafor", email: "grace.other@example.test" });
  expect(other.status).toBe(201);
  await page.getByRole("button", { name: "Edit Email" }).click();
  await page.getByRole("textbox", { name: "Email" }).fill("GRACE.OTHER@example.test");
  await page.getByRole("textbox", { name: "Email" }).press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "already belongs to a contact" })).toBeVisible();
  await capture(page, "person-inline-duplicate-error-light");
  await page.getByRole("textbox", { name: "Email" }).press("Escape");
  await page.reload();
  await expect(page.getByText("Another person has the same name")).toBeVisible();
  await capture(page, "person-possible-duplicate-light");

  // Stale writes: another tab changes the record first.
  const fresh = await api(page, "get", `${apiRoot}/contacts/${personId}`);
  expect((await api(page, "patch", `${apiRoot}/contacts/${personId}`, { social: "@grace", version: fresh.body.version })).status).toBe(200);
  expect((await api(page, "patch", `${apiRoot}/contacts/${personId}`, { social: "@stale", version: fresh.body.version })).status).toBe(409);
  await page.getByRole("button", { name: "Edit Social handle: Empty" }).click();
  await page.getByRole("textbox", { name: "Social handle" }).fill("@older-tab");
  await page.getByRole("textbox", { name: "Social handle" }).press("Enter");
  await expect(page.getByText("Someone else changed this record")).toBeVisible();
  await capture(page, "person-stale-version-light");
  await page.getByRole("button", { name: "Reload" }).click();
  await page.goto(`${root}/crm/people/${personId}`);
  await expect(page.getByRole("button", { name: "Edit Social handle: @grace" })).toBeVisible();

  // Seed enough rows for pagination, then exercise search, filters, sort and empty results.
  for (let index = 0; index < 22; index += 1) {
    expect((await api(page, "post", `${apiRoot}/contacts`, { name: `Synthetic Member ${String(index).padStart(2, "0")}`, ...(index % 3 ? { email: `member${index}@example.test` } : {}), ...(index % 4 === 0 ? { companyId } : {}) })).status).toBe(201);
  }
  await page.goto(`${root}/crm/people`);
  await expect(page.getByRole("table", { name: "People" })).toBeVisible();
  await expect(page.getByText("Showing 1–20 of 24")).toBeVisible();
  await both(page, "people-list");
  await page.getByRole("link", { name: "Page 2" }).click();
  await expect(page.getByText("Showing 21–24 of 24")).toBeVisible();
  await page.getByRole("button", { name: /^Sort/ }).click();
  await page.getByRole("menuitemradio", { name: "Newest first" }).click();
  await expect(page).toHaveURL(/sort=-created/);
  await expect(page).not.toHaveURL(/page=2/);
  await page.getByRole("button", { name: "Company", exact: true }).click();
  await page.getByPlaceholder("Search companies").fill("Riverside");
  await page.getByRole("option", { name: /Riverside Community Trust/ }).click();
  await expect(page).toHaveURL(new RegExp(`company=${companyId}`));
  await expect(page.getByRole("listitem").filter({ hasText: "Company: Riverside Community Trust" })).toBeVisible();
  await expect(page.getByRole("table", { name: "People" }).getByRole("row")).toHaveCount(8);
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("menuitem", { name: "Email", exact: true }).hover();
  await page.getByRole("menuitemradio", { name: "No email" }).click();
  await expect(page).toHaveURL(/email=without/);
  await capture(page, "people-filtered-light");
  await page.getByRole("button", { name: "Reset view" }).click();
  await expect(page).toHaveURL(`${root}/crm/people?sort=-created`);
  await page.getByRole("searchbox", { name: "Search people" }).fill("northgate");
  await page.getByRole("searchbox", { name: "Search people" }).press("Enter");
  await expect(page.getByRole("link", { name: /Synthetic Grace Okafor/ })).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search people" }).fill("no-such-person");
  await page.getByRole("searchbox", { name: "Search people" }).press("Enter");
  await expect(page.getByRole("heading", { name: "No matching people" })).toBeVisible();
  await both(page, "people-no-results");
  await page.goto(`${root}/crm/people?sort=sideways`);
  await expect(page.getByText("Some view settings in the address were not valid")).toBeVisible();

  // Companies list, duplicate domain conflict and its recovery link.
  await page.goto(`${root}/crm/companies`);
  await expect(page.getByRole("table", { name: "Companies" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View 7 people at Riverside Community Trust" })).toBeVisible();
  await both(page, "companies-list");
  await page.getByRole("button", { name: "Add company" }).click();
  await page.getByRole("dialog").getByLabel("Company name").fill("Riverside duplicate");
  await page.getByRole("dialog").getByLabel("Domain").fill("RIVERSIDE-TRUST.example");
  await page.getByRole("dialog").getByRole("button", { name: "Save company" }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Open the existing company" })).toHaveAttribute("href", `${root}/crm/companies/${companyId}`);
  await capture(page, "company-duplicate-domain-light");
  await page.keyboard.press("Escape");

  // Loading state: a real slow query. Hold a lock on the disposable test database
  // while the page streams; the shell and its loading boundary render first.
  const lock = new Client({ connectionString: await readFile(`${process.env.HARVEST_E2E_MAILBOX}.database`, "utf8") });
  await lock.connect();
  await lock.query("begin");
  await lock.query("lock table contacts in access exclusive mode");
  const navigation = page.goto(`${root}/crm/people?company=${companyId}`);
  await expect(page.getByRole("status", { name: "Loading people" })).toBeVisible();
  await capture(page, "people-loading-light", { axe: false });
  await lock.query("rollback"); await lock.end();
  await navigation;
  await expect(page.getByRole("table", { name: "People" })).toBeVisible();

  // A second account: viewer access, then two-way tenant isolation through the HTTP API.
  const viewerContext = await browser.newContext({ viewport: desktop, reducedMotion: "reduce" });
  const viewer = await viewerContext.newPage();
  const viewerEmail = await signIn(viewer);
  expect((await api(page, "put", `${apiRoot}/members`, { email: viewerEmail, role: "viewer" })).status).toBe(200);
  await viewer.goto(`${root}/crm/people/${personId}`);
  await expect(viewer.getByText("You have view-only access to this record.")).toBeVisible();
  await expect(viewer.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Link company" })).toHaveCount(0);
  await capture(viewer, "person-viewer-light");
  expect((await api(viewer, "patch", `${apiRoot}/contacts/${personId}`, { name: "Denied", version: 1 })).status).toBe(403);
  expect((await api(viewer, "post", `${apiRoot}/companies`, { name: "Denied" })).status).toBe(403);
  expect((await api(viewer, "post", `${apiRoot}/contacts/${personId}/companies`, { companyId })).status).toBe(403);
  const own = await api(viewer, "post", "/api/workspaces", { name: `Second CRM tenant ${randomUUID().slice(0, 8)}` });
  const tenantB = own.body.tenantId as string, apiB = `/api/workspaces/${tenantB}`;
  const companyB = (await api(viewer, "post", `${apiB}/companies`, { name: "Riverside Community Trust", domain: "riverside-trust.example" })).body.id as string;
  const personB = (await api(viewer, "post", `${apiB}/contacts`, { name: "Synthetic Grace Okafor", email: "grace@example.test" })).body.id as string;
  expect(companyB).toMatch(/^[0-9a-f-]{36}$/); expect(personB).toMatch(/^[0-9a-f-]{36}$/);
  // A -> B: workspace A's owner cannot read, list, link or patch B's records, by URL or by ID.
  expect((await api(page, "get", `${apiB}/companies`)).status).toBe(403);
  expect((await api(page, "get", `${apiRoot}/companies/${companyB}`)).status).toBe(404);
  expect((await api(page, "get", `${apiRoot}/contacts/${personB}`)).status).toBe(404);
  expect((await api(page, "post", `${apiRoot}/contacts/${personId}/companies`, { companyId: companyB })).status).toBe(404);
  expect((await api(page, "patch", `${apiRoot}/companies/${companyB}`, { name: "Hijack", version: 1 })).status).toBe(404);
  expect((await api(page, "get", `${apiRoot}/companies/${companyB}/activity`)).body).toEqual([]);
  expect((await api(page, "get", `${apiRoot}/contacts?company=${companyB}`)).body.total).toBe(0);
  // B -> A: the second account (a viewer in A) still cannot pull A's records into B.
  expect((await api(viewer, "post", `${apiB}/contacts/${personB}/companies`, { companyId })).status).toBe(404);
  expect((await api(viewer, "post", `${apiB}/contacts`, { name: "Cross link", companyId })).status).toBe(404);
  expect((await api(viewer, "get", `${apiB}/contacts/${personId}`)).status).toBe(404);
  expect((await api(viewer, "get", `${apiB}/contacts?q=okafor`)).body.total).toBe(1);
  expect((await api(viewer, "get", `${apiB}/companies/${companyB}`)).body.people).toEqual([]);
    expect((await page.request.post(`${apiRoot}/companies`, { headers: { origin: "https://untrusted.example.test" }, data: { name: "Bad origin" } })).status()).toBe(403);
  await page.goto(`/workspaces/${tenantB}/crm/companies`);
  await expect(page.getByRole("heading", { name: "Workspace access denied" })).toBeVisible();
  await page.goto(`${root}/crm/companies/${companyB}`);
  await expect(page.getByRole("heading", { name: "Company not found" })).toBeVisible();
  await capture(page, "company-not-found-light");
  await viewerContext.close();

  // Tablet regression (review blocker): at 1024px with the sidebar EXPANDED the list
  // card is only ~688px wide. With realistic long names, emails and domains no table
  // may scroll or clip; columns follow the card width, not the viewport.
  const longCompany = (await api(page, "post", `${apiRoot}/companies`, { name: "St. Bartholomew's Community Development Trust and Mission Centre", domain: "https://www.stbartholomewscommunitydevelopmenttrust.org.uk/about" })).body.id as string;
  expect((await api(page, "post", `${apiRoot}/contacts`, { name: "Dr. Oluwaseun Adebayo-Whitfield Castellanos-Rodríguez", email: "oluwaseun.adebayo-whitfield@stbartholomewscommunitydevelopmenttrust.org.uk", phone: "+44 20 7946 0999", companyId: longCompany, title: "Director of Community Partnerships and Outreach" })).status).toBe(201);
  const sidebar = page.locator('[data-slot="sidebar"][data-state]');
  for (const [label, size, expanded] of [["tablet", { width: 1024, height: 900 }, true], ["tablet-collapsed", { width: 1024, height: 900 }, false], ["laptop", { width: 1280, height: 900 }, true], ["laptop-wide", { width: 1366, height: 900 }, true], ["small-tablet", { width: 768, height: 900 }, true]] as const) {
    await page.setViewportSize(size);
    await page.context().addCookies([{ name: "sidebar_state", value: String(expanded), url: origin }]);
    for (const [path, name, longName] of [[`${root}/crm/people`, "people-list", "Dr. Oluwaseun Adebayo-Whitfield Castellanos-Rodríguez"], [`${root}/crm/companies`, "companies-list", "St. Bartholomew's Community Development Trust and Mission Centre"]] as const) {
      await page.goto(path);
      await expect(page.getByRole("table")).toBeVisible();
      if (size.width >= 1024) await expect(sidebar).toHaveAttribute("data-state", expanded ? "expanded" : "collapsed");
      await expectFullWidthShell(page);
      // The long name is truncated inside its cell instead of widening the table.
      const nameLink = page.getByRole("table").getByRole("link").filter({ hasText: longName }).first();
      await expect(nameLink).toBeVisible();
      const fit = await nameLink.evaluate((link, full) => {
        const cell = link.closest("td")!, text = [...link.querySelectorAll("span")].find((span) => span.textContent === full)!;
        return { inCell: link.getBoundingClientRect().right <= cell.getBoundingClientRect().right + 1, truncated: text.scrollWidth > text.clientWidth };
      }, longName);
      expect(fit.inCell, `${label} ${name}`).toBe(true);
      if (label === "tablet") expect(fit.truncated, `${label} ${name} truncates`).toBe(true);
      if (label === "tablet") await both(page, `${name}-tablet`);
    }
    if (label === "tablet") {
      // At ~688px People keeps Name, Company and Email; lower-priority columns wait for room.
      await page.goto(`${root}/crm/people`);
      await expect(page.getByRole("columnheader", { name: "Company" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Email", exact: true })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Email marketing" })).toBeHidden();
      await expectFullWidthShell(page);
    }
  }
  await page.context().addCookies([{ name: "sidebar_state", value: "true", url: origin }]);

  // Full-width layout: wide desktop and phone, both colour modes, with geometry checks.
  const screens = [[`${root}/crm/people`, "people-list", null], [`${root}/crm/people/${personId}`, "person-detail", "All people"], [`${root}/crm/companies`, "companies-list", null], [`${root}/crm/companies/${companyId}`, "company-detail", "All companies"]] as const;
  await page.setViewportSize(wide);
  for (const [path, name, back] of screens) {
    await page.goto(path);
    await expect(page.locator("main h1").first()).toBeVisible();
    await expectFullWidthShell(page);
    if (back) await expectBackLinkAligned(page, back);
    await both(page, `${name}-wide`);
  }
  // From 2xl (the 1920px capture) the record regions form three columns side by side.
  await page.goto(`${root}/crm/people/${personId}`);
  const regions = await page.locator("[data-record-region]").evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().top)));
  expect(new Set(regions).size).toBe(1);
  // Between lg and 2xl, profile and context share a row and history spans the next.
  await page.setViewportSize(desktop);
  await expectFullWidthShell(page);
  const twoColumn = await page.locator("[data-record-region]").evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().top)));
  expect(twoColumn[0]).toBe(twoColumn[1]); expect(twoColumn[2]).toBeGreaterThan(twoColumn[0]);
  await page.setViewportSize(mobile);
  for (const [path, name] of [[`${root}/crm/people`, "people-list-mobile"], [`${root}/crm/people/${personId}`, "person-detail-mobile"], [`${root}/crm/companies`, "companies-list-mobile"], [`${root}/crm/companies/${companyId}`, "company-detail-mobile"]] as const) {
    await page.goto(path);
    await expect(page.locator("main h1").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectFullWidthShell(page);
    await both(page, name);
  }
  await page.goto(`${root}/crm/people/${personId}`);
  await page.getByRole("button", { name: "Edit Social handle: @grace" }).click();
  await page.getByRole("textbox", { name: "Social handle" }).fill("@grace.mobile");
  await page.getByRole("textbox", { name: "Social handle" }).press("Enter");
  await expect(page.getByRole("button", { name: "Edit Social handle: @grace.mobile" })).toBeVisible();

  expect(pageErrors).toEqual([]);
  await writeFile(`${evidence}/accessibility.json`, `${JSON.stringify(report, null, 2)}\n`);
});
