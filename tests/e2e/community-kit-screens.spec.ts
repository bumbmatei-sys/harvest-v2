import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { origin, signIn } from "./helpers/session";

// Community screens rebuilt from the UI kit (27 Nov 2026): evidence screenshots at 390 and 1440 wide, light and dark, at device scale 2.
// Synthetic data only. Runs when COMMUNITY_KIT_SHOTS is set (it writes into docs/screenshots/community-kit).
test.skip(!process.env.COMMUNITY_KIT_SHOTS, "Screenshot run: set COMMUNITY_KIT_SHOTS=1");
const evidence = "docs/screenshots/community-kit";
const widths = [["390", 390, 844], ["1440", 1440, 1000]] as const;
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const lesson = { title: "Welcome", published: true, body: doc("You are here.") };

async function person(browser: Browser, name: string, width = 1440, height = 1000) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  const page = await context.newPage();
  await signIn(page);
  expect((await page.request.put("/api/account/profile", { headers: { origin }, data: { name, locale: null, cityRegion: null } })).ok()).toBe(true);
  return page;
}

/** One scene in both widths and schemes; `prepare` runs after each load (opening a sheet or a window). */
async function shoot(page: Page, name: string, url: string, ready: (page: Page) => Promise<void>, prepare?: (page: Page) => Promise<void>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const [label, width, height] of widths) {
      const path = `${evidence}/${name}-${label}-${scheme}.png`;
      if (existsSync(path)) continue; // resumable: the dev server may restart under memory pressure mid-run
      await page.setViewportSize({ width, height });
      for (let attempt = 1; ; attempt++) {
        try { await page.goto(url, { timeout: 300_000 }); await ready(page); await prepare?.(page); break; }
        catch (error) { if (attempt === 3) throw error; await page.waitForTimeout(15_000); }
      }
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${label} ${scheme}`).toBe(true);
      await page.screenshot({ path, fullPage: !prepare });
    }
  }
}

test("community screens from the kit: screenshots", async ({ browser }) => {
  test.setTimeout(2_400_000);
  await mkdir(evidence, { recursive: true });
  const owner = await person(browser, "Grace Owens");
  const tenant = (await (await owner.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Church", audience: "church" } })).json()).tenantId as string;
  const api = `/api/workspaces/${tenant}`, stamp = randomUUID().slice(0, 8), slug = `kit-${stamp}`;
  const items: { id: string; kind: string }[] = [];
  for (const [title, summary] of [["Foundations", "Four lessons for new believers."], ["Leaders track", "For small group leaders."], ["Prayer basics", "Learning to pray together."]]) {
    const course = await (await owner.request.post(`${api}/catalog`, { headers: { origin }, data: { kind: "course", slug: `${title.toLowerCase().replace(/ /g, "-")}-${stamp}`, title, summary, visibility: "unlisted", lessons: [lesson] } })).json();
    expect((await owner.request.put(`${api}/catalog/${course.id}/state`, { headers: { origin }, data: { version: course.version, state: "published" } })).status()).toBe(200);
    items.push({ id: course.id, kind: "course" });
  }
  for (const title of ["Prayer guide", "Reading plan"]) {
    const bytes = Buffer.from(`${title}\n`.repeat(50));
    const created = await (await owner.request.post(`${api}/files`, { headers: { origin }, data: { name: `${title}.txt`, mime: "text/plain", size: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex"), visibility: "private" } })).json();
    expect((await owner.request.put(created.upload.url, { headers: created.upload.headers, data: bytes })).ok()).toBe(true);
    expect((await owner.request.post(`${api}/files/${created.file.id}/confirm`, { headers: { origin } })).status()).toBe(200);
    const item = await (await owner.request.post(`${api}/catalog`, { headers: { origin }, data: { kind: "download", slug: `${title.toLowerCase().replace(/ /g, "-")}-${stamp}`, title, summary: "A printable guide for the week.", visibility: "listed", fileIds: [created.file.id] } })).json();
    expect((await owner.request.put(`${api}/catalog/${item.id}/state`, { headers: { origin }, data: { version: item.version, state: "published" } })).status()).toBe(200);
    items.push({ id: item.id, kind: "download" });
  }
  const community = await (await owner.request.post(`${api}/communities`, { headers: { origin }, data: { name: "Bible Study", slug } })).json();
  const settings = await (await owner.request.patch(`${api}/communities/${community.id}`, { headers: { origin }, data: { version: community.version, visibility: "listed", allowOpen: true } })).json();
  expect((await owner.request.post(`${api}/communities/${community.id}/publish`, { headers: { origin }, data: { version: settings.version, published: true } })).ok()).toBe(true);
  for (const [position, item] of items.entries()) expect((await owner.request.put(`${api}/communities/${community.id}/catalog/${item.id}`, { headers: { origin }, data: { position } })).ok()).toBe(true);
  expect((await owner.request.put(`${api}/communities/${community.id}/catalog`, { headers: { origin }, data: { kind: "course", order: items.filter((i) => i.kind === "course").map((i) => i.id), featured: items[0].id } })).ok()).toBe(true);
  for (const [name, hostsOnly] of [["Announcements", true], ["Prayer requests", false]] as const)
    expect((await owner.request.post(`${api}/communities/${community.id}/categories`, { headers: { origin }, data: { name, hostsOnly } })).ok()).toBe(true);
  const general = ((await (await owner.request.get(`${api}/communities/${community.id}/categories`)).json()) as { id: string }[])[0].id;

  const member = await person(browser, "Ruth Adams"), reader = await person(browser, "Samuel Cole");
  for (const page of [member, reader]) expect(await (await page.request.post(`/api/communities/${slug}/join`, { headers: { origin }, data: { rulesVersion: 0, adult: true } })).json()).toMatchObject({ outcome: "joined" });
  const post = (await (await reader.request.post(`/api/communities/${slug}/posts`, { headers: { origin }, data: { categoryId: general, title: "Thursday study notes",
    body: doc("We finished Romans 8 this week. Bring your questions for next time."), videoUrl: null, coverFileId: null, attachmentIds: [], commentsOff: false, likesOff: false } })).json()) as { id: string };
  expect((await reader.request.post(`/api/communities/${slug}/posts`, { headers: { origin }, data: { categoryId: general, title: "Prayer requests for the week",
    body: doc("Share what we can pray for, and we will pray together on Sunday."), videoUrl: null, coverFileId: null, attachmentIds: [], commentsOff: false, likesOff: false } })).ok()).toBe(true);
  expect((await member.request.post(`/api/communities/${slug}/posts/${post.id}/comments`, { headers: { origin }, data: { body: "Thank you, see you Thursday." } })).ok()).toBe(true);
  expect((await owner.request.post(`/api/communities/${slug}/posts/${post.id}/comments`, { headers: { origin }, data: { body: "Bring a friend if you can." } })).ok()).toBe(true);
  expect((await member.request.post(`/api/communities/${slug}/likes`, { headers: { origin }, data: { targetType: "post", targetId: post.id } })).ok()).toBe(true);

  const base = `/communities/${slug}`;
  const article = async (page: Page) => { await expect(page.getByRole("article").first()).toBeVisible({ timeout: 60_000 }); };
  const heading = (name: string) => async (page: Page) => { await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible({ timeout: 60_000 }); };
  await shoot(member, "feed", `${base}/forum`, article);
  await shoot(member, "post", `${base}/posts/${post.id}`, article);
  await shoot(member, "classroom", `${base}/classroom`, heading("Classroom"));
  await shoot(member, "products", `${base}/products`, heading("Products"));
  const sheet = async (page: Page) => {
    await page.getByRole("button", { name: /^Notifications/ }).first().click();
    await page.getByRole("button", { name: "Notification settings" }).click();
    await expect(page.getByRole("dialog", { name: "Notification settings" })).toBeVisible();
  };
  await shoot(member, "notification-sheet", `${base}/forum`, article, sheet);
  await shoot(member, "email-frequency", `${base}/forum`, article, async (page) => {
    await sheet(page);
    await page.getByRole("button", { name: "Change email frequency" }).click();
    await expect(page.getByRole("dialog", { name: "Email frequency" })).toBeVisible();
  });
  const visitor = await (await browser.newContext({ deviceScaleFactor: 2, reducedMotion: "reduce" })).newPage();
  await shoot(visitor, "unsubscribe", "/communities/unsubscribe", async (page) => { await expect(page.getByRole("heading", { name: "Stop emails from this community?" })).toBeVisible({ timeout: 60_000 }); });
});

// The owner editor on its own (the member scenes need a long data setup on the dev server).
test("community screens from the kit: categories editor screenshots", async ({ browser }) => {
  test.setTimeout(1_500_000);
  await mkdir(evidence, { recursive: true });
  const owner = await person(browser, "Grace Owens");
  const tenant = (await (await owner.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Church", audience: "church" } })).json()).tenantId as string;
  const api = `/api/workspaces/${tenant}`;
  const community = await (await owner.request.post(`${api}/communities`, { headers: { origin }, data: { name: "Bible Study", slug: `kit-ed-${randomUUID().slice(0, 8)}` } })).json();
  for (const [name, hostsOnly] of [["Announcements", true], ["Prayer requests", false]] as const)
    expect((await owner.request.post(`${api}/communities/${community.id}/categories`, { headers: { origin }, data: { name, hostsOnly } })).ok()).toBe(true);
  await shoot(owner, "categories-editor", `/workspaces/${tenant}/communities/${community.id}/edit`, async (page) => {
    // Phones show the steps behind a "Show all steps" button.
    const collapsed = page.getByRole("button", { name: /Show all steps/ });
    await expect(collapsed.or(page.getByRole("navigation", { name: "Community setup" })).first()).toBeVisible({ timeout: 300_000 });
    if (await collapsed.isVisible()) await collapsed.click();
    await page.getByRole("button", { name: /^Channels/ }).last().click();
    if (await page.getByRole("dialog").isVisible()) await page.keyboard.press("Escape");
    await expect(page.getByRole("list", { name: "Forum categories" }).getByRole("listitem")).toHaveCount(3, { timeout: 60_000 });
  });
});
