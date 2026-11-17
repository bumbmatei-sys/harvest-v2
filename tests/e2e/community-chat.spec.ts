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
    await member.getByRole("button", { name: "Announcements", exact: true }).click();
    await expect(member.getByText("Only hosts can post here.")).toBeVisible();
    await owner.goto(`${chat}?channel=${general}`);
    await owner.bringToFront();
    await send(owner, "Write a message", "Welcome to our reading group.");
    await member.getByRole("button", { name: /^General/ }).click();
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
          await owner.getByRole("button", { name: /^General/ }).press("Enter");
          await expect(owner.getByRole("heading", { name: "General", exact: true })).toBeFocused();
        }
      }
    }
    expect(clientErrors).toEqual([]);
  } finally {
    await memberContext.close();
  }
});
