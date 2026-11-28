import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { joinAndWaitForForum, waitForCommunityResponse } from "./helpers/community";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// Forum composer (founder decisions 27 Nov 2026): icon row (Photo, Location, Feeling, Tag people, Attach), host item picker and Event shortcut,
// the full-screen phone composer and the collapsed phone card, and the "Who can create forum posts" setting. Synthetic data only.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const shots = process.env.FORUM_COMPOSER_SHOTS ?? "test-results/forum-composer";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/eL9GtQAAAABJRU5ErkJggg==", "base64");
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const widths = [["desktop", 1280, 900], ["phone", 360, 800]] as const;

/** The webpack dev server restarts itself near its memory limit and drops the request in flight; a direct API call is retried once after that. */
async function retrying<T>(call: () => Promise<T>): Promise<T> {
  try { return await call(); } catch (error) {
    if (!/ECONNRESET|ECONNREFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_REFUSED|ERR_ABORTED|socket hang up/.test(String(error))) throw error;
    await new Promise((resolve) => setTimeout(resolve, 15000));
    return call();
  }
}
async function admin() {
  const client = new Client({ connectionString: await readFile(`${process.env.HARVEST_E2E_MAILBOX}.admin`, "utf8") });
  await client.connect();
  return client;
}
async function person(browser: Browser, errors: string[], name: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  expect((await page.request.put("/api/account/profile", { headers: { origin }, data: { name, locale: null, cityRegion: null } })).ok()).toBe(true);
  return { context, page };
}
async function join(page: Page, slug: string) {
  await page.goto(`/communities/${slug}`);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Join Bible Study" });
  await dialog.getByLabel("I confirm I am 18 or older").click();
  await joinAndWaitForForum(page, slug, dialog.getByRole("button", { name: "Join", exact: true }));
}
async function attachPhoto(page: Page, slug: string, button: Locator) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), button.click()]);
  await Promise.all([
    waitForCommunityResponse(page, "POST", new RegExp(`^/api/communities/${slug}/files/[^/]+/confirm$`)),
    chooser.setFiles({ name: "supper.png", mimeType: "image/png", buffer: png }),
  ]);
}
/** Axe (WCAG 2.2 AA), no sideways scroll, and on phones every visible control (or the label that wraps it) is at least 44px, inline text links aside. */
async function audit(page: Page, name: string, scope?: Locator) {
  await settleForAxe(page);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations, name).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name).toBe(true);
  if ((page.viewportSize()?.width ?? 0) < 640) {
    const root = scope ? await scope.elementHandle() : null;
    const small = await page.evaluate((el) => [...(el ?? document).querySelectorAll<HTMLElement>("a[href], button, [role=button], [role=radio], [role=checkbox], [role=switch], input:not([type=file]), select, textarea, [role=combobox]")]
      // Inline text links (a post title, a tagged name) fall under the WCAG 2.5.8 inline exception.
      .filter((node) => { const r = node.getBoundingClientRect(), s = getComputedStyle(node); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && r.bottom > 0 && r.top < innerHeight && !(node.tagName === "A" && s.display === "inline"); })
      .map((node) => { const target = node.closest("label") ?? node, r = target.getBoundingClientRect(); return { name: node.getAttribute("aria-label") ?? node.textContent?.trim().slice(0, 40) ?? node.tagName, width: Math.round(r.width), height: Math.round(r.height) }; })
      .filter((t) => t.width < 44 || t.height < 44), root);
    expect(small, `${name}: targets under 44px`).toEqual([]);
  }
}
/** Screenshots leave out the development server's own overlay badge. */
async function hideDevOverlay(page: Page) { await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); }
async function shoot(page: Page, name: string) {
  await mkdir(shots, { recursive: true });
  await hideDevOverlay(page);
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

async function setup(page: Page) {
  await signIn(page);
  expect((await page.request.put("/api/account/profile", { headers: { origin }, data: { name: "Grace Host", locale: null, cityRegion: null } })).ok()).toBe(true);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const slug = `compose-${Date.now().toString(36)}`;
  const community = (await (await page.request.post(`/api/workspaces/${tenant}/communities`, { headers: { origin }, data: { name: "Bible Study", slug } })).json()) as { id: string };
  let current = (await (await page.request.get(`/api/workspaces/${tenant}/communities/${community.id}`)).json()) as { version: number };
  current = await (await page.request.patch(`/api/workspaces/${tenant}/communities/${community.id}`, { headers: { origin }, data: { version: current.version, visibility: "listed", allowOpen: true } })).json();
  expect((await page.request.post(`/api/workspaces/${tenant}/communities/${community.id}/publish`, { headers: { origin }, data: { version: current.version, published: true } })).ok()).toBe(true);
  const general = ((await (await page.request.get(`/api/workspaces/${tenant}/communities/${community.id}/categories`)).json()) as { id: string }[])[0].id;
  return { tenant, slug, community: community.id, general };
}

/** One published item of each kind the host can link: course, product, event (placed in the community), article and hosted form. */
async function seedItems(page: Page, tenant: string, communityId: string) {
  const db = await admin();
  try {
    const catalog = async (kind: "course" | "download", title: string) => (await db.query<{ id: string }>(
      "insert into catalog_items(tenant_id,kind,slug,title,state,visibility) values($1,$2,$3,$4,'published','listed') returning id", [tenant, kind, `${title.toLowerCase().replaceAll(" ", "-")}-${randomUUID().slice(0, 8)}`, title])).rows[0].id;
    const course = await catalog("course", "Walking with God"), product = await catalog("download", "Prayer journal");
    const event = (await db.query<{ id: string }>("insert into events(tenant_id,id,title,time_zone,starts_at,ends_at,status,published_at) values($1,gen_random_uuid(),'Harvest supper','UTC',now()+interval '1 day',now()+interval '1 day 2 hours','published',now()) returning id", [tenant])).rows[0].id;
    await db.query("insert into community_event_links(tenant_id,event_id,community_id) values($1,$2,$3)", [tenant, event, communityId]);
    const blog = `/api/workspaces/${tenant}/blog`;
    const { settings } = await (await page.request.get(blog)).json() as { settings: { version: number } };
    const saved = await page.request.put(blog, { headers: { origin }, data: { version: settings.version, handle: `grace-${Date.now().toString(36)}`, title: "Grace notes" } });
    expect(saved.ok(), await saved.text()).toBe(true);
    let draft = await (await page.request.post(`${blog}/posts`, { headers: { origin } })).json() as { id: string; version: number };
    const put = await page.request.put(`${blog}/posts/${draft.id}`, { headers: { origin }, data: { version: draft.version, title: "Sabbath rest", slug: "sabbath-rest", excerpt: "Rest well.", body: doc("Rest well this week.") } });
    expect(put.ok(), await put.text()).toBe(true);
    draft = await put.json();
    const live = await page.request.post(`${blog}/posts/${draft.id}/state`, { headers: { origin }, data: { action: "publish", version: draft.version } });
    expect(live.ok(), await live.text()).toBe(true);
    const article = draft.id;
    const { id: form } = await (await page.request.post(`/api/workspaces/${tenant}/crm/forms`, { headers: { origin }, data: { template: "prayer", destination: { type: "people" } } })).json() as { id: string };
    const { definition } = await (await page.request.get(`/api/workspaces/${tenant}/crm/forms/${form}`)).json() as { definition: { revision: number } };
    const published = await page.request.post(`/api/workspaces/${tenant}/crm/forms/${form}/publication`, { headers: { origin }, data: { action: "publish", slug: `prayer-${Date.now().toString(36)}`, revision: definition.revision } });
    expect(published.ok(), await published.text()).toBe(true);
    return { course, product, event, article, form };
  } finally { await db.end(); }
}

// The webpack dev server restarts itself near its memory limit, so the flows are split into tests that each fit one server run (run them with -g if needed).
test("member: shortcuts, icon row and attach kinds; posting with a photo, location, feeling and a mention", async ({ page, browser }) => {
  test.setTimeout(600000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  const { slug, general } = await setup(page);
  const member = await person(browser, errors, "Ruth Adams"), friend = await person(browser, errors, "Samuel Cole");
  try {
    const m = member.page;
    await join(m, slug); await join(friend.page, slug);

    // Member: Photo and Attach shortcuts, no Event; the icon row; Attach offers photos, a video link and files, never linked items.
    await m.goto(`/communities/${slug}/forum`);
    const shortcuts = m.getByRole("group", { name: "Add to your post" });
    await expect(shortcuts.getByRole("button")).toHaveText(["Photo", "Attach"]);
    await m.getByRole("button", { name: "What's on your mind?", exact: true }).click();
    const composer = m.getByRole("dialog", { name: "New post" });
    const icons = composer.getByRole("group", { name: "Add to your post" });
    for (const name of ["Photo", "Location", "Feeling", "Tag people", "Attach"]) await expect(icons.getByRole("button", { name, exact: true })).toBeVisible();
    await icons.getByRole("button", { name: "Attach", exact: true }).click();
    const attach = composer.getByRole("region", { name: "Attach" });
    await expect(attach.getByRole("button")).toHaveText(["Photo", "Video link", "File"]);
    expect((await m.request.get(`/api/communities/${slug}/posts/linkable-items?kind=event`)).status()).toBe(403);

    // Member posts with a photo, a location (with an Open in maps link), a feeling and a tagged member.
    await composer.getByLabel("Title", { exact: true }).fill("Supper photos");
    await composer.getByRole("textbox", { name: "Post", exact: true }).fill("What a night together.");
    await attachPhoto(m, slug, icons.getByRole("button", { name: "Photo", exact: true }));
    await expect(composer.getByRole("img", { name: "Photo 1 of 1" })).toBeVisible();
    await icons.getByRole("button", { name: "Location", exact: true }).click();
    await composer.getByRole("textbox", { name: "Location", exact: true }).fill("12 Main Street, Springfield");
    await expect(composer.getByRole("link", { name: "Open in maps" })).toHaveAttribute("href", "https://www.google.com/maps/search/?api=1&query=12%20Main%20Street%2C%20Springfield");
    await icons.getByRole("button", { name: "Feeling", exact: true }).click();
    await composer.getByRole("radio", { name: "grateful", exact: true }).click();
    await expect(composer.getByText("feeling grateful", { exact: true })).toBeVisible();
    await icons.getByRole("button", { name: "Tag people", exact: true }).click();
    await composer.getByLabel("Search members", { exact: true }).fill("Sam");
    await expect(composer.getByRole("checkbox", { name: "Grace Host", exact: true })).toHaveCount(0);
    await composer.getByRole("checkbox", { name: "Samuel Cole", exact: true }).click();
    await expect(composer.getByRole("button", { name: "Remove Samuel Cole", exact: true })).toBeVisible();
    const [posted] = await Promise.all([waitForCommunityResponse(m, "POST", `/api/communities/${slug}/posts`), composer.getByRole("button", { name: "Post", exact: true }).click()]);
    const memberPost = (await posted.json()).id as string;
    await m.waitForURL(`**/communities/${slug}/posts/${memberPost}`);
    const article = m.getByRole("article");
    await expect(article.getByText("feeling grateful", { exact: true })).toBeVisible();
    await expect(article.getByRole("link", { name: "Samuel Cole", exact: true })).toHaveAttribute("href", new RegExp(`/communities/${slug}/members/`));
    await expect(article.getByText("12 Main Street, Springfield", { exact: true })).toBeVisible();
    await expect(article.getByRole("link", { name: "Open in maps" })).toBeVisible();
    await expect(article.getByRole("img", { name: "Photo 1 of 1" })).toHaveJSProperty("naturalWidth", 1);
    // A member cannot link an item through the API either.
    expect((await retrying(() => m.request.post(`/api/communities/${slug}/posts`, { headers: { origin }, data: { categoryId: general, title: "x", body: doc("x"), videoUrl: null, coverFileId: null,
      attachmentIds: [], commentsOff: false, likesOff: false, postDetails: { photoIds: [], location: null, feeling: null, mentionIds: [], linkedItems: [{ kind: "event", id: crypto.randomUUID() }] } } }))).status()).toBe(403);

  } finally { await member.context.close(); await friend.context.close(); }
  expect(errors).toEqual([]);
});

test("host: Event shortcut and the picker for every item kind; linked cards and a removed item", async ({ page, browser }) => {
  test.setTimeout(600000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  const { tenant, slug, community } = await setup(page);
  const items = await seedItems(page, tenant, community);
  const member = await person(browser, errors, "Ruth Adams"), friend = await person(browser, errors, "Samuel Cole");
  try {
    const m = member.page;
    await join(m, slug); await join(friend.page, slug);
    // Host: Photo, Attach and Event shortcuts; Event opens the composer straight on the event picker.
    await page.goto(`/communities/${slug}/forum`);
    await expect(page.getByRole("group", { name: "Add to your post" }).getByRole("button")).toHaveText(["Photo", "Attach", "Event"]);
    await page.getByRole("group", { name: "Add to your post" }).getByRole("button", { name: "Event", exact: true }).click();
    const hostComposer = page.getByRole("dialog", { name: "New post" });
    const picker = hostComposer.getByRole("region", { name: "Choose event" });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("radio", { name: "Event", exact: true })).toBeChecked();
    await shoot(page, "picker-event-desktop-light");
    await picker.getByRole("button", { name: /Harvest supper/ }).click();
    await expect(picker.getByRole("button", { name: /Harvest supper/ })).toHaveAttribute("aria-pressed", "true");
    // Every other kind from the picker's kind chips, each with search.
    for (const [kind, title] of [["Article", "Sabbath rest"], ["Course", "Walking with God"], ["Product", "Prayer journal"], ["Form", /prayer/i]] as const) {
      await hostComposer.getByRole("radio", { name: kind, exact: true }).click();
      const region = hostComposer.getByRole("region", { name: `Choose ${kind.toLowerCase()}` });
      await expect(region).toBeVisible();
      await region.getByLabel("Search", { exact: true }).fill(typeof title === "string" ? title.slice(0, 5) : "pra");
      await expect(region.getByRole("button", { name: title })).toBeVisible();
      await shoot(page, `picker-${kind.toLowerCase()}-desktop-light`);
      await region.getByRole("button", { name: title }).click();
    }
    await expect(hostComposer.getByRole("list", { name: "Linked items" }).getByRole("listitem")).toHaveCount(5);
    await hostComposer.getByRole("button", { name: "Done", exact: true }).click();
    // The attach list for hosts names every kind.
    await hostComposer.getByRole("group", { name: "Add to your post" }).getByRole("button", { name: "Attach", exact: true }).click();
    await expect(hostComposer.getByRole("region", { name: "Attach" }).getByRole("button")).toHaveText(["Photo", "Video link", "File", "Article", "Product", "Course", "Event", "Form"]);
    await hostComposer.getByLabel("Title", { exact: true }).fill("This week at Grace");
    await hostComposer.getByRole("textbox", { name: "Post", exact: true }).fill("Join us for supper, read the article and sign up.");
    const [hosted] = await Promise.all([waitForCommunityResponse(page, "POST", `/api/communities/${slug}/posts`), hostComposer.getByRole("button", { name: "Post", exact: true }).click()]);
    const hostPost = (await hosted.json()).id as string;
    await page.waitForURL(`**/communities/${slug}/posts/${hostPost}`);
    const cards = page.getByRole("list", { name: "Linked items" });
    await expect(cards.getByRole("link", { name: /Harvest supper/ })).toHaveAttribute("href", `/communities/${slug}/events/${items.event}`);
    await expect(cards.getByRole("link", { name: /Walking with God/ })).toHaveAttribute("href", "/courses/walking-with-god");
    await expect(cards.getByRole("link", { name: /Walking with God/ })).toContainText("Free");
    await expect(cards.getByRole("link", { name: /Prayer journal/ })).toHaveAttribute("href", "/products/prayer-journal");
    await expect(cards.getByRole("link", { name: /Sabbath rest/ })).toHaveAttribute("href", /\/blog\/grace-[a-z0-9]+\/sabbath-rest$/);
    await expect(cards.getByRole("link", { name: /prayer/i }).last()).toHaveAttribute("href", /^\/f\//);
    // A removed item stays on the post as "No longer available", with no link.
    const db = await admin();
    try { await db.query("update catalog_items set state='archived', visibility='hidden' where id=$1", [items.product]); } finally { await db.end(); }
    await m.goto(`/communities/${slug}/posts/${hostPost}`);
    await expect(m.getByRole("list", { name: "Linked items" }).getByText("No longer available", { exact: true })).toBeVisible();
    await expect(m.getByRole("list", { name: "Linked items" }).getByRole("link", { name: /Prayer journal/ })).toHaveCount(0);
    await expect(m.getByRole("list", { name: "Linked items" }).getByRole("link")).toHaveCount(4);

  } finally { await member.context.close(); await friend.context.close(); }
  expect(errors).toEqual([]);
});

test("phone: collapsed card and the full-screen composer; Event opens the picker for hosts", async ({ page, browser }) => {
  test.setTimeout(600000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  const { slug } = await setup(page);
  const member = await person(browser, errors, "Ruth Adams"), friend = await person(browser, errors, "Samuel Cole");
  try {
    const m = member.page;
    await join(m, slug); await join(friend.page, slug);
    // Phone: the collapsed card (avatar, pill, photo icon, Photo | Attach for members), then the full-screen composer.
    await m.setViewportSize({ width: 360, height: 800 });
    await m.goto(`/communities/${slug}/forum`);
    await expect(m.getByRole("group", { name: "Add to your post" }).getByRole("button")).toHaveText(["Photo", "Attach"]);
    await expect(m.getByRole("button", { name: "Add a photo", exact: true })).toBeVisible();
    await m.getByRole("button", { name: "What's on your mind?", exact: true }).click();
    const phone = m.getByRole("dialog", { name: "New post" });
    await expect.poll(async () => await phone.boundingBox()).toEqual({ x: 0, y: 0, width: 360, height: 800 });
    const close = (await phone.getByRole("button", { name: "Close", exact: true }).boundingBox())!, post = (await phone.getByRole("button", { name: "Post", exact: true }).boundingBox())!;
    expect(close.x).toBeLessThan(16); expect(close.y).toBeLessThan(16);
    expect(post.x + post.width).toBeGreaterThan(340); expect(post.y).toBeLessThan(16);
    const row = (await phone.getByRole("group", { name: "Add to your post" }).boundingBox())!;
    expect(row.y + row.height).toBeGreaterThan(780);
    await phone.getByRole("button", { name: "Close", exact: true }).click();
    await expect(phone).toHaveCount(0);
    // Host on a phone: Event opens straight to the event picker.
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/communities/${slug}/forum`);
    await expect(page.getByRole("group", { name: "Add to your post" }).getByRole("button")).toHaveText(["Photo", "Attach", "Event"]);
    await page.getByRole("group", { name: "Add to your post" }).getByRole("button", { name: "Event", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "New post" }).getByRole("region", { name: "Choose event" })).toBeVisible();
  } finally { await member.context.close(); await friend.context.close(); }
  expect(errors).toEqual([]);
});

test("setting: Only hosts hides the composer from members, replies stay open", async ({ page, browser }) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  const { tenant, slug, community, general } = await setup(page);
  const member = await person(browser, errors, "Ruth Adams");
  try {
    const m = member.page;
    await join(m, slug);
    const post = (await (await page.request.post(`/api/communities/${slug}/posts`, { headers: { origin }, data: { categoryId: general, title: "Sunday plans",
      body: doc("Who is coming?"), videoUrl: null, coverFileId: null, attachmentIds: [], commentsOff: false, likesOff: false } })).json()) as { id: string };
    await retrying(() => page.goto(`/workspaces/${tenant}/communities/${community}/edit`));
    await page.getByRole("navigation", { name: "Community setup" }).getByRole("button", { name: /Channels/ }).click();
    const setting = page.getByRole("group", { name: "Who can create forum posts" });
    await expect(setting.getByLabel("Everyone", { exact: true })).toBeChecked();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.reload();
      await page.getByRole("navigation", { name: "Community setup" }).getByRole("button", { name: /Channels/ }).click();
      for (const [label, width, height] of widths) {
        await page.setViewportSize({ width, height });
        await expect(setting).toBeVisible();
        await audit(page, `setting ${label} ${scheme}`, setting);
        await setting.scrollIntoViewIfNeeded();
        await hideDevOverlay(page);
        await page.screenshot({ path: `${shots}/setting-${label}-${scheme}.png` });
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await setting.getByLabel("Only hosts", { exact: true }).click();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    // The first save compiles the community route on the dev server, which can be slow.
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible({ timeout: 90000 });

    // Members: no composer card, posting is refused, replies still work.
    await retrying(() => m.goto(`/communities/${slug}/forum`));
    await expect(m.getByRole("article").first()).toBeVisible();
    await expect(m.getByRole("button", { name: "What's on your mind?", exact: true })).toHaveCount(0);
    expect((await m.request.post(`/api/communities/${slug}/posts`, { headers: { origin }, data: { categoryId: general, title: "x", body: doc("x"), videoUrl: null, coverFileId: null,
      attachmentIds: [], commentsOff: false, likesOff: false } })).status()).toBe(403);
    // One retry if the dev server restarts (memory limit) while the reply route compiles.
    const reply = async () => {
      await retrying(() => m.goto(`/communities/${slug}/posts/${post.id}`));
      await m.getByLabel("Reply", { exact: true }).fill("Count me in.");
      await Promise.all([waitForCommunityResponse(m, "POST", `/api/communities/${slug}/posts/${post.id}/comments`), m.getByRole("button", { name: "Reply", exact: true }).click()]);
    };
    await reply().catch(async () => { await new Promise((resolve) => setTimeout(resolve, 15000)); await reply(); });
    await expect(m.getByText("Count me in.", { exact: true })).toBeVisible();
    // Hosts keep the composer.
    await retrying(() => page.goto(`/communities/${slug}/forum`));
    await expect(page.getByRole("button", { name: "What's on your mind?", exact: true })).toBeVisible();
    await retrying(() => m.goto(`/communities/${slug}/forum`));
    await shoot(m, "feed-member-hosts-only-desktop-light");
  } finally { await member.context.close(); }
  expect(errors).toEqual([]);
});

test("screens: feed, composer, pickers and a detailed post at 1280 and 360, light and dark", async ({ page, browser }) => {
  test.setTimeout(900000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  const { tenant, slug, community, general } = await setup(page);
  const items = await seedItems(page, tenant, community);
  const member = await person(browser, errors, "Ruth Adams"), friend = await person(browser, errors, "Samuel Cole");
  try {
    const m = member.page;
    await join(m, slug); await join(friend.page, slug);
    const db = await admin();
    const friendId = await db.query<{ user_id: string }>("select m.user_id from community_memberships m join communities c on c.id = m.community_id join users u on u.id = m.user_id where c.slug = $1 and u.name = 'Samuel Cole'", [slug])
      .then((r) => r.rows[0].user_id).finally(() => db.end());
    // A photo the member uploads, then a post with every detail and the host's linked items.
    const composer = m.getByRole("dialog", { name: "New post" });
    const upload = async () => {
      await retrying(() => m.goto(`/communities/${slug}/forum`));
      await m.getByRole("button", { name: "What's on your mind?", exact: true }).click();
      await attachPhoto(m, slug, composer.getByRole("group", { name: "Add to your post" }).getByRole("button", { name: "Photo", exact: true }));
    };
    // One retry if the dev server restarts (memory limit) while the upload routes compile.
    await upload().catch(async () => { await new Promise((resolve) => setTimeout(resolve, 15000)); await upload(); });
    const photoSrc = await composer.getByRole("img", { name: "Photo 1 of 1" }).getAttribute("src");
    const photoId = photoSrc!.split("/").pop()!;
    await m.keyboard.press("Escape");
    const mentionIds = [friendId];
    const create = (who: Page, title: string, details: Record<string, unknown>) => retrying(() => who.request.post(`/api/communities/${slug}/posts`, { headers: { origin }, data: { categoryId: general, title,
      body: doc("Thank you all for coming. Here are a few photos and what is next."), videoUrl: null, coverFileId: null, attachmentIds: [], commentsOff: false, likesOff: false,
      postDetails: { photoIds: [], location: null, feeling: null, mentionIds: [], linkedItems: [], ...details } } }));
    const memberPost = await create(m, "Supper photos", { photoIds: [photoId], location: "12 Main Street, Springfield", feeling: "grateful", mentionIds });
    expect(memberPost.ok(), await memberPost.text()).toBe(true);
    const hostPost = await create(page, "This week at Grace", { feeling: "hopeful", linkedItems: [{ kind: "event", id: items.event }, { kind: "article", id: items.article },
      { kind: "course", id: items.course }, { kind: "product", id: items.product }, { kind: "form", id: items.form }] });
    expect(hostPost.ok(), await hostPost.text()).toBe(true);
    const detailed = (await hostPost.json()).id as string, photoPost = (await memberPost.json()).id as string;

    type Scene = [string, Page, string, ((p: Page) => Promise<Locator | undefined>)?];
    const open = async (p: Page, start: string) => {
      await p.getByRole("group", { name: "Add to your post" }).getByRole("button", { name: start, exact: true }).click();
      return p.getByRole("dialog", { name: "New post" });
    };
    const scenes: Scene[] = [
      ["feed-member", m, `/communities/${slug}/forum`],
      ["feed-host", page, `/communities/${slug}/forum`],
      ["composer-member", m, `/communities/${slug}/forum`, async (p) => { await p.getByRole("button", { name: "What's on your mind?", exact: true }).click(); return p.getByRole("dialog", { name: "New post" }); }],
      ["composer-attach-host", page, `/communities/${slug}/forum`, (p) => open(p, "Attach")],
      ["composer-feeling", m, `/communities/${slug}/forum`, async (p) => { await p.getByRole("button", { name: "What's on your mind?", exact: true }).click(); const d = p.getByRole("dialog", { name: "New post" });
        await d.getByRole("button", { name: "Feeling", exact: true }).click(); return d; }],
      ["composer-people", m, `/communities/${slug}/forum`, async (p) => { await p.getByRole("button", { name: "What's on your mind?", exact: true }).click(); const d = p.getByRole("dialog", { name: "New post" });
        await d.getByRole("button", { name: "Tag people", exact: true }).click(); await d.getByRole("button", { name: "Location", exact: true }).click(); await d.getByRole("textbox", { name: "Location", exact: true }).fill("12 Main Street");
        await d.getByRole("button", { name: "Tag people", exact: true }).click(); return d; }],
      ...(["event", "article", "course", "product", "form"] as const).map((kind): Scene => [`picker-${kind}`, page, `/communities/${slug}/forum`, async (p) => {
        const d = await open(p, "Event");
        if (kind !== "event") await d.getByRole("radio", { name: kind[0].toUpperCase() + kind.slice(1), exact: true }).click();
        await expect(d.getByRole("region", { name: `Choose ${kind}` }).getByRole("button").first()).toBeVisible({ timeout: 30000 });
        return d;
      }]),
      ["post-details", m, `/communities/${slug}/posts/${photoPost}`],
      ["post-linked", m, `/communities/${slug}/posts/${detailed}`],
    ];
    for (const [name, p, url, prepare] of scenes) for (const scheme of ["light", "dark"] as const) {
      await p.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      for (const [label, width, height] of widths) {
        await p.setViewportSize({ width, height });
        await retrying(() => p.goto(url));
        await expect(p.getByRole("article").first()).toBeVisible();
        const scope = await prepare?.(p);
        await audit(p, `${name} ${label} ${scheme}`, scope);
        await mkdir(shots, { recursive: true }); await hideDevOverlay(p);
        await p.screenshot({ path: `${shots}/${name}-${label}-${scheme}.png`, fullPage: !scope });
      }
    }
  } finally { await member.context.close(); await friend.context.close(); }
  expect(errors).toEqual([]);
});
