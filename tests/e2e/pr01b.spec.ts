import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { expect as playwrightExpect, test, type Page } from "@playwright/test";
import { contrastRatio } from "../../src/lib/theme";
import AxeBuilder from "@axe-core/playwright";
// First navigation can include development route compilation in the shared browser harness.
const expect = playwrightExpect.configure({ timeout: 15_000 });
const evidence = "docs/screenshots/pr01b";
const origin = "http://127.0.0.1:3100";
const accessibility: { screen: string; violations: number; checks: number }[] = [];
const shellSurfaces: Record<string, string | number>[] = [];
const workspaceName = "PR 01b browser seed — a workspace with a deliberately long name for switcher truncation";
const radioContrast: { palette: string; ratio: number }[] = [];
test.use({ actionTimeout: 30_000, reducedMotion: "reduce", timezoneId: "Europe/Berlin" });
async function signIn(page: Page, email: string) {
  const [a, b, c] = createHash("sha256").update(email).digest();
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `10.${a}.${b}.${c}` });
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
  await page.locator('[data-sidebar="footer"]').or(page.getByRole("combobox", { name: "Brand theme", exact: true })).first().waitFor();
  if (await page.locator('[data-sidebar="footer"]').count()) {
    const account = page.getByRole("button", { name: "Account menu", exact: true });
    // Exit-animating Radix items can remain mounted after selection. Wait on the
    // trigger state instead of treating a mounted item as an open menu.
    if (await account.getAttribute("aria-expanded") !== "true") await account.click();
    await page.getByRole("menuitemradio", { name: brand, exact: true }).click();
    await expect(account).toHaveAttribute("aria-expanded", "false");
  } else {
    await page.getByRole("combobox", { name: "Brand theme", exact: true }).click();
    await page.getByRole("option", { name: brand, exact: true }).click();
  }
}
async function theme(page: Page, brand: "harvest" | "studio", mode: "light" | "dark") {
  await selectBrand(page, brand === "harvest" ? "Harvest" : "Studio");
  await expect(page.locator("html")).toHaveAttribute("data-brand-theme", brand);
  if (await page.locator("html").getAttribute("data-theme") !== mode) await page.getByRole("button", { name: new RegExp(`^Switch to ${mode}`) }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
  await expect(page.locator("body")).toHaveCSS("font-family", /Geist/);
  await expect(page.locator("body")).toHaveCSS("background-color", { light: "rgb(255, 255, 255)", dark: "rgb(10, 10, 10)" }[mode]);
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
async function surfaces(page: Page, palette: string) {
  const colors = await page.evaluate(() => {
    const hex = (rgb: string) => "#" + rgb.match(/[\d.]+/g)!.slice(0, 3).map((value) => Number(value).toString(16).padStart(2, "0")).join("");
    const panel = getComputedStyle(document.querySelector('[data-slot="sidebar-inset"]')!);
    return {
      canvas: hex(getComputedStyle(document.querySelector('[data-slot="sidebar-wrapper"]')!).backgroundColor),
      panel: hex(panel.backgroundColor), foreground: hex(panel.color),
      cards: [...document.querySelectorAll('#main-content [data-slot="card"]')].map((card) => {
        const css = getComputedStyle(card);
        return { color: hex(css.backgroundColor), border: css.borderTopColor, borderWidth: parseFloat(css.borderTopWidth), borderStyle: css.borderTopStyle };
      }),
    };
  });
  if (palette === "harvest-light") {
    expect(colors.panel).toBe("#ffffff");
    expect(colors.canvas).toBe("#ffffff");
    await expect(page.locator('[data-sidebar="sidebar"]').first()).toHaveCSS("background-color", "rgb(250, 250, 250)");
  }
  expect(colors.cards.length).toBeGreaterThan(0);
  for (const card of colors.cards) {
    // The neutral baseline uses borders to separate white cards from white content.
    expect(card.borderWidth).toBeGreaterThanOrEqual(1);
    expect(card.borderStyle).toBe("solid");
    expect(card.border).not.toBe("rgba(0, 0, 0, 0)");
  }
  return { palette, canvas: colors.canvas, panel: colors.panel, card: colors.cards[0].color,
    foreground: colors.foreground, panelToCanvas: contrastRatio(colors.panel, colors.canvas),
    cardToPanel: contrastRatio(colors.cards[0].color, colors.panel), foregroundToPanel: contrastRatio(colors.foreground, colors.panel) };
}
async function matrix(page: Page, screen: string) {
  for (const brand of ["harvest", "studio"] as const) for (const mode of ["light", "dark"] as const) {
    await theme(page, brand, mode);
    if (screen === "contact-detail") await surfaces(page, `${brand}-${mode}`);
    if (screen === "appearance") {
      const colors = await page.getByRole("radio", { name: "Studio Admin", exact: true }).evaluate((radio) => ({
        border: getComputedStyle(radio).borderTopColor,
        background: getComputedStyle(radio.closest('[data-slot="card"]')!).backgroundColor,
      }));
      const luminance = (color: string) => {
        const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((value) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const a = luminance(colors.border), b = luminance(colors.background);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      expect(ratio, `${brand}-${mode} unselected radio contrast`).toBeGreaterThanOrEqual(3);
      radioContrast.push({ palette: `${brand}-${mode}`, ratio });
    }
    await capture(page, `${screen}-${brand}-${mode}`);
  }
}

async function shellMatrix(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const sidebar = page.locator('[data-slot="sidebar"][data-variant="floating"]');
  const inset = page.locator('[data-slot="sidebar-inset"]');
  const footer = page.locator('[data-sidebar="footer"]');
  const navigation = page.getByRole("navigation", { name: "Workspace navigation" });
  await expect(navigation.locator('[data-sidebar="footer"]')).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "Account menu" })).toHaveCount(0);
  const switcher = navigation.getByRole("button", { name: `Switch workspace: ${workspaceName}`, exact: true });
  await expect(switcher.locator('[data-workspace-name]')).toHaveText(workspaceName);
  expect(await switcher.locator('[data-workspace-name]').evaluate((label) => label.scrollWidth > label.clientWidth)).toBe(true);
  await switcher.hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await switcher.click();
  await expect(page.getByRole("menuitem", { name: workspaceName, exact: true })).toHaveAttribute("href", /\/workspaces\/.+\/crm\/people$/);
  await page.keyboard.press("Escape");
  await page.mouse.move(1000, 0);
  const trigger = footer.locator('[data-sidebar="trigger"]');
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await expect(inset).toHaveCSS("border-radius", "14px");
  for (const edge of ["top", "right", "bottom"]) await expect(inset).toHaveCSS(`margin-${edge}`, "8px");
  await expect(inset).toHaveCSS("border-top-width", "1px");
  await expect(page.locator('[data-shell-header] [data-sidebar="trigger"]')).toBeVisible();
  await expect(trigger).toBeVisible();
  await expect(footer.getByRole("button", { name: /^Switch to/ })).toBeVisible();
  const logo = sidebar.locator('img');
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(sidebar.getByRole("link", { name: "Harvest", exact: true })).toBeVisible();
  // Keyboard access to the relocated brand radio group.
  await footer.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitemradio", { name: "Harvest", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-brand-theme", "harvest");
  await expect(footer.getByRole("button", { name: "Account menu" })).toHaveAttribute("aria-expanded", "false");
  await footer.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitemradio", { name: "Studio", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-brand-theme", "studio");
  await expect(footer.getByRole("button", { name: "Account menu" })).toHaveAttribute("aria-expanded", "false");
  for (const brand of ["harvest", "studio"] as const) for (const mode of ["light", "dark"] as const) {
    await theme(page, brand, mode);
    await expect(sidebar.getByRole("link", { name: "Harvest", exact: true }).getByText("Harvest", { exact: true })).toHaveCSS("font-family", /Geist/);
    await expect(page.getByRole("heading", { name: /^People/ })).toHaveCSS("font-family", /Geist/);
    shellSurfaces.push(await surfaces(page, `${brand}-${mode}`));
    await capture(page, `shell-expanded-${brand}-${mode}`);
    await footer.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("group", { name: "Brand theme" })).toBeVisible();
    await capture(page, `shell-account-menu-${brand}-${mode}`);
    await page.keyboard.press("Escape");
    await trigger.click();
    await expect(sidebar).toHaveAttribute("data-collapsible", "icon");
    await page.reload();
    await expect(sidebar).toHaveAttribute("data-collapsible", "icon");
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    await expect(page.locator("html")).toHaveAttribute("data-brand-theme", brand);
    await expect(logo).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "People", exact: true })).toBeVisible();
    await expect(switcher.locator('[data-slot="avatar"]')).toBeVisible();
    await expect(switcher.locator('svg.lucide-building-2')).toHaveCount(0);
    await switcher.hover();
    await expect(page.getByRole("tooltip")).toHaveText(workspaceName);
    if (brand === "studio" && mode === "dark") await capture(page, "shell-workspace-tooltip-studio-dark");
    await page.keyboard.press("Escape");
    await page.mouse.move(1000, 0, { steps: 5 });
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
    await capture(page, `shell-collapsed-${brand}-${mode}`);
    // Closed groups must still expose their icon links in the collapsed rail.
    await trigger.click();
    await sidebar.getByRole("button", { name: "CRM", exact: true }).click();
    await expect(sidebar.getByRole("link", { name: "People", exact: true })).toBeHidden();
    await page.keyboard.press("Control+b");
    await expect(sidebar.getByRole("link", { name: "People", exact: true })).toBeVisible();
    await page.keyboard.press("Control+b");
    await sidebar.getByRole("button", { name: "CRM", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(inset).toHaveCSS("margin-top", "0px");
    await expect(inset).toHaveCSS("border-radius", "0px");
    await page.locator('[data-shell-header] [data-sidebar="trigger"]').click();
    await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeVisible();
    await capture(page, `shell-mobile-${brand}-${mode}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("dialog", { name: "Sidebar" }).getByRole("link", { name: "People", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Sidebar" })).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 800 });
  }
  // Flip the footer toggle itself and verify its stored mode survives reload.
  const previous = await page.locator("html").getAttribute("data-theme");
  await footer.getByRole("button", { name: /^Switch to/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", previous === "dark" ? "light" : "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", previous === "dark" ? "light" : "dark");
  await theme(page, "studio", "dark");
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test("PR 01b real UI: contacts, consent, themes, workspace isolation and responsive states", async ({ page, browser }) => {
  test.setTimeout(600_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // Next's dev-only issues badge sits in the bottom-left corner, over the collapsed sidebar's footer trigger, and
  // swallows clicks whenever a dev warning has been logged. It is tooling, not the app (page errors are still asserted).
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.head.append(style);
  }));
  await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/sign-in");
  await matrix(page, "sign-in");
  const marker = Date.now(), ownerEmail = `pr01b-owner-${marker}@example.test`, viewerEmail = `pr01b-viewer-${marker}@example.test`;
  await signIn(page, ownerEmail);
  await page.getByLabel("Workspace name").fill(workspaceName);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByText(workspaceName, { exact: true })).toBeVisible();
  await matrix(page, "workspace");
  await page.getByRole("link", { name: "Open workspace" }).click();
  await expect(page.getByRole("heading", { name: /^People/ })).toBeVisible();
  const base = new URL(page.url()).pathname, tenantId = base.split("/")[2], api = `/api/workspaces/${tenantId}/contacts`;
  await matrix(page, "contacts-empty");
  expect((await page.request.get("/api/workspaces/not-a-uuid/contacts")).status()).toBe(400);
  expect((await page.request.get(`${api}?page=-1`)).status()).toBe(400);
  expect((await page.request.post(api, { headers: { origin }, data: { name: "Injected", tenantId } })).status()).toBe(400);
  expect((await page.request.post(api, { headers: { origin: "https://untrusted.example.test" }, data: { name: "Forbidden" } })).status()).toBe(403);
  await page.getByRole("button", { name: "Add person", exact: true }).first().click();
  await page.getByLabel("Full name").fill("Synthetic Ada Rivers");
  await page.getByLabel("Email address").fill(`ada-${marker}@example.test`);
  await page.getByLabel("Phone", { exact: false }).fill("+49 123 456789");
  await page.getByLabel("Social handle", { exact: false }).fill("@synthetic-ada");
  await page.getByLabel("Notes", { exact: false }).fill("Synthetic browser seed for the contacts workflow.");
  await page.route(`**${api}`, (route) => route.request().method() === "POST" ? route.abort("failed") : route.continue());
  await page.getByRole("button", { name: "Save person", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not connect");
  await capture(page, "contact-create-error-studio-dark");
  await page.unroute(`**${api}`);
  await page.getByRole("button", { name: "Save person", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Synthetic Ada Rivers", exact: true })).toBeVisible();
  const detail = new URL(page.url()).pathname, contactId = detail.split("/").at(-1)!;
  const consentData = { purpose: "marketing", noticeVersion: "notice-v1", channel: "email", status: "granted", source: "Test", evidence: "Test" };
  expect((await page.request.patch(`${api}/${contactId}`, { headers: { origin }, data: { name: "Injected", tenantId } })).status()).toBe(400);
  expect((await page.request.post(`${api}/${contactId}/consents`, { headers: { origin }, data: { ...consentData, tenantId } })).status()).toBe(400);
  expect((await page.request.patch(`/api/workspaces/${tenantId}/appearance`, { headers: { origin }, data: { brandTheme: "studio", tenantId } })).status()).toBe(400);
  expect((await page.request.post(`${api}/${contactId}/erase`, { headers: { origin }, data: { confirm: "erase", tenantId } })).status()).toBe(400);
  // Notes are edited inline on the CRM record page (CRM-02); consent lives in its tab.
  await page.getByRole("button", { name: /^Edit Notes: Synthetic browser seed/ }).click();
  await page.getByRole("textbox", { name: "Notes" }).fill("Synthetic note updated through the real UI.");
  await page.getByRole("textbox", { name: "Notes" }).press("Control+Enter");
  await expect(page.getByRole("button", { name: "Edit Notes: Synthetic note updated through the real UI." })).toBeVisible();
  await page.getByRole("tab", { name: "Consent history" }).click();
  await expect(page.getByText("No consent recorded", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Record consent", exact: true }).click();
  await page.getByRole("combobox", { name: "Status", exact: true }).click();
  await page.getByRole("option", { name: "Granted", exact: true }).click();
  await page.getByLabel("Source", { exact: true }).fill("Synthetic preference form");
  await page.getByLabel("Evidence", { exact: true }).fill("Synthetic browser evidence reference PR01b.");
  await page.getByLabel("Consent date (UTC)", { exact: true }).click();
  const calendar = page.locator('[data-slot="calendar"]');
  await expect(calendar).toBeVisible();
  await capture(page, "consent-calendar-studio-dark");
  const selected = calendar.locator('[data-selected-single="true"]');
  await selected.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(calendar).toHaveCount(0);
  const chosenDate = await page.getByLabel("Consent date (UTC)", { exact: true }).getAttribute("data-date");
  await page.getByLabel("Time (UTC)", { exact: true }).fill("12:30");
  await capture(page, "consent-dialog-studio-dark");
  await page.getByRole("button", { name: "Save consent record", exact: true }).click();
  await expect(page.getByText("Synthetic preference form", { exact: true })).toBeVisible();
  const storedConsent = await (await page.request.get(`${api}/${contactId}`)).json();
  expect(storedConsent.consents[0].occurredAt).toBe(`${chosenDate}T12:30:00.000Z`);
  await page.reload();
  expect((await page.request.post(`${api}/${contactId}/consents`, { headers: { origin }, data: { ...consentData, occurredAt: new Date(Date.now() + 6 * 60_000).toISOString() } })).status()).toBe(400);
  expect((await page.request.post(`${api}/${contactId}/consents`, { headers: { origin }, data: { ...consentData, status: "withdrawn", occurredAt: "2026-10-01T12:00:00Z" } })).status()).toBe(201);
  await page.reload();
  await expect(page.getByText("Marketing preferences").locator("../..")).toContainText("Withdrawn");
  const effective = await (await page.request.get(`${api}/${contactId}`)).json();
  expect(effective.effectiveConsents.find((row: { channel: string }) => row.channel === "email").status).toBe("withdrawn");
  // A historical grant recorded after the withdrawal must not resubscribe.
  expect((await page.request.post(`${api}/${contactId}/consents`, { headers: { origin }, data: { ...consentData, occurredAt: "2026-09-01T12:00:00Z" } })).status()).toBe(201);
  const backdated = await (await page.request.get(`${api}/${contactId}`)).json();
  expect(backdated.consents[0].status).toBe("granted");
  expect(backdated.effectiveConsents.find((row: { channel: string }) => row.channel === "email").status).toBe("withdrawn");
  await page.reload();
  await page.getByRole("tab", { name: "Consent history" }).click();
  await expect(page.getByRole("tabpanel").getByRole("listitem").first().getByText("Did not override withdrawal", { exact: true })).toBeVisible();
  await expect(page.getByText("Marketing preferences").locator("../..")).toContainText("Withdrawn");
  await matrix(page, "contact-detail");
  expect((await page.request.post(api, { headers: { origin }, data: { name: "Duplicate", email: `ADA-${marker}@example.test` } })).status()).toBe(409);
  await page.getByRole("link", { name: "All people", exact: true }).click();
  await expect(page.getByRole("link", { name: "Synthetic Ada Rivers", exact: true })).toBeVisible();
  await matrix(page, "contacts-list");
  await shellMatrix(page);

  await page.getByRole("searchbox", { name: "Search people" }).fill("no-such-contact");
  await page.getByRole("searchbox", { name: "Search people" }).press("Enter");
  await expect(page.getByRole("heading", { name: "No matching people" })).toBeVisible();
  await capture(page, "contacts-no-results-studio-dark");
  await page.getByRole("link", { name: "Reset view" }).click();
  await page.getByRole("link", { name: "Appearance", exact: true }).click();
  const harvestRadio = page.getByRole("radio", { name: "Studio Admin", exact: true });
  await expect(harvestRadio).toBeEnabled();
  await harvestRadio.focus();
  await expect(harvestRadio).toBeChecked();
  // One approved visual baseline; preserve the existing API preference contract.
  await expect(page.getByRole("radio")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Save appearance" })).toBeDisabled();
  expect((await page.request.patch(`/api/workspaces/${tenantId}/appearance`, { headers: { origin }, data: { brandTheme: "studio" } })).status()).toBe(200);
  await selectBrand(page, "Harvest");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-brand-theme", "harvest");
  await expect(page.locator("html")).toHaveAttribute("data-workspace-theme", "studio");
  await expect(page.getByRole("radio", { name: "Studio Admin", exact: true })).toBeChecked();
  await selectBrand(page, "Workspace default");
  await expect(page.locator("html")).toHaveAttribute("data-brand-theme", "studio");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-brand-theme", "studio");
  await matrix(page, "appearance");
  await page.getByRole("button", { name: "Account menu" }).click();
  await capture(page, "account-menu-studio-dark");
  await page.keyboard.press("Escape");
  // The server sends the tenant default in the blocking head script, independent of hydration.
  const html = await (await page.request.get(base)).text();
  expect(html).toContain('w="studio"');
  await page.goto(`${base}/${randomUUID()}`);
  await expect(page.getByRole("heading", { name: "Person not found" })).toBeVisible();
  await capture(page, "contact-not-found-studio-dark");
  // A second verified account exercises reader permissions and its own isolated workspace.
  const viewerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const viewer = await viewerContext.newPage();
  viewer.on("pageerror", (error) => pageErrors.push(error.message));
  await signIn(viewer, viewerEmail);
  expect((await page.request.put(`/api/workspaces/${tenantId}/members`, { headers: { origin }, data: { email: viewerEmail, role: "viewer" } })).status()).toBe(200);
  await viewer.goto(base);
  await expect(viewer.getByText("You have view-only access.", { exact: false })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Add person", exact: true })).toHaveCount(0);
  expect((await viewer.request.post(api, { headers: { origin }, data: { name: "Forbidden" } })).status()).toBe(403);
  expect((await viewer.request.patch(`${api}/${contactId}`, { headers: { origin }, data: { name: "Forbidden", version: 1 } })).status()).toBe(403);
  expect((await viewer.request.post(`${api}/${contactId}/consents`, { headers: { origin }, data: { purpose: "marketing", noticeVersion: "notice-v1", channel: "email", status: "granted", source: "Test", evidence: "Test" } })).status()).toBe(403);
  expect((await viewer.request.patch(`/api/workspaces/${tenantId}/appearance`, { headers: { origin }, data: { brandTheme: "harvest" } })).status()).toBe(403);
  expect((await viewer.request.post(`${api}/${contactId}/erase`, { headers: { origin }, data: { confirm: "erase" } })).status()).toBe(403);
  await capture(viewer, "contacts-viewer-studio-light");
  await viewer.goto("/workspaces");
  await viewer.getByLabel("Workspace name").fill("PR 01b isolated browser seed");
  await viewer.getByRole("button", { name: "Create workspace" }).click();
  await expect(viewer.getByText("PR 01b isolated browser seed", { exact: true })).toBeVisible();
  const otherWorkspaces = await (await viewer.request.get("/api/workspaces")).json();
  const other = otherWorkspaces.find((workspace: { name: string }) => workspace.name === "PR 01b isolated browser seed");
  await expect.poll(() => viewer.getByText("PR 01b isolated browser seed", { exact: true }).count()).toBe(1);
  expect(other).toBeTruthy();
  const foreignApi = `/api/workspaces/${other.tenantId}/contacts`;
  expect((await page.request.get(foreignApi)).status()).toBe(403);
  expect((await page.request.get(`${foreignApi}/${contactId}`)).status()).toBe(403);
  expect((await page.request.post(foreignApi, { headers: { origin }, data: { name: "Forbidden" } })).status()).toBe(403);
  expect((await page.request.patch(`${foreignApi}/${contactId}`, { headers: { origin }, data: { name: "Forbidden", version: 1 } })).status()).toBe(403);
  expect((await page.request.post(`${foreignApi}/${contactId}/consents`, { headers: { origin }, data: consentData })).status()).toBe(403);
  expect((await page.request.post(`${foreignApi}/${contactId}/erase`, { headers: { origin }, data: { confirm: "erase" } })).status()).toBe(403);
  expect((await page.request.patch(`/api/workspaces/${other.tenantId}/appearance`, { headers: { origin }, data: { brandTheme: "studio" } })).status()).toBe(403);
  expect((await viewer.request.get(`/api/workspaces/${other.tenantId}/contacts/${contactId}`)).status()).toBe(404);
  await page.goto(`/workspaces/${other.tenantId}/contacts`);
  await expect(page.getByRole("heading", { name: "Workspace access denied" })).toBeVisible();
  await capture(page, "contacts-unauthorized-harvest-dark");
  await viewerContext.close();
  await page.goto(detail);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const brand of ["harvest", "studio"] as const) for (const mode of ["light", "dark"] as const) {
    await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeVisible();
    await theme(page, brand, mode);
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await capture(page, `contact-detail-mobile-${brand}-${mode}`);
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    const people = page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("link", { name: "People", exact: true });
    await expect(people).toBeVisible();
    await people.click();
    await expect(page).toHaveURL(`${origin}${base}`);
    await expect(page.getByRole("heading", { name: /^People/ })).toBeVisible();
    await capture(page, `contacts-list-mobile-${brand}-${mode}`);
    await page.getByRole("link", { name: /^Synthetic Ada Rivers/ }).click();
    await expect(page.getByRole("heading", { name: "Synthetic Ada Rivers", exact: true })).toBeVisible();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Real 21-contact pagination: the existing contact plus twenty persisted records.
  for (let index = 0; index < 20; index++) expect((await page.request.post(api, { headers: { origin }, data: { name: `Synthetic page ${String(index).padStart(2, "0")}` } })).status()).toBe(201);
  await page.goto(base);
  await expect(page.getByRole("row")).toHaveCount(21);
  await expect(page.getByRole("link", { name: "Page 1", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Go to next page" }).click();
  await expect(page.getByRole("row")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Page 2", exact: true })).toHaveAttribute("aria-current", "page");
  await capture(page, "contacts-pagination-studio-dark");
  await page.getByRole("link", { name: "Go to previous page" }).click();
  await expect(page.getByRole("row")).toHaveCount(21);
  await expect(page.getByRole("link", { name: "Page 1", exact: true })).toHaveAttribute("aria-current", "page");
  await page.goto(detail);
  await page.getByRole("button", { name: "Erase contact", exact: true }).click();
  await capture(page, "contact-erasure-dialog-studio-dark");
  await page.getByRole("button", { name: "Erase personal data", exact: true }).click();
  await expect(page).toHaveURL(`${origin}${base}`);
  await expect(page.getByRole("link", { name: "Synthetic Ada Rivers", exact: true })).toHaveCount(0);
  expect((await page.request.get(`${api}/${contactId}`)).status()).toBe(404);
  await capture(page, "contacts-after-erasure-studio-dark");
  await page.getByRole("button", { name: "Account menu" }).click();
  await writeFile(`${evidence}/contrast-results.json`, `${JSON.stringify({ unselectedRadio: radioContrast, shellSurfaces }, null, 2)}\n`);
  await writeFile(`${evidence}/axe-results.json`, `${JSON.stringify(accessibility, null, 2)}\n`);
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto(detail); await expect(page).toHaveURL(/\/sign-in$/);
  expect((await page.request.get(api)).status()).toBe(401);
  expect(pageErrors).toEqual([]);
});
