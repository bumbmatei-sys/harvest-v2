import { mkdir, readFile } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "./helpers/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";
import { seedAudienceSnapshots } from "../helpers/newsletter-analytics-seed";

const expect = baseExpect.configure({ timeout: 30000 });
// Newsletter Analytics audience growth: daily counts only, seeded into the disposable test database. Nothing is sent.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = process.env.HARVEST_SHOTS_DIR ?? "docs/screenshots/newsletter-analytics";
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function shoot(page: Page) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.reload(); await page.waitForTimeout(400);
    for (const [label, width, height] of [["desktop", 1280, 900], ["phone", 360, 800]] as const) {
      await page.setViewportSize({ width, height });
      await settleForAxe(page);
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByTestId("report-card-growth").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${evidence}/growth-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("analytics: audience growth chart, net change and no data yet", async ({ page }) => {
  test.setTimeout(300000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const base = `/workspaces/${tenant}/newsletter/analytics`;

  // Before any snapshot: the card says there is no data yet, never zero.
  await page.goto(base);
  const card = page.getByTestId("report-card-growth");
  await expect(card.getByRole("heading", { name: "Audience growth" }).or(card.getByText("Audience growth")).first()).toBeVisible();
  await expect(card).toContainText("No data yet. Counts are taken once a day.");
  await expect(page.getByTestId("growth-net").locator('[data-metric="subscribed"]')).toContainText("No data yet");

  // Twenty days of synthetic counts, starting 20 days ago: the 30 day view has 10 days of no data first.
  const client = new Client({ connectionString: await readFile(`${process.env.HARVEST_E2E_MAILBOX}.admin`, "utf8") });
  await client.connect();
  try {
    await seedAudienceSnapshots(client, tenant, Array.from({ length: 20 }, (_, index) => ({
      day: daysAgo(20 - index), subscribed: 120 + index * 3, unsubscribed: 10 + Math.floor(index / 4), suppressed: index < 10 ? 3 : 6 })));
  } finally { await client.end(); }
  await page.goto(`${base}?period=30`);
  await expect(page.getByTestId("report-chart-growth")).toBeVisible();
  await expect(card).toContainText("No data yet before");
  const net = (metric: string) => page.getByTestId("growth-net").locator(`[data-metric="${metric}"]`);
  await expect(net("subscribed").getByTestId("growth-net-value")).toHaveText("+57");
  await expect(net("unsubscribed").getByTestId("growth-net-value")).toHaveText("+4");
  // The first and last suppressed counts include a group of 1 to 4 (3): the change is withheld.
  await expect(net("suppressed").getByTestId("report-hidden")).toHaveText("Fewer than 5");
  const table = page.getByTestId("report-table-growth");
  await expect(table.locator("tbody tr").first()).toContainText("No data yet");
  await expect(table.locator("tbody tr").nth(9)).toContainText("120");
  await expect(table.locator("tbody tr").nth(9)).toContainText("Fewer than 5");
  await shoot(page);

  // 7 days: every day has a snapshot except today.
  await page.getByTestId("period-7").click();
  await expect(page).toHaveURL(/period=7$/);
  await expect(net("subscribed").getByTestId("growth-net-value")).toHaveText("+15");
  expect(errors).toEqual([]);
});
