import { mkdir } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";

// C12b: warnings, appeals by banned members, and edit history for hosts.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/communities-c12b";
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

test("warnings, appeals and edit history", async ({ page, browser }) => {
  test.setTimeout(480000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const slug = `youth-${Date.now().toString(36)}`;
  const community = (await (await page.request.post(`/api/workspaces/${tenant}/communities`, { headers: { origin }, data: { name: "Youth Group", slug } })).json()) as { id: string };
  let current = (await (await page.request.get(`/api/workspaces/${tenant}/communities/${community.id}`)).json()) as { version: number };
  current = (await (await page.request.patch(`/api/workspaces/${tenant}/communities/${community.id}`, { headers: { origin }, data: { version: current.version, visibility: "listed", allowOpen: true } })).json());
  expect((await page.request.post(`/api/workspaces/${tenant}/communities/${community.id}/publish`, { headers: { origin }, data: { version: current.version, published: true } })).ok()).toBe(true);
  const general = ((await (await page.request.get(`/api/workspaces/${tenant}/communities/${community.id}/categories`)).json()) as { id: string }[])[0].id;
  const postData = (title: string, text: string) => ({ categoryId: general, title, body: doc(text), videoUrl: null, coverFileId: null, attachmentIds: [], commentsOff: false, likesOff: false });

  const author = await person(browser, errors, "Andrew"), warned = await person(browser, errors, "Rebecca"), banned = await person(browser, errors, "Nathan");
  try {
    await join(author.page, slug); await join(warned.page, slug); await join(banned.page, slug);

    // Edit history: the host sees earlier versions of an edited post and reply; members never do.
    const created = (await (await author.page.request.post(`/api/communities/${slug}/posts`, { headers: { origin }, data: postData("Prayer meeting", "Thursday at seven.") })).json()) as { id: string };
    expect((await author.page.request.patch(`/api/communities/${slug}/posts/${created.id}`, { headers: { origin }, data: postData("Prayer meeting", "Thursday at eight.") })).ok()).toBe(true);
    const answer = (await (await warned.page.request.post(`/api/communities/${slug}/posts/${created.id}/comments`, { headers: { origin }, data: { body: "Amen" } })).json()) as { id: string };
    expect((await warned.page.request.patch(`/api/communities/${slug}/comments/${answer.id}`, { headers: { origin }, data: { postId: created.id, body: "Amen, brothers" } })).ok()).toBe(true);
    await warned.page.goto(`/communities/${slug}/posts/${created.id}`);
    await expect(warned.page.getByRole("button", { name: /Edit history/ })).toHaveCount(0);
    expect((await warned.page.request.get(`/api/communities/${slug}/moderation/revisions?targetType=post&targetId=${created.id}`)).status()).toBe(404);
    await page.goto(`/communities/${slug}/posts/${created.id}`);
    await page.getByRole("button", { name: "Edit history of Prayer meeting" }).click();
    const history = page.getByRole("dialog", { name: "Edit history" });
    await expect(history.getByText("Thursday at seven.")).toBeVisible();
    await expect(history.getByText("Thursday at eight.")).toBeVisible();
    await expect(history.getByText("Current", { exact: true })).toBeVisible();
    await expect(history.getByText("Earlier", { exact: true })).toBeVisible();
    await shoot(page, "edit-history", async () => { await page.getByRole("button", { name: "Edit history of Prayer meeting" }).click(); await expect(page.getByRole("dialog", { name: "Edit history" }).getByText("Thursday at seven.")).toBeVisible(); });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Edit history" })).toBeHidden();
    await page.getByRole("button", { name: "Edit history of Rebecca" }).click();
    const replyHistory = page.getByRole("dialog", { name: "Edit history" });
    await expect(replyHistory.getByText("Amen", { exact: true })).toBeVisible();
    await expect(replyHistory.getByText("Amen, brothers")).toBeVisible();
    await page.keyboard.press("Escape");

    // Warn: the host warns Rebecca; she sees the alert and acknowledges it.
    await page.goto(`/communities/${slug}/moderation`);
    await page.getByRole("tab", { name: "Members" }).click();
    const members = page.getByRole("table", { name: "Members" });
    await members.getByRole("button", { name: "Actions for Rebecca" }).click();
    await page.getByRole("menuitem", { name: "Warn", exact: true }).click();
    const warn = page.getByRole("dialog", { name: "Warn Rebecca" });
    await expect(warn.getByRole("button", { name: "Send warning" })).toBeDisabled();
    await warn.getByLabel("Reason").fill("Please keep replies kind.");
    await shoot(page, "warn-dialog", async () => {
      await page.getByRole("tab", { name: "Members" }).click();
      await members.getByRole("button", { name: "Actions for Rebecca" }).click();
      await page.getByRole("menuitem", { name: "Warn", exact: true }).click();
      await page.getByRole("dialog", { name: "Warn Rebecca" }).getByLabel("Reason").fill("Please keep replies kind.");
    });
    await page.getByRole("dialog", { name: "Warn Rebecca" }).getByRole("button", { name: "Send warning" }).click();
    await expect(members.getByRole("row").filter({ hasText: "Rebecca" }).getByRole("cell", { name: "1", exact: true })).toBeVisible();
    await shoot(page, "members", async () => { await page.getByRole("tab", { name: "Members" }).click(); });
    await warned.page.goto(`/communities/${slug}/forum`);
    const alert = warned.page.getByRole("alert").filter({ hasText: "Please keep replies kind." });
    await expect(alert.getByText("Warning from the hosts")).toBeVisible();
    await shoot(warned.page, "warning-alert");
    await warned.page.getByRole("button", { name: "Acknowledge" }).click();
    await expect(warned.page.getByText("Please keep replies kind.")).toHaveCount(0);

    // Appeal: a banned member sends one appeal; the host declines with a reply, then approves a later one.
    await page.goto(`/communities/${slug}/moderation`);
    await page.getByRole("tab", { name: "Members" }).click();
    await members.getByRole("button", { name: "Actions for Nathan" }).click();
    await page.getByRole("menuitem", { name: "Ban" }).click();
    await page.getByRole("alertdialog", { name: "Ban Nathan?" }).getByRole("button", { name: "Ban", exact: true }).click();
    await expect(members.getByRole("row").filter({ hasText: "Nathan" }).getByText("Banned")).toBeVisible();
    const n = banned.page;
    await n.goto("/account/communities");
    await expect(n.getByRole("heading", { name: "Removed" })).toBeVisible();
    await n.getByRole("button", { name: "Appeal your removal from Youth Group" }).click();
    const appeal = n.getByRole("dialog", { name: "Appeal to Youth Group" });
    await expect(appeal.getByRole("button", { name: "Send appeal" })).toBeDisabled();
    await appeal.getByLabel("Your message").fill("I am sorry and will follow the rules.");
    await shoot(n, "appeal-dialog", async () => { await n.getByRole("button", { name: "Appeal your removal from Youth Group" }).click(); await n.getByRole("dialog", { name: "Appeal to Youth Group" }).getByLabel("Your message").fill("I am sorry and will follow the rules."); });
    await n.getByRole("dialog", { name: "Appeal to Youth Group" }).getByRole("button", { name: "Send appeal" }).click();
    await expect(n.getByText("Appeal sent", { exact: true })).toBeVisible();
    await expect(n.getByRole("button", { name: /Appeal your removal/ })).toHaveCount(0);
    expect((await n.request.post("/api/account/community-appeals", { headers: { origin }, data: { slug, message: "Again" } })).status()).toBe(409);
    await shoot(n, "account-removed");

    await page.goto(`/communities/${slug}/moderation`);
    await page.getByRole("tab", { name: /Appeals/ }).click();
    const appeals = page.getByRole("table", { name: "Appeals" });
    await expect(appeals.getByRole("row")).toHaveCount(2);
    await shoot(page, "appeals", async () => { await page.getByRole("tab", { name: /Appeals/ }).click(); });
    await page.getByRole("tab", { name: /Appeals/ }).click();
    await page.getByRole("button", { name: "Review Nathan" }).click();
    const sheet = page.getByRole("dialog", { name: "Review appeal" });
    await expect(sheet.getByText("I am sorry and will follow the rules.")).toBeVisible();
    await sheet.getByLabel("Reply").fill("Not yet. Please wait a month.");
    await shoot(page, "appeal-sheet", async () => {
      await page.getByRole("tab", { name: /Appeals/ }).click();
      await page.getByRole("button", { name: "Review Nathan" }).click();
      await page.getByRole("dialog", { name: "Review appeal" }).getByLabel("Reply").fill("Not yet. Please wait a month.");
    });
    await page.getByRole("dialog", { name: "Review appeal" }).getByRole("button", { name: "Decline", exact: true }).click();
    await expect(appeals.getByRole("row").filter({ hasText: "Nathan" }).getByText("Declined")).toBeVisible();
    await n.goto("/account/communities");
    await expect(n.getByText("Appeal declined", { exact: true })).toBeVisible();
    await expect(n.getByText("Not yet. Please wait a month.")).toBeVisible();
    await expect(n.getByRole("button", { name: /Appeal your removal/ })).toHaveCount(0);

    // Unban, ban again: a new ban allows a new appeal, and approval brings the member back.
    await page.getByRole("tab", { name: "Members" }).click();
    await members.getByRole("button", { name: "Actions for Nathan" }).click();
    await page.getByRole("menuitem", { name: "Unban" }).click();
    await expect(members.getByRole("row").filter({ hasText: "Nathan" })).toHaveCount(0);
    await join(n, slug);
    await page.goto(`/communities/${slug}/moderation`);
    await page.getByRole("tab", { name: "Members" }).click();
    await members.getByRole("button", { name: "Actions for Nathan" }).click();
    await page.getByRole("menuitem", { name: "Ban" }).click();
    await page.getByRole("alertdialog", { name: "Ban Nathan?" }).getByRole("button", { name: "Ban", exact: true }).click();
    await expect(members.getByRole("row").filter({ hasText: "Nathan" }).getByText("Banned")).toBeVisible();
    await n.goto("/account/communities");
    await n.getByRole("button", { name: "Appeal your removal from Youth Group" }).click();
    await n.getByRole("dialog", { name: "Appeal to Youth Group" }).getByLabel("Your message").fill("Second chance, please.");
    await n.getByRole("dialog", { name: "Appeal to Youth Group" }).getByRole("button", { name: "Send appeal" }).click();
    await expect(n.getByText("Appeal sent", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: /Appeals/ }).click();
    await page.reload();
    await page.getByRole("tab", { name: /Appeals/ }).click();
    await page.getByRole("button", { name: "Review Nathan" }).first().click();
    const second = page.getByRole("dialog", { name: "Review appeal" });
    await expect(second.getByText("Second chance, please.")).toBeVisible();
    await second.getByLabel("Reply").fill("Welcome back.");
    await second.getByRole("button", { name: "Approve and unban" }).click();
    await n.goto("/account/communities");
    await expect(n.getByText("Appeal approved", { exact: true })).toBeVisible();
    await expect(n.getByText("Welcome back.")).toBeVisible();
    await n.getByRole("link", { name: "Rejoin" }).click();
    await expect(n).toHaveURL(new RegExp(`/communities/${slug}$`));

    // The history lists every action.
    await page.goto(`/communities/${slug}/moderation`);
    await page.getByRole("tab", { name: "History" }).click();
    const log = page.getByRole("table", { name: "History" });
    for (const action of ["Warned", "Declined appeal", "Approved appeal", "Banned", "Unbanned"]) await expect(log.getByText(action, { exact: true }).first()).toBeVisible();
    await shoot(page, "history", async () => { await page.getByRole("tab", { name: "History" }).click(); });
  } finally { await author.context.close(); await warned.context.close(); await banned.context.close(); }
  expect(errors).toEqual([]);
});
