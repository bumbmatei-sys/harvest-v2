import { mkdir, readFile } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "./helpers/test";
import AxeBuilder from "@axe-core/playwright";
import { signUnsubscribe } from "../../src/lib/community-email-token";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// C15c: the email frequency choice in the notification settings sheet and the unsubscribe confirmation page.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = process.env.HARVEST_E2E_SHOTS ?? "test-results/communities-c15c";
const sizes = [["desktop", 1280, 900], ["phone", 360, 800]] as const;

async function shoot(page: Page, name: string, prepare?: () => Promise<void>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.reload(); await page.waitForTimeout(300);
    await prepare?.();
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await settleForAxe(page);
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
}
async function person(browser: Browser, errors: string[], name: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  expect((await page.request.put("/api/account/profile", { headers: { origin }, data: { name, locale: null, cityRegion: null } })).ok()).toBe(true);
  return { context, page };
}
const openSettings = async (page: Page, slug: string) => {
  await page.goto(`/communities/${slug}/forum`);
  await page.getByRole("button", { name: /^Notifications/ }).first().click({ timeout: 60000 });
  await page.getByRole("button", { name: "Notification settings" }).click();
  const sheet = page.getByRole("dialog", { name: "Notification settings" });
  await expect(sheet).toBeVisible();
  return sheet;
};

test("a member chooses an email frequency, and the unsubscribe page changes nothing until they confirm", async ({ page, browser }) => {
  test.setTimeout(480000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const slug = `email-${Date.now().toString(36)}`;
  const community = (await (await page.request.post(`/api/workspaces/${tenant}/communities`, { headers: { origin }, data: { name: "Youth Group", slug } })).json()) as { id: string };
  const api = `/api/workspaces/${tenant}/communities/${community.id}`;
  let current = (await (await page.request.get(api)).json()) as { version: number };
  current = (await (await page.request.patch(api, { headers: { origin }, data: { version: current.version, visibility: "listed", allowOpen: true } })).json());
  expect((await page.request.post(`${api}/publish`, { headers: { origin }, data: { version: current.version, published: true } })).ok()).toBe(true);

  const member = await person(browser, errors, "Andrew");
  const visitor = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  try {
    const m = member.page;
    await m.goto(`/communities/${slug}`);
    await m.getByRole("button", { name: "Join", exact: true }).click();
    const dialog = m.getByRole("dialog", { name: "Join Youth Group" });
    await dialog.getByLabel("I confirm I am 18 or older").click();
    await dialog.getByRole("button", { name: "Join", exact: true }).click();
    await expect(m).toHaveURL(new RegExp(`/communities/${slug}/forum$`), { timeout: 90000 });

    // Frequency: important is the default; daily is saved, confirmed by a toast, and still chosen after a reload.
    let sheet = await openSettings(m, slug);
    await expect(sheet.getByRole("radio", { name: "Important only" })).toBeChecked();
    await sheet.getByRole("radio", { name: "Daily summary" }).click();
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(m.getByText("Notification settings saved.")).toBeVisible();
    await expect(sheet).toBeHidden();
    sheet = await openSettings(m, slug);
    await expect(sheet.getByRole("radio", { name: "Daily summary" })).toBeChecked();
    await shoot(m, "settings-email", async () => { await openSettings(m, slug); });

    // A real token for this membership, signed with the test server's throwaway secret.
    const secret = (await readFile(`${process.env.HARVEST_E2E_MAILBOX}.auth-secret`, "utf8")).trim();
    const userId = (await (await m.request.get("/api/auth/get-session")).json()).user.id as string;
    const token = signUnsubscribe(secret, { tenantId: tenant, communityId: community.id, userId });

    // Opening the link (GET) shows the question, drops the fragment and sends nothing.
    const v = await visitor.newPage();
    v.on("pageerror", (error) => errors.push(error.message));
    const posts: string[] = [];
    v.on("request", (request) => { if (request.method() !== "GET") posts.push(request.url()); });
    await v.goto(`/communities/unsubscribe#token=${token}`);
    await expect(v.getByRole("heading", { name: "Stop emails from this community?" })).toBeVisible({ timeout: 60000 });
    await expect.poll(() => new URL(v.url()).hash).toBe("");
    await v.waitForTimeout(500);
    expect(posts.filter((url) => url.includes("/api/communities/unsubscribe"))).toEqual([]);
    sheet = await openSettings(m, slug);
    await expect(sheet.getByRole("radio", { name: "Daily summary" })).toBeChecked();

    // Confirming switches this community's email off.
    const answer = v.waitForResponse((response) => response.url().endsWith("/api/communities/unsubscribe") && response.request().method() === "POST");
    await v.getByRole("button", { name: "Stop emails" }).click();
    expect(await (await answer).json()).toEqual({ ok: true });
    await expect(v.getByRole("heading", { name: "Your request was received" })).toBeVisible();
    const neutral = await v.locator("main").innerText();
    sheet = await openSettings(m, slug);
    await expect(sheet.getByRole("radio", { name: "Off" })).toBeChecked();

    // A forged or missing token shows exactly the same result.
    for (const link of ["/communities/unsubscribe#token=bm90LWE.dG9rZW4", "/communities/unsubscribe"]) {
      await v.goto("about:blank"); await v.goto(link);
      await v.getByRole("button", { name: "Stop emails" }).click();
      await expect(v.getByRole("heading", { name: "Your request was received" })).toBeVisible();
      expect(await v.locator("main").innerText()).toBe(neutral);
    }
    await shoot(v, "unsubscribe-confirm");
    await shoot(v, "unsubscribe-done", async () => {
      await v.getByRole("button", { name: "Stop emails" }).click();
      await expect(v.getByRole("heading", { name: "Your request was received" })).toBeVisible();
    });
    expect(errors).toEqual([]);
  } finally { await member.context.close(); await visitor.close(); }
});
