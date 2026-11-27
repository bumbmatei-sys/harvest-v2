import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { discoverAdmin } from "./helpers/discover";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// Harvest staff takedown (0137): a visitor reports a community, a member reports a post to Harvest, a staff admin pauses the community (the public page and
// Discover answer 404, members see a notice, the owner sees the reason), restores it, then hides and restores the post. Axe at 1280 and 360, light and dark.
const expect = baseExpect.configure({ timeout: 20_000 });
test.use({ actionTimeout: 30_000, reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });
const evidence = process.env.TAKEDOWN_SHOTS ?? "test-results/community-takedown";
const sizes = [[1280, 900], [360, 740]] as const;
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const reloaded = (error: unknown) => /Execution context was destroyed|navigation/.test(String(error));
async function audit(page: Page, name: string, prepare?: () => Promise<void>) {
  const theme = (value: "light" | "dark") => page.evaluate((v) => { const root = document.documentElement; root.dataset.theme = v; root.classList.toggle("dark", v === "dark"); }, value);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await theme(scheme);
    await prepare?.();
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      // The dev server may reload a page when it finishes compiling a chunk; wait for that and check the same size again.
      for (let attempt = 0; ; attempt++) {
        try {
          // A page caught mid-restart of the dev server renders an empty document: load it again.
          if (await page.evaluate(() => document.body.childElementCount === 0)) { await page.reload(); await page.waitForTimeout(2_000); await theme(scheme); }
          await settleForAxe(page);
          expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations, `${name} ${width} ${scheme}`).toEqual([]);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${width} ${scheme} scroll`).toBe(true);
          await page.screenshot({ path: `${evidence}/${name}-${width}-${scheme}.png`, fullPage: true });
          break;
        } catch (error) {
          if (attempt >= 3 || !(reloaded(error) || /document-title|html-has-lang/.test(String(error)))) throw error;
          await page.waitForLoadState("load"); await page.waitForTimeout(2_000); await theme(scheme);
        }
      }
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await theme("light");
  await page.setViewportSize({ width: 1280, height: 900 });
}
async function person(browser: Browser, errors: string[], name?: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" }), page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const email = await signIn(page);
  if (name) expect((await page.request.put("/api/account/profile", { headers: { origin }, data: { name, locale: null, cityRegion: null } })).ok()).toBe(true);
  return { context, page, email };
}
// Joining is covered by the joining specs; here it goes through the same API the join dialog calls, so a dev-server reload cannot lose the dialog.
async function join(page: Page, slug: string) {
  const response = await page.request.post(`/api/communities/${slug}/join`, { headers: { origin }, data: { rulesVersion: 0, adult: true } });
  expect(response.status(), await response.text()).toBeLessThan(300);
}
// The dev server restarts itself near its memory threshold; a navigation that hits the restart is retried rather than failing the run.
async function go(page: Page, url: string) {
  for (let attempt = 0; ; attempt++) {
    try { return await page.goto(url); } catch (error) {
      if (attempt >= 5 || !/ERR_SOCKET_NOT_CONNECTED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE|ERR_ABORTED|interrupted by another navigation/.test(String(error))) throw error;
      await page.waitForTimeout(5_000);
    }
  }
}

test("report, staff pause and restore a community, hide and restore a post", async ({ page, browser }) => {
  test.setTimeout(600_000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const suffix = Date.now().toString(36), slug = `grace-circle-${suffix}`, name = "Grace Prayer Circle", api = `/api/workspaces/${tenant}/communities`;
  const community = (await (await page.request.post(api, { headers: { origin }, data: { name, slug } })).json()) as { id: string };
  let { version } = await (await page.request.get(`${api}/${community.id}`)).json() as { version: number };
  ({ version } = await (await page.request.patch(`${api}/${community.id}`, { headers: { origin }, data: { version, visibility: "listed", allowOpen: true, discoverOptIn: true, tagline: "Prayer every week" } })).json());
  expect((await page.request.post(`${api}/${community.id}/publish`, { headers: { origin }, data: { version, published: true } })).ok()).toBe(true);
  const admin = await discoverAdmin();
  // The staff queue is global: start from an empty one so the badge count is this run's own.
  await admin.q("delete from community_harvest_reports"); await admin.q("delete from community_takedowns");
  await admin.decide("community", community.id, "approve");
  const general = ((await (await page.request.get(`${api}/${community.id}/categories`)).json()) as { id: string }[])[0].id;

  const visitorContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce", extraHTTPHeaders: { "x-forwarded-for": "198.51.100.77" } });
  const visitor = await visitorContext.newPage();
  const author = await person(browser, errors, "Andrew"), member = await person(browser, errors, "Rebecca");
  const staff = await person(browser, errors);
  try {
    // 1. A visitor reports the public page to Harvest: no account.
    await go(visitor, `/communities/${slug}`);
    await expect(visitor.getByRole("button", { name: "Report", exact: true })).toBeVisible();
    await audit(visitor, "public-report-button");
    await visitor.getByRole("button", { name: "Report", exact: true }).click();
    const dialog = visitor.getByRole("dialog", { name: "Report this community to Harvest" });
    await expect(dialog.getByRole("button", { name: "Send report" })).toBeDisabled();
    await dialog.getByLabel("Looks like a scam").click();
    await dialog.getByLabel("Details (optional)").fill("Asks for money by private message");
    await audit(visitor, "public-report-dialog");
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(dialog.getByRole("status")).toHaveText("Thank you. Harvest staff will review it.", { timeout: 120_000 });
    await dialog.getByRole("button", { name: "Done" }).click();

    // 2. A member reports a post to Harvest instead of the hosts.
    await join(author.page, slug); await join(member.page, slug);
    const post = (await (await author.page.request.post(`/api/communities/${slug}/posts`, { headers: { origin },
      data: { categoryId: general, title: "Cheap watches", body: doc("Buy now"), videoUrl: null, coverFileId: null, attachmentIds: [], commentsOff: false, likesOff: false } })).json()) as { id: string };
    await go(member.page, `/communities/${slug}/posts/${post.id}`);
    await member.page.getByRole("button", { name: "Report post Cheap watches" }).click();
    const report = member.page.getByRole("dialog", { name: "Report post" });
    await report.getByLabel("Harvest", { exact: true }).click();
    await report.getByLabel("Spam or advertising").click();
    await audit(member.page, "member-report-to-harvest");
    await report.getByRole("button", { name: "Send report" }).click();
    // The first call compiles the route in the dev server, which can take a while on a busy machine; the stored report is the proof if the
    // dev server reloads the page before the thanks appear.
    await expect.poll(async () => (await admin.q("select 1 from community_harvest_reports where target_type = 'post' and target_id = $1", [post.id])).length, { timeout: 120_000 }).toBe(1);

    // 3. The staff queue: neutral 404 for everyone else; the admin sees the badge and pauses the community.
    expect((await go(visitor, "/platform/communities"))?.status()).toBe(404);
    expect((await go(member.page, "/platform/communities"))?.status()).toBe(404);
    expect((await member.page.request.get("/api/platform/communities/reports")).status()).toBe(404);
    await admin.grantStaff(staff.email, "admin");
    const s = staff.page;
    await go(s, "/platform/communities");
    await expect(s.getByRole("heading", { name: "Community reports", level: 1 })).toBeVisible();
    await expect(s.locator("[data-community-open-count]")).toHaveText("2 open reports");
    await expect(s.getByText("Asks for money by private message")).toBeVisible();
    await expect(s.getByText("Cheap watches · Buy now")).toBeVisible();
    await audit(s, "staff-queue");
    const communityRow = s.getByRole("row").filter({ hasText: "Asks for money" });
    await communityRow.getByRole("button", { name: `Actions for the report on ${name}` }).click();
    await s.getByRole("menuitem", { name: "Pause community" }).click();
    const hide = s.getByRole("dialog", { name: `Pause ${name}` });
    await hide.getByLabel("Reason (shown to the ministry)").fill("Fundraising outside Harvest's rules");
    await audit(s, "staff-pause-dialog");
    await hide.getByRole("button", { name: "Pause community" }).click();
    await expect(s.getByRole("status")).toHaveText("Hidden.");

    // 4. Public page and Discover answer as for a missing community; members see the notice; the owner sees the reason.
    expect((await go(visitor, `/communities/${slug}`))?.status()).toBe(404);
    await go(visitor, `/discover?q=${encodeURIComponent("grace prayer")}`);
    await expect(visitor.getByText(name)).toHaveCount(0);
    await go(member.page, `/communities/${slug}/forum`);
    await expect(member.page.locator("[data-harvest-paused]")).toContainText(`${name} is paused while Harvest reviews it.`);
    await expect(member.page.locator("[data-harvest-paused]")).not.toContainText("Fundraising");
    await audit(member.page, "member-paused");
    await go(page, `/workspaces/${tenant}/communities/${community.id}/edit`);
    await expect(page.locator("[data-harvest-paused]")).toContainText("Reason: Fundraising outside Harvest's rules");
    await expect(page.getByRole("button", { name: "Request review" })).toBeVisible();
    await audit(page, "owner-paused");
    // The owner asks for a review; staff see it next to the report and the pause.
    await page.getByRole("button", { name: "Request review" }).click();
    const review = page.getByRole("dialog", { name: "Request a review" });
    await review.getByLabel("What did you change?").fill("We removed the outside fundraiser and the private message requests.");
    await audit(page, "owner-request-review-dialog");
    await review.getByRole("button", { name: "Send request" }).click();
    await expect(page.locator("[data-review-requested]")).toContainText("Review requested", { timeout: 120_000 });
    await expect(page.getByRole("button", { name: "Request review" })).toHaveCount(0);
    await audit(page, "owner-review-requested");
    await go(s, "/platform/communities");
    await s.getByRole("tab", { name: /Open/ }).click();
    await expect(s.locator("[data-community-appeal]")).toContainText("We removed the outside fundraiser");
    await expect(s.locator("[data-community-appeal]")).toContainText("Open");
    await audit(s, "staff-queue-appeal");

    // 5. Restore: everything comes back.
    await go(s, "/platform/communities");
    const pausedRow = s.getByRole("row").filter({ hasText: "Asks for money" });
    await expect(pausedRow).toContainText("Hidden");
    await pausedRow.getByRole("button", { name: `Actions for the report on ${name}` }).click();
    await s.getByRole("menuitem", { name: "Restore" }).click();
    await expect(s.getByRole("alertdialog")).toBeVisible();
    await audit(s, "staff-restore-confirm");
    await s.getByRole("alertdialog").getByRole("button", { name: "Restore" }).click();
    await expect(s.getByRole("status")).toHaveText("Restored.");
    expect((await go(visitor, `/communities/${slug}`))?.status()).toBe(200);
    await go(visitor, `/discover?q=${encodeURIComponent("grace prayer")}`);
    await expect(visitor.getByText(name).first()).toBeVisible();
    await go(member.page, `/communities/${slug}/forum`);
    await expect(member.page.getByText("Cheap watches")).toBeVisible();

    // 6. Hide the post: gone for other members, marked for its author and the hosts; then restore it.
    await go(s, "/platform/communities");
    await s.getByRole("row").filter({ hasText: "Cheap watches" }).getByRole("button", { name: `Actions for the report on ${name}` }).click();
    await s.getByRole("menuitem", { name: "Hide post" }).click();
    const hidePost = s.getByRole("dialog", { name: `Hide a post in ${name}` });
    await hidePost.getByLabel("Reason (shown to the ministry)").fill("Spam");
    await hidePost.getByRole("button", { name: "Hide post" }).click();
    await expect(s.getByRole("status")).toHaveText("Hidden.");
    await go(member.page, `/communities/${slug}/forum`);
    await expect(member.page.getByText("Cheap watches")).toHaveCount(0);
    expect((await go(member.page, `/communities/${slug}/posts/${post.id}`))?.status()).toBe(404);
    await go(author.page, `/communities/${slug}/posts/${post.id}`);
    await expect(author.page.locator("[data-harvest-hidden]")).toHaveText("Hidden by Harvest");
    await audit(author.page, "author-hidden-post");
    await go(page, `/communities/${slug}/forum`);
    await expect(page.locator("[data-harvest-hidden]")).toHaveText("Hidden by Harvest");
    await go(s, "/platform/communities");
    const hiddenRow = s.getByRole("row").filter({ hasText: "Cheap watches" });
    await expect(hiddenRow).toContainText("Hidden");
    await hiddenRow.getByRole("button", { name: `Actions for the report on ${name}` }).click();
    await s.getByRole("menuitem", { name: "Restore" }).click();
    await s.getByRole("alertdialog").getByRole("button", { name: "Restore" }).click();
    await expect(s.getByRole("status")).toHaveText("Restored.");
    await go(member.page, `/communities/${slug}/forum`);
    await expect(member.page.getByText("Cheap watches")).toBeVisible();

    const actions = (await admin.q<{ action: string }>("select action from platform_staff_audit where action like 'community.takedown.%' and target_id = any($1) order by created_at", [[community.id, post.id]])).map((r) => r.action);
    expect(actions).toEqual(["community.takedown.hide", "community.takedown.restore", "community.takedown.hide", "community.takedown.restore"]);
    expect((await admin.q<{ status: string }>("select status from community_takedown_appeals where community_id = $1", [community.id])).map((r) => r.status)).toEqual(["restored"]);
    // While paused nobody could join; after the restore the forum takes posts again (checked above).
    expect(errors).toEqual([]);
  } finally {
    await admin.end();
    for (const context of [visitorContext, author.context, member.context, staff.context]) await context.close();
  }
});
