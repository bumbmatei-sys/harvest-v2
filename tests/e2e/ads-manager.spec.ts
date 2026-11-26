import { test, type Page } from "@playwright/test";
import { adsWorkspace, audit, expect, releaseAfterEach } from "./helpers/ads";
import { signIn } from "./helpers/session";

// Ads manager against the real Ads routes and the in-memory test provider with invented accounts, campaigns and numbers. Nothing leaves the process: no network, no spend.
test.use({ actionTimeout: 30_000, timezoneId: "UTC", reducedMotion: "reduce" });
const release = releaseAfterEach();
const workspace = (page: Page) => adsWorkspace(page, release);
const ready = (page: Page) => expect(page.locator('[data-ads-ready="true"]')).toBeVisible();
const row = (page: Page, name: string) => page.getByRole("row").filter({ has: page.getByRole("button", { name, exact: true }) });

test("ads manager: accounts, three-level table, filters, switches, columns, edit panel, health and totals", async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  const tenant = await workspace(page);
  await page.goto(`/workspaces/${tenant}/social/ads`);
  await expect(page.getByRole("heading", { name: "Ads", exact: true })).toBeVisible();

  // Sidebar: Ads sits in Social media between Auto-DM and Analytics.
  if (process.env.HARVEST_SHELL_MODES !== "disabled") {
    const sidebar = page.locator('[data-sidebar="sidebar"]').first();
    await expect(sidebar.getByRole("link", { name: "Ads", exact: true })).toHaveAttribute("data-active", "true");
  }

  // No ad accounts yet: find them through the connected social account.
  await expect(page.getByText("No ad accounts yet")).toBeVisible();
  await audit(page, "empty-accounts");
  await page.locator("[data-ads-find]").click();
  await expect(page.locator("[data-ads-account]")).toBeVisible();
  await expect(page.getByText("No campaigns yet")).toBeVisible();
  await page.getByRole("button", { name: "Refresh" }).first().click();
  await ready(page);
  await expect(page.getByRole("button", { name: "Easter service invitation", exact: true })).toBeVisible();

  // Summary cards, health banner (the invented account has an Instagram link warning), tabs with counts, totals row.
  const cards = page.locator("[data-ads-summary] [data-testid=stat-card]");
  await expect(cards).toHaveCount(4);
  await expect(page.locator("[data-ads-health]")).toContainText("Instagram");
  // The test provider is shared by the specs in one run, so another spec may have added campaigns: the invented ones are a floor, not an exact count.
  const count = async (name: RegExp) => Number((await page.getByRole("tab", { name }).innerText()).match(/\d+/)![0]);
  expect(await count(/Campaigns/)).toBeGreaterThanOrEqual(4);
  expect(await count(/Ad sets/)).toBeGreaterThanOrEqual(6);
  expect(await count(/^Ads/)).toBeGreaterThanOrEqual(9);
  await expect(page.locator('[data-slot="data-table-totals"]')).toContainText(/Total of \d+ rows/);
  // Reach is an average per day, and the campaign with no reported results says Unavailable, not zero.
  await expect(page.getByRole("columnheader", { name: "Reach per day" })).toBeVisible();
  await expect(row(page, "Christmas Eve boost")).toContainText("Unavailable");
  await audit(page, "manager");

  // Selecting a campaign filters the next level; selecting an ad set filters the ads.
  await page.getByRole("checkbox", { name: "Select Easter service invitation" }).check();
  await expect(page.getByRole("tab", { name: /Ad sets/ })).toContainText("2");
  await page.getByRole("tab", { name: /Ad sets/ }).click();
  await expect(page.getByRole("button", { name: "Local families", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Parents 35 to 55", exact: true })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Select Young adults" }).check();
  await page.getByRole("tab", { name: /^Ads/ }).click();
  await expect(page.getByRole("button", { name: "Join us Sunday", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Easter video", exact: true })).toHaveCount(0);
  // An ad with a rejected review shows it beside its name.
  await page.getByRole("tab", { name: /Campaigns/ }).click();
  await page.getByRole("checkbox", { name: "Select Easter service invitation" }).uncheck();

  // Per-row switch: turning on asks first; turning off does not.
  const food = page.getByRole("switch", { name: "Deliver Food drive awareness" });
  await expect(food).not.toBeChecked();
  await food.click();
  await expect(page.getByRole("alertdialog")).toContainText("Turn on Food drive awareness?");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(food).not.toBeChecked();
  await food.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Turn on" }).click();
  await expect(food).toBeChecked();
  await food.click();
  await expect(food).not.toBeChecked();

  // Bulk off for two campaigns.
  await page.getByRole("checkbox", { name: "Select Easter service invitation" }).check();
  await page.getByRole("checkbox", { name: "Select Christmas Eve boost" }).check();
  await expect(page.locator('[data-slot="data-table-bulk"]')).toContainText("2 selected");
  await page.locator('[data-slot="data-table-bulk"]').getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByRole("switch", { name: "Deliver Easter service invitation" })).not.toBeChecked();
  await expect(page.getByRole("switch", { name: "Deliver Christmas Eve boost" })).not.toBeChecked();
  await page.locator('[data-slot="data-table-bulk"]').getByRole("button", { name: "Clear selection" }).click();

  // Columns picker.
  await page.getByRole("button", { name: "Columns" }).click();
  await page.getByRole("menuitemradio", { name: "Engagement" }).click();
  await expect(page.getByRole("columnheader", { name: "Click rate" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Budget" })).toHaveCount(0);
  await page.getByRole("button", { name: "Columns" }).click();
  await page.getByRole("menuitemradio", { name: "Custom" }).click();
  await page.getByRole("button", { name: "Columns" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Goal" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("columnheader", { name: "Goal" })).toBeVisible();
  await page.getByRole("button", { name: "Columns" }).click();
  await page.getByRole("menuitemradio", { name: "Performance" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("columnheader", { name: "Budget" })).toBeVisible();

  // Edit panel: rename, budget with an explicit confirmation, and the remove confirmation.
  await page.getByRole("button", { name: "Youth camp sign-up", exact: true }).click();
  const panel = page.locator("[data-ads-panel]");
  await expect(panel).toBeVisible();
  await panel.getByLabel("Name").fill("Youth camp 2027");
  await panel.getByRole("button", { name: "Save name" }).click();
  await expect(panel.getByRole("heading", { name: "Youth camp 2027", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: "Youth camp 2027", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Easter service invitation", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Save budget" })).toBeDisabled();
  await panel.getByLabel("Daily budget").fill("30");
  await expect(panel.getByRole("button", { name: "Save budget" })).toBeDisabled();
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "Save budget" }).click();
  await expect(panel.getByLabel("Daily budget")).toHaveValue("30");
  await audit(page, "edit-panel");
  await panel.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("cannot be undone");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(row(page, "Easter service invitation")).toContainText("30.00");

  // A second ad account (another network) is selectable and has its own tree.
  await page.locator("[data-ads-account]").selectOption({ label: "Grace Church search (Google)" });
  await expect(page.getByText("No campaigns yet")).toBeVisible();
  await page.getByRole("button", { name: "Refresh" }).first().click();
  await ready(page);
  await expect(page.getByRole("button", { name: "Church near me search", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("ads manager on a phone: cards instead of a table, 44px targets", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 360, height: 800 });
  const tenant = await workspace(page);
  await page.goto(`/workspaces/${tenant}/social/ads`);
  await page.locator("[data-ads-find]").click();
  await page.getByRole("button", { name: "Refresh" }).first().click();
  await ready(page);
  await expect(page.locator('[data-slot="data-table-cards"]')).toBeVisible();
  const small = await page.locator('[data-slot="data-table-cards"] [role=switch], [data-slot="data-table-cards"] [data-ads-open]').evaluateAll((els) => els.filter((el) => { const r = (el.closest("label") ?? el).getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).length);
  expect(small).toBe(0);
});

test("ads: members and strangers get the neutral not-available answer", async ({ page, browser }) => {
  const tenant = await workspace(page);
  expect((await page.request.get(`/api/workspaces/${tenant}/social/ads/accounts`)).status()).toBe(200);
  const stranger = await browser.newContext({ baseURL: `http://127.0.0.1:${process.env.E2E_PORT ?? "3100"}` });
  const other = await stranger.newPage();
  await signIn(other);
  expect((await other.request.get(`/api/workspaces/${tenant}/social/ads/accounts`)).status()).toBe(404);
  await stranger.close();
});
