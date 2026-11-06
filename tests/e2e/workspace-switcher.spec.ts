import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect as playwrightExpect, test } from "@playwright/test";
import { origin, signIn } from "./helpers/session";

const expect = playwrightExpect.configure({ timeout: 15_000 });
const evidence = "docs/screenshots/eden-workspace-switcher";
test.use({ reducedMotion: "reduce" });

test("workspace switcher: empty memberships can open the dialog and create on the manage page", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  await page.goto("/workspaces");
  await expect(page.locator('[data-slot="sidebar-wrapper"]')).toHaveAttribute("data-hydrated", "true");
  const trigger = page.getByRole("button", { name: "Switch workspace: Choose workspace", exact: true });
  await trigger.click();
  await expect(page.getByRole("menuitem", { name: "Settings", exact: true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "New workspace", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New workspace", exact: true });
  await expect(dialog.getByLabel("Workspace name")).toBeFocused();
  // The manage-page form and dialog must have distinct label/input IDs.
  const ids = await page.getByLabel("Workspace name").evaluateAll((inputs) => inputs.map((input) => input.id));
  expect(new Set(ids).size).toBe(2);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(trigger).toBeFocused();
  await page.getByLabel("Workspace name").fill("Manage page workspace");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.locator("main").getByText("Manage page workspace", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(`${origin}/workspaces`);
});

for (const mobile of [false, true]) test(`workspace switcher: ${mobile ? "mobile" : "desktop"} switches routes and creates a workspace`, async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const email = await signIn(page);
  const names = ["Riverside Community Trust and Mission Centre", "Harvest community"];
  const workspaces: { tenantId: string; name: string }[] = [];
  for (const name of names) {
    const response = await page.request.post("/api/workspaces", { headers: { origin }, data: { name } });
    expect(response.status()).toBe(201);
    workspaces.push(await response.json());
  }
  const people = (index: number) => `/workspaces/${workspaces[index].tenantId}/crm/people`;
  await page.goto(people(0));
  await expect(page.locator('[data-slot="sidebar-wrapper"]')).toHaveAttribute("data-hydrated", "true");
  const openSidebar = async () => {
    if (mobile) await page.locator('[data-shell-header] [data-sidebar="trigger"]').click();
  };
  await openSidebar();
  const trigger = page.getByRole("button", { name: /^Switch workspace:/ });
  const footer = page.locator('[data-sidebar="footer"]');
  await expect(footer.getByRole("button", { name: /^Switch workspace:/ })).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("button", { name: /^Switch workspace:/ })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("link", { name: "Workspaces", exact: true })).toHaveAttribute("href", "/workspaces");
  if (mobile) await trigger.click();
  else { await trigger.focus(); await page.keyboard.press("Enter"); }
  const menu = page.getByRole("menu", { name: /^Switch workspace:/ });
  await expect(menu).toHaveAttribute("data-side", "top");
  await expect(menu.getByText("owner", { exact: true })).toBeVisible();
  await expect(menu.getByText(email, { exact: true })).toBeVisible();
  const active = menu.getByRole("menuitem", { name: names[0], exact: true });
  await expect(active).toHaveAttribute("aria-current", "true");
  await expect(active.locator("svg.lucide-check")).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: names[1], exact: true })).not.toHaveAttribute("aria-current");
  await expect(menu.getByRole("menuitem", { name: "Settings", exact: true })).toHaveAttribute("href", `/workspaces/${workspaces[0].tenantId}/appearance`);
  await expect(menu.getByRole("menuitem", { name: /Invite|Plans|Apps|Refer|Earn/ })).toHaveCount(0);
  expect((await menu.boundingBox())!.y + (await menu.boundingBox())!.height).toBeLessThanOrEqual((await trigger.boundingBox())!.y);
  expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await menu.getByRole("menuitem").evaluateAll((items) => items.every((item) => item.getBoundingClientRect().height >= 44))).toBe(true);
  await mkdir(evidence, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${evidence}/${mobile ? "mobile" : "desktop"}-open.png`, fullPage: true, animations: "disabled" });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await menu.getByRole("menuitem", { name: names[1], exact: true }).click();
  await expect(page).toHaveURL(`${origin}${people(1)}`);
  if (mobile) await expect(page.getByRole("dialog", { name: "Sidebar", exact: true })).toBeHidden();
  await openSidebar();
  await expect(trigger).toHaveAccessibleName(`Switch workspace: ${names[1]}`);
  if (!mobile) {
    await footer.locator('[data-sidebar="trigger"]').click();
    await expect(page.locator('[data-slot="sidebar"][data-state]')).toHaveAttribute("data-state", "collapsed");
    await trigger.hover();
    await expect(page.getByRole("tooltip")).toHaveText(names[1]);
    await expect(trigger.locator('[data-slot="avatar"]')).toBeVisible();
    await expect(trigger.locator("svg.lucide-chevrons-up-down")).toBeHidden();
  }
  await trigger.click();
  await expect(menu.getByRole("menuitem", { name: names[1], exact: true })).toHaveAttribute("aria-current", "true");
  await menu.getByRole("menuitem", { name: "New workspace", exact: true }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "New workspace", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Workspace name")).toBeFocused();
  if (mobile) await expect(page.getByRole("dialog", { name: "Sidebar", exact: true })).toBeHidden();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await dialog.getByLabel("Workspace name").fill("New harvest workspace");
  const createdResponse = page.waitForResponse((response) => response.url().endsWith("/api/workspaces") && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Create workspace", exact: true }).click();
  const response = await createdResponse;
  expect(response.status()).toBe(201);
  const created = await response.json();
  await expect(page).toHaveURL(`${origin}/workspaces/${created.tenantId}/crm/people`);
  await expect(dialog).toBeHidden();
  await openSidebar();
  await expect(trigger).toHaveAccessibleName("Switch workspace: New harvest workspace");
  await trigger.click();
  await expect(menu.getByRole("menuitem", { name: "New harvest workspace", exact: true })).toHaveAttribute("aria-current", "true");
  await expect(menu.getByRole("menuitem", { name: names[0], exact: true })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/workspaces/${created.tenantId}/appearance`);
  if (mobile) await expect(page.getByRole("dialog", { name: "Sidebar", exact: true })).toBeHidden();
  expect(errors).toEqual([]);
});
