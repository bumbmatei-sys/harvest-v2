import { mkdir } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";

// PR 4b (C09 + C10): member layout and forum with full posts (rich text, cover, embedded video, attachment).
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/communities-pr4b";
const sizes = [["phone", 390, 844], ["tablet", 768, 1024], ["desktop", 1440, 1000]] as const;
// 1x1 PNG and a tiny PDF; storage and the scanner are local test doubles (scan "skipped" is released outside production).
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/eL9GtQAAAABJRU5ErkJggg==", "base64");
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

async function stubEmbeds(page: Page) {
  await page.route(/^https:\/\/(www\.youtube-nocookie\.com|player\.vimeo\.com)\//, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html lang=\"en\"><title>Player</title><body></body></html>" }));
}
async function shoot(page: Page, name: string, prepare?: () => Promise<void>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.reload(); await page.waitForTimeout(500);
    await prepare?.();
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).exclude("iframe").analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
async function person(browser: Browser, errors: string[]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await stubEmbeds(page); await signIn(page);
  return { context, page };
}
async function join(page: Page, slug: string) {
  await page.goto(`/communities/${slug}`);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Join Bible Study" });
  await dialog.getByLabel("I confirm I am 18 or older").click();
  await dialog.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/communities/${slug}/forum$`));
}

test("forum: categories, a full post, likes and replies, edits, pinning and removal", async ({ page, browser }) => {
  test.setTimeout(420000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await stubEmbeds(page); await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const slug = `study-${Date.now().toString(36)}`;
  const community = (await (await page.request.post(`/api/workspaces/${tenant}/communities`, { headers: { origin }, data: { name: "Bible Study", slug } })).json()) as { id: string };
  const editUrl = `/workspaces/${tenant}/communities/${community.id}/edit`;

  // Owner: joining settings, then forum categories in the Channels step.
  await page.goto(editUrl);
  const steps = page.getByRole("navigation", { name: "Community setup" });
  await steps.getByRole("button", { name: /Joining/ }).click();
  await page.getByLabel("Listed: appears in Discover", { exact: true }).click();
  await page.getByLabel("Anyone can join", { exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
  await header.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  await steps.getByRole("button", { name: /Channels/ }).click();
  const categories = page.getByRole("list", { name: "Forum categories" });
  await expect(categories.getByRole("listitem")).toHaveCount(1);
  await page.getByLabel("New category name", { exact: true }).fill("Announcements");
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  await expect(categories.getByRole("listitem")).toHaveCount(2);
  await page.getByLabel("Emoji for Announcements", { exact: true }).fill("📣");
  await page.getByLabel("Emoji for Announcements", { exact: true }).blur();
  await categories.getByRole("listitem").nth(1).getByRole("switch").click();
  await expect(categories.getByRole("listitem").nth(1).getByRole("switch")).toBeChecked();
  await page.getByRole("button", { name: "Move Announcements up", exact: true }).click();
  await expect(page.getByLabel("Category 1 name", { exact: true })).toHaveValue("Announcements");
  await shoot(page, "editor-channels", async () => { await steps.getByRole("button", { name: /Channels/ }).click(); await expect(categories.getByRole("listitem")).toHaveCount(2); });

  const author = await person(browser, errors), reader = await person(browser, errors);
  try {
    await join(author.page, slug); await join(reader.page, slug);

    // A member writes a full post; the hosts-only category is not offered.
    const a = author.page;
    await a.getByRole("button", { name: "New post", exact: true }).click();
    const composer = a.getByRole("dialog", { name: "New post" });
    await composer.getByLabel("Title", { exact: true }).fill("Romans reading plan");
    await composer.getByLabel("Category", { exact: true }).click();
    await expect(a.getByRole("option", { name: /Announcements/ })).toHaveCount(0);
    await a.getByRole("option", { name: "General", exact: true }).click();
    await composer.locator('input[type="file"][accept^="image/jpeg,image/png,image/webp"]').first().setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png });
    await expect(composer.getByText("cover.png", { exact: true })).toBeVisible();
    await composer.getByLabel("Video link", { exact: true }).fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await composer.locator('input[type="file"][accept*="application/pdf"]').setInputFiles({ name: "plan.pdf", mimeType: "application/pdf", buffer: pdf });
    await expect(composer.getByText("plan.pdf", { exact: true })).toBeVisible();
    const body = composer.getByRole("textbox", { name: "Post", exact: true });
    await body.click();
    await composer.getByRole("button", { name: "Heading", exact: true }).click();
    await a.keyboard.type("Week one"); await a.keyboard.press("Enter");
    await composer.getByRole("button", { name: "Bulleted list", exact: true }).click();
    await a.keyboard.type("Chapters 1-4"); await a.keyboard.press("Enter"); await a.keyboard.type("Chapters 5-8");
    await composer.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(a).toHaveURL(new RegExp(`/communities/${slug}/posts/[0-9a-f-]{36}$`));
    const postUrl = new URL(a.url()).pathname;
    const article = a.locator("article");
    await expect(article.getByRole("heading", { name: "Week one", level: 2 })).toBeVisible();
    await expect(article.getByRole("listitem").filter({ hasText: "Chapters 5-8" })).toBeVisible();
    await expect(a.locator('iframe[title="Video: Romans reading plan"]')).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    await expect(a.locator("iframe")).toHaveAttribute("sandbox", /allow-scripts/);
    await expect(article.locator("img").first()).toHaveJSProperty("naturalWidth", 1);
    const attachment = a.getByRole("link", { name: /plan\.pdf/ });
    expect((await a.request.get((await attachment.getAttribute("href"))!, { maxRedirects: 0 })).status()).toBe(302);

    // Another member likes it and replies.
    const r = reader.page;
    await r.goto(postUrl);
    await r.getByRole("button", { name: "Like Romans reading plan", exact: true }).click();
    await expect(r.getByRole("button", { name: "Unlike Romans reading plan", exact: true })).toBeVisible();
    await r.getByLabel("Reply", { exact: true }).fill("Count me in.");
    await r.getByRole("button", { name: "Reply", exact: true }).click();
    await expect(r.getByText("Count me in.", { exact: true })).toBeVisible();
    // Members cannot pin; there is no host control for them.
    await expect(r.getByRole("button", { name: "Pin", exact: true })).toHaveCount(0);

    // The author edits the post.
    await a.reload();
    await a.getByRole("button", { name: "Edit", exact: true }).click();
    const edit = a.getByRole("dialog", { name: "Edit post" });
    await edit.getByLabel("Title", { exact: true }).fill("Romans reading plan (updated)");
    await edit.getByRole("button", { name: "Save", exact: true }).click();
    await expect(a.getByRole("heading", { name: "Romans reading plan (updated)", level: 2 })).toBeVisible();
    await shoot(a, "post");

    // The host pins the post and removes the reply.
    await page.goto(postUrl);
    await page.getByRole("button", { name: "Pin", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unpin", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Remove reply by/ }).click();
    await expect(page.getByText("Count me in.", { exact: true })).toHaveCount(0);
    await r.reload();
    await expect(r.getByText("Count me in.", { exact: true })).toHaveCount(0);

    // Forum list: pinned first, categories column, sorts.
    await a.goto(`/communities/${slug}/forum`);
    const first = a.getByRole("main").locator("article").first();
    await expect(first.getByText("Pinned", { exact: true })).toBeVisible();
    await a.getByRole("link", { name: "Best this week", exact: true }).click();
    await expect(a).toHaveURL(/sort=best/);
    await a.getByRole("link", { name: /Announcements/ }).click();
    await expect(a.getByText("No posts yet", { exact: true })).toBeVisible();
    await expect(a.getByRole("button", { name: "New post", exact: true })).toBeVisible();
    await a.goto(`/communities/${slug}/forum`);
    await shoot(a, "forum");
    await shoot(a, "composer", async () => { await a.getByRole("button", { name: "New post", exact: true }).click(); await expect(a.getByRole("dialog", { name: "New post" })).toBeVisible(); });

    // A member cannot post into the hosts-only category through the API either.
    const cats = (await (await page.request.get(`/api/workspaces/${tenant}/communities/${community.id}/categories`)).json()) as { id: string; name: string }[];
    const hostsOnly = cats.find((c) => c.name === "Announcements")!.id;
    const denied = await a.request.post(`/api/communities/${slug}/posts`, { headers: { origin }, data: { categoryId: hostsOnly, title: "x",
      body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }, videoUrl: null, coverFileId: null, attachmentIds: [], commentsOff: false, likesOff: false } });
    expect(denied.status()).toBe(403);

    // Members and About; phone bottom bar.
    await a.goto(`/communities/${slug}/members`);
    await expect(a.getByRole("heading", { name: "3 members", level: 2 })).toBeVisible();
    await shoot(a, "members");
    await a.goto(`/communities/${slug}/about`);
    await expect(a.getByRole("heading", { name: "About", level: 2 })).toBeVisible();
    await a.setViewportSize({ width: 390, height: 844 });
    const bar = a.getByRole("navigation", { name: "Community" }).last();
    await bar.getByRole("link", { name: "Forum" }).click();
    await expect(a).toHaveURL(new RegExp(`/communities/${slug}/forum`));
    const box = await bar.getByRole("link", { name: "Forum" }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    // Someone who has not joined is sent to the public page.
    const outsider = await person(browser, errors);
    try {
      await outsider.page.goto(`/communities/${slug}/forum`);
      await expect(outsider.page).toHaveURL(new RegExp(`/communities/${slug}$`));
      expect((await outsider.page.request.get(`/api/communities/${slug}/files/${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}`, { maxRedirects: 0 })).status()).toBe(404);
    } finally { await outsider.context.close(); }
  } finally { await author.context.close(); await reader.context.close(); }
  expect(errors).toEqual([]);
});
