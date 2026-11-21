import { mkdir, readFile } from "node:fs/promises";
import { expect as base, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { origin, signIn } from "./helpers/session";
import { releaseSocialConnectionsAfterEach } from "./helpers/social-accounts";
import { settleForAxe } from "./helpers/settle";

// Social Inbox screens against the real Inbox routes with the non-production fake provider (synthetic conversations only). Reply sending is hard-off, so the
// composer is exercised up to its explained, disabled Send. Failure and partial states are answered by the test through route interception.
const expect = base.configure({ timeout: 30_000 });
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const shots = process.env.INBOX_SHOTS ?? "/tmp/inbox-shots";
const off = process.env.HARVEST_SHELL_MODES === "disabled";
const credential = "harvest-test-credential";

/** Every scene is checked at 1280 and 360 in both schemes, only once it is fully loaded (no skeleton, no busy region, its own ready signal). */
async function audit(page: Page, name: string, ready: (width: number) => Promise<void>, restore: (width: number) => Promise<void> = async () => {}) {
  const session = await page.context().newCDPSession(page);
  for (const scheme of ["light", "dark"] as const) for (const [width, height] of [[1280, 900], [360, 800]] as const) {
    if (width === 1280) { await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); await page.setViewportSize({ width, height }); await page.reload(); await expect(page.locator("html")).toHaveAttribute("data-theme", scheme); }
    await page.setViewportSize({ width, height });
    await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: false });
    await restore(width);
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    await ready(width);
    await expect(page.locator('[data-slot="skeleton"], [aria-busy="true"]'), `${name} ${scheme} ${width} still loading`).toHaveCount(0);
    await settleForAxe(page);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `${name} ${scheme} ${width}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} ${scheme} ${width} overflow`).toBe(true);
    await page.screenshot({ path: `${shots}/${name}-${width}-${scheme}.png`, fullPage: true, animations: "disabled" });
  }
  await session.send("Emulation.clearDeviceMetricsOverride");
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
}

// Releases this spec's fake accounts when it ends (see helpers/social-accounts.ts).
const releaseAfter = releaseSocialConnectionsAfterEach();

test("social inbox: list, filters, thread, comments, reply states, empty, errors, settings and phone", async ({ page, browser }) => {
  test.setTimeout(900_000);
  await mkdir(shots, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const email = await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const api = `/api/workspaces/${tenant}/social`, base = `/workspaces/${tenant}/social/inbox`;
  const admin = new Client({ connectionString: await readFile(`${process.env.HARVEST_E2E_MAILBOX}.admin`, "utf8") });
  await admin.connect();
  releaseAfter(tenant);
  const rows = page.getByTestId("row"), row = (text: string) => rows.filter({ hasText: text });
  const listReady = async () => { await expect(page.getByTestId("list")).toBeVisible(); await expect(rows.first()).toBeVisible(); };

  // A person with no membership gets the neutral answer, not an inbox.
  const stranger = await browser.newPage({ baseURL: origin }); await signIn(stranger);
  await stranger.goto(base); await expect(stranger.getByRole("heading", { name: /workspace|available|access/i }).first()).toBeVisible(); await expect(stranger.getByTestId("inbox")).toHaveCount(0); await stranger.close();

  // ---- No accounts: an honest empty state, not an empty inbox ---------------------------------------------------------
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
  await expect(page.getByTestId("list-empty")).toContainText("No accounts connected");
  await expect(page.getByTestId("no-accounts")).toBeVisible();
  await audit(page, "empty-no-accounts", async (width) => { await expect(page.getByTestId("list-empty")).toBeVisible(); if (width >= 1280) await expect(page.getByTestId("no-accounts")).toBeVisible(); });

  for (const platform of ["instagram", "facebook", "twitter", "bluesky", "telegram"]) {
    expect((await page.request.post(`${api}/connections`, { headers: { origin }, data: { provider: "fake", credential, accountRef: `test-${platform}` } })).status()).toBe(201);
  }
  // Every inbox route answers; the sidebar honours its ETag.
  const side = await page.request.get(`${api}/inbox/sidebar`);
  expect(side.status()).toBe(200);
  expect((await page.request.get(`${api}/inbox/sidebar`, { headers: { "if-none-match": side.headers().etag } })).status()).toBe(304);

  // ---- List, unread and assigned markers --------------------------------------------------------------------------------
  const first = (await (await page.request.post(`${api}/inbox`, { headers: { origin }, data: {} })).json()) as { items: { id: string; title: string; version: number }[] };
  const maria = first.items.find((item) => item.title === "Maria Santos")!;
  const me = (await admin.query("select id from users where email=$1", [email])).rows[0].id as string;
  expect((await page.request.patch(`${api}/inbox/items/${maria.id}`, { headers: { origin }, data: { version: maria.version, change: { action: "assign", assigneeId: me } } })).status()).toBe(200);
  await page.goto(base);
  await listReady();
  await expect(page.getByTestId("unread-dot").first()).toBeVisible();
  await expect(row("Maria Santos").getByTestId("assigned-marker")).toContainText("Assigned to you");
  await expect(page.getByTestId("count-all")).not.toHaveText("0");
  await expect(row("Maria Santos")).toHaveAccessibleName(/Instagram, Direct message, unread/);
  await expect(page.getByTestId("thread-pane")).toContainText("Select a conversation");
  await audit(page, "list-unread-assigned", async (width) => { await listReady(); if (width >= 1280) await expect(page.getByTestId("count-all")).toBeVisible(); });

  // Coloured marks on rows, filters and the open thread; the platform name is in the accessible name.
  await expect(row("Maria Santos").locator('[data-colored="true"]')).toHaveCount(1);
  const colours = await page.evaluate(() => [...document.querySelectorAll<SVGElement>('[data-testid="row"] [data-platform-logo]')].map((svg) => svg.dataset.platformLogo));
  expect(new Set(colours).size).toBeGreaterThan(3);

  // ---- Load more: 15 direct messages on one account page through the aggregate cursor ------------------------------------
  const before = await rows.count();
  if (await page.getByTestId("load-more").count()) { await page.getByTestId("load-more").click(); await expect.poll(() => rows.count()).toBeGreaterThan(before); }

  // ---- Filters: platform, type, tabs, folders ---------------------------------------------------------------------------
  await page.getByTestId("platform-instagram").click();
  await expect.poll(async () => (await rows.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.platform))).every((value) => value === "instagram")).toBe(true);
  await page.getByLabel("Type").selectOption("comment");
  await expect(rows).toHaveCount(1); await expect(row("Sunday worship reel")).toBeVisible();
  await page.getByLabel("Type").selectOption("all");
  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Assigned to me", exact: true }).click();
  await expect(rows).toHaveCount(1); await expect(row("Maria Santos")).toBeVisible();
  await audit(page, "filters", async (width) => { await expect(rows.first()).toBeVisible(); if (width >= 1280) await expect(page.getByTestId("platform-instagram")).toBeVisible(); },
    async (width) => {
      const tab = page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Assigned to me", exact: true });
      if ((await tab.getAttribute("aria-pressed")) === "true") return;
      if (width >= 1280) { await expect(page.getByTestId("platform-instagram")).toBeVisible(); await page.getByTestId("platform-instagram").click(); }
      await tab.click();
    });
  await page.reload(); await listReady();

  // ---- Empty: nothing starred ----------------------------------------------------------------------------------------------
  await page.getByTestId("folder-starred").click();
  await expect(page.getByTestId("list-empty")).toContainText("No conversations match");
  await audit(page, "empty-filtered", async () => { await expect(page.getByTestId("list-empty")).toBeVisible(); }, async (width) => { if (width >= 1280) { await expect(page.getByTestId("folder-starred")).toBeVisible(); await page.getByTestId("folder-starred").click(); } });
  await page.getByTestId("folder-all").click(); await listReady();

  // ---- Direct message thread: live messages, markers, actions, composer ---------------------------------------------------
  await row("Maria Santos").click();
  await expect(page.getByTestId("thread-title")).toHaveText("Maria Santos");
  await expect(page.getByTestId("message")).toHaveCount(3);
  await expect(page.getByTestId("messages")).toContainText("can I bring my two kids?");
  await expect(page.getByTestId("message").nth(1)).toHaveAttribute("data-direction", "outgoing");
  await expect(page.getByTestId("composer")).toHaveAttribute("data-eligible", "yes");
  await expect(page.getByTestId("send-off")).toContainText("Sending replies is turned off");
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await page.getByLabel("Reply", { exact: true }).fill("Yes, bring them!");
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await page.getByLabel("Reply", { exact: true }).fill("");
  // Opening reads it in Harvest; the marker toggles back and forth, and assignment, star and done work.
  await expect(row("Maria Santos")).toHaveAttribute("data-unread", "false");
  await page.getByRole("button", { name: "Mark as unread" }).click();
  await expect(row("Maria Santos")).toHaveAttribute("data-unread", "true");
  await page.getByRole("button", { name: "Mark as read" }).click();
  await expect(row("Maria Santos")).toHaveAttribute("data-unread", "false");
  await page.getByRole("button", { name: "Star", exact: true }).click(); await expect(page.getByRole("button", { name: "Remove star" })).toBeVisible();
  await page.getByRole("button", { name: "Remove star" }).click();
  await page.getByLabel("Assign to").selectOption(me);
  await expect(page.getByTestId("thread")).toContainText("Assigned to you");
  await page.getByLabel("Assign to").selectOption("");
  await page.getByRole("button", { name: "Mark done" }).click(); await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Needs reply", exact: true }).click(); await expect(row("Maria Santos")).toHaveCount(0);
  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "All", exact: true }).click(); await listReady();
  await row("Maria Santos").click(); await page.getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByRole("button", { name: "Mark done" })).toBeVisible();
  const threadUrl = page.url();
  await audit(page, "list-thread", async () => { await expect(page.getByTestId("thread-title")).toHaveText("Maria Santos"); await expect(page.getByTestId("message")).toHaveCount(3); await expect(page.getByTestId("composer")).toBeVisible(); });
  expect(page.url()).toBe(threadUrl);

  // ---- Comment thread: reply, private reply, hide unavailable -------------------------------------------------------------
  await page.goto(base); await listReady();
  await row("Sunday worship reel").click();
  await expect(page.getByTestId("comment")).toHaveCount(4);
  await expect(page.getByTestId("hide-note")).toContainText("Hiding comments is not available yet");
  await expect(page.getByRole("button", { name: "Hide", exact: true }).first()).toBeDisabled();
  await expect(page.getByTestId("comment-unavailable").first()).toBeVisible();
  await expect(page.getByTestId("reply-reason")).toContainText("Choose a comment to reply to");
  await page.getByTestId("comment").filter({ hasText: "This song is beautiful" }).getByRole("button", { name: "Reply privately" }).click();
  await expect(page.getByTestId("reply-target")).toContainText("Replying privately");
  await expect(page.getByTestId("composer")).toHaveAttribute("data-eligible", "yes");
  await page.getByTestId("comment").filter({ hasText: "This song is beautiful" }).getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.getByTestId("reply-target")).toContainText("Replying to a comment");
  await audit(page, "comment-thread", async () => { await expect(page.getByTestId("comment")).toHaveCount(4); await expect(page.getByTestId("composer")).toBeVisible(); });

  // ---- Reply not allowed: the window has closed ------------------------------------------------------------------------------
  await page.goto(base); await listReady();
  await row("Samuel Reed").click();
  await expect(page.getByTestId("reply-reason")).toHaveAttribute("data-reason", "expired_window");
  await expect(page.getByTestId("reply-reason")).toContainText("reply window has closed");
  await expect(page.getByLabel("Reply", { exact: true })).toBeDisabled();
  await audit(page, "reply-not-allowed", async () => { await expect(page.getByTestId("reply-reason")).toBeVisible(); await expect(page.getByTestId("message")).toHaveCount(3); });

  // ---- Mention and story reply open as threads -------------------------------------------------------------------------------
  await page.goto(base); await listReady();
  await row("Mention by a youth group").click(); await expect(page.getByTestId("comment")).toHaveCount(1); await expect(page.getByTestId("messages")).toContainText("youth-night.jpg");
  await page.goto(base); await listReady();
  await row("Reply to your story").click(); await expect(page.getByTestId("message")).toHaveCount(1); await expect(page.getByTestId("thread")).toContainText("Story reply");

  // ---- Local note search: no provider content, results open the live conversation ------------------------------------------
  await page.goto(base); await listReady();
  await page.getByRole("search").getByLabel("Search your notes").fill("zzz-no-note"); await page.keyboard.press("Enter");
  await expect(page.getByTestId("list-empty")).toContainText("No notes match");
  await page.getByRole("button", { name: "Clear search" }).click(); await listReady();

  // ---- Partial result, error and expired-account states (answered by the test) ------------------------------------------------
  const sampleItems = (await (await page.request.post(`${api}/inbox`, { headers: { origin }, data: {} })).json()) as { items: unknown[]; channels: { id: string }[] };
  await page.route(`**${api}/inbox`, async (route) => {
    if (route.request().method() !== "POST" || route.request().postDataJSON()?.cursor) return route.fallback();
    await route.fulfill({ json: { ...sampleItems, partial: [{ accountId: sampleItems.channels[0].id, kind: "dm", state: "delayed", retryAt: Date.now() + 30_000 }], pendingAccountIds: [], nextCursor: null, retryAfter: null } });
  });
  await page.goto(base); await listReady();
  await expect(page.getByTestId("partial-notice")).toContainText("slow, retrying");
  await audit(page, "partial", async () => { await listReady(); await expect(page.getByTestId("partial-notice")).toBeVisible(); });
  await page.unroute(`**${api}/inbox`);
  await page.route(`**${api}/inbox`, (route) => route.request().method() === "POST" && !route.request().postDataJSON()?.cursor ? route.fulfill({ status: 500, json: { error: "x" } }) : route.fallback());
  await page.goto(base);
  await expect(page.getByTestId("list-error")).toContainText("could not be loaded");
  await audit(page, "list-error", async () => { await expect(page.getByTestId("list-error")).toBeVisible(); });
  await page.unroute(`**${api}/inbox`);
  await admin.query("update social_connections set health='failing', health_code='token_expired' where tenant_id=$1 and platform='bluesky'", [tenant]);
  await page.goto(base); await listReady();
  await expect(page.getByTestId("accounts-problem")).toContainText("needs to be reconnected");
  await expect(page.getByTestId("platform-bluesky")).toBeVisible();
  await expect(rows.filter({ has: page.locator('[data-platform-logo="bluesky"]') })).toHaveCount(0);
  await audit(page, "expired-account", async () => { await listReady(); await expect(page.getByTestId("accounts-problem")).toBeVisible(); });
  await admin.query("update social_connections set health='healthy', health_code=null where tenant_id=$1 and platform='bluesky'", [tenant]);

  // ---- Thread load failure keeps an explicit error, never invented text -------------------------------------------------------
  await page.goto(base); await listReady();
  await page.route("**/inbox/items/*/conversation", (route) => route.fulfill({ status: 500, json: { error: "x" } }));
  await row("Daniel Okafor").click();
  await expect(page.getByTestId("thread")).toHaveCount(0); await expect(page.getByTestId("thread-pane")).toContainText("could not be loaded");
  await page.unroute("**/inbox/items/*/conversation");
  await page.getByRole("button", { name: "Try again" }).click(); await expect(page.getByTestId("thread-title")).toHaveText("Daniel Okafor");

  // ---- Settings: working hours and away message --------------------------------------------------------------------------------
  await page.goto(`${base}?view=settings`);
  await expect(page.getByRole("heading", { name: "Inbox settings", level: 1 })).toBeVisible();
  const settingsReady = async () => { await expect(page.getByTestId("hours-settings")).toBeVisible(); await expect(page.getByTestId("hours-day-1")).toBeVisible(); };
  await settingsReady();
  await page.getByRole("button", { name: /Add hours on Monday/ }).click();
  await page.getByRole("button", { name: /Add hours on Monday/ }).click();
  await expect(page.getByTestId("hours-problem")).toContainText("cannot overlap");
  await page.getByRole("button", { name: /Remove hours on Monday/ }).last().click();
  await page.getByRole("textbox", { name: "Away message" }).fill("We are away and will reply when we are back.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Settings saved").first()).toBeVisible();
  await page.reload(); await settingsReady();
  await expect(page.getByRole("textbox", { name: "Away message" })).toHaveValue("We are away and will reply when we are back.");
  await audit(page, "settings", settingsReady);

  // ---- Contextual sidebar: the folders and accounts panel is the whole sidebar, with a back arrow on top -------------------------------------------
  if (off) {
    // Flag off: the filters stay inline beside the list and there is no contextual sidebar.
    await page.goto(base); await listReady();
    await expect(page.getByRole("group", { name: "Inbox sidebar" })).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Filters" })).toBeVisible();
    await expect(page.getByTestId("inbox").getByTestId("folder-all")).toBeVisible();
  } else {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/workspaces/${tenant}/social/planner`);
    await expect(page.getByRole("tablist", { name: "Menu mode" })).toBeVisible();
    await expect(page.locator('[data-slot="skeleton"], [aria-busy="true"]')).toHaveCount(0);
    await page.screenshot({ path: `${shots}/sidebar-before-planner-1280-light.png`, animations: "disabled" });
    await page.getByRole("link", { name: "Inbox", exact: true }).click();
    const inboxSide = page.getByRole("group", { name: "Inbox sidebar" });
    await expect(inboxSide).toBeVisible(); await listReady();
    await expect(page.getByRole("tablist", { name: "Menu mode" })).toHaveCount(0);
    await expect(inboxSide.getByTestId("folder-all")).toBeVisible();
    await expect(page.getByTestId("inbox").getByTestId("folder-all")).toHaveCount(0);
    const back = inboxSide.getByRole("link", { name: "Back to Planner" });
    await expect(back).toBeFocused();
    expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(35);
    // Account groups collapse and expand with disclosure semantics.
    const toggle = inboxSide.getByTestId("toggle-instagram");
    await expect(toggle).toHaveAttribute("aria-expanded", "true"); await expect(inboxSide.getByText("Test instagram")).toBeVisible();
    await toggle.click(); await expect(toggle).toHaveAttribute("aria-expanded", "false"); await expect(inboxSide.getByText("Test instagram")).toBeHidden();
    await toggle.click(); await expect(inboxSide.getByText("Test instagram")).toBeVisible();
    // The conversation list collapses so the thread can take the full width; focus follows the toggle.
    await row("Maria Santos").click();
    const threadWidth = async () => (await page.getByTestId("thread-pane").boundingBox())!.width;
    const wide = await threadWidth();
    await page.getByTestId("list-collapse").click();
    await expect(page.getByTestId("list-pane")).toBeHidden(); await expect(page.getByTestId("list-expand")).toBeFocused();
    await expect(page.getByTestId("list-expand")).toHaveAttribute("aria-expanded", "false");
    expect(await threadWidth()).toBeGreaterThan(wide + 200);
    await page.screenshot({ path: `${shots}/list-collapsed-1280-light.png`, animations: "disabled" });
    await page.getByTestId("list-expand").click();
    await expect(page.getByTestId("list-pane")).toBeVisible(); await expect(page.getByTestId("list-collapse")).toBeFocused();
    await expect(page.getByTestId("messages")).toBeVisible();
    await expect(page.locator('[data-slot="skeleton"], [aria-busy="true"]')).toHaveCount(0);
    await page.screenshot({ path: `${shots}/sidebar-after-inbox-1280-light.png`, animations: "disabled" });
    // Back returns to the normal Harvest sidebar and puts focus on a current entry.
    await back.click();
    await expect(page).toHaveURL(/\/social\/planner/);
    await expect(inboxSide).toHaveCount(0);
    await expect(page.getByRole("tablist", { name: "Menu mode" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Inbox", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: /^Ministry navigation/ }).getByRole("link", { name: "Planner", exact: true })).toBeFocused();
    // Phone: the same panel is the drawer's content.
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(base); await listReady();
    await page.screenshot({ path: `${shots}/sidebar-after-inbox-360-light.png`, animations: "disabled" });
    await page.getByRole("button", { name: "Filters" }).click();
    const drawer = page.getByRole("dialog", { name: "Sidebar" });
    await expect(drawer.getByRole("group", { name: "Inbox sidebar" })).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Back to Planner" })).toBeVisible();
    // 44px targets below 1024px: the back arrow and the account group toggles in the drawer.
    for (const target of [drawer.getByRole("link", { name: "Back to Planner" }), drawer.getByTestId("toggle-instagram"), drawer.getByTestId("folder-unread")]) {
      expect((await target.boundingBox())!.height, "drawer target").toBeGreaterThanOrEqual(43.5);
    }
    await page.screenshot({ path: `${shots}/sidebar-drawer-360-light.png`, animations: "disabled" });
    await drawer.getByTestId("folder-unread").click();
    await expect(drawer).toBeHidden();
    await page.getByRole("button", { name: "Filters" }).click();
    await page.keyboard.press("Escape"); await expect(drawer).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  // Tablet: the list collapse and expand toggles are 44px below 1024px.
  if (!off) {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto(base); await listReady();
    expect((await page.getByTestId("list-collapse").boundingBox())!.height, "list collapse").toBeGreaterThanOrEqual(43.5);
    await page.getByTestId("list-collapse").click();
    expect((await page.getByTestId("list-expand").boundingBox())!.height, "list expand").toBeGreaterThanOrEqual(43.5);
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  // ---- Phone: list, then thread with a back button ----------------------------------------------------------------------------
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(base); await listReady();
  await expect(page.getByTestId("thread-pane")).toBeHidden();
  for (const el of await page.locator('[data-testid="row"], [data-testid="list-pane"] button, [data-testid="list-pane"] [role="tab"]').all()) { if (!(await el.isVisible())) continue; const box = await el.boundingBox(); if (box) expect(box.height, "tap target").toBeGreaterThanOrEqual(43.5); }
  await row("Priya Nair").click();
  await expect(page.getByTestId("thread-title")).toHaveText("Priya Nair"); await expect(page.getByTestId("list-pane")).toBeHidden();
  await page.getByRole("button", { name: "Back to conversations" }).click();
  await expect(page.getByTestId("list-pane")).toBeVisible(); await expect(page.getByTestId("thread-pane")).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });

  // Nothing leaves the browser console as an error, and the stored data holds no message text.
  expect(errors).toEqual([]);
  const canary = await admin.query("select count(*)::int as n from social_inbox_notes");
  expect(canary.rows[0].n).toBe(0);
  const stored = await admin.query("select count(*)::int as n from audit_logs where metadata::text ilike '%bring my two kids%'");
  expect(stored.rows[0].n).toBe(0);
  await admin.end();
});
