import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import jsQR from "jsqr";
import { origin, signIn } from "./helpers/session";
import { expectFullWidthShell } from "./helpers/layout";

// HC-03 in a real browser against the disposable database: an organizer creates, previews,
// downloads, publishes, pauses, rotates and archives a campaign link; a signed-out guest sees each
// change on the very next request; a member organizer cannot publish. Synthetic data only.
test.use({ reducedMotion: "reduce" });
const evidence = process.env.HC03_QA_DIR ?? "docs/screenshots/connect/hc-03";
const axeResults: Record<string, unknown> = {};

async function axe(page: Page, name: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  axeResults[name] = result.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.length }));
  expect(result.violations, name).toEqual([]);
}
/** Every visible button and link in main is a 44px touch target. */
async function expectTouchTargets(page: Page, scope = page.getByRole("main")) {
  for (const target of await scope.locator("a:visible, button:visible").all()) {
    const box = await target.boundingBox();
    // Visually hidden skip links (1px until focused) are covered by the focus-geometry tests.
    if (!box || box.width <= 1) continue;
    expect(box.height, await target.innerText()).toBeGreaterThanOrEqual(44);
  }
}
/** Rasterize SVG markup in the browser and decode it with an independent decoder. */
async function decodeSvg(page: Page, svg: string) {
  const { width, data } = await page.evaluate(async (markup) => {
    const image = new Image(), size = 600;
    image.src = `data:image/svg+xml;base64,${btoa(markup)}`;
    await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
    const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0, size, size);
    return { width: size, data: Array.from(context.getImageData(0, 0, size, size).data) };
  }, svg);
  return jsQR(Uint8ClampedArray.from(data), width, width)?.data;
}
async function guestStatus(browser: Browser, path: string) {
  const context = await browser.newContext();
  const response = await context.request.get(path, { maxRedirects: 0 });
  const body = await response.text();
  await context.close();
  return { status: response.status(), cacheControl: response.headers()["cache-control"] ?? "", body };
}

test("HC-03: organizer lifecycle, exports and guest revocation in a real browser", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  const workspace = await page.request.post("/api/workspaces", { headers: { origin }, data: { audience: "church", name: "Synthetic outreach" } });
  const tenantId = (await workspace.json()).tenantId as string;
  const created = await page.request.post(`/api/workspaces/${tenantId}/campaigns`, { headers: { origin, "Idempotency-Key": `hc03-${randomUUID()}` }, data: { name: "Synthetic city crusade", type: "evangelistic_crusade" } });
  const campaignId = (await created.json()).id as string;
  const root = `/workspaces/${tenantId}/campaigns/${campaignId}`, api = `/api/workspaces/${tenantId}/campaigns/${campaignId}/connect/links`;

  // Entry point from the campaign dashboard, then the empty state.
  await page.goto(root);
  await page.getByRole("main").getByRole("link", { name: "QR codes and short links" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "QR codes and short links" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No links yet" })).toBeVisible();
  await expectFullWidthShell(page);
  await axe(page, "admin-empty-desktop");
  await page.screenshot({ path: `${evidence}/admin-empty-desktop.png`, fullPage: true });

  // Create a draft from the dialog, by keyboard.
  await page.getByRole("button", { name: "New link" }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "New QR link" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Internal name").fill("Night 1 · main screen");
  await dialog.getByLabel("Public title").fill("Harvest Night (synthetic)");
  await axe(page, "admin-create-dialog");
  await page.screenshot({ path: `${evidence}/admin-create-dialog.png` });
  await dialog.getByRole("button", { name: "Create draft" }).click();
  await expect(dialog).toBeHidden();
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Night 1 · main screen" }) });
  await expect(card.getByText("Draft", { exact: true })).toBeVisible();
  const [link] = (await (await page.request.get(api)).json()).links as { id: string; publicCode: string; shortCode: string }[];
  const shortPath = `/s/${link.shortCode.slice(0, 4)}-${link.shortCode.slice(4, 8)}-${link.shortCode.slice(8)}`;
  await expect(card.getByText(`127.0.0.1:3100${shortPath}`)).toBeVisible();

  // The on-screen QR and every export encode exactly the public URL.
  const expected = `${origin}/c/${link.publicCode}`;
  expect(await decodeSvg(page, await card.getByRole("img", { name: /QR code for/ }).evaluate((svg) => {
    const clone = svg.cloneNode(true) as SVGElement; clone.setAttribute("xmlns", "http://www.w3.org/2000/svg"); return clone.outerHTML;
  }))).toBe(expected);
  for (const palette of ["standard", "brand"]) {
    const svg = await page.request.get(`${api}/${link.id}/export?format=svg&palette=${palette}`);
    expect(svg.headers()["content-type"]).toContain("image/svg+xml");
    expect(svg.headers()["cache-control"]).toContain("no-store");
    expect(await decodeSvg(page, await svg.text()), palette).toBe(expected);
  }
  const pdf = await page.request.get(`${api}/${link.id}/export?format=pdf`);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).toString("latin1")).toContain(`127.0.0.1:3100${shortPath}`);
  await card.getByRole("button", { name: "Download" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "PNG image" }).first().click()]);
  expect(download.suggestedFilename()).toMatch(/^harvest-qr-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}\.png$/);
  expect((await readFile((await download.path())!)).subarray(1, 4).toString()).toBe("PNG");

  // A draft is not public: the code and short URL both show the general unavailable page.
  for (const path of [`/c/${link.publicCode}`, shortPath]) {
    const guest = await guestStatus(browser, path);
    expect(guest.status, path).toBe(404);
    expect(guest.body).not.toContain("Harvest Night (synthetic)");
  }

  // Test/preview mode renders the public page privately.
  await card.getByRole("link", { name: "Preview" }).click();
  await expect(page.getByRole("heading", { name: "Preview: Night 1 · main screen" })).toBeVisible();
  await expect(page.getByText("Harvest Night (synthetic)")).toBeVisible();
  await axe(page, "admin-preview-desktop");
  await page.screenshot({ path: `${evidence}/admin-preview-desktop.png`, fullPage: true });
  await page.goBack();

  // Publish through the checklist dialog.
  await card.getByRole("button", { name: "Publish", exact: true }).click();
  const publish = page.getByRole("dialog", { name: "Before you publish" });
  await expect(publish.getByText("The campaign is not archived")).toBeVisible();
  await expect(publish.getByText("Response collection is not enabled for real visitors")).toBeVisible();
  await axe(page, "admin-publish-dialog");
  await page.screenshot({ path: `${evidence}/admin-publish-dialog.png` });
  await publish.getByRole("button", { name: "Publish link" }).click();
  await expect(publish).toBeHidden();
  await expect(card.getByText("Live", { exact: true })).toBeVisible();
  await expect(card.getByRole("status").filter({ hasText: "Link published." })).toBeVisible();
  await axe(page, "admin-live-desktop");
  await page.screenshot({ path: `${evidence}/admin-live-desktop.png`, fullPage: true });

  // A signed-out guest reaches the campaign page by QR code and by a hand-typed short URL.
  for (const path of [`/c/${link.publicCode}`, shortPath, shortPath.toLowerCase()]) {
    const guest = await guestStatus(browser, path);
    expect(guest.status, path).toBe(200);
    expect(guest.cacheControl, path).toContain("no-store");
    expect(guest.body).toContain("Harvest Night (synthetic)");
    for (const hidden of [tenantId, campaignId, link.id, "Night 1", "Synthetic city crusade"]) expect(guest.body, hidden).not.toContain(hidden);
  }
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await guestContext.newPage();
  const guestRequests: string[] = [];
  guest.on("request", (request) => { if (request.method() !== "GET" || new URL(request.url()).pathname.startsWith("/api/")) guestRequests.push(`${request.method()} ${request.url()}`); });
  await guest.goto(shortPath);
  await expect(guest.getByRole("heading", { name: "A place to begin." })).toBeVisible();
  await expect(guest.getByText("Harvest Night (synthetic)")).toBeVisible();
  await expect(guest.locator("form, input")).toHaveCount(0);
  expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await axe(guest, "public-live-mobile");
  await guest.screenshot({ path: `${evidence}/public-live-mobile.png`, fullPage: true });
  await guest.getByRole("link", { name: "Browse resources" }).click();
  await expect(guest.getByRole("heading", { name: "Start where you are." })).toBeVisible();
  expect(guestRequests).toEqual([]);
  expect(await guestContext.cookies()).toEqual([]);

  // Projection mode.
  await page.goto(`${root}/connect/${link.id}/present`);
  await expect(page.getByText("Scan to open")).toBeVisible();
  await expect(page.getByText(`127.0.0.1:3100${shortPath}`)).toBeVisible();
  expect(await decodeSvg(page, await page.getByRole("img", { name: /QR code for/ }).evaluate((svg) => {
    const clone = svg.cloneNode(true) as SVGElement; clone.setAttribute("xmlns", "http://www.w3.org/2000/svg"); return clone.outerHTML;
  }))).toBe(expected);
  await axe(page, "admin-present-desktop");
  await page.screenshot({ path: `${evidence}/admin-present-desktop.png` });
  await page.getByRole("link", { name: "Exit projection" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "QR codes and short links" })).toBeVisible();

  // Pause: the next guest request fails safely; publish again with the same code.
  await card.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Pause link" }).click();
  await expect(card.getByText("Paused", { exact: true })).toBeVisible();
  expect((await guestStatus(browser, `/c/${link.publicCode}`)).status).toBe(404);
  await guest.goto(shortPath);
  await expect(guest.getByRole("heading", { name: "This page isn’t available." })).toBeVisible();
  await expect(guest.getByRole("link", { name: "Browse resources" })).toBeVisible();
  await axe(guest, "public-unavailable-mobile");
  await guest.screenshot({ path: `${evidence}/public-unavailable-mobile.png`, fullPage: true });
  await card.getByRole("button", { name: "Publish again" }).click();
  await page.getByRole("dialog", { name: "Before you publish" }).getByRole("button", { name: "Publish link" }).click();
  await expect(card.getByText("Live", { exact: true })).toBeVisible();
  expect((await guestStatus(browser, `/c/${link.publicCode}`)).status).toBe(200);

  // Rotate: the old QR and short URL stop working at once; the new ones work.
  await card.getByRole("button", { name: "Rotate code" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Rotate code" }).click();
  await expect(card.getByRole("status").filter({ hasText: "New code issued. Download it again before printing." })).toBeVisible();
  await expect(card.getByText("Rotated once")).toBeVisible();
  const [rotated] = (await (await page.request.get(api)).json()).links as { publicCode: string; shortCode: string }[];
  expect(rotated.publicCode).not.toBe(link.publicCode);
  expect((await guestStatus(browser, `/c/${link.publicCode}`)).status).toBe(404);
  expect((await guestStatus(browser, shortPath)).status).toBe(404);
  expect((await guestStatus(browser, `/c/${rotated.publicCode}`)).status).toBe(200);
  expect((await guestStatus(browser, `/s/${rotated.shortCode}`)).status).toBe(200);

  // A member organizer can create, preview and download, but not publish or rotate.
  const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const member = await memberContext.newPage();
  const memberEmail = await signIn(member);
  expect((await page.request.put(`/api/workspaces/${tenantId}/members`, { headers: { origin }, data: { email: memberEmail, role: "member" } })).status()).toBe(200);
  await member.goto(`${root}/connect`);
  await expect(member.getByText("Only owners and admins can publish, pause, rotate or archive links.")).toBeVisible();
  await expect(member.getByRole("button", { name: "Rotate code" })).toHaveCount(0);
  await expect(member.getByRole("button", { name: "New link" })).toBeVisible();
  const denied = await member.request.post(`${api}/${link.id}/actions`, { headers: { origin }, data: { action: "disable" } });
  expect(denied.status()).toBe(403);
  await expectFullWidthShell(member);
  await expectTouchTargets(member);
  await axe(member, "admin-member-mobile");
  await member.screenshot({ path: `${evidence}/admin-member-mobile.png`, fullPage: true });
  await memberContext.close();

  // Responsive owner views: mobile and tablet layout, full width, 44px targets, dark mode contrast.
  for (const [name, width, height, scheme] of [["mobile", 390, 844, "light"], ["tablet", 768, 1024, "light"], ["mobile-dark", 390, 844, "dark"]] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.goto(`${root}/connect`);
    await expect(page.getByRole("heading", { level: 1, name: "QR codes and short links" })).toBeVisible();
    await expectFullWidthShell(page);
    await expectTouchTargets(page);
    await axe(page, `admin-live-${name}`);
    await page.screenshot({ path: `${evidence}/admin-live-${name}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" }); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`${root}/connect/${link.id}/present`);
  await expect(page.getByText("Scan to open")).toBeVisible();
  await expectTouchTargets(page, page.locator("[data-projection]"));
  await page.screenshot({ path: `${evidence}/admin-present-tablet.png` });

  // Archive: everything stops for good; the archived link moves to its own section.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${root}/connect`);
  await card.getByRole("button", { name: "Archive" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Archive link" }).click();
  await expect(page.getByRole("heading", { name: "Archived links" })).toBeVisible();
  // Archiving retires a code but does not rotate it again.
  await expect(card.getByText("Rotated once", { exact: true })).toBeVisible();
  for (const path of [`/c/${rotated.publicCode}`, `/s/${rotated.shortCode}`, `/c/${link.publicCode}`]) expect((await guestStatus(browser, path)).status, path).toBe(404);
  expect((await page.request.get(`${api}/${link.id}/export?format=png`)).status()).toBe(409);
  await guestContext.close();
  await writeFile(`${evidence}/axe-results.json`, `${JSON.stringify(axeResults, null, 2)}\n`);
});
