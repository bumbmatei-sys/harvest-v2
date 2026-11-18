import { randomUUID } from "node:crypto";
import { expect as check, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

test.use({ actionTimeout: 20_000, reducedMotion: "reduce" });
const expect = check.configure({ timeout: 35_000 });
const evidence = "docs/screenshots/communities-c11b";

async function send(page: Page, label: string, body: string) {
  await page.getByRole("textbox", { name: label, exact: true }).fill(body);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator("article").getByText(body, { exact: true })).toBeVisible({ timeout: 15_000 });
}

test("chat channels, live messages, moderation, and responsive evidence", async ({ page: owner, browser }) => {
  test.setTimeout(420_000);
  await owner.setViewportSize({ width: 1280, height: 900 });
  const clientErrors: string[] = [];
  owner.on("pageerror", error => clientErrors.push(error.message));
  await signIn(owner);
  const headers = { origin };
  const tenant = (await (await owner.request.post("/api/workspaces", {
    headers, data: { name: "Grace Community Church", audience: "church" },
  })).json()).tenantId as string;
  const slug = `chat-${randomUUID().slice(0, 8)}`;
  const communityEndpoint = `/api/workspaces/${tenant}/communities`;
  const community = await (await owner.request.post(communityEndpoint, {
    headers, data: { name: "Bible Study", slug },
  })).json();
  const resource = `${communityEndpoint}/${community.id}`;
  const settings = await (await owner.request.patch(resource, {
    headers, data: { version: community.version, visibility: "listed", allowOpen: true, bannedWords: ["badword"] },
  })).json();
  expect((await owner.request.post(`${resource}/publish`, { headers, data: { version: settings.version, published: true } })).ok()).toBe(true);

  const edit = `/workspaces/${tenant}/communities/${community.id}/edit`;
  const chat = `/communities/${slug}/chat`;
  const api = `/api/communities/${slug}/chat`;
  await owner.goto(edit);
  await owner.getByRole("navigation", { name: "Community setup" }).getByRole("button", { name: /Channels/ }).click();
  await owner.getByRole("button", { name: "New channel", exact: true }).click();
  const create = owner.getByRole("dialog", { name: "New channel" });
  await create.getByLabel("Channel name").fill("Announcements");
  await create.getByLabel("Who can post").selectOption("hosts");
  await create.getByRole("button", { name: "Save", exact: true }).click();
  await expect(create).toBeHidden();
  await expect(owner.getByRole("button", { name: "Announcements", exact: true })).toBeVisible();

  const memberContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  try {
    const member = await memberContext.newPage();
    member.on("pageerror", error => clientErrors.push(error.message));
    await signIn(member);
    await member.goto(`/communities/${slug}`);
    await member.getByRole("button", { name: "Join", exact: true }).click();
    const join = member.getByRole("dialog", { name: "Join Bible Study" });
    await join.getByLabel("I confirm I am 18 or older").click();
    await join.getByRole("button", { name: "Join", exact: true }).click();
    await member.getByRole("link", { name: "Chat", exact: true }).click();

    const channels = await (await member.request.get(`${api}/state`)).json() as { channels: { id: string; name: string }[] };
    const general = channels.channels.find(channel => channel.name === "General")!.id;
    await member.getByRole("navigation", { name: "Channels" }).getByRole("button", { name: "Announcements", exact: true }).click();
    await expect(member.getByText("Only hosts can post here.")).toBeVisible();
    await owner.goto(`${chat}?channel=${general}`);
    await owner.bringToFront();
    await send(owner, "Write a message", "Welcome to our reading group.");
    await member.getByRole("navigation", { name: "Channels" }).getByRole("button", { name: /^General/ }).click();
    await member.bringToFront();
    const welcome = member.locator("article").filter({ hasText: "Welcome to our reading group." });
    await expect(welcome).toBeVisible();
    await welcome.getByRole("button", { name: "Reply", exact: true }).click();
    await send(member, "Reply", "I’ll bring the reading notes.");
    await member.keyboard.press("Escape");
    await expect(welcome.getByRole("button", { name: "1 reply" })).toBeVisible({ timeout: 15_000 });

    await welcome.getByRole("button", { name: "React", exact: true }).click();
    const reaction = member.waitForResponse(response => response.url().endsWith("/reactions") &&
      response.request().method() === "POST", { timeout: 60_000 });
    await member.getByRole("menuitem", { name: "🙏", exact: true }).click();
    expect((await reaction).ok()).toBe(true);
    await expect(welcome.getByRole("button", { name: "🙏 1 reaction" })).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });

    await owner.bringToFront();
    const pin = owner.locator("article").filter({ hasText: "Welcome to our reading group." });
    await pin.getByRole("button", { name: "Message actions" }).click();
    const pinned = owner.waitForResponse(response => response.url().endsWith("/moderate") &&
      response.request().method() === "POST", { timeout: 60_000 });
    await owner.getByRole("menuitem", { name: "Pin message" }).click();
    expect((await pinned).ok()).toBe(true);
    await expect(owner.getByRole("region", { name: "Pinned messages" })).toBeVisible({ timeout: 15_000 });

    await member.bringToFront();
    await member.getByRole("button", { name: "Channel notifications" }).click();
    const muted = member.waitForResponse(response => response.url().endsWith("/mute") &&
      response.request().method() === "PUT", { timeout: 60_000 });
    await member.getByRole("menuitemradio", { name: "Mute channel" }).click();
    expect((await muted).ok()).toBe(true);
    await expect.poll(async () => {
      const result = await (await member.request.get(`${api}/state`)).json();
      return result.channels.find((channel: { id: string }) => channel.id === general)?.mute;
    }).toBe("all");

    await member.getByRole("textbox", { name: "Write a message" }).fill("badword");
    await memberContext.setOffline(true);
    await expect(member.getByText("You’re offline. Your draft will stay here.")).toBeVisible();
    await memberContext.setOffline(false);
    await expect(member.getByRole("textbox", { name: "Write a message" })).toHaveValue("badword");
    await member.getByRole("button", { name: "Send message" }).click();
    await expect(member.getByText("Held for review", { exact: true })).toBeVisible();

    const own = member.locator("article").filter({ hasText: "badword" });
    await owner.goto(`/communities/${slug}/moderation`);
    await owner.getByRole("tab", { name: /Held/ }).click();
    await owner.getByRole("tab", { name: /^Chat/ }).click();
    const approved = owner.waitForResponse(response => response.url().endsWith("/moderate") &&
      response.request().method() === "POST", { timeout: 60_000 });
    await owner.getByRole("button", { name: "Approve", exact: true }).click();
    expect((await approved).ok()).toBe(true);
    await member.bringToFront();
    await expect(member.getByText("Held for review", { exact: true })).toBeHidden({ timeout: 25_000 });
    await own.getByRole("button", { name: "Message actions" }).click();
    await member.getByRole("menuitem", { name: "Edit message" }).click();
    await member.getByRole("textbox", { name: "Edit message", exact: true }).fill("Thanks for reviewing.");
    await member.getByRole("button", { name: "Save edit" }).click();
    const edited = member.locator("article").filter({ hasText: "Thanks for reviewing." });
    await expect(edited.getByText("Edited", { exact: true })).toBeVisible();
    await edited.getByRole("button", { name: "Message actions" }).click();
    await member.getByRole("menuitem", { name: "Delete message" }).click();
    await member.getByRole("alertdialog").getByRole("button", { name: "Delete message", exact: true }).click();
    const tombstone = member.locator("article").filter({ hasText: "Message deleted" });
    await tombstone.getByRole("button", { name: "Message actions" }).click();
    await member.getByRole("menuitem", { name: "Restore message" }).click();
    await expect(edited).toBeVisible();

    await welcome.getByRole("button", { name: /^Report message by/ }).click();
    const report = member.getByRole("dialog", { name: "Report message" });
    await report.getByRole("radio", { name: "Spam or advertising" }).click();
    await report.getByRole("button", { name: "Send report" }).click();
    await expect(report.getByText("Thanks — the hosts will review it.")).toBeVisible();
    await report.getByRole("button", { name: "Close" }).last().click();

    await owner.goto(`${chat}?channel=${general}`);
    for (const scheme of ["light", "dark"] as const) {
      await owner.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      for (const [width, height] of [[360, 800], [768, 1024], [1280, 900]]) {
        await owner.setViewportSize({ width, height });
        await owner.reload();
        await expect(owner.getByRole("textbox", { name: "Write a message" })).toBeVisible();
        await settleForAxe(owner);
        expect((await new AxeBuilder({ page: owner }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
        expect(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (width === 360) {
          const box = await owner.getByRole("button", { name: "Send message" }).boundingBox();
          expect(box?.height).toBeGreaterThanOrEqual(44);
          expect(box?.width).toBeGreaterThanOrEqual(44);
        }
        await owner.screenshot({ path: `${evidence}/chat-${width}-${scheme}.png`, animations: "disabled" });
        if (width === 360) {
          await owner.getByRole("button", { name: "Back to channels" }).click();
          await expect(owner.getByRole("heading", { name: "Channels", exact: true })).toBeFocused();
          await owner.getByRole("navigation", { name: "Channels" }).getByRole("button", { name: /^General/ }).press("Enter");
          await expect(owner.getByRole("heading", { name: "General", exact: true })).toBeFocused();
        }
      }
    }
    expect(clientErrors).toEqual([]);
  } finally {
    await memberContext.close();
  }
});

async function chatCommunity(page: Page, name: string) {
  const headers = { origin };
  const tenant = (await (await page.request.post("/api/workspaces", { headers, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const slug = `chat-${randomUUID().slice(0, 8)}`;
  const endpoint = `/api/workspaces/${tenant}/communities`;
  const community = await (await page.request.post(endpoint, { headers, data: { name, slug } })).json();
  const settings = await (await page.request.patch(`${endpoint}/${community.id}`, { headers, data: { version: community.version, visibility: "listed", allowOpen: true } })).json();
  expect((await page.request.post(`${endpoint}/${community.id}/publish`, { headers, data: { version: settings.version, published: true } })).ok()).toBe(true);
  return { slug, chat: `/communities/${slug}/chat` };
}

test("phone chat is full screen with a one-line composer and an admin can manage channels from the chat", async ({ page }) => {
  test.setTimeout(240_000);
  const clientErrors: string[] = [];
  page.on("pageerror", error => clientErrors.push(error.message));
  await page.setViewportSize({ width: 360, height: 800 });
  await signIn(page);
  const { slug, chat } = await chatCommunity(page, "Prayer Team");
  await page.goto(chat);

  // Phone: channel list is its own full-screen view with a way back to the community; no bottom bar or header.
  await expect(page.getByRole("heading", { name: "Channels", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Community" })).toBeHidden();
  await expect(page.getByRole("banner")).toBeHidden();
  await expect(page.getByRole("link", { name: "Back to community" })).toBeVisible();

  // Admin controls are in the chat itself.
  await page.getByRole("button", { name: "New channel", exact: true }).click();
  const create = page.getByRole("dialog", { name: "New channel" });
  await create.getByLabel("Channel name").fill("Volunteers");
  await create.getByRole("button", { name: "Save", exact: true }).click();
  await expect(create).toBeHidden();
  await expect(page.getByRole("heading", { name: "Volunteers", exact: true })).toBeVisible();

  // Channel view: composer is one line, send is a 44px target, still no bottom bar.
  const field = page.getByRole("textbox", { name: "Write a message" });
  await expect(field).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Community" })).toBeHidden();
  const box = await field.boundingBox();
  expect(box?.height).toBeLessThanOrEqual(56);
  const send = await page.getByRole("button", { name: "Send message" }).boundingBox();
  expect(send?.height).toBeGreaterThanOrEqual(44);
  expect(send?.width).toBeGreaterThanOrEqual(44);
  await field.fill("one\ntwo\nthree\nfour\nfive\nsix");
  expect((await field.boundingBox())?.height).toBeLessThanOrEqual(104);
  await field.fill("");
  await page.getByRole("button", { name: "Back to channels" }).click();
  await expect(page.getByRole("heading", { name: "Channels", exact: true })).toBeFocused();

  // Rename from the channel menu.
  await page.getByRole("button", { name: "Options for Volunteers" }).click();
  await page.getByRole("menuitem", { name: "Edit channel" }).click();
  const edit = page.getByRole("dialog", { name: "Edit channel" });
  await edit.getByLabel("Channel name").fill("Greeters");
  await edit.getByRole("button", { name: "Save", exact: true }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByRole("button", { name: "Options for Greeters" })).toBeVisible();
  await page.screenshot({ path: `${evidence}/admin-360-light.png`, animations: "disabled" });
  await page.getByRole("button", { name: "Options for Greeters" }).click();
  await page.screenshot({ path: `${evidence}/admin-menu-360-light.png`, animations: "disabled" });
  await page.keyboard.press("Escape");

  // Delete (an empty channel is removed; one with messages is archived).
  await page.getByRole("button", { name: "Options for Greeters" }).click();
  await page.getByRole("menuitem", { name: "Delete channel" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete channel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Options for Greeters" })).toBeHidden();
  const state = await (await page.request.get(`/api/communities/${slug}/chat/state`)).json() as { channels: { name: string }[] };
  expect(state.channels.map(channel => channel.name)).not.toContain("Greeters");

  // Desktop: the same controls beside the thread.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(chat);
  await expect(page.getByRole("button", { name: "New channel", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Options for / }).first().click();
  await page.screenshot({ path: `${evidence}/admin-menu-1280-light.png`, animations: "disabled" });
  await page.keyboard.press("Escape");
  // Channel info: opened from the channel name, closes with Escape and returns focus to it.
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const [width, height] of [[1280, 900], [360, 800]]) {
      await page.setViewportSize({ width, height });
      await page.goto(chat);
      if (width === 360) await page.getByRole("navigation", { name: "Channels" }).getByRole("button", { name: /^General/ }).click();
      const name = page.getByRole("heading", { name: "General", exact: true }).getByRole("button");
      await name.click();
      const info = page.getByRole("dialog", { name: "Channel info" });
      await expect(info).toBeVisible();
      for (const heading of ["Notifications", "Members", "Pinned messages", "Shared links", "Shared media", "Documents"]) await expect(info.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect(info.getByText("Photos and files are coming soon")).toHaveCount(2);
      await expect(info.getByRole("button", { name: "Edit channel" })).toBeVisible();
      await settleForAxe(page);
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/info-${width}-${scheme}.png`, animations: "disabled" });
      await page.keyboard.press("Escape");
      await expect(info).toBeHidden();
      await expect(name).toBeFocused();
    }
  }
  expect(clientErrors).toEqual([]);
});

test("a member sees no channel administration controls", async ({ page: owner, browser }) => {
  test.setTimeout(180_000);
  await signIn(owner);
  const { slug, chat } = await chatCommunity(owner, "Youth Group");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  try {
    const member = await context.newPage();
    await signIn(member);
    await member.goto(`/communities/${slug}`);
    await member.getByRole("button", { name: "Join", exact: true }).click();
    const join = member.getByRole("dialog", { name: "Join Youth Group" });
    await join.getByLabel("I confirm I am 18 or older").click();
    await join.getByRole("button", { name: "Join", exact: true }).click();
    await member.goto(chat);
    await expect(member.getByRole("navigation", { name: "Channels" }).getByRole("button", { name: /^General/ })).toBeVisible();
    await expect(member.getByRole("button", { name: "New channel", exact: true })).toHaveCount(0);
    await expect(member.getByRole("button", { name: /^Options for / })).toHaveCount(0);
    await member.getByRole("navigation", { name: "Channels" }).getByRole("button", { name: /^General/ }).click();
    await member.getByRole("heading", { name: "General", exact: true }).getByRole("button").click();
    await expect(member.getByRole("dialog", { name: "Channel info" }).getByRole("button", { name: "Edit channel" })).toHaveCount(0);
    await member.keyboard.press("Escape");
    await member.getByRole("button", { name: "Channel menu" }).click();
    await expect(member.getByRole("menuitem", { name: "Edit channel" })).toHaveCount(0);
    await member.keyboard.press("Escape");
    expect((await member.request.get(`/api/communities/${slug}/chat/settings`)).status()).toBe(403);
  } finally { await context.close(); }
});
