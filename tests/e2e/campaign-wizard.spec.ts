import { mkdir, readFile } from "node:fs/promises";
import { deflateSync, crc32 } from "node:zlib";
import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// The dev server compiles each route on first use, so assertions wait longer than the default 5 seconds.
const expect = baseExpect.configure({ timeout: 20_000 });

// Campaign wizard screens (CW-02): create -> eight steps -> finish -> activate, autosave and version conflicts, roles, axe at three widths in both schemes.
// Runs with the shell modes on (steps in the shell's editing sidebar from 1024px) and with HARVEST_SHELL_MODES=disabled (in-page step list).
test.use({ actionTimeout: 30000, reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });
const evidence = "docs/screenshots/campaign-wizard";
const shellModes = process.env.HARVEST_SHELL_MODES !== "disabled";
const axeTags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function shoot(page: Page, name: string) {
  // Playwright marks the page while it takes a picture; do it only once React has taken over a server-rendered wizard, so the marks cannot cause a hydration mismatch.
  await page.waitForFunction(() => { const heading = document.querySelector('[data-slot="wizard-heading"]'); return !heading || Object.keys(heading).some((key) => key.startsWith("__reactProps")); });
  await settleForAxe(page);
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
}
async function expectAccessible(page: Page) {
  await settleForAxe(page);
  expect((await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
/** On a phone, scroll a little (the sticky step bar is now stuck) and check nothing sits over the header actions and every target passes axe. */
async function expectCleanWhenScrolled(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 120));
  const discard = page.getByRole("button", { name: "Discard", exact: true });
  if (await discard.count()) {
    await discard.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -40));
    const box = (await discard.boundingBox())!;
    expect(await discard.evaluate((el, at) => { const hit = document.elementFromPoint(at.x, at.y); return !!hit && el.contains(hit); }, { x: box.x + box.width / 2, y: box.y + box.height / 2 })).toBe(true);
  }
  await expectAccessible(page);
}
/** Opens a step from the editing sidebar (desktop) or the step bar sheet (below 1024px). */
async function openStep(page: Page, name: RegExp) {
  await hydrated(page);
  if ((page.viewportSize()?.width ?? 1280) >= 1024) await page.getByRole("group", { name: /^Editing/ }).getByRole("button", { name }).click();
  else { await page.getByRole("button", { name: /^Step \d of 8/ }).click(); await page.getByRole("dialog").getByRole("button", { name }).click(); }
}
/** Runs an edit and waits for the autosave it triggers to be accepted. */
async function autosaved(page: Page, edit: () => Promise<void>) {
  const patch = page.waitForResponse((response) => response.request().method() === "PATCH" && /\/campaigns\/drafts\//.test(response.url()));
  await edit();
  expect((await patch).status()).toBe(200);
  await expect(page.locator('[data-save-state="saved"]')).toBeVisible();
}
async function user(browser: Browser, owner: Page, tenant: string, role: "admin" | "member" | "viewer") {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" }), page = await context.newPage();
  const email = await signIn(page);
  expect((await owner.request.put(`/api/workspaces/${tenant}/members`, { headers: { origin }, data: { email, role } })).status()).toBe(200);
  return { page, email, context };
}
/** The dev server renders first and hydrates after: typing before React attaches would be lost, which a person cannot do. */
async function hydrated(page: Page) {
  await page.waitForFunction(() => { const field = document.querySelector('[data-slot="wizard-heading"]'); return !!field && Object.keys(field).some((key) => key.startsWith("__reactProps")); });
}
/** A small real PNG (gradient), so the picture decodes in the browser. */
function png(width = 320, height = 180) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const at = y * (width * 3 + 1) + 1 + x * 3; raw[at] = x * 255 / width; raw[at + 1] = y * 255 / height; raw[at + 2] = 150; }
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, "ascii"); data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length); return out;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const heading = (page: Page, name: string) => page.getByRole("heading", { name, level: 2, exact: true });

test("create a draft, fill steps 1 to 3 with autosave, resume it, and activate a campaign", async ({ page }) => {
  test.setTimeout(240_000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const root = `/workspaces/${tenant}/campaigns`;

  // Start: New campaign on the list; picking a type begins a draft at step 2.
  await page.goto(root);
  await expect(page.getByRole("link", { name: "Drafts", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "New campaign", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New campaign", level: 1 })).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(5);
  await expect(page.getByText("A blank project with customizable features.")).toBeVisible();
  await shoot(page, "start-type");
  await page.getByRole("radio", { name: /Local Outreach/ }).click();
  await expect(page).toHaveURL(/\/campaigns\/drafts\/[0-9a-f-]{36}$/);
  const draftUrl = page.url();
  await expect(heading(page, "Basic Information")).toBeVisible();
  await expect(page.locator('[data-save-state="saved"]')).toBeVisible();
  if (shellModes) await expect(page.getByRole("group", { name: /^Editing/ })).toBeVisible(); else await expect(page.getByRole("navigation", { name: "Campaign setup" })).toBeVisible();
  // All eight steps are available now: none is marked "Soon".
  const stepList = shellModes ? page.getByRole("group", { name: /^Editing/ }) : page.getByRole("navigation", { name: "Campaign setup" });
  await expect(stepList.getByText("Soon")).toHaveCount(0);

  // Step 1 can still be changed; it says the template loads again.
  await stepList.getByRole("button", { name: /Campaign Type/ }).click();
  await expect(heading(page, "Campaign Type")).toBeVisible();
  await expect(page.getByRole("radio", { name: /Local Outreach/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Changing the type loads that type’s template again.")).toBeVisible();
  await shoot(page, "step-1-type");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // Step 2: the name is required (nothing is sent while empty), then autosaves.
  await expect(heading(page, "Basic Information")).toBeVisible();
  await expect(page.getByText("Tell us about your campaign.")).toBeVisible();
  await page.getByLabel("Campaign Name").fill("");
  await page.getByLabel("Campaign Goal or Mission (optional)").focus();
  await expect(page.getByText("Required", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(heading(page, "Basic Information")).toBeVisible();
  await autosaved(page, async () => { await page.getByLabel("Campaign Name").fill("Synthetic Bangkok Outreach 2027"); });
  await autosaved(page, async () => { await page.getByLabel("Campaign Goal or Mission (optional)").fill("Serve the city together."); });
  await shoot(page, "step-2-basics");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // Step 3: an end date before the start is refused client-side and nothing is sent.
  await expect(heading(page, "Location & Dates")).toBeVisible();
  await page.getByRole("radio", { name: "Single location" }).click();
  await page.getByLabel("Country").fill("Thailand");
  await page.getByLabel("City / Region").fill("Bangkok");
  await page.getByLabel("Campaign Start Date").fill("2027-03-05");
  await page.getByLabel("Campaign End Date").fill("2027-03-01");
  await expect(page.getByText("End date is before the start date")).toBeVisible();
  await expect(page.locator('[data-save-state="invalid"]')).toBeVisible();
  await page.getByLabel("Campaign Start Date").fill("2027-03-01");
  await autosaved(page, async () => { await page.getByLabel("Campaign End Date").fill("2027-03-05"); });
  await autosaved(page, async () => { await page.getByLabel("Time Zone").selectOption("Asia/Bangkok"); });
  await shoot(page, "step-3-place");
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeVisible(); // step 4 is next

  // Resume: closing and reopening restores every answer, at the furthest step reached.
  await page.goto(draftUrl);
  await expect(heading(page, "Teams & Leadership")).toBeVisible();
  await hydrated(page);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(heading(page, "Location & Dates")).toBeVisible();
  await expect(page.getByLabel("Country")).toHaveValue("Thailand");
  await expect(page.getByLabel("Time Zone")).toHaveValue("Asia/Bangkok");
  await stepList.getByRole("button", { name: /Basic Information/ }).click();
  await expect(page.getByLabel("Campaign Name")).toHaveValue("Synthetic Bangkok Outreach 2027");
  await page.goto(`${root}/drafts`);
  await expect(page.getByRole("link", { name: /Synthetic Bangkok Outreach 2027/ })).toContainText("Step 4 of 8");
  const stored = await (await page.request.get(`/api${root}/drafts/${draftUrl.split("/drafts/")[1]}`)).json();
  expect(stored).toMatchObject({ name: "Synthetic Bangkok Outreach 2027", structure: "single", timeZone: "Asia/Bangkok", status: "draft", campaignId: null });

  // Activate: owners and admins; state only, with a clear note that nothing is published.
  const created = await page.request.post(`/api${root}`, { headers: { origin, "Idempotency-Key": "activate-1" }, data: { name: "Ready campaign", type: "conference", country: "Chile", startDate: "2027-05-01", endDate: "2027-05-02", timeZone: "America/Santiago", structure: "single" } });
  const campaignId = (await created.json()).id as string;
  await page.goto(`${root}/${campaignId}`);
  await expect(page.getByText("Nothing is published yet.", { exact: true })).toBeVisible();
  await shoot(page, "campaign-activate");
  await page.getByRole("button", { name: "Activate", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Nothing is published or sent.");
  await shoot(page, "activate-confirm");
  await page.getByRole("alertdialog").getByRole("button", { name: "Activate", exact: true }).click();
  await expect(page.getByText("Campaign is now active.")).toBeVisible();
  expect((await (await page.request.get(`/api${root}/${campaignId}`)).json()).status).toBe("active");
  expect(((await (await page.request.get(`/api${root}/${campaignId}/connect/links`)).json()).links ?? [])).toHaveLength(0);
  await page.getByRole("button", { name: "Return to draft" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Return to draft" }).click();
  await expect(page.getByText("Campaign is back in draft.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a change made elsewhere shows a clear reload message and nothing is overwritten", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Conflict Church", audience: "church" } })).json()).tenantId as string;
  const api = `/api/workspaces/${tenant}/campaigns/drafts`;
  const draft = await (await page.request.post(api, { headers: { origin, "Idempotency-Key": "conflict-1" }, data: { type: "conference" } })).json();
  await page.goto(`/workspaces/${tenant}/campaigns/drafts/${draft.id}`);
  await expect(heading(page, "Basic Information")).toBeVisible();
  await hydrated(page);
  await autosaved(page, async () => { await page.getByLabel("Campaign Name").fill("First name"); });
  // Another tab or device saves the same draft: the version moves on.
  const other = await page.request.get(`${api}/${draft.id}`).then((response) => response.json());
  expect((await page.request.patch(`${api}/${draft.id}`, { headers: { origin }, data: { version: other.version, step: "basics", data: { name: "Changed in another tab" } } })).status()).toBe(200);
  await page.getByLabel("Campaign Name").fill("My stale edit");
  const refused = page.waitForResponse((response) => response.request().method() === "PATCH" && response.status() === 409);
  await refused;
  await expect(page.getByRole("alert").filter({ hasText: "This draft changed somewhere else" })).toBeVisible();
  await expect(page.locator('[data-save-state="conflict"]')).toBeVisible();
  await expect(page.getByLabel("Campaign Name")).toBeDisabled();
  await shoot(page, "conflict");
  await expectAccessible(page);
  expect((await (await page.request.get(`${api}/${draft.id}`)).json()).name).toBe("Changed in another tab");
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(heading(page, "Location & Dates")).toBeVisible(); // the draft resumes at the furthest step reached
  await hydrated(page);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Campaign Name")).toHaveValue("Changed in another tab");
  await expect(page.getByLabel("Campaign Name")).toBeEnabled();
});

test("roles: anyone who can write edits any open draft, owners and admins and the creator discard, viewers see none", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Roles Church", audience: "church" } })).json()).tenantId as string;
  const root = `/workspaces/${tenant}/campaigns`, api = `/api${root}/drafts`;
  const admin = await user(browser, page, tenant, "admin"), member = await user(browser, page, tenant, "member"), viewer = await user(browser, page, tenant, "viewer"), member2 = await user(browser, page, tenant, "member");
  try {
    // A member starts a draft through the screens.
    await member.page.goto(`${root}/new`);
    await member.page.getByRole("radio", { name: /Mission Trip/ }).click();
    await expect(member.page).toHaveURL(/\/campaigns\/drafts\/[0-9a-f-]{36}$/);
    const draftUrl = member.page.url(), draftId = draftUrl.split("/drafts/")[1];
    await autosaved(member.page, async () => { await member.page.getByLabel("Campaign Name").fill("Member mission trip"); });

    // Every open draft is listed for everyone who can write; a viewer sees none and cannot start one.
    await member.page.goto(`${root}/drafts`);
    await expect(member.page.getByRole("heading", { name: "Campaign drafts", level: 1 })).toBeVisible();
    await expect(member.page.getByText("Every draft in this ministry")).toBeVisible();
    await expect(member.page.getByRole("link", { name: /Member mission trip/ })).toContainText("Started by You");
    await member2.page.goto(`${root}/drafts`);
    await expect(member2.page.getByRole("link", { name: /Member mission trip/ })).toContainText("Started by A ministry member");
    expect((await member2.page.request.get(`${api}/${draftId}`)).status()).toBe(200);
    await viewer.page.goto(`${root}/drafts`);
    await expect(viewer.page.getByRole("heading", { name: "No drafts", level: 2 })).toBeVisible();
    await expect(viewer.page.getByRole("link", { name: "New campaign" })).toHaveCount(0);
    expect((await viewer.page.request.get(`${api}/${draftId}`)).status()).toBe(404);
    expect((await viewer.page.request.post(api, { headers: { origin, "Idempotency-Key": "viewer-1" }, data: { type: "conference" } })).status()).toBe(403);
    expect((await viewer.page.request.patch(`${api}/${draftId}`, { headers: { origin }, data: { version: 2, step: "basics", data: { name: "Viewer" } } })).status()).toBe(403);
    await viewer.page.goto(`${root}/new`);
    await expect(viewer.page.getByRole("radio")).toHaveCount(0);
    await viewer.page.goto(root);
    await expect(viewer.page.getByRole("link", { name: "New campaign" })).toHaveCount(0);

    // A colleague opens it and edits it: the wizard is not read-only, and the change is saved under the same draft.
    await member2.page.getByRole("link", { name: /Member mission trip/ }).click();
    await expect(heading(member2.page, "Location & Dates")).toBeVisible(); // resumes at the furthest step reached
    await hydrated(member2.page);
    await (shellModes ? member2.page.getByRole("group", { name: /^Editing/ }) : member2.page.getByRole("navigation", { name: "Campaign setup" })).getByRole("button", { name: /Basic Information/ }).click();
    await expect(member2.page.getByLabel("Campaign Name")).toBeEnabled();
    await expect(member2.page.getByLabel("Campaign Name")).toHaveValue("Member mission trip");
    await expect(member2.page.getByText(/can edit this draft/)).toHaveCount(0);
    await autosaved(member2.page, async () => { await member2.page.getByLabel("Campaign Name").fill("Edited by a colleague"); });
    await shoot(member2.page, "shared-draft-colleague");
    const stored = await (await member.page.request.get(`${api}/${draftId}`)).json();
    expect(stored).toMatchObject({ name: "Edited by a colleague", status: "draft" });
    // Two people saving from the same version: the second is refused with a 409 and nothing is overwritten.
    expect((await admin.page.request.patch(`${api}/${draftId}`, { headers: { origin }, data: { version: stored.version, step: "basics", data: { name: "Edited by an admin" } } })).status()).toBe(200);
    expect((await admin.page.request.patch(`${api}/${draftId}`, { headers: { origin }, data: { version: stored.version, step: "basics", data: { name: "Stale" } } })).status()).toBe(409);

    // A second draft by the member is discarded by the admin from the list, after a confirm.
    expect((await member.page.request.post(api, { headers: { origin, "Idempotency-Key": "second-draft" }, data: { type: "conference" } })).status()).toBe(201);
    await admin.page.goto(`${root}/drafts`);
    const drafts = admin.page.getByRole("list", { name: "Campaign drafts" }).getByRole("listitem");
    await expect(drafts).toHaveCount(2);
    await shoot(admin.page, "drafts-admin");
    await admin.page.getByRole("button", { name: /Discard: Untitled campaign/ }).click();
    await expect(admin.page.getByRole("alertdialog")).toContainText("Discard this draft?");
    await admin.page.getByRole("alertdialog").getByRole("button", { name: "Keep draft" }).click();
    await expect(drafts).toHaveCount(2);
    await admin.page.getByRole("button", { name: /Discard: Untitled campaign/ }).click();
    await admin.page.getByRole("alertdialog").getByRole("button", { name: "Discard draft" }).click();
    await expect(admin.page.getByText("Draft discarded.")).toBeVisible();
    await expect(drafts).toHaveCount(1);
    // A plain member who did not start a draft can edit it but not discard it: no Discard button, and the server refuses.
    await member2.page.goto(`${root}/drafts`);
    await expect(member2.page.getByRole("button", { name: /^Discard/ })).toHaveCount(0);
    expect((await member2.page.request.post(`${api}/${draftId}/discard`, { headers: { origin }, data: { version: 99 } })).status()).toBe(403);

    // Activate is for owners and admins only: the member who finished a campaign does not see it.
    const finished = await member.page.request.post(`/api${root}`, { headers: { origin, "Idempotency-Key": "plain-campaign" }, data: { name: "Plain", type: "conference", country: "Chile", startDate: "2027-05-01", endDate: "2027-05-02", timeZone: "America/Santiago", structure: "single" } });
    const campaignId = (await finished.json()).id as string;
    await member.page.goto(`${root}/${campaignId}`);
    await expect(member.page.getByRole("heading", { name: "Plain", level: 1 })).toBeVisible();
    await expect(member.page.getByRole("button", { name: "Activate" })).toHaveCount(0);
    expect((await member.page.request.post(`/api${root}/${campaignId}/status`, { headers: { origin }, data: { status: "active" } })).status()).toBe(403);
    await admin.page.goto(`${root}/${campaignId}`);
    await expect(admin.page.getByRole("button", { name: "Activate", exact: true })).toBeVisible();
    // A campaign without its place and dates cannot be activated; the message says what to add.
    const bare = await (await member.page.request.post(`/api${root}`, { headers: { origin, "Idempotency-Key": "bare-campaign" }, data: { name: "Bare", type: "custom_project" } })).json();
    await admin.page.goto(`${root}/${bare.id}`);
    await admin.page.getByRole("button", { name: "Activate", exact: true }).click();
    await admin.page.getByRole("alertdialog").getByRole("button", { name: "Activate", exact: true }).click();
    await expect(admin.page.getByRole("alert").filter({ hasText: "Add the place, dates and time zone before activating." })).toBeVisible();
  } finally {
    for (const person of [admin, member, member2, viewer]) await person.context.close();
  }
});

test("axe: the wizard and the drafts list at 360, 768 and 1280 in light and dark", async ({ page }) => {
  test.setTimeout(300_000);
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Axe Church", audience: "church" } })).json()).tenantId as string;
  const root = `/workspaces/${tenant}/campaigns`, api = `/api${root}/drafts`;
  const draft = await (await page.request.post(api, { headers: { origin, "Idempotency-Key": "axe-1" }, data: { type: "evangelistic_crusade" } })).json();
  expect((await page.request.patch(`${api}/${draft.id}`, { headers: { origin }, data: { version: draft.version, step: "basics", data: { name: "Axe check campaign", mission: "Testing" } } })).status()).toBe(200);
  // Every available step at the desktop width in light (the draft resumes at the furthest step reached).
  await page.goto(`${root}/drafts/${draft.id}`);
  for (const label of ["Location & Dates", "Basic Information", "Campaign Type"]) {
    await expect(heading(page, label)).toBeVisible();
    await expectAccessible(page);
    if (label !== "Campaign Type") await page.getByRole("button", { name: "Back", exact: true }).click();
  }
  // One scene per width and scheme on the wizard (the place step, the densest) and on the list.
  const sizes = [["phone", 360, 800], ["tablet", 768, 1024], ["desktop", 1280, 900]] as const;
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.goto(`${root}/drafts/${draft.id}`);
      await expect(heading(page, "Location & Dates")).toBeVisible();
      if (width < 1024) { // below 1024px the steps are a "Step n of 8" bar, or the in-page list with shell modes off
        if (shellModes) await expect(page.getByRole("button", { name: /^Step \d of 8/ })).toBeVisible();
      }
      await expectAccessible(page);
      await shoot(page, `wizard-place-${label}-${scheme}`);
      // Steps 2 and 1 at the same width and scheme: the content fills the main area (the type cards in a grid), no empty column beside it.
      for (const [name, step] of [["basics", "Basic Information"], ["type", "Campaign Type"]] as const) {
        await page.getByRole("button", { name: "Back", exact: true }).click();
        await expect(heading(page, step)).toBeVisible();
        await expectAccessible(page);
        await shoot(page, `wizard-${name}-${label}-${scheme}`);
      }
      if (width >= 1280) {
        const card = await page.locator('[data-slot="wizard-layout"]').boundingBox(), main = await page.locator("main").boundingBox();
        expect(card!.width).toBeGreaterThan(main!.width * 0.9);
        const cards = await page.getByRole("radio").evaluateAll((nodes) => new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().top))).size);
        expect(cards).toBe(2); // 3 per row: two rows for five types
      }
      await page.goto(`${root}/drafts`);
      await expect(page.getByRole("heading", { name: "Campaign drafts", level: 1 })).toBeVisible();
      await expectAccessible(page);
      await shoot(page, `drafts-${label}-${scheme}`);
      // 44px targets on the controls a thumb meets.
      if (width < 768) for (const target of [page.getByRole("link", { name: "New campaign" }), page.getByRole("button", { name: /^Discard/ })]) {
        const box = await target.first().boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    }
  }
});

test("cover: the optional image or logo in step 2 uploads, shows, is replaced and removed, and goes to the campaign on Finish", async ({ page }) => {
  test.setTimeout(240_000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Cover Church", audience: "church" } })).json()).tenantId as string;
  const root = `/workspaces/${tenant}/campaigns`, api = `/api${root}/drafts`;
  const draft = await (await page.request.post(api, { headers: { origin, "Idempotency-Key": "cover-1" }, data: { type: "conference" } })).json();
  await page.goto(`${root}/drafts/${draft.id}`);
  await expect(heading(page, "Basic Information")).toBeVisible();
  await hydrated(page);
  await expect(page.getByText("Campaign Cover Image or Logo (optional)")).toBeVisible();
  // The PRD's order: name, description, goal or mission, then the cover.
  const labels = await page.locator("main label").allInnerTexts();
  expect(labels.slice(0, 4).map((label) => label.trim())).toEqual(["Campaign Name", "Campaign Description (optional)", "Campaign Goal or Mission (optional)", "Campaign Cover Image or Logo (optional)"]);
  await autosaved(page, async () => { await page.getByLabel("Campaign Name").fill("Cover campaign"); });
  const picked = page.waitForResponse((response) => response.request().method() === "PUT" && /\/cover$/.test(response.url()));
  await page.getByTestId("cover-input").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png() });
  expect((await picked).status()).toBe(200);
  await expect(page.getByTestId("cover-image")).toBeVisible();
  await expect.poll(() => page.getByTestId("cover-image").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  const withCover = await (await page.request.get(`${api}/${draft.id}`)).json();
  expect(withCover.coverFileId).toEqual(expect.any(String));
  expect((await page.request.get(`${api}/${draft.id}/cover`)).status()).toBe(200);
  await shoot(page, "step-2-cover");
  await expectAccessible(page);
  // Phone width in the dark scheme: no sideways scroll, no violations, 44px targets on the cover buttons.
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.getByTestId("cover-image")).toBeVisible();
  await expectAccessible(page);
  for (const name of ["Replace", "Remove"]) expect((await page.getByRole("button", { name, exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await shoot(page, "step-2-cover-phone-dark");
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
  // Autosave carries on with the version the cover moved on to: no false "changed elsewhere".
  await autosaved(page, async () => { await page.getByLabel("Campaign Goal or Mission (optional)").fill("Reach the city."); });
  await expect(page.locator('[data-save-state="conflict"]')).toHaveCount(0);
  // Replace, then remove.
  const replaced = page.waitForResponse((response) => response.request().method() === "PUT" && /\/cover$/.test(response.url()));
  await page.getByTestId("cover-input").setInputFiles({ name: "logo2.png", mimeType: "image/png", buffer: png(200, 120) });
  expect((await replaced).status()).toBe(200);
  expect((await (await page.request.get(`${api}/${draft.id}`)).json()).coverFileId).not.toBe(withCover.coverFileId);
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByTestId("cover-image")).toHaveCount(0);
  expect((await (await page.request.get(`${api}/${draft.id}`)).json()).coverFileId).toBeNull();
  // Choose it again, fill the place, and finish through the API: the campaign takes the cover.
  const again = page.waitForResponse((response) => response.request().method() === "PUT" && /\/cover$/.test(response.url()));
  await page.getByTestId("cover-input").setInputFiles({ name: "logo3.png", mimeType: "image/png", buffer: png(240, 135) });
  expect((await again).status()).toBe(200);
  const current = await (await page.request.get(`${api}/${draft.id}`)).json();
  const placed = await page.request.patch(`${api}/${draft.id}`, { headers: { origin }, data: { version: current.version, step: "place", data: { country: "Chile", cityRegion: "Santiago", startDate: "2027-05-01", endDate: "2027-05-02", timeZone: "America/Santiago", structure: "single" } } });
  expect(placed.status()).toBe(200);
  const done = await page.request.post(`${api}/${draft.id}/finish`, { headers: { origin }, data: { version: (await placed.json()).version } });
  expect(done.status()).toBe(200);
  const campaignId = (await done.json()).campaignId as string;
  expect((await page.request.get(`/api${root}/${campaignId}/cover`)).status()).toBe(200);
  expect((await (await page.request.get(`/api${root}/${campaignId}`)).json()).coverFileId).toBe(current.coverFileId);
  // The campaign page shows the cover above the title.
  await page.goto(`${root}/${campaignId}`);
  await expect(page.locator('[data-slot="campaign-cover"] img')).toBeVisible();
  expect(await page.locator('[data-slot="campaign-cover"] img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await shoot(page, "campaign-cover");
  expect(errors).toEqual([]);
});

test("teams and tools: invitations by member and by email are pending until accepted, then tools are chosen", async ({ page, browser }) => {
  test.setTimeout(420_000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Teams Church", audience: "church" } })).json()).tenantId as string;
  const root = `/workspaces/${tenant}/campaigns`, api = `/api${root}/drafts`;
  const member = await user(browser, page, tenant, "member");
  const guestContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" }), guest = await guestContext.newPage();
  const guestEmail = await signIn(guest);
  const links = async () => (await readFile(`${process.env.HARVEST_E2E_MAILBOX}.campaign-invitations`, "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as { to: string; url: string; kind: string });
  try {
    const draft = await (await page.request.post(api, { headers: { origin, "Idempotency-Key": "teams-1" }, data: { type: "evangelistic_crusade" } })).json();
    let current = draft;
    for (const [step, data] of [["basics", { name: "Teams campaign", description: null, mission: null }], ["place", { country: "Chile", cityRegion: "Santiago", startDate: "2027-05-01", endDate: "2027-05-02", timeZone: "America/Santiago", structure: "single" }]] as const) {
      current = await (await page.request.patch(`${api}/${draft.id}`, { headers: { origin }, data: { version: current.version, step, data } })).json();
    }
    await page.goto(`${root}/drafts/${draft.id}`);
    await expect(heading(page, "Teams & Leadership")).toBeVisible(); // resumes at the furthest step reached
    await hydrated(page);
    await expect(page.getByText("Who will organize this campaign?")).toBeVisible();
    await expect(page.getByText("Campaign Owner", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(13); // the 13 departments of an Evangelistic Crusade
    await shoot(page, "step-4-teams");
    await expectAccessible(page);

    // Invite a ministry member as the Volunteers leader, and an email address as a team member.
    const volunteers = page.getByRole("region", { name: "Volunteers" });
    await volunteers.getByRole("button", { name: "Invite" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Invitations are recorded; nothing is sent yet.")).toBeVisible();
    await dialog.getByLabel("Role").selectOption("leader");
    await dialog.getByLabel("Ministry member").selectOption({ label: member.email });
    await dialog.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(volunteers.getByText(member.email)).toBeVisible();
    await expect(volunteers.getByText("Pending")).toHaveCount(1);
    await volunteers.getByRole("button", { name: "Invite" }).click();
    await dialog.getByLabel("Email address").fill(guestEmail.toUpperCase());
    await dialog.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(volunteers.getByText("Pending")).toHaveCount(2);
    await expect(volunteers.getByText(/^Expires /).first()).toBeVisible();
    await settleForAxe(page);
    await volunteers.screenshot({ path: `${evidence}/step-4-teams-pending.png` });
    // Both choices at once, or none, are refused in the dialog.
    await volunteers.getByRole("button", { name: "Invite" }).click();
    await dialog.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Choose a member or enter an email address.");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    // An invitation can be withdrawn while pending.
    await volunteers.getByRole("button", { name: "Invite" }).click();
    await dialog.getByLabel("Email address").fill("withdrawn@example.test");
    await dialog.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(volunteers.getByText("withdrawn@example.test")).toBeVisible();
    await volunteers.getByRole("button", { name: "Withdraw the invitation for withdrawn@example.test" }).click();
    await expect(volunteers.getByText("withdrawn@example.test")).toHaveCount(0);

    // Nothing is placed before anyone accepts.
    expect((await (await page.request.get(`${api}/${draft.id}`)).json()).assignments).toEqual([]);
    const sent = await links();
    const memberLink = sent.find((mail) => mail.to === member.email)!, guestLink = sent.find((mail) => mail.to === guestEmail)!;
    expect(memberLink.kind).toBe("member"); expect(guestLink.kind).toBe("email");
    expect(sent.some((mail) => mail.to === "withdrawn@example.test")).toBe(true); // recorded when created; withdrawing it closes the link
    const path = (url: string) => new URL(url).pathname;
    // Someone else's link says so and changes nothing.
    await guest.goto(path(memberLink.url));
    await guest.getByRole("button", { name: "Accept invitation" }).click();
    await expect(guest.getByRole("alert").filter({ hasText: "not for this account" })).toBeVisible();
    // The invited member accepts; the guest (not a member) accepts theirs and joins with no other access.
    await member.page.goto(path(memberLink.url));
    await expect(member.page.getByRole("heading", { name: "You are invited to help organize a campaign" })).toBeVisible();
    await member.page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(member.page.getByText("You are the leader of Volunteers.")).toBeVisible();
    await expect(member.page.getByRole("link", { name: "Open the campaign draft" })).toBeVisible();
    await guest.goto(path(guestLink.url));
    await expectAccessible(guest);
    await shoot(guest, "invitation-accept");
    await guest.getByRole("button", { name: "Accept invitation" }).click();
    await expect(guest.getByText("You are the team member of Volunteers.")).toBeVisible();
    await expect(guest.getByText("You now have access to this campaign only.")).toBeVisible();
    await expect(guest.getByRole("link", { name: "Open the campaign draft" })).toHaveCount(0);
    expect((await guest.request.get(`${api}/${draft.id}`)).status()).toBe(403);
    await shoot(guest, "invitation-accepted");

    // The owner sees who accepted: the page refreshes the invitations when it is visible again.
    await page.reload();
    await expect(heading(page, "Teams & Leadership")).toBeVisible();
    const after = page.getByRole("region", { name: "Volunteers" });
    await expect(after.getByText("Accepted")).toHaveCount(2);
    await expect(after.getByText("Pending")).toHaveCount(0);
    await hydrated(page);
    await settleForAxe(page);
    await after.screenshot({ path: `${evidence}/step-4-teams-accepted.png` });
    await expectAccessible(page);

    // Step 5: the tools. Recommended ones are selected for the type, and the AI Campaign Copilot is not available yet.
    await hydrated(page);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(heading(page, "Campaign Features")).toBeVisible();
    await expect(page.getByText("Which tools would you like to enable?")).toBeVisible();
    await expect(page.getByRole("switch")).toHaveCount(18);
    await expect(page.getByRole("switch", { name: "Enable Tasks & Kanban Boards" })).toBeChecked();
    await expect(page.getByRole("switch", { name: "Enable AI Campaign Copilot" })).toBeDisabled();
    await expect(page.getByRole("switch", { name: "Enable AI Campaign Copilot" })).not.toBeChecked();
    await expect(page.getByText("Coming later")).toBeVisible();
    await expect(page.getByText("Recommended")).toHaveCount(17);
    await shoot(page, "step-5-tools");
    await expectAccessible(page);
    await autosaved(page, async () => { await page.getByRole("switch", { name: "Enable Communications" }).click(); });
    expect((await (await page.request.get(`${api}/${draft.id}`)).json()).modules).not.toContain("communications");
    // Steps 6 and 7 are not available yet, so Next goes straight to the review.
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeVisible();

    // Every width and scheme, for both steps.
    for (const scheme of ["light", "dark"] as const) for (const [label, width, height] of [["phone", 360, 800], ["tablet", 768, 1024], ["desktop", 1280, 900]] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      await page.reload();
      await openStep(page, /Campaign Features/); // a reload resumes at the furthest step reached
      await expect(heading(page, "Campaign Features")).toBeVisible();
      await expectAccessible(page);
      if (width < 768) await expectCleanWhenScrolled(page);
      await shoot(page, `step-5-tools-${label}-${scheme}`);
      await hydrated(page);
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(heading(page, "Teams & Leadership")).toBeVisible();
      await expectAccessible(page);
      await shoot(page, `step-4-teams-${label}-${scheme}`);
      if (width < 768) expect((await page.getByRole("button", { name: "Invite" }).first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(errors).toEqual([]);
  } finally {
    await member.context.close(); await guestContext.close();
  }
});

test("review and finish: a summary, blocked reasons with links, one campaign however many times Finish is pressed, and the setup checklist", async ({ page, browser }) => {
  test.setTimeout(420_000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Review Church", audience: "church" } })).json()).tenantId as string;
  const root = `/workspaces/${tenant}/campaigns`, api = `/api${root}/drafts`;
  const leader = await user(browser, page, tenant, "member");
  const patch = async (id: string, version: number, step: string, data: unknown) => (await (await page.request.patch(`${api}/${id}`, { headers: { origin }, data: { version, step, data } })).json()).version as number;
  try {
    // A draft with only a type: the review lists what blocks Finish, each with a link to its step, and Finish creates nothing.
    const bare = await (await page.request.post(api, { headers: { origin, "Idempotency-Key": "review-bare" }, data: { type: "conference" } })).json();
    await page.goto(`${root}/drafts/${bare.id}`);
    await hydrated(page);
    await page.getByRole("group", { name: /^Editing/ }).getByRole("button", { name: /Review & Create/ }).click();
    await expect(heading(page, "Review & Create")).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Finish is blocked" })).toContainText("Enter a campaign name.");
    await shoot(page, "step-8-review-blocked");
    await expectAccessible(page);
    await page.getByRole("button", { name: "Finish — Create Campaign" }).click();
    expect((await (await page.request.get(`${api}/${bare.id}`)).json()).status).toBe("draft");
    await page.getByRole("alert").filter({ hasText: "Finish is blocked" }).getByRole("button", { name: "Go to Basic Information" }).click();
    await expect(heading(page, "Basic Information")).toBeVisible();

    // A complete draft with one department led by an accepted member.
    const draft = await (await page.request.post(api, { headers: { origin, "Idempotency-Key": "review-full" }, data: { type: "evangelistic_crusade" } })).json();
    let version = await patch(draft.id, draft.version, "basics", { name: "Review campaign", description: "A summary", mission: null });
    version = await patch(draft.id, version, "place", { country: "Chile", cityRegion: "Santiago", startDate: "2027-05-01", endDate: "2027-05-02", timeZone: "America/Santiago", structure: "single" });
    version = await patch(draft.id, version, "leaders", { departments: ["volunteers"] });
    const invited = await page.request.post(`${api}/${draft.id}/invitations`, { headers: { origin }, data: { department: "volunteers", role: "leader", email: leader.email } });
    expect(invited.status()).toBe(201);
    const mail = (await readFile(`${process.env.HARVEST_E2E_MAILBOX}.campaign-invitations`, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as { to: string; url: string }).find((entry) => entry.to === leader.email)!;
    expect((await leader.page.request.post("/api/campaign-invitations/accept", { headers: { origin }, data: { token: new URL(mail.url).pathname.split("/").pop() } })).status()).toBe(200);

    await page.goto(`${root}/drafts/${draft.id}`);
    await hydrated(page);
    await expect(heading(page, "Campaign Features")).toBeVisible(); // resumes at the furthest step
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(heading(page, "Budget & Fundraising")).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(heading(page, "Registration & Follow-Up")).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(heading(page, "Review & Create")).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: "Review campaign" })).toBeVisible();
    await expect(page.getByText("Santiago", { exact: true })).toBeVisible();
    await expect(page.getByText(/Leader: /)).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Finish is blocked" })).toHaveCount(0);
    await shoot(page, "step-8-review");
    await expectAccessible(page);
    // Edit goes back to that step; pressing Finish twice quickly still ends at one campaign.
    await page.getByRole("button", { name: "Edit Location & Dates" }).click();
    await expect(heading(page, "Location & Dates")).toBeVisible();
    await hydrated(page);
    await page.getByRole("group", { name: /^Editing/ }).getByRole("button", { name: /Review & Create/ }).click();
    await expect(heading(page, "Review & Create")).toBeVisible();
    const finishButton = page.getByRole("button", { name: "Finish — Create Campaign" });
    await finishButton.dblclick();
    await page.waitForURL(new RegExp(`${root}/[0-9a-f-]{36}$`));
    const campaignId = page.url().split("/").pop() as string;
    expect((await (await page.request.get(`${api}/${draft.id}`)).json())).toMatchObject({ status: "finished", campaignId });
    expect((await (await page.request.get(`/api${root}`)).json()).campaigns?.filter((c: { name: string }) => c.name === "Review campaign") ?? [{}]).toHaveLength(1);
    // Finishing again from anywhere returns the same campaign.
    expect((await (await page.request.post(`${api}/${draft.id}/finish`, { headers: { origin }, data: { version } })).json()).campaignId).toBe(campaignId);

    // The setup checklist: nine PRD items, the leader item ticked by itself, others ticked by hand and kept across a reload.
    // The dashboard: the finished draft's configuration with real numbers, and what is not tracked yet as unavailable, never zero.
    await expect(page.getByRole("heading", { name: "Campaign overview", level: 2 })).toBeVisible();
    const stats = page.getByRole("list", { name: "Campaign overview" });
    await expect(stats.getByText("Departments", { exact: true })).toBeVisible();
    await expect(stats.getByText("1 of 1")).toBeVisible(); // departments with a leader
    await expect(stats.getByText("People placed")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Teams", level: 3 })).toBeVisible();
    await expect(page.getByText("Leader: ").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tools", level: 3 })).toBeVisible();
    await expect(page.getByText("Not available yet")).toHaveCount(4);
    for (const label of ["Progress", "Events", "Funding", "Tasks"]) await expect(page.locator("#main-content").getByText(label, { exact: true })).toBeVisible();
    expect((await (await page.request.get(`/api${root}/${campaignId}/overview`)).json()).unavailable).toEqual(["progress", "events", "funding", "tasks"]);
    await expect(page.getByRole("heading", { name: "Setup checklist", level: 2 })).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(9);
    await expect(page.getByRole("checkbox", { name: "Mark Assign department leaders as not done" })).toBeDisabled();
    await expect(page.getByText("Done automatically")).toHaveCount(1);
    await expect(page.getByText("1 of 9 done").first()).toBeVisible();
    await shoot(page, "campaign-checklist");
    await expectAccessible(page);
    const save = page.waitForResponse((response) => response.request().method() === "PUT" && /\/checklist$/.test(response.url()));
    await page.getByRole("checkbox", { name: "Mark Define budget as done" }).click();
    expect((await save).status()).toBe(200);
    await expect(page.getByText("2 of 9 done").first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Mark Define budget as not done" })).toBeChecked();
    // Another person who can write campaigns sees the same state and can undo it.
    await leader.page.goto(`${root}/${campaignId}`);
    await expect(leader.page.getByRole("checkbox", { name: "Mark Define budget as not done" })).toBeChecked();
    await leader.page.getByRole("checkbox", { name: "Mark Define budget as not done" }).click();
    await expect(leader.page.getByText("1 of 9 done").first()).toBeVisible();
    // A viewer does not get the checklist.
    const viewer = await user(browser, page, tenant, "viewer");
    await viewer.page.goto(`${root}/${campaignId}`);
    await expect(viewer.page.getByRole("heading", { level: 1, name: "Review campaign" })).toBeVisible();
    await expect(viewer.page.getByRole("heading", { name: "Setup checklist" })).toHaveCount(0);
    await expect(viewer.page.getByRole("heading", { name: "Campaign overview" })).toHaveCount(0);
    expect((await viewer.page.request.get(`/api${root}/${campaignId}/overview`)).status()).toBe(403);
    await viewer.context.close();
    // Every width and scheme for the review and the checklist.
    for (const scheme of ["light", "dark"] as const) for (const [label, width, height] of [["phone", 360, 800], ["tablet", 768, 1024], ["desktop", 1280, 900]] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      await page.goto(`${root}/${campaignId}`);
      await expect(page.getByRole("heading", { name: "Setup checklist", level: 2 })).toBeVisible();
      await expectAccessible(page);
      // No white edges in a dark theme: no visible surface is painted pure white.
      if (scheme === "dark") expect(await page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => { const box = el.getBoundingClientRect(); return box.width > 8 && box.height > 8 && getComputedStyle(el).backgroundColor === "rgb(255, 255, 255)"; }).length)).toBe(0);
      await shoot(page, `campaign-dashboard-${label}-${scheme}`);
      if (width < 768) expect((await page.getByRole("checkbox").first().locator("xpath=ancestor::label").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(errors).toEqual([]);
  } finally {
    await leader.context.close();
  }
});

test("step 7: six options, all off, dependent ones blocked with a reason, tool hints, autosave, and one unpublished source on Finish", async ({ page }) => {
  test.setTimeout(420_000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Connect Church", audience: "church" } })).json()).tenantId as string;
  const root = `/workspaces/${tenant}/campaigns`, api = `/api${root}/drafts`;
  const patch = async (id: string, version: number, step: string, data: unknown) => (await (await page.request.patch(`${api}/${id}`, { headers: { origin }, data: { version, step, data } })).json()).version as number;
  const draft = await (await page.request.post(api, { headers: { origin, "Idempotency-Key": "connect-1" }, data: { type: "evangelistic_crusade" } })).json();
  let version = await patch(draft.id, draft.version, "basics", { name: "Connect campaign", description: null, mission: null });
  version = await patch(draft.id, version, "place", { country: "Chile", cityRegion: "Santiago", startDate: "2027-05-01", endDate: "2027-05-02", timeZone: "America/Santiago", structure: "single" });
  await patch(draft.id, version, "tools", { modules: ["tasks_boards", "qr_response_forms"] }); // registration forms are off
  await page.goto(`${root}/drafts/${draft.id}`);
  await hydrated(page);
  await page.getByRole("group", { name: /^Editing/ }).getByRole("button", { name: /Registration & Follow-Up/ }).click();
  await expect(heading(page, "Registration & Follow-Up")).toBeVisible();
  await expect(page.getByText("How would you like participants to connect with your campaign?")).toBeVisible();
  const names = ["Public Campaign Registration", "Evangelistic Response Form", "Free Harvest Account Invitations", "Community Discovery", "Discipleship Follow-Up", "Church Referrals"];
  for (const name of names) { const toggle = page.getByRole("switch", { name: `Enable ${name}` }); await expect(toggle).toBeVisible(); await expect(toggle).not.toBeChecked(); }
  await expect(page.getByText("Nothing is published or sent yet.")).toBeVisible();
  for (const name of names.slice(2)) await expect(page.getByRole("switch", { name: `Enable ${name}` })).toBeDisabled();
  await expect(page.getByText("Turn on registration or the response form first.")).toHaveCount(3);
  await expect(page.getByText("Turn on account invitations first.")).toBeVisible();
  await shoot(page, "step-7-connect");
  await expectAccessible(page);
  // The response form alone unlocks follow-up and invitations; discovery needs invitations.
  await autosaved(page, async () => { await page.getByRole("switch", { name: "Enable Evangelistic Response Form" }).click(); });
  await expect(page.getByRole("switch", { name: "Enable Discipleship Follow-Up" })).toBeEnabled();
  await expect(page.getByRole("switch", { name: "Enable Community Discovery" })).toBeDisabled();
  await autosaved(page, async () => { await page.getByRole("switch", { name: "Enable Free Harvest Account Invitations" }).click(); });
  await autosaved(page, async () => { await page.getByRole("switch", { name: "Enable Community Discovery" }).click(); });
  // Turning the invitations off takes discovery with it.
  await autosaved(page, async () => { await page.getByRole("switch", { name: "Enable Free Harvest Account Invitations" }).click(); });
  await expect(page.getByRole("switch", { name: "Enable Community Discovery" })).not.toBeChecked();
  await autosaved(page, async () => { await page.getByRole("switch", { name: "Enable Public Campaign Registration" }).click(); });
  // Registration is on but its tool is off: a hint and a link to the tools step.
  await expect(page.getByText("Needs Registration Forms in Campaign Features.")).toBeVisible();
  await shoot(page, "step-7-connect-tool-hint");
  await page.getByRole("button", { name: "Go to Campaign Features" }).click();
  await expect(heading(page, "Campaign Features")).toBeVisible();
  await hydrated(page);
  await autosaved(page, async () => { await page.getByRole("switch", { name: "Enable Registration Forms" }).click(); });
  await page.reload();
  await hydrated(page);
  await page.getByRole("group", { name: /^Editing/ }).getByRole("button", { name: /Registration & Follow-Up/ }).click();
  await expect(page.getByRole("switch", { name: "Enable Evangelistic Response Form" })).toBeChecked();
  await expect(page.getByRole("switch", { name: "Enable Public Campaign Registration" })).toBeChecked();
  await expect(page.getByText("Needs Registration Forms in Campaign Features.")).toHaveCount(0);
  // Review lists the choices; Finish adds one unpublished source, and the dashboard and the links screen show it.
  await page.getByRole("group", { name: /^Editing/ }).getByRole("button", { name: /Review & Create/ }).click();
  await expect(page.getByRole("heading", { name: "Registration & Follow-Up", level: 3 })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Evangelistic Response Form" })).toBeVisible();
  await page.getByRole("button", { name: "Finish — Create Campaign" }).click();
  await page.waitForURL(new RegExp(`${root}/[0-9a-f-]{36}$`));
  const campaignId = page.url().split("/").pop() as string;
  await expect(page.getByRole("heading", { name: "Registration & follow-up", level: 3 })).toBeVisible();
  const linkList = await (await page.request.get(`/api${root}/${campaignId}/connect/links`)).json();
  expect(linkList.links).toHaveLength(1);
  expect(linkList.links[0]).toMatchObject({ status: "draft", formVersionId: null, publicTitle: null });
  // Registration was on and an owner finished: one unpublished registration form exists and the dashboard links to it.
  const formLink = page.getByRole("link", { name: "Open the registration form" });
  await expect(formLink).toBeVisible();
  const formPath = new URL((await formLink.getAttribute("href"))!, page.url()).pathname;
  expect(formPath).toMatch(new RegExp(`/workspaces/${tenant}/crm/forms/[0-9a-f-]{36}$`));
  await shoot(page, "step-7-dashboard-forms");
  await formLink.click();
  await expect(page).toHaveURL(new RegExp(`${formPath}$`));
  await expect(page.getByText("Connect campaign registration")).toBeVisible();
  await expect(page.getByText(/not published|unpublished|Draft/i).first()).toBeVisible();
  await page.goBack();
  await page.getByRole("link", { name: "Open the response QR links" }).click();
  await expect(page).toHaveURL(new RegExp(`${campaignId}/connect$`));
  await shoot(page, "step-7-connect-draft-source");
  // Every width and scheme for the step.
  await page.goto(`${root}/drafts/${(await (await page.request.post(api, { headers: { origin, "Idempotency-Key": "connect-2" }, data: { type: "evangelistic_crusade" } })).json()).id}`);
  for (const scheme of ["light", "dark"] as const) for (const [label, width, height] of [["phone", 360, 800], ["tablet", 768, 1024], ["desktop", 1280, 900]] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width, height });
    await page.reload();
    await hydrated(page);
    if (width >= 1024) await page.getByRole("group", { name: /^Editing/ }).getByRole("button", { name: /Registration & Follow-Up/ }).click();
    else { await page.getByRole("button", { name: /^Step \d of 8/ }).click(); await page.getByRole("dialog").getByRole("button", { name: /Registration & Follow-Up/ }).click(); }
    await expect(heading(page, "Registration & Follow-Up")).toBeVisible();
    await expectAccessible(page);
    if (width < 768) await expectCleanWhenScrolled(page);
    await shoot(page, `step-7-connect-${label}-${scheme}`);
  }
  expect(errors).toEqual([]);
});

test("step 6: exactly five fields, fundraising gates the goal and online donations, amounts in the currency's units, settings only", async ({ page }) => {
  test.setTimeout(420_000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Budget Church", audience: "church" } })).json()).tenantId as string;
  const root = `/workspaces/${tenant}/campaigns`, api = `/api${root}/drafts`;
  const patch = async (id: string, version: number, step: string, data: unknown) => (await (await page.request.patch(`${api}/${id}`, { headers: { origin }, data: { version, step, data } })).json()).version as number;
  const draft = await (await page.request.post(api, { headers: { origin, "Idempotency-Key": "budget-1" }, data: { type: "evangelistic_crusade" } })).json();
  let version = await patch(draft.id, draft.version, "basics", { name: "Budget campaign", description: null, mission: null });
  version = await patch(draft.id, version, "place", { country: "Chile", cityRegion: "Santiago", startDate: "2027-05-01", endDate: "2027-05-02", timeZone: "America/Santiago", structure: "single" });
  await patch(draft.id, version, "tools", { modules: ["tasks_boards"] }); // fundraising is off in the tools
  await page.goto(`${root}/drafts/${draft.id}`);
  await hydrated(page);
  await page.getByRole("group", { name: /^Editing/ }).getByRole("button", { name: /Budget & Fundraising/ }).click();
  await expect(heading(page, "Budget & Fundraising")).toBeVisible();
  await expect(page.getByText("What is the budget, and will you raise funds?")).toBeVisible();
  // Exactly the five PRD fields.
  await expect(page.getByLabel("Preferred Currency")).toBeVisible();
  await expect(page.getByLabel("Estimated Total Budget")).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Enable Campaign Fundraising" })).toBeVisible();
  await expect(page.getByLabel("Fundraising Goal (optional)")).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Allow Online Donations" })).toBeVisible();
  await expect(page.locator('[data-slot="wizard-layout"] input:not([type="radio"]), [data-slot="wizard-layout"] select')).toHaveCount(3);
  await expect(page.getByText("Nothing is collected and no payment provider is contacted.")).toBeVisible();
  // Fundraising is off: the goal and online donations are disabled with the reason.
  await expect(page.getByLabel("Fundraising Goal (optional)")).toBeDisabled();
  await expect(page.getByRole("radio", { name: "Yes" }).last()).toBeDisabled();
  await expect(page.getByText("Turn on campaign fundraising first.")).toHaveCount(2);
  await shoot(page, "step-6-budget");
  await expectAccessible(page);
  // Amounts are plain numbers in the currency's units: a bad one says so and is not saved.
  await page.getByLabel("Estimated Total Budget").fill("12.345");
  await expect(page.getByRole("alert").filter({ hasText: "Enter a plain number" })).toBeVisible();
  await expect(page.locator('[data-save-state="invalid"]')).toBeVisible();
  await autosaved(page, async () => { await page.getByLabel("Estimated Total Budget").fill("12000.50"); });
  await autosaved(page, async () => { await page.getByLabel("Preferred Currency").selectOption("EUR"); });
  await autosaved(page, async () => { await page.getByRole("radio", { name: "Yes" }).first().click(); });
  await expect(page.getByLabel("Fundraising Goal (optional)")).toBeEnabled();
  await expect(page.getByText("Fundraising needs Fundraising & Donations turned on in Campaign Features.")).toBeVisible();
  await shoot(page, "step-6-budget-tool-hint");
  await autosaved(page, async () => { await page.getByLabel("Fundraising Goal (optional)").fill("50000"); });
  await autosaved(page, async () => { await page.getByRole("radio", { name: "Yes" }).last().click(); });
  const saved = await (await page.request.get(`${api}/${draft.id}`)).json();
  expect(saved.budget).toEqual({ currency: "EUR", estimatedBudgetMinor: 1200050, fundraisingEnabled: true, fundraisingGoalMinor: 5000000, onlineDonations: true });
  // Turning fundraising off clears the goal and online donations with it.
  await autosaved(page, async () => { await page.getByRole("radio", { name: "No" }).first().click(); });
  await expect(page.getByLabel("Fundraising Goal (optional)")).toHaveValue("");
  expect((await (await page.request.get(`${api}/${draft.id}`)).json()).budget).toEqual({ currency: "EUR", estimatedBudgetMinor: 1200050, fundraisingEnabled: false, fundraisingGoalMinor: null, onlineDonations: false });
  await autosaved(page, async () => { await page.getByRole("radio", { name: "Yes" }).first().click(); });
  await autosaved(page, async () => { await page.getByLabel("Fundraising Goal (optional)").fill("50000"); });
  // The review shows formatted amounts; the tool hint's link goes to Campaign Features where fundraising is switched on; Finish; the dashboard shows the settings.
  await page.getByRole("button", { name: "Go to Campaign Features" }).click();
  await expect(heading(page, "Campaign Features")).toBeVisible();
  await hydrated(page);
  await autosaved(page, async () => { await page.getByRole("switch", { name: "Enable Fundraising & Donations" }).click(); });
  await page.getByRole("group", { name: /^Editing/ }).getByRole("button", { name: /Review & Create/ }).click();
  await expect(page.getByRole("heading", { name: "Budget & Fundraising", level: 3 })).toBeVisible();
  await expect(page.getByText("€12,000.50")).toBeVisible();
  await expect(page.getByText("€50,000.00")).toBeVisible();
  await shoot(page, "step-6-review");
  await page.getByRole("button", { name: "Finish — Create Campaign" }).click();
  await page.waitForURL(new RegExp(`${root}/[0-9a-f-]{36}$`));
  await expect(page.getByRole("heading", { name: "Budget & fundraising", level: 3 })).toBeVisible();
  await expect(page.getByText("€12,000.50")).toBeVisible();
  await shoot(page, "step-6-dashboard");
  // Nothing was collected: no donation, gift or payment record exists for the campaign.
  expect(JSON.stringify(await (await page.request.get(`/api${root}/${page.url().split("/").pop()}/overview`)).json())).not.toMatch(/raised|paid|gift|checkout/i);
  // Every width and scheme for the step.
  const other = await (await page.request.post(api, { headers: { origin, "Idempotency-Key": "budget-2" }, data: { type: "evangelistic_crusade" } })).json();
  await page.goto(`${root}/drafts/${other.id}`);
  for (const scheme of ["light", "dark"] as const) for (const [label, width, height] of [["phone", 360, 800], ["tablet", 768, 1024], ["desktop", 1280, 900]] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width, height });
    await page.reload();
    await hydrated(page);
    if (width >= 1024) await page.getByRole("group", { name: /^Editing/ }).getByRole("button", { name: /Budget & Fundraising/ }).click();
    else { await page.getByRole("button", { name: /^Step \d of 8/ }).click(); await page.getByRole("dialog").getByRole("button", { name: /Budget & Fundraising/ }).click(); }
    await expect(heading(page, "Budget & Fundraising")).toBeVisible();
    await expectAccessible(page);
    if (width < 768) await expectCleanWhenScrolled(page);
    await shoot(page, `step-6-budget-${label}-${scheme}`);
  }
  expect(errors).toEqual([]);
});
