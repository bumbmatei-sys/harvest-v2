import { mkdir, readFile } from "node:fs/promises";
import { Client } from "pg";
import { expect as playwrightExpect, test, type Browser, type Page } from "./helpers/test";
import AxeBuilder from "@axe-core/playwright";
import { signIn, origin } from "./helpers/session";

// Kit PR 2: the ministry switcher lives in the profile-picture (account) menu.
const expect = playwrightExpect.configure({ timeout: 15_000 });
const evidence = "docs/screenshots/kit-pr2";
test.use({ actionTimeout: 30_000, reducedMotion: "reduce" });

async function createMinistry(page: Page, name: string) {
  const response = await page.request.post("/api/workspaces", { headers: { origin }, data: { audience: "church", name } });
  expect(response.status()).toBe(201);
  return (await response.json()).tenantId as string;
}
async function openAccountMenu(page: Page) {
  const account = page.getByRole("button", { name: "Account menu", exact: true });
  if (!(await account.isVisible())) await page.locator('[data-shell-header] [data-sidebar="trigger"]').click();
  await account.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}
const ministryItem = (page: Page, name: string) => page.getByRole("menuitem").filter({ has: page.locator("[data-workspace-name]", { hasText: name }) });
async function guest(browser: Browser) {
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  const email = await signIn(page);
  return { context, page, email };
}

test("ministry switcher in the account menu: list, current, roles, members, navigation, keyboard", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const grace = await createMinistry(page, "Grace Church");
  const hope = await createMinistry(page, "Hope Outreach");
  // A second person joins Grace Church as an admin, so the role and the member count differ per ministry.
  const other = await guest(browser);
  const added = await page.request.put(`/api/workspaces/${grace}/members`, { headers: { origin }, data: { email: other.email, role: "admin" } });
  expect(added.status()).toBe(200);

  await page.goto(`/workspaces/${grace}/crm/people`);
  const navigation = page.getByRole("navigation", { name: "Ministry navigation" });
  await expect(navigation.getByRole("link", { name: "Ministries", exact: true })).toBeVisible();
  await expect(navigation.locator("[data-workspace-name]")).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: /^Switch ministry/ })).toHaveCount(0);
  // The header slots render nothing unless a page passes them.
  await expect(page.locator("[data-shell-header-search], [data-shell-header-actions]")).toHaveCount(0);

  const menu = await openAccountMenu(page);
  await expect(menu.getByRole("searchbox")).toHaveCount(0);
  const current = ministryItem(page, "Grace Church"), other1 = ministryItem(page, "Hope Outreach");
  await expect(current).toHaveAttribute("aria-current", "true");
  await expect(current).toContainText("Owner · 2 members");
  await expect(current.locator('[data-slot="avatar"]')).toHaveText("GC");
  await expect(current.locator("svg.lucide-check")).toHaveCount(1);
  await expect(other1).not.toHaveAttribute("aria-current", "true");
  await expect(other1).toContainText("Owner · 1 member");
  await expect(other1.locator("svg.lucide-check")).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "Your ministries", exact: true })).toHaveAttribute("href", "/workspaces");
  await expect(menu.getByRole("menuitem", { name: "Create a ministry", exact: true })).toHaveAttribute("href", "/workspaces#create-workspace");
  await page.screenshot({ path: `${evidence}/switcher-desktop.png` });
  // Selecting navigates exactly like the old switcher: to the ministry's people list.
  await other1.click();
  await expect(page).toHaveURL(new RegExp(`/workspaces/${hope}/crm/people$`));
  await expect(page.getByRole("menu")).toHaveCount(0);

  // Keyboard: Enter opens, ArrowDown reaches the first ministry, type-ahead jumps by name, Escape returns focus.
  const account = page.getByRole("button", { name: "Account menu", exact: true });
  await account.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(ministryItem(page, "Grace Church")).toBeFocused();
  await page.keyboard.type("h");
  await expect(ministryItem(page, "Hope Outreach")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(account).toBeFocused();

  // Other person: role label comes from their own membership.
  await other.page.goto(`/workspaces/${grace}/crm/people`);
  const otherMenu = await openAccountMenu(other.page);
  await expect(ministryItem(other.page, "Grace Church")).toContainText("Admin · 2 members");
  await expect(otherMenu.getByRole("menuitem", { name: /Hope Outreach/ })).toHaveCount(0);
  await other.context.close();
});

test("ministry search appears only above five ministries, filters and is keyboard operable", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const names = ["Alpha Church", "Bethel Mission", "Cedar Outreach", "Delta Fellowship", "Eden Chapel"];
  let first = "";
  for (const name of names) { const id = await createMinistry(page, name); first ||= id; }
  await page.goto(`/workspaces/${first}/crm/people`);
  // Five ministries: all listed in the menu, no search.
  let menu = await openAccountMenu(page);
  await expect(menu.getByRole("menuitem").filter({ has: page.locator("[data-workspace-name]") })).toHaveCount(5);
  await expect(menu.getByRole("menuitem", { name: "Switch ministry", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await createMinistry(page, "Fountain Parish");
  await page.reload();
  // Six ministries: the menu shows the current one and a Switch ministry item; the search lives in a dialog.
  menu = await openAccountMenu(page);
  await expect(menu.getByRole("menuitem").filter({ has: page.locator("[data-workspace-name]") })).toHaveCount(1);
  await expect(ministryItem(page, "Alpha Church")).toHaveAttribute("aria-current", "true");
  await expect(menu.getByRole("searchbox")).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Switch ministry", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Switch ministry" });
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole("combobox", { name: "Search ministries" });
  await expect(search).toBeFocused();
  const options = dialog.getByRole("option");
  await expect(options).toHaveCount(6);
  await expect(options.filter({ hasText: "Alpha Church" }).locator("svg.lucide-check")).toHaveCount(1);
  await expect(options.first()).toContainText("Owner · 1 member");
  await page.screenshot({ path: `${evidence}/switcher-search-desktop.png` });
  await page.keyboard.type("bet");
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText("Bethel Mission");
  await search.fill("zzz");
  await expect(dialog.getByText("No ministries found", { exact: true })).toBeVisible();
  await search.fill("");
  await expect(options).toHaveCount(6);
  // Escape closes the dialog and focus returns to the avatar button.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const account = page.getByRole("button", { name: "Account menu", exact: true });
  await expect(account).toBeFocused();
  // Type, arrow to a result and press Enter: navigates to that ministry's people list.
  await account.press("Enter");
  await page.getByRole("menuitem", { name: "Switch ministry", exact: true }).click();
  await page.getByRole("combobox", { name: "Search ministries" }).fill("fount");
  await page.keyboard.press("Enter");
  await expect(page).not.toHaveURL(new RegExp(first));
  await expect(page).toHaveURL(/\/workspaces\/.+\/crm\/people$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Fountain Parish", exact: true })).toBeVisible();
});

test("switcher: 44px targets, axe and no overflow at five widths in light and dark; phone sheet closes on select", async ({ page }) => {
  test.setTimeout(480_000);
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  let current = "";
  for (const name of ["Alpha Church", "Bethel Mission", "Cedar Outreach", "Delta Fellowship", "Eden Chapel", "Fountain Parish", "A deliberately long ministry name that has to truncate inside the account menu panel"]) { const id = await createMinistry(page, name); current ||= id; }
  const axe = async () => expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  for (const width of [360, 390, 768, 1280, 1440]) for (const mode of ["light", "dark"]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspaces/${current}/crm/people`);
    await page.evaluate((value) => localStorage.setItem("harvest-color-mode", value), mode);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    const phone = width < 1024, floor = phone ? 44 : 28;
    const menu = await openAccountMenu(page);
    for (const target of await menu.getByRole("menuitem").all()) expect((await target.boundingBox())!.height, `${width} ${mode} menu item`).toBeGreaterThanOrEqual(floor);
    const panel = (await menu.boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0); expect(panel.x + panel.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await axe();
    if (width === 360 || width === 1440) await page.screenshot({ path: `${evidence}/switcher-menu-${width}-${mode}.png` });
    await menu.getByRole("menuitem", { name: "Switch ministry", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Switch ministry" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("option")).toHaveCount(7);
    const field = (await dialog.getByRole("combobox", { name: "Search ministries" }).boundingBox())!;
    expect(field.height, `${width} ${mode} search field`).toBeGreaterThanOrEqual(phone ? 44 : 36);
    for (const option of await dialog.getByRole("option").all()) expect((await option.boundingBox())!.height, `${width} ${mode} option`).toBeGreaterThanOrEqual(floor);
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    const label = dialog.getByRole("option").filter({ hasText: "A deliberately long" }).locator("[data-workspace-name]");
    expect(await label.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await axe();
    if (width === 360 || width === 1440) await page.screenshot({ path: `${evidence}/switcher-search-${width}-${mode}.png` });
    if (width === 390 && mode === "light") {
      // On a phone the menu sits inside the sidebar sheet; choosing a ministry navigates and closes the sheet.
      await dialog.getByRole("option").filter({ hasText: "Bethel Mission" }).click();
      await expect(page).not.toHaveURL(new RegExp(current));
      await expect(page).toHaveURL(/\/workspaces\/.+\/crm\/people$/);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    } else { await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); }
  }
});

test("account menu for a person with no ministry passes axe and offers the create and all-ministries links", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);
  for (const width of [360, 390, 768, 1280, 1440]) for (const mode of ["light", "dark"]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/workspaces");
    await page.evaluate((value) => localStorage.setItem("harvest-color-mode", value), mode);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    const menu = await openAccountMenu(page);
    await expect(menu.getByRole("menuitem", { name: "No ministries yet", exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(menu.getByRole("menuitem", { name: "Create a ministry", exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Switch ministry" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await page.keyboard.press("Escape");
  }
});

test("the switcher counts everyone with access and names the collaborator and guest roles", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const grace = await createMinistry(page, "Grace Church");
  const partner = await guest(browser), visitor = await guest(browser);
  // Collaborators and guests join by accepting an invitation; the accepted rows are written directly here.
  const admin = new Client({ connectionString: await readFile(`${process.env.HARVEST_E2E_MAILBOX}.admin`, "utf8") });
  await admin.connect();
  try {
    for (const [person, role] of [[partner, "collaborator"], [visitor, "guest"]] as const)
      await admin.query("insert into workspace_members (tenant_id, user_id, role_id) select $1, id, $3 from users where email = $2", [grace, person.email, role]);
  } finally { await admin.end(); }
  await page.goto("/workspaces");
  // The menu opens only once the shell has hydrated (the first visit compiles the page).
  await expect(page.locator('[data-hydrated="true"]')).toHaveCount(1);
  await openAccountMenu(page);
  await expect(ministryItem(page, "Grace Church")).toContainText("Owner · 3 members");
  for (const [person, label] of [[partner, "Collaborator"], [visitor, "Guest"]] as const) {
    await person.page.setViewportSize({ width: 1280, height: 900 });
    await person.page.goto("/workspaces");
    await expect(person.page.getByText(`Role: ${label.toLowerCase()}`, { exact: true })).toBeVisible();
    await expect(person.page.locator('[data-hydrated="true"]')).toHaveCount(1);
    await openAccountMenu(person.page);
    await expect(ministryItem(person.page, "Grace Church")).toContainText(`${label} · 3 members`);
    await person.context.close();
  }
});
