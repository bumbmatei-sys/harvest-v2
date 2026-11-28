import { mkdir, readFile } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "./helpers/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";
import { seedCampaign } from "../helpers/newsletter-analytics-seed";
import { signClickToken } from "../../src/lib/newsletter-click-token";

const expect = baseExpect.configure({ timeout: 30000 });
// Newsletter link clicks: the owner turns counting on in the Sender settings, a sent campaign (synthetic delivery rows in the disposable test
// database; sending stays off) is clicked through the real signed redirect, and Analytics shows the totals. Nothing is sent and no person is shown.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/newsletter-click-tracking";
const sizes = [["phone", 360, 800], ["desktop", 1280, 900]] as const;
const links = ["https://ministry.example.invalid/advent-plan", "https://ministry.example.invalid/give"];

async function admin() {
  const client = new Client({ connectionString: await readFile(`${process.env.HARVEST_E2E_MAILBOX}.admin`, "utf8") });
  await client.connect();
  return client;
}

/** Axe at 360 and 1280 in light and dark, no horizontal scroll, and one screenshot per size and scheme. */
async function shoot(page: Page, name: string, focus?: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.reload(); await page.waitForTimeout(400);
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await settleForAxe(page);
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      // The shell scrolls inside its own container, so bring the part under review into view first.
      if (focus) await page.locator(focus).first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("click counting: owner turns it on, clicks go through the redirect, analytics shows totals only", async ({ page }) => {
  test.setTimeout(600000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;

  // Settings: off by default, the owner turns it on.
  await page.goto(`/workspaces/${tenant}/newsletter/sender`);
  const section = page.locator("#sender-clicks");
  await expect(section).toHaveAttribute("data-click-tracking", "off");
  const toggle = page.getByRole("switch", { name: "Count link clicks in emails" });
  await expect(toggle).not.toBeChecked();
  await section.scrollIntoViewIfNeeded();
  await shoot(page, "settings-off", "#sender-clicks");
  await page.getByText("Count link clicks in emails").click();
  await expect(section).toHaveAttribute("data-click-tracking", "on");
  await expect(toggle).toBeChecked();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Count link clicks in emails" })).toBeChecked();
  await shoot(page, "settings-on", "#sender-clicks");

  // A sent campaign, frozen after counting was turned on: six synthetic deliveries and the frozen revision's two links.
  const key = Buffer.from((await readFile(`${process.env.HARVEST_E2E_MAILBOX}.newsletter-key`, "utf8")).trim(), "hex");
  const client = await admin();
  let campaign = "", deliveries: string[] = [];
  try {
    const owner = (await client.query("select user_id from workspace_members where tenant_id=$1 and role_id='owner'", [tenant])).rows[0].user_id as string;
    campaign = await seedCampaign(client, { tenant, user: owner, name: "Advent letter", days: [{ day: new Date().toISOString().slice(0, 10), accepted: 6, delivered: 6 }] });
    for (const [index, url] of links.entries()) await client.query("insert into newsletter_click_links(tenant_id,campaign_id,revision,link_index,url) values($1,$2,1,$3,$4)", [tenant, campaign, index, url]);
    deliveries = (await client.query("select id from newsletter_deliveries where campaign_id=$1 order by id", [campaign])).rows.map((row) => row.id as string);
  } finally { await client.end(); }

  // Clicks through the real redirect: six on the first link, five on the second; a repeat counts once; a tampered token goes to the neutral page.
  for (const [index, delivery] of deliveries.entries()) {
    for (const link of index < 5 ? [0, 1] : [0]) {
      const token = signClickToken(key, { tenant, campaign, revision: 1, delivery, link });
      const response = await page.request.get(`/api/newsletter/link?t=${token}`, { maxRedirects: 0 });
      expect(response.status()).toBe(302);
      expect(response.headers().location).toBe(links[link]);
      if (index === 0) expect((await page.request.get(`/api/newsletter/link?t=${token}`, { maxRedirects: 0 })).headers().location).toBe(links[link]);
    }
  }
  const forged = await page.request.get(`/api/newsletter/link?t=${signClickToken(Buffer.alloc(32, 7), { tenant, campaign, revision: 1, delivery: deliveries[0], link: 0 })}`, { maxRedirects: 0 });
  expect(forged.status()).toBe(302);
  expect(new URL(forged.headers().location).pathname).toBe("/newsletter/link");
  await page.goto("/newsletter/link");
  await expect(page.getByRole("heading", { name: "This link is not available" })).toBeVisible();

  // Analytics: totals only, labelled honestly.
  await page.goto(`/workspaces/${tenant}/newsletter/analytics`);
  const tile = page.locator('[data-testid="report-stat"][data-metric="clicks"]');
  await expect(tile.getByTestId("report-value")).toHaveText("11");
  await expect(tile).toContainText("May include link scanners");
  await expect(page.getByTestId("campaign-figures").locator("tbody tr").first()).toContainText("11");
  await expect(page.getByTestId("analytics-footer")).toContainText("Link clicks are totals and may include link scanners");
  await expect(page.getByText(/@example\.(test|invalid)/)).toHaveCount(0);
  await shoot(page, "analytics", '[data-metric="clicks"]');

  await page.goto(`/workspaces/${tenant}/newsletter/analytics/${campaign}`);
  await expect(page.locator('[data-testid="report-stat"][data-metric="clicks"]').getByTestId("report-value")).toHaveText("11");
  const top = page.getByTestId("top-links");
  await expect(top.locator("[data-top-link]")).toHaveText(links);
  await expect(top).toContainText("6");
  await expect(top).toContainText("5");
  await shoot(page, "campaign", '[data-testid="top-links"]');
  expect(errors).toEqual([]);
});
