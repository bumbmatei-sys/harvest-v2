import { mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";
import { releaseSocialConnectionsAfterEach } from "./helpers/social-accounts";

const expect = baseExpect.configure({ timeout: 20000 });
// "Also publish to" on the native blog editor's Publish step and the blog copies in the Social Planner, against the real routes (the non-production
// Publish gate with the in-memory fake). Connections and blogs are seeded synthetic rows; no sign-in or provider call is made. Worker outcomes are set in
// the local database because no worker runs here. Axe at 1280 and 360 in light and dark.
test.use({ actionTimeout: 20000, reducedMotion: "reduce" });
const evidence = process.env.BLOG_EXTERNAL_SHOTS ?? "docs/screenshots/blog-external";
// Tall viewports so the whole Publish step (the editor scrolls inside the shell) is in the evidence shots.
const sizes = [["phone", 360, 2400], ["desktop", 1280, 1800]] as const;
const post = (page: Page, url: string, data: unknown = {}) => page.request.post(url, { headers: { origin }, data });
const put = (page: Page, url: string, data: unknown) => page.request.put(url, { headers: { origin }, data });
const step = (page: Page, name: string) => { const label = new RegExp(`^${name}\\s+(Done|Current step|Needs attention|Not started|Completed|Upcoming)`);
  return page.getByRole("button", { name: label }).or(page.getByRole("link", { name: label })).or(page.getByRole("tab", { name: label })).first(); };

async function audit(page: Page, name: string, restore: () => Promise<void>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
    await restore();
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await settleForAxe(page);
      await expect(page.locator('[data-slot="skeleton"], [aria-busy="true"]')).toHaveCount(0);
      const found = (await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations;
      expect(found.map((v) => `${name} ${label}/${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${label}/${scheme} overflow`).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
}
/** Every visible control in the section is at least 44px tall on a phone. */
async function tapTargets(page: Page) {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const item of await page.locator("[data-blog-external] :is(button, a, select, input), [data-blog-harvest-page]").all()) {
    if (!(await item.isVisible())) continue;
    const box = (await item.boundingBox())!;
    expect(box.height, await item.evaluate((el) => el.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(43.5);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

const releaseAfter = releaseSocialConnectionsAfterEach();

test("also publish to connected blogs: empty state, modes, statuses, update, Harvest page off and planner chips", async ({ page }) => {
  test.setTimeout(1_200_000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  const email = await signIn(page);
  const tenant = (await (await post(page, "/api/workspaces", { name: "Grace Community Church", audience: "church" })).json()).tenantId as string;
  releaseAfter(tenant);
  const admin = new Client({ connectionString: await readFile(`${process.env.HARVEST_E2E_MAILBOX}.admin`, "utf8") });
  await admin.connect();
  try {
    const owner = (await admin.query("select id from users where email=$1", [email])).rows[0].id as string;
    const blogApi = `/api/workspaces/${tenant}/blog`;
    expect((await page.request.get(blogApi)).status()).toBe(200);
    const created = await (await post(page, `${blogApi}/posts`)).json() as { id: string; version: number };
    const title = "Advent hope for every home";
    const body = { type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "Advent is a season of waiting with hope. Join us each Sunday as we light the candles together." }] },
      { type: "paragraph", content: [{ type: "text", text: "https://www.youtube.com/watch?v=aqz-KE-bpKQ" }] },
    ] };
    const saved = await (await put(page, `${blogApi}/posts/${created.id}`, { version: created.version, title, slug: "advent-hope", excerpt: "Waiting with hope this Advent.",
      seoTitle: "Advent at Grace", body })).json() as { version: number };
    const editor = `/workspaces/${tenant}/blog/${created.id}`;
    const openPublish = async () => {
      await expect(page.locator("[data-blog-body], [data-blog-state]").first()).toBeVisible({ timeout: 180_000 });
      if (!(await page.locator("[data-blog-state]").isVisible())) await step(page, "Publish").click();
      await expect(page.locator("[data-blog-state]")).toBeVisible();
      await expect(page.locator("[data-blog-external]")).toBeVisible();
      await expect(page.locator('[data-blog-external][aria-busy="true"]')).toHaveCount(0);
    };

    // ---- Empty state: no connected blog links to the account connections ----------------------------------------------
    await page.goto(editor);
    await openPublish();
    const section = page.locator("[data-blog-external]");
    await expect(page.getByRole("heading", { name: "Also publish to" })).toBeVisible();
    await expect(section.getByText("No blogs connected")).toBeVisible();
    await expect(section.getByRole("link", { name: "Connect a blog" })).toHaveAttribute("href", `/workspaces/${tenant}/social/accounts`);
    await audit(page, "publish-empty", openPublish);

    // ---- Seeded connections and one blog each (synthetic) --------------------------------------------------------------
    const blogs = { wordpress: "Grace Journal", shopify: "Grace Shop Notes", wix: "Grace Stories", webflow: "Grace Events" } as const;
    const destinations: Record<string, string> = {};
    for (const [platform, name] of Object.entries(blogs)) {
      const connection = randomUUID();
      // The connection guard expects the signed-in person as its creator.
      await admin.query("begin");
      await admin.query("select set_config('app.user_id', $1, true)", [owner]);
      await admin.query(`insert into social_connections (tenant_id,id,provider,platform,external_account_ref,display_name,health,credential_envelope,created_by)
        values ($1,$2,'fake',$3,$4,$5,'healthy',$6,$7)`, [tenant, connection, platform, `e2e-${platform}-${tenant}`, name,
        JSON.stringify({ version: 1, keyId: "e2e", binding: "e2e", iv: "e2e", tag: "e2e", ciphertext: "e2e" }), owner]);
      await admin.query("commit");
      destinations[platform] = (await admin.query(`insert into blog_external_destinations (tenant_id,connection_id,blog_ref,title,platform,health,"authorization")
        values ($1,$2,'main',$3,$4,'healthy','authorized') returning id`, [tenant, connection, name, platform])).rows[0].id as string;
    }

    // The article is scheduled in Harvest, so "Same time" is available.
    const at = new Date(Date.now() + 2 * 86_400_000); at.setUTCHours(9, 0, 0, 0);
    const scheduled = await (await post(page, `${blogApi}/posts/${created.id}/state`, { action: "schedule", version: saved.version, at: at.toISOString() })).json() as { version: number };
    await page.reload();
    await openPublish();
    const row = (platform: keyof typeof blogs) => page.locator(`[data-blog-destination="${platform}"]`);
    await expect(page.locator("[data-blog-destination]")).toHaveCount(4);
    for (const platform of Object.keys(blogs) as (keyof typeof blogs)[]) {
      await expect(row(platform)).toContainText(blogs[platform]);
      await expect(row(platform)).toHaveAttribute("data-status", "none");
      await expect(row(platform).getByText("Not sent")).toBeVisible();
    }
    // Platform type only: the provider is never named.
    await expect(section).not.toContainText(/zernio/i);
    // Dropped-element warnings come from the server conversion.
    await expect(row("wix").locator("[data-blog-warnings]")).toContainText("Videos become links");
    await expect(row("webflow").locator("[data-blog-warnings]")).toContainText("The excerpt isn't sent");
    await expect(row("wordpress").locator("[data-blog-warnings]")).toContainText("Search title and description aren't sent");
    // A blog without its own scheduler takes no own time and no future same time.
    const webflowMode = row("webflow").getByLabel(/Timing/);
    await expect(webflowMode.locator('option[value="own_time"]')).toBeDisabled();
    await expect(webflowMode.locator('option[value="same_time"]')).toBeDisabled();
    await expect(row("wordpress").getByLabel(/Timing/)).toHaveValue("same_time");

    // ---- Modes: same time, draft and own time go to the queue through the real route ------------------------------------
    await row("wordpress").getByRole("button", { name: "Send on Grace Journal" }).click();
    await expect(page.getByText("Queued for Grace Journal").first()).toBeVisible();
    await expect(row("wordpress")).toHaveAttribute("data-status", "queued");
    await row("shopify").getByLabel(/Timing/).selectOption("draft");
    await row("shopify").getByRole("button", { name: "Send on Grace Shop Notes" }).click();
    await expect(row("shopify")).toHaveAttribute("data-status", "queued");
    await row("wix").getByLabel(/Timing/).selectOption("own_time");
    const own = row("wix").getByLabel(/Date and time/);
    await expect(own).toBeVisible();
    await own.fill(`${at.toISOString().slice(0, 10)}T18:30`);
    await row("wix").getByRole("button", { name: "Send on Grace Stories" }).click();
    await expect(row("wix")).toHaveAttribute("data-status", "queued");
    await row("webflow").getByRole("button", { name: "Send on Grace Events" }).click();
    await expect(row("webflow")).toHaveAttribute("data-status", "queued");
    const deliveries = (await admin.query("select destination_id, mode, requested_at from blog_external_deliveries where tenant_id=$1", [tenant])).rows;
    const modeOf = (platform: string) => deliveries.find((d) => d.destination_id === destinations[platform])?.mode;
    expect([modeOf("wordpress"), modeOf("shopify"), modeOf("wix"), modeOf("webflow")]).toEqual(["same_time", "draft", "own_time", "draft"]);
    expect(new Date(deliveries.find((d) => d.destination_id === destinations.wordpress)!.requested_at).toISOString()).toBe(at.toISOString());
    await audit(page, "publish-queued", openPublish);

    // ---- Worker outcomes (set locally: no worker runs here) ------------------------------------------------------------
    const outcome = async (platform: string, status: string, url: string | null, reason: string | null = null, pushedVersion = scheduled.version) => {
      await admin.query("update blog_external_jobs set finished_at=now(), payload=null where tenant_id=$1 and finished_at is null and delivery_id in (select id from blog_external_deliveries where destination_id=$2)", [tenant, destinations[platform]]);
      await admin.query(`update blog_external_deliveries set status=$2, reason=$3, remote_id=$4, remote_url=$5, pushed_version=$6, content_hash=repeat('a',64), pushed_at=now(), checked_at=now()
        where destination_id=$1`, [destinations[platform], status, reason, status === "failed" ? null : `remote-${platform}`, url, pushedVersion]);
    };
    await outcome("wordpress", "scheduled_on_blog", null);
    await outcome("shopify", "draft_on_blog", null);
    await outcome("wix", "published", "https://stories.example.invalid/advent-hope");
    await outcome("webflow", "failed", null, "unavailable");
    await page.reload();
    await openPublish();
    await expect(row("wordpress").getByText("Scheduled", { exact: true })).toBeVisible();
    await expect(row("shopify").getByText("Draft", { exact: true }).first()).toBeVisible();
    await expect(row("wix").getByText("Published", { exact: true })).toBeVisible();
    await expect(row("webflow").getByText("Failed", { exact: true })).toBeVisible();
    await expect(row("wix").getByRole("link", { name: "Open copy on Grace Stories" })).toHaveAttribute("href", "https://stories.example.invalid/advent-hope");
    // The copy is current: no update button until the article changes.
    await expect(page.getByRole("button", { name: /^Update on / })).toHaveCount(0);
    await audit(page, "publish-statuses", openPublish);

    // ---- The copy changed: "Update on <blog>" appears and queues an explicit update -------------------------------------
    await step(page, "Settings and SEO").click();
    await page.getByLabel("Excerpt", { exact: true }).fill("Waiting with hope this Advent, together.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved.").first()).toBeVisible();
    await step(page, "Publish").click();
    await expect(row("wix").getByRole("button", { name: "Update on Grace Stories" })).toBeVisible();
    await expect(row("wordpress").getByRole("button", { name: "Update on Grace Journal" })).toBeVisible();
    await expect(row("webflow").getByRole("button", { name: /^Update on / })).toHaveCount(0);
    await admin.query("update blog_external_deliveries set status='changed_on_blog' where destination_id=$1", [destinations.shopify]);
    await page.reload();
    await openPublish();
    await expect(row("shopify").getByText("Changed on blog")).toBeVisible();
    await audit(page, "publish-update", openPublish);
    await row("wix").getByRole("button", { name: "Update on Grace Stories" }).click();
    await expect(row("wix")).toHaveAttribute("data-status", "queued");
    const jobs = (await admin.query("select j.operation from blog_external_jobs j join blog_external_deliveries d on (d.tenant_id,d.id)=(j.tenant_id,j.delivery_id) where d.destination_id=$1 and j.finished_at is null", [destinations.wix])).rows;
    expect(jobs).toEqual([{ operation: "update" }]);
    await tapTargets(page);

    // ---- Harvest page off: saved with the article; the article keeps its schedule and copies ----------------------------
    const harvestPage = page.getByRole("switch", { name: "Harvest blog page" });
    await expect(harvestPage).toBeChecked();
    await harvestPage.click();
    await expect(harvestPage).not.toBeChecked();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved.").first()).toBeVisible();
    const stored = await (await page.request.get(`${blogApi}/posts/${created.id}`)).json() as { post: { harvestPage: boolean; status: string } };
    expect(stored.post).toMatchObject({ harvestPage: false, status: "scheduled" });
    await page.reload();
    await openPublish();
    await expect(page.getByRole("switch", { name: "Harvest blog page" })).not.toBeChecked();
    await expect(page.locator("[data-blog-destination]")).toHaveCount(4);
    await audit(page, "publish-harvest-page-off", openPublish);

    // ---- Planner: each blog copy has its own chip at its blog time; a chip opens the article ----------------------------
    // WordPress shares the article's time (it sits in the overlap list); Wix has its own time the same evening.
    const planner = `/workspaces/${tenant}/social/planner?view=calendar&mode=week&week=${at.toISOString().slice(0, 10)}`;
    const wixChip = () => page.getByRole("button", { name: new RegExp(`Wix copy, Queued, ${title}`) }).first();
    const plannerReady = async () => { await expect(wixChip()).toBeVisible({ timeout: 180_000 }); };
    await page.goto(planner);
    await plannerReady();
    await page.getByTestId("overlap-more").first().click();
    await expect(page.getByTestId("overlap-row").filter({ hasText: title }).getByText(new RegExp(`WordPress copy, Scheduled, ${title}`))).toBeAttached();
    await expect(page.getByTestId("overlap-row").filter({ hasText: title }).getByText(new RegExp(`Article, Scheduled`))).toBeAttached();
    await page.keyboard.press("Escape");
    // Desktop evidence of both chips: the 9 AM group opened, then the evening copy.
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); await page.reload(); await plannerReady();
      await wixChip().scrollIntoViewIfNeeded(); await settleForAxe(page);
      await page.screenshot({ path: `${evidence}/planner-week-evening-desktop-${scheme}.png` });
      await page.getByTestId("overlap-more").first().scrollIntoViewIfNeeded(); await page.getByTestId("overlap-more").first().click();
      await expect(page.getByTestId("overlap-list")).toBeVisible(); await settleForAxe(page);
      await page.screenshot({ path: `${evidence}/planner-week-overlap-desktop-${scheme}.png` });
      await page.keyboard.press("Escape");
    }
    // Phones: the day agenda lists the article and each copy as rows that open the article.
    const phoneReady = async () => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.getByRole("button", { name: new RegExp(`^${at.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}`) }).click();
      await expect(page.getByTestId("planner-blog-row").filter({ hasText: "WordPress copy" })).toBeVisible();
      await expect(page.getByTestId("planner-blog-row").filter({ hasText: "Wix copy" })).toBeVisible();
      await expect(page.getByTestId("planner-blog-row").filter({ hasText: "Article" })).toBeVisible();
      await expect(page.getByTestId("planner-blog-row").filter({ hasText: "Shopify copy" })).toHaveCount(0);
    };
    await phoneReady();
    await audit(page, "planner-agenda", phoneReady);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await audit(page, "planner-week", plannerReady);
    await page.goto(`/workspaces/${tenant}/social/planner?view=calendar&mode=month&month=${at.toISOString().slice(0, 7)}`);
    const monthReady = async () => { await expect(page.getByText(new RegExp(`Wix copy, Queued, ${title}`)).first()).toBeAttached({ timeout: 180_000 }); };
    await monthReady();
    await audit(page, "planner-month", monthReady);
    await page.goto(planner);
    await plannerReady();
    await wixChip().click();
    await expect(page).toHaveURL(new RegExp(`${editor}$`), { timeout: 180_000 });
    expect(errors).toEqual([]);
  } finally {
    await admin.end();
  }
});
