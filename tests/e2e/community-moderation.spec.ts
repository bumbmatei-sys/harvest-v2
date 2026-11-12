import { mkdir } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";

// C12a: reports, the hosts' moderation page, mute/ban, and held content.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/communities-c12a";
const sizes = [["phone", 390, 844], ["tablet", 768, 1024], ["desktop", 1440, 1000]] as const;
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

async function shoot(page: Page, name: string, prepare?: () => Promise<void>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); await page.waitForFunction(s => { const t = document.documentElement.dataset.theme; return !t || t === s; }, scheme);
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

test("reports, moderation queue, mute and ban, held first posts and banned words", async ({ page, browser }) => {
  test.setTimeout(480000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const slug = `youth-${Date.now().toString(36)}`;
  const community = (await (await page.request.post(`/api/workspaces/${tenant}/communities`, { headers: { origin }, data: { name: "Youth Group", slug } })).json()) as { id: string };
  const editUrl = `/workspaces/${tenant}/communities/${community.id}/edit`;
  let current = (await (await page.request.get(`/api/workspaces/${tenant}/communities/${community.id}`)).json()) as { version: number };
  current = (await (await page.request.patch(`/api/workspaces/${tenant}/communities/${community.id}`, { headers: { origin }, data: { version: current.version, visibility: "listed", allowOpen: true } })).json());
  expect((await page.request.post(`/api/workspaces/${tenant}/communities/${community.id}/publish`, { headers: { origin }, data: { version: current.version, published: true } })).ok()).toBe(true);
  const general = ((await (await page.request.get(`/api/workspaces/${tenant}/communities/${community.id}/categories`)).json()) as { id: string }[])[0].id;
  const newPost = (p: Page, title: string, text = "Hello everyone") => p.request.post(`/api/communities/${slug}/posts`, { headers: { origin },
    data: { categoryId: general, title, body: doc(text), videoUrl: null, coverFileId: null, attachmentIds: [], commentsOff: false, likesOff: false } });

  const author = await person(browser, errors, "Andrew"), reporter = await person(browser, errors, "Rebecca");
  try {
    await join(author.page, slug); await join(reporter.page, slug);
    const spam = (await (await newPost(author.page, "Cheap watches")).json()) as { id: string };
    const fine = (await (await newPost(author.page, "Prayer meeting")).json()) as { id: string };

    // A member reports a post and a member; the reported person never learns who.
    const r = reporter.page;
    await r.goto(`/communities/${slug}/posts/${spam.id}`);
    await r.getByRole("button", { name: "Report post Cheap watches" }).click();
    let dialog = r.getByRole("dialog", { name: "Report post" });
    await expect(dialog.getByRole("button", { name: "Send report" })).toBeDisabled();
    await dialog.getByLabel("Spam or advertising").click();
    await dialog.getByLabel("Details (optional)").fill("Selling watches");
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(dialog.getByRole("status")).toHaveText("Thanks — the hosts will review it.");
    await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
    await r.goto(`/communities/${slug}/members`);
    await r.getByRole("button", { name: "Report Andrew" }).click();
    dialog = r.getByRole("dialog", { name: "Report member" });
    await dialog.getByLabel("Harassment or bullying").click();
    await shoot(r, "report-dialog", async () => { await r.getByRole("button", { name: "Report Andrew" }).click(); await r.getByRole("dialog", { name: "Report member" }).getByLabel("Harassment or bullying").click(); });
    await r.getByRole("dialog", { name: "Report member" }).getByRole("button", { name: "Send report" }).click();
    await expect(r.getByRole("status")).toBeVisible();
    // Members see no moderation page.
    await expect(r.getByRole("link", { name: /Moderation/ })).toHaveCount(0);
    expect((await r.request.get(`/api/communities/${slug}/moderation/reports`)).status()).toBe(404);

    // The host works the queue.
    await page.goto(`/communities/${slug}/forum`);
    await expect(page.getByRole("link", { name: /Moderation/ }).first()).toBeVisible();
    await page.goto(`/communities/${slug}/moderation`);
    const reports = page.getByRole("table", { name: "Reports" });
    await expect(reports.getByRole("row")).toHaveCount(3);
    await shoot(page, "reports");
    await page.getByRole("button", { name: "Review Cheap watches" }).click();
    const sheet = page.getByRole("dialog", { name: "Review report" });
    await expect(sheet.getByText("Selling watches")).toBeVisible();
    await expect(sheet.getByText(/Rebecca/)).toHaveCount(0);
    await sheet.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(reports.getByRole("row")).toHaveCount(2);
    await page.getByRole("button", { name: "Review Andrew" }).click();
    await page.getByRole("dialog", { name: "Review report" }).getByRole("button", { name: "Manage member" }).click();
    await expect(page.getByLabel("Search members")).toHaveValue("Andrew");

    // Mute the author: they can still read but cannot post.
    const members = page.getByRole("table", { name: "Members" });
    await members.getByRole("button", { name: "Actions for Andrew" }).click();
    await page.getByRole("menuitem", { name: "Mute for 1 day" }).click();
    await expect(members.getByText(/Muted until/)).toBeVisible();
    await author.page.goto(`/communities/${slug}/forum`);
    await expect(author.page.getByText(/You can't post until/)).toBeVisible();
    await expect(author.page.getByRole("button", { name: "New post" })).toHaveCount(0);
    expect((await newPost(author.page, "Still here?")).status()).toBe(403);
    await shoot(page, "members", async () => { await page.getByRole("tab", { name: "Members" }).click(); });
    await page.getByRole("tab", { name: "Members" }).click();
    await members.getByRole("button", { name: "Actions for Andrew" }).click();
    await page.getByRole("menuitem", { name: "Unmute" }).click();
    await expect(members.getByText(/Muted until/)).toHaveCount(0);
    await page.getByRole("tab", { name: "Reports" }).click();
    await page.getByRole("button", { name: "Review Andrew" }).click();
    await page.getByRole("dialog", { name: "Review report" }).getByRole("button", { name: "Keep", exact: true }).click();
    await expect(page.getByText("No open reports")).toBeVisible();

    // Owner turns on first-post approval and a banned word.
    await page.goto(editUrl);
    await page.getByRole("navigation", { name: "Community setup" }).getByRole("button", { name: /People/ }).click();
    await page.getByLabel("Approve new members' first post").click();
    await page.getByLabel("Banned words", { exact: true }).fill("Casino");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("list", { name: "Banned words" }).getByText("casino")).toBeVisible();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    await shoot(page, "editor-moderation", async () => { await page.getByRole("navigation", { name: "Community setup" }).getByRole("button", { name: /People/ }).click(); });

    // A new member's first post is held; a banned word in a reply is held too.
    const newcomer = await person(browser, errors, "Nathan");
    try {
      await join(newcomer.page, slug);
      const held = (await (await newPost(newcomer.page, "Hi from Nathan")).json()) as { id: string; outcome: string };
      expect(held.outcome).toBe("held");
      await newcomer.page.goto(`/communities/${slug}/forum`);
      await expect(newcomer.page.getByRole("article").filter({ hasText: "Hi from Nathan" }).getByText("Awaiting review")).toBeVisible();
      await r.goto(`/communities/${slug}/forum`);
      await expect(r.getByText("Hi from Nathan")).toHaveCount(0);
      await r.goto(`/communities/${slug}/posts/${fine.id}`);
      await r.getByLabel("Reply", { exact: true }).fill("Casino night after?");
      await r.getByRole("button", { name: "Reply", exact: true }).click();
      await expect(r.getByText("Awaiting review")).toBeVisible();
      await author.page.goto(`/communities/${slug}/posts/${fine.id}`);
      await expect(author.page.getByText("Casino night after?")).toHaveCount(0);

      await page.goto(`/communities/${slug}/moderation`);
      await page.getByRole("tab", { name: /Held/ }).click();
      const heldTable = page.getByRole("table", { name: "Held" });
      await expect(heldTable.getByRole("row")).toHaveCount(3);
      await shoot(page, "held", async () => { await page.getByRole("tab", { name: /Held/ }).click(); });
      await page.getByRole("tab", { name: /Held/ }).click();
      await page.getByRole("button", { name: "Approve Hi from Nathan" }).click();
      await page.getByRole("button", { name: "Reject Casino night after?" }).click();
      await expect(page.getByText("Nothing waiting for review")).toBeVisible();
      await r.goto(`/communities/${slug}/forum`);
      await expect(r.getByText("Hi from Nathan")).toBeVisible();
    } finally { await newcomer.context.close(); }

    // Ban, then unban.
    await page.goto(`/communities/${slug}/moderation`);
    await page.getByRole("tab", { name: "Members" }).click();
    await members.getByRole("button", { name: "Actions for Rebecca" }).click();
    await page.getByRole("menuitem", { name: "Ban" }).click();
    await page.getByRole("alertdialog", { name: "Ban Rebecca?" }).getByRole("button", { name: "Ban", exact: true }).click();
    await expect(members.getByRole("row").filter({ hasText: "Rebecca" }).getByText("Banned")).toBeVisible();
    await r.goto(`/communities/${slug}/forum`);
    await expect(r).toHaveURL(new RegExp(`/communities/${slug}$`));
    await members.getByRole("button", { name: "Actions for Rebecca" }).click();
    await page.getByRole("menuitem", { name: "Unban" }).click();
    await expect(members.getByRole("row").filter({ hasText: "Rebecca" })).toHaveCount(0);
    await page.getByRole("tab", { name: "History" }).click();
    const history = page.getByRole("table", { name: "History" });
    for (const action of ["Removed reported item", "Muted for 1 day", "Unmuted", "Kept reported item", "Approved held item", "Rejected held item", "Banned", "Unbanned"])
      await expect(history.getByText(action, { exact: true })).toBeVisible();
    await shoot(page, "history", async () => { await page.getByRole("tab", { name: "History" }).click(); });
  } finally { await author.context.close(); await reporter.context.close(); }
  expect(errors).toEqual([]);
});
