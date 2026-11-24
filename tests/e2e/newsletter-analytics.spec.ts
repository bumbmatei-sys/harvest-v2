import { mkdir, readFile } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";
import { seedCampaign } from "../helpers/newsletter-analytics-seed";

const expect = baseExpect.configure({ timeout: 30000 });
// Newsletter Analytics: aggregate figures only. Seeded with synthetic delivery evidence through the disposable test database; nothing is sent.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/newsletter-analytics";
const sizes = [["phone", 360, 800], ["tablet", 768, 1024], ["desktop", 1280, 900]] as const;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** One scene per width and colour scheme, on the main screen only. */
async function shoot(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.reload(); await page.waitForTimeout(400);
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await settleForAxe(page);
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

/** The campaign page: one desktop scene per colour scheme with axe (the full set of widths is on the main screen). */
async function shootOnce(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.reload(); await page.waitForTimeout(400);
    await settleForAxe(page);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `${evidence}/${name}-desktop-${scheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
}

async function admin() {
  const client = new Client({ connectionString: await readFile(`${process.env.HARVEST_E2E_MAILBOX}.admin`, "utf8") });
  await client.connect();
  return client;
}

test("analytics: empty state, aggregate figures, period, sort, small groups and the nav", async ({ page }) => {
  test.setTimeout(600000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const base = `/workspaces/${tenant}/newsletter/analytics`;

  // Empty: sending is off, so there is nothing to report. Tiles read zero and the empty state says why.
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No sends yet" })).toBeVisible();
  await expect(page.getByTestId("report-stat")).toHaveCount(6);
  await expect(page.getByTestId("report-chart-daily")).toHaveCount(0);
  await expect(page.getByTestId("analytics-footer")).toContainText("Opens and clicks are not collected");
  await page.screenshot({ path: `${evidence}/empty-desktop-light.png`, fullPage: true });

  // Nav: Analytics is the first Newsletter entry and is current; the Operations Campaigns entry (/campaigns) is not highlighted.
  if (process.env.HARVEST_SHELL_MODES !== "disabled") {
    const sidebar = page.locator("[data-sidebar=\"sidebar\"]").first();
    const links = sidebar.locator(`a[href^="/workspaces/${tenant}/newsletter/"]`);
    await expect(links.first()).toHaveText("Analytics");
    await expect(links.first()).toHaveAttribute("aria-current", "page");
    await expect(links.nth(1)).toHaveText("Campaigns");
    await expect(links.nth(1)).not.toHaveAttribute("aria-current", "page");
    await page.getByRole("tab", { name: "Operations", exact: true }).click();
    const operations = sidebar.locator(`a[href="/workspaces/${tenant}/campaigns"]`);
    await expect(operations).toHaveCount(1);
    await expect(operations).not.toHaveAttribute("aria-current", "page");
    await page.getByRole("tab", { name: "Public", exact: true }).click();
  }

  // Seed synthetic delivery evidence (aggregates only; no people).
  const client = await admin();
  try {
    const owner = (await client.query("select user_id from workspace_members where tenant_id=$1 and role_id='owner'", [tenant])).rows[0].user_id as string;
    await seedCampaign(client, { tenant, user: owner, name: "Advent letter", days: [
      { day: daysAgo(12), accepted: 40, delivered: 37, bounced: 3, complained: 0, unsubscribed: 6 }, { day: daysAgo(11), accepted: 12, delivered: 12 }] });
    await seedCampaign(client, { tenant, user: owner, name: "Christmas Eve service", days: [
      { day: daysAgo(5), accepted: 55, delivered: 50, bounced: 4, complained: 1, unsubscribed: 2 }, { day: daysAgo(4), accepted: 20, delivered: 20 }] });
    await seedCampaign(client, { tenant, user: owner, name: "Old harvest note", days: [{ day: daysAgo(60), accepted: 30, delivered: 30 }] });
  } finally { await client.end(); }

  await page.goto(base);
  await expect(page.getByTestId("newsletter-analytics")).toHaveAttribute("data-period", "30");
  const tile = (metric: string) => page.locator(`[data-testid="report-stat"][data-metric="${metric}"]`);
  await expect(tile("sent").getByTestId("report-value")).toHaveText("127");
  await expect(tile("delivered").getByTestId("report-value")).toHaveText("119");
  await expect(tile("delivered")).toContainText("93.7% of sent");
  await expect(tile("campaigns").getByTestId("report-value")).toHaveText("2");
  await expect(page.getByTestId("report-chart-daily")).toBeVisible();
  const table = page.getByTestId("campaign-figures");
  await expect(table.getByRole("link", { name: "Christmas Eve service" })).toHaveAttribute("href", /\/newsletter\/analytics\/[0-9a-f-]{36}$/);
  await expect(table.getByRole("link", { name: "Old harvest note" })).toHaveCount(0);
  // No recipient is ever listed.
  await expect(page.getByText(/@example\.test/)).toHaveCount(0);

  // Sort: Sent descending by default (Christmas Eve 75 first); a click on Campaign sorts by name.
  const first = () => table.locator("tbody tr").first();
  await expect(first()).toContainText("Christmas Eve service");
  await table.getByRole("button", { name: "Campaign", exact: true }).click();
  await expect(first()).toContainText("Advent letter");
  await table.getByRole("button", { name: "Campaign", exact: true }).click();
  await expect(first()).toContainText("Christmas Eve service");

  // Detail: a row opens that campaign's analytics; the nav stays on Analytics; a draft is an honest not-sent state.
  await table.getByRole("link", { name: "Christmas Eve service" }).click();
  await expect(page).toHaveURL(/\/newsletter\/analytics\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /Christmas Eve service/ })).toBeVisible();
  await expect(page.locator('[data-testid="report-stat"][data-metric="sent"]').getByTestId("report-value")).toHaveText("75");
  await expect(page.getByTestId("report-card-status")).toBeVisible();
  await expect(page.getByTestId("analytics-footer")).toContainText("Opens, clicks and link clicks are not collected");
  if (process.env.HARVEST_SHELL_MODES !== "disabled") await expect(page.locator("[data-sidebar=\"sidebar\"]").first().locator(`a[href=\"/workspaces/${tenant}/newsletter/analytics\"]`)).toHaveAttribute("aria-current", "page");
  await shootOnce(page, "campaign");
  await page.goBack();
  const drafts = await admin();
  let draftId = "";
  try {
    const owner = (await drafts.query("select user_id from workspace_members where tenant_id=$1 and role_id='owner'", [tenant])).rows[0].user_id as string;
    draftId = await seedCampaign(drafts, { tenant, user: owner, name: "Unsent draft", state: "draft", days: [] });
  } finally { await drafts.end(); }
  await page.goto(`${base}/${draftId}`);
  await expect(page.getByRole("heading", { name: "Not sent yet" })).toBeVisible();
  await page.goto(`/workspaces/${tenant}/newsletter/analytics/00000000-0000-4000-8000-000000000000`);
  await expect(page.getByText("This page could not be found", { exact: false }).or(page.getByRole("heading", { name: /404|not found/i })).first()).toBeVisible();
  await page.goto(base);

  // Period: 7 days keeps only the second campaign; 90 days adds the old one; the URL carries the choice.
  await page.getByTestId("period-7").click();
  await expect(page).toHaveURL(/period=7$/);
  await expect(page.getByTestId("newsletter-analytics")).toHaveAttribute("data-period", "7");
  await expect(tile("sent").getByTestId("report-value")).toHaveText("75");
  await expect(tile("campaigns").getByTestId("report-value")).toHaveText("1");
  await page.getByTestId("period-90").click();
  await expect(page).toHaveURL(/period=90$/);
  await expect(tile("sent").getByTestId("report-value")).toHaveText("157");
  await expect(table.getByRole("link", { name: "Old harvest note" })).toBeVisible();

  // Audience now: counts come from the Audience status data; nobody has a recorded choice yet.
  await expect(page.getByTestId("audience-now").locator('[data-metric="subscribed"]')).toContainText("0");
  await page.getByRole("link", { name: "Open Audience" }).click();
  await expect(page).toHaveURL(new RegExp(`/workspaces/${tenant}/newsletter/audience$`));

  // The main screen, populated (before the small send below withholds the period totals).
  await page.goto(`${base}?period=30`);
  await shoot(page, "analytics");

  // Small groups: a send to fewer than 5 people is withheld, never shown as zero.
  const small = await admin();
  try {
    const owner = (await small.query("select user_id from workspace_members where tenant_id=$1 and role_id='owner'", [tenant])).rows[0].user_id as string;
    await seedCampaign(small, { tenant, user: owner, name: "Prayer circle", days: [{ day: daysAgo(1), accepted: 3, delivered: 3 }] });
  } finally { await small.end(); }
  await page.goto(`${base}?period=7`);
  await expect(tile("sent").getByTestId("report-hidden")).toHaveText("Fewer than 5");
  await expect(table.locator("tr", { hasText: "Prayer circle" }).getByTestId("report-hidden").first()).toHaveText("Fewer than 5");
  expect(errors).toEqual([]);
});
