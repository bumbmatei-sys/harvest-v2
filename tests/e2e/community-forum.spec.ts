import { mkdir } from "node:fs/promises";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { joinAndWaitForForum, waitForCommunityResponse } from "./helpers/community";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

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
      await settleForAxe(page);
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
  await joinAndWaitForForum(page, slug, dialog.getByRole("button", { name: "Join", exact: true }));
}

async function attachFile(page: Page, slug: string, button: Locator, file: { name: string; mimeType: string; buffer: Buffer }) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), button.click()]);
  const filesPath = `/api/communities/${slug}/files`;
  const [created, confirmed] = await Promise.all([
    waitForCommunityResponse(page, "POST", filesPath),
    waitForCommunityResponse(page, "POST", new RegExp(`^${filesPath}/[^/]+/confirm$`)),
    chooser.setFiles(file),
  ]);
  const { file: { id } } = await created.json();
  expect(new URL(confirmed.url()).pathname).toBe(`${filesPath}/${id}/confirm`);
  expect(await confirmed.json()).toMatchObject({ id, name: file.name, status: "ready" });
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
    await a.getByRole("button", { name: "What's on your mind?", exact: true }).click();
    const composer = a.getByRole("dialog", { name: "New post" });
    await composer.getByLabel("Title", { exact: true }).fill("Romans reading plan");
    await composer.getByLabel("Category", { exact: true }).click();
    await expect(a.getByRole("option", { name: /Announcements/ })).toHaveCount(0);
    await a.getByRole("option", { name: "General", exact: true }).click();
    // Forum composer (27 Nov): photos from the icon row; the video link and files from Attach.
    await attachFile(a, slug, composer.getByRole("button", { name: "Photo", exact: true }),
      { name: "cover.png", mimeType: "image/png", buffer: png });
    await expect(composer.getByRole("img", { name: "Photo 1 of 1" })).toBeVisible();
    await composer.getByRole("button", { name: "Attach", exact: true }).click();
    await composer.getByRole("button", { name: "Video link", exact: true }).click();
    await composer.getByLabel("Video link", { exact: true }).fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await composer.getByRole("button", { name: "Attach", exact: true }).click();
    await attachFile(a, slug, composer.getByRole("button", { name: "File", exact: true }),
      { name: "plan.pdf", mimeType: "application/pdf", buffer: pdf });
    await expect(composer.getByText("plan.pdf", { exact: true })).toBeVisible();
    const body = composer.getByRole("textbox", { name: "Post", exact: true });
    await body.click();
    await composer.getByRole("button", { name: "Heading", exact: true }).click();
    await a.keyboard.type("Week one"); await a.keyboard.press("Enter");
    await composer.getByRole("button", { name: "Bulleted list", exact: true }).click();
    await a.keyboard.type("Chapters 1-4"); await a.keyboard.press("Enter"); await a.keyboard.type("Chapters 5-8");
    const [published] = await Promise.all([
      waitForCommunityResponse(a, "POST", `/api/communities/${slug}/posts`),
      composer.getByRole("button", { name: "Post", exact: true }).click(),
    ]);
    const { id } = await published.json();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const postUrl = `/communities/${slug}/posts/${id}`;
    await a.waitForURL(`**${postUrl}`);
    const clickAndRefreshPost = async (button: Locator, method: string, path: string) => {
      const page = button.page();
      await Promise.all([
        waitForCommunityResponse(page, method, path),
        waitForCommunityResponse(page, "GET", postUrl),
        button.click(),
      ]);
    };
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
    await clickAndRefreshPost(r.getByRole("button", { name: "Reply", exact: true }), "POST", `/api${postUrl}/comments`);
    await expect(r.getByText("Count me in.", { exact: true })).toBeVisible();
    // Members cannot pin; there is no host control for them in the post's menu.
    await r.getByRole("button", { name: /^More actions for / }).click();
    await expect(r.getByRole("menuitem", { name: "Copy link", exact: true })).toBeVisible();
    await expect(r.getByRole("menuitem", { name: "Report", exact: true })).toBeVisible();
    await expect(r.getByRole("menuitem", { name: "Pin", exact: true })).toHaveCount(0);
    await expect(r.getByRole("menuitem", { name: "Edit", exact: true })).toHaveCount(0);
    await r.keyboard.press("Escape");

    // The author edits the post.
    await a.reload();
    await a.getByRole("button", { name: /^More actions for / }).click();
    await a.getByRole("menuitem", { name: "Edit", exact: true }).click();
    const edit = a.getByRole("dialog", { name: "Edit post" });
    await edit.getByLabel("Title", { exact: true }).fill("Romans reading plan (updated)");
    await clickAndRefreshPost(edit.getByRole("button", { name: "Save", exact: true }), "PATCH", `/api${postUrl}`);
    await expect(a.getByRole("heading", { name: "Romans reading plan (updated)", level: 2 })).toBeVisible();
    await shoot(a, "post");

    // The host pins the post and removes the reply.
    await page.goto(postUrl);
    const moderationPath = `/api/communities/${slug}/moderation`;
    await page.getByRole("button", { name: /^More actions for / }).click();
    await clickAndRefreshPost(page.getByRole("menuitem", { name: "Pin", exact: true }), "POST", moderationPath);
    await page.getByRole("button", { name: /^More actions for / }).click();
    await expect(page.getByRole("menuitem", { name: "Unpin", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await clickAndRefreshPost(page.getByRole("button", { name: /Remove reply by/ }), "POST", moderationPath);
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
    await expect(a.getByRole("button", { name: "What's on your mind?", exact: true })).toBeVisible();
    await a.goto(`/communities/${slug}/forum`);
    await shoot(a, "forum");
    await shoot(a, "composer", async () => { await a.getByRole("button", { name: "What's on your mind?", exact: true }).click(); await expect(a.getByRole("dialog", { name: "New post" })).toBeVisible(); });

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

// C23 follow-up F2: the About page passes axe at desktop and phone width, light and dark, and every visible action is a 44px target on phone.
test("about: axe at 1280 and 360, light and dark, 44px actions", async ({ page }) => {
  test.setTimeout(240000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const slug = `about-${Date.now().toString(36)}`;
  const community = (await (await page.request.post(`/api/workspaces/${tenant}/communities`, { headers: { origin }, data: { name: "Bible Study", slug } })).json()) as { id: string };
  let current = (await (await page.request.get(`/api/workspaces/${tenant}/communities/${community.id}`)).json()) as { version: number };
  current = await (await page.request.patch(`/api/workspaces/${tenant}/communities/${community.id}`, { headers: { origin },
    data: { version: current.version, visibility: "listed", allowOpen: true, description: "We read through Romans together.\nEveryone is welcome.", rulesList: ["Be kind", "Stay on topic"] } })).json();
  expect((await page.request.post(`/api/workspaces/${tenant}/communities/${community.id}/publish`, { headers: { origin }, data: { version: current.version, published: true } })).ok()).toBe(true);

  await page.goto(`/communities/${slug}/about`);
  await expect(page.getByRole("heading", { name: "About", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rules", level: 3 })).toBeVisible();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const [label, width, height] of [["desktop", 1280, 900], ["phone", 360, 800]] as const) {
      await page.setViewportSize({ width, height });
      await page.reload();
      await expect(page.getByRole("heading", { name: "About", level: 2 })).toBeVisible();
      await settleForAxe(page);
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (label === "phone") {
        const targets = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("a[href], button, [role=button], [role=link], [role=tab], input, select, textarea")]
          .filter((el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && r.bottom > 0 && r.top < innerHeight * 4; })
          .map((el) => { const r = el.getBoundingClientRect(); return { name: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.tagName, width: Math.round(r.width), height: Math.round(r.height) }; }));
        // The shell's menu, bell and bottom bar are on the page, so there is always something to measure.
        expect(targets.length).toBeGreaterThan(3);
        expect(targets.filter((t) => t.width < 44 || t.height < 44)).toEqual([]);
      }
      await page.screenshot({ path: `${evidence}/about-${label}-${scheme}.png`, fullPage: true });
    }
  }
  expect(errors).toEqual([]);
});

// Forum redesign from the admin-dashboard social media page (27 Nov 2026): feed, post page and composer pass axe at 1280 and 360, light and dark,
// with no sideways scroll, and the post menu and actions are 44px targets on phones.
test("forum redesign: feed, post and composer at 1280 and 360, light and dark", async ({ page, browser }) => {
  test.setTimeout(420000);
  const shots = process.env.FORUM_SHOTS ?? "test-results/forum-kit";
  await mkdir(shots, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await stubEmbeds(page); await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const slug = `kit-${Date.now().toString(36)}`;
  const community = (await (await page.request.post(`/api/workspaces/${tenant}/communities`, { headers: { origin }, data: { name: "Bible Study", slug } })).json()) as { id: string };
  let current = (await (await page.request.get(`/api/workspaces/${tenant}/communities/${community.id}`)).json()) as { version: number };
  current = await (await page.request.patch(`/api/workspaces/${tenant}/communities/${community.id}`, { headers: { origin }, data: { version: current.version, visibility: "listed", allowOpen: true } })).json();
  expect((await page.request.post(`/api/workspaces/${tenant}/communities/${community.id}/publish`, { headers: { origin }, data: { version: current.version, published: true } })).ok()).toBe(true);
  const general = ((await (await page.request.get(`/api/workspaces/${tenant}/communities/${community.id}/categories`)).json()) as { id: string }[])[0].id;
  const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  const author = await person(browser, errors), reader = await person(browser, errors);
  try {
    const a = author.page, r = reader.page;
    for (const [who, name] of [[a, "Ruth Adams"], [r, "Samuel Cole"]] as const)
      expect((await who.request.put("/api/account/profile", { headers: { origin }, data: { name, locale: null, cityRegion: null } })).ok()).toBe(true);
    await join(a, slug); await join(r, slug);
    const post = (await (await a.request.post(`/api/communities/${slug}/posts`, { headers: { origin }, data: { categoryId: general, title: "Thursday study notes",
      body: doc("We finished Romans 8 this week. Bring your questions for next time."), videoUrl: null, coverFileId: null, attachmentIds: [], commentsOff: false, likesOff: false } })).json()) as { id: string };
    expect((await a.request.post(`/api/communities/${slug}/posts`, { headers: { origin }, data: { categoryId: general, title: "Prayer requests",
      body: doc("Share what we can pray for."), videoUrl: null, coverFileId: null, attachmentIds: [], commentsOff: false, likesOff: false } })).ok()).toBe(true);
    expect((await r.request.post(`/api/communities/${slug}/posts/${post.id}/comments`, { headers: { origin }, data: { body: "Thank you, see you Thursday." } })).ok()).toBe(true);
    expect((await r.request.post(`/api/communities/${slug}/likes`, { headers: { origin }, data: { targetType: "post", targetId: post.id } })).ok()).toBe(true);

    const scenes: [string, string, (() => Promise<void>)?][] = [
      ["feed", `/communities/${slug}/forum`],
      ["post", `/communities/${slug}/posts/${post.id}`],
      ["menu", `/communities/${slug}/posts/${post.id}`, async () => { await r.getByRole("button", { name: "More actions for Thursday study notes" }).click(); await expect(r.getByRole("menuitem", { name: "Report", exact: true })).toBeVisible(); }],
      ["composer", `/communities/${slug}/forum`, async () => { await r.getByRole("button", { name: "What's on your mind?", exact: true }).click(); await expect(r.getByRole("dialog", { name: "New post" })).toBeVisible(); }],
    ];
    for (const [name, url, prepare] of scenes) for (const scheme of ["light", "dark"] as const) {
      await r.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      for (const [label, width, height] of [["desktop", 1280, 900], ["phone", 360, 800]] as const) {
        await r.setViewportSize({ width, height });
        await r.goto(url);
        await expect(r.getByRole("article").first()).toBeVisible();
        await prepare?.();
        await settleForAxe(r);
        expect((await new AxeBuilder({ page: r }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations, `${name} ${label} ${scheme}`).toEqual([]);
        expect(await r.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${label} ${scheme}`).toBe(true);
        if (label === "phone" && name === "post") {
          for (const target of [r.getByRole("button", { name: "More actions for Thursday study notes" }), r.getByRole("button", { name: "Unlike Thursday study notes" }),
            r.getByRole("button", { name: "Write a reply" }), r.getByRole("button", { name: "Reply", exact: true })]) expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        if (label === "phone" && name === "feed") {
          for (const target of [r.getByRole("button", { name: "What's on your mind?", exact: true }), r.getByRole("button", { name: "Attach", exact: true }), r.getByRole("button", { name: "Photo", exact: true }),
            r.getByRole("link", { name: "All posts", exact: true }), r.getByRole("link", { name: "Best this week", exact: true })]) expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        await r.screenshot({ path: `${shots}/${name}-${label}-${scheme}.png`, fullPage: true });
      }
    }
    // A window opened from the post menu returns focus to the menu button when it closes.
    await r.setViewportSize({ width: 1280, height: 900 });
    await r.goto(`/communities/${slug}/posts/${post.id}`);
    const menu = r.getByRole("button", { name: "More actions for Thursday study notes" });
    await menu.click();
    await r.getByRole("menuitem", { name: "Report", exact: true }).click();
    await expect(r.getByRole("dialog", { name: "Report post" })).toBeVisible();
    await r.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    // The reply box focuses from the comment action, and Enter sends.
    await r.setViewportSize({ width: 1280, height: 900 });
    await r.goto(`/communities/${slug}/posts/${post.id}`);
    await r.getByRole("button", { name: "Write a reply" }).click();
    await expect(r.getByLabel("Reply", { exact: true })).toBeFocused();
    await r.keyboard.type("Amen.");
    await Promise.all([waitForCommunityResponse(r, "POST", `/api/communities/${slug}/posts/${post.id}/comments`), r.keyboard.press("Enter")]);
    await expect(r.getByText("Amen.", { exact: true })).toBeVisible();
    // The feed card links to the post from the reply count.
    await r.goto(`/communities/${slug}/forum`);
    await expect(r.getByRole("link", { name: "2 replies on Thursday study notes" })).toBeVisible();
    // The feed card's Attach shortcut opens the composer on the attach list; a member sees no linked-item kinds and no Event shortcut.
    await r.getByRole("button", { name: "Attach", exact: true }).click();
    const attach = r.getByRole("dialog", { name: "New post" }).getByRole("region", { name: "Attach" });
    await expect(attach.getByRole("button", { name: "Photo", exact: true })).toBeVisible();
    await expect(attach.getByRole("button", { name: "Event", exact: true })).toHaveCount(0);
    await r.keyboard.press("Escape");
    await expect(r.getByRole("button", { name: "Event", exact: true })).toHaveCount(0);
  } finally { await author.context.close(); await reader.context.close(); }
  expect(errors).toEqual([]);
});
