import { test, type Page } from "@playwright/test";
import { adsSynced, adsWorkspace, audit, expect, releaseAfterEach } from "./helpers/ads";

// Ads overview and flag-only rules against the real Ads routes and the in-memory test provider with invented accounts, campaigns and numbers. Nothing leaves the process: no network, no spend.
test.use({ actionTimeout: 30_000, timezoneId: "UTC", reducedMotion: "reduce" });
const release = releaseAfterEach();
const workspace = (page: Page) => adsWorkspace(page, release);

test("ads overview: stat cards, chart, needs attention, account health, and flag-only rules", async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  const tenant = await workspace(page);
  await adsSynced(page, tenant);

  // The manager links to the overview; the sidebar keeps Ads active on every Ads page.
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/workspaces/${tenant}/social/ads/overview$`));
  await expect(page.getByRole("heading", { name: "Ads overview", exact: true })).toBeVisible();
  if (process.env.HARVEST_SHELL_MODES !== "disabled") {
    const sidebar = page.locator('[data-sidebar="sidebar"]').first();
    await expect(sidebar.getByRole("link", { name: "Ads", exact: true })).toHaveAttribute("data-active", "true");
  }
  await expect(page.locator('[data-ads-ready="true"]')).toBeVisible();

  // Four stat cards from stored results; numbers, never invented zeros.
  const cards = page.locator("[data-ads-overview-cards] [data-testid=stat-card]");
  await expect(cards).toHaveCount(4);
  await expect(cards.filter({ hasText: "Spend" }).getByTestId("stat-value")).toHaveText(/\$/);
  await expect(cards.filter({ hasText: "Active campaigns" }).getByTestId("stat-value")).toHaveText(/^\d+$/);
  await expect(page.getByTestId("series-chart")).toBeVisible();
  await page.getByTestId("series-results").click();
  await expect(page.getByTestId("series-card")).toContainText("Results");

  // Needs attention: the rejected ad, the in-review-free delivery issue and the Instagram link warning of the invented account.
  const attention = page.locator("[data-ads-attention]");
  await expect(attention.locator('[data-attention="adRejected"]')).toContainText("Camp carousel");
  await expect(attention.locator('[data-attention="deliveryIssue"]')).toContainText("Boosted post");
  await expect(attention.locator('[data-attention="healthCheck"]')).toContainText("Instagram");

  // Account health: one card per connected ad account, every named check, Check now stores a fresh answer.
  const health = page.locator("[data-ads-account-health]");
  await expect(health.locator("[data-ads-health-account]")).toHaveCount(2);
  const grace = health.locator('[data-ads-health-account="Grace Church ads"]');
  await expect(grace.getByRole("listitem")).toHaveCount(8);
  await expect(grace).toContainText("Tracking pixel");
  await expect(grace).toContainText("Not confirmed");
  await grace.getByRole("button", { name: "Check now: Grace Church ads" }).click();
  await expect(grace).toContainText("Checked");
  await audit(page, "overview");

  // Rules: flag only. A new rule starts off, previews without acting, then flags on Check rules now; nothing is turned off.
  await page.getByRole("link", { name: "Rules", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ad rules", exact: true })).toBeVisible();
  await expect(page.getByText("No rules yet")).toBeVisible();
  await audit(page, "rules-empty");
  await page.locator("[data-ads-new-rule]").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Matching items are flagged. Nothing is turned off and no budget changes.");
  await dialog.getByRole("button", { name: "Create rule" }).click();
  await expect(dialog.getByText("Enter a name of up to 120 characters.")).toBeVisible();
  await dialog.getByLabel("Name").fill("Spend over 1");
  await dialog.getByLabel("Limit (USD)").fill("1");
  await audit(page, "rules-new");
  await dialog.getByRole("button", { name: "Create rule" }).click();
  await expect(dialog).toBeHidden();
  const ruleRow = page.getByRole("row").filter({ hasText: "Spend over 1" });
  await expect(ruleRow).toContainText("Flag");
  const toggle = page.getByRole("switch", { name: "Rule Spend over 1 on" });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page.locator('[data-ads-rules-ready="true"]')).toBeVisible();
  await page.locator("[data-ads-rules-run]").click();
  await expect(page.getByText(/items? flagged/)).toBeVisible();
  await page.getByRole("button", { name: "Spend over 1", exact: true }).click();
  const sheet = page.locator("[data-ads-rule-sheet]");
  await expect(sheet.locator("[data-ads-rule-preview]")).toContainText("Easter service invitation");
  await expect(sheet).toContainText("Flagged");
  await audit(page, "rules-sheet");
  await page.keyboard.press("Escape");
  await audit(page, "rules");

  // The overview lists the flag; the campaigns it flagged are still on.
  await page.getByRole("link", { name: "Ads overview" }).click();
  await expect(page.locator('[data-ads-ready="true"]')).toBeVisible();
  await expect(page.locator('[data-attention="ruleFlag"]').first()).toContainText("Spend over 1");
  await page.getByRole("link", { name: "Manage ads" }).click();
  await expect(page.locator('[data-ads-ready="true"]')).toBeVisible();
  await expect(page.getByRole("switch", { name: "Deliver Easter service invitation" })).toBeChecked();

  // Phone: 44px targets on the overview actions.
  await page.goto(`/workspaces/${tenant}/social/ads/overview`);
  await expect(page.locator('[data-ads-ready="true"]')).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  for (const name of ["Rules", "Manage ads"]) expect((await page.getByRole("link", { name, exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await page.getByRole("button", { name: "Check now: Grace Church ads" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(errors).toEqual([]);
});
