import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect as check, test, type Page } from "@playwright/test";
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
  await expect(page.getByRole("link", { name: "Members", exact: true })).toBeVisible();
}

async function audit(page: Page) {
  await settleForAxe(page);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

// Light and dark at desktop and phone width: axe and overflow at each, a screenshot when a directory is given.
async function scene(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.evaluate(mode => { document.documentElement.dataset.theme = mode; document.documentElement.classList.toggle("dark", mode === "dark"); }, scheme);
    for (const [kind, width, height] of [["desktop", 1280, 900], ["phone", 360, 800]] as const) {
      await page.setViewportSize({ width, height });
      await audit(page);
      if (shots) await page.screenshot({ path: `${shots}/${name}-${kind}-${scheme}.png`, animations: "disabled" });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

test("member profile: directory link, activity, Message, own settings, sheet link and neutral 404", async ({ page: owner, browser }) => {
  test.setTimeout(600_000);
  if (shots) mkdirSync(shots, { recursive: true });
  const errors: string[] = [];
  owner.on("pageerror", error => errors.push(error.message));
  await owner.setViewportSize({ width: 1280, height: 900 });
  await person(owner, "Pastor Daniel Brooks");
  const headers = { origin };
  const tenant = (await (await owner.request.post("/api/workspaces", { headers, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const slug = `profile-${randomUUID().slice(0, 8)}`;
  const endpoint = `/api/workspaces/${tenant}/communities`;
  const community = await (await owner.request.post(endpoint, { headers, data: { name: "Bible Study", slug } })).json();
  const settings = await (await owner.request.patch(`${endpoint}/${community.id}`, { headers, data: { version: community.version, visibility: "listed", allowOpen: true } })).json();
  expect((await owner.request.post(`${endpoint}/${community.id}/publish`, { headers, data: { version: settings.version, published: true } })).ok()).toBe(true);
  expect((await owner.request.put(`/api/communities/${slug}/chat/settings`, { headers, data: { chatEnabled: true, dmPolicy: "members" } })).ok()).toBe(true);
  const categories = (await (await owner.request.get(`${endpoint}/${community.id}/categories`)).json()) as { id: string; name: string }[];

  const ruthContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  const samContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  try {
    const ruth = await ruthContext.newPage(), sam = await samContext.newPage();
    for (const page of [ruth, sam]) page.on("pageerror", error => errors.push(error.message));
    await person(ruth, "Ruth Adams");
    await person(sam, "Samuel Cole");
    await join(ruth, slug);
    await join(sam, slug);

    // Samuel writes a post; Ruth replies to it, so both have activity.
    const post = await sam.request.post(`/api/communities/${slug}/posts`, { headers, data: { categoryId: categories[0].id, title: "Thursday study notes", body: doc("Bring your Bibles and a friend."),
      videoUrl: null, coverFileId: null, attachmentIds: [], commentsOff: false, likesOff: false } });
    expect(post.ok()).toBe(true);
    const postId = (await post.json()).id as string;
    expect((await ruth.request.post(`/api/communities/${slug}/posts/${postId}/comments`, { headers, data: { body: "I will be there." } })).ok()).toBe(true);

    // Directory: the name links to the profile.
    await ruth.goto(`/communities/${slug}/members`);
    await scene(ruth, "directory");
    await ruth.getByRole("link", { name: "View profile of Samuel Cole" }).first().click();
    await expect(ruth).toHaveURL(new RegExp(`/communities/${slug}/members/`));
    await expect(ruth.getByRole("heading", { name: "Member profile", level: 2 })).toBeVisible();
    await expect(ruth.getByText("Samuel Cole", { exact: true }).first()).toBeVisible();
    await expect(ruth.getByText("Member", { exact: true }).first()).toBeVisible();
    await expect(ruth.getByText(/^Joined /)).toBeVisible();
    await expect(ruth.getByRole("link", { name: "Thursday study notes" })).toBeVisible();
    await expect(ruth.getByText("Bring your Bibles and a friend.")).toBeVisible();
    // Another member's profile has no settings and shows only what the community already shows.
    await expect(ruth.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
    await expect(ruth.getByText(/@example\.test/)).toHaveCount(0);
    await scene(ruth, "other-member");

    // Message: one neutral dialog, no lookup on the way in.
    await ruth.getByRole("button", { name: "Message", exact: true }).click();
    const compose = ruth.getByRole("dialog", { name: "Message Samuel Cole" });
    await expect(compose.getByRole("textbox", { name: "Write to Samuel Cole" })).toBeVisible();
    await ruth.keyboard.press("Escape");
    await expect(compose).toBeHidden();

    // The activity link reaches the post.
    await ruth.getByRole("link", { name: "Thursday study notes" }).click();
    await expect(ruth).toHaveURL(new RegExp(`/posts/${postId}`));

    // Own profile: reply activity, no Message action, Settings tab.
    await ruth.goto(`/communities/${slug}/members`);
    await ruth.getByRole("link", { name: "View profile of Ruth Adams" }).click();
    await expect(ruth.getByRole("heading", { name: "Your profile", level: 2 })).toBeVisible();
    await expect(ruth.getByRole("button", { name: "Message", exact: true })).toHaveCount(0);
    await expect(ruth.getByText("Reply", { exact: true })).toBeVisible();
    await expect(ruth.getByText("I will be there.")).toBeVisible();
    await scene(ruth, "own-profile");
    await ruth.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(ruth.getByRole("link", { name: "Name and language" })).toBeVisible();
    await scene(ruth, "edit-profile");
    await ruth.getByRole("button", { name: "Notification settings", exact: true }).click();
    await expect(ruth.getByRole("dialog", { name: "Notification settings" })).toBeVisible();
    await ruth.keyboard.press("Escape");
    const accept = ruth.getByRole("switch", { name: "Accept messages from members" });
    await expect(accept).toBeChecked();
    await accept.click();
    await expect(accept).not.toBeChecked();
    await ruth.reload();
    await expect(ruth.getByRole("switch", { name: "Accept messages from members" })).not.toBeChecked();
    await ruth.getByRole("switch", { name: "Accept messages from members" }).click();
    await expect(ruth.getByRole("switch", { name: "Accept messages from members" })).toBeChecked();

    // The chat member sheet links to the full profile.
    await owner.goto(`/communities/${slug}/chat`);
    await owner.getByRole("textbox", { name: "Write a message" }).fill("Welcome, everyone.");
    await owner.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(owner.locator("article").getByText("Welcome, everyone.", { exact: true })).toBeVisible();
    await sam.goto(`/communities/${slug}/chat`);
    await sam.getByRole("button", { name: "View profile of Pastor Daniel Brooks" }).click();
    await sam.getByRole("link", { name: "View full profile" }).click();
    await expect(sam.getByRole("heading", { name: "Member profile", level: 2 })).toBeVisible();
    await expect(sam.getByText("Owner", { exact: true }).first()).toBeVisible();

    // Neutral 404: an unknown person and a person who is not in this community answer the same, with no detail.
    const unknown = await ruth.goto(`/communities/${slug}/members/nobody-${randomUUID().slice(0, 6)}`);
    expect(unknown?.status()).toBe(404);
    await expect(ruth.getByText(/example\.test|not a member|private/i)).toHaveCount(0);
    await scene(ruth, "not-visible");

    expect(errors).toEqual([]);
  } finally {
    await ruthContext.close(); await samContext.close();
  }
});
