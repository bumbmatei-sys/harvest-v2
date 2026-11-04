import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const evidence = "docs/screenshots/pr01b";
const origin = "http://127.0.0.1:3100";
const accessibility: { screen: string; violations: number; checks: number }[] = [];
test.use({ actionTimeout: 30_000, reducedMotion: "reduce" });
async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await expect(page.getByLabel("Six-digit code")).toBeVisible();
  let code = "";
  await expect.poll(async () => {
    const lines = (await readFile(process.env.HARVEST_E2E_MAILBOX!, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
    const mail = lines.map((line) => JSON.parse(line)).find((message) => message.to === email);
    code = mail?.text.match(/\b\d{6}\b/)?.[0] ?? ""; return code.length;
  }).toBe(6);
  await page.getByLabel("Six-digit code").fill(code);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces$/);
}
async function selectBrand(page: Page, brand: string) {
  await page.getByRole("combobox", { name: "Brand theme", exact: true }).click();
  await page.getByRole("option", { name: brand, exact: true }).click();
}
async function theme(page: Page, brand: "harvest" | "studio", mode: "light" | "dark") {
  await selectBrand(page, brand === "harvest" ? "Harvest" : "Studio");
  await expect(page.locator("html")).toHaveAttribute("data-brand-theme", brand);
  if (await page.locator("html").getAttribute("data-theme") !== mode) await page.getByRole("button", { name: `Switch to ${mode} mode` }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
  await expect(page.locator("body")).toHaveCSS("font-family", brand === "studio" ? /Geist/ : /Inter/);
  await expect(page.locator("body")).toHaveCSS("background-color", { harvest: { light: "rgb(250, 250, 248)", dark: "rgb(23, 23, 23)" }, studio: { light: "rgb(247, 247, 245)", dark: "rgb(26, 26, 26)" } }[brand][mode]);
}
async function capture(page: Page, name: string) {
  const shell = page.locator('[data-slot="sidebar-wrapper"]');
  if (await shell.count()) await expect(shell).toHaveAttribute("data-hydrated", "true");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true, animations: "disabled" });
  const result = await new AxeBuilder({ page }).analyze();
  accessibility.push({ screen: name, violations: result.violations.length, checks: result.passes.length });
  expect(result.violations, `axe: ${name}`).toEqual([]);
}
async function matrix(page: Page, screen: string) {
  for (const brand of ["harvest", "studio"] as const) for (const mode of ["light", "dark"] as const) {
    await theme(page, brand, mode); await capture(page, `${screen}-${brand}-${mode}`);
  }
}

test("PR 01b real UI: contacts, consent, themes, workspace isolation and responsive states", async ({ page, browser }) => {
  test.setTimeout(360_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/sign-in");
  await matrix(page, "sign-in");
  const marker = Date.now(), ownerEmail = `pr01b-owner-${marker}@example.test`, viewerEmail = `pr01b-viewer-${marker}@example.test`;
  await signIn(page, ownerEmail);
  await page.getByLabel("Workspace name").fill("PR 01b browser seed");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByText("PR 01b browser seed", { exact: true })).toBeVisible();
  await matrix(page, "workspace");
  await page.getByRole("link", { name: "Open workspace" }).click();
  await expect(page.getByRole("heading", { name: "Contacts", exact: true })).toBeVisible();
  const base = new URL(page.url()).pathname, tenantId = base.split("/")[2], api = `/api/workspaces/${tenantId}/contacts`;
  await matrix(page, "contacts-empty");
  expect((await page.request.get("/api/workspaces/not-a-uuid/contacts")).status()).toBe(400);
  expect((await page.request.get(`${api}?page=-1`)).status()).toBe(400);
  expect((await page.request.post(api, { headers: { origin }, data: { name: "Injected", tenantId } })).status()).toBe(400);
  expect((await page.request.post(api, { headers: { origin: "https://untrusted.example.test" }, data: { name: "Forbidden" } })).status()).toBe(403);
  await page.getByRole("button", { name: "Add contact", exact: true }).first().click();
  await page.getByLabel("Full name").fill("Synthetic Ada Rivers");
  await page.getByLabel("Email address").fill(`ada-${marker}@example.test`);
  await page.getByLabel("Phone", { exact: false }).fill("+49 123 456789");
  await page.getByLabel("Social handle", { exact: false }).fill("@synthetic-ada");
  await page.getByLabel("Notes", { exact: false }).fill("Synthetic browser seed for the contacts workflow.");
  await page.route(`**${api}`, (route) => route.request().method() === "POST" ? route.abort("failed") : route.continue());
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not connect");
  await capture(page, "contact-create-error-studio-dark");
  await page.unroute(`**${api}`);
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Synthetic Ada Rivers", exact: true })).toBeVisible();
  const detail = new URL(page.url()).pathname, contactId = detail.split("/").at(-1)!;
  await expect(page.getByText("No consent recorded", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit contact", exact: true }).click();
  await page.getByLabel("Notes", { exact: false }).fill("Synthetic note updated through the real UI.");
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect(page.getByText("Synthetic note updated through the real UI.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Record consent", exact: true }).click();
  await page.getByRole("combobox", { name: "Status", exact: true }).click();
  await page.getByRole("option", { name: "Granted", exact: true }).click();
  await page.getByLabel("Source", { exact: true }).fill("Synthetic preference form");
  await page.getByLabel("Evidence", { exact: true }).fill("Synthetic browser evidence reference PR01b.");
  await page.getByRole("button", { name: "Save consent record", exact: true }).click();
  await expect(page.getByText("Synthetic preference form", { exact: true })).toBeVisible();
  await page.reload();
  await matrix(page, "contact-detail");
  expect((await page.request.post(api, { headers: { origin }, data: { name: "Duplicate", email: `ADA-${marker}@example.test` } })).status()).toBe(409);
  await page.getByRole("link", { name: "All contacts", exact: true }).click();
  await expect(page.getByRole("link", { name: "Synthetic Ada Rivers", exact: true })).toBeVisible();
  await matrix(page, "contacts-list");
  await page.getByLabel("Search contacts").fill("no-such-contact");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No matching contacts" })).toBeVisible();
  await capture(page, "contacts-no-results-studio-dark");
  await page.getByRole("link", { name: "Clear search" }).click();
  await page.getByRole("link", { name: "Appearance", exact: true }).click();
  await page.getByRole("combobox", { name: "Default brand theme" }).click();
  await page.getByRole("option", { name: "Studio", exact: true }).click();
  await page.getByRole("button", { name: "Save appearance" }).click();
  await expect(page.getByRole("status")).toContainText("Workspace appearance saved");
  await selectBrand(page, "Harvest");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-brand-theme", "harvest");
  await expect(page.locator("html")).toHaveAttribute("data-workspace-theme", "studio");
  await selectBrand(page, "Workspace default");
  await expect(page.locator("html")).toHaveAttribute("data-brand-theme", "studio");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-brand-theme", "studio");
  await capture(page, "appearance-studio-dark");
  // The server sends the tenant default in the blocking head script, independent of hydration.
  const html = await (await page.request.get(base)).text();
  expect(html).toContain('w="studio"');
  await page.goto(`${base}/${randomUUID()}`);
  await expect(page.getByRole("heading", { name: "Contact not found" })).toBeVisible();
  await capture(page, "contact-not-found-studio-dark");
  // A second verified account exercises reader permissions and its own isolated workspace.
  const viewerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const viewer = await viewerContext.newPage();
  viewer.on("pageerror", (error) => pageErrors.push(error.message));
  await signIn(viewer, viewerEmail);
  expect((await page.request.put(`/api/workspaces/${tenantId}/members`, { headers: { origin }, data: { email: viewerEmail, role: "viewer" } })).status()).toBe(200);
  await viewer.goto(base);
  await expect(viewer.getByText("You have view-only access.", { exact: false })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Add contact", exact: true })).toHaveCount(0);
  expect((await viewer.request.post(api, { headers: { origin }, data: { name: "Forbidden" } })).status()).toBe(403);
  expect((await viewer.request.patch(`${api}/${contactId}`, { headers: { origin }, data: { name: "Forbidden" } })).status()).toBe(403);
  expect((await viewer.request.post(`${api}/${contactId}/consents`, { headers: { origin }, data: { channel: "email", status: "granted", source: "Test", evidence: "Test" } })).status()).toBe(403);
  expect((await viewer.request.patch(`/api/workspaces/${tenantId}/appearance`, { headers: { origin }, data: { brandTheme: "harvest" } })).status()).toBe(403);
  await capture(viewer, "contacts-viewer-studio-light");
  await viewer.goto("/workspaces");
  await viewer.getByLabel("Workspace name").fill("PR 01b isolated browser seed");
  await viewer.getByRole("button", { name: "Create workspace" }).click();
  await expect(viewer.getByText("PR 01b isolated browser seed", { exact: true })).toBeVisible();
  const otherWorkspaces = await (await viewer.request.get("/api/workspaces")).json();
  const other = otherWorkspaces.find((workspace: { name: string }) => workspace.name === "PR 01b isolated browser seed");
  await expect.poll(() => viewer.getByText("PR 01b isolated browser seed", { exact: true }).count()).toBe(1);
  expect(other).toBeTruthy();
  expect((await page.request.get(`/api/workspaces/${other.tenantId}/contacts`)).status()).toBe(403);
  expect((await viewer.request.get(`/api/workspaces/${other.tenantId}/contacts/${contactId}`)).status()).toBe(404);
  await page.goto(`/workspaces/${other.tenantId}/contacts`);
  await expect(page.getByRole("heading", { name: "Workspace access denied" })).toBeVisible();
  await capture(page, "contacts-unauthorized-harvest-dark");
  await viewerContext.close();
  await page.goto(detail);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const brand of ["harvest", "studio"] as const) for (const mode of ["light", "dark"] as const) {
    await theme(page, brand, mode);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await capture(page, `contact-detail-mobile-${brand}-${mode}`);
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    await expect(page.getByRole("link", { name: "Contacts", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Contacts", exact: true }).click();
    await expect(page).toHaveURL(`${origin}${base}`);
    await expect(page.getByRole("heading", { name: "Contacts", exact: true })).toBeVisible();
    await capture(page, `contacts-list-mobile-${brand}-${mode}`);
    await page.getByRole("link", { name: "Synthetic Ada Rivers", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Synthetic Ada Rivers", exact: true })).toBeVisible();
  }
  expect(pageErrors).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await writeFile(`${evidence}/axe-results.json`, `${JSON.stringify(accessibility, null, 2)}\n`);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto(detail); await expect(page).toHaveURL(/\/sign-in$/);
  expect((await page.request.get(api)).status()).toBe(401);
});
