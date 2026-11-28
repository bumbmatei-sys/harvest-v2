import { mkdir } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { discoverAdmin } from "./helpers/discover";
import { origin, signIn } from "./helpers/session";

// Kit PR 7: Communities screens polish (member list, moderation queue, Discover cards, feed cards, creation form).
// Presentation only: the community API and the database policy stay the enforcement. Synthetic data and the local mock mailbox only.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/kit-pr7";
const widths = [360, 390, 768, 1280, 1440] as const;
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/** Axe (wcag2a/2aa/21aa) and no horizontal overflow at five widths in light and dark; screenshots at 360 and 1280 only. */
async function audit(page: Page, name: string, prepare?: () => Promise<void>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.reload(); await page.waitForTimeout(400);
    await prepare?.();
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 768 ? 800 : 1000 });
      await page.evaluate(() => document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `${name} ${scheme} ${width}`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} ${scheme} ${width} overflow`).toBe(true);
      if (width === 360 || width === 1280) await page.screenshot({ path: `${evidence}/${name}-${width}-${scheme}.png`, fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
}
async function person(browser: Browser, errors: string[], name: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const email = await signIn(page);
  expect((await page.request.put("/api/account/profile", { headers: { origin }, data: { name, locale: null, cityRegion: null } })).ok()).toBe(true);
  return { context, page, email };
}
async function join(page: Page, slug: string) {
  await page.goto(`/communities/${slug}`);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Join Kit Youth Group" });
  await dialog.getByLabel("I confirm I am 18 or older").click();
  await dialog.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/communities/${slug}/forum$`));
}
async function tall(locator: ReturnType<Page["locator"]>, min = 44) {
  for (const item of await locator.all()) { const box = await item.boundingBox(); if (box) expect(box.height, await item.innerText().catch(() => "")).toBeGreaterThanOrEqual(min - 0.5); }
}

test("community screens: member list, moderation queue, Discover and feed cards, creation form, and the role matrix", async ({ page, browser }) => {
  test.setTimeout(900_000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  expect((await page.request.put("/api/account/profile", { headers: { origin }, data: { name: "Grace Owner", locale: null, cityRegion: null } })).ok()).toBe(true);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const slug = `youth-${Date.now().toString(36)}`, api = `/api/workspaces/${tenant}/communities`;
  const community = (await (await page.request.post(api, { headers: { origin }, data: { name: "Kit Youth Group", slug } })).json()) as { id: string };
  const editUrl = `/workspaces/${tenant}/communities/${community.id}/edit`;
  let current = (await (await page.request.get(`${api}/${community.id}`)).json()) as { version: number };
  current = await (await page.request.patch(`${api}/${community.id}`, { headers: { origin }, data: { version: current.version, visibility: "listed", discoverOptIn: true, allowOpen: true, tagline: "Weekly meetings for teenagers" } })).json();
  expect((await page.request.post(`${api}/${community.id}/publish`, { headers: { origin }, data: { version: current.version, published: true } })).ok()).toBe(true);
  // Unified Discover lists only approved items (founder decision, 25 Nov): a reviewer approves it through the privileged connection, as the ops path does.
  { const admin = await discoverAdmin(); await admin.decide("community", community.id, "approve"); await admin.end(); }
  const general = ((await (await page.request.get(`${api}/${community.id}/categories`)).json()) as { id: string }[])[0]!.id;
  const newPost = (p: Page, title: string) => p.request.post(`/api/communities/${slug}/posts`, { headers: { origin },
    data: { categoryId: general, title, body: doc("Hello everyone"), videoUrl: null, coverFileId: null, attachmentIds: [], commentsOff: false, likesOff: false } });

  const author = await person(browser, errors, "Andrew Member"), reporter = await person(browser, errors, "Rebecca Member");
  const adminUser = await person(browser, errors, "Ana Admin"), viewerUser = await person(browser, errors, "Victor Viewer");
  const outsider = await person(browser, errors, "Nora Outsider"), other = await person(browser, errors, "Otto Other");
  try {
    await join(author.page, slug); await join(reporter.page, slug);
    const spam = (await (await newPost(author.page, "Cheap watches")).json()) as { id: string };
    expect((await newPost(author.page, "Prayer meeting")).ok()).toBe(true);
    expect((await reporter.page.request.post(`/api/communities/${slug}/reports`, { headers: { origin }, data: { targetType: "post", targetId: spam.id, reason: "spam", note: "Selling watches" } })).ok()).toBe(true);
    expect((await reporter.page.request.post(`/api/communities/${slug}/reports`, { headers: { origin }, data: { targetType: "member", targetId: ((await (await author.page.request.get("/api/auth/get-session")).json()).user.id as string), reason: "harassment" } })).ok()).toBe(true);
    for (const [user, role] of [[adminUser, "admin"], [viewerUser, "viewer"]] as const) expect((await page.request.put(`/api/workspaces/${tenant}/members`, { headers: { origin }, data: { email: user.email, role } })).status()).toBe(200);
    await other.page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Other Ministry", audience: "church" } });

    await test.step("owner: the member list shows roles, status tabs, search and phone cards", async () => {
      await page.goto(editUrl);
      await page.getByRole("navigation", { name: "Community setup" }).getByRole("button", { name: /People/ }).click();
      const list = page.getByRole("table", { name: "Members" });
      await expect(list.getByRole("cell", { name: "Owner", exact: true })).toBeVisible();
      await expect(list.getByRole("cell", { name: "Member", exact: true })).toHaveCount(2);
      await expect(list.getByRole("cell", { name: "Active", exact: true })).toHaveCount(3);
      await page.getByRole("searchbox", { name: "Search members" }).fill("rebecca");
      await expect(list.getByRole("row")).toHaveCount(2);
      await page.getByRole("searchbox", { name: "Search members" }).fill("zzz");
      await expect(page.getByText("No members match")).toBeVisible();
      await page.getByRole("searchbox", { name: "Search members" }).fill("");
      await audit(page, "owner-members", async () => { await page.getByRole("navigation", { name: "Community setup" }).getByRole("button", { name: /People/ }).click(); });
      await page.setViewportSize({ width: 390, height: 800 });
      await expect(page.getByRole("list", { name: "Members" })).toBeVisible();
      await expect(page.getByRole("table", { name: "Members" })).toHaveCount(0);
      await tall(page.getByRole("main").getByRole("tab"));
      await page.setViewportSize({ width: 1440, height: 1000 });
    });

    await test.step("owner: the community details form groups its fields", async () => {
      await page.goto(editUrl);
      await expect(page.getByRole("heading", { name: "Community details" })).toBeVisible();
      await audit(page, "settings");
    });

    await test.step("owner: the new-community form shows the address prefix", async () => {
      await page.goto(`/workspaces/${tenant}/communities`);
      await page.getByRole("button", { name: "New community" }).click();
      const dialog = page.getByRole("dialog", { name: "New community" });
      await dialog.getByLabel("Name").fill("Prayer Team");
      await expect(dialog.getByLabel("Address")).toHaveValue("prayer-team");
      await expect(dialog.getByText("/communities/")).toBeVisible();
      await audit(page, "create-form", async () => { await page.getByRole("button", { name: "New community" }).click(); await page.getByRole("dialog", { name: "New community" }).getByLabel("Name").fill("Prayer Team"); });
    });

    await test.step("host: the moderation queue is a table with type tabs and phone cards", async () => {
      await page.goto(`/communities/${slug}/moderation`);
      const reports = page.getByRole("table", { name: "Reports" });
      await expect(reports.getByRole("row")).toHaveCount(3);
      await page.getByRole("tab", { name: /^Posts/ }).click();
      await expect(reports.getByRole("row")).toHaveCount(2);
      // Resolving the last report of the selected type returns to the all tab instead of an empty, unselected state.
      await page.getByRole("button", { name: "Review Cheap watches" }).click();
      await page.getByRole("dialog", { name: "Review report" }).getByRole("button", { name: "Keep", exact: true }).click();
      await expect(page.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "true");
      await expect(reports.getByRole("row")).toHaveCount(2);
      await expect(page.getByText("No open reports")).toHaveCount(0);
      await audit(page, "moderation-reports");
      await page.getByRole("tab", { name: "Members", exact: true }).click();
      await expect(page.getByRole("table", { name: "Members" }).getByRole("button", { name: "Actions for Andrew Member" })).toBeVisible();
      await audit(page, "moderation-members", async () => { await page.getByRole("tab", { name: "Members", exact: true }).click(); });
      await page.setViewportSize({ width: 390, height: 800 });
      await expect(page.getByRole("list", { name: "Members" })).toBeVisible();
      await tall(page.getByRole("list", { name: "Members" }).getByRole("button"));
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole("tab", { name: "Appeals" }).click();
      await expect(page.getByText("No appeals")).toBeVisible();
    });

    await test.step("members: the public member list has no status and a report action for others", async () => {
      const r = reporter.page;
      await r.goto(`/communities/${slug}/members`);
      await expect(r.getByRole("heading", { name: "3 members", level: 2 })).toBeVisible();
      const list = r.getByRole("table", { name: "3 members" });
      await expect(list.getByRole("button", { name: "Report Andrew Member" })).toBeVisible();
      await expect(list.getByRole("button", { name: "Report Rebecca Member" })).toHaveCount(0);
      await expect(list.getByRole("columnheader", { name: "Status" })).toHaveCount(0);
      await audit(r, "members");
      await r.goto(`/communities/${slug}/moderation`);
      await expect(r.getByRole("table", { name: "Reports" })).toHaveCount(0);
    });

    await test.step("feed: post cards show author, category, replies and likes", async () => {
      const a = author.page;
      await a.goto(`/communities/${slug}/forum`);
      const cards = a.getByRole("main").locator("article");
      await expect(cards).toHaveCount(2);
      await expect(cards.first().getByRole("link", { name: /replies|reply/ })).toBeVisible();
      await expect(cards.first().getByRole("button", { name: /^Like / })).toBeVisible();
      await audit(a, "feed");
    });

    await test.step("Discover: cards with the initials band and the open filter", async () => {
      const p = outsider.page;
      await p.goto("/discover");
      await expect(p.getByRole("heading", { name: "Kit Youth Group", level: 3 })).toBeVisible();
      await expect(p.getByRole("link", { name: "Kit Youth Group", exact: true })).toBeVisible();
      await tall(p.getByRole("link", { name: "Kit Youth Group", exact: true }));
      await audit(p, "discover");
      await p.goto("/discover?q=zzzz-none");
      await expect(p.getByText("No results")).toBeVisible();
    });

    await test.step("role matrix: each role sees only what the server allows", async () => {
      // admin: the member list (managers see the roster)
      await adminUser.page.goto(editUrl);
      await adminUser.page.getByRole("navigation", { name: "Community setup" }).getByRole("button", { name: /People/ }).click();
      await expect(adminUser.page.getByRole("table", { name: "Members" }).getByRole("cell", { name: "Owner", exact: true })).toBeVisible();
      // viewer: read only, no roster
      await viewerUser.page.goto(editUrl);
      await viewerUser.page.getByRole("navigation", { name: "Community setup" }).getByRole("button", { name: /People/ }).click();
      await expect(viewerUser.page.getByText("Only owners and admins can see members.", { exact: true })).toBeVisible();
      await expect(viewerUser.page.getByRole("table", { name: "Members" })).toHaveCount(0);
      // another ministry's owner, a member and a non-member never reach the owner page or the roster API
      for (const who of [other, author, outsider]) {
        await who.page.goto(editUrl);
        await expect(who.page.getByRole("table", { name: "Members" })).toHaveCount(0);
        await expect(who.page.getByRole("button", { name: "Save draft" })).toHaveCount(0);
        expect([403, 404], who.email).toContain((await who.page.request.get(`${api}/${community.id}/members`)).status());
        expect([403, 404], who.email).toContain((await who.page.request.get(`/api/communities/${slug}/moderation/reports`)).status());
      }
      // a non-member sees the public page, not the member screens
      await outsider.page.goto(`/communities/${slug}/members`);
      await expect(outsider.page).toHaveURL(new RegExp(`/communities/${slug}(?:/home)?$`));
      await expect(outsider.page.getByRole("table", { name: /members/ })).toHaveCount(0);
    });
  } finally { for (const who of [author, reporter, adminUser, viewerUser, outsider, other]) await who.context.close(); }
  expect(errors).toEqual([]);
});
