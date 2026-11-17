import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { expect as playwrightExpect, test, type Browser, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signIn, origin } from "./helpers/session";

// Shell slice 3a: the editing sidebar for the community editor (behind HARVEST_SHELL_MODES). Flag-off parity runs this file with HARVEST_SHELL_MODES=disabled.
const expect = playwrightExpect.configure({ timeout: 15_000 });
const evidence = "docs/screenshots/shell-slice3a";
const off = process.env.HARVEST_SHELL_MODES === "disabled";
test.use({ actionTimeout: 30_000, reducedMotion: "reduce" });

async function setup(page: Page) {
  await signIn(page);
  const ministry = await page.request.post("/api/workspaces", { headers: { origin }, data: { audience: "church", name: "Grace Church" } });
  expect(ministry.status()).toBe(201);
  const tenant = (await ministry.json()).tenantId as string;
  const slug = `grace-${randomUUID().slice(0, 8)}`;
  const created = await page.request.post(`/api/workspaces/${tenant}/communities`, { headers: { origin }, data: { name: "Grace Bible Study", slug } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id as string;
  return { tenant, id, slug, url: `/workspaces/${tenant}/communities/${id}/edit` };
}
/** Leave the community with no way to join, so Joining and Publish need attention. */
async function breakJoining(page: Page, tenant: string, id: string) {
  const endpoint = `/api/workspaces/${tenant}/communities/${id}`;
  const current = await (await page.request.get(endpoint)).json();
  expect((await page.request.patch(endpoint, { headers: { origin }, data: { version: current.version, allowInvite: false } })).status()).toBe(200);
}
async function member(browser: Browser, owner: Page, tenant: string, role: string) {
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const email = await signIn(page);
  expect((await owner.request.put(`/api/workspaces/${tenant}/members`, { headers: { origin }, data: { email, role } })).status()).toBe(200);
  return { context, page };
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
const sidebar = (page: Page) => page.getByRole("group", { name: /^Editing / });
const steps = (page: Page) => page.getByRole("navigation", { name: "Community setup" });
const heading = (page: Page, name: string) => page.getByRole("heading", { name, level: 2 });
const tab = (page: Page, name: string) => page.getByRole("tablist", { name: "Menu mode" }).getByRole("tab", { name, exact: true });
/** Visible interactive controls under 44px tall (touch targets). */
const short = (locator: Locator) => locator.evaluateAll((nodes) => nodes.filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43.5; }).map((n) => `${n.tagName} ${(n.textContent ?? "").trim().slice(0, 30)}`));
async function openDrawer(page: Page) {
  await page.locator('[data-shell-header] [data-sidebar="trigger"]').click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  return drawer;
}

test("flag off: the editor keeps its in-page step list and the single sidebar", async ({ page }) => {
  test.skip(!off, "parity run uses HARVEST_SHELL_MODES=disabled");
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { url } = await setup(page);
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Grace Bible Study", level: 1 })).toBeVisible();
  await expect(page.locator("[data-shell-editing]")).toHaveCount(0);
  await expect(page.locator("[data-editor-hosted]")).toHaveCount(0);
  await expect(page.locator("[data-slot='editor-step-bar']")).toHaveCount(0);
  await expect(page.getByRole("tablist", { name: "Menu mode" })).toHaveCount(0);
  await expect(page.locator("main").getByRole("navigation", { name: "Community setup" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Ministry navigation", exact: true }).getByRole("link", { name: "Communities", exact: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Preview" })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await page.locator("main aside[aria-label='Preview']").evaluate((node) => Math.round(node.getBoundingClientRect().width))).toBe(352);
  await expect(page.locator("[data-editor-preview-label]")).toHaveCount(0);
});

test("editing sidebar: swap, steps, back link, open page, mode switcher and preview", async ({ page }) => {
  test.skip(off, "flag off");
  test.setTimeout(240_000);
  await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  const { tenant, slug, url } = await setup(page);
  await page.goto(`/workspaces/${tenant}/communities`);
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  // The list page has the navigation sidebar.
  await expect(page.locator("[data-shell-editing]")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: /^Ministry navigation/ })).toBeVisible();
  await page.goto(url);
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();

  // Editing state: the entry list is replaced; the logo row and mode switcher stay.
  const side = sidebar(page);
  await expect(side).toBeVisible();
  await expect(side).toHaveAccessibleName("Editing Grace Bible Study");
  await expect(page.getByRole("navigation", { name: /^Ministry navigation/ })).toHaveCount(0);
  await expect(page.getByRole("tablist", { name: "Menu mode" })).toBeVisible();
  await expect(tab(page, "Public")).toHaveAttribute("aria-selected", "true");
  const back = side.getByRole("link", { name: "Back to Communities", exact: true });
  await expect(back).toHaveAttribute("href", `/workspaces/${tenant}/communities`);
  await expect(side.locator("[data-editor-title]")).toHaveText("Grace Bible Study");
  await expect(side.locator("[data-editor-status]")).toHaveText("Draft");
  await expect(side.getByText("Community", { exact: true })).toBeVisible();
  // No Open page link until the community is published.
  await expect(side.locator("[data-editor-open-page]")).toHaveCount(0);
  // The in-page step list is gone; the steps are one ordered list in the sidebar.
  await expect(page.locator("main").getByRole("navigation", { name: "Community setup" })).toHaveCount(0);
  const list = steps(page).getByRole("listitem");
  await expect(list).toHaveCount(9);
  await expect(steps(page).getByRole("button", { name: /Basics/ })).toHaveAttribute("aria-current", "step");
  await expect(steps(page).getByRole("button", { name: /Basics/ })).toContainText("Current step");
  await expect(steps(page).getByRole("button", { name: /Offer/ })).toContainText("Done");
  await expect(steps(page).getByRole("button", { name: /Joining/ })).toContainText("Done");
  await expect(steps(page).getByRole("button", { name: /Channels/ })).toContainText("Not started");
  for (const label of ["Messages", "Products", "Page"]) await expect(steps(page).getByRole("button", { name: new RegExp(label) })).toHaveAttribute("aria-disabled", "true");
  // The preview column is a labelled static slot from 1280px and the form keeps room.
  const preview = page.getByRole("complementary", { name: "Preview" });
  await expect(preview).toBeVisible();
  await expect(page.locator("[data-editor-preview-label]")).toHaveText("Preview");
  await expect(preview.getByText("Grace Bible Study")).toBeVisible();
  expect(await preview.evaluate((node) => Math.round(node.getBoundingClientRect().width))).toBe(352);
  expect(await page.locator("#community-name").evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(448);
  await page.screenshot({ path: `${evidence}/desktop-1280-editing-light.png` });

  // Selecting a step shows it and moves focus to its heading; no navigation, no guard.
  await steps(page).getByRole("button", { name: /Joining/ }).click();
  await expect(heading(page, "Joining")).toBeFocused();
  await expect(steps(page).getByRole("button", { name: /Joining/ })).toHaveAttribute("aria-current", "step");
  await expect(page).toHaveURL(new RegExp(`${url}$`));
  // A disabled step does nothing.
  await steps(page).getByRole("button", { name: /Messages/ }).focus();
  await page.keyboard.press("Enter");
  await expect(heading(page, "Joining")).toBeVisible();

  // The mode switcher stays and works: another mode previews its entries and the editor stays; the owning mode brings the item sidebar back.
  await tab(page, "Operations").click();
  await expect(page).toHaveURL(new RegExp(`${url}$`));
  await expect(side).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Ministry navigation: Operations" })).toBeVisible();
  await expect(heading(page, "Joining")).toBeVisible();
  await tab(page, "Public").click();
  await expect(sidebar(page)).toBeVisible();
  await expect(steps(page).getByRole("button", { name: /Joining/ })).toHaveAttribute("aria-current", "step");

  // Publish: the checklist lists what is missing, links to its step, and Publish stays off until it is done.
  const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
  await page.getByLabel("By invitation", { exact: true }).click();
  await expect(steps(page).getByRole("button", { name: /Joining/ })).toContainText("Needs attention");
  await steps(page).getByRole("button", { name: /Publish/ }).click();
  await expect(steps(page).getByRole("button", { name: /Publish/ })).toContainText("Needs attention");
  await expect(header.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
  const checklist = page.getByRole("list", { name: "Before you publish" });
  await expect(checklist.getByRole("button", { name: "Go to Joining" })).toHaveCount(1);
  await checklist.getByRole("button", { name: "Go to Joining" }).click();
  await expect(heading(page, "Joining")).toBeFocused();
  await page.getByLabel("By invitation", { exact: true }).click();
  await expect(steps(page).getByRole("button", { name: /Joining/ })).toContainText("Done");
  await expect(steps(page).getByRole("button", { name: /Publish/ })).not.toContainText("Needs attention");
  await steps(page).getByRole("button", { name: /Publish/ }).click();
  await expect(header.getByRole("button", { name: "Publish", exact: true })).toBeEnabled();
  await header.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  await expect(side.locator("[data-editor-status]")).toHaveText("Published");
  const open = side.getByRole("link", { name: "Open page", exact: true });
  await expect(open).toHaveAttribute("href", `/communities/${slug}`);
  await expect(open).toHaveAttribute("target", "_blank");
  await expect(open).toHaveAttribute("rel", /noopener/);
  await expect(steps(page).getByRole("button", { name: /Publish/ })).toContainText("Done");

  // The back link returns to the list; the editor context is cleared and the navigation sidebar returns.
  await back.click();
  await expect(page).toHaveURL(new RegExp(`/workspaces/${tenant}/communities$`));
  await expect(page.locator("[data-shell-editing]")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: /^Ministry navigation/ })).toBeVisible();
  // Going back in history shows the editor again with its sidebar.
  await page.goBack();
  await expect(sidebar(page)).toBeVisible();
});

test("leave guard: every exit path asks while dirty; steps and mode switches never do", async ({ page }) => {
  test.skip(off, "flag off");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const { tenant, url } = await setup(page);
  await page.goto(url);
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  const dialog = page.getByRole("alertdialog", { name: "Leave without saving?" });
  await expect(sidebar(page).getByText("Unsaved changes")).toHaveCount(0);
  // Clean: leaving does not ask.
  await page.getByLabel("Tagline (optional)", { exact: true }).fill("Weekly study");
  await expect(sidebar(page).getByText("Unsaved changes")).toBeVisible();
  // Step links and mode switches do not leave, so they do not ask.
  await steps(page).getByRole("button", { name: /Joining/ }).click();
  await tab(page, "Operations").click();
  await expect(dialog).toHaveCount(0);
  await tab(page, "Public").click();
  await expect(sidebar(page).getByText("Unsaved changes")).toBeVisible();
  // Back link, logo, and a mode entry in the previewed sidebar all ask; Stay keeps the draft.
  await sidebar(page).getByRole("link", { name: "Back to Communities", exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator("[data-sidebar='header']").getByRole("link", { name: "Harvest" }).click();
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Stay", exact: true }).click();
  await tab(page, "Operations").click();
  await page.getByRole("navigation", { name: /^Ministry navigation/ }).getByRole("link", { name: "People", exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Stay", exact: true }).click();
  await tab(page, "Public").click();
  // The breadcrumb link too, and the Open page link is a new tab so it never asks.
  await page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) }).getByRole("link", { name: "Communities", exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/workspaces/${tenant}/communities$`));
  // After leaving, the saved draft is the old one (nothing was saved).
  await page.goto(url);
  await expect(page.getByLabel("Tagline (optional)", { exact: true })).toHaveValue("");
  // Closing the tab or reloading is guarded by the browser prompt while dirty.
  await page.getByLabel("Tagline (optional)", { exact: true }).fill("Again");
  const prompted = new Promise<string>((resolve) => page.once("dialog", async (d) => { resolve(d.type()); await d.dismiss(); }));
  await page.evaluate(() => { location.reload(); });
  expect(await prompted).toBe("beforeunload");
});

test("steps need attention when the name is cleared; keyboard path through the sidebar", async ({ page }) => {
  test.skip(off, "flag off");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const { url } = await setup(page);
  await page.goto(url);
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  await expect(steps(page).getByRole("button", { name: /Basics/ })).not.toContainText("Needs attention");
  await page.getByLabel("Name", { exact: true }).fill("");
  await expect(steps(page).getByRole("button", { name: /Basics/ })).toContainText("Needs attention");
  await page.getByLabel("Name", { exact: true }).fill("Grace Bible Study");
  await expect(steps(page).getByRole("button", { name: /Basics/ })).not.toContainText("Needs attention");
  // Keyboard: Tab walks the steps in order (disabled steps stay in the order and do nothing); Enter selects and focus lands on the step heading.
  const joining = steps(page).getByRole("button", { name: /Joining/ });
  await joining.focus();
  await page.keyboard.press("Tab");
  await expect(steps(page).getByRole("button", { name: /Channels/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(steps(page).getByRole("button", { name: /Messages/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(heading(page, "Basics")).toBeVisible();
  await expect(steps(page).getByRole("button", { name: /Basics/ })).toHaveAttribute("aria-current", "step");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(joining).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(heading(page, "Joining")).toBeFocused();
});

test("phone and tablet: Step n of m bar, All steps sheet, preview sheet, 44px targets, drawer sidebar", async ({ page }) => {
  test.skip(off, "flag off");
  test.setTimeout(300_000);
  await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 360, height: 780 });
  const { tenant, id, url } = await setup(page);
  await breakJoining(page, tenant, id);
  for (const scheme of ["light", "dark"] as const) {
    await setColorMode(page, scheme, url);
    await page.setViewportSize({ width: 360, height: 780 });
    await expect(page.locator("[data-editor-hosted]")).toBeVisible();
    // No sidebar column and no in-page step list below 1024px; the step bar leads the editor.
    await expect(page.locator("[data-sidebar='sidebar']")).toHaveCount(0);
    await expect(page.locator("main").getByRole("navigation", { name: "Community setup" })).toHaveCount(0);
    const bar = page.locator("[data-slot='editor-step-bar']");
    const trigger = bar.getByRole("button", { name: /Show all steps/ });
    await expect(trigger).toHaveAccessibleName("Step 2 of 9: Basics. Show all steps");
    await expect(bar).toContainText("Step 2 of 9");
    expect(await short(bar.getByRole("button"))).toEqual([]);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await axe(page);
    await page.screenshot({ path: `${evidence}/phone-360-step-bar-${scheme}.png` });

    // The All steps sheet: steps with states, back link, picking one closes it and focuses the step heading.
    await trigger.click();
    const sheet = page.getByRole("dialog", { name: "All steps" });
    await expect(sheet).toBeVisible();
    const list = sheet.getByRole("navigation", { name: "Community setup" });
    await expect(list.getByRole("listitem")).toHaveCount(9);
    await expect(list.getByRole("button", { name: /Basics/ })).toHaveAttribute("aria-current", "step");
    await expect(list.getByRole("button", { name: /Joining/ })).toContainText("Needs attention");
    await expect(list.getByRole("button", { name: /Offer/ })).toContainText("Done");
    await expect(list.getByRole("button", { name: /Channels/ })).toContainText("Not started");
    await expect(sheet.getByRole("link", { name: "Back to Communities", exact: true })).toBeVisible();
    expect(await short(sheet.locator("button, a"))).toEqual([]);
    await axe(page);
    await page.screenshot({ path: `${evidence}/phone-360-all-steps-${scheme}.png` });
    await expect(list.getByRole("button", { name: /Messages/ })).toHaveAttribute("aria-disabled", "true");
    await list.getByRole("button", { name: /Messages/ }).dispatchEvent("click");
    await expect(sheet).toBeVisible();
    await list.getByRole("button", { name: /Joining/ }).click();
    await expect(sheet).toHaveCount(0);
    await expect(heading(page, "Joining")).toBeFocused();
    await expect(trigger).toHaveAccessibleName("Step 3 of 9: Joining. Show all steps");
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.reload();
    await expect(page.locator("[data-hydrated=true]")).toBeVisible();

    // The preview is a sheet on phones; Back and Next are the form's footer.
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Preview" }).getByText("Grace Bible Study")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(heading(page, "Joining")).toBeFocused();
    expect(await short(page.getByRole("button", { name: /^(Next|Back)$/ }))).toEqual([]);

    // The drawer shows the editing sidebar with 44px targets; choosing a step closes it.
    const drawer = await openDrawer(page);
    await expect(drawer.getByRole("group", { name: "Editing Grace Bible Study" })).toBeVisible();
    await expect(drawer.getByRole("tablist", { name: "Menu mode" })).toBeVisible();
    expect(await short(drawer.locator("[data-editor-steps] button, [data-shell-editing] a"))).toEqual([]);
    await axe(page);
    if (scheme === "light") await page.screenshot({ path: `${evidence}/phone-360-drawer-light.png` });
    await drawer.getByRole("button", { name: /Channels/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(heading(page, "Channels")).toBeFocused();
  }
});

test("five widths in light and dark: axe, no overflow, step bar below 1024px and sidebar from 1024px", async ({ page }) => {
  test.skip(off, "flag off");
  test.setTimeout(420_000);
  await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  const { url } = await setup(page);
  for (const scheme of ["light", "dark"] as const) {
    await setColorMode(page, scheme, url);
    for (const [width, height] of [[360, 780], [390, 844], [768, 1024], [1280, 900], [1440, 1000]] as const) {
      await page.setViewportSize({ width, height });
      await expect(page.locator("[data-editor-hosted]")).toBeVisible();
      const desktop = width >= 1024;
      await expect(page.locator("[data-slot='editor-step-bar']")).toBeVisible({ visible: !desktop });
      if (desktop) { await expect(sidebar(page)).toBeVisible(); }
      await expect(page.getByRole("complementary", { name: "Preview" })).toBeVisible({ visible: width >= 1280 });
      if (width >= 1280) expect(await page.locator("aside[aria-label='Preview']").evaluate((n) => Math.round(n.getBoundingClientRect().width))).toBe(352);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await axe(page);
      if (width === 768) await page.screenshot({ path: `${evidence}/tablet-768-${scheme}.png` });
      if (width === 1280) await page.screenshot({ path: `${evidence}/desktop-1280-editing-${scheme}.png` });
    }
    // Collapsed icon rail: back arrow and numbered step markers with tooltips.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.keyboard.press("Control+b");
    await expect(page.locator("[data-state='collapsed']").first()).toBeVisible();
    await expect(steps(page).getByRole("button", { name: /Joining/ })).toBeVisible();
    await steps(page).getByRole("button", { name: /Joining/ }).hover();
    await expect(page.getByRole("tooltip").filter({ hasText: "Joining" })).toBeVisible();
    if (scheme === "light") await page.screenshot({ path: `${evidence}/desktop-1280-rail-light.png` });
    await page.keyboard.press("Control+b");
  }
  // 1600px: the wider preview column.
  await page.setViewportSize({ width: 1700, height: 1000 });
  expect(await page.locator("aside[aria-label='Preview']").evaluate((n) => Math.round(n.getBoundingClientRect().width))).toBe(384);
});

test("role matrix: owner and admin edit; member and viewer see the sidebar read-only", async ({ page, browser }) => {
  test.skip(off, "flag off");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const { tenant, url } = await setup(page);
  for (const role of ["admin", "member", "viewer"]) {
    const { context, page: other } = await member(browser, page, tenant, role);
    try {
      await other.goto(url);
      await expect(other.locator("[data-hydrated=true]")).toBeVisible();
      await expect(sidebar(other)).toBeVisible();
      await expect(steps(other).getByRole("listitem")).toHaveCount(9);
      await expect(tab(other, "Public")).toHaveAttribute("aria-selected", "true");
      const writable = role === "admin";
      await expect(other.getByLabel("Name", { exact: true })).toBeEnabled({ enabled: writable });
      await expect(other.getByRole("button", { name: "Save draft", exact: true })).toHaveCount(0);
      await expect(other.locator("header").filter({ has: other.getByRole("heading", { level: 1 }) }).getByRole("button", { name: "Publish", exact: true })).toHaveCount(writable ? 1 : 0);
      await expect(other.getByText("Only owners and admins can edit communities.")).toHaveCount(writable ? 0 : 1);
      await steps(other).getByRole("button", { name: /People/ }).click();
      await expect(heading(other, "People")).toBeFocused();
    } finally { await context.close(); }
  }
});
