import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect as check, test, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

test.use({ actionTimeout: 20_000, reducedMotion: "reduce" });
const expect = check.configure({ timeout: 35_000 });
// Screenshots are written only when a directory is given, so the normal run leaves nothing behind.
const shots = process.env.HARVEST_SHOTS_DIR;

async function person(page: Page, name: string) {
  await signIn(page);
  expect((await page.request.put("/api/account/profile", { headers: { origin }, data: { name, locale: null, cityRegion: null } })).ok()).toBe(true);
}

async function join(page: Page, slug: string) {
  await page.goto(`/communities/${slug}`);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Join / });
  await dialog.getByLabel("I confirm I am 18 or older").click();
  await dialog.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page.getByRole("link", { name: "Messages", exact: true })).toBeVisible();
}

const list = (page: Page) => page.getByRole("navigation", { name: "Messages", exact: true });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message", exact: true });

async function startFromDialog(page: Page, to: string, text: string) {
  await page.getByRole("button", { name: "New message", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New message" });
  await dialog.getByRole("textbox", { name: "Search people" }).fill(to.split(" ")[0]);
  await dialog.getByRole("button", { name: to, exact: true }).click();
  await dialog.getByRole("textbox", { name: `Write to ${to}` }).fill(text);
  await dialog.getByRole("button", { name: "Send", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: to, exact: true })).toBeVisible();
  await expect(page.locator("article").getByText(text, { exact: true })).toBeVisible();
}

async function reply(page: Page, text: string) {
  await composer(page).fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator("article").getByText(text, { exact: true })).toBeVisible();
}

async function open(page: Page, slug: string, name: string) {
  await page.bringToFront();
  await page.goto(`/communities/${slug}/messages`);
  await list(page).getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

async function audit(page: Page) {
  await settleForAxe(page);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function scene(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    // The theme is chosen at load; apply the same attributes the theme script sets so open dialogs and drafts survive.
    await page.evaluate(mode => { document.documentElement.dataset.theme = mode; document.documentElement.classList.toggle("dark", mode === "dark"); }, scheme);
    for (const [kind, width, height] of [["desktop", 1280, 900], ["phone", 360, 800]] as const) {
      await page.setViewportSize({ width, height });
      await audit(page);
      if (shots) await page.screenshot({ path: `${shots}/${name}-${kind}-${scheme}.png`, animations: "disabled" });
    }
  }
}

async function context(browser: import("@playwright/test").Browser): Promise<[BrowserContext, Page]> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  return [ctx, await ctx.newPage()];
}

test("private messages: admin start, member rules, neutral refusals, block, report, read-only and responsive evidence", async ({ page: owner, browser }) => {
  test.setTimeout(600_000);
  if (shots) mkdirSync(shots, { recursive: true });
  const errors: string[] = [];
  owner.on("pageerror", error => errors.push(error.message));
  await owner.setViewportSize({ width: 1280, height: 900 });
  await person(owner, "Pastor Daniel Brooks");
  const headers = { origin };
  const tenant = (await (await owner.request.post("/api/workspaces", { headers, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const slug = `dm-${randomUUID().slice(0, 8)}`;
  const endpoint = `/api/workspaces/${tenant}/communities`;
  const community = await (await owner.request.post(endpoint, { headers, data: { name: "Bible Study", slug } })).json();
  const settings = await (await owner.request.patch(`${endpoint}/${community.id}`, { headers, data: { version: community.version, visibility: "listed", allowOpen: true } })).json();
  expect((await owner.request.post(`${endpoint}/${community.id}/publish`, { headers, data: { version: settings.version, published: true } })).ok()).toBe(true);
  const policy = async (dmPolicy: "members" | "channels_only") =>
    expect((await owner.request.put(`/api/communities/${slug}/chat/settings`, { headers, data: { chatEnabled: true, dmPolicy } })).ok()).toBe(true);
  await policy("members");

  const [ruthContext, ruth] = await context(browser);
  const [samContext, sam] = await context(browser);
  try {
    for (const page of [ruth, sam]) page.on("pageerror", error => errors.push(error.message));
    await person(ruth, "Ruth Adams");
    await person(sam, "Samuel Cole");
    await join(ruth, slug);
    await join(sam, slug);

    // The rail has a live Messages entry; the channel and message views switch from the list header.
    await ruth.goto(`/communities/${slug}/chat`);
    await ruth.getByRole("navigation", { name: "Chat sections" }).getByRole("link", { name: /^Messages/ }).click();
    await expect(ruth).toHaveURL(new RegExp(`/communities/${slug}/messages$`));
    await expect(ruth.getByRole("heading", { name: "Messages", exact: true })).toBeVisible();
    await expect(ruth.getByText("No messages yet", { exact: true })).toBeVisible();

    // Member to member while the community allows it: recipient search, first message, reply.
    await startFromDialog(ruth, "Samuel Cole", "Peace, Samuel. Are you at study on Thursday?");
    await sam.bringToFront();
    await sam.goto(`/communities/${slug}/messages`);
    await expect(list(sam).getByRole("button", { name: /^Ruth Adams/ })).toBeVisible();
    await expect(sam.getByRole("navigation", { name: "Chat sections" }).getByLabel("1 conversation with unread messages")).toBeVisible();
    await list(sam).getByRole("button", { name: /^Ruth Adams/ }).click();
    await reply(sam, "Yes, I will bring the notes.");
    await expect(sam.getByLabel("1 unread message")).toBeHidden();

    // The community switches private messages off: the conversation stays readable and turns read-only, with no way to start another.
    await policy("channels_only");
    await open(sam, slug, "Ruth Adams");
    await expect(sam.getByText("Private messages are turned off. You can still read this conversation.")).toBeVisible();
    await expect(composer(sam)).toHaveCount(0);
    await expect(sam.getByRole("button", { name: "New message", exact: true })).toHaveCount(0);
    await ruth.goto(`/communities/${slug}/messages`);
    await expect(ruth.getByRole("button", { name: "New message", exact: true })).toHaveCount(0);

    // An admin can always start, and the member can answer for as long as that admin is a host.
    await owner.goto(`/communities/${slug}/messages`);
    await startFromDialog(owner, "Samuel Cole", "Welcome, Samuel. Reply here if you have any questions.");
    await open(sam, slug, "Pastor Daniel Brooks");
    await reply(sam, "Thank you, Pastor.");
    await expect(composer(sam)).toBeVisible();

    // Mute is a per-conversation switch.
    await sam.getByRole("button", { name: "Mute conversation", exact: true }).click();
    await expect(sam.getByRole("button", { name: "Unmute conversation", exact: true })).toHaveAttribute("aria-pressed", "true");
    await sam.getByRole("button", { name: "Unmute conversation", exact: true }).click();
    await expect(sam.getByRole("button", { name: "Mute conversation", exact: true })).toHaveAttribute("aria-pressed", "false");

    // The Message action on a member profile is the same for everyone and opens a neutral compose dialog.
    await ruth.goto(`/communities/${slug}/chat`);
    await ruth.getByRole("textbox", { name: "Write a message" }).fill("Good morning, everyone.");
    await ruth.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(ruth.locator("article").getByText("Good morning, everyone.", { exact: true })).toBeVisible();
    await owner.goto(`/communities/${slug}/chat`);
    await owner.getByRole("button", { name: "View profile of Ruth Adams" }).click();
    await owner.getByRole("button", { name: "Message", exact: true }).click();
    const compose = owner.getByRole("dialog", { name: "Message Ruth Adams" });
    await compose.getByRole("textbox", { name: "Write to Ruth Adams" }).fill("Thank you for joining us this week.");
    await compose.getByRole("button", { name: "Send", exact: true }).click();
    await expect(owner).toHaveURL(new RegExp(`/messages\\?c=`));
    await expect(owner.getByRole("heading", { name: "Ruth Adams", exact: true })).toBeVisible();

    // Reporting, then blocking: the reporter is offered a block, and the blocked person sees no difference.
    await policy("members");
    await open(ruth, slug, "Samuel Cole");
    await expect(list(ruth).getByRole("button", { name: /^Samuel Cole/ }).getByLabel(/unread message/)).toHaveCount(0);
    const before = { list: await list(ruth).innerText(), composer: await composer(ruth).isVisible() };
    await open(sam, slug, "Ruth Adams");
    await sam.locator("article").filter({ hasText: "Peace, Samuel" }).getByRole("button", { name: /^Report message by/ }).click();
    const report = sam.getByRole("dialog", { name: "Report message" });
    await expect(report.getByText("Owners and admins will see your name, this message and a few before it.")).toBeVisible();
    await report.getByRole("radio", { name: "Harassment or bullying" }).click();
    await report.getByRole("button", { name: "Send report" }).click();
    await expect(report.getByText("Thanks — the hosts will review it.")).toBeVisible();
    await report.getByRole("button", { name: "Block this person", exact: true }).click();
    const confirm = sam.getByRole("alertdialog");
    await expect(confirm.getByText("Block Ruth Adams?")).toBeVisible();
    await confirm.getByRole("button", { name: "Block", exact: true }).click();
    await expect(sam.getByText("You blocked Ruth Adams.")).toBeVisible();
    await expect(composer(sam)).toHaveCount(0);

    await open(ruth, slug, "Samuel Cole");
    expect({ list: await list(ruth).innerText(), composer: await composer(ruth).isVisible() }).toEqual(before);
    await composer(ruth).fill("Did you get my message?");
    await ruth.getByRole("button", { name: "Send message", exact: true }).click();
    // One neutral answer: it names no block, opt-out, policy or history, and the draft stays for a retry.
    await expect(ruth.getByRole("alert").getByText("This isn’t available right now.")).toBeVisible();
    await expect(composer(ruth)).toHaveValue("Did you get my message?");
    await expect(ruth.getByText(/block/i)).toHaveCount(0);
    await composer(ruth).fill("");

    await sam.getByRole("button", { name: "Unblock", exact: true }).click();
    await expect(composer(sam)).toBeVisible();
    await sam.reload();
    await expect(sam.getByText("You blocked Ruth Adams.")).toHaveCount(0);

    // Evidence: lists, conversation, dialog and read-only state in light and dark, desktop and phone.
    await policy("channels_only");
    await owner.goto(`/communities/${slug}/messages`);
    await scene(owner, "conversation-list");
    await list(owner).getByRole("button", { name: /^Samuel Cole/ }).click();
    await scene(owner, "conversation");
    await owner.setViewportSize({ width: 1280, height: 900 });
    await owner.getByRole("button", { name: "New message", exact: true }).click();
    const dialog = owner.getByRole("dialog", { name: "New message" });
    await expect(dialog.getByRole("button", { name: "Ruth Adams", exact: true })).toBeVisible();
    await scene(owner, "new-message-dialog");
    await dialog.getByRole("button", { name: "Ruth Adams", exact: true }).click();
    await dialog.getByRole("textbox", { name: "Write to Ruth Adams" }).fill("Let us know if you can serve on Sunday.");
    await scene(owner, "admin-start");
    await owner.keyboard.press("Escape");
    await open(sam, slug, "Ruth Adams");
    await scene(sam, "read-only-banner");

    // Phone: the conversation is full screen with no bottom bar, a one-line composer and 44px targets.
    await sam.setViewportSize({ width: 360, height: 800 });
    await sam.goto(`/communities/${slug}/messages`);
    await expect(sam.getByRole("navigation", { name: "Community" })).toBeHidden();
    await expect(sam.getByRole("banner")).toBeHidden();
    await list(sam).getByRole("button", { name: /^Pastor Daniel Brooks/ }).click();
    await expect(sam.getByRole("navigation", { name: "Community" })).toBeHidden();
    const field = composer(sam);
    expect((await field.boundingBox())?.height).toBeLessThanOrEqual(56);
    for (const name of ["Send message", "Back to messages", "Mute conversation", "Conversation menu"]) {
      const box = await sam.getByRole("button", { name, exact: true }).boundingBox();
      expect(box?.height, name).toBeGreaterThanOrEqual(44);
      expect(box?.width, name).toBeGreaterThanOrEqual(44);
    }
    await sam.getByRole("button", { name: "Back to messages" }).click();
    await expect(sam.getByRole("heading", { name: "Messages", exact: true })).toBeFocused();
    expect(errors).toEqual([]);
  } finally {
    await ruthContext.close();
    await samContext.close();
  }
});
