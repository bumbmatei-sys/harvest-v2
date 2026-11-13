import { mkdir } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";

// C15a: in-app notifications (bell, list, settings), announcements, host queue and the welcome card.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/communities-c15a";
const sizes = [["phone", 390, 844], ["tablet", 768, 1024], ["desktop", 1440, 1000]] as const;
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

async function shoot(page: Page, name: string, prepare?: () => Promise<void>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.reload(); await page.waitForTimeout(500);
    await prepare?.();
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
async function person(browser: Browser, errors: string[], name: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  expect((await page.request.put("/api/account/profile", { headers: { origin }, data: { name, locale: null, cityRegion: null } })).ok()).toBe(true);
  return { context, page };
}
async function join(page: Page, slug: string) {
  await page.goto(`/communities/${slug}`);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Join Youth Group" });
  await dialog.getByLabel("I confirm I am 18 or older").click();
  await dialog.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/communities/${slug}/forum$`));
}

test("bell, notification list, settings, announcements, host queue and the welcome card", async ({ page, browser }) => {
  test.setTimeout(480000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const slug = `youth-${Date.now().toString(36)}`;
  const community = (await (await page.request.post(`/api/workspaces/${tenant}/communities`, { headers: { origin }, data: { name: "Youth Group", slug } })).json()) as { id: string };
  const api = `/api/workspaces/${tenant}/communities/${community.id}`;
  const editUrl = `/workspaces/${tenant}/communities/${community.id}/edit`;
  let current = (await (await page.request.get(api)).json()) as { version: number };
  current = (await (await page.request.patch(api, { headers: { origin }, data: { version: current.version, visibility: "listed", allowOpen: true } })).json());
  expect((await page.request.post(`${api}/publish`, { headers: { origin }, data: { version: current.version, published: true } })).ok()).toBe(true);
  const general = ((await (await page.request.get(`${api}/categories`)).json()) as { id: string }[])[0].id;
  const news = (await (await page.request.post(`${api}/categories`, { headers: { origin }, data: { name: "Announcements", emoji: null, hostsOnly: true } })).json()) as { id: string };
  const intros = (await (await page.request.post(`${api}/categories`, { headers: { origin }, data: { name: "Introductions", emoji: null, hostsOnly: false } })).json()) as { id: string };
  const newPost = (p: Page, title: string, category = general) => p.request.post(`/api/communities/${slug}/posts`, { headers: { origin },
    data: { categoryId: category, title, body: doc("Hello everyone"), videoUrl: null, coverFileId: null, attachmentIds: [], commentsOff: false, likesOff: false } });

  // The owner sets the welcome message and the introductions category in the editor (People step).
  await page.goto(editUrl);
  await page.getByRole("navigation", { name: "Community setup" }).getByRole("button", { name: /People/ }).click();
  await page.getByLabel("Welcome message").fill("Glad you are here. Say hello!");
  await page.getByLabel("Introductions category").click();
  await page.getByRole("option", { name: "Introductions" }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await shoot(page, "editor-welcome", async () => { await page.getByRole("navigation", { name: "Community setup" }).getByRole("button", { name: /People/ }).click(); });

  const author = await person(browser, errors, "Andrew"), friend = await person(browser, errors, "Rebecca");
  try {
    await join(author.page, slug); await join(friend.page, slug);
    const a = author.page, f = friend.page;

    // Welcome card first: message, rules hidden (none set), introduction shortcut, notifications, dismiss.
    await a.goto(`/communities/${slug}/forum`);
    const welcome = a.getByRole("region", { name: "Welcome" }).or(a.locator("[aria-labelledby='welcome-title']"));
    await expect(welcome.getByText("Glad you are here. Say hello!")).toBeVisible();
    await expect(welcome.getByRole("link", { name: "Read the rules" })).toHaveCount(0);
    await shoot(a, "welcome-card");
    await welcome.getByRole("button", { name: "Choose notifications" }).click();
    await expect(a.getByRole("dialog", { name: "Notification settings" })).toBeVisible();
    await a.keyboard.press("Escape");
    await welcome.getByRole("link", { name: "Introduce yourself" }).click();
    const composer = a.getByRole("dialog", { name: "New post" });
    await expect(composer).toBeVisible();
    await expect(composer.getByLabel("Category")).toContainText("Introductions");
    await a.keyboard.press("Escape");
    await a.goto(`/communities/${slug}/forum`);
    await a.getByRole("button", { name: "Dismiss welcome" }).click();
    await expect(a.getByText("Glad you are here. Say hello!")).toHaveCount(0);
    await a.reload();
    await expect(a.getByText("Glad you are here. Say hello!")).toHaveCount(0);
    // The other member still sees theirs.
    await f.goto(`/communities/${slug}/forum`);
    await expect(f.getByText("Glad you are here. Say hello!")).toBeVisible();

    // Reply and like: the author sees the bell count, the list and a link to the post.
    const post = (await (await newPost(a, "Prayer meeting")).json()) as { id: string };
    expect((await f.request.post(`/api/communities/${slug}/posts/${post.id}/comments`, { headers: { origin }, data: { body: "Count me in" } })).ok()).toBe(true);
    expect((await f.request.post(`/api/communities/${slug}/likes`, { headers: { origin }, data: { targetType: "post", targetId: post.id } })).ok()).toBe(true);
    await a.goto(`/communities/${slug}/forum`);
    const bell = a.getByRole("button", { name: "Notifications, 2 unread" });
    await expect(bell).toBeVisible();
    await bell.click();
    const list = a.getByRole("dialog").or(a.locator("[data-slot='popover-content']")).first();
    await expect(list.getByText("Rebecca replied to your post")).toBeVisible();
    await expect(list.getByText("Rebecca liked your post")).toBeVisible();
    await shoot(a, "bell-list", async () => { await a.getByRole("button", { name: /Notifications/ }).first().click(); });
    await a.getByRole("button", { name: /Rebecca replied to your post/ }).click();
    await expect(a).toHaveURL(new RegExp(`/communities/${slug}/posts/${post.id}$`));
    await expect(a.getByRole("button", { name: "Notifications, 1 unread" })).toBeVisible();
    await a.getByRole("button", { name: "Notifications, 1 unread" }).click();
    await a.getByRole("button", { name: "Mark all read" }).click();
    await expect(a.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
    await a.keyboard.press("Escape");

    // Settings: mute likes, then a new like adds nothing.
    await a.getByRole("button", { name: "Notifications", exact: true }).click();
    await a.getByRole("button", { name: "Notification settings" }).click();
    const sheet = a.getByRole("dialog", { name: "Notification settings" });
    await sheet.getByLabel("Likes").click();
    await shoot(a, "settings", async () => { await a.getByRole("button", { name: "Notifications", exact: true }).click(); await a.getByRole("button", { name: "Notification settings" }).click(); await a.getByRole("dialog", { name: "Notification settings" }).getByLabel("Likes").click(); });
    await a.getByRole("dialog", { name: "Notification settings" }).getByRole("button", { name: "Save", exact: true }).click();
    await expect(a.getByRole("dialog", { name: "Notification settings" })).toBeHidden();
    const second = (await (await newPost(a, "Youth night")).json()) as { id: string };
    expect((await f.request.post(`/api/communities/${slug}/likes`, { headers: { origin }, data: { targetType: "post", targetId: second.id } })).ok()).toBe(true);
    await a.goto(`/communities/${slug}/forum`);
    await expect(a.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();

    // Host queue: a report notifies the owner.
    expect((await f.request.post(`/api/communities/${slug}/reports`, { headers: { origin }, data: { targetType: "post", targetId: post.id, reason: "spam", note: "" } })).ok()).toBe(true);
    await page.goto(`/communities/${slug}/forum`);
    await page.getByRole("button", { name: "Notifications, 1 unread" }).click();
    await expect(page.getByText("An item needs review")).toBeVisible();
    await page.getByRole("button", { name: /An item needs review/ }).click();
    await expect(page).toHaveURL(new RegExp(`/communities/${slug}/moderation$`));

    // Announcements: a post in the hosts-only category reaches the member without any stored row.
    expect((await newPost(page, "Camp registration is open", news.id)).ok()).toBe(true);
    await f.goto(`/communities/${slug}/forum`);
    await f.getByRole("button", { name: /Notifications/ }).first().click();
    await expect(f.getByText("Youth Group posted an announcement").or(f.getByText(/posted an announcement/))).toBeVisible();
    await f.keyboard.press("Escape");
    await f.reload();
    await expect(f.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
    void intros;
    expect(errors).toEqual([]);
  } finally { await author.context.close(); await friend.context.close(); }
});
