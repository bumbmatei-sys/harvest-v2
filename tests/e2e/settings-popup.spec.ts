import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect as check, test, type Browser, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// Settings pop-up (profile menu) and the regrouped sidebar. Screenshots are written only when HARVEST_SHOTS_DIR is set.
test.use({ actionTimeout: 20_000, reducedMotion: "reduce" });
const expect = check.configure({ timeout: 30_000 });
const shots = process.env.HARVEST_SHOTS_DIR;
const headers = { origin };

const dialog = (page: Page) => page.getByRole("dialog", { name: "Settings", exact: true });
const sections = (page: Page) => dialog(page).getByRole("navigation", { name: "Settings sections" });
const section = (page: Page, name: string) => sections(page).getByRole("button", { name, exact: true });
const sidebarNav = (page: Page) => page.getByRole("navigation", { name: /^Ministry navigation/ });

async function ready(page: Page) { await expect(page.locator("[data-hydrated=true]")).toBeVisible(); }
// A section is ready when its own control is on screen and nothing is loading: no skeleton and no busy region.
async function sectionReady(page: Page, name: string) {
  const panel = dialog(page).locator("[data-settings-content]");
  await expect(panel.getByRole("heading", { name, level: 2, exact: true })).toBeVisible();
  const control: Record<string, Locator> = {
    Profile: panel.getByLabel("Display name"), Account: panel.getByLabel("Name", { exact: true }),
    "Ministry details": panel.getByRole("radio", { name: "Church", exact: true }), Connections: panel.getByText("No accounts connected"),
    CRM: panel.getByRole("link", { name: "CRM fields", exact: true }),
  };
  await expect(control[name]).toBeVisible();
  await expect(panel.locator('[data-slot="skeleton"], [aria-busy="true"]')).toHaveCount(0);
}
async function openFromMenu(page: Page) {
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}
async function audit(page: Page, name: string, scheme: string, kind: string) {
  await settleForAxe(page);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations, `${name} ${scheme} ${kind}`).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${scheme} ${kind} horizontal scroll`).toBe(true);
  if (shots) await page.screenshot({ path: `${shots}/settings-${name.toLowerCase().replace(/ /g, "-")}-${kind}-${scheme}.png`, animations: "disabled" });
}
async function member(browser: Browser, tenant: string, owner: Page, role: string) {
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage(), email = await signIn(page);
  expect((await owner.request.put(`/api/workspaces/${tenant}/members`, { headers, data: { email, role } })).status()).toBe(200);
  return { context, page };
}

test("Settings pop-up: open, sections by role, keyboard, deep link, Planner entry, phone sheet, axe, sidebar regroup", async ({ page, browser }) => {
  test.setTimeout(600_000);
  if (shots) mkdirSync(shots, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  expect((await page.request.put("/api/account/profile", { headers, data: { name: "Pastor Daniel Brooks", locale: null, cityRegion: null } })).ok()).toBe(true);
  const tenant = (await (await page.request.post("/api/workspaces", { headers, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const slug = `settings-${randomUUID().slice(0, 8)}`, endpoint = `/api/workspaces/${tenant}/communities`;
  const community = await (await page.request.post(endpoint, { headers, data: { name: "Bible Study", slug } })).json();
  const patched = await (await page.request.patch(`${endpoint}/${community.id}`, { headers, data: { version: community.version, visibility: "listed", allowOpen: true } })).json();
  expect((await page.request.post(`${endpoint}/${community.id}/publish`, { headers, data: { version: patched.version, published: true } })).ok()).toBe(true);
  await page.goto(`/communities/${slug}`);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  const join = page.getByRole("dialog", { name: /^Join / });
  await join.getByLabel("I confirm I am 18 or older").click();
  await join.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page.getByRole("link", { name: "Members", exact: true })).toBeVisible();

  // ---- Sidebar regroup: no Settings group, no settings rows, every built route still reachable ----------------------------------------------
  const base = `/workspaces/${tenant}`;
  await page.goto(`${base}/crm/people`); await ready(page);
  const nav = sidebarNav(page);
  for (const group of ["Office", "People", "Connect", "Ministry"]) await expect(nav.getByRole("button", { name: group, exact: true })).toBeVisible();
  for (const hidden of ["Settings", "Giving"]) await expect(nav.getByRole("button", { name: hidden, exact: true })).toHaveCount(0);
  for (const hidden of ["CRM fields", "Pipeline settings", "Appearance", "Ministry settings", "Social accounts"]) await expect(nav.getByRole("link", { name: hidden, exact: true })).toHaveCount(0);
  for (const shown of ["Storage", "People", "Organizations", "Pipelines", "Tasks", "Imports", "Follow-up", "Campaigns"]) await expect(nav.getByRole("link", { name: shown, exact: true })).toBeVisible();
  for (const path of ["/crm/settings/fields", "/crm/settings/pipelines", "/appearance", "/settings", "/social/accounts", "/files", "/campaigns", "/connect/follow-up"]) {
    const response = await page.goto(`${base}${path}`);
    expect(response?.status(), path).toBe(200);
    await ready(page);
    await expect(page.getByText(/not available|no access/i), path).toHaveCount(0);
  }

  // ---- Open from the profile menu; sections for an owner; the Profile form saves through the member-profile route ----------------------------
  await page.goto(`${base}/crm/people`); await ready(page);
  await openFromMenu(page);
  await expect(page).toHaveURL(/[?&]settings=profile/);
  await expect(dialog(page).getByText("You", { exact: true })).toBeVisible();
  await expect(dialog(page).getByText("Ministry", { exact: true })).toBeVisible();
  expect(await sections(page).getByRole("button").allInnerTexts()).toEqual(["Profile", "Account", "Ministry details", "Connections", "CRM"]);
  await expect(page.getByRole("button", { name: /^(Billing|Privacy and data)/ })).toHaveCount(0);
  await sectionReady(page, "Profile");
  await dialog(page).getByLabel("Display name").fill("Pastor Dan");
  await dialog(page).getByLabel("Bio").fill("Leads the Thursday Bible study.");
  await dialog(page).getByRole("button", { name: "Add link", exact: true }).click();
  await dialog(page).getByLabel("Link 1 label").fill("Church site");
  await dialog(page).getByLabel("Link 1 address").fill("https://example.org");
  await dialog(page).getByRole("radio", { name: /^Private/ }).check();
  await dialog(page).getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
  expect(await (await page.request.get(`/api/communities/${slug}/profile`)).json()).toMatchObject({ displayName: "Pastor Dan", visibility: "private", links: [{ label: "Church site", url: "https://example.org" }] });
  await dialog(page).getByLabel("Link 1 address").fill("http://insecure.example");
  await dialog(page).getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("https://");
  // The invalid draft is still unsaved: the pop-up would ask before switching sections, so drop it here (the guard has its own spec).
  await page.locator('[data-slot="sticky-save-bar"]').getByRole("button", { name: "Discard", exact: true }).click();

  // ---- Keyboard: arrows, Home and End move between sections and open them; Escape closes and returns focus ------------------------------------
  await section(page, "Profile").focus();
  await page.keyboard.press("ArrowDown");
  await expect(section(page, "Account")).toBeFocused(); await expect(section(page, "Account")).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("ArrowDown");
  await expect(section(page, "Ministry details")).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("End");
  await expect(section(page, "CRM")).toBeFocused(); await expect(page).toHaveURL(/[?&]settings=crm/);
  await page.keyboard.press("ArrowDown");
  await expect(section(page, "Profile")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(section(page, "CRM")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(section(page, "Profile")).toHaveAttribute("aria-current", "page");
  // Focus is trapped: Tab never leaves the dialog.
  for (let step = 0; step < 14; step += 1) { await page.keyboard.press("Tab"); expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true); }
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/settings=/);
  await expect(page.getByRole("button", { name: "Account menu", exact: true })).toBeFocused();

  // ---- Deep link; Connections embeds the social accounts; CRM links reach the existing pages --------------------------------------------------
  await page.goto(`${base}/crm/people?settings=connections`); await ready(page);
  await expect(dialog(page)).toBeVisible();
  await expect(section(page, "Connections")).toHaveAttribute("aria-current", "page");
  await sectionReady(page, "Connections");
  await expect(dialog(page).getByRole("button", { name: "Add test account", exact: true })).toBeVisible();
  await section(page, "CRM").click(); await sectionReady(page, "CRM");
  await dialog(page).getByRole("link", { name: "Pipeline settings", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/crm/settings/pipelines$`));
  await expect(dialog(page)).toHaveCount(0);
  await page.goto(`${base}/crm/people?settings=nonsense`); await ready(page);
  await expect(section(page, "Profile")).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");

  // ---- The Planner's Social accounts button opens Connections --------------------------------------------------------------------------------
  await page.goto(`${base}/social/planner`); await ready(page);
  await page.getByRole("link", { name: "Social accounts", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(page).toHaveURL(/social\/planner\?settings=connections/);
  await sectionReady(page, "Connections");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);

  // ---- Public sidebar: Social media, Newsletter, Website and Courses and products groups are live -------------------------------------------------------------------
  await page.getByRole("tab", { name: "Public", exact: true }).click();
  await expect(nav.getByRole("button", { name: "Social media", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Planner", exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Newsletter", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Campaigns", exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Website", exact: true })).toBeVisible(); // Link in bio (owners and admins)
  // Courses and products: live with the free catalogue (feature "catalog", on in tests, off in production).
  await expect(nav.getByRole("button", { name: "Courses and products", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Courses", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Products", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Audience", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Sign-up forms", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Sender", exact: true })).toBeVisible();

  // ---- Roles: a member and a viewer see only You --------------------------------------------------------------------------------------------
  for (const role of ["admin", "member", "viewer"]) {
    const other = await member(browser, tenant, page, role);
    await other.page.goto(`${base}/crm/people?settings=connections`); await ready(other.page);
    await expect(dialog(other.page)).toBeVisible();
    const names = await sections(other.page).getByRole("button").allInnerTexts();
    expect(names, role).toEqual(role === "admin" ? ["Profile", "Account", "Ministry details", "Connections", "CRM"] : ["Profile", "Account"]);
    // The non-production test credential travels only to staff: a member's page payload never carries it.
    expect((await other.page.content()).includes("harvest-test-credential"), `${role} payload carries the test credential`).toBe(role === "admin");
    if (role !== "admin") await expect(section(other.page, "Profile"), `${role} deep link falls back`).toHaveAttribute("aria-current", "page");
    await other.context.close();
  }

  // ---- Axe, no horizontal scroll and screenshots: every section, light and dark, desktop and phone ------------------------------------------------
  const session = await page.context().newCDPSession(page);
  const all: [string, string][] = [["profile", "Profile"], ["account", "Account"], ["ministry", "Ministry details"], ["connections", "Connections"], ["crm", "CRM"]];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const [kind, width, height] of [["desktop", 1280, 900], ["phone", 360, 800]] as const) {
      await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: false });
      await page.setViewportSize({ width, height });
      for (const [id, name] of all) {
        await page.goto(`${base}/crm/people?settings=${id}`); await ready(page);
        await page.evaluate((mode) => { document.documentElement.dataset.theme = mode; document.documentElement.classList.toggle("dark", mode === "dark"); }, scheme);
        await expect(dialog(page)).toBeVisible();
        await sectionReady(page, name);
        if (kind === "phone") {
          const box = await dialog(page).boundingBox();
          expect(Math.round(box!.width), `${name} sheet width`).toBe(360); expect(Math.round(box!.height), `${name} sheet height`).toBe(800);
          for (const button of await sections(page).getByRole("button").all()) expect((await button.boundingBox())!.height, `${name} tab row target`).toBeGreaterThanOrEqual(44);
          expect((await dialog(page).getByRole("button", { name: "Close" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
          expect(await sections(page).evaluate((node) => getComputedStyle(node).overflowX), "tab row scrolls sideways").toBe("auto");
        }
        await audit(page, name, scheme, kind);
      }
    }
  }
  await session.send("Emulation.clearDeviceMetricsOverride");
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 360, height: 800 });

  // ---- Phone: open from the profile menu inside the sidebar sheet ----------------------------------------------------------------------------
  await page.goto(`${base}/crm/people`); await ready(page);
  await page.getByRole("banner").getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByRole("dialog", { name: "Sidebar" }).getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Sidebar" })).toHaveCount(0);
  await sectionReady(page, "Profile");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});
