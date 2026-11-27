import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

const expect = baseExpect.configure({ timeout: 20000 });
// Native blog: write an article in the shared editor, set its address and SEO, schedule it (it shows in the Social Planner), publish it and read it on
// the public blog, the article page and the RSS feed. Axe at 1280 and 360 in light and dark on the owner list, the editor and both public pages.
test.use({ actionTimeout: 20000, reducedMotion: "reduce" });
const evidence = process.env.BLOG_SHOTS ?? "docs/screenshots/blog";
const sizes = [["phone", 360, 800], ["desktop", 1280, 900]] as const;
const post = (page: Page, url: string, data: unknown = {}) => page.request.post(url, { headers: { origin }, data });

async function audit(page: Page, name: string, ready: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.reload();
    await expect(page.locator(ready).first()).toBeVisible();
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await settleForAxe(page);
      const found = (await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations;
      expect(found.map((v) => `${name} ${label}/${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${label}/${scheme} overflow`).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
}
const step = (page: Page, name: string) => { const label = new RegExp(`^${name}\\s+(Done|Current step|Needs attention|Not started|Completed|Upcoming)`);
  return page.getByRole("button", { name: label }).or(page.getByRole("link", { name: label })).or(page.getByRole("tab", { name: label })).first(); };

test("write, schedule, publish and read an article publicly", async ({ page }) => {
  test.setTimeout(1_200_000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  // Compile the sign-in and public routes first: a busy shared runner can take longer than a request's default patience on a first compile.
  for (const path of ["/api/auth/email-otp/send-verification-otp", "/blog/warm-up", "/blog/warm-up/rss.xml"]) await page.request.get(path, { timeout: 240_000 }).catch(() => undefined);
  // An unknown blog address answers 404 (checked on the already compiled route).
  expect((await page.request.get("/blog/no-such-blog-here", { timeout: 240_000 })).status()).toBe(404);
  await signIn(page);
  const ministry = `Grace Fellowship ${Date.now().toString(36)}`;
  const tenant = (await (await post(page, "/api/workspaces", { name: ministry, audience: "church" })).json()).tenantId as string;
  const list = `/workspaces/${tenant}/blog`;

  // The list opens empty with the blog created from the ministry name.
  await page.goto(list);
  await expect(page.getByRole("heading", { name: "Blog", exact: true })).toBeVisible();
  await expect(page.getByText("No articles yet")).toBeVisible();
  await audit(page, "list-empty", "text=No articles yet");

  // Blog settings: name and intro (the address follows the ministry name).
  await page.getByRole("button", { name: "Blog settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Blog name").fill("Grace Fellowship Blog");
  await dialog.getByLabel("Intro").fill("News, teaching and stories from our church family.");
  const handle = await dialog.getByLabel("Blog address").inputValue();
  expect(handle).toMatch(/^grace-fellowship-/);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  // Write: a new draft opens in the editor.
  await page.getByRole("button", { name: "New article" }).click();
  await expect(page).toHaveURL(new RegExp(`${list}/[0-9a-f-]{36}$`), { timeout: 180_000 });
  await expect(page.locator("[data-blog-body] .docs-prose")).toBeVisible({ timeout: 180_000 });
  await page.getByLabel("Title", { exact: true }).fill("Advent hope for every home");
  const body = page.getByRole("textbox", { name: "Article text" });
  await body.click();
  await page.keyboard.type("Advent is a season of waiting with hope. Join us each Sunday as we light the candles together.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.").first()).toBeVisible();
  await expect(page.locator("[data-blog-body]")).toBeVisible();
  // The title, status and Publish now sit in the app header; the composer holds only the title, the cover action, the toolbar and the text.
  await expect(page.locator("[data-shell-header-trail]")).toContainText("Advent hope for every home");
  await expect(page.locator("[data-shell-header-trail]").getByRole("button", { name: "Publish now" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add cover" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add picture" })).toBeVisible();
  await audit(page, "editor-write", "[data-blog-body] .docs-prose");
  // A 200-character title truncates in the header at tablet and desktop widths: no sideways overflow, Publish now stays in view.
  const titleBox = page.getByLabel("Title", { exact: true });
  await titleBox.fill("Advent ".repeat(29).slice(0, 200));
  for (const width of [768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await settleForAxe(page);
    const header = await page.locator("[data-shell-header]").evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(header.scroll, `header overflow at ${width}`).toBeLessThanOrEqual(header.client);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `page overflow at ${width}`).toBe(true);
    const publish = page.locator("[data-shell-header-trail]").getByRole("button", { name: "Publish now" });
    await expect(publish).toBeInViewport();
    const box = (await publish.boundingBox())!;
    expect(box.x + box.width, `Publish now inside the viewport at ${width}`).toBeLessThanOrEqual(width);
  }
  await titleBox.fill("Advent hope for every home");
  await page.setViewportSize({ width: 1280, height: 900 });

  // Settings and SEO: the address came from the title; excerpt and SEO fields feed the search preview.
  await step(page, "Settings and SEO").click();
  await expect(page.locator("#blog-slug")).toHaveValue("advent-hope-for-every-home");
  await page.getByLabel("Excerpt", { exact: true }).fill("Waiting with hope this Advent.");
  await expect(page.getByText("30 of 300")).toBeVisible();
  await page.getByLabel("SEO title", { exact: true }).fill("Advent at Grace Fellowship");
  await page.getByLabel("SEO description", { exact: true }).fill("Light the Advent candles with us every Sunday in December.");
  const preview = page.locator("[data-blog-search-preview]:visible").first();
  await expect(preview).toContainText("Advent at Grace Fellowship");
  await expect(preview).toContainText("Light the Advent candles");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.").first()).toBeVisible();
  await audit(page, "editor-settings", "[data-blog-search-preview]:visible");

  // Publish step: schedule for tomorrow 09:00 in the ministry's zone.
  await step(page, "Publish").click();
  await expect(page.getByText(/Time zone: UTC/)).toBeVisible();
  const slot = await page.getByLabel("Publish at").inputValue();
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(page.locator("[data-blog-state]")).toContainText("Scheduled");
  await audit(page, "editor-publish", "[data-blog-state]");
  // Not public while scheduled.
  expect((await page.request.get(`/blog/${handle}/advent-hope-for-every-home`)).status()).toBe(404);

  // The scheduled article sits in the Social Planner's week view; it opens the editor.
  await page.goto(`/workspaces/${tenant}/social/planner?view=calendar&mode=week&week=${slot.slice(0, 10)}`);
  const chip = page.getByRole("button", { name: /Article, Scheduled, Advent hope for every home/ }).first();
  await expect(chip).toBeVisible({ timeout: 180_000 });
  await chip.click();
  await expect(page).toHaveURL(new RegExp(`${list}/[0-9a-f-]{36}$`), { timeout: 180_000 });

  // The list shows it as scheduled; publishing now from the editor makes it public at once.
  await step(page, "Publish").click();
  await page.getByRole("button", { name: "Publish now" }).first().click();
  await expect(page.locator("[data-blog-state]")).toContainText("Published");
  await step(page, "Settings and SEO").click();
  await expect(page.locator("#blog-slug")).toBeDisabled();
  await expect(page.getByText("Fixed after the first publish.")).toBeVisible();

  // A second article stays a draft and never appears publicly.
  await page.goto(list);
  await page.getByRole("button", { name: "New article" }).click();
  await expect(page).toHaveURL(new RegExp(`${list}/[0-9a-f-]{36}$`), { timeout: 180_000 });
  await expect(page.locator("[data-blog-body] .docs-prose")).toBeVisible({ timeout: 180_000 });
  await page.getByLabel("Title", { exact: true }).fill("Private draft notes");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.").first()).toBeVisible();

  await page.goto(list);
  await expect(page.getByRole("tab", { name: /Published/ })).toContainText("1");
  await expect(page.getByRole("tab", { name: /Drafts/ })).toContainText("1");
  await audit(page, "list", "[data-slot=table], [data-data-table], table");

  // Public blog index and article: meta, canonical, Open Graph, RSS.
  await page.goto(`/blog/${handle}`);
  await expect(page.getByRole("heading", { level: 1, name: "Grace Fellowship Blog" })).toBeVisible({ timeout: 180_000 });
  await expect(page.locator("[data-blog-card]")).toHaveCount(1);
  await expect(page.getByText("Private draft notes")).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/blog/${handle}$`));
  await expect(page.locator('link[type="application/rss+xml"]')).toHaveAttribute("href", new RegExp(`/blog/${handle}/rss.xml$`));
  await audit(page, "public-index", "[data-blog-card]");
  await page.locator("[data-blog-card] a").first().click();
  await expect(page).toHaveURL(new RegExp(`/blog/${handle}/advent-hope-for-every-home$`));
  await expect(page.getByRole("heading", { level: 1, name: "Advent hope for every home" })).toBeVisible({ timeout: 180_000 });
  await expect(page.locator("[data-blog-article]")).toContainText("Join us each Sunday");
  await expect(page).toHaveTitle(/Advent at Grace Fellowship/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Light the Advent candles with us every Sunday in December.");
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "article");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/blog/${handle}/advent-hope-for-every-home$`));
  await audit(page, "public-article", "[data-blog-article]");
  const feed = await page.request.get(`/blog/${handle}/rss.xml`);
  expect(feed.status()).toBe(200);
  expect(feed.headers()["content-type"]).toContain("application/rss+xml");
  const xml = await feed.text();
  expect(xml).toContain("<title>Grace Fellowship Blog</title>");
  expect(xml).toContain("Advent hope for every home");
  expect(xml).not.toContain("Private draft notes");
  expect((await page.request.get(`/blog/${handle}/private-draft-notes`)).status()).toBe(404);
  expect(errors).toEqual([]);
});
