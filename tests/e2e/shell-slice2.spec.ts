import { mkdir } from "node:fs/promises";
import { expect as playwrightExpect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signIn, origin } from "./helpers/session";

// Shell slice 2: the three-mode switcher and per-mode sidebar. Flag-off parity runs this file with HARVEST_SHELL_MODES=disabled.
const expect = playwrightExpect.configure({ timeout: 15_000 });
const evidence = "docs/screenshots/shell-slice2";
const off = process.env.HARVEST_SHELL_MODES === "disabled";
test.use({ actionTimeout: 30_000, reducedMotion: "reduce" });

async function createMinistry(page: Page, name: string) {
  const response = await page.request.post("/api/workspaces", { headers: { origin }, data: { audience: "church", name } });
  expect(response.status()).toBe(201);
  return (await response.json()).tenantId as string;
}
async function guest(browser: Browser) {
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  const email = await signIn(page);
  return { context, page, email };
}
const tablist = (page: Page) => page.getByRole("tablist", { name: "Menu mode" });
const tab = (page: Page, name: string) => tablist(page).getByRole("tab", { name, exact: true });
const nav = (page: Page) => page.getByRole("navigation", { name: /^Ministry navigation/ });
async function openDrawer(page: Page) {
  const trigger = page.locator('[data-shell-header] [data-sidebar="trigger"]');
  await trigger.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  return drawer;
}
async function setColorMode(page: Page, mode: string, url: string) {
  await page.goto(url);
  await page.evaluate((value) => localStorage.setItem("harvest-color-mode", value), mode);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
}
const axe = async (page: Page) => expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

test("flag off: the single sidebar renders exactly as before", async ({ page }) => {
  test.skip(!off, "parity run uses HARVEST_SHELL_MODES=disabled");
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const id = await createMinistry(page, "Grace Church");
  await page.goto(`/workspaces/${id}/crm/people`);
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  await expect(tablist(page)).toHaveCount(0);
  await expect(page.locator("[data-shell-mode]")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Ministry navigation", exact: true })).toBeVisible();
  await expect(nav(page).getByRole("link", { name: "Communities", exact: true })).toBeVisible();
  await expect(nav(page).getByRole("link", { name: "Ministries", exact: true })).toBeVisible();
});

test("mode switcher: tabs, choosing a mode does not navigate, owning mode, persistence, keyboard", async ({ page }) => {
  test.skip(off, "flag off");
  test.setTimeout(240_000);
  await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const id = await createMinistry(page, "Grace Church");
  const people = `/workspaces/${id}/crm/people`;
  await page.goto(people);
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();

  // Operations and Public only: Assistant has no live entry, so it is hidden rather than shown broken.
  await expect(tablist(page).getByRole("tab")).toHaveText(["Operations", "Public"]);
  await expect(tab(page, "Operations")).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, "Public")).toHaveAttribute("aria-selected", "false");
  await expect(page.getByRole("tab", { name: "Assistant" })).toHaveCount(0);
  await expect(tab(page, "Public")).toHaveAttribute("aria-controls", "shell-mode-navigation");
  await expect(nav(page)).toHaveAccessibleName("Ministry navigation: Operations");
  await expect(nav(page).getByRole("link", { name: "People", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(nav(page).getByRole("link", { name: "Ministries", exact: true })).toBeVisible();
  await expect(nav(page).getByRole("link", { name: "Communities", exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${evidence}/desktop-1280-operations-light.png` });

  // Choosing a mode swaps the sidebar and announces it; the page and URL stay.
  await tab(page, "Public").click();
  await expect(page).toHaveURL(new RegExp(`${people}$`));
  await expect(tab(page, "Public")).toHaveAttribute("aria-selected", "true");
  await expect(nav(page)).toHaveAccessibleName("Ministry navigation: Public");
  await expect(nav(page).getByRole("link", { name: "Communities", exact: true })).toBeVisible();
  await expect(nav(page).getByRole("link", { name: "People", exact: true })).toHaveCount(0);
  await expect(nav(page).getByRole("link", { name: "Ministries", exact: true })).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Public menu");
  await expect(page.locator("[data-shell-header]").getByText("People", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${evidence}/desktop-1280-public-light.png` });
  expect(await page.evaluate(() => localStorage.getItem("harvest.shell.mode"))).toBe("public");

  // Navigating to a page that owns its path returns to the owning mode, whatever was chosen.
  await nav(page).getByRole("link", { name: "Communities", exact: true }).click();
  await expect(page).toHaveURL(/\/communities$/);
  await expect(tab(page, "Public")).toHaveAttribute("aria-selected", "true");
  await page.goto(`/workspaces/${id}/settings`);
  await expect(tab(page, "Operations")).toHaveAttribute("aria-selected", "true");
  await expect(nav(page).getByRole("link", { name: "Ministry settings", exact: true })).toHaveAttribute("aria-current", "page");
  // On such a page the switcher only previews the other sidebar: the page stays and the owning mode returns on the next navigation.
  await tab(page, "Public").click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(nav(page).getByRole("link", { name: "Communities", exact: true })).toBeVisible();
  await expect(page.locator("[data-shell-header]").getByText("Ministry settings", { exact: true })).toBeVisible();
  await page.goto(`/workspaces/${id}/appearance`);
  await expect(tab(page, "Operations")).toHaveAttribute("aria-selected", "true");
  await page.goto(`/workspaces/${id}/crm/settings/fields`);
  await expect(tab(page, "Operations")).toHaveAttribute("aria-selected", "true");

  // Every ministry page today owns its path, so the remembered choice (read for neutral pages only) has no visible effect yet; it is stored for the ministry home.
  await page.goto(`/workspaces/${id}/crm/people`);
  await expect(tab(page, "Operations")).toHaveAttribute("aria-selected", "true");
  // Storage that fails to read or write never breaks the shell.
  await page.addInitScript(() => { Storage.prototype.getItem = () => { throw new Error("blocked"); }; Storage.prototype.setItem = () => { throw new Error("blocked"); }; });
  await page.goto(`/workspaces/${id}/crm/people`);
  await expect(tab(page, "Operations")).toHaveAttribute("aria-selected", "true");
  await tab(page, "Public").click();
  await expect(nav(page).getByRole("link", { name: "Communities", exact: true })).toBeVisible();
});

test("mode switcher keyboard: arrows, Home/End and Ctrl/Cmd+Alt shortcuts", async ({ page }) => {
  test.skip(off, "flag off");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const id = await createMinistry(page, "Grace Church");
  await page.goto(`/workspaces/${id}/crm/people`);
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  await tab(page, "Operations").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Public")).toBeFocused();
  await expect(tab(page, "Public")).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/\/crm\/people$/);
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Operations")).toBeFocused();
  await page.keyboard.press("End");
  await expect(tab(page, "Public")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tab(page, "Operations")).toBeFocused();
  await expect(tab(page, "Operations")).toHaveAttribute("aria-selected", "true");
  // Roving tabindex: only the selected tab is in the Tab order.
  await expect(tab(page, "Public")).toHaveAttribute("tabindex", "-1");

  // Shortcuts select a mode and move focus to the first item of its sidebar; Alt+3 does nothing while Assistant is hidden.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Control+Alt+Digit2");
  await expect(tab(page, "Public")).toHaveAttribute("aria-selected", "true");
  await expect(nav(page).getByRole("link", { name: "Communities", exact: true })).toBeFocused();
  await page.keyboard.press("Control+Alt+Digit3");
  await expect(tab(page, "Public")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Meta+Alt+Digit1");
  await expect(tab(page, "Operations")).toHaveAttribute("aria-selected", "true");
  await expect(nav(page).getByRole("link", { name: "Ministries", exact: true })).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("Operations menu");
  // Ctrl/Cmd+B still toggles the sidebar.
  await page.keyboard.press("Control+b");
  await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toHaveCount(1);
});

test("icon rail: icons only with tooltips, vertical tablist", async ({ page }) => {
  test.skip(off, "flag off");
  test.setTimeout(180_000);
  await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const id = await createMinistry(page, "Grace Church");
  await page.goto(`/workspaces/${id}/crm/people`);
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  await page.locator('[data-shell-header] [data-sidebar="trigger"]').click();
  await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toHaveCount(1);
  await expect(tablist(page)).toHaveAttribute("aria-orientation", "vertical");
  for (const name of ["Operations", "Public"]) {
    const box = (await tab(page, name).boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(32);
    expect((await tab(page, name).getByText(name, { exact: true }).boundingBox())!.width).toBeLessThanOrEqual(1);
  }
  await tab(page, "Public").hover();
  await expect(page.getByRole("tooltip")).toHaveText("Public (Ctrl/Cmd+Alt+2)");
  await page.screenshot({ path: `${evidence}/desktop-1280-rail-operations-light.png` });
  await tab(page, "Public").press("ArrowUp");
  await expect(tab(page, "Operations")).toBeFocused();
  await tab(page, "Public").click();
  await expect(nav(page).getByRole("link", { name: "Communities", exact: true })).toBeVisible();
  await page.screenshot({ path: `${evidence}/desktop-1280-rail-public-light.png` });
  await axe(page);
});

test("five widths, light and dark: axe, no overflow, 44px targets below 1024px, drawer switcher", async ({ page }) => {
  test.skip(off, "flag off");
  test.setTimeout(480_000);
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  const id = await createMinistry(page, "Grace Church");
  const people = `/workspaces/${id}/crm/people`;
  for (const width of [360, 390, 768, 1280, 1440]) for (const mode of ["light", "dark"]) {
    await page.setViewportSize({ width, height: 900 });
    await setColorMode(page, mode, people);
    await page.evaluate(() => localStorage.removeItem("harvest.shell.mode"));
    await page.reload();
    const phone = width < 1024;
    if (phone) {
      const drawer = await openDrawer(page);
      await expect(drawer.getByRole("tablist", { name: "Menu mode" })).toBeVisible();
      for (const name of ["Operations", "Public"]) {
        const box = (await drawer.getByRole("tab", { name, exact: true }).boundingBox())!;
        expect(box.height, `${width} ${mode} ${name} tab`).toBeGreaterThanOrEqual(44);
      }
      for (const link of await drawer.getByRole("link").all()) expect((await link.boundingBox())!.height, `${width} ${mode} drawer link`).toBeGreaterThanOrEqual(44);
      await axe(page);
      if (width === 360) await page.screenshot({ path: `${evidence}/phone-360-drawer-operations-${mode}.png` });
      await drawer.getByRole("tab", { name: "Public", exact: true }).click();
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("navigation", { name: "Ministry navigation: Public" }).getByRole("link", { name: "Communities", exact: true })).toBeVisible();
      for (const link of await drawer.getByRole("navigation").getByRole("link").all()) expect((await link.boundingBox())!.height, `${width} ${mode} public link`).toBeGreaterThanOrEqual(44);
      await axe(page);
      if (width === 360) await page.screenshot({ path: `${evidence}/phone-360-drawer-public-${mode}.png` });
      // Following a link closes the drawer as before.
      await drawer.getByRole("link", { name: "Communities", exact: true }).click();
      await expect(page).toHaveURL(/\/communities$/);
      await expect(drawer).toHaveCount(0);
    } else {
      await expect(tablist(page)).toBeVisible();
      for (const name of ["Operations", "Public"]) await expect(tab(page, name).getByText(name, { exact: true })).toBeVisible();
      await axe(page);
      if (width === 1280) await page.screenshot({ path: `${evidence}/desktop-1280-operations-${mode}.png` });
      await tab(page, "Public").click();
      await axe(page);
      if (width === 1280) await page.screenshot({ path: `${evidence}/desktop-1280-public-${mode}.png` });
    }
    expect(await overflow(page), `${width} ${mode}`).toBeLessThanOrEqual(0);
  }
});

test("role matrix: every role sees only modes with visible entries and today's items", async ({ page, browser }) => {
  test.skip(off, "flag off");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const id = await createMinistry(page, "Grace Church");
  const people: Record<string, Page> = { owner: page };
  const contexts = [];
  for (const role of ["admin", "member", "viewer"]) {
    const other = await guest(browser); contexts.push(other.context);
    await other.page.setViewportSize({ width: 1280, height: 900 });
    expect((await page.request.put(`/api/workspaces/${id}/members`, { headers: { origin }, data: { email: other.email, role } })).status()).toBe(200);
    people[role] = other.page;
  }
  for (const [role, view] of Object.entries(people)) {
    await view.goto(`/workspaces/${id}/crm/people`);
    await expect(view.locator("[data-hydrated=true]")).toBeVisible();
    await expect(tablist(view).getByRole("tab"), role).toHaveText(["Operations", "Public"]);
    await expect(view.getByRole("tab", { name: "Assistant" })).toHaveCount(0);
    await expect(nav(view).getByRole("link", { name: "Imports", exact: true }), role).toHaveCount(role === "viewer" ? 0 : 1);
    await expect(nav(view).getByRole("link", { name: "Ministry settings", exact: true })).toHaveCount(1);
    await tab(view, "Public").click();
    await expect(nav(view).getByRole("link", { name: "Communities", exact: true }), role).toBeVisible();
  }
  for (const context of contexts) await context.close();
});

test("showcase: all three modes, tablist keys and 44px targets (Assistant is hidden in the real shell until it has entries)", async ({ page }) => {
  test.skip(process.env.HARVEST_UI_SHOWCASE !== "1", "the showcase is development-only");
  test.setTimeout(180_000);
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  for (const [width, mode] of [[1280, "light"], [1280, "dark"], [360, "light"], [360, "dark"]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await setColorMode(page, mode, "/dev/ui");
    await page.getByRole("combobox", { name: "Component category", exact: true }).selectOption("shell");
    const example = page.locator("[data-mode-switcher-example]");
    await expect(example).toBeVisible();
    const tabs = example.getByRole("tab");
    await expect(tabs).toHaveText(["Operations", "Public", "Assistant"]);
    if (width < 1024) for (const item of await tabs.all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await tabs.first().click();
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(tabs.nth(2)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(tabs.first()).toBeFocused();
    await tabs.nth(2).click();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await axe(page);
    await example.screenshot({ path: `${evidence}/showcase-three-modes-${width}-${mode}.png` });
  }
});
