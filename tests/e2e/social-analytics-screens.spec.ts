import { mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect as base, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";
import { releaseSocialConnectionsAfterEach } from "./helpers/social-accounts";

// Social Analytics screens against the real Analytics routes with synthetic numeric snapshots. Nothing here refreshes anything (the refresh worker is hard-off and the
// screen has no refresh control); the rows are inserted directly and no provider is called. Accounts are linked through the test provider and then renamed in the
// database, so this spec never holds a `test-<platform>` account another spec in the same server process may use.
const expect = base.configure({ timeout: 30_000 });
test.use({ actionTimeout: 30_000, timezoneId: "UTC" });
const shots = process.env.ANALYTICS_SHOTS ?? "/tmp/analytics-shots";
const credential = "harvest-test-credential";
const day = 86_400_000;

const releaseAfterEach = releaseSocialConnectionsAfterEach();

type Seeded = { tenant: string; owner: string; accounts: Record<string, string>; posts: { yt: string[]; pin: string[] } };

async function link(page: Page, tenant: string, platform: string, name: string, admin: Client) {
  const response = await page.request.post(`/api/workspaces/${tenant}/social/connections`, { headers: { origin }, data: { provider: "fake", credential, accountRef: `test-${platform}` } });
  expect(response.status()).toBe(201);
  const id = (await response.json()).connection.id as string;
  // The identity trigger is bypassed for this disposable test database only (trigger-free session), so the shared test account is released for other specs.
  await admin.query("begin");
  await admin.query("set local session_replication_role = replica");
  await admin.query("update social_connections set external_account_ref=$1, display_name=$2 where id=$3", [`analytics-spec-${randomUUID()}`, name, id]);
  await admin.query("commit");
  return id;
}

async function seed(page: Page, admin: Client, owner: string, tenant: string): Promise<Seeded> {
  const accounts = {
    yt: await link(page, tenant, "youtube", "Grace Sermons", admin),
    pin: await link(page, tenant, "pinterest", "Grace Boards", admin),
    thr: await link(page, tenant, "threads", "Grace Threads", admin),
    red: await link(page, tenant, "reddit", "Grace Forum", admin),
  };
  const now = Date.now();
  // Published rows normally arrive through the publisher; this disposable database takes them directly (trigger-free session, local test data only).
  await admin.query("begin");
  await admin.query("set local session_replication_role = replica");
  for (const id of Object.values(accounts)) {
    await admin.query("insert into social_analytics_refresh (tenant_id,connection_id,state,checked_at,refreshed_at,due_at) values ($1,$2,'ready',now()-interval '12 minutes',now()-interval '12 minutes',now()+interval '1 hour') on conflict (tenant_id,connection_id) do update set state='ready', refreshed_at=excluded.refreshed_at, due_at=excluded.due_at",
      [tenant, id]);
  }
  const posts: Seeded["posts"] = { yt: [], pin: [] };
  let sequence = 0;
  // A published planner delivery plus the stored snapshots for it: counters grow between observations, so the differences are the period's activity.
  async function publish(key: keyof typeof accounts, ageDays: number, hour: number, series: Record<string, number>[], planner = true) {
    const publishedAt = new Date(Date.UTC(new Date(now - ageDays * day).getUTCFullYear(), new Date(now - ageDays * day).getUTCMonth(), new Date(now - ageDays * day).getUTCDate(), hour, 5));
    const ref = `synthetic-${key}-${++sequence}`;
    let id: string | null = null;
    if (planner) {
      id = randomUUID();
      await admin.query(`insert into social_posts (tenant_id,id,connection_id,status,content,idempotency_key,provider_post_ref,published_at,created_by,first_attempt_at,attempts)
        values ($1,$2,$3,'published','Synthetic post',$4,$5,$6,$7,$6,1)`, [tenant, id, accounts[key], `analytics-${randomUUID()}`, ref, publishedAt.toISOString(), owner]);
    }
    for (const [index, metrics] of series.entries()) {
      const captured = new Date(Math.min(publishedAt.getTime() + (index + 1) * day, now - 20 * 60_000));
      if (captured.getTime() < publishedAt.getTime()) continue;
      await admin.query(`insert into social_analytics_posts (tenant_id,connection_id,provider_ref,planner_post_id,day,captured_at,published_at,metrics)
        values ($1,$2,$3,$4,($5::timestamptz at time zone 'UTC')::date,$5,$6,$7) on conflict do nothing`, [tenant, accounts[key], ref, id, captured.toISOString(), publishedAt.toISOString(), JSON.stringify(metrics)]);
    }
    return id;
  }
  const yt = (age: number, hour: number, scale: number) => publish("yt", age, hour, [
    { views: 40 * scale, likes: 6 * scale, comments: scale, shares: 2 * scale }, { views: 90 * scale, likes: 11 * scale, comments: 3 * scale, shares: 4 * scale }, { views: 130 * scale, likes: 15 * scale, comments: 4 * scale, shares: 5 * scale }]);
  for (const [age, hour, scale] of [[24, 9, 3], [21, 18, 5], [18, 9, 2], [15, 18, 7], [12, 12, 4], [9, 18, 6], [6, 9, 1], [3, 18, 8]] as const) posts.yt.push((await yt(age, hour, scale))!);
  for (const [age, hour, scale] of [[20, 7, 2], [14, 7, 4], [8, 19, 3], [5, 19, 5], [2, 7, 1]] as const) {
    posts.pin.push((await publish("pin", age, hour, [{ impressions: 200 * scale, saves: 5 * scale, clicks: 3 * scale }, { impressions: 380 * scale, saves: 9 * scale, clicks: 6 * scale }]))!);
  }
  for (const [age, hour, scale] of [[17, 12, 2], [10, 20, 3], [4, 12, 1], [1, 20, 2]] as const) await publish("thr", age, hour, [{ views: 80 * scale, likes: 7 * scale, comments: 2 * scale, shares: scale }, { views: 150 * scale, likes: 13 * scale, comments: 3 * scale, shares: 2 * scale }]);
  for (const [age, hour, scale] of [[13, 15, 2], [7, 15, 5], [2, 22, 3]] as const) await publish("red", age, hour, [{ score: 20 * scale, comments: 4 * scale }, { score: 33 * scale, comments: 7 * scale }]);
  // Two posts published outside Harvest: ranked, but there is no planner record to open.
  await publish("yt", 11, 21, [{ views: 700, likes: 70, comments: 9, shares: 12 }, { views: 900, likes: 96, comments: 14, shares: 20 }], false);
  await publish("yt", 5, 6, [{ views: 20, likes: 1, comments: 0, shares: 0 }, { views: 31, likes: 2, comments: 0, shares: 0 }], false);

  // Follower counts for 30 days (the baseline before the range comes from the older rows) and the provider's best times for today.
  const today = new Date(now).toISOString().slice(0, 10);
  for (const [key, base, step] of [["yt", 1200, 6], ["pin", 540, 2], ["thr", 310, -1]] as const) {
    for (let back = 40; back >= 0; back--) {
      await admin.query("insert into social_analytics_accounts (tenant_id,connection_id,day,captured_at,metrics) values ($1,$2,$3,$4,$5) on conflict do nothing",
        [tenant, accounts[key], new Date(now - back * day).toISOString().slice(0, 10), new Date(now - back * day - 3600_000).toISOString(), JSON.stringify({ followers: base + (40 - back) * step })]);
    }
  }
  for (const [weekday, hour, engagement, samples] of [[0, 9, 14, 6], [1, 18, 22.5, 9], [1, 19, 18, 4], [2, 12, 9, 3], [3, 18, 25, 11], [4, 7, 6, 2], [5, 10, 17, 5], [6, 8, 12, 4], [6, 19, 19, 7]] as const) {
    await admin.query("insert into social_analytics_times (tenant_id,connection_id,day,weekday,hour,engagement,samples) values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing", [tenant, accounts.yt, today, weekday, hour, engagement, samples]);
  }
  await admin.query("commit");
  return { tenant, owner, accounts, posts };
}

const viewportsShort = [[1280, 900], [360, 800]] as const;
const viewportsFull = [[1280, 2400], [360, 4200]] as const;
/** Both colour schemes at 1280 and 360 (device scale 2): the page must be fully loaded (no skeleton, no busy region, entrance settled) before axe, the overflow check and the screenshot. */
async function audit(page: Page, url: string, name: string, options: { after?: () => Promise<void>; locator?: string; full?: boolean } = {}) {
  const session = await page.context().newCDPSession(page);
  for (const scheme of ["light", "dark"] as const) for (const [width, height] of options.full === false ? viewportsShort : viewportsFull) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: false });
    await page.setViewportSize({ width, height });
    await page.goto(url);
    await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
    await expect(page.getByTestId("analytics-page")).toHaveAttribute("data-ready", "true");
    await expect(page.getByTestId("analytics-page")).not.toHaveAttribute("data-entrance", "playing");
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    await options.after?.();
    await expect(page.locator('[data-slot="skeleton"], [aria-busy="true"]'), `${name} ${scheme} ${width} still loading`).toHaveCount(0);
    await settleForAxe(page);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `${name} ${scheme} ${width}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} ${scheme} ${width} overflow`).toBe(true);
    const path = `${shots}/${name}-${width}-${scheme}.png`;
    if (options.locator) await page.locator(options.locator).first().screenshot({ path, animations: "disabled" });
    else await page.screenshot({ path, fullPage: options.full !== false, animations: "disabled" });
  }
  await session.send("Emulation.clearDeviceMetricsOverride");
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("social analytics: cards, series, platforms, posts, heatmap, detail, states and motion", async ({ page, browser }) => {
  test.setTimeout(900_000);
  await mkdir(shots, { recursive: true });
  const errors: string[] = [], writes: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.method() !== "GET" && request.url().includes("/social/")) writes.push(`${request.method()} ${request.url()}`); });
  const email = await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const empty = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Hope Fellowship", audience: "church" } })).json()).tenantId as string;
  const admin = new Client({ connectionString: await readFile(`${process.env.HARVEST_E2E_MAILBOX}.admin`, "utf8") });
  await admin.connect();
  const owner = (await admin.query("select id from users where email=$1", [email])).rows[0].id as string;
  releaseAfterEach(tenant);
  const data = await seed(page, admin, owner, tenant);
  const url = `/workspaces/${tenant}/social/analytics`;
  const api = `/api/workspaces/${tenant}/social/analytics`;
  const today = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 27 * day).toISOString().slice(0, 10);

  // ---- The route and the gate --------------------------------------------------------------------------------------------------------------------------
  const body = await (await page.request.get(`${api}?from=${from}&to=${today}`)).json();
  expect(body.accounts).toHaveLength(4);
  expect((await page.request.get(`/api/workspaces/${empty}/social/analytics?from=${from}&to=${today}`)).status()).toBe(200);
  const stranger = await browser.newContext({ baseURL: "http://127.0.0.1:3100", timezoneId: "UTC" });
  const outsider = await stranger.newPage();
  await signIn(outsider);
  expect((await outsider.request.get(`${api}?from=${from}&to=${today}`)).status()).toBe(404);
  await outsider.goto(url);
  await expect(outsider.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(outsider.getByTestId("analytics-page")).toHaveCount(0);
  await stranger.close();

  // ---- Loading, then the data (reduced motion): skeletons first, then the settled page with no animation --------------------------------------------------
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(`**${api}?*`, async (route) => { await new Promise((resolve) => setTimeout(resolve, 600)); await route.continue(); });
  await page.goto(url);
  await expect(page.getByTestId("analytics-loading")).toBeVisible();
  await expect(page.getByTestId("analytics-page")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("analytics-page")).toHaveAttribute("data-ready", "true");
  await page.unroute(`**${api}?*`);
  // Reduced motion: the entrance never plays. No running animation, no entrance classes, and the numbers are the final ones at once.
  await expect(page.getByTestId("analytics-page")).toHaveAttribute("data-entrance", "off");
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await expect(page.locator(".animate-in")).toHaveCount(0);
  await expect(page.getByTestId("stat-card")).toHaveCount(4);
  const published = Number(body.summary.published.value);
  await expect(page.getByTestId("stat-card").first().getByTestId("stat-value")).toHaveText(String(published));
  await expect(page.getByRole("heading", { level: 1, name: "Analytics" })).toBeVisible();
  await expect(page.getByTestId("freshness")).toContainText("Updated");

  // Unavailable is never zero: the follower card has data, but a Reddit-only scope has no reach and no followers.
  const redditId = data.accounts.red;
  await page.getByTestId("scope-select").selectOption(`account:${redditId}`);
  await expect(page.getByTestId("analytics-page")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("stat-unavailable")).toHaveCount(2);
  await expect(page.getByTestId("stat-card").filter({ hasText: "Follower change" }).getByTestId("stat-unavailable")).toHaveText("Unavailable");
  await expect(page.getByTestId("stat-card").filter({ hasText: "Follower change" })).not.toContainText(/^0$/);
  await page.getByTestId("scope-select").selectOption("all");
  await expect(page.getByTestId("stat-card")).toHaveCount(4);
  await expect(page.getByTestId("stat-unavailable")).toHaveCount(0);

  // ---- Interactions: metric toggle, top and bottom, heatmap source, detail drawer, range --------------------------------------------------------------
  await page.getByTestId("series-published").click();
  await expect(page.getByTestId("series-published")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("series-engagement").click();
  await expect(page.getByTestId("series-chart")).toBeVisible();
  await expect(page.getByTestId("posts-list").getByTestId("post-row").first()).toBeVisible();
  const linked = page.locator('[data-testid="post-row"][data-linked="true"]');
  await expect(linked.first()).toBeVisible();
  await expect(page.locator('[data-testid="post-row"][data-linked="false"]').first()).toContainText("Published elsewhere");
  await page.getByTestId("posts-bottom").click();
  await expect(page.getByTestId("posts-bottom")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("posts-top").click();
  await expect(page.getByTestId("heatmap-best")).toContainText("Highest");
  await page.getByTestId("heatmap-provider").click();
  await expect(page.getByTestId("heatmap-best")).toContainText("Highest: Thursday 18:00");
  await page.getByTestId("heatmap-observed").click();

  await audit(page, url, "overview");
  await audit(page, url, "heatmap", { locator: '[data-testid="heatmap-card"]' });
  await audit(page, url, "top-posts", { locator: '[data-testid="posts-card"]' });
  await audit(page, url, "range-open", { after: async () => { await page.getByTestId("range-trigger").click(); await expect(page.getByTestId("range-popover")).toBeVisible(); }, full: false });
  await audit(page, url, "post-detail", { after: async () => { await page.locator('[data-testid="post-row"][data-linked="true"]').first().click(); await expect(page.getByTestId("post-detail")).toHaveAttribute("data-ready", "true"); await expect(page.getByTestId("post-metrics")).toBeVisible(); }, full: false });
  // Unavailable metrics: a Reddit-only scope.
  await audit(page, url, "unavailable", { after: async () => { await page.getByTestId("scope-select").selectOption(`account:${redditId}`); await expect(page.getByTestId("analytics-page")).toHaveAttribute("data-ready", "true"); await expect(page.getByTestId("stat-unavailable")).toHaveCount(2); } });

  // Range filter: a custom range reloads without a skeleton and an invalid one cannot be applied.
  await page.goto(url);
  await expect(page.getByTestId("analytics-page")).toHaveAttribute("data-ready", "true");
  await page.getByTestId("range-trigger").click();
  await page.getByRole("button", { name: "Last 7 days" }).click();
  await expect(page.getByTestId("range-trigger")).toContainText("Last 7 days");
  await expect(page.getByTestId("analytics-page")).toHaveAttribute("data-ready", "true");
  await page.getByTestId("range-trigger").click();
  await page.getByLabel("From", { exact: true }).fill(today);
  await page.getByLabel("To", { exact: true }).fill(from);
  await expect(page.getByRole("alert").filter({ hasText: "at most 366 days" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply" })).toBeDisabled();
  await page.keyboard.press("Escape");

  // Tap targets on a phone.
  await page.setViewportSize({ width: 390, height: 800 });
  for (const selector of ['[data-testid="range-trigger"]', '[data-testid="scope-select"]', '[data-testid="series-published"]', '[data-testid="posts-top"]', '[data-testid="heatmap-observed"]', '[data-testid="post-row"][data-linked="true"] >> nth=0']) {
    const box = await page.locator(selector).first().boundingBox();
    expect(box?.height, selector).toBeGreaterThanOrEqual(43.5);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // ---- Partial results: a delayed account and an expired connection --------------------------------------------------------------------------------------
  await admin.query("update social_connections set health='degraded' where id=$1", [data.accounts.thr]);
  await admin.query("update social_connections set health='failing', health_code='token_revoked' where id=$1", [data.accounts.pin]);
  await page.goto(url);
  await expect(page.getByTestId("analytics-page")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("banner-expired")).toContainText("Grace Boards");
  await expect(page.getByTestId("banner-delayed")).toContainText("Grace Threads");
  await expect(page.getByTestId("banner-expired").getByRole("link", { name: "Reconnect accounts" })).toHaveAttribute("href", `/workspaces/${tenant}/social/accounts`);
  await expect(page.getByTestId("stat-card").first()).toBeVisible();
  await audit(page, url, "partial");
  await admin.query("update social_connections set health='healthy', health_code=null where id in ($1,$2)", [data.accounts.thr, data.accounts.pin]);

  // ---- Empty: a ministry with no accounts, and an error state --------------------------------------------------------------------------------------------
  await audit(page, `/workspaces/${empty}/social/analytics`, "empty");
  await expect(page.getByRole("link", { name: "Connect an account" })).toHaveAttribute("href", `/workspaces/${empty}/social/accounts`);
  await page.route(`**${api}?*`, (route) => route.fulfill({ status: 500, json: { error: "x" } }));
  await page.goto(url);
  await expect(page.getByTestId("analytics-error")).toBeVisible();
  await page.unroute(`**${api}?*`);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("analytics-page")).toHaveAttribute("data-ready", "true");

  // ---- Motion: with no reduced-motion setting the entrance plays once; filters and refreshes never replay it ----------------------------------------------
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route(`**${api}?*`, async (route) => { await new Promise((resolve) => setTimeout(resolve, 400)); await route.continue(); });
  await page.goto(url);
  await expect(page.getByTestId("analytics-loading")).toBeVisible();
  await expect(page.getByTestId("analytics-page")).toHaveAttribute("data-entrance", /playing|done/);
  await expect(page.getByTestId("analytics-page")).toHaveAttribute("data-entrance", "done");
  await page.unroute(`**${api}?*`);
  await expect(page.getByTestId("stat-card").first().getByTestId("stat-value")).toHaveText(String(published));
  await page.getByTestId("scope-select").selectOption(`account:${data.accounts.yt}`);
  await expect(page.getByTestId("analytics-page")).toHaveAttribute("data-ready", "true");
  await expect(page.locator(".animate-in")).toHaveCount(0);
  await expect(page.getByTestId("analytics-page")).toHaveAttribute("data-entrance", "done");
  await page.screenshot({ path: `${shots}/motion-settled-1280-light.png`, animations: "disabled" });

  expect(writes, "the screen never sends anything but reads").toEqual([]);
  expect(errors).toEqual([]);
  await admin.end();
});
