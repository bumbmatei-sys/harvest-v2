import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// "Your data" (27 Nov): download my data from the profile page; delete my account (re-auth, sole-owner blocker, "Former member").
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const shots = process.env.YOUR_DATA_SHOTS ?? "test-results/your-data";

async function check(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.reload();
    for (const width of [1280, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await settleForAxe(page);
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${shots}/${name}-${width}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("downloads my data from the profile page", async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const email = await signIn(page);
  await page.goto("/account/profile");
  await expect(page.getByRole("heading", { name: "Your data", exact: true })).toBeVisible();
  const button = page.getByRole("button", { name: "Download my data", exact: true });
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await check(page, "profile-your-data");
  const download = page.waitForEvent("download");
  await button.click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^harvest-data-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(data).toMatchObject({ format: "harvest-your-data", account: { email } });
  for (const section of ["ministries", "communities", "posts", "replies", "chatMessages", "directMessages", "courseProgress", "courseNotes", "files"]) expect(Array.isArray(data[section])).toBe(true);
  await expect(page.getByText("Your data was downloaded.", { exact: true })).toBeVisible();
  // The route refuses other origins, and the hourly limit applies.
  expect((await page.request.post("/api/account/data", { headers: { origin: "https://evil.example.invalid" } })).status()).toBe(403);
  expect((await page.request.post("/api/account/data", { headers: { origin } })).status()).toBe(200);
  expect((await page.request.post("/api/account/data", { headers: { origin } })).status()).toBe(200);
  const limited = await page.request.post("/api/account/data", { headers: { origin } });
  expect(limited.status()).toBe(429);
  expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
  await button.click();
  await expect(page.getByRole("alert").filter({ hasText: "3 times an hour" })).toBeVisible();
});

test("deletes my account: sole-owner blocker, re-auth, typed confirmation, then \"Former member\"", async ({ page, browser }) => {
  test.setTimeout(300000);
  const admin = new Client({ connectionString: await readFile(`${process.env.HARVEST_E2E_MAILBOX}.admin`, "utf8") });
  await admin.connect();
  const other = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page);
    const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Example Ministry", audience: "church" } })).json()).tenantId as string;
    const slug = `your-data-${Date.now().toString(36)}`;
    const community = (await (await page.request.post(`/api/workspaces/${tenant}/communities`, { headers: { origin }, data: { name: "Your data club", slug } })).json()) as { id: string };
    await admin.query("update communities set status = 'published', visibility = 'listed', allow_open = true where id = $1", [community.id]);
    const category = (await admin.query("select id from community_categories where community_id = $1 order by position limit 1", [community.id])).rows[0].id as string;

    // The ministry's only owner is blocked.
    await page.goto("/account/delete");
    await expect(page.getByRole("heading", { name: "Delete your account", exact: true })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Transfer your ministries first" })).toContainText("Grace Example Ministry");
    await expect(page.getByLabel("Type DELETE to confirm")).toHaveCount(0);
    await check(page, "delete-sole-owner");

    // A member writes a post, then deletes their account.
    const member = await other.newPage();
    const email = await signIn(member);
    const user = (await admin.query("select id from users where email = $1", [email])).rows[0].id as string;
    expect((await member.request.post(`/api/communities/${slug}/join`, { headers: { origin }, data: { rulesVersion: 0, adult: true } })).status()).toBe(200);
    const post = await (await member.request.post(`/api/communities/${slug}/posts`, { headers: { origin },
      data: { categoryId: category, title: "Synthetic member post", body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] } } })).json() as { id: string };
    await member.goto("/account/profile");
    await member.getByRole("link", { name: "Delete my account", exact: true }).click();
    await expect(member).toHaveURL(/\/account\/delete$/);

    // A sign-in older than 15 minutes must sign in again first.
    await admin.query("update sessions set created_at = now() - interval '20 minutes' where user_id = $1", [user]);
    await member.reload();
    await expect(member.getByRole("alert").filter({ hasText: "sign in again" })).toBeVisible();
    await expect(member.getByRole("button", { name: "Sign in again", exact: true })).toBeVisible();
    expect((await member.request.post("/api/account/delete", { headers: { origin }, data: { confirm: "DELETE" } })).status()).toBe(401);
    await check(member, "delete-reauth");
    await admin.query("update sessions set created_at = now() where user_id = $1", [user]);
    await member.reload();

    const confirm = member.getByLabel("Type DELETE to confirm", { exact: true });
    const submit = member.getByRole("button", { name: "Delete my account", exact: true });
    await expect(member.getByText("Your direct messages", { exact: true })).toBeVisible();
    await expect(member.getByText(/shown as "Former member"/)).toBeVisible();
    await expect(submit).toBeDisabled();
    expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await check(member, "delete-confirm");
    await confirm.fill("DELETE");
    await submit.click();
    await expect(member.getByRole("status")).toHaveText("Your account was deleted.");
    // The page cannot be reloaded now (the session is gone), so the result is checked as shown.
    for (const width of [1280, 360]) {
      await member.setViewportSize({ width, height: 900 }); await settleForAxe(member);
      expect((await new AxeBuilder({ page: member }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      await member.screenshot({ path: `${shots}/delete-done-${width}.png`, fullPage: true });
    }
    expect((await member.request.get("/api/account/profile")).status()).toBe(401);
    expect((await admin.query("select email from users where id = $1", [user])).rows[0].email).toMatch(/^deleted-.*@deleted\.invalid$/);

    // The post stays, shown as "Former member".
    await page.goto(`/communities/${slug}/posts/${post.id}`);
    await expect(page.getByRole("heading", { name: "Synthetic member post" })).toBeVisible();
    await expect(page.getByRole("article").getByText("Former member", { exact: true }).first()).toBeVisible();
    await check(page, "post-former-member");
  } finally { await other.close(); await admin.end(); }
});
