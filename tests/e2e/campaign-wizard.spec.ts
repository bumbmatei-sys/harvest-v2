import { mkdir } from "node:fs/promises";
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
  await settleForAxe(page);
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
}
async function expectAccessible(page: Page) {
  await settleForAxe(page);
  expect((await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
  await page.waitForFunction(() => { const field = document.querySelector("input,textarea,select"); return !!field && Object.keys(field).some((key) => key.startsWith("__reactProps")); });
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
  // Steps 4 to 8 are listed and not available yet.
  const stepList = shellModes ? page.getByRole("group", { name: /^Editing/ }) : page.getByRole("navigation", { name: "Campaign setup" });
  for (const label of ["Teams & Leadership", "Campaign Features", "Budget & Fundraising", "Registration & Follow-Up", "Review & Create"]) await expect(stepList.getByRole("button", { name: new RegExp(label) })).toHaveAttribute("aria-disabled", "true");

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
  await expect(page.getByRole("button", { name: "Next", exact: true })).toHaveCount(0); // steps 4 to 8 are not available yet

  // Resume: closing and reopening restores every answer, at the furthest step reached.
  await page.goto(draftUrl);
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
    await expect(member2.page.getByRole("link", { name: /Member mission trip/ })).toContainText(`Started by ${member.email}`);
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
  expect(errors).toEqual([]);
});
