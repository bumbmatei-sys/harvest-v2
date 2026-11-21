import { mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { expect as base, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { origin, signIn } from "./helpers/session";
import { releaseSocialConnectionsAfterEach } from "./helpers/social-accounts";
import { settleForAxe } from "./helpers/settle";

// Social Publish screens: accounts, composer (rings, media, options, review), queue, calendar and drafts, against the real Publish routes with the
// non-production fake provider. Media bytes are not inspected here (no media inspector exists), so the media routes are answered by the test and the
// stored files are seeded; everything else is the real server. Synthetic data and the local test database only.
const expect = base.configure({ timeout: 30_000 });
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const shots = process.env.SOCIAL_SHOTS ?? "/tmp/social-pr1-shots";
const credential = "harvest-test-credential";

async function audit(page: Page, name: string, options: { shot?: boolean; disable?: string[]; restore?: () => Promise<void>; ready?: (width: number) => Promise<void>; check?: (width: number, scheme: string) => Promise<void> } = {}) {
  const session = await page.context().newCDPSession(page);
  for (const scheme of ["light", "dark"] as const) for (const [width, height, scale] of [[1280, 1900, 1], [360, 2600, 2]] as const) {
    if (width === 1280) { await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); await page.reload(); await expect(page.locator("html")).toHaveAttribute("data-theme", scheme); await options.restore?.(); }
    await page.setViewportSize({ width, height });
    await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    // The page must be fully loaded before axe, the overflow check and the screenshot: no skeleton, no busy region, and the page's own ready signal.
    await options.ready?.(width);
    await expect(page.locator('[data-slot="skeleton"], [aria-busy="true"]'), `${name} ${scheme} ${width} still loading`).toHaveCount(0);
    await options.check?.(width, scheme);
    await settleForAxe(page);
    let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]);
    if (options.disable?.length) builder = builder.disableRules(options.disable);
    const result = await builder.analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `${name} ${scheme} ${width}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} ${scheme} ${width} overflow`).toBe(true);
    if (options.shot !== false) await page.screenshot({ path: `${shots}/${name}-${width}-${scheme}.png`, fullPage: true, animations: "disabled" });
  }
  await session.send("Emulation.clearDeviceMetricsOverride");
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await options.restore?.();
}
/** An overlay (popup, sheet, dialog) in both colour schemes at 1280 and 360 (device scale 2): the theme follows the system scheme at load, so each scheme reloads and rebuilds the page first. */
async function overlayShots(page: Page, name: string, restore: () => Promise<void>, open: () => Promise<void>, close: () => Promise<void>) {
  const session = await page.context().newCDPSession(page);
  for (const scheme of ["light", "dark"] as const) {
    await page.setViewportSize({ width: 1280, height: 900 }); await session.send("Emulation.clearDeviceMetricsOverride");
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); await page.reload(); await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
    await restore();
    for (const [width, height, scale] of [[1280, 900, 1], [360, 800, 2]] as const) {
      await page.setViewportSize({ width, height });
      await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
      await open(); await settleForAxe(page);
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `${name} ${scheme} ${width}`).toEqual([]);
      await page.screenshot({ path: `${shots}/${name}-${width}-${scheme}.png`, animations: "disabled" });
      await close();
    }
  }
  await session.send("Emulation.clearDeviceMetricsOverride"); await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.reload();
}
// A real, decodable PNG (a soft two-colour gradient) padded with an ancillary text chunk to a realistic file size, so thumbnails render and sizes read like real photos.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf: Buffer) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer) => { const head = Buffer.alloc(4); head.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(body)); return Buffer.concat([head, body, tail]); };
function png(width: number, height: number, from: [number, number, number], to: [number, number, number], pad = 0) {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) { const row = Buffer.alloc(1 + width * 3); for (let x = 0; x < width; x++) { const t = (x / width + y / height) / 2; for (let i = 0; i < 3; i++) row[1 + x * 3 + i] = Math.round(from[i] + (to[i] - from[i]) * t); } rows.push(row); }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), ...(pad ? [chunk("tEXt", Buffer.from(`Comment\0${"x".repeat(pad)}`))] : []), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
const fixtures: Record<string, Buffer> = {
  "photo-square.jpg": png(96, 96, [233, 196, 106], [38, 70, 83], 118_000),
  "photo-wide.jpg": png(120, 63, [42, 157, 143], [244, 162, 97], 148_000),
  "sermon-vertical.mp4": Buffer.alloc(3_000_000, 1),
};
const snap = (page: Page, name: string) => page.screenshot({ path: `${shots}/${name}.png`, animations: "disabled" });
async function tapTargets(page: Page, selector: string) {
  await page.setViewportSize({ width: 390, height: 800 });
  for (const item of await page.locator(selector).all()) { if (!(await item.isVisible())) continue; const box = await item.boundingBox(); if (box) expect(box.height, await item.innerText().catch(() => selector)).toBeGreaterThanOrEqual(43.5); }
  await page.setViewportSize({ width: 1280, height: 900 });
}

// Releases this spec's fake accounts when it ends (see helpers/social-accounts.ts).
const releaseAfter = releaseSocialConnectionsAfterEach();

test("social publish: accounts, composer with rings and media, review, queue, calendar and drafts", async ({ page }) => {
  test.setTimeout(900_000);
  await mkdir(shots, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const email = await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  releaseAfter(tenant);
  const api = `/api/workspaces/${tenant}/social`, base = `/workspaces/${tenant}/social`;
  const admin = new Client({ connectionString: await readFile(`${process.env.HARVEST_E2E_MAILBOX}.admin`, "utf8") });
  await admin.connect();
  const owner = (await admin.query("select id from users where email=$1", [email])).rows[0].id as string;

  // Seeded ready files and the media routes answered by the test.
  const seeded: Record<string, string> = {};
  const seed = async (name: string, mime: string, size: number, metadata: object) => {
    const id = randomUUID(); seeded[name] = id;
    await admin.query(`insert into files (id,tenant_id,owner_id,key,name,mime,size,checksum,status,social_upload,media_metadata) values ($1,$2,$3,$4,$5,$6,$7,$8,'ready',true,$9)`,
      [id, tenant, owner, `workspaces/${tenant}/files/${id}`, name, mime, size, "a".repeat(64), JSON.stringify(metadata)]);
  };
  await seed("photo-square.jpg", "image/jpeg", 120_000, { width: 1080, height: 1080 });
  await seed("photo-wide.jpg", "image/jpeg", 150_000, { width: 1200, height: 630 });
  await seed("sermon-vertical.mp4", "video/mp4", 5_000_000, { width: 1080, height: 1920, durationMs: 20_000 });
  const metadataOf: Record<string, object> = { "photo-square.jpg": { width: 1080, height: 1080 }, "photo-wide.jpg": { width: 1200, height: 630 }, "sermon-vertical.mp4": { width: 1080, height: 1920, durationMs: 20_000 } };
  await page.route(`**${api}/media`, async (route) => { const name = route.request().postDataJSON().name as string; await route.fulfill({ status: 201, json: { file: { id: seeded[name], name, mime: route.request().postDataJSON().mime, size: 1, status: "pending", mediaMetadata: null }, upload: { kind: "single" } } }); });
  await page.route(`**${api}/media/*/parts`, (route) => route.fulfill({ json: { upload: { url: `${origin}/__put`, method: "PUT", headers: {} } } }));
  await page.route("**/__put", (route) => route.fulfill({ status: 200, headers: { etag: '"abc"', "access-control-allow-origin": "*", "access-control-expose-headers": "ETag" }, body: "" }));
  await page.route(`**${api}/media/*/confirm`, async (route) => {
    const id = route.request().url().split("/media/")[1].split("/")[0]; const name = Object.keys(seeded).find((key) => seeded[key] === id)!;
    await route.fulfill({ json: { file: { id, name, mime: "x", size: 1, status: "ready", mediaMetadata: metadataOf[name] } } });
  });
  const file = (name: string, mime: string, bytes = 100) => ({ name, mimeType: mime, buffer: fixtures[name] ?? Buffer.alloc(bytes, 1) });

  // Gate: a missing page and the neutral answer for a closed integration are covered by unit tests; here the routes answer for the owner.
  expect((await page.request.get(`${api}/connections`)).status()).toBe(200);

  // ---- Accounts -----------------------------------------------------------------------------------------------------
  await page.goto(`${base}/accounts`);
  await expect(page.getByRole("heading", { name: "Social accounts", level: 1 })).toBeVisible();
  await expect(page.getByText("No accounts connected")).toBeVisible();
  for (const platform of ["twitter", "instagram", "bluesky", "tiktok", "telegram"]) {
    expect((await page.request.post(`${api}/connections`, { headers: { origin }, data: { provider: "fake", credential, accountRef: `test-${platform}` } })).status()).toBe(201);
  }
  expect((await page.request.post(`${api}/schedules`, { headers: { origin }, data: { name: "Ministry schedule", timezone: "UTC", slots: [0, 1, 2, 3, 4, 5, 6].flatMap((day) => [{ day, time: "09:00" }, { day, time: "17:30" }]) } })).status()).toBe(201);
  await page.reload();
  await expect(page.getByTestId("account-card")).toHaveCount(5);
  const instagramCard = page.locator('[data-testid="account-card"][data-platform="instagram"]');
  await expect(instagramCard.getByText("Not checked")).toBeVisible();
  await expect(instagramCard.getByRole("listitem").filter({ hasText: "First comment" })).toHaveAttribute("data-level", "supported");
  await expect(page.locator('[data-testid="account-card"][data-platform="telegram"]').getByRole("listitem").filter({ hasText: "First comment" })).toHaveAttribute("data-level", "unavailable");
  await instagramCard.getByRole("button", { name: "Check health" }).click();
  await expect(page.getByText("Account updated").first()).toBeVisible();
  await expect(instagramCard.getByText("Healthy")).toBeVisible();
  await audit(page, "accounts", { ready: async () => { await expect(page.getByTestId("account-card")).toHaveCount(5); await expect(page.getByTestId("marker-legend")).toBeVisible(); } });

  // ---- Sidebar: the Social media group (Public mode) and Social accounts in the Settings pop-up ----------------------------------------
  const sidebar = page.getByRole("complementary", { name: "Ministry sidebar" });
  const sidebarSession = await page.context().newCDPSession(page);
  for (const scheme of ["light", "dark"] as const) {
    await sidebarSession.send("Emulation.clearDeviceMetricsOverride"); await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); await page.reload(); await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
    await page.getByRole("tab", { name: "Public" }).click();
    await expect(sidebar.getByRole("button", { name: "Social media" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Planner" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Inbox", exact: true })).toBeVisible();
    for (const hidden of ["Compose", "Calendar", "Queue"]) await expect(sidebar.getByRole("link", { name: hidden, exact: true })).toHaveCount(0);
    await sidebar.screenshot({ path: `${shots}/sidebar-public-1280-${scheme}.png`, animations: "disabled" });
    await page.getByRole("tab", { name: "Operations" }).click();
    // Social accounts left the Operations sidebar: it lives in the Settings pop-up (Connections) and the Planner button.
    await expect(sidebar.getByRole("link", { name: "Social accounts" })).toHaveCount(0);
    await sidebar.screenshot({ path: `${shots}/sidebar-settings-1280-${scheme}.png`, animations: "disabled" });
    await page.getByRole("tab", { name: "Public" }).click();
    await page.setViewportSize({ width: 360, height: 800 });
    await sidebarSession.send("Emulation.setDeviceMetricsOverride", { width: 360, height: 800, deviceScaleFactor: 2, mobile: false });
    await page.getByRole("banner").getByRole("button", { name: "Toggle Sidebar" }).click();
    await page.getByRole("dialog", { name: "Sidebar" }).getByRole("tab", { name: "Public" }).click();
    await expect(page.getByRole("dialog", { name: "Sidebar" }).getByRole("link", { name: "Planner" })).toBeVisible();
    await page.screenshot({ path: `${shots}/sidebar-360-${scheme}.png`, animations: "disabled" });
    await page.keyboard.press("Escape");
  }
  await sidebarSession.send("Emulation.clearDeviceMetricsOverride"); await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" }); await page.setViewportSize({ width: 1280, height: 900 }); await page.reload();

  // ---- Composer: rings -----------------------------------------------------------------------------------------------
  await page.goto(`${base}/compose`);
  await expect(page.getByRole("heading", { name: "Planner", level: 1 })).toBeVisible();
  await expect(page.getByTestId("type-note")).toContainText("Article: connect a blog to use this.");
  await expect(page.getByRole("radio", { name: "Article" })).toBeDisabled();
  const ring = (platform: string) => page.locator(`button[data-platform="${platform}"]`);
  await expect(ring("twitter")).toHaveAttribute("aria-checked", "false");
  const sunday = "Come and see: Sunday worship at 10am, all are welcome.";
  const rebuild = async (text: string, files: ("photo-square.jpg" | "photo-wide.jpg" | "sermon-vertical.mp4")[]) => {
    for (const platform of ["twitter", "instagram", "bluesky"]) await ring(platform).click();
    await page.getByLabel("Post text").fill(text);
    for (const name of files) await page.getByTestId("media-input").setInputFiles([file(name, name.endsWith("mp4") ? "video/mp4" : "image/jpeg", 2000)]);
    await expect(page.getByTestId("media-item")).toHaveCount(files.length);
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(files.length);
  };
  for (const platform of ["twitter", "instagram", "bluesky"]) await ring(platform).click();
  await expect(ring("twitter")).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("Post text").fill("x".repeat(140));
  await expect(ring("twitter")).toContainText("About 140 / 280");
  await ring("twitter").hover();
  const popup = page.locator('[data-testid="ring-popup"][data-state="open"]');
  await expect(popup).toContainText("About 140 / 280");
  await expect(popup).toContainText("140 left");
  await page.mouse.move(0, 0);
  await expect(popup).toBeHidden();
  await overlayShots(page, "composer-ring-popup", () => rebuild("x".repeat(140), []), async () => { await ring("twitter").focus(); await expect(page.locator('[data-testid="ring-popup"][data-state="open"]')).toContainText("About 140 / 280"); }, async () => { await page.keyboard.press("Escape"); await ring("twitter").blur(); });
  await rebuild("x".repeat(140), []);
  // Keyboard: focus shows the same popup.
  await ring("bluesky").focus();
  await expect(page.locator('[data-testid="ring-popup"][data-state="open"]')).toContainText("140 / 300");
  await page.keyboard.press("Escape");
  await page.getByLabel("Post text").fill("Come and see: Sunday worship at 10am, all are welcome. We gather to sing, pray and hear the Word together. Bring a friend and stay for lunch afterwards.");
  await expect(page.getByTestId("composer-preview")).toBeVisible();
  await expect(page.getByTestId("preview-text")).toContainText("Come and see");
  await tapTargets(page, 'button[data-platform]');

  // Over limit on X (280), fine elsewhere.
  await page.getByLabel("Post text").fill("a".repeat(290));
  await expect(ring("twitter")).toContainText("About 290 / 280");
  await expect(ring("twitter")).toHaveAttribute("data-tone", "over");
  await expect(ring("instagram")).toHaveAttribute("data-tone", "ok");
  await expect(page.getByTestId("blocked-reason")).toContainText(/Fix \d+ issues?/);
  await expect(page.getByRole("button", { name: "Publish now" })).toHaveAttribute("aria-disabled", "true");
  await ring("twitter").hover();
  await expect(page.locator('[data-testid="ring-popup"][data-state="open"]')).toContainText("Over by 10");
  await snap(page, "composer-over-limit-1280-light");
  await page.mouse.move(0, 0);
  await audit(page, "composer-over-limit", { restore: async () => { await rebuild("a".repeat(290), []); } });
  await page.getByLabel("Post text").fill("Come and see: Sunday worship at 10am, all are welcome.");
  // Instagram needs media: the post cannot go out yet, and says why in the preview.
  await expect(page.getByTestId("blocked-reason")).toContainText("Fix 1 issue");

  // ---- Media -----------------------------------------------------------------------------------------------------------
  await page.getByTestId("media-input").setInputFiles([file("photo-square.jpg", "image/jpeg"), file("photo-wide.jpg", "image/jpeg")]);
  await expect(page.getByTestId("media-item")).toHaveCount(2);
  await expect(page.getByTestId("media-item").first()).toContainText("photo-square.jpg");
  await expect(page.getByRole("button", { name: "Remove photo-square.jpg" })).toBeVisible();
  await page.getByRole("button", { name: "Alt text for photo-square.jpg" }).click();
  await page.getByLabel("Alt text", { exact: true }).fill("The church at sunrise");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Move photo-square.jpg later" }).click();
  await expect(page.getByTestId("media-item").first()).toContainText("photo-wide.jpg");
  const cardOf = (platform: string) => page.locator(`[data-testid="destination-card"][data-platform="${platform}"]`);
  const ensureOpen = async (platform: string) => { const trigger = cardOf(platform).getByRole("button").first(); if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click(); };
  // Accepted and rejected media live in each platform's panel; opening it is part of the check.
  const status = (platform: string) => { const card = cardOf(platform); return card; };
  for (const platform of ["instagram", "twitter"]) await ensureOpen(platform);
  await expect(status("instagram").locator('[data-media-state="accepted"]')).toHaveCount(2);
  await expect(page.getByTestId("blocked-reason")).toHaveCount(0);
  await expect(status("twitter").locator('[data-media-state="accepted"]')).toHaveCount(2);
  await page.getByTestId("media-input").setInputFiles([file("sermon-vertical.mp4", "video/mp4", 5000)]);
  await expect(page.getByTestId("media-item")).toHaveCount(3);
  // Images and a video together: X rejects the mix with a reason, Instagram accepts it, Bluesky takes at most four items.
  await expect(status("twitter").locator('[data-media-state="rejected"]').first()).toContainText("Images and videos cannot be mixed here.");
  await expect(status("instagram").locator('[data-media-state="accepted"]')).toHaveCount(3);
  await expect(status("twitter")).toContainText("3 / 4 items");
  await expect(page.getByTestId("blocked-reason")).toContainText("Fix");
  await snap(page, "composer-media-rejected-1280-light");
  await tapTargets(page, '[data-testid="media-item"] button');
  await audit(page, "composer-media", { restore: async () => { await rebuild(sunday, ["photo-square.jpg", "photo-wide.jpg", "sermon-vertical.mp4"]); await ensureOpen("instagram"); await ensureOpen("twitter"); } });
  // A file type that is not allowed never uploads.
  await page.getByTestId("media-input").setInputFiles([file("notes.exe", "application/x-msdownload", 100)]);
  await expect(page.getByText("This file type cannot be attached.")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  // Take the video off X: the mix is gone and the post is clean there. Dropping it from the post's other accounts is the person's call.
  await page.getByRole("button", { name: "Remove sermon-vertical.mp4" }).click();
  await expect(status("twitter").locator('[data-media-state="accepted"]')).toHaveCount(2);
  await expect(page.getByTestId("blocked-reason")).toHaveCount(0);

  // ---- Each platform and options ----------------------------------------------------------------------------------------
  const row = (name: string) => page.getByTestId("option-row").filter({ hasText: name });
  const setOptions = async () => {
    await row("First comment").getByRole("switch").click();
    await row("First comment").getByRole("textbox").fill("Directions are in our bio.");
    await row("Auto repost").getByRole("switch").click();
    await row("Auto repost").getByLabel("Every (days)").fill("14");
    await expect(row("Link")).toHaveAttribute("data-state", "unavailable");
    await expect(row("Link")).toContainText("Not available for the selected accounts.");
    await ensureOpen("instagram");
    await expect(cardOf("instagram").getByLabel("Include photo-wide.jpg")).toBeChecked();
    await expect(cardOf("instagram").getByRole("radio", { name: "Reel" })).toBeVisible();
    await ensureOpen("twitter");
    await cardOf("twitter").getByLabel("Custom text for X").click();
    await cardOf("twitter").getByRole("textbox", { name: "Text for X" }).fill("Worship Sunday 10am. All welcome.");
    await expect(cardOf("twitter")).toContainText("About 33 of 280".replace(" of ", " / "));
    await expect(ring("twitter")).toContainText("About 33 / 280");
  };
  await setOptions();
  await snap(page, "composer-options-1280-light");
  // Switches and checkboxes are small controls inside a label row of at least 44px that toggles them; the rest are measured directly.
  await tapTargets(page, '[data-testid="destination-card"] button:not([role="switch"]):not([role="checkbox"]), [data-testid="destination-card"] input[type="number"], [data-testid="destination-card"] label');
  await audit(page, "composer-options", { restore: async () => { await rebuild(sunday, ["photo-square.jpg", "photo-wide.jpg"]); await setOptions(); } });

  // Save a draft (it stays in the drafts panel) and reopen it.
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByTestId("composer-notice")).toContainText("Draft saved.");
  await expect(page.getByTestId("draft-count")).toHaveText("1");
  const draftId = ((await (await page.request.get(`${api}/drafts`)).json()).drafts[0].id) as string;
  await overlayShots(page, "drafts-panel", async () => { await page.goto(`${base}/compose`); await expect(page.getByTestId("draft-count")).toHaveText("1"); },
    async () => { await page.getByRole("button", { name: /^Drafts/ }).click(); await expect(page.getByTestId("draft-item")).toHaveCount(1); }, async () => { await page.keyboard.press("Escape"); });
  await page.goto(`${base}/compose?draft=${draftId}`);
  await expect(page.getByLabel("Post text")).toHaveValue(sunday);
  await expect(ring("twitter")).toHaveAttribute("aria-checked", "true");

  // ---- Publish now: review step, then per-destination results ----------------------------------------------------------------
  const openReview = async () => { await page.getByRole("button", { name: "Publish now" }).click(); await expect(page.getByTestId("review-dialog")).toBeVisible(); };
  await overlayShots(page, "publish-review", async () => { await page.goto(`${base}/compose?draft=${draftId}`); await expect(page.getByLabel("Post text")).toHaveValue(sunday); },
    openReview, async () => { await page.getByTestId("review-dialog").getByRole("button", { name: "Back" }).click(); });
  await page.goto(`${base}/compose?draft=${draftId}`);
  await expect(ring("twitter")).toHaveAttribute("aria-checked", "true");
  await openReview();
  const review = page.getByTestId("review-dialog");
  await expect(review.getByTestId("review-destination")).toHaveCount(3);
  await expect(review).toContainText("Worship Sunday 10am. All welcome.");
  await expect(review).toContainText("First comment: Directions are in our bio.");
  await review.getByRole("button", { name: "Publish to 3 accounts" }).click();
  await expect(page.getByTestId("delivery-results")).toBeVisible();
  await expect(page.getByTestId("delivery-results").locator("li")).toHaveCount(3);
  await expect(page.getByTestId("delivery-results").locator("li").first()).toHaveAttribute("data-delivery-status", /scheduled|publishing/);
  // The review is one-shot: nothing was published before the confirmation (no delivery existed while it was open).

  // ---- Schedule: set time, then next free slot ----------------------------------------------------------------------------------
  const future = new Date(Date.now() + 3 * 86_400_000); future.setUTCHours(10, 0, 0, 0);
  const local = (date: Date) => date.toISOString().slice(0, 16);
  await ring("twitter").click(); await ring("bluesky").click();
  await page.getByLabel("Post text").fill("Midweek prayer meeting, Wednesday 7pm.");
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  const scheduleDialog = page.getByRole("dialog", { name: "Schedule post" });
  await scheduleDialog.getByLabel("Time zone").selectOption("UTC");
  await scheduleDialog.getByLabel("Date and time").fill(local(future));
  await snap(page, "schedule-dialog-1280-light");
  await scheduleDialog.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(page.getByTestId("composer-notice")).toContainText("Post scheduled.");
  await ring("twitter").click(); await ring("bluesky").click();
  await page.getByLabel("Post text").fill("Youth night this Friday!");
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await scheduleDialog.getByRole("radio", { name: "Next free slot" }).click();
  await scheduleDialog.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(page.getByTestId("composer-notice")).toContainText("Post scheduled.");

  // ---- Queue ----------------------------------------------------------------------------------------------------------------------
  const accountIds = (await (await page.request.get(`${api}/connections`)).json()).connections as { id: string; platform: string }[];
  expect((await page.request.post(`${api}/drafts`, { headers: { origin }, data: { type: "post", content: "Easter service planning: volunteers, music and welcome team.", connectionIds: [accountIds.find((entry) => entry.platform === "twitter")!.id], variants: {}, media: [] } })).status()).toBe(201);
  await page.goto(`${base}/planner?view=queue`);
  await expect(page.getByRole("heading", { name: "Planner", level: 1 })).toBeVisible();
  await expect(page.getByTestId("queue-list").locator("[data-queue-column]")).toHaveCount(3);
  // The three published-now destinations, the set-time post and the next-slot post.
  await expect(page.getByTestId("queue-item")).toHaveCount(3);
  const queued = page.getByTestId("queue-item").filter({ hasText: "Youth night" });
  await expect(queued.getByText("Queued").first()).toBeVisible();
  await expect(queued.locator("[data-delivery-status]")).toHaveCount(2);
  await expect(page.locator("[data-queue-column=drafts]")).toContainText("Easter service planning");
  await snap(page, "queue-1280-light");
  await tapTargets(page, '[data-testid="queue-item"] button');
  await audit(page, "queue", { ready: async () => {
    const columns = page.locator("[data-queue-column]"); await expect(columns).toHaveCount(3);
    for (const name of ["drafts", "scheduled", "sent"]) await expect(page.locator(`[data-queue-column=${name}]`)).toBeVisible();
    await expect(page.getByTestId("queue-item").first()).toBeVisible(); await expect(page.getByTestId("draft-item").first()).toBeVisible();
  } });
  // Reschedule by date and time, with the confirm in the dialog.
  const midweek = page.getByTestId("queue-item").filter({ hasText: "Midweek prayer" });
  await midweek.getByRole("button", { name: "Reschedule" }).click();
  const move = page.getByRole("dialog", { name: "Change time" });
  const later = new Date(future.getTime() + 86_400_000); later.setUTCHours(11, 30, 0, 0);
  await move.getByLabel("Time zone").selectOption("UTC");
  await move.getByLabel("Date and time").fill(local(later));
  await move.getByRole("button", { name: "Move" }).click();
  await expect(page.getByText("Post moved").first()).toBeVisible();
  await expect(page.getByTestId("queue-item").filter({ hasText: "Midweek prayer" })).toContainText(/11:30/);
  // Duplicate opens a new draft in the composer.
  await page.getByTestId("queue-item").filter({ hasText: "Midweek prayer" }).getByRole("button", { name: "Duplicate" }).click();
  await expect(page).toHaveURL(/compose\?draft=/);
  await expect(page.getByLabel("Post text")).toHaveValue("Midweek prayer meeting, Wednesday 7pm.");
  await expect(ring("twitter")).toHaveAttribute("aria-checked", "true");
  // Cancel: states the outcome per destination and never claims more than the server did.
  await page.goto(`${base}/planner?view=queue`);
  await page.getByTestId("queue-item").filter({ hasText: "Youth night" }).getByRole("button", { name: "Cancel post" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Any already sending or sent stay as they are.");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel post" }).click();
  await expect(page.getByText("All destinations cancelled.").first()).toBeVisible();
  await expect(page.getByTestId("queue-item")).toHaveCount(2);

  // ---- Calendar: month, week, filters, drafts column, drag and the date and time field ------------------------------------------------
  await page.goto(`${base}/planner?view=calendar`);
  await expect(page.getByTestId("calendar-title")).toBeVisible();
  await expect(page.getByTestId("drafts-list")).toBeVisible();
  const monthKey = `${later.getUTCFullYear()}-${String(later.getUTCMonth() + 1).padStart(2, "0")}`;
  await page.goto(`${base}/planner?view=calendar&mode=month&month=${monthKey}`);
  const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const cell = (date: Date) => page.locator(`[data-slot="month-view"] [data-day="${dayKey(date)}"]`);
  await expect(cell(new Date(later)).getByText("Midweek prayer").first()).toBeVisible();
  await snap(page, "calendar-month-1280-light");
  await audit(page, "calendar-month", { ready: async (width) => { await expect(page.locator('[data-slot="month-view"]')).toBeVisible(); if (width >= 640) await expect(cell(new Date(later)).getByText("Midweek prayer").first()).toBeVisible(); else await expect(cell(new Date(later)).getByRole("button")).toBeVisible(); },
    check: async () => { await expect(page.locator('[data-slot="month-view"] > div').nth(1).locator("> div").first(), "month grid starts on Monday").toHaveText("Mon"); } });
  // Drag the draft onto a day (native drag and drop), then confirm.
  const target = new Date(later); target.setDate(target.getDate() + 2);
  // The drafts column reflows once after the page loads; let it settle so the pointer presses the intended card.
  await expect(page.getByTestId("draft-item")).toHaveCount(2);
  // Scroll the target into view first: dragTo would otherwise scroll the shell after pressing the source and the pointer would land on the next card.
  await cell(target).scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  await page.getByTestId("draft-item").filter({ hasText: "Midweek" }).dragTo(cell(target));
  await expect(page.getByRole("alertdialog")).toContainText("It will be sent at");
  await page.getByRole("alertdialog").getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(page.getByText("Draft scheduled").first()).toBeVisible();
  await expect(cell(target).getByText(/Midweek prayer/).first()).toBeVisible();
  // Month cell select shows a list with an Open button: the keyboard path to a post.
  await cell(later).getByRole("button").first().click();
  await page.getByTestId("planner-row").first().getByRole("button", { name: "Open" }).click();
  const dialog = page.getByTestId("post-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("delivery-results")).toBeVisible();
  await dialog.getByRole("button", { name: "Change time" }).click();
  const when = page.getByRole("dialog", { name: "Change time" });
  const next = new Date(later.getTime() + 2 * 86_400_000); next.setUTCHours(8, 15, 0, 0);
  await when.getByLabel("Time zone").selectOption("UTC");
  await when.getByLabel("Date and time").fill(local(next));
  await when.getByRole("button", { name: "Move" }).click();
  await expect(page.getByText("Post moved").first()).toBeVisible();
  // Filters: account and status.
  await page.goto(`${base}/planner?view=calendar&mode=week&week=${dayKey(next)}`);
  await expect(page.locator('[data-slot="week-view"]')).toBeVisible();
  await expect(page.locator(`[data-slot="week-view"] [data-post-id]`).first()).toBeVisible();
  await snap(page, "calendar-week-1280-light");
  await audit(page, "calendar-week", { ready: async (width) => {
      if (width < 768) { await expect(page.getByTestId("day-agenda")).toBeVisible(); await expect(page.getByTestId("agenda-day")).toHaveCount(7); await expect(page.locator('[data-slot="week-view"]')).toHaveCount(0); }
      else { await expect(page.locator('[data-slot="week-view"]')).toBeVisible(); await expect(page.locator('[data-slot="week-view"] [data-post-id]').first()).toBeVisible(); await expect(page.getByTestId("draft-item").first()).toBeVisible(); }
    },
    check: async (width) => {
      if (width < 768) {
        // Phone: day buttons and every row are full-size touch targets with readable, unclipped text; the busiest day is chosen so rows exist.
        const days = page.getByTestId("agenda-day"); for (const day of await days.all()) { const box = (await day.boundingBox())!; expect(box.height, "agenda day button").toBeGreaterThanOrEqual(43.5); expect(box.width, "agenda day button width").toBeGreaterThanOrEqual(36); }
        await page.locator('[data-testid="agenda-day"]:not([aria-label*="no posts"])').first().click();
        const rows = page.getByTestId("planner-row"); await expect(rows.first()).toBeVisible();
        for (const row of await rows.all()) {
          const box = (await row.boundingBox())!; expect(box.height, "agenda row").toBeGreaterThanOrEqual(43.5); expect(box.width, "agenda row is full width").toBeGreaterThanOrEqual(300);
          const open = (await row.getByRole("button", { name: "Open" }).boundingBox())!; expect(open.height, "agenda row Open").toBeGreaterThanOrEqual(43.5);
          const text = row.locator("p").first(); await expect(text).toBeVisible(); const metrics = await text.evaluate((node) => { const range = document.createRange(); range.selectNodeContents(node); return { text: node.textContent ?? "", box: node.getBoundingClientRect().height, clipped: node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).textOverflow !== "ellipsis" }; });
          expect(metrics.text.trim().length, "agenda row text").toBeGreaterThan(0); expect(metrics.box, "agenda row text height").toBeGreaterThanOrEqual(14); expect(metrics.clipped, "agenda row text clipped").toBe(false);
        }
      } else {
        // Desktop: overlapping posts collapse into one chip plus a "+N" button whose list rows are 44px targets; chips themselves are never slivers.
        for (const chip of await page.locator('[data-slot="week-view"] [data-post-id]').all()) { const box = (await chip.boundingBox())!; expect(box.height, "week chip height").toBeGreaterThanOrEqual(43.5); expect(box.width, "week chip width").toBeGreaterThanOrEqual(24); }
        for (const more of await page.getByTestId("overlap-more").all()) { const box = (await more.boundingBox())!; expect(box.height, "+N button").toBeGreaterThanOrEqual(43.5); }
      }
    } });
  // The overlap list (desktop): "+N" opens every post at that time as 44px rows; Escape closes it and keeps focus on the button.
  await expect(page.getByTestId("overlap-more").first()).toBeVisible();
  await page.getByTestId("overlap-more").first().click();
  const stack = page.getByTestId("overlap-list"); await expect(stack).toBeVisible();
  const stackRows = stack.getByTestId("overlap-row"); expect(await stackRows.count()).toBeGreaterThanOrEqual(2);
  for (const stackRow of await stackRows.all()) { await expect(stackRow).toBeVisible(); const box = (await stackRow.boundingBox())!; expect(box.height, "overlap row").toBeGreaterThanOrEqual(43.5); expect((await stackRow.innerText()).trim().length, "overlap row text").toBeGreaterThan(0); }
  await snap(page, "calendar-week-overlap-1280-light");
  await page.keyboard.press("Escape"); await expect(stack).toHaveCount(0);
  await page.getByLabel("Platform").selectOption("instagram");
  await expect(page).toHaveURL(/platform=instagram/);
  await page.getByLabel("Status").selectOption("failed");
  await expect(page.locator(`[data-slot="week-view"] [data-post-id]`)).toHaveCount(0);
  expect(errors).toEqual([]);
  await admin.end();
});
